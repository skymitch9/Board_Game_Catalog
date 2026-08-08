import { Hono } from 'hono';
import { z } from 'zod';
import { addItemAlias, aliasCoverage, aliasesForItem, deleteItemAlias } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { RUN_BGG_CALLS, runAliasBackfill } from '../lib/alias-backfill.js';

/**
 * The other names a game answers to.
 *
 * Two ways in, and both are needed:
 *
 * | | |
 * |---|---|
 * | `POST /backfill` | BoardGameGeek's own alternate-name list, for the 128 rows that carry a `bgg_id` |
 * | `POST /items/:id` | a person, for everything else and for anything BGG has wrong |
 *
 * **The import is not sufficient on its own and the manual door is not a
 * fallback.** Most of this catalog has no BGG id, and a name search to find one
 * would reintroduce exactly the loose matching `item_alias` exists to avoid.
 * Equally, the import alone would be brittle: a re-run must never delete
 * something a person typed, which is why `replaceBggAliases` clears only
 * `source = 'bgg'`.
 *
 * Reading is deliberately *not* a route of its own for the scan path — that
 * reads the whole table in one go through `listItemAliases`, the same shape as
 * `listItemNames`. `GET /items/:id` here is for one game's own page.
 */

const backfillSchema = z.object({
  calls: z.coerce.number().int().min(1).max(RUN_BGG_CALLS).optional(),
  /** One game only, for an item page's "find other names". */
  itemId: z.coerce.number().int().positive().optional(),
});

const aliasSchema = z.object({
  alias: z.string().trim().min(2).max(200),
});

export const aliasRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  /** Coverage, and what is left — without spending a BoardGameGeek request. */
  .get('/status', async (c) => {
    return c.json({ coverage: await aliasCoverage(c.env.DB) });
  })

  .get('/items/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ aliases: await aliasesForItem(c.env.DB, id) });
  })

  /**
   * Record a name a person knows this game by.
   *
   * A repeat is a success, not a conflict — somebody typing the name they
   * already typed means the same thing the second time, and a 409 here would
   * only make the screen argue with them.
   */
  .post('/items/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = aliasSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const added = await addItemAlias(c.env.DB, id, parsed.data.alias, 'manual');
    return c.json({ added, aliases: await aliasesForItem(c.env.DB, id) });
  })

  .delete('/:aliasId', async (c) => {
    const aliasId = Number(c.req.param('aliasId'));
    if (!Number.isInteger(aliasId) || aliasId <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ deleted: await deleteItemAlias(c.env.DB, aliasId) });
  })

  /**
   * Import alternate names from BoardGameGeek.
   *
   * Answers with what it did rather than an ok, for the reason the component
   * backfill does: "it ran and stored nothing" and "it ran and stored sixty-one
   * names for Catan" are the two outcomes that must be distinguishable, and a
   * silent success is how a table sits empty for a month.
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
            'No BoardGameGeek API token configured, so there are no alternate names to import. Set BGG_API_TOKEN.',
        },
        502,
      );
    }

    const run = await runAliasBackfill(c.env.DB, token, {
      ...(parsed.data.calls != null ? { calls: parsed.data.calls } : {}),
      ...(parsed.data.itemId != null ? { itemId: parsed.data.itemId } : {}),
    });
    return c.json({ run });
  });
