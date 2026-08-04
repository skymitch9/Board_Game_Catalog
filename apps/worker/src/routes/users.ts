import { Hono } from 'hono';
import { capabilitiesFor, updateRoleSchema } from '@bgc/core';
import { countOwners, listUsers, setUserRole } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

export const userRoutes = new Hono<AppBindings>()
  /** Who am I and what may I do — the first call the web app makes. */
  .get('/me', (c) => {
    const user = c.get('user');
    return c.json({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      capabilities: capabilitiesFor(user.role),
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
