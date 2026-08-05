import { Hono } from 'hono';
import { z } from 'zod';
import { ITEM_KINDS, isConfidentMatch } from '@bgc/core';
import { BggError, kindForBggType, search, thing, things } from '@bgc/bgg';
import { getItem, importItem, knownBggIds, updateItem } from '@bgc/db';
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

  /**
   * Attach a game already in the catalog to its BoardGameGeek entry.
   *
   * The catalog is full of games that arrived by photograph or from a pledge
   * list: a name and nothing else, no cover, no BGG id. This finds the entry
   * and fills the blanks from it.
   *
   * Guarded by the same similarity floor the shelf scanner uses, because a BGG
   * search always returns *something* — "Savage" alone brings back a dozen
   * unrelated games. An unconfident match writes nothing and says so, which is
   * the right outcome for a Kickstarter special edition that BGG may not list
   * under the name printed on the box.
   *
   * Fills gaps only, and never changes `kind`. BGG's type is better evidence
   * than the name-prefix guess that produced most of these, but re-filing a
   * game is a decision with a screen of its own — the suggestion is returned
   * for that screen to use rather than applied here.
   */
  .post('/match/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id || !Number.isInteger(id)) {
      return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    }

    const item = await getItem(c.env.DB, id);
    if (!item) return c.json({ error: 'not_found' }, 404);

    try {
      let bggId = item.bggId;

      if (bggId == null) {
        const results = await search(c.env.BGG_API_TOKEN ?? '', item.name);
        const confident = results.filter((r) => isConfidentMatch(r.name, item.name));
        if (confident.length === 0) {
          return c.json({
            item,
            matched: false,
            detail:
              results.length === 0
                ? `BoardGameGeek has nothing for "${item.name}".`
                : `No confident match for "${item.name}" — closest was "${results[0]!.name}".`,
            candidates: results.slice(0, 5),
          });
        }
        // An exact normalised name beats a merely confident one: "Catan" should
        // find Catan, not "Catan: Cities & Knights", which also clears the bar.
        const exact = confident.find(
          (r) => r.name.toLowerCase().trim() === item.name.toLowerCase().trim(),
        );
        bggId = (exact ?? confident[0]!).bggId;
      }

      const found = await thing(c.env.BGG_API_TOKEN ?? '', bggId);
      if (!found) return c.json({ item, matched: false, detail: 'That BGG entry has gone.' });

      /*
        A name is not an identity.

        "Brink" matched BGG 14780 — a 2004 game with no known publisher — when
        the box owned is IV Studio's 2025 Kickstarter. "Iliad" matched Asmodee's
        2006 game rather than Bitewing's 2025 one. Both scored a perfect 1.00 on
        the similarity check, because the names really are identical, so the
        guard that catches loose matches never had anything to catch.

        Short titles get reused constantly, and crowdfunded games are the worst
        case: often absent from BGG entirely, or listed under a name nobody
        prints on the box. So where the catalog already knows a year or a
        publisher, BGG has to agree with it. Disagreeing is not an error — it is
        evidence this is a different game with the same name, and the answer is
        to say so rather than write it down.
      */
      const disagreements: string[] = [];
      if (item.yearPublished && found.yearPublished) {
        const gap = Math.abs(item.yearPublished - found.yearPublished);
        // Reprints and later editions shift a year or two; a decade is a
        // different game.
        if (gap > 3) {
          disagreements.push(
            `we have ${item.yearPublished}, BoardGameGeek says ${found.yearPublished}`,
          );
        }
      }
      if (item.publisher && found.publisher && !isConfidentMatch(found.publisher, item.publisher)) {
        disagreements.push(`we have "${item.publisher}", BoardGameGeek says "${found.publisher}"`);
      }

      if (disagreements.length > 0) {
        return c.json({
          item,
          matched: false,
          detail:
            `"${found.name}" (BGG ${found.bggId}) does not look like the same game: ` +
            `${disagreements.join('; ')}. Nothing was changed.`,
          candidates: [{ bggId: found.bggId, name: found.name, type: found.type }],
        });
      }

      const blank = (v: string | number | null | undefined) =>
        v == null || (typeof v === 'string' && v.trim() === '');

      const patch: Record<string, string | number> = {};
      if (item.bggId == null) patch['bggId'] = found.bggId;
      if (blank(item.thumbnailUrl) && found.thumbnailUrl) patch['thumbnailUrl'] = found.thumbnailUrl;
      if (blank(item.publisher) && found.publisher) patch['publisher'] = found.publisher;
      if (blank(item.yearPublished) && found.yearPublished) {
        patch['yearPublished'] = found.yearPublished;
      }
      if (blank(item.minPlayers) && found.minPlayers) patch['minPlayers'] = found.minPlayers;
      if (blank(item.maxPlayers) && found.maxPlayers) patch['maxPlayers'] = found.maxPlayers;
      if (blank(item.playtimeMin) && found.playtimeMin) patch['playtimeMin'] = found.playtimeMin;

      const updated =
        Object.keys(patch).length > 0 ? await updateItem(c.env.DB, id, patch) : item;

      return c.json({
        item: updated,
        matched: true,
        filled: patch,
        bgg: {
          bggId: found.bggId,
          name: found.name,
          suggestedKind: kindForBggType(found.type),
          expansions: found.related.filter((r) => r.type === 'expansion').length,
        },
      });
    } catch (err) {
      const mapped = handleBggError(err);
      if (mapped) return c.json({ error: mapped.error, detail: mapped.detail }, 502);
      throw err;
    }
  })

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
