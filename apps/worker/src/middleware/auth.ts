import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { can, type Capability } from '@bgc/core';
import { upsertUserOnLogin } from '@bgc/db';
import { parseOwnerEmails, type AppBindings, type Env } from '../env.js';

/**
 * Cloudflare Access authenticates (Google SSO); this file authorizes.
 *
 * Access puts a signed JWT on every request that reaches the Worker. We verify
 * it against Cloudflare's rotating public keys, pull the verified email out,
 * and look that email up in app_user to decide what the person may do.
 */

interface Identity {
  email: string;
  name: string | null;
}

// The JWKS client caches keys in memory and refetches on rotation, so it is
// built once per isolate rather than per request.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheDomain = '';

function getJwks(teamDomain: string) {
  if (!jwksCache || jwksCacheDomain !== teamDomain) {
    jwksCache = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCacheDomain = teamDomain;
  }
  return jwksCache;
}

/** Accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". */
function normalizeTeamDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function readAccessToken(req: Request): string | null {
  const header = req.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;

  const cookie = req.headers.get('Cookie');
  if (!cookie) return null;
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match?.[1] ?? null;
}

async function resolveIdentity(req: Request, env: Env): Promise<Identity | null> {
  // Local development bypass. Double-gated: the variable must be set AND the
  // environment must not be production.
  if (env.ENVIRONMENT !== 'production' && env.DEV_EMAIL) {
    return { email: env.DEV_EMAIL, name: 'Local Dev' };
  }

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? '');

  // Cloudflare mints a separate Access application — and therefore a separate
  // audience — for the production URL and for preview URLs. Accept a
  // comma-separated list so a token from either is valid.
  const audiences = (env.CF_ACCESS_AUD ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (!teamDomain || audiences.length === 0) {
    throw new Error(
      'Access is not configured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (docs/SETUP.md step 7).',
    );
  }

  const token = readAccessToken(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: audiences,
    });
    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    if (!email) return null;
    const name = typeof payload['name'] === 'string' ? payload['name'] : null;
    return { email, name };
  } catch {
    // Expired, wrong audience, bad signature — all the same to us.
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
