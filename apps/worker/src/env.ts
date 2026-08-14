import type { AppUser } from '@bgc/core';
import type { RateLimiter } from './middleware/rate-limit.js';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

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
}

export type AppBindings = { Bindings: Env; Variables: Variables };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
