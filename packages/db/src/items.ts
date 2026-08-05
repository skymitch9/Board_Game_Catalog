import type {
  Copy,
  CreateItemInput,
  Item,
  ItemDetail,
  ItemNode,
  ItemQuery,
  Rating,
  UpdateItemInput,
  WishlistEntry,
} from '@bgc/core';
import { getRelatedItems } from './relations.js';
import { preserveDisplacedCover } from './editions.js';
import { mapCopyRow, toIso, type CopyRow } from './copies.js';

export interface ItemRow {
  id: number;
  bgg_id: number | null;
  kind: string;
  parent_item_id: number | null;
  root_game_id: number | null;
  pending_parent_name: string | null;
  name: string;
  sort_name: string | null;
  year_published: number | null;
  publisher: string | null;
  publisher_url: string | null;
  designers: string | null;
  min_players: number | null;
  max_players: number | null;
  playtime_min: number | null;
  weight: number | null;
  thumbnail_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export function mapItemRow(r: ItemRow): Item {
  return {
    id: r.id,
    bggId: r.bgg_id,
    kind: r.kind as Item['kind'],
    parentItemId: r.parent_item_id,
    rootGameId: r.root_game_id,
    pendingParentName: r.pending_parent_name,
    name: r.name,
    sortName: r.sort_name,
    yearPublished: r.year_published,
    publisher: r.publisher,
    publisherUrl: r.publisher_url,
    designers: r.designers,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    playtimeMin: r.playtime_min,
    weight: r.weight,
    thumbnailUrl: r.thumbnail_url,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const ITEM_COLUMNS = `id, bgg_id, kind, parent_item_id, root_game_id, pending_parent_name,
  name, sort_name, year_published, publisher, publisher_url, designers, min_players,
  max_players, playtime_min, weight, thumbnail_url, description, created_at, updated_at`;

/** "The Castles of Burgundy" sorts under C, not T. */
export function toSortName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');
}

/**
 * Builds the subquery selecting root_game_ids whose tree matches the filters.
 *
 * Filtering on the *tree* rather than the item is deliberate: searching for an
 * expansion should surface its base game too, otherwise you get an orphaned
 * result with no context.
 */
function matchingRootsSql(query: ItemQuery): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    where.push('(lower(i2.name) LIKE ? OR lower(i2.publisher) LIKE ? OR lower(i2.designers) LIKE ?)');
    const like = `%${query.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (query.kind) {
    where.push('i2.kind = ?');
    params.push(query.kind);
  }
  if (query.status) {
    where.push('c2.status = ?');
    params.push(query.status);
  }
  if (query.uncatalogued) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM item i3 JOIN copy c3 ON c3.item_id = i3.id
                    WHERE i3.root_game_id = i2.root_game_id)`,
    );
  }
  if (query.duplicates) {
    // Anything in this tree we hold more than one of, counting both several
    // rows for the same item and a single row with quantity > 1.
    where.push(
      `EXISTS (SELECT 1 FROM item i4 JOIN copy c4 ON c4.item_id = i4.id
                WHERE i4.root_game_id = i2.root_game_id
                  AND c4.status IN ('owned','lent')
                GROUP BY i4.id
               HAVING SUM(c4.quantity) > 1)`,
    );
  }

  const sql = `SELECT DISTINCT i2.root_game_id
                 FROM item i2
                 LEFT JOIN copy c2 ON c2.item_id = i2.id
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return { sql, params };
}

/** Assemble flat rows into base-game-rooted trees. */
function buildTrees(items: Item[], copiesByItem: Map<number, Copy[]>): ItemNode[] {
  const nodes = new Map<number, ItemNode>();
  for (const item of items) {
    nodes.set(item.id, { ...item, copies: copiesByItem.get(item.id) ?? [], children: [] });
  }

  const roots: ItemNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentItemId != null ? nodes.get(node.parentItemId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byName = (a: ItemNode, b: ItemNode) =>
    (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name);
  const sortDeep = (list: ItemNode[]) => {
    list.sort(byName);
    list.forEach((n) => sortDeep(n.children));
  };
  sortDeep(roots);
  return roots;
}

export async function listItemTrees(db: D1Database, query: ItemQuery): Promise<ItemNode[]> {
  const roots = matchingRootsSql(query);

  const itemsStmt = db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE root_game_id IN (${roots.sql})`)
    .bind(...roots.params);

  const copiesStmt = db
    .prepare(
      `SELECT c.* FROM copy c
         JOIN item i ON i.id = c.item_id
        WHERE i.root_game_id IN (${roots.sql})`,
    )
    .bind(...roots.params);

  const batched = await db.batch([itemsStmt, copiesStmt]);
  const itemRows = (batched[0]?.results ?? []) as ItemRow[];
  const copyRows = (batched[1]?.results ?? []) as CopyRow[];

  const items = itemRows.map(mapItemRow);
  const copiesByItem = new Map<number, Copy[]>();
  for (const row of copyRows) {
    const copy = mapCopyRow(row);
    const list = copiesByItem.get(copy.itemId);
    if (list) list.push(copy);
    else copiesByItem.set(copy.itemId, [copy]);
  }

  return buildTrees(items, copiesByItem);
}

export async function getItem(db: D1Database, id: number): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE id = ?`)
    .bind(id)
    .first<ItemRow>();
  return row ? mapItemRow(row) : null;
}

export async function getItemDetail(db: D1Database, id: number): Promise<ItemDetail | null> {
  const item = await getItem(db, id);
  if (!item) return null;

  const batched = await db.batch([
    db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE parent_item_id = ?`)
      .bind(id),
    db.prepare('SELECT * FROM copy WHERE item_id = ?').bind(id),
    db
      .prepare(
        `SELECT ui.user_id, ui.rating, ui.notes, ui.rated_at, u.email, u.display_name
           FROM user_item ui JOIN app_user u ON u.id = ui.user_id
          WHERE ui.item_id = ? ORDER BY u.email`,
      )
      .bind(id),
  ]);

  type RatingRow = {
    user_id: number;
    rating: number | null;
    notes: string | null;
    rated_at: string;
    email: string;
    display_name: string | null;
  };

  const childRows = (batched[0]?.results ?? []) as ItemRow[];
  const ownCopyRows = (batched[1]?.results ?? []) as CopyRow[];
  const ratingRows = (batched[2]?.results ?? []) as RatingRow[];

  const children: ItemNode[] = childRows.map((r) => ({
    ...mapItemRow(r),
    copies: [] as Copy[],
    children: [] as ItemNode[],
  }));

  // One extra pass so a child's copies show on the parent page.
  if (children.length > 0) {
    const ids = children.map((c) => c.id);
    const { results } = await db
      .prepare(`SELECT * FROM copy WHERE item_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<CopyRow>();
    for (const row of results) {
      const copy = mapCopyRow(row);
      children.find((c) => c.id === copy.itemId)?.copies.push(copy);
    }
  }

  const parent = item.parentItemId != null ? await getItem(db, item.parentItemId) : null;

  const ratings: Rating[] = ratingRows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    rating: r.rating,
    notes: r.notes,
    ratedAt: r.rated_at,
  }));

  // Related items — standalone games linked to this one (bidirectional).
  const relatedItems = await getRelatedItems(db, id);

  return {
    ...item,
    parent,
    copies: ownCopyRows.map(mapCopyRow),
    children: children.sort((a, b) => (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name)),
    ratings,
    relatedItems,
  };
}

export async function createItem(db: D1Database, input: CreateItemInput): Promise<Item> {
  let rootGameId: number | null = null;

  // A non-base item without a parent is allowed, and is the whole point of
  // `pending_parent_name`: an expansion can reach the shelf before the game it
  // belongs to. Demanding a parent here is what forced both add flows to save
  // such a thing as a base game, silently losing what it actually was.
  const orphaned = input.kind !== 'base' && input.parentItemId == null;

  if (input.kind !== 'base' && !orphaned) {
    const parent = await getItem(db, input.parentItemId!);
    if (!parent) throw new ItemError('parent item does not exist', 400);
    // Everything inherits the base game at the top of the tree, however deep.
    rootGameId = parent.rootGameId ?? parent.id;
  }

  // `idx_item_bgg` is UNIQUE where bgg_id IS NOT NULL, so scanning a game you
  // already own fails here rather than silently creating a second entry. That is
  // the behaviour we want — but it has to read as "you already have this",
  // not as an internal error.
  if (input.bggId != null) {
    const existing = await db
      .prepare('SELECT id, name FROM item WHERE bgg_id = ?')
      .bind(input.bggId)
      .first<{ id: number; name: string }>();
    if (existing) {
      throw new ItemError(`"${existing.name}" is already in the collection.`, 409);
    }
  }

  const res = await db
    .prepare(
      `INSERT INTO item (bgg_id, kind, parent_item_id, root_game_id, pending_parent_name,
                         name, sort_name, year_published,
                         publisher, publisher_url, designers, min_players, max_players,
                         playtime_min, weight, thumbnail_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.bggId ?? null,
      input.kind,
      input.kind === 'base' ? null : (input.parentItemId ?? null),
      rootGameId,
      // Only meaningful while parentless: a name to watch for, not a second
      // way of expressing a relationship that already exists.
      orphaned ? (input.pendingParentName || null) : null,
      input.name,
      toSortName(input.name),
      input.yearPublished ?? null,
      input.publisher || null,
      input.publisherUrl || null,
      input.designers || null,
      input.minPlayers ?? null,
      input.maxPlayers ?? null,
      input.playtimeMin ?? null,
      input.weight ?? null,
      input.thumbnailUrl || null,
      input.description || null,
    )
    .run();

  const id = Number(res.meta.last_row_id);

  // A base game is its own root; we only know the id after the insert. An
  // orphan roots itself for the same reason a base game does — every listing
  // query selects by root_game_id, so a null root would make it invisible
  // rather than unattached.
  if (input.kind === 'base' || orphaned) {
    await db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').bind(id).run();
  }

  const created = await getItem(db, id);
  if (!created) throw new ItemError('item vanished immediately after creation', 500);
  return created;
}

/**
 * Hand every waiting orphan to a game that has just arrived.
 *
 * The other half of `pending_parent_name`. Scanning a shelf can turn up
 * "Wingspan: European Expansion" months before Wingspan itself; the expansion
 * waits, named, and is re-parented the moment its base game is created.
 *
 * Matching is on the normalised name rather than a BGG id on purpose — the
 * orphan was read off a spine and usually has no id at all, which is exactly
 * the situation that produced it.
 *
 * Called after every item creation. Cheap: an indexed lookup that almost always
 * returns nothing, against a mistake that is otherwise invisible until someone
 * notices their collection has two Wingspans.
 */
export async function adoptOrphans(db: D1Database, parent: Item): Promise<Item[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM item
        WHERE parent_item_id IS NULL
          AND pending_parent_name IS NOT NULL
          AND id != ?1
          AND lower(trim(pending_parent_name)) = lower(trim(?2))`,
    )
    .bind(parent.id, parent.name)
    .all<ItemRow>();

  const orphans = results.map(mapItemRow);
  if (orphans.length === 0) return [];

  const newRoot = parent.rootGameId ?? parent.id;

  for (const orphan of orphans) {
    // The orphan may already have grown a tree of its own — an accessory filed
    // under an expansion that was itself waiting. Move the whole subtree, which
    // is identified by the root the orphan was standing in for.
    await db.batch([
      db
        .prepare('UPDATE item SET root_game_id = ?1 WHERE root_game_id = ?2')
        .bind(newRoot, orphan.id),
      db
        .prepare(
          `UPDATE item
              SET parent_item_id = ?1, pending_parent_name = NULL,
                  updated_at = datetime('now')
            WHERE id = ?2`,
        )
        .bind(parent.id, orphan.id),
    ]);
  }

  const adopted = await Promise.all(orphans.map((o) => getItem(db, o.id)));
  return adopted.filter((i): i is Item => i !== null);
}

const UPDATABLE: Record<keyof UpdateItemInput, string> = {
  name: 'name',
  kind: 'kind',
  // Editable so a game added by hand can be linked to BGG later, and so a wrong
  // match from a scan can be corrected rather than requiring a delete.
  bggId: 'bgg_id',
  parentItemId: 'parent_item_id',
  pendingParentName: 'pending_parent_name',
  yearPublished: 'year_published',
  publisher: 'publisher',
  publisherUrl: 'publisher_url',
  designers: 'designers',
  minPlayers: 'min_players',
  maxPlayers: 'max_players',
  playtimeMin: 'playtime_min',
  weight: 'weight',
  thumbnailUrl: 'thumbnail_url',
  description: 'description',
};

export async function updateItem(
  db: D1Database,
  id: number,
  input: UpdateItemInput,
): Promise<Item | null> {
  const existing = await getItem(db, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE) as [keyof UpdateItemInput, string][]) {
    if (!(key in input)) continue;
    const value = input[key];
    sets.push(`${column} = ?`);
    params.push(value === '' ? null : (value ?? null));
    if (key === 'name' && typeof value === 'string') {
      sets.push('sort_name = ?');
      params.push(toSortName(value));
    }
  }

  if (input.parentItemId !== undefined) {
    if (input.parentItemId === id) throw new ItemError('an item cannot be its own parent', 400);
    if (input.parentItemId == null) {
      sets.push('root_game_id = id');
    } else {
      const parent = await getItem(db, input.parentItemId);
      if (!parent) throw new ItemError('parent item does not exist', 400);
      if (parent.rootGameId === id) {
        throw new ItemError('that would make the tree a loop', 400);
      }
      sets.push('root_game_id = ?');
      params.push(parent.rootGameId ?? parent.id);
      // Attaching a parent by hand answers the question the pending name was
      // holding open, so it stops being true. Leaving it would keep the item
      // eligible for adoption by a second game with the same name.
      if (!('pendingParentName' in input)) sets.push('pending_parent_name = NULL');
    }
  }

  if (sets.length === 0) return existing;

  /*
    A cover being replaced is recorded as a printing before it goes.

    This is the only place an item's `thumbnail_url` changes, so it is the only
    place that can make the guarantee: the picker offers you the cover you had,
    whichever one you swap to. Left to the campaign backfill, the guarantee
    would hold only for covers that existed the last time somebody remembered to
    run it — and a Kickstarter image, once unreferenced, is gone. The cost is one
    read and one conditional insert on the rare update that touches the cover.
  */
  if (
    'thumbnailUrl' in input &&
    existing.thumbnailUrl &&
    (input.thumbnailUrl || null) !== existing.thumbnailUrl
  ) {
    await preserveDisplacedCover(db, id, existing.thumbnailUrl);
  }

  sets.push(`updated_at = datetime('now')`);
  params.push(id);

  await db.prepare(`UPDATE item SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  return getItem(db, id);
}

/** Cascades to children, copies, ratings and findings via foreign keys. */
export async function deleteItem(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM item WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Every item's name, for matching titles read off a shelf photo.
 *
 * Deliberately fetches the lot and matches in JS rather than issuing one query
 * per title. A household catalog is hundreds of rows, not millions, so this is
 * a single cheap read — and it allows the normalising comparison in
 * `matchShelfTitles` (punctuation, articles, subtitle splits), which SQLite
 * cannot express without a custom collation.
 */
export async function listItemNames(
  db: D1Database,
): Promise<{ id: number; name: string; kind: string }[]> {
  const { results } = await db
    .prepare('SELECT id, name, kind FROM item ORDER BY id')
    .all<{ id: number; name: string; kind: string }>();
  return results;
}

/**
 * Games missing the details a lookup could fill.
 *
 * The queue for enrichment. Publisher is the field that matters most — it is
 * absent on everything a scan produced, and it is what the official research
 * tier needs before it can run at all.
 */
export async function listItemsNeedingDetails(
  db: D1Database,
  limit = 200,
): Promise<Item[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM item
        WHERE (publisher IS NULL OR publisher = '')
           OR (publisher_url IS NULL OR publisher_url = '')
           OR year_published IS NULL
           OR min_players IS NULL
           OR playtime_min IS NULL
           OR (description IS NULL OR description = '')
        ORDER BY sort_name
        LIMIT ?`,
    )
    .bind(limit)
    .all<ItemRow>();
  return results.map(mapItemRow);
}

/**
 * Everything marked `wanted`, one row per copy.
 *
 * A separate query rather than an option on `matchingRootsSql`, and the
 * difference is the whole point of the screen. That helper matches whole game
 * *trees* so that searching for an expansion also surfaces its base game —
 * correct for browsing, and exactly wrong for a shopping list. The Ark Nova
 * tree holds two wanted items sitting alongside eight preordered 3D upgrades,
 * so `?status=wanted` on the collection page returns all ten. This returns the
 * two.
 *
 * `preordered` is deliberately not included: it is something already bought and
 * waiting for the post, which is a different question from what to buy next.
 *
 * The join to the parent is what lets a row read as "Marine Worlds, expansion
 * of Ark Nova" rather than as a game nobody has heard of.
 */
export async function listWishlist(db: D1Database): Promise<WishlistEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id            AS copy_id,
              c.quantity      AS quantity,
              c.notes         AS notes,
              c.created_at    AS added_at,
              i.id            AS item_id,
              i.name          AS name,
              i.kind          AS kind,
              i.thumbnail_url AS thumbnail_url,
              i.publisher     AS publisher,
              i.year_published AS year_published,
              i.min_players   AS min_players,
              i.max_players   AS max_players,
              i.bgg_id        AS bgg_id,
              p.id            AS parent_item_id,
              p.name          AS parent_name
         FROM copy c
         JOIN item i ON i.id = c.item_id
         LEFT JOIN item p ON p.id = i.parent_item_id
        WHERE c.status = 'wanted'
        ORDER BY COALESCE(p.sort_name, i.sort_name, i.name), i.sort_name, c.id`,
    )
    .all<{
      copy_id: number;
      quantity: number | null;
      notes: string | null;
      added_at: string;
      item_id: number;
      name: string;
      kind: string;
      thumbnail_url: string | null;
      publisher: string | null;
      year_published: number | null;
      min_players: number | null;
      max_players: number | null;
      bgg_id: number | null;
      parent_item_id: number | null;
      parent_name: string | null;
    }>();

  return results.map((r) => ({
    copyId: r.copy_id,
    itemId: r.item_id,
    name: r.name,
    kind: r.kind as WishlistEntry['kind'],
    parentItemId: r.parent_item_id,
    parentName: r.parent_name,
    thumbnailUrl: r.thumbnail_url,
    publisher: r.publisher,
    yearPublished: r.year_published,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    bggId: r.bgg_id,
    quantity: r.quantity ?? 1,
    notes: r.notes,
    addedAt: toIso(r.added_at),
  }));
}

/** Top-level items and their kinds — the input to a re-tagging pass. */
export async function listTopLevelItems(
  db: D1Database,
): Promise<{ id: number; name: string; kind: string; parentItemId: number | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, kind, parent_item_id FROM item
        WHERE parent_item_id IS NULL ORDER BY sort_name`,
    )
    .all<{ id: number; name: string; kind: string; parent_item_id: number | null }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    parentItemId: r.parent_item_id,
  }));
}

export async function collectionStats(db: D1Database): Promise<{
  baseGames: number;
  expansions: number;
  accessories: number;
  totalItems: number;
  ownedCopies: number;
  wantedCopies: number;
  duplicatedItems: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM item WHERE kind = 'base')                     AS base_games,
         (SELECT COUNT(*) FROM item WHERE kind = 'expansion')                AS expansions,
         (SELECT COUNT(*) FROM item WHERE kind IN ('accessory','promo','upgrade')) AS accessories,
         (SELECT COUNT(*) FROM item)                                         AS total_items,
         (SELECT COALESCE(SUM(quantity), 0) FROM copy
           WHERE status IN ('owned','lent'))                                 AS owned_copies,
         (SELECT COALESCE(SUM(quantity), 0) FROM copy
           WHERE status IN ('wanted','preordered'))                          AS wanted_copies,
         (SELECT COUNT(*) FROM (
            SELECT item_id FROM copy WHERE status IN ('owned','lent')
             GROUP BY item_id HAVING SUM(quantity) > 1))                     AS duplicated_items`,
    )
    .first<{
      base_games: number;
      expansions: number;
      accessories: number;
      total_items: number;
      owned_copies: number;
      wanted_copies: number;
      duplicated_items: number;
    }>();

  return {
    baseGames: row?.base_games ?? 0,
    expansions: row?.expansions ?? 0,
    accessories: row?.accessories ?? 0,
    totalItems: row?.total_items ?? 0,
    ownedCopies: row?.owned_copies ?? 0,
    wantedCopies: row?.wanted_copies ?? 0,
    duplicatedItems: row?.duplicated_items ?? 0,
  };
}

/** Thrown for conditions the caller can fix; carries the status to return. */
export class ItemError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
