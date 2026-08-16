import { Hono } from 'hono';
import { canGrantRole, capabilitiesFor, updateRoleSchema } from '@bgc/core';
import { countOwners, listUsers, setUserRole } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { outstandingChores } from '../lib/chores.js';
import { requireCapability } from '../middleware/auth.js';

export const userRoutes = new Hono<AppBindings>()
  /**
   * Who am I, what may I do, and is there anything waiting — the first call the
   * web app makes, and the only one it makes before drawing the nav.
   *
   * The chores count rides along rather than on routes of its own; see
   * `lib/chores.ts` for why, and for why a failure answers `null` instead of
   * throwing. Nothing here is worth failing sign-in over.
   */
  .get('/me', async (c) => {
    const user = c.get('user');
    const capabilities = capabilitiesFor(user.role);
    // Either capability earns the set: two of the three counts are catalog
    // maintenance, the third is "somebody is waiting to be let in". See
    // `lib/chores.ts` for why this is a union rather than `editCatalog` alone.
    const chores =
      capabilities.includes('editCatalog') || capabilities.includes('manageUsers')
        ? await outstandingChores(c.env.DB).catch(() => null)
        : null;
    return c.json({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      capabilities,
      chores,
    });
  })

  .get('/users', requireCapability('manageUsers'), async (c) => {
    return c.json({ users: await listUsers(c.env.DB) });
  })

  /** Approve a pending user, or change someone's role. */
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

    // The escalation limit: `manageUsers` alone would let an `admin` mint
    // another `admin` or an `owner`. `canGrantRole` refuses that — only
    // `owner` may grant `admin` or `owner` — while leaving every ordinary
    // approval and demotion untouched. See its own comment in
    // packages/core/src/capabilities.ts for the full rule.
    if (!canGrantRole(actor.role, parsed.data.role)) {
      return c.json(
        {
          error: 'forbidden',
          detail: `Your role (${actor.role}) may not grant '${parsed.data.role}'.`,
        },
        403,
      );
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
    return c.json({ user: updated });
  });
