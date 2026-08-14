/**
 * The federated-admin surface — this app's own roles, exposed to the estate's
 * one admin page (heygabi.ai/admin; estate-auth-design.md §4.5's "later, a
 * federated admin view").
 *
 * ## Federation, not centralization
 *
 * ⚠️ Roles are THIS app's. The endpoint exposes the vocabulary verbatim
 * (`owner | manager | rater | viewer | pending` — the rater/viewer split is
 * the whole difference between the two read-capable guest roles, built by
 * migrations 0023/0024 on purpose) and validates writes against it; nothing
 * here lets the estate redefine a games role or grant one the games catalog
 * would not. The gate is this app's own `manageUsers` capability —
 * owner-only — evaluated by the same `requireAuth` + `requireCapability`
 * chain as the in-app People page, on the caller's own Firebase bearer. The
 * admin page holds no credential of its own: if the signed-in person could
 * not change roles here, they cannot change them from there either. The rate
 * limiter and the OWNER_EMAILS recovery hatch stay in front, untouched —
 * this mounts behind both.
 *
 * ## Why a second mount beside /api/users
 *
 * Same data, same gate, one difference: CORS. The in-app People page is
 * same-origin and must stay CORS-free; this surface is called cross-origin
 * from exactly `https://heygabi.ai` (the auth Worker's admin API pattern —
 * locked list, not a wildcard). A separate mount keeps the browser-reachable
 * cross-origin surface enumerable: it is this file, and nothing else.
 *
 * (No change_log here — this catalog has no audit table; role changes stamp
 * approved_at/approved_by as they always have. The library twin of this file
 * additionally audits, because there the table exists.)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ROLES, updateRoleSchema } from '@bgc/core';
import { countOwners, listUsers, setUserRole } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * The one origin whose pages may call this surface. A constant, not an env
 * var, on purpose: the estate has exactly one admin page (owner decision #6),
 * and a config knob would be a second place for the answer to live.
 */
export const ADMIN_PAGE_ORIGIN = 'https://heygabi.ai';

/**
 * Mounted in index.ts on `/api/admin/*` BEFORE the blanket `requireAuth`,
 * because a preflight OPTIONS carries no Authorization header — the blanket
 * would 401 it and the browser would never send the real request. The cors
 * middleware answers the preflight itself; actual GET/PATCH requests fall
 * through it to `requireAuth` unchanged.
 */
export function adminCors() {
  return cors({
    origin: ADMIN_PAGE_ORIGIN,
    allowMethods: ['GET', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

export const adminRoutes = new Hono<AppBindings>()
  /**
   * The member list as the federated page needs it: id (the PATCH address),
   * email (the estate's join key), role — plus the app's own role vocabulary
   * so the page's dropdown is populated from here, verbatim, rather than
   * hardcoded somewhere it could drift.
   */
  .get('/users', requireCapability('manageUsers'), async (c) => {
    const users = await listUsers(c.env.DB);
    return c.json({
      app: 'games',
      roles: ROLES,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
      })),
    });
  })

  /**
   * Same contract as the People page's PATCH /api/users/:id/role (routes/
   * users.ts) — same schema, same last-owner guard, same `setUserRole` write
   * path.
   */
  .patch('/users/:id/role', requireCapability('manageUsers'), async (c) => {
    const actor = c.get('user');
    const userId = Number(c.req.param('id'));
    if (!Number.isInteger(userId)) {
      return c.json({ error: 'bad_request', detail: 'user id must be an integer' }, 400);
    }

    const parsed = updateRoleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    // Don't let the last owner demote themselves and lock everyone out.
    if (userId === actor.id && parsed.data.role !== 'owner') {
      if ((await countOwners(c.env.DB)) <= 1) {
        return c.json(
          { error: 'bad_request', detail: 'you are the only owner — promote someone else first' },
          400,
        );
      }
    }

    const updated = await setUserRole(c.env.DB, {
      userId,
      role: parsed.data.role,
      approvedBy: actor.id,
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
      },
    });
  });
