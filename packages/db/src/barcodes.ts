import type { Item } from '@bgc/core';
import { mapItemRow, type ItemRow } from './items.js';

export interface BarcodeMatch {
  item: Item;
  editionId: number;
  editionName: string | null;
}

/**
 * Local barcode lookup — free, instant, and works with a bad signal in a shop.
 *
 * This is the reason confirmed scans are written back: every scan makes the
 * next one more likely to resolve here instead of costing an API call.
 */
export async function findByBarcode(
  db: D1Database,
  barcode: string,
): Promise<BarcodeMatch | null> {
  const row = await db
    .prepare(
      `SELECT e.id AS edition_id, e.name AS edition_name,
              i.id, i.bgg_id, i.kind, i.parent_item_id, i.root_game_id, i.name, i.sort_name,
              i.year_published, i.publisher, i.publisher_url, i.designers, i.min_players,
              i.max_players, i.playtime_min, i.weight, i.thumbnail_url, i.description,
              i.created_at, i.updated_at
         FROM edition e
         JOIN item i ON i.id = e.item_id
        WHERE e.barcode = ?
        LIMIT 1`,
    )
    .bind(barcode)
    .first<ItemRow & { edition_id: number; edition_name: string | null }>();

  if (!row) return null;
  return {
    item: mapItemRow(row),
    editionId: row.edition_id,
    editionName: row.edition_name,
  };
}

/**
 * Attach a barcode to an item, reusing an edition row when one is free.
 *
 * An item may have no editions at all (hand-entered) or several (imported from
 * BGG). Rather than force the user to pick a printing they may not know, take
 * the named one if given, otherwise the first edition without a barcode,
 * otherwise create one.
 */
export async function linkBarcode(
  db: D1Database,
  params: { itemId: number; barcode: string; editionId?: number | null; editionName?: string | null },
): Promise<BarcodeMatch> {
  const existing = await findByBarcode(db, params.barcode);
  if (existing && existing.item.id === params.itemId) return existing;
  if (existing) {
    throw new BarcodeConflict(
      `That barcode is already linked to "${existing.item.name}".`,
      existing.item.id,
    );
  }

  let editionId = params.editionId ?? null;

  if (editionId == null) {
    const free = await db
      .prepare(
        `SELECT id FROM edition
          WHERE item_id = ? AND (barcode IS NULL OR barcode = '')
          ORDER BY id LIMIT 1`,
      )
      .bind(params.itemId)
      .first<{ id: number }>();
    editionId = free?.id ?? null;
  }

  if (editionId == null) {
    const res = await db
      .prepare('INSERT INTO edition (item_id, name, barcode) VALUES (?, ?, ?)')
      .bind(params.itemId, params.editionName ?? 'Scanned printing', params.barcode)
      .run();
    editionId = Number(res.meta.last_row_id);
  } else {
    await db
      .prepare('UPDATE edition SET barcode = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(params.barcode, editionId)
      .run();
  }

  const match = await findByBarcode(db, params.barcode);
  if (!match) throw new Error('barcode link vanished immediately after write');
  return match;
}

export class BarcodeConflict extends Error {
  constructor(
    message: string,
    readonly itemId: number,
  ) {
    super(message);
  }
}
