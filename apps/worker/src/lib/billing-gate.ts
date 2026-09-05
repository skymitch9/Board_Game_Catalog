/**
 * THE CALL-SITE GATE for this Worker's money paths — phase 3 of
 * `catalog-platform/docs/info/llm-billing-control-design.md`.
 *
 * The template is `catalog-platform/apps/index-worker/src/billing-gate.ts`,
 * which gated the apex shelf scanner. This is its games twin; the site is a
 * constant here (`games`, one deploy, one identity), unlike the library's.
 *
 * ⚠️ IT SHIPS `BILLING_POLICY = "off"` AND MUST. `off` → nothing resolves and
 * nothing is logged; `shadow` → the decision is logged WITH ITS OUTCOME and the
 * call proceeds and bills; `enforce` → a deny refuses, in words. A site is
 * flipped one at a time, on evidence, and never as a side effect of an
 * unrelated deploy (§4.2).
 *
 * ⚠️ THE SHADOW LINE CARRIES `proceeded`, AND THAT FIELD IS THE WHOLE POINT.
 * The estate paid for this lesson once already
 * (`catalog-platform/docs/info/audiobook-auth-soak-2026-08-16.md`):
 * `reportGate()` fired from a `finally` with no outcome field, so the tail
 * could not separate a true regression from the gate merely agreeing with
 * today's rules, and the verdict was *NOT ENOUGH EVIDENCE, do not flip*. A soak
 * whose criterion cannot be falsified is not a soak.
 *
 * 🔴 THIS NEVER GRANTS. It answers "does policy say no", and the caller ANDs
 * that with the gate it already had — `requireCapability('scanPhoto')`,
 * `requireCapability('runResearch')`, the `ANTHROPIC_API_KEY` presence check,
 * the details-run dedupe. Removing any of those because this exists would be
 * exactly backwards (§3.3: the gates are ANDed, never replaced).
 *
 * ⚠️ AND IT IS NOT `ESTATE_CHECK`. That flag answers *"is this person still a
 * member"*; this one answers *"is this person allowed to spend"*. They are
 * separate postures on purpose, and `ESTATE_CHECK = "enforce"` here does not
 * make this one enforce.
 */

import type { Context } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { estateAppToken, resolveEstateApp } from './estate-app.js';

export const BILLING_POSTURES = ['off', 'shadow', 'enforce'] as const;
export type BillingPosture = (typeof BILLING_POSTURES)[number];

/**
 * ⚠️ ANYTHING UNRECOGNISED FALLS TO `off` AND LOGS. Copied deliberately from
 * this repo's own `estateMode` coercion rather than reinvented — a typo in a
 * wrangler var must not silently half-enable a money gate, and must not be
 * silent about it either.
 */
export function billingPosture(raw: string | undefined): BillingPosture {
  if (raw === undefined || raw === '') return 'off';
  const v = raw.trim().toLowerCase();
  if ((BILLING_POSTURES as readonly string[]).includes(v)) return v as BillingPosture;
  console.error(
    `BILLING_POLICY is "${raw}", which is not off|shadow|enforce — treating it as "off"`,
  );
  return 'off';
}

/**
 * The estate's site id for this Worker.
 *
 * ⚠️ STILL A CONSTANT, and that is a KNOWN GAP rather than a settled decision —
 * unlike `ESTATE_APP`, which was lifted into wrangler config on 2026-09-05. A
 * second games instance would report and be billed as the `games` site while
 * correctly identifying as `games2` at the directory. It is inert today
 * (`BILLING_POLICY = "off"`, nothing has ever resolved) and there is no second
 * instance, so nothing is wrong yet; it must be lifted before one bills.
 * Tracked in `docs/access/second-instance.md` and `docs/TODO.md` (phase 9).
 */
export const BILLING_SITE = 'games';

/** The registry ids this Worker checks. */
export const BILLING_FEATURES = {
  scanPhoto: 'scan.photo',
  barcodePaid: 'barcode.paid',
  tier: 'research.tier',
  details: 'research.details',
  sweep: 'sweep.details',
} as const;

export interface BillingRefusal {
  body: Record<string, unknown>;
  status: 403;
}

/**
 * The cached 0030 column as stored, parsed like the untrusted text it is.
 *
 * 🔴 The `null` / `[]` distinction survives: `'[]'` parses to `[]` (the
 * directory answered and denied nothing); a NULL column, unparseable text or a
 * non-array dies into `null` (UNKNOWN, which proceeds). Non-string entries
 * inside an otherwise good array are dropped rather than voiding the list,
 * because voiding it on one bad entry fails in the ALLOWING direction — the
 * wrong way round for a deny-list, since the ids the directory DID name are
 * still names it meant. Mirrors the wire parser in the synced
 * `estate-auth/seen.ts` exactly.
 */
export function parseCachedDenied(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return null;
  }
}

/**
 * The pure half — decide and describe, touching no context and no Response, so
 * every row of the truth table is a plain unit test.
 *
 * 🔴 `denied === null` IS "UNKNOWN" AND UNKNOWN PROCEEDS. §3.5 row 3, chosen
 * out loud: denying every paid feature when the directory is unreachable turns
 * an auth outage into a household-wide "everything is broken", which is the
 * failure the estate's wording rule exists to prevent. `[]` is the other fact
 * — the directory answered and denied nothing — and it proceeds for a different
 * reason. The two never collapse into one another.
 *
 * The exposure of that fail-open choice is bounded by the ceilings that already
 * exist here (`SWEEP_LIMIT = 8`, the model's own token caps, the timeouts), not
 * by this switch. *A policy that can only deny cannot be depended on to fail
 * closed; the ceilings are what bound the wallet.*
 */
export function decideBilling(args: {
  posture: BillingPosture;
  feature: string;
  denied: string[] | null;
}): { wouldDeny: boolean; proceeded: boolean; log: boolean } {
  if (args.posture === 'off') return { wouldDeny: false, proceeded: true, log: false };
  const wouldDeny = Array.isArray(args.denied) && args.denied.includes(args.feature);
  const proceeded = args.posture !== 'enforce' || !wouldDeny;
  return { wouldDeny, proceeded, log: wouldDeny || args.posture === 'shadow' };
}

/**
 * Build the refusal body. Never a bare status: it says what happened, what it
 * needs and how to change it.
 *
 * ⚠️ The WORKER carries the sentence, not only the React app. That is the exact
 * lesson §6.1 defect 1 taught this repo three days earlier — `estate_revoked`
 * shipped as a bare `{error}` for weeks because `apps/web/src/lib/errors.ts`
 * happened to translate the code, so no browser ever showed it; curl, GABI, a
 * second surface and every future app got a machine code and no route back.
 * `apps/worker/src/lib/estate-refusals.test.ts` exists so that cannot recur,
 * and this body is built to satisfy the same standard.
 */
export function billingRefusalBody(feature: string, label: string) {
  return {
    error: 'billing_denied',
    // §6: the SITE sentence, not the person one. This Worker is handed a
    // resolved SET, not the rules, so it cannot tell which one produced the
    // deny — and guessing "switched off for you" when it was switched off for
    // the whole catalogue would send somebody to ask the owner for something
    // nobody there can grant. When in doubt, say the one that does not waste
    // an evening. ⚠️ The site/person split is load-bearing (§6).
    detail: `${label} is switched off for this catalogue. The owner can turn it back on.`,
    feature,
    needs: 'the estate owner',
    how: 'Ask the owner to switch it back on from the Spending panel on heygabi.ai/admin/. A change takes effect within 10 minutes.',
  };
}

/**
 * Decide, log, and hand back a refusal when one is owed. `null` means proceed.
 */
export function billingRefusal(
  c: Context<AppBindings>,
  feature: string,
  label: string,
  estCents: string,
): BillingRefusal | null {
  const posture = billingPosture(c.env.BILLING_POLICY);
  const denied = c.get('billingDenied') ?? null;
  const { wouldDeny, proceeded, log } = decideBilling({ posture, feature, denied });

  if (log) {
    // One JSON line per decision, carrying every field §4.1 names — `rule_id`
    // is the exception and is deliberately absent: this consumer is handed a
    // resolved SET, not the rules, so it cannot name the row. "Why was I
    // denied" is answerable on the admin page, which holds both.
    //
    // ⚠️ JSON, unlike this repo's `estate shadow:` prose lines. A money soak is
    // counted and filtered (`jq 'select(.evt=="billing_policy")'`), not read;
    // the estate-auth soak's own verdict was NOT ENOUGH EVIDENCE partly
    // because its lines had to be parsed by eye.
    console.log(
      JSON.stringify({
        evt: 'billing_policy',
        posture,
        feature,
        site: BILLING_SITE,
        principal_kind: 'person',
        principal_value: c.get('user')?.email ?? null,
        would_deny: wouldDeny,
        proceeded,
        est_cents: estCents,
      }),
    );
  }

  if (proceeded) return null;
  return { status: 403, body: billingRefusalBody(feature, label) };
}

/**
 * The SYSTEM door — the spending answer for the one path here that has no
 * human: G7, the hourly details sweep.
 *
 * `POST /api/estate/seen` answers *"what may THIS PERSON spend on"*, and a cron
 * has no person: no request, no email, no session. ⚠️ Modelling it as
 * `everyone` would mean that switching the sweep off also switched the whole
 * household off, which is the opposite of what the owner would mean — so the
 * estate carries a fourth principal, `system`, and its own door:
 *
 *     GET /api/estate/billing/policy   Authorization: Bearer <this instance's
 *                                      ESTATE_APP_TOKEN_*, per ESTATE_APP>
 *     → { site, system_denied: string[], cache_seconds: 600 }
 *
 * ⚠️ THREE CALLERS, ONE RESOLVER (§3.4). This is not a second implementation of
 * the rules — the auth Worker resolves the same table through the same function
 * it uses for `/seen`. This presents a bearer and reads an array.
 *
 * 🔴 EVERY FAILURE IS `null`, AND `null` SWEEPS — §3.5 row 3's fail-open, the
 * same direction every other consumer takes. An unreachable directory must not
 * silently halt a pipeline nobody is watching; the wallet is bounded by
 * `SWEEP_LIMIT = 8`, not by this switch. Never throws: a scheduled invocation
 * has no response to put an error in.
 */
export async function fetchSystemDenied(
  env: Env,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string[] | null> {
  const baseUrl = (env.ESTATE_AUTH_URL ?? '').trim();
  // ⚠️ The bearer follows THIS instance's `ESTATE_APP`, resolved in one place
  // (`lib/estate-app.ts`). It used to be a hard-coded `ESTATE_APP_TOKEN_GAMES`
  // read, which would have made a second instance's cron present the FIRST
  // instance's badge at the system door — the same F-5 shape as the gate's.
  const identity = resolveEstateApp(env.ESTATE_APP);
  const token = estateAppToken(env, identity.tokenVar);
  if (!baseUrl || !token) {
    // Named rather than silent, for the same reason `estateGate` names its own
    // `config unset`: a half-configured gate that said nothing would read as
    // "nothing is denied", which is false comfort of exactly the kind shadow
    // mode exists to prevent.
    console.warn(
      `billing_policy: system door not configured for app '${identity.app ?? identity.invalid}' ` +
        `(need ESTATE_AUTH_URL [vars] + ${identity.tokenVar ?? 'a recognised ESTATE_APP'} secret) — ` +
        'treating the policy as unknown',
    );
    return null;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(`${baseUrl.replace(/\/+$/, '')}/api/estate/billing/policy`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      console.warn(`billing_policy: system door answered ${resp.status} — policy unknown`);
      return null;
    }
    const body: unknown = await resp.json();
    const raw = (body as { system_denied?: unknown } | null)?.system_denied;
    // ⚠️ Not an array is not an answer. Coercing a string into a one-element
    // deny-list would switch off a sweep nobody named.
    if (!Array.isArray(raw)) return null;
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return null;
  }
}
