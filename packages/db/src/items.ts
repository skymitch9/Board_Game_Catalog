import type {
  Copy,
  CreateItemInput,
  Item,
  ItemDetail,
  ItemNode,
  ItemQuery,
  Rating,
  UpdateItemInput,
} from '@bgc/core';
import { mapCopyRow, type CopyRow } from './copies.js';

export interface ItemRow {
  id: number;
  bgg_id: number | null;
  kind: string;
  parent_item_id: number | null;
  root_game_id: number | null;
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

const ITEM_COLUMNS = `id, bgg_id, kind, parent_item_id, root_game_id, name, sort_name,
  year_published, publisher, publisher_url, designers, min_players, max_players,
  playtime_min, weight, thumbnail_url, description, created_at, updated_at`;

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
  if (query.location) {
    where.push('c2.location = ?');
    params.push(query.location);
  }
  if (query.uncatalogued) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM item i3 JOIN copy c3 ON c3.item_id = i3.id
                    WHERE i3.root_game_id = i2.root_game_id)`,
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

  return {
    ...item,
    parent,
    copies: ownCopyRows.map(mapCopyRow),
    children: children.sort((a, b) => (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name)),
    ratings,
  };
}

export async function createItem(db: D1Database, input: CreateItemInput): Promise<Item> {
  let rootGameId: number | null = null;

  if (input.kind !== 'base') {
    const parent = await getItem(db, input.parentItemId!);
    if (!parent) throw new ItemError('parent item does not exist', 400);
    // Everything inherits the base game at the top of the tree, however deep.
    rootGameId = parent.rootGameId ?? parent.id;
  }

  const res = await db
    .prepare(
      `INSERT INTO item (kind, parent_item_id, root_game_id, name, sort_name, year_published,
                         publisher, publisher_url, designers, min_players, max_players,
                         playtime_min, weight, thumbnail_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.kind,
      input.kind === 'base' ? null : input.parentItemId,
      rootGameId,
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

  // A base game is its own root; we only know the id after the insert.
  if (input.kind === 'base') {
    await db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').bind(id).run();
  }

  const created = await getItem(db, id);
  if (!created) throw new ItemError('item vanished immediately after creation', 500);
  return created;
}

const UPDATABLE: Record<keyof UpdateItemInput, string> = {
  name: 'name',
  kind: 'kind',
  parentItemId: 'parent_item_id',
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
    }
  }

  if (sets.length === 0) return existing;

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

export async function listLocations(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT location FROM copy
        WHERE location IS NOT NULL AND trim(location) <> ''
        ORDER BY location`,
    )
    .all<{ location: string }>();
  return results.map((r) => r.location);
}

export async function collectionStats(db: D1Database): Promise<{
  baseGames: number;
  totalItems: number;
  ownedCopies: number;
  wantedCopies: number;
  spentCents: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM item WHERE kind = 'base')                              AS base_games,
         (SELECT COUNT(*) FROM item)                                                  AS total_items,
         (SELECT COUNT(*) FROM copy WHERE status IN ('owned','lent'))                 AS owned_copies,
         (SELECT COUNT(*) FROM copy WHERE status IN ('wanted','preordered'))          AS wanted_copies,
         (SELECT COALESCE(SUM(price_paid_cents), 0) FROM copy)                        AS spent_cents`,
    )
    .first<{
      base_games: number;
      total_items: number;
      owned_copies: number;
      wanted_copies: number;
      spent_cents: number;
    }>();

  return {
    baseGames: row?.base_games ?? 0,
    totalItems: row?.total_items ?? 0,
    ownedCopies: row?.owned_copies ?? 0,
    wantedCopies: row?.wanted_copies ?? 0,
    spentCents: row?.spent_cents ?? 0,
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
