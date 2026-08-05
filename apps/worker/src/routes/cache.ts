import { Hono } from 'hono';
import { z } from 'zod';
import { cacheStats, clearCache } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Cache maintenance.
 *
 * Every row behind these routes is "we asked the internet this before" — never
 * catalog data — so clearing is cheap and safe: the worst outcome is paying for
 * a lookup again. That is deliberately different from anything under /api/items,
 * and it is why this can be a button rather than a support request.
 *
 * Gated on `manageUsers` rather than `editCatalog`: it is an operator action, and
 * whoever can promote people is the person who should be poking at internals.
 */

const targetSchema = z.object({
  target: z.enum(['all', 'lookups', 'photos']).default('all'),
});

export const cacheRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('manageUsers'))

  .get('/', async (c) => c.json({ stats: await cacheStats(c.env.DB) }))

  .delete('/', async (c) => {
    const parsed = targetSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const removed = await clearCache(c.env.DB, parsed.data.target);
    return c.json({ removed, stats: await cacheStats(c.env.DB) });
  });
