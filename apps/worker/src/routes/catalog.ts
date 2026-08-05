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
  getItemDetail,
  getRelatedItems,
  listItemTrees,
  listRelationPairs,
  listTopLevelItems,
  updateCopy,
  updateItem,
  upsertRating,
} from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

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
    return c.json({ items: await listItemTrees(c.env.DB, parsed.data) });
  })

  .get('/items/:id', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const detail = await getItemDetail(c.env.DB, id);
    if (!detail) return c.json({ error: 'not_found' }, 404);
    return c.json({ item: detail });
  })

  /** Headline numbers, so the UI needn't compute them. */
  .get('/meta', async (c) => {
    return c.json({ stats: await collectionStats(c.env.DB) });
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
      const item = await createItem(c.env.DB, parsed.data);
      // A game arriving can complete something that has been waiting months for
      // it. Reported back so the screen can say so rather than leaving the user
      // to notice their orphan quietly moved.
      const adopted = await adoptOrphans(c.env.DB, item);
      return c.json({ item, adopted }, 201);
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
      const item = await updateItem(c.env.DB, id, parsed.data);
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
