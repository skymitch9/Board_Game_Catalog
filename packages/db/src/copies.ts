import type { Copy, CopyStatus, CreateCopyInput, UpdateCopyInput } from '@bgc/core';

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
  created_at: string;
}

/**
 * SQLite's `datetime('now')` writes "YYYY-MM-DD HH:MM:SS" in UTC, which is not
 * quite ISO 8601 — and `new Date()` in a browser reads that space-separated
 * form as *local* time, so a copy added at 23:30 UTC could display as the day
 * before. Normalising here means every consumer gets an unambiguous instant.
 */
export function toIso(sqliteDatetime: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sqliteDatetime)
    ? `${sqliteDatetime.replace(' ', 'T')}Z`
    : sqliteDatetime;
}

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
 */
export async function createCopy(
  db: D1Database,
  itemId: number,
  input: CreateCopyInput,
): Promise<Copy> {
  const res = await db
    .prepare(
      `INSERT INTO copy (item_id, edition_id, applies_to_copy_id, quantity, status, format,
                         is_sleeved, is_punched, completeness_notes, lent_to, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();

  const created = await getCopy(db, Number(res.meta.last_row_id));
  if (!created) throw new Error('copy vanished immediately after creation');
  return created;
}

const UPDATABLE: Record<keyof UpdateCopyInput, string> = {
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
};

export async function updateCopy(
  db: D1Database,
  id: number,
  input: UpdateCopyInput,
): Promise<Copy | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE) as [keyof UpdateCopyInput, string][]) {
    if (!(key in input)) continue;
    const value = input[key];
    sets.push(`${column} = ?`);
    if (typeof value === 'boolean') params.push(value ? 1 : 0);
    else params.push(value === '' ? null : (value ?? null));
  }

  if (sets.length === 0) return getCopy(db, id);

  sets.push(`updated_at = datetime('now')`);
  params.push(id);

  const res = await db.prepare(`UPDATE copy SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  if ((res.meta.changes ?? 0) === 0) return null;
  return getCopy(db, id);
}

export async function deleteCopy(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM copy WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
