import type { Item, ItemKind } from '@bgc/core';
import { addBggEditions, type EditionInput } from './editions.js';
import { getItem, mapItemRow, toSortName, type ItemRow } from './items.js';

/**
 * Structural input rather than a dependency on @bgc/bgg — the db package stays
 * ignorant of where the metadata came from, so a future importer (a CSV, a
 * different site) can reuse this untouched.
 */
export interface ImportableItem {
  bggId: number;
  name: string;
  yearPublished: number | null;
  description: string | null;
  thumbnailUrl: string | null;
  publisher: string | null;
  designers: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  weight: number | null;
  editions: EditionInput[];
}

export async function findItemByBggId(db: D1Database, bggId: number): Promise<Item | null> {
  const row = await db
    .prepare(
      `SELECT id, bgg_id, kind, parent_item_id, root_game_id, name, sort_name, year_published,
              publisher, publisher_url, designers, min_players, max_players, playtime_min,
              weight, thumbnail_url, description, created_at, updated_at
         FROM item WHERE bgg_id = ?`,
    )
    .bind(bggId)
    .first<ItemRow>();
  return row ? mapItemRow(row) : null;
}

export interface ImportResult {
  item: Item;
  /** False when the item already existed — import is idempotent. */
  created: boolean;
  editionsAdded: number;
}

/**
 * Create a catalog item from looked-up metadata, or return the existing one.
 *
 * Idempotent on `bgg_id`: importing the same game twice is a no-op rather than
 * a duplicate, which matters because the paste-a-list flow will often include
 * things already catalogued.
 */
export async function importItem(
  db: D1Database,
  params: {
    data: ImportableItem;
    kind: ItemKind;
    parentItemId: number | null;
    includeEditions: boolean;
  },
): Promise<ImportResult> {
  const existing = await findItemByBggId(db, params.data.bggId);
  if (existing) return { item: existing, created: false, editionsAdded: 0 };

  let rootGameId: number | null = null;
  if (params.parentItemId != null) {
    const parent = await getItem(db, params.parentItemId);
    if (!parent) throw new Error('parent item does not exist');
    rootGameId = parent.rootGameId ?? parent.id;
  }

  const res = await db
    .prepare(
      `INSERT INTO item (bgg_id, kind, parent_item_id, root_game_id, name, sort_name,
                         year_published, publisher, designers, min_players, max_players,
                         playtime_min, weight, thumbnail_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.data.bggId,
      params.kind,
      params.parentItemId,
      rootGameId,
      params.data.name,
      toSortName(params.data.name),
      params.data.yearPublished,
      params.data.publisher,
      params.data.designers,
      params.data.minPlayers,
      params.data.maxPlayers,
      params.data.playtimeMin,
      params.data.weight,
      params.data.thumbnailUrl,
      params.data.description,
    )
    .run();

  const id = Number(res.meta.last_row_id);
  if (params.parentItemId == null) {
    await db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').bind(id).run();
  }

  // One insert path for printings, shared with the backfill — see
  // `addBggEditions`. Import and backfill disagreeing about the cap, the
  // `source` tag or de-duplication is exactly the kind of drift the cover
  // picker would surface as two identical printings.
  const editionsAdded = params.includeEditions
    ? await addBggEditions(db, id, params.data.editions)
    : 0;

  const item = await getItem(db, id);
  if (!item) throw new Error('imported item vanished immediately after creation');
  return { item, created: true, editionsAdded };
}

/** Which of these BGG ids do we already have? Used to grey out search hits. */
/**
 * Which of these BGG ids the catalog already holds.
 *
 * Chunked, because the caller's list is however long a BGG search happened to
 * be and D1 caps how many variables one statement may bind — a search for a
 * common word blew straight past it with `D1_ERROR: too many SQL variables`,
 * which reads like a database fault rather than "your query was too popular".
 */
const D1_MAX_VARIABLES = 100;

export async function knownBggIds(db: D1Database, ids: number[]): Promise<Set<number>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Set();

  const found = new Set<number>();
  for (let i = 0; i < unique.length; i += D1_MAX_VARIABLES) {
    const chunk = unique.slice(i, i + D1_MAX_VARIABLES);
    const { results } = await db
      .prepare(`SELECT bgg_id FROM item WHERE bgg_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ bgg_id: number }>();
    for (const row of results) found.add(row.bgg_id);
  }
  return found;
}
