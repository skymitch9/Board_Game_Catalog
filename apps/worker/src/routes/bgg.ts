import { Hono } from 'hono';
import { z } from 'zod';
import { ITEM_KINDS } from '@bgc/core';
import { BggError, kindForBggType, search, thing, things } from '@bgc/bgg';
import { importItem, knownBggIds } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * BoardGameGeek resolution.
 *
 * BGG establishes *identity* - which game this actually is, and which printings
 * exist - far more cheaply and reliably than an LLM can, so it runs first.
 * Nothing here writes to the catalog without a human picking from the results
 * (see docs/DESIGN.md section 4).
 *
 * Requires a BGG application token since July 2025; without BGG_API_TOKEN set,
 * every route here answers 502 with an explanation rather than failing oddly.
 */

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'search for at least two characters').max(200),
  types: z.string().optional(),
});

const importSchema = z.object({
  bggId: z.number().int().positive(),
  kind: z.enum(ITEM_KINDS).optional(),
  parentItemId: z.number().int().positive().nullable().optional(),
  includeEditions: z.boolean().default(true),
});

const bulkImportSchema = z.object({
  items: z.array(importSchema).min(1).max(25),
});

function handleBggError(err: unknown) {
  if (err instanceof BggError) {
    return { error: 'upstream', detail: err.message, status: err.status };
  }
  return null;
}

export const bggRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  /** Candidates for a typed name. The human picks; nothing is written. */
  .get('/search', async (c) => {
    const parsed = searchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    try {
      const results = await search(c.env.BGG_API_TOKEN ?? '', parsed.data.q);
      const known = await knownBggIds(
        c.env.DB,
        results.map((r) => r.bggId),
      );
      return c.json({
        results: results.map((r) => ({ ...r, alreadyInCatalog: known.has(r.bggId) })),
      });
    } catch (err) {
      const mapped = handleBggError(err);
      if (mapped) return c.json({ error: mapped.error, detail: mapped.detail }, 502);
      throw err;
    }
  })

  /** Full detail for one game, including printings and linked expansions. */
  .get('/things/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'bad_request', detail: 'invalid BGG id' }, 400);
    }

    try {
      const found = await thing(c.env.BGG_API_TOKEN ?? '', id);
      if (!found) return c.json({ error: 'not_found' }, 404);

      const relatedIds = found.related.map((r) => r.bggId);
      const known = await knownBggIds(c.env.DB, [found.bggId, ...relatedIds]);

      return c.json({
        thing: {
          ...found,
          alreadyInCatalog: known.has(found.bggId),
          related: found.related.map((r) => ({ ...r, alreadyInCatalog: known.has(r.bggId) })),
        },
      });
    } catch (err) {
      const mapped = handleBggError(err);
      if (mapped) return c.json({ error: mapped.error, detail: mapped.detail }, 502);
      throw err;
    }
  })

  /** Pull a confirmed pick into the catalog. Idempotent on the BGG id. */
  .post('/import', async (c) => {
    const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    try {
      const found = await thing(c.env.BGG_API_TOKEN ?? '', parsed.data.bggId);
      if (!found) return c.json({ error: 'not_found', detail: 'no such game on BGG' }, 404);

      const result = await importItem(c.env.DB, {
        data: found,
        kind: parsed.data.kind ?? kindForBggType(found.type),
        parentItemId: parsed.data.parentItemId ?? null,
        includeEditions: parsed.data.includeEditions,
      });
      return c.json(result, result.created ? 201 : 200);
    } catch (err) {
      const mapped = handleBggError(err);
      if (mapped) return c.json({ error: mapped.error, detail: mapped.detail }, 502);
      throw err;
    }
  })

  /**
   * Import several at once - the "I picked six expansions" case. One BGG call
   * for all of them rather than one each, because the throttle makes serial
   * lookups slow.
   */
  .post('/import-many', async (c) => {
    const parsed = bulkImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    try {
      const wanted = parsed.data.items;
      const found = await things(c.env.BGG_API_TOKEN ?? '', wanted.map((w) => w.bggId));
      const byId = new Map(found.map((f) => [f.bggId, f]));

      const imported = [];
      const missing: number[] = [];

      for (const w of wanted) {
        const data = byId.get(w.bggId);
        if (!data) {
          missing.push(w.bggId);
          continue;
        }
        imported.push(
          await importItem(c.env.DB, {
            data,
            kind: w.kind ?? kindForBggType(data.type),
            parentItemId: w.parentItemId ?? null,
            includeEditions: w.includeEditions,
          }),
        );
      }

      return c.json({
        imported,
        missing,
        created: imported.filter((i) => i.created).length,
        skipped: imported.filter((i) => !i.created).length,
      });
    } catch (err) {
      const mapped = handleBggError(err);
      if (mapped) return c.json({ error: mapped.error, detail: mapped.detail }, 502);
      throw err;
    }
  });
