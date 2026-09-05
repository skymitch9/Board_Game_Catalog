import type { AppUser } from '@bgc/core';
import type { RateLimiter } from './middleware/rate-limit.js';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /**
   * `game-covers` — rehosted covers, ported from library_catalog's
   * `library-covers` pattern. See packages/core/src/covers.ts for the
   * verify/hash/key rules and lib/cover-storage.ts for the upload path.
   *
   * "Both, or neither" with COVERS_BASE_URL below: a route that reads one
   * without the other is a misconfiguration, not a fallback to a hotlink.
   */
  COVERS?: R2Bucket;
  /** The bucket's public custom domain — https://gamecovers.heygabi.ai. */
  COVERS_BASE_URL?: string;

  /**
   * Per-IP throttle on the unauthenticated surface — see middleware/rate-limit.ts.
   *
   * Optional so `wrangler dev` without the binding still starts. The middleware
   * fails open and warns rather than refusing traffic.
   */
  RATE_LIMITER?: RateLimiter;

  APP_VERSION: string;
  ENVIRONMENT: string;

  /** Comma-separated emails seeded as `owner` on first sign-in. */
  OWNER_EMAILS: string;

  /**
   * The Firebase project whose ID tokens this Worker accepts, asserted as both
   * `iss` and `aud` in middleware/auth.ts.
   *
   * ⚠️ Must stay `audiobook-catalog` and must match the web app's
   * `firebaseConfig.projectId`, or every request 401s. Sharing the project with
   * the audiobook and library catalogs is the point: one Google account is one
   * person across all three, which is why this replaced Cloudflare Access.
   */
  FIREBASE_PROJECT_ID: string;

  /**
   * @deprecated Cloudflare Access no longer authenticates this Worker —
   * middleware/auth.ts verifies Firebase ID tokens instead.
   *
   * These stay declared, and stay set in wrangler.toml, only until the Access
   * application is deleted. Access is still in front of the Worker during the
   * cutover, and deleting the application is the last step, not the first. Once
   * it is gone, remove these two fields and their `[vars]` entries together.
   */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** @deprecated See CF_ACCESS_TEAM_DOMAIN. */
  CF_ACCESS_AUD?: string;

  /**
   * BoardGameGeek application token. BGG began requiring registration and
   * bearer tokens on its XML API in July 2025, so lookup is unavailable until
   * this is set. Stored as a secret (`wrangler secret put BGG_API_TOKEN`),
   * never in wrangler.toml.
   */
  BGG_API_TOKEN?: string;

  /**
   * Anthropic API key for the research pipeline. Set as a secret
   * (`wrangler secret put ANTHROPIC_API_KEY`), never in wrangler.toml — that
   * file is committed.
   */
  ANTHROPIC_API_KEY?: string;

  /**
   * GameUPC production key — a free board-game barcode database that answers
   * with BoardGameGeek ids. Request one by emailing gameupc@grettir.org.
   *
   * Optional by design: with no key set, lookups fall back to GameUPC's public
   * `test` stage using their published demo key, so barcode scanning works
   * (against periodically-wiped data) before the real key arrives.
   */
  GAMEUPC_API_KEY?: string;
  /** `test` | `dev` | `v1`. Defaults to `v1` when a key is set, `test` otherwise. */
  GAMEUPC_STAGE?: string;

  /**
   * The shared index Worker (catalog-platform/apps/index-worker) — where this
   * catalog pushes its projection. See lib/index-push.ts.
   *
   * ⚠️ Both optional, and unset in production ON PURPOSE until the owner
   * deploys the index Worker (its open read-auth question, index-worker-design
   * §9 Q3, gates that deploy). Unset means every push trigger logs one line
   * and does nothing — the index must never be able to stall this catalog.
   * When the index goes live: set INDEX_URL in wrangler.toml [vars] and
   * `wrangler secret put INDEX_PUSH_TOKEN` (the same value the index holds as
   * its INDEX_PUSH_TOKEN_GAME secret).
   */
  INDEX_URL?: string;
  INDEX_PUSH_TOKEN?: string;

  /**
   * Estate auth (catalog-platform/docs/info/estate-auth-design.md, adopted
   * per §14.5): `off` | `shadow` | `enforce`.
   *
   * `off` (the default, and what any unrecognised value falls to): the estate
   * check does not run at all — no /seen call, no logs, no cache writes; the
   * deploy carrying this code is inert. `shadow`: the full check runs and logs
   * the §3.1 would-verdict (grep the tail for `WOULD-DENY`) but no response
   * changes. `enforce`: revocations 403, estate-wide approvals default-grant
   * `viewer`. Flip off→shadow→enforce deliberately, days apart, per §9 step 6.
   */
  ESTATE_CHECK?: string;

  /** The estate directory, e.g. https://auth.heygabi.ai — [vars], committed. */
  ESTATE_AUTH_URL?: string;

  /**
   * The SPENDING posture — `off` | `shadow` | `enforce`, the exact idiom of
   * `ESTATE_CHECK` above and coerced the same way (billing design §4). See
   * `lib/billing-gate.ts`.
   *
   *   off      nothing resolves, nothing is logged, nothing costs
   *   shadow   the decision is logged with `proceeded`, and the call bills
   *   enforce  a denied path is refused, in words
   *
   * ⚠️ **It is NOT `ESTATE_CHECK`.** That flag answers *"is this person still a
   * member"*; this one answers *"may this person spend"*. `ESTATE_CHECK` being
   * `enforce` does not make this one enforce, and it must not be assumed to.
   *
   * ⚠️ Ships `"off"`, and flipping is the evidence-gated step (§4.2), never a
   * side effect of an unrelated deploy.
   */
  BILLING_POLICY?: string;

  /**
   * WHICH estate consumer this Worker is — `games` (the main instance and the
   * default when unset) or `games2` (the slot for a second instance). Set in
   * `[vars]` per wrangler env; it is config of record, never a secret.
   *
   * ⚠️ Until 2026-09-05 there was no such var: the id was declared in
   * `middleware/estate.ts` and the bearer read as a fixed
   * `ESTATE_APP_TOKEN_GAMES`, so a second instance would have silently asserted
   * the FIRST one's identity — the bug `library_catalog` shipped and ran with
   * for months (estate credentials catalog F-5). Resolution, the allowlist and
   * the build guard live in `lib/estate-app.ts`; nothing else may read a bearer
   * by name.
   */
  ESTATE_APP?: string;

  /**
   * This app's own bearer for POST /api/estate/seen — the same value the auth
   * Worker holds under the SAME NAME. Set with
   * `npm run secret ESTATE_APP_TOKEN_GAMES`, never in wrangler.toml. Absent
   * (with ESTATE_CHECK=shadow/enforce) the check logs `config unset` and
   * skips — behaving as `off`, visibly.
   *
   * ⚠️ Read only through `estateAppToken()` in `lib/estate-app.ts`, which picks
   * the slot from `ESTATE_APP`. Reading it directly is how one instance ends up
   * presenting another's badge.
   */
  ESTATE_APP_TOKEN_GAMES?: string;

  /**
   * The SECOND instance's bearer, paired with `ESTATE_APP = "games2"`. Declared
   * ahead of the instance existing so the identity is config the day a fork
   * happens — no Worker holds a value for it today, and a `[env.games2]` block
   * does not exist yet (`docs/access/second-instance.md`).
   */
  ESTATE_APP_TOKEN_GAMES2?: string;

  /**
   * Local development only. Ignored unless ENVIRONMENT is exactly
   * "development", so a stray value in production vars cannot mint a session.
   *
   * ⚠️ That sentence was true of the comment but not of the code until
   * 2026-08-10: `auth.ts` tested `ENVIRONMENT !== 'production'`, so **any**
   * other value — a typo, an unset var, some future preview lane — enabled the
   * bypass. Access covered for it. Nothing covers for it now, so the check is
   * an equality test and this comment finally describes it.
   */
  DEV_EMAIL?: string;
}

/** Values attached to the request context by middleware. */
export interface Variables {
  user: AppUser;
  /**
   * The money-path ids this person may NOT spend on, on the `games` site — the
   * cached `/seen` answer's billing half, put here by the estate gate and read
   * by `lib/billing-gate.ts` (billing design §3.4).
   *
   * 🔴 `null` is UNKNOWN and proceeds; `[]` is "the directory denied nothing";
   * `undefined` is a request the estate gate never ran for. All three proceed,
   * and only `[]` proceeds because an answer said so.
   */
  billingDenied?: string[] | null;
}

export type AppBindings = { Bindings: Env; Variables: Variables };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
