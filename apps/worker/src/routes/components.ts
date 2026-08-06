import { Hono } from 'hono';
import { z } from 'zod';
import { componentCoverage, reclassifyStoredComponents } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { RUN_BGG_CALLS, runComponentBackfill } from '../lib/component-backfill.js';

/**
 * Populating `game_component` — what BoardGameGeek says exists for our games.
 *
 * A route rather than a script for the same reason the edition backfill is one:
 * it needs re-running. Items keep gaining a `bgg_id`, and — more to the point —
 * publishers keep announcing expansions for games already on the shelf. The
 * weekly cron calls exactly this code path, so a forced run here proves the
 * scheduled one works.
 *
 * Reading the answer back is `GET /api/items/:id/completeness`, which lives
 * with the rest of the catalog because it is browsing.
 */

const backfillSchema = z.object({
  /** BoardGameGeek calls this run may make. The subrequest budget, in effect. */
  calls: z.coerce.number().int().min(1).max(RUN_BGG_CALLS).optional(),
  /** Re-sweep games checked inside the refresh window. */
  force: z.coerce.boolean().optional(),
  /** One game only — the item page's "Check now". */
  itemId: z.coerce.number().int().positive().optional(),
});

export const componentRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  /** Coverage, and what is left — without spending a BoardGameGeek request. */
  .get('/status', async (c) => {
    return c.json({ coverage: await componentCoverage(c.env.DB) });
  })

  /**
   * Sweep games for their component lists, then classify components.
   *
   * Answers with what it did rather than an ok. "It ran and changed nothing"
   * and "it ran and found four expansions you do not have" are the two things
   * this must be able to tell apart — a silent success is how the `edition`
   * table sat empty for a month without anybody noticing.
   */
  .post('/backfill', async (c) => {
    const parsed = backfillSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const token = c.env.BGG_API_TOKEN ?? '';
    if (!token) {
      return c.json(
        {
          error: 'upstream',
          detail:
            'No BoardGameGeek API token configured, so there is nothing to compare your collection against. Set BGG_API_TOKEN.',
        },
        502,
      );
    }

    const run = await runComponentBackfill(c.env.DB, token, {
      ...(parsed.data.calls != null ? { calls: parsed.data.calls } : {}),
      ...(parsed.data.force != null ? { force: parsed.data.force } : {}),
      ...(parsed.data.itemId != null ? { itemId: parsed.data.itemId } : {}),
    });
    return c.json({ run });
  })

  /**
   * Re-decide official versus third-party from stored publishers.
   *
   * Free — no BoardGameGeek call at all. This is the reason the publisher lists
   * are columns rather than transients: if the rule changes, or a list is
   * corrected by hand, one request makes every row agree again.
   */
  .post('/reclassify', async (c) => {
    const itemId = Number(c.req.query('itemId'));
    const scoped = Number.isInteger(itemId) && itemId > 0 ? itemId : undefined;
    return c.json({ updated: await reclassifyStoredComponents(c.env.DB, scoped) });
  });
