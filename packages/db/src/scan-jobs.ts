/**
 * Scan jobs — photo upload queue with progressive enrichment.
 *
 * A photo is uploaded → vision reads titles → free lookups enrich →
 * results land in a review queue for the user to confirm.
 */

export type ScanJobStatus =
  | 'uploaded'
  | 'reading'
  | 'read'
  | 'enriching'
  | 'review'
  | 'done'
  | 'failed';

export type ScanJobMode = 'shelf' | 'single';

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

export async function updateScanJobStatus(
  db: D1Database,
  id: number,
  status: ScanJobStatus,
  extra?: { rawTitles?: string; enriched?: string; error?: string },
): Promise<ScanJob | null> {
  const sets = ['status = ?2'];
  const binds: unknown[] = [id, status];
  let idx = 3;

  if (status === 'read' || status === 'review' || status === 'done') {
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
