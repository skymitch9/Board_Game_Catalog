/**
 * billing-gate.test.ts — the spending gate's truth table, its wording, its
 * system door, and the three things about it that fail SILENTLY if they are
 * ever got wrong.
 *
 * Design: `catalog-platform/docs/info/llm-billing-control-design.md` §3.5
 * (failure directions), §4 (postures), §6 (what a refusal says).
 *
 * 🔴 THE THREE SILENT FAILURES THIS FILE EXISTS TO CATCH:
 *
 *   1. `null` collapsing into `[]`. An auth Worker mid-deploy answers no
 *      `billing_denied` at all; reading that absence as "nothing is denied"
 *      un-switches every policy the owner set, for the length of the deploy,
 *      with nothing anywhere going red.
 *   2. A feature id that does not match the registry. A Worker checking
 *      `research.cover` (singular) against a registry holding `research.covers`
 *      fails open FOREVER and nothing ever complains.
 *   3. A refusal shipping as a bare `{error}`. That is not hypothetical here:
 *      `estate_revoked` did exactly that for weeks, survived because
 *      `apps/web/src/lib/errors.ts` happened to translate the code, and was
 *      only found by an audit — `estate-refusals.test.ts` is the tripwire that
 *      came out of it, and this file holds the same line for `billing_denied`.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  BILLING_FEATURES,
  BILLING_POSTURES,
  BILLING_SITE,
  billingPosture,
  billingRefusalBody,
  decideBilling,
  fetchSystemDenied,
  parseCachedDenied,
} from './billing-gate.js';
import type { Env } from '../env.js';

// ---------------------------------------------------------------------------
// The posture.
// ---------------------------------------------------------------------------

test('the three postures are recognised, trimmed and case-folded', () => {
  for (const p of BILLING_POSTURES) {
    assert.equal(billingPosture(p), p);
    assert.equal(billingPosture(` ${p.toUpperCase()} `), p);
  }
});

test('⚠️ unset, empty and typo’d all fall to off — the inert direction', () => {
  assert.equal(billingPosture(undefined), 'off');
  assert.equal(billingPosture(''), 'off');
  // The same treatment `estateMode` gives ESTATE_CHECK: a typo must not
  // silently half-enable a money gate, and must not be silent about it either.
  assert.equal(billingPosture('enforc'), 'off');
  assert.equal(billingPosture('ON'), 'off');
});

test('the site is this app’s estate id', () => {
  assert.equal(BILLING_SITE, 'games');
});

// ---------------------------------------------------------------------------
// The truth table.
// ---------------------------------------------------------------------------

test('off resolves nothing, logs nothing and proceeds — even on a denied feature', () => {
  assert.deepEqual(
    decideBilling({ posture: 'off', feature: BILLING_FEATURES.tier, denied: [BILLING_FEATURES.tier] }),
    { wouldDeny: false, proceeded: true, log: false },
  );
});

test('🔴 shadow LOGS AND BILLS — `proceeded` is true on a would-deny, and that field is the point', () => {
  // The lesson `catalog-platform/docs/info/audiobook-auth-soak-2026-08-16.md`
  // cost the estate once: a soak line with no outcome field cannot separate a
  // true regression from the gate merely agreeing with today's rules, and the
  // verdict was NOT ENOUGH EVIDENCE, do not flip.
  assert.deepEqual(
    decideBilling({
      posture: 'shadow',
      feature: BILLING_FEATURES.tier,
      denied: [BILLING_FEATURES.tier],
    }),
    { wouldDeny: true, proceeded: true, log: true },
  );
});

test('shadow logs the AGREEING decisions too — a soak with no denominator is not a soak', () => {
  assert.deepEqual(
    decideBilling({ posture: 'shadow', feature: BILLING_FEATURES.tier, denied: [] }),
    { wouldDeny: false, proceeded: true, log: true },
  );
});

test('enforce refuses a denied feature and nothing else', () => {
  assert.deepEqual(
    decideBilling({
      posture: 'enforce',
      feature: BILLING_FEATURES.scanPhoto,
      denied: [BILLING_FEATURES.scanPhoto, BILLING_FEATURES.sweep],
    }),
    { wouldDeny: true, proceeded: false, log: true },
  );
  assert.deepEqual(
    decideBilling({
      posture: 'enforce',
      feature: BILLING_FEATURES.barcodePaid,
      denied: [BILLING_FEATURES.scanPhoto],
    }),
    { wouldDeny: false, proceeded: true, log: false },
  );
});

test('🔴 null is UNKNOWN and UNKNOWN PROCEEDS, even in enforce', () => {
  // §3.5 row 3, chosen out loud: denying every paid feature when the directory
  // is unreachable turns an auth outage into a household-wide "everything is
  // broken". The wallet is bounded by SWEEP_LIMIT = 8 and the timeouts.
  assert.deepEqual(
    decideBilling({ posture: 'enforce', feature: BILLING_FEATURES.tier, denied: null }),
    { wouldDeny: false, proceeded: true, log: false },
  );
});

test('🔴 [] is a REAL ANSWER — "the directory denied nothing" — and is not null', () => {
  const empty = decideBilling({ posture: 'shadow', feature: BILLING_FEATURES.tier, denied: [] });
  const unknown = decideBilling({ posture: 'shadow', feature: BILLING_FEATURES.tier, denied: null });
  assert.equal(empty.proceeded, true);
  assert.equal(unknown.proceeded, true);
  // Both proceed, for different reasons, and the reasons must stay
  // distinguishable: one is a fact, the other is the absence of one.
  assert.equal(empty.log, true);
  assert.equal(unknown.log, true);
});

// ---------------------------------------------------------------------------
// The cached column.
// ---------------------------------------------------------------------------

test('🔴 the cached column keeps null and [] apart', () => {
  assert.equal(parseCachedDenied(null), null, 'no column value is UNKNOWN');
  assert.deepEqual(parseCachedDenied('[]'), [], 'a stored empty array is a real answer');
});

test('⚠️ garbage in the column dies into null, never into a partial deny-list', () => {
  for (const junk of ['not json', '"research.tier"', '42', '{"a":1}', 'null']) {
    assert.equal(parseCachedDenied(junk), null, `${junk} should not survive`);
  }
});

test('⚠️ non-string entries are dropped and the rest of the list still counts', () => {
  // Voiding the whole list on one bad entry fails in the ALLOWING direction,
  // which for a deny-list is the wrong way round.
  assert.deepEqual(parseCachedDenied('["research.tier",7,"","sweep.details"]'), [
    'research.tier',
    'sweep.details',
  ]);
});

// ---------------------------------------------------------------------------
// The refusal body — never a bare status. See failure 3 in the header.
// ---------------------------------------------------------------------------

test('🔴 the refusal says what happened, what it needs and how to change it', () => {
  const body = billingRefusalBody(BILLING_FEATURES.tier, 'Research runs');
  assert.equal(body.error, 'billing_denied');
  assert.equal(
    body.detail,
    'Research runs is switched off for this catalogue. The owner can turn it back on.',
  );
  assert.equal(body.needs, 'the estate owner');
  // ⚠️ The HOW names the Spending panel and the ten-minute delay. A surface
  // that implies "instantly" invites the owner to press it twice (§3.4).
  assert.match(body.how, /Spending panel/);
  assert.match(body.how, /10 minutes/);
});

test('⚠️ every refusal carries a `detail` — the same line estate-refusals.test.ts holds for estateGate', () => {
  for (const [key, id] of Object.entries(BILLING_FEATURES)) {
    const body = billingRefusalBody(id, key);
    assert.ok(
      typeof body.detail === 'string' && body.detail.length > 0,
      `${id} must not answer with a bare error code`,
    );
  }
});

test('⚠️ the SITE sentence, not the person one — this Worker cannot tell which rule matched', () => {
  // It is handed a resolved SET, not the rules. Guessing "switched off for
  // you" when it was switched off for the whole catalogue sends somebody to
  // ask the owner for something nobody there can grant. The split is
  // load-bearing (§6).
  const body = billingRefusalBody(BILLING_FEATURES.scanPhoto, 'Photo scanning');
  assert.match(body.detail, /for this catalogue/);
  assert.doesNotMatch(body.detail, /for you/);
});

test('the refusal carries no `why` — that column is the owner’s note and may name people', () => {
  assert.deepEqual(Object.keys(billingRefusalBody(BILLING_FEATURES.tier, 'x')).sort(), [
    'detail',
    'error',
    'feature',
    'how',
    'needs',
  ]);
});

// ---------------------------------------------------------------------------
// The system door — G7, the one biller with no human.
// ---------------------------------------------------------------------------

const SYS_ENV = {
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP_TOKEN_GAMES: 'token-under-test',
} as unknown as Env;

function answering(body: unknown, status = 200) {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test('a system deny-set rides through in the directory’s own order', async () => {
  const out = await fetchSystemDenied(SYS_ENV, {
    fetchImpl: answering({ site: 'games', system_denied: ['sweep.details'] }),
  });
  assert.deepEqual(out, ['sweep.details']);
});

test('🔴 an empty system answer is [] and an absent one is null', async () => {
  assert.deepEqual(await fetchSystemDenied(SYS_ENV, { fetchImpl: answering({ system_denied: [] }) }), []);
  assert.equal(await fetchSystemDenied(SYS_ENV, { fetchImpl: answering({ site: 'games' }) }), null);
});

test('⚠️ a malformed system_denied dies into null, not into a partial list', async () => {
  for (const junk of ['sweep.details', 42, { sweep: true }, null]) {
    assert.equal(
      await fetchSystemDenied(SYS_ENV, { fetchImpl: answering({ system_denied: junk }) }),
      null,
      `${JSON.stringify(junk)} should not survive`,
    );
  }
});

test('a non-2xx and a thrown fetch are both null — a scheduled run has no response to put an error in', async () => {
  assert.equal(await fetchSystemDenied(SYS_ENV, { fetchImpl: answering({}, 401) }), null);
  assert.equal(
    await fetchSystemDenied(SYS_ENV, {
      fetchImpl: (async () => {
        throw new Error('network');
      }) as typeof fetch,
    }),
    null,
  );
});

test('⚠️ an unconfigured door asks nothing and answers unknown', async () => {
  const calls: string[] = [];
  const spy = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  assert.equal(await fetchSystemDenied({} as Env, { fetchImpl: spy }), null, 'no URL, no token');
  assert.equal(
    await fetchSystemDenied({ ESTATE_AUTH_URL: 'https://auth.example' } as Env, { fetchImpl: spy }),
    null,
    'no bearer',
  );
  assert.equal(calls.length, 0, 'a half-configured door must not call the directory');
});

test('the door presents this app’s own bearer at the estate’s path', async () => {
  let url: string | null = null;
  let auth: string | null = null;
  await fetchSystemDenied(SYS_ENV, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify({ system_denied: [] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(url, 'https://auth.example/api/estate/billing/policy');
  assert.equal(auth, 'Bearer token-under-test');
});

// ---------------------------------------------------------------------------
// 🔴 The literal pins.
// ---------------------------------------------------------------------------

test('🔴 every feature id this Worker checks is the registry’s exact string', () => {
  // The registry lives in catalog-platform's auth Worker and is NOT importable
  // from here, so this is a literal pin — the same shape the registry's own
  // pin test uses one layer up, for the same reason: a Worker that checks an
  // id the registry does not hold fails SILENTLY OPEN, forever, and no test
  // anywhere else in the estate would notice.
  assert.deepEqual(BILLING_FEATURES, {
    scanPhoto: 'scan.photo',
    barcodePaid: 'barcode.paid',
    tier: 'research.tier',
    details: 'research.details',
    sweep: 'sweep.details',
  });
});

test('⚠️ the paid barcode rung has its OWN id — it is not scan.photo', () => {
  // Two costs, two switches: the vision routes are `scanPhoto` capability and
  // read a PHOTO; this one is `runResearch` and buys a web search on a NUMBER.
  assert.notEqual(BILLING_FEATURES.barcodePaid as string, BILLING_FEATURES.scanPhoto as string);
});

test('🔴 wrangler.toml ships BILLING_POLICY = "off", and ESTATE_CHECK is a SEPARATE flag', () => {
  // A mechanical guard, not advice: a site is flipped on evidence and never as
  // a side effect of an unrelated deploy (§4.2). This fails the moment a flip
  // is committed, so the flip has to be deliberate — the same trick
  // `estate-refusals.test.ts` plays on ESTATE_CHECK's comment block.
  const toml = readFileSync(
    fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href),
    'utf8',
  );
  const billing = [...toml.matchAll(/^BILLING_POLICY\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.deepEqual(billing, ['off']);

  // ⚠️ And the two flags are allowed to differ. This assertion exists so that
  // nobody reads `ESTATE_CHECK = "enforce"` as licence to flip the one above:
  // one answers "is this person still a member", the other "may they spend".
  const estate = [...toml.matchAll(/^ESTATE_CHECK\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.deepEqual(estate, ['enforce'], 'if this changed, read the block above it before touching billing');
});

test('⚠️ the wrangler comment block names the value that is actually set', () => {
  // Defect 3 of §6.1 was exactly this drift on ESTATE_CHECK — a comment saying
  // "deliberately off" beside a value of `enforce`. Same guard, same file.
  const toml = readFileSync(
    fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href),
    'utf8',
  );
  assert.ok(
    toml.includes('⚠️ BILLING_POLICY IS "off"'),
    'the prose beside the value must name the value',
  );
});
