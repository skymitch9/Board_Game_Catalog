import type { MiddlewareHandler } from 'hono';
import { can, type Capability } from '@bgc/core';
import { upsertUserOnLogin } from '@bgc/db';
import { estateSignInRefusal, resolveIdentity, type Identity } from '../estate-auth/index.js';
import { estateGate } from './estate.js';
import { parseOwnerEmails, type AppBindings } from '../env.js';

/**
 * Firebase Auth (Google SSO) authenticates; this file authorizes.
 *
 * ## ⚠️ Why this moved off Cloudflare Access — the thing to understand first
 *
 * Access authenticated at the **edge**, before any of this code ran. That was
 * cheap and strong, and it had one fatal property: it was a second, unrelated
 * allowlist. A person had to be named in a Cloudflare policy before the app
 * could so much as tell them they were `pending`, which made the whole
 * owner/rater/viewer/pending model unreachable for anyone not already let in.
 * Letting somebody see the collection meant editing a Cloudflare policy — the
 * exact job `app_user.role` exists to do.
 *
 * It was also a *different* Google SSO from the one the sibling catalogs use,
 * so the same human signing into `boardgames.` and `library.` was two records
 * with no way to tell they were one person. `catalog-platform/docs/PLATFORM.md`
 * §4 chose Firebase ID tokens for both Workers for that reason.
 *
 * ⚠️ **The Worker is now the only gate.** Nothing stops an unauthenticated
 * request before `requireAuth` does. That is why `index.ts` mounts it as a
 * blanket `app.use('/api/*', …)` rather than per-route, and why every route
 * beyond it still carries its own `requireCapability`.
 *
 * ## Where the verifier went (2026-08-13)
 *
 * Token verification itself — JWKS, iss+aud pinned to FIREBASE_PROJECT_ID,
 * unverified-email refusal, the hardened `ENVIRONMENT === 'development'` dev
 * bypass — moved to the canonical `estate-auth` module
 * (catalog-platform/packages/estate-auth, materialised into ../estate-auth/ by
 * scripts/sync-estate-auth.mjs). ⚠️ The canonical implementation IS this
 * file's old code: the hardened bypass shape was written here first
 * (estate-auth-design.md §1.1 tells the drift story that made one copy the
 * rule), so the swap changes behaviour not at all — it changes where a future
 * fix lands. Do not reintroduce a local verifier beside it.
 *
 * ## The estate check (2026-08-13, design §14.5)
 *
 * After local identity and the local app_user row resolve, `estateGate` runs
 * the membership protocol at the strength `ESTATE_CHECK` allows — `off`
 * (default, inert), `shadow` (log the §3.1 would-verdict, change nothing), or
 * `enforce`. See middleware/estate.ts for the whole story, including what it
 * deliberately does not touch: the OWNER_EMAILS recovery hatch below runs
 * before it, and the rate limiter runs in front of everything.
 */

/** Verifies identity and attaches the catalog user to the request context. */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity: Identity | null;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }

    // KI-6, closed 2026-09-06. This answered the bare 27-byte
    // `{"error":"unauthenticated"}` — no sentence, no route back — which is the
    // bare status the estate's standing rule forbids. ⚠️ The `error` CODE is
    // untouched: `tools/estate-probes`' board suite asserts it and the apex's
    // `assets/estate-search.js` branches on the same string, so this is purely
    // ADDITIVE. The WORDS come from the canonical module rather than being
    // written here, because KI-6 said in as many words that this is an
    // estate-wide shape — `library_catalog` had the identical line and the
    // index Worker a third — and six hand-written sentences for one refusal is
    // the drift a shared module exists to prevent.
    if (!identity) {
      return c.json(estateSignInRefusal('the board-game catalog'), 401);
    }

    // Local authorization first, untouched — including the OWNER_EMAILS
    // recovery hatch inside upsertUserOnLogin. The estate never runs before
    // the way back in.
    const user = await upsertUserOnLogin(c.env.DB, {
      email: identity.email,
      displayName: identity.name,
      ownerEmails: parseOwnerEmails(c.env.OWNER_EMAILS),
    });

    // Estate membership (design §3.1/§5.2). In `off` this is a no-op; in
    // `shadow` it logs and never returns a Response; only `enforce` can refuse.
    const refused = await estateGate(c, identity, user);
    if (refused) return refused;

    c.set('user', user);
    await next();
  };
}

/**
 * Gate a route on a capability rather than a role, so adding a role later
 * doesn't mean auditing every route.
 */
export function requireCapability(capability: Capability): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get('user');
    if (!can(user.role, capability)) {
      return c.json(
        {
          error: 'forbidden',
          capability,
          role: user.role,
          detail:
            user.role === 'pending'
              ? 'Your account is awaiting approval by an owner.'
              : 'Your role does not permit this action.',
        },
        403,
      );
    }
    await next();
  };
}
