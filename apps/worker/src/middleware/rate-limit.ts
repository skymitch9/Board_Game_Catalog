import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env.js';

/**
 * A per-IP rate limit on the unauthenticated surface.
 *
 * ## Why this exists now and did not before
 *
 * Cloudflare Access used to block unauthenticated traffic at the edge, so the
 * only requests this Worker ever saw came from someone already on an allowlist.
 * `catalog-platform/docs/PLATFORM.md` §4.1 accepted losing that knowingly, and
 * named this as one of three things required before the swap ships. With Access
 * gone the Worker answers anything on the internet, and two endpoints are
 * reachable without a valid token:
 *
 *   - `/api/health`, public by design so a deploy can be curled
 *   - every `/api/*` route's **token check**, which runs before the 401
 *
 * The second is the one that matters. Verifying a signature is real CPU, and an
 * attacker who cannot pass it can still make us try, which is a way to burn a
 * daily request budget without ever being logged in.
 *
 * ## Keyed on IP, and only for requests without a valid session
 *
 * The limit is applied before `requireAuth`, keyed on `CF-Connecting-IP`. A
 * signed-in household member sharing an IP with the other household member
 * would otherwise share a budget with them, so the ceiling is set high enough
 * that ordinary use — a collection page fanning out a dozen calls — never
 * approaches it. This is an anti-abuse floor, not a quota.
 *
 * ⚠️ **It fails OPEN if the binding is missing**, which is a deliberate trade.
 * A misconfigured binding failing closed would take the entire catalog down for
 * the household to prevent an abuse that is hypothetical; failing open returns
 * to exactly the behaviour of the last year, and says so in the log. The
 * binding is optional in `Env` for the same reason: `wrangler dev` without it
 * should run the app, not refuse to start.
 */

/** Cloudflare's rate-limiting binding. Not yet in @cloudflare/workers-types. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function rateLimit(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const limiter = c.env.RATE_LIMITER;
    if (!limiter) {
      // Once per isolate is plenty; this is a config error, not a request error.
      if (!warned) {
        warned = true;
        console.warn('RATE_LIMITER binding missing — unauthenticated surface is unthrottled');
      }
      return next();
    }

    // CF-Connecting-IP is set by Cloudflare on every request that reaches a
    // Worker and cannot be spoofed by the client — unlike X-Forwarded-For,
    // which is client-supplied and would make the limit trivially bypassable.
    const ip = c.req.header('CF-Connecting-IP');
    // No IP means this is not a request that arrived through the edge — a test,
    // or `wrangler dev`. Limiting on a constant key would make every local
    // request share one bucket and throttle development.
    if (!ip) return next();

    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      return c.json(
        { error: 'rate_limited', detail: 'Too many requests. Wait a moment and try again.' },
        429,
      );
    }
    await next();
  };
}

let warned = false;
