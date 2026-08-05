import { Hono } from 'hono';
import { z } from 'zod';
import { coverHealth } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { COVER_BATCH, runCoverCheck } from '../lib/cover-check.js';

/**
 * Cover-image health.
 *
 * Reading the verdict is browsing — anyone who can see the collection can see
 * that some of its pictures are broken — so `/health` needs only `read`.
 * Running a check makes outbound requests and writes rows, so it is
 * `editCatalog`, like every other write.
 */

const runSchema = z.object({
  /**
   * Capped, not merely defaulted. A forced check is the natural place for
   * somebody to type a large number, and the subrequest ceiling does not care
   * that the request was deliberate.
   */
  limit: z.coerce.number().int().min(1).max(COVER_BATCH * 2).default(COVER_BATCH),
});

export const coverRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('read'))

  .get('/health', async (c) => {
    return c.json({ health: await coverHealth(c.env.DB) });
  })

  /** Force a slice now, rather than waiting for the cron. Also how it is tested. */
  .post('/check', requireCapability('editCatalog'), async (c) => {
    const parsed = runSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const run = await runCoverCheck(c.env.DB, parsed.data.limit);
    return c.json({ run, health: await coverHealth(c.env.DB) });
  });
