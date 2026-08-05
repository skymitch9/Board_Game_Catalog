import { Hono } from 'hono';
import { z } from 'zod';
import { countItemsNeedingBggEditions, recordCampaignCovers } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { BACKFILL_LIMIT, runEditionBackfill } from '../lib/edition-backfill.js';

/**
 * Populating `edition` — the printings the cover picker chooses between.
 *
 * Both routes write rows, so both are `editCatalog`. Both are idempotent and
 * meant to be re-run: the BoardGameGeek one because items keep gaining a
 * `bgg_id`, the campaign one because covers are still being written elsewhere.
 *
 * Reading the candidates back is `GET /api/items/:id/covers`, which lives with
 * the rest of the catalog because it is browsing.
 */

const backfillSchema = z.object({
  limit: z.coerce.number().int().min(1).max(BACKFILL_LIMIT).optional(),
  /** Re-ask about items whose printings are already recorded. */
  force: z.coerce.boolean().optional(),
  /** One item only — the per-item button on the cover picker. */
  itemId: z.coerce.number().int().positive().optional(),
});

export const editionRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  /** How much is left to do, without spending a BoardGameGeek request to find out. */
  .get('/status', async (c) => {
    return c.json({ itemsAwaitingPrintings: await countItemsNeedingBggEditions(c.env.DB) });
  })

  /**
   * Fetch printings from BoardGameGeek for every item with a `bgg_id`.
   *
   * Batched ten ids to a request and throttled by the client itself. Answers
   * with what it did rather than just an ok, because "it ran and changed
   * nothing" and "it ran and added 300 printings" need telling apart — a silent
   * success is how the empty `edition` table went unnoticed for a month.
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
            'No BoardGameGeek API token configured, so there are no printings to fetch. Set BGG_API_TOKEN.',
        },
        502,
      );
    }

    const run = await runEditionBackfill(c.env.DB, token, {
      ...(parsed.data.limit != null ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.force != null ? { force: parsed.data.force } : {}),
      ...(parsed.data.itemId != null ? { itemId: parsed.data.itemId } : {}),
    });
    return c.json({ run });
  })

  /**
   * Record every non-BoardGameGeek cover as a printing of its own.
   *
   * A cover that is not on `cf.geekdo-images.com` came from a crowdfunding page
   * and exists nowhere else. Written down as an edition, swapping to a retail
   * cover becomes reversible; left alone, picking one destroys the other.
   */
  .post('/campaign', async (c) => {
    return c.json({ run: await recordCampaignCovers(c.env.DB) });
  });
