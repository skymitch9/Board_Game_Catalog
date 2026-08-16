/**
 * Scan jobs — the intake queue, and everything that lands in it.
 *
 * A photo is uploaded → vision reads titles → free lookups enrich →
 * results land in a review queue for the user to confirm.
 *
 * A **barcode** job skips the first two steps entirely: the code is exact, so
 * there is nothing to read and nothing to guess at. It goes straight to
 * `review` carrying one title per scan, appended as the codes come in. That is
 * why `mode` is a third value (migration 0017) rather than a photo job with a
 * fake image — a barcode job has no photo, never calls vision, and costs
 * nothing, and the review screen needs to be able to show you which code it was.
 */

export type ScanJobStatus =
  | 'uploaded'
  | 'reading'
  | 'read'
  | 'enriching'
  | 'review'
  | 'done'
  | 'failed';

export type ScanJobMode = 'shelf' | 'single' | 'barcode';

export interface ScanJob {
  id: number;
  status: ScanJobStatus;
  mode: ScanJobMode;
  photoKey: string;
  rawTitles: string | null;
  enriched: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
}

interface ScanJobRow {
  id: number;
  status: string;
  mode: string;
  photo_key: string;
  raw_titles: string | null;
  enriched: string | null;
  error: string | null;
  created_at: string;
  processed_at: string | null;
  reviewed_at: string | null;
}

function mapRow(r: ScanJobRow): ScanJob {
  return {
    id: r.id,
    status: r.status as ScanJobStatus,
    mode: r.mode as ScanJobMode,
    photoKey: r.photo_key,
    rawTitles: r.raw_titles,
    enriched: r.enriched,
    error: r.error,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    reviewedAt: r.reviewed_at,
  };
}

export async function createScanJob(
  db: D1Database,
  input: { photoKey: string; mode: ScanJobMode },
): Promise<ScanJob> {
  const row = await db
    .prepare(
      `INSERT INTO scan_job (photo_key, mode) VALUES (?1, ?2)
       RETURNING *`,
    )
    .bind(input.photoKey, input.mode)
    .first<ScanJobRow>();

  if (!row) throw new Error('Failed to create scan job');
  return mapRow(row);
}

export async function getScanJob(db: D1Database, id: number): Promise<ScanJob | null> {
  const row = await db
    .prepare('SELECT * FROM scan_job WHERE id = ?')
    .bind(id)
    .first<ScanJobRow>();
  return row ? mapRow(row) : null;
}

export async function listScanJobs(
  db: D1Database,
  filter?: { status?: ScanJobStatus },
): Promise<ScanJob[]> {
  let sql = 'SELECT * FROM scan_job';
  const binds: unknown[] = [];

  if (filter?.status) {
    sql += ' WHERE status = ?1';
    binds.push(filter.status);
  }

  sql += ' ORDER BY created_at DESC LIMIT 50';

  const stmt = binds.length > 0
    ? db.prepare(sql).bind(...binds)
    : db.prepare(sql);

  const { results } = await stmt.all<ScanJobRow>();
  return results.map(mapRow);
}

/**
 * One page of the scan history — every job ever, newest first.
 *
 * The queue (`listScanJobs`) is a *working* view and caps at 50 because a queue
 * longer than that has stopped being a queue. History is the opposite claim:
 * a finished job is marked `done` and never deleted, precisely so that "which
 * photo produced this game?" stays answerable — so this walks the whole table,
 * paged, with no status filter. Auto-deleting finished jobs was considered and
 * rejected; the row is the only record, and this query is what the row is for.
 */
export const SCAN_HISTORY_PAGE_SIZE = 20;

export interface ScanJobHistoryPage {
  jobs: ScanJob[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Where a requested page actually lands, given how many rows exist.
 *
 * The same forgiveness the collection pager has (see `listItemTrees`): asking
 * for page 9 of 5 gets the last page, not an empty one — a stale link should
 * land somewhere. Pure and exported so the arithmetic is testable without a
 * database.
 */
export function historyPagePosition(
  requested: number | undefined,
  total: number,
  pageSize: number = SCAN_HISTORY_PAGE_SIZE,
): { page: number; pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(requested ?? 1, 1), pageCount);
  return { page, pageCount, offset: (page - 1) * pageSize };
}

export async function listScanJobHistory(
  db: D1Database,
  query?: { page?: number },
): Promise<ScanJobHistoryPage> {
  const pageSize = SCAN_HISTORY_PAGE_SIZE;

  const counted = await db
    .prepare('SELECT COUNT(*) AS total FROM scan_job')
    .first<{ total: number }>();
  const total = counted?.total ?? 0;

  const { page, pageCount, offset } = historyPagePosition(query?.page, total, pageSize);

  if (total === 0) {
    return { jobs: [], total: 0, page: 1, pageSize, pageCount: 1 };
  }

  // `id DESC` is not decoration: `created_at` is second-resolution, and a
  // multi-photo upload creates several jobs inside one second. Without the
  // tiebreak their order is undefined per query, and a row could show on two
  // pages — or neither — as the reader pages through.
  const { results } = await db
    .prepare(
      `SELECT * FROM scan_job
       ORDER BY created_at DESC, id DESC
       LIMIT ?1 OFFSET ?2`,
    )
    .bind(pageSize, offset)
    .all<ScanJobRow>();

  return { jobs: results.map(mapRow), total, page, pageSize, pageCount };
}

/** Jobs waiting for vision processing or enrichment. */
export async function listPendingJobs(db: D1Database): Promise<ScanJob[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM scan_job
       WHERE status IN ('uploaded', 'read')
       ORDER BY created_at ASC LIMIT 20`,
    )
    .all<ScanJobRow>();
  return results.map(mapRow);
}

/** Jobs ready for user review. */
export async function listReviewableJobs(db: D1Database): Promise<ScanJob[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM scan_job WHERE status = 'review' ORDER BY created_at DESC LIMIT 50`,
    )
    .all<ScanJobRow>();
  return results.map(mapRow);
}

/** Which job turned a scanned title into which catalog item. */
export interface AddedItemSource {
  itemId: number;
  jobId: number;
  mode: ScanJobMode;
}

/**
 * Every "this title became that item" a review screen has ever recorded.
 *
 * Read so a job can say *why* one of its rows is already resolved. "Already
 * yours" is not enough when the reason is that the owner added it from a
 * different photo two minutes ago — that reads as the app losing their work,
 * where "added from another photo" reads as progress.
 *
 * ⚠️ **This is derived from decisions, never from a snapshot.** `addedItemId` is
 * a thing a person did and is stored; whether the catalog holds the game is a
 * fact about the catalog and is computed. Do not be tempted to write a
 * `resolvedFrom` column — that is the bug this whole change is undoing.
 *
 * Done in SQL with `json_each` rather than by parsing fifty `enriched` blobs in
 * the Worker, because those blobs run to 23 KB apiece and the answer is two
 * integers per added game. `json_valid` guards the join: one malformed row
 * would otherwise fail the whole statement and take the queue screen with it.
 */
export async function listAddedItemSources(db: D1Database): Promise<AddedItemSource[]> {
  const { results } = await db
    .prepare(
      `SELECT CAST(json_extract(t.value, '$.addedItemId') AS INTEGER) AS item_id,
              j.id   AS job_id,
              j.mode AS mode
       FROM scan_job j, json_each(j.enriched) t
       WHERE j.enriched IS NOT NULL
         AND json_valid(j.enriched)
         AND json_extract(t.value, '$.addedItemId') IS NOT NULL`,
    )
    .all<{ item_id: number; job_id: number; mode: string }>();

  return results.map((r) => ({
    itemId: r.item_id,
    jobId: r.job_id,
    mode: r.mode as ScanJobMode,
  }));
}

export async function updateScanJobStatus(
  db: D1Database,
  id: number,
  status: ScanJobStatus,
  extra?: { rawTitles?: string; enriched?: string; error?: string },
): Promise<ScanJob | null> {
  const sets = ['status = ?2'];
  const binds: unknown[] = [id, status];
  let idx = 3;

  /*
   * `processed_at` is the heartbeat, which is why `enriching` is in this list.
   *
   * Enrichment now runs a bounded chunk at a time and re-enters this function on
   * every one, so a job that is genuinely working keeps moving the timestamp
   * forward. Without that there is no way to tell a job mid-lookup from one
   * whose invocation was killed — and being unable to tell them apart is what
   * left three shelves sitting at `enriching` for twenty minutes looking busy.
   */
  if (
    status === 'read' ||
    status === 'enriching' ||
    status === 'review' ||
    status === 'done'
  ) {
    sets.push(`processed_at = datetime('now')`);
  }
  if (status === 'done') {
    sets.push(`reviewed_at = datetime('now')`);
  }

  if (extra?.rawTitles !== undefined) {
    sets.push(`raw_titles = ?${idx}`);
    binds.push(extra.rawTitles);
    idx++;
  }
  if (extra?.enriched !== undefined) {
    sets.push(`enriched = ?${idx}`);
    binds.push(extra.enriched);
    idx++;
  }
  if (extra?.error !== undefined) {
    sets.push(`error = ?${idx}`);
    binds.push(extra.error);
    idx++;
  }

  const row = await db
    .prepare(`UPDATE scan_job SET ${sets.join(', ')} WHERE id = ?1 RETURNING *`)
    .bind(...binds)
    .first<ScanJobRow>();

  return row ? mapRow(row) : null;
}

export async function deleteScanJob(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM scan_job WHERE id = ?').bind(id).run();
  return (result.meta?.changes ?? 0) > 0;
}
