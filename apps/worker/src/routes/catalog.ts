import { Hono } from 'hono';
import {
  createCopySchema,
  createItemSchema,
  createRelationSchema,
  itemQuerySchema,
  suggestRetags,
  updateCopySchema,
  updateItemSchema,
  upsertRatingSchema,
} from '@bgc/core';
import {
  ItemError,
  RelationError,
  adoptOrphans,
  collectionStats,
  createCopy,
  createItem,
  createRelation,
  deleteCopy,
  deleteItem,
  deleteRating,
  deleteRelation,
  getGameCompleteness,
  getItem,
  getItemDetail,
  getRelatedItems,
  listCoverCandidates,
  listGroupOptions,
  listItemAliases,
  listItemNames,
  listItemTrees,
  listPreorderArrivals,
  listRelationPairs,
  listTopLevelItems,
  listWishlist,
  sweepOrphanAdoptions,
  updateCopy,
  updateItem,
  upsertRating,
} from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { makeCoverHoster } from '../lib/cover-storage.js';

/** Parse a positive integer route param, or null if it isn't one. */
function idParam(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export const catalogRoutes = new Hono<AppBindings>()
  // Reading the collection requires an approved role — `pending` sees nothing.
  .use('*', requireCapability('read'))

  // ---- browse ------------------------------------------------------------

  .get('/items', async (c) => {
    const parsed = itemQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    // One page of trees plus the full match count — `total` deliberately counts
    // every matching group, not the ones on this page, so the header can say
    // "40 games" while showing 25 of them.
    return c.json(await listItemTrees(c.env.DB, parsed.data));
  })

  /**
   * Every item's id, name and kind — and the other names each one answers to.
   *
   * Exists because `/items` is paged. Shelf classification needs the whole
   * catalog to match spine text against, and a paged browse endpoint cannot
   * answer that: it would silently match against the first 25 groups and report
   * every other game you own as new. Three columns over 640 rows is a few tens
   * of kilobytes, against the megabyte a page of whole trees costs.
   *
   * **Aliases ride along rather than getting an endpoint of their own** because
   * they are useless apart: `buildTitleIndex` needs both halves at once — its
   * rule that a real name beats an alias cannot be applied to either list alone
   * — and a caller that fetched one without the other would get a matcher
   * quietly weaker than the server's. One call, one answer, no way to hold it
   * wrong.
   */
  .get('/item-names', async (c) => {
    const [items, aliases] = await Promise.all([
      listItemNames(c.env.DB),
      listItemAliases(c.env.DB),
    ]);
    return c.json({ items, aliases });
  })

  .get('/items/:id', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const detail = await getItemDetail(c.env.DB, id);
    if (!detail) return c.json({ error: 'not_found' }, 404);
    return c.json({ item: detail });
  })

  /**
   * The covers this item could wear, and which one it wears now.
   *
   * `read`, not `editCatalog`: this reads rows and nothing else. Picking one is
   * an ordinary `PATCH /api/items/:id` setting `thumbnailUrl`, so there is no
   * cover-specific write route — a second way to change an item's cover would be
   * a second one to keep honest.
   *
   * Populating the candidates is `POST /api/editions/backfill` and
   * `POST /api/editions/campaign`.
   */
  .get('/items/:id/covers', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const covers = await listCoverCandidates(c.env.DB, id);
    if (!covers) return c.json({ error: 'not_found' }, 404);
    return c.json(covers);
  })

  /**
   * What else exists for this game, and what we do not have.
   *
   * `read`, not `editCatalog`: it reads stored rows and makes no BoardGameGeek
   * call. Filling those rows is `POST /api/components/backfill` and the weekly
   * cron; nothing here ever fetches, which is the whole point of caching the
   * component lists rather than looking them up live.
   *
   * Always answers for the game at the root of the tree, so asking from an
   * expansion's page reports on its base game — components belong to the game,
   * not to whichever row happened to be open.
   */
  .get('/items/:id/completeness', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const completeness = await getGameCompleteness(c.env.DB, id);
    if (!completeness) return c.json({ error: 'not_found' }, 404);
    return c.json(completeness);
  })

  /**
   * What is on preorder anywhere under this item — the "what turned up?" list.
   *
   * `read`, not `editCatalog`, and read-only in the strictest sense: it says
   * which copies a pledge is still waiting on, and applying the answer is an
   * ordinary `PATCH /api/copies/:id` per row. Same shape as `/retag` and
   * `/wishlist`, and for the same reason — a second way to change a copy's
   * status would be a second thing to keep honest.
   *
   * Scoped to the subtree rather than the whole game, so a game holding two
   * pledges can have one confirmed without the other being offered up with it.
   */
  .get('/items/:id/arrivals', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const arrivals = await listPreorderArrivals(c.env.DB, id);
    if (!arrivals) return c.json({ error: 'not_found' }, 404);
    return c.json({ arrivals });
  })

  /**
   * Headline numbers, so the UI needn't compute them — plus the groupings in use.
   *
   * The group list rides along here rather than on a route of its own because it
   * is the same kind of thing: a fact about the whole collection that the filters
   * need before the user has typed anything. It covers both axes — series and
   * game system — because they are one mechanism to the person using them, and
   * two lists would mean two dropdowns asking the same question.
   */
  .get('/meta', async (c) => {
    const [stats, groups] = await Promise.all([
      collectionStats(c.env.DB),
      listGroupOptions(c.env.DB),
    ]);
    return c.json({ stats, groups });
  })

  /**
   * The shopping list: every copy marked `wanted`, and nothing else.
   *
   * Not `/items?status=wanted`. That filters game trees, so one wanted
   * expansion drags in its base game and every accessory filed beside it.
   *
   * Marking one as bought is an ordinary `PATCH /api/copies/:id` with
   * `{ status: 'owned' }` — there is no wishlist-specific write route, because
   * a second way to change a copy's status is a second thing to keep honest.
   */
  .get('/wishlist', async (c) => {
    return c.json({ entries: await listWishlist(c.env.DB) });
  })

  /**
   * Top-level games whose name says they belong to another.
   *
   * A read-only proposal list. Applying a row is an ordinary PATCH of that
   * item, so there is no second write path to keep honest.
   */
  .get('/retag', async (c) => {
    const items = await listTopLevelItems(c.env.DB);
    const pairs = await listRelationPairs(c.env.DB);
    // One list, because it is one question — can this be played without the
    // other box. The two answers, file-under and standalone, are what the
    // screen offers per row.
    return c.json({ suggestions: suggestRetags(items, pairs) });
  })

  // ---- items -------------------------------------------------------------

  .post('/items', requireCapability('editCatalog'), async (c) => {
    const parsed = createItemSchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    try {
      const item = await createItem(c.env.DB, parsed.data, makeCoverHoster(c.env));
      // A game arriving can complete something that has been waiting months for
      // it. Reported back so the screen can say so rather than leaving the user
      // to notice their orphan quietly moved.
      const adopted = await adoptOrphans(c.env.DB, item);

      /*
        And the other direction, which is the one that was missing: the thing
        just created may itself be an orphan whose parent has been sitting in the
        catalog all along. `adoptOrphans` alone can never find that — it is
        triggered by the *parent* arriving, and for this row that already
        happened. Item 842 waited on item 840 exactly this way.

        Runs second so a new orphan that just collected children of its own drags
        them along; `updateItem` retargets the whole subtree's root.

        No cooldown and no debounce. This is two indexed reads and no network
        call, item creation is human-paced, and a cooldown would buy persistent
        state and a "did it fire?" question in exchange for nothing.
      */
      const filed = await sweepOrphanAdoptions(c.env.DB, { itemId: item.id });
      const finalItem = filed.adopted > 0 ? ((await getItem(c.env.DB, item.id)) ?? item) : item;

      return c.json({ item: finalItem, adopted, filedUnder: filed.adoptions[0] ?? null }, 201);
    } catch (err) {
      if (err instanceof ItemError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status as 400);
      }
      throw err;
    }
  })

  .patch('/items/:id', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = updateItemSchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    try {
      const item = await updateItem(c.env.DB, id, parsed.data, makeCoverHoster(c.env));
      if (!item) return c.json({ error: 'not_found' }, 404);
      return c.json({ item });
    } catch (err) {
      if (err instanceof ItemError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status as 400);
      }
      throw err;
    }
  })

  .delete('/items/:id', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    const deleted = await deleteItem(c.env.DB, id);
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: true });
  })

  // ---- copies ------------------------------------------------------------

  .post('/items/:id/copies', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const detail = await getItemDetail(c.env.DB, id);
    if (!detail) return c.json({ error: 'not_found', detail: 'no such item' }, 404);

    const parsed = createCopySchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    return c.json({ copy: await createCopy(c.env.DB, id, parsed.data) }, 201);
  })

  .patch('/copies/:id', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = updateCopySchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const copy = await updateCopy(c.env.DB, id, parsed.data);
    if (!copy) return c.json({ error: 'not_found' }, 404);
    return c.json({ copy });
  })

  .delete('/copies/:id', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    const deleted = await deleteCopy(c.env.DB, id);
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: true });
  })

  // ---- ratings (any approved user, including raters) ----------------------

  .put('/items/:id/rating', requireCapability('rate'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = upsertRatingSchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const rating = await upsertRating(c.env.DB, {
      itemId: id,
      userId: c.get('user').id,
      input: parsed.data,
    });
    if (!rating) return c.json({ error: 'not_found' }, 404);
    return c.json({ rating });
  })

  .delete('/items/:id/rating', requireCapability('rate'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    await deleteRating(c.env.DB, { itemId: id, userId: c.get('user').id });
    return c.json({ deleted: true });
  })

  // ---- relations (standalone-but-related games) ----------------------------

  .get('/items/:id/relations', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    return c.json({ relations: await getRelatedItems(c.env.DB, id) });
  })

  .post('/items/:id/relations', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = createRelationSchema.safeParse(await body(c));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    try {
      const relation = await createRelation(c.env.DB, id, parsed.data.toItemId, parsed.data.relation);
      return c.json({ relation }, 201);
    } catch (err) {
      if (err instanceof RelationError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status as 400);
      }
      throw err;
    }
  })

  .delete('/relations/:id', requireCapability('editCatalog'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    const deleted = await deleteRelation(c.env.DB, id);
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: true });
  });
