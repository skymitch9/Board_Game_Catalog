import type { CopyEvent, CopyStatus, Disposal, DisposalDetailsInput } from '@bgc/core';
import { toIso } from './time.js';

export interface CopyEventRow {
  id: number;
  copy_id: number | null;
  item_id: number | null;
  item_name: string;
  from_status: string | null;
  to_status: string;
  disposal: string | null;
  counterpart: string | null;
  price_cents: number | null;
  note: string | null;
  at: string;
}

export function mapCopyEventRow(r: CopyEventRow): CopyEvent {
  return {
    id: r.id,
    copyId: r.copy_id,
    itemId: r.item_id,
    itemName: r.item_name,
    fromStatus: (r.from_status as CopyStatus | null) ?? null,
    toStatus: r.to_status as CopyStatus,
    disposal: (r.disposal as Disposal | null) ?? null,
    counterpart: r.counterpart,
    priceCents: r.price_cents,
    note: r.note,
    at: toIso(r.at),
  };
}

/**
 * The one statement that writes history — **built here and nowhere else.**
 *
 * ⚠️ It is returned as a prepared statement rather than executed, so its caller
 * (`updateCopy`) can put it in the same `db.batch([...])` as the UPDATE it
 * describes. That is the difference between a status and its history travelling
 * together and a pair of writes that can half-succeed: D1 runs a batch as one
 * transaction, so either the copy moved and the event exists, or neither did.
 *
 * ⚠️ **`item_name` is read here, at write time, and never again.** It is the
 * denormalised snapshot that keeps an event readable after its game is deleted
 * (`docs/info/copy-status-history.md` §4). Taking it from a sub-SELECT rather
 * than from a caller-supplied string means no caller can pass the wrong one,
 * and costs nothing: it is the same row the `copy_id` lookup already touches.
 *
 * A copy whose `item_id` no longer resolves writes no event at all — the JOIN
 * matches nothing and the INSERT inserts zero rows. That case cannot arise
 * through the app (`copy.item_id` is `NOT NULL` and cascades), and failing to
 * write beats writing an event that cannot name its subject.
 */
export function copyEventInsert(
  db: D1Database,
  args: {
    copyId: number;
    fromStatus: CopyStatus | null;
    toStatus: CopyStatus;
    disposal: Disposal | null;
    details?: DisposalDetailsInput | undefined;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO copy_event
         (copy_id, item_id, item_name, from_status, to_status, disposal,
          counterpart, price_cents, note)
       SELECT c.id, c.item_id, i.name, ?, ?, ?, ?, ?, ?
         FROM copy c JOIN item i ON i.id = c.item_id
        WHERE c.id = ?`,
    )
    .bind(
      args.fromStatus,
      args.toStatus,
      args.disposal,
      args.details?.counterpart?.trim() || null,
      args.details?.priceCents ?? null,
      args.details?.note?.trim() || null,
      args.copyId,
    );
}

/**
 * Everything that has happened to this game's own copies, newest first.
 *
 * ⚠️ **Keyed on `item_id`, which means a deleted game's history is NOT reachable
 * from here** — the FK sets it to NULL and the event survives with its
 * `item_name` intact but nothing to hang it off. That is deliberate and is the
 * bargain §4 struck: the record is kept so it can be *found* later (by name, in
 * a query), not so a page that no longer exists can render it.
 *
 * Scoped to the item's own copies rather than its whole tree, matching what the
 * shelf on that page shows — a base game's page would otherwise report an
 * expansion's disposal under the base game's name.
 */
export async function listItemCopyEvents(
  db: D1Database,
  itemId: number,
): Promise<CopyEvent[]> {
  const { results } = await db
    .prepare(
      // `id DESC` breaks the tie: `at` has one-second resolution, and two status
      // changes in the same second must still read in the order they happened.
      `SELECT * FROM copy_event WHERE item_id = ? ORDER BY at DESC, id DESC`,
    )
    .bind(itemId)
    .all<CopyEventRow>();
  return results.map(mapCopyEventRow);
}
