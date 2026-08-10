import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { can, type Capability } from '@bgc/core';
import { upsertUserOnLogin } from '@bgc/db';
import { parseOwnerEmails, type AppBindings, type Env } from '../env.js';

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
 * ## What is verified
 *
 * A Firebase ID token is an RS256 JWT signed by Google:
 *
 *     iss  https://securetoken.google.com/<projectId>
 *     aud  <projectId>
 *     sub  the Firebase uid
 *     keys https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 *
 * `jose` handles rotation, expiry and signature. What it cannot check is that
 * the token came from the *right* project — any Firebase project's tokens are
 * validly signed by Google. So `FIREBASE_PROJECT_ID` is asserted as both
 * `issuer` and `audience`, and a token minted by any other project fails closed.
 *
 * ⚠️ Removing either assertion turns this into "any Google user of any Firebase
 * app on the internet", which is not a smaller check — it is no check.
 */

interface Identity {
  email: string;
  name: string | null;
}

// Cached per isolate: the JWKS client refetches on rotation by itself, and
// building one per request would add a round trip to every call.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    );
  }
  return jwksCache;
}

function readBearer(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

async function resolveIdentity(req: Request, env: Env): Promise<Identity | null> {
  // Local development bypass. Triple-gated: the variable must be set, the
  // environment must be exactly "development", and production sets ENVIRONMENT
  // explicitly in wrangler.toml.
  //
  // ⚠️ This used to test `!== 'production'`, which meant any unrecognised value
  // — a typo, a new named environment, an unset var in some future preview lane
  // — silently enabled it. That was survivable while Access stood in front. It
  // is not now: this is the only thing between DEV_EMAIL and a real session.
  if (env.ENVIRONMENT === 'development' && env.DEV_EMAIL) {
    return { email: env.DEV_EMAIL, name: 'Local Dev' };
  }

  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not set (docs/SETUP.md step 7).');
  }

  const token = readBearer(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    if (!email) return null;

    // A Google account whose email is unverified is not an identity. Firebase
    // will mint a token for one, and email is both our primary key in app_user
    // and the join to the sibling catalogs — so refusing is the difference
    // between "cannot sign in" and "signed in as somebody else".
    if (payload['email_verified'] === false) return null;

    const name = typeof payload['name'] === 'string' ? payload['name'] : null;
    return { email, name };
  } catch {
    // Expired, wrong audience, bad signature, wrong project — all the same here.
    return null;
  }
}

/** Verifies identity and attaches the catalog user to the request context. */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity: Identity | null;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }

    if (!identity) {
      return c.json({ error: 'unauthenticated' }, 401);
    }

    const user = await upsertUserOnLogin(c.env.DB, {
      email: identity.email,
      displayName: identity.name,
      ownerEmails: parseOwnerEmails(c.env.OWNER_EMAILS),
    });

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
