import { Hono } from 'hono';
import { z } from 'zod';
import {
  componentCoverage,
  reclassifyStoredComponents,
  setComponentManualState,
} from '@bgc/db';
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

/**
 * `state: null` is the undo, and it is why this is nullable rather than a
 * separate delete route. `note` is only meaningful alongside a verdict; the
 * db layer drops it when the verdict is cleared, so a withdrawn claim cannot
 * leave its reasoning behind to be read as still true.
 */
const manualSchema = z.object({
  state: z.literal('have').nullable(),
  note: z.string().max(200).nullish(),
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
   * The owner saying "we have this" about a component with no row of its own.
   *
   * `PUT` rather than `POST`: setting the same verdict twice is the same
   * verdict, and the undo is the same route with `state: null` rather than a
   * second endpoint that could drift from this one.
   *
   * Deliberately **not** wired into `createItem`. Every other "I have it" path
   * makes a catalog row; this one exists precisely because a row would be a lie
   * — there is no separate product on the shelf to describe.
   */
  .put('/:id/manual', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'bad_request', detail: 'component id must be a positive integer' }, 400);
    }

    const parsed = manualSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const note = parsed.data.note?.trim();
    const changed = await setComponentManualState(
      c.env.DB,
      id,
      parsed.data.state,
      note ? note : null,
    );
    if (!changed) return c.json({ error: 'not_found' }, 404);
    return c.json({ id, state: parsed.data.state, note: note ?? null });
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
