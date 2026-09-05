/**
 * WHICH estate consumer this Worker is — the F-5 guard, pinned.
 *
 * Modelled on `bookbuddy/library_catalog`'s
 * `packages/estate-auth/test/instance-estate-app.test.ts`, which came out of the
 * real bug: one build, two Workers, ONE hard-coded identity, and nothing red for
 * months. This repo never shipped a second instance, so the guard lands BEFORE
 * the bug rather than after it — which also means the fixtures below are the
 * only place its refusal can be seen. **A guard never seen to refuse is a guard
 * never tested**, so the refusing cases are first-class tests here, not a
 * comment describing what would happen.
 *
 * Every assertion fails on the MUTATION, not on the symptom:
 *
 *   1. re-hard-code `'games'` in the gate/billing door → the "one reader" test
 *   2. make an unrecognised ESTATE_APP fall back to `games` → the typo test
 *   3. let the gate read whichever bearer it can find  → the borrowed-bearer test
 *   4. copy an env block and forget to change ESTATE_APP → the same-id fixtures
 *
 * ⚠️ None of it proves the PAIRING is right. The app id is config; the directory
 * resolves identity from the token's VALUE. A right name over a wrong value is a
 * 401 the gate reports as `estate_unreachable`. The only proof of the value is a
 * live `/seen` — see `docs/access/second-instance.md`.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, test } from 'node:test';
import {
  APP_TOKEN_VAR,
  DEFAULT_ESTATE_APP,
  ESTATE_APPS,
  assertOneIdentityPerInstance,
  declaredEstateApps,
  describeEstateApp,
  estateAppToken,
  resolveEstateApp,
} from './estate-app.js';

function repoFile(relative: string): string {
  // fileURLToPath, not a URL object — readFileSync(URL) does not typecheck
  // across this repo's TS libs (estate-refusals.test.ts hits the same).
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url).href), 'utf8');
}

// ── the resolver ────────────────────────────────────────────────────────────

test('unset ESTATE_APP is the main instance — nothing about today changes', () => {
  assert.deepEqual(resolveEstateApp(undefined), {
    app: 'games',
    tokenVar: 'ESTATE_APP_TOKEN_GAMES',
    invalid: null,
  });
  assert.deepEqual(resolveEstateApp(''), resolveEstateApp(undefined));
  assert.equal(DEFAULT_ESTATE_APP, 'games');
});

test('games2 resolves to the GAMES2 secret name — same name both sides', () => {
  assert.deepEqual(resolveEstateApp('games2'), {
    app: 'games2',
    tokenVar: 'ESTATE_APP_TOKEN_GAMES2',
    invalid: null,
  });
  assert.deepEqual(resolveEstateApp(' games2 '), resolveEstateApp('games2'));
});

test('🔴 a typo does NOT fall back to `games` — that fallback IS the bug', () => {
  // ⚠️ The opposite direction from estateMode()/billingPosture() on purpose. For
  // those two the safe answer is a working default; here the "default" would be
  // the main catalog's identity, asserted by an instance that is not it.
  for (const raw of ['game2', 'GAMES2', 'games 2', 'boardgames', 'library', 'index']) {
    const out = resolveEstateApp(raw);
    assert.equal(out.app, null, `${raw} must not resolve to an identity`);
    assert.equal(out.tokenVar, null);
    assert.equal(out.invalid, raw.trim());
  }
});

test('the allowlist is THIS repo, not the whole estate directory', () => {
  // `library`/`library2`/`index`/`audiobook` are real CONSUMER_APPS on the auth
  // Worker and must stay unreachable from here: one var edit should never let
  // the games catalog present itself as the library's consumer.
  assert.deepEqual([...ESTATE_APPS], ['games', 'games2']);
  assert.deepEqual(Object.keys(APP_TOKEN_VAR).sort(), ['games', 'games2']);
});

// ── the bearer: which slot, and never a borrowed one ────────────────────────

describe('the bearer follows the identity', () => {
  it('each app reads its own slot and only its own', () => {
    const env = {
      ESTATE_APP_TOKEN_GAMES: 'main-bearer',
      ESTATE_APP_TOKEN_GAMES2: 'second-bearer',
    };
    assert.equal(estateAppToken(env, 'ESTATE_APP_TOKEN_GAMES'), 'main-bearer');
    assert.equal(estateAppToken(env, 'ESTATE_APP_TOKEN_GAMES2'), 'second-bearer');
  });

  it('🔴 MUTATION GUARD: a games2 env holding only the GAMES token is OFF, not wrong', () => {
    // The pre-fix state of the library's friend Worker, exactly. If this module
    // ever reads whichever token it can find, this goes green and F-5 is back.
    // It must instead resolve to nothing — which is also the state a new
    // instance sits in between its first deploy and the owner piping its
    // bearer, and the reason that window is safe rather than a lockout.
    const env = { ESTATE_APP: 'games2', ESTATE_APP_TOKEN_GAMES: 'main-bearer' };
    const { tokenVar } = resolveEstateApp(env.ESTATE_APP);
    assert.equal(tokenVar, 'ESTATE_APP_TOKEN_GAMES2');
    assert.equal(estateAppToken(env, tokenVar), '', 'a second instance borrowed the main bearer');
  });

  it('an unresolved identity can reach no slot at all', () => {
    assert.equal(estateAppToken({ ESTATE_APP_TOKEN_GAMES: 'main-bearer' }, null), '');
  });
});

// ── the outside-observable signal ───────────────────────────────────────────

describe('/api/health answers "which consumer is that Worker?" with no sign-in', () => {
  const MAIN = {
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP: 'games',
    ESTATE_APP_TOKEN_GAMES: 'main-bearer',
  };
  const SECOND = {
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP: 'games2',
    ESTATE_APP_TOKEN_GAMES2: 'second-bearer',
  };

  it('reports the identity, the secret NAME — and never a value', () => {
    assert.deepEqual(describeEstateApp(MAIN), {
      app: 'games',
      tokenVar: 'ESTATE_APP_TOKEN_GAMES',
      configured: true,
    });
    assert.deepEqual(describeEstateApp(SECOND), {
      app: 'games2',
      tokenVar: 'ESTATE_APP_TOKEN_GAMES2',
      configured: true,
    });
    for (const env of [MAIN, SECOND]) {
      assert.doesNotMatch(
        JSON.stringify(describeEstateApp(env)),
        /main-bearer|second-bearer/,
        'health must never carry a token value',
      );
    }
  });

  it('`configured` goes false the moment either half is missing — the inert state is VISIBLE', () => {
    assert.equal(describeEstateApp({ ...SECOND, ESTATE_APP_TOKEN_GAMES2: undefined }).configured, false);
    assert.equal(describeEstateApp({ ...SECOND, ESTATE_AUTH_URL: undefined }).configured, false);
    // Wrong slot: a second instance's bearer under the main name buys nothing.
    assert.equal(
      describeEstateApp({
        ...SECOND,
        ESTATE_APP_TOKEN_GAMES2: undefined,
        ESTATE_APP_TOKEN_GAMES: 'main-bearer',
      }).configured,
      false,
    );
    const typo = describeEstateApp({ ...SECOND, ESTATE_APP: 'game2' });
    assert.equal(typo.app, null);
    assert.equal(typo.tokenVar, null);
    assert.equal(typo.configured, false);
  });
});

// ── the config of record ────────────────────────────────────────────────────

const WRANGLER = repoFile('apps/worker/wrangler.toml');

describe('wrangler.toml declares one identity per instance', () => {
  it('the file was read and an ESTATE_APP was found — an empty read is a failed read', () => {
    assert.ok(WRANGLER.length > 0, 'wrangler.toml read as empty');
    assert.ok(
      declaredEstateApps(WRANGLER).length > 0,
      'no uncommented `ESTATE_APP = "…"` in apps/worker/wrangler.toml',
    );
  });

  it('the main instance is `games`, in [vars]', () => {
    const main = declaredEstateApps(WRANGLER).find((d) => d.env === 'default');
    assert.ok(main, 'the top-level [vars] declares no ESTATE_APP');
    assert.equal(main.app, 'games');
  });

  it('🔴 the committed config passes the same-id guard', () => {
    assert.doesNotThrow(() => assertOneIdentityPerInstance(declaredEstateApps(WRANGLER)));
  });

  it('no second instance is declared for real yet', () => {
    // When one is, this test gets its own env row rather than being deleted.
    // (That the COMMENTED [env.<instance>] template does not count as a
    // declaration is asserted in `instance-template.test.ts`, which owns the
    // template.)
    assert.equal(declaredEstateApps(WRANGLER).filter((d) => d.env !== 'default').length, 0);
  });
});

// ── 🔴 the guard REFUSING, which is the half that is usually never run ──────

describe('the same-id guard refuses, and says why', () => {
  const MAIN_BLOCK = ['[vars]', 'ESTATE_CHECK = "enforce"', 'ESTATE_APP = "games"', ''].join('\n');

  it('accepts one instance', () => {
    assert.doesNotThrow(() => assertOneIdentityPerInstance(declaredEstateApps(MAIN_BLOCK)));
  });

  it('accepts two instances with different ids', () => {
    const toml = `${MAIN_BLOCK}\n[env.games2.vars]\nESTATE_APP = "games2"\n`;
    const decls = declaredEstateApps(toml);
    assert.deepEqual(
      decls.map((d) => [d.env, d.app]),
      [
        ['default', 'games'],
        ['games2', 'games2'],
      ],
    );
    assert.doesNotThrow(() => assertOneIdentityPerInstance(decls));
  });

  it('🔴 REFUSES two env blocks asserting the SAME id — this is F-5', () => {
    const toml = `${MAIN_BLOCK}\n[env.games2.vars]\nESTATE_APP = "games"\n`;
    assert.throws(
      () => assertOneIdentityPerInstance(declaredEstateApps(toml)),
      (err: Error) => {
        assert.match(err.message, /both declare ESTATE_APP = "games"/);
        assert.match(err.message, /\[vars\] and \[env\.games2\.vars\]/);
        assert.match(err.message, /F-5/, 'the refusal must name the incident so it is findable');
        return true;
      },
    );
  });

  it('🔴 REFUSES an id this codebase cannot present', () => {
    const toml = `${MAIN_BLOCK}\n[env.friend.vars]\nESTATE_APP = "library2"\n`;
    assert.throws(
      () => assertOneIdentityPerInstance(declaredEstateApps(toml)),
      /cannot present.*Allowed: games, games2/s,
    );
  });

  it('🔴 REFUSES a config that declares no identity at all', () => {
    assert.throws(
      () => assertOneIdentityPerInstance(declaredEstateApps('[vars]\nESTATE_CHECK = "enforce"\n')),
      /declares no ESTATE_APP at all/,
    );
  });
});

// ── one reader, one decision ────────────────────────────────────────────────

test('🔴 nothing outside estate-app.ts reads an ESTATE_APP_TOKEN_* var by name', () => {
  // Cheap structural guard: the day a second file reads a bearer directly, the
  // identity stops being one decision in one place — which is exactly how the
  // hard-code survived in the library for months.
  for (const file of [
    'apps/worker/src/middleware/estate.ts',
    'apps/worker/src/lib/billing-gate.ts',
    'apps/worker/src/routes/health.ts',
  ]) {
    const src = repoFile(file);
    assert.ok(src.length > 0, `${file} read as empty — an empty read is a failed read`);
    const reads = [...src.matchAll(/\benv\.ESTATE_APP_TOKEN_[A-Z0-9_]+/g)].map((m) => m[0]);
    assert.deepEqual(
      reads,
      [],
      `${file} reads a bearer directly again — that is how the hard-code came back. ` +
        'Resolve it through estateAppToken(env, tokenVar) in lib/estate-app.ts.',
    );
  }
});
