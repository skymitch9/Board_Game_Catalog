import type {
  Copy,
  CopyStatus,
  CreateCopyInput,
  Disposal,
  UpdateCopyInput,
} from '@bgc/core';
import { copyEventInsert } from './copy-events.js';
import { toIso } from './time.js';

/**
 * A status set as a SQL literal list: `'owned','lent'`.
 *
 * For embedding in an `IN (…)` clause. Not parameterised, and it does not need
 * to be — the only inputs are the frozen arrays in `packages/core/constants.ts`,
 * which are compile-time constants and never reach here from a request. Bound
 * parameters would be the right answer the moment that stops being true.
 *
 * It exists so `HELD_STATUSES` and `OWNED_COPY_STATUSES` can be *used* rather
 * than re-typed: a constant nobody can reference from SQL is a constant that
 * gets copied by hand, which is the state this replaced.
 */
export function statusList(statuses: readonly CopyStatus[]): string {
  return statuses.map((s) => `'${s}'`).join(',');
}

export interface CopyRow {
  id: number;
  item_id: number;
  edition_id: number | null;
  applies_to_copy_id: number | null;
  quantity: number;
  status: string;
  format: string;
  is_sleeved: number;
  is_punched: number;
  completeness_notes: string | null;
  lent_to: string | null;
  notes: string | null;
  /** Added by migration 0029. NULL for every copy that is still ours. */
  disposal: string | null;
  created_at: string;
}

/**
 * Moved to `time.ts` (a leaf) so `copy-events.ts` can use it without an import
 * cycle back through this file. Re-exported here because this is where every
 * existing caller imports it from, and moving a function is not a reason to
 * touch six unrelated import lines.
 */
export { toIso } from './time.js';

export function mapCopyRow(r: CopyRow): Copy {
  return {
    id: r.id,
    itemId: r.item_id,
    editionId: r.edition_id,
    appliesToCopyId: r.applies_to_copy_id,
    quantity: r.quantity ?? 1,
    status: r.status as Copy['status'],
    // Column added by migration 0015 with a NOT NULL default, so the fallback is
    // belt and braces rather than a real case.
    format: (r.format as Copy['format']) ?? 'physical',
    isSleeved: r.is_sleeved === 1,
    isPunched: r.is_punched === 1,
    completenessNotes: r.completeness_notes,
    lentTo: r.lent_to,
    notes: r.notes,
    // Migration 0029 added the column with no default, so every pre-0029 row
    // reads NULL — which is the truth: none of them had left.
    disposal: (r.disposal as Copy['disposal'] | null) ?? null,
    addedAt: toIso(r.created_at),
  };
}

/**
 * How many of this item we actually hold.
 *
 * Sums `quantity` rather than counting rows: one row can stand for several
 * identical copies. Only `owned` counts — a wanted or preordered copy is not
 * something you are holding, which matters because the caller is a barcode scan
 * answering "do I already have this, and how many?".
 *
 * ⚠️ **Deliberately narrower than both `HELD_STATUSES` and
 * `OWNED_COPY_STATUSES`**, and the odd one out on purpose: it excludes `lent`
 * as well as `preordered`, because a copy at a friend's house cannot be put on
 * the table tonight. Left as a literal rather than given a constant of its own —
 * one caller, one question, and a third exported set would invite somebody to
 * pick it by name without reading why.
 */
export async function countOwnedCopies(db: D1Database, itemId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS n FROM copy WHERE item_id = ? AND status = 'owned'`,
    )
    .bind(itemId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function getCopy(db: D1Database, id: number): Promise<Copy | null> {
  const row = await db.prepare('SELECT * FROM copy WHERE id = ?').bind(id).first<CopyRow>();
  return row ? mapCopyRow(row) : null;
}

/**
 * `created_at` is deliberately absent from the column list: the table's
 * `DEFAULT (datetime('now'))` sets it, so "when did this join the collection?"
 * is answered by the database rather than by whatever clock the caller has.
 *
 * ⚠️ **A create writes NO `copy_event`, and that is deliberate.** The obvious
 * version writes a birth event with `from_status = NULL`, and it buys nothing:
 * `created_at` already records when the copy arrived, and the first status
 * change records what it arrived AS in its `from_status`, so the timeline is
 * fully reconstructible either way. What it would cost is the one property that
 * matters — an event that travels atomically with the write it describes. The
 * copy's id does not exist until the INSERT has run, so the pair cannot go in
 * one `db.batch`, and a second statement afterwards can fail on its own,
 * leaving a copy whose history is silently short one row. History is written
 * from exactly one place: `updateCopy`, below.
 */
export async function createCopy(
  db: D1Database,
  itemId: number,
  input: CreateCopyInput,
): Promise<Copy> {
  const res = await db
    .prepare(
      `INSERT INTO copy (item_id, edition_id, applies_to_copy_id, quantity, status, format,
                         is_sleeved, is_punched, completeness_notes, lent_to, notes, disposal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      itemId,
      input.editionId ?? null,
      input.appliesToCopyId ?? null,
      input.quantity,
      input.status,
      input.format,
      input.isSleeved ? 1 : 0,
      input.isPunched ? 1 : 0,
      input.completenessNotes || null,
      input.lentTo || null,
      input.notes || null,
      input.disposal ?? null,
    )
    .run();

  const created = await getCopy(db, Number(res.meta.last_row_id));
  if (!created) throw new Error('copy vanished immediately after creation');
  return created;
}

/**
 * The columns a PATCH may set, keyed by the field that sets them.
 *
 * ⚠️ `disposalDetails` is deliberately absent: it is metadata for the
 * `copy_event` this update writes, not a column on `copy`. The loop below skips
 * anything not named here, which is what keeps it off the UPDATE.
 */
const UPDATABLE: Record<Exclude<keyof UpdateCopyInput, 'disposalDetails'>, string> = {
  editionId: 'edition_id',
  appliesToCopyId: 'applies_to_copy_id',
  quantity: 'quantity',
  status: 'status',
  format: 'format',
  isSleeved: 'is_sleeved',
  isPunched: 'is_punched',
  completenessNotes: 'completeness_notes',
  lentTo: 'lent_to',
  notes: 'notes',
  disposal: 'disposal',
};

/**
 * Change a copy — and, when what changed is *where it stands*, record that it
 * happened.
 *
 * ⚠️ **This is the one place `copy_event` rows are written.** Not the route,
 * not the UI. Every caller that changes a status must produce an event or the
 * history is quietly partial, which the design doc (§4) calls worse than
 * absent — and there are several callers: the wishlist's "I bought it", the
 * arrivals screen's "it turned up", the item page's editor, and any script.
 * Putting the write here means none of them can forget.
 *
 * ⚠️ **The UPDATE and the event go out in one `db.batch`**, which D1 runs as a
 * single transaction. Two separate writes could half-succeed and leave a copy
 * marked `sold` with no record of the sale — the status and its history have to
 * travel together or the guarantee is decorative.
 *
 * The event is written when `status` **or** `disposal` moves. Disposal alone
 * counts: correcting "sold" to "given away" is a change to what happened, and
 * losing it would leave the history disagreeing with the copy.
 */
export async function updateCopy(
  db: D1Database,
  id: number,
  input: UpdateCopyInput,
): Promise<Copy | null> {
  // Read first: the event needs `from_status`, and there is no way to know it
  // after the UPDATE has overwritten it.
  const before = await getCopy(db, id);
  if (!before) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE) as [
    Exclude<keyof UpdateCopyInput, 'disposalDetails'>,
    string,
  ][]) {
    if (!(key in input)) continue;
    const value = input[key];
    sets.push(`${column} = ?`);
    if (typeof value === 'boolean') params.push(value ? 1 : 0);
    else params.push(value === '' ? null : (value ?? null));
  }

  if (sets.length === 0) return before;

  sets.push(`updated_at = datetime('now')`);
  params.push(id);

  // The state this update leaves behind — the merge of what was there and what
  // the caller sent. `'disposal' in input` rather than a truthiness check,
  // because `{ disposal: null }` is a real instruction ("it is ours again") and
  // an absent key is not.
  const after: { status: CopyStatus; disposal: Disposal | null } = {
    status: input.status ?? before.status,
    disposal: 'disposal' in input ? (input.disposal ?? null) : before.disposal,
  };
  const moved = after.status !== before.status || after.disposal !== before.disposal;

  const update = db.prepare(`UPDATE copy SET ${sets.join(', ')} WHERE id = ?`).bind(...params);

  if (!moved) {
    const res = await update.run();
    if ((res.meta.changes ?? 0) === 0) return null;
    return getCopy(db, id);
  }

  const [updated] = await db.batch([
    update,
    copyEventInsert(db, {
      copyId: id,
      fromStatus: before.status,
      toStatus: after.status,
      disposal: after.disposal,
      details: input.disposalDetails,
    }),
  ]);
  if ((updated?.meta.changes ?? 0) === 0) return null;
  return getCopy(db, id);
}

/**
 * ⚠️ **Deleting a copy does NOT delete its history**, and nothing here has to
 * arrange that: `copy_event.copy_id` is `ON DELETE SET NULL` (migration 0029),
 * so the events survive the row with their `item_id` and `item_name` intact.
 * That is the single most important property of this feature — see §4 of
 * `docs/info/copy-status-history.md`, and the test that pins it.
 *
 * No farewell event is written. "This copy was removed from the catalog" is a
 * fact about the catalog, not about the game, and the row that would record it
 * could not point at the copy it describes.
 */
export async function deleteCopy(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM copy WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
