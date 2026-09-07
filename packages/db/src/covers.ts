import type { CoverHealth, CoverOutcome, DeadCover } from '@bgc/core';

/**
 * Reads and writes for `cover_check` — see migration 0013 for why the table is
 * keyed on the URL rather than on the item.
 *
 * No fetching happens here. This package talks to D1 and nothing else; the
 * probing lives in `apps/worker/src/lib/cover-check.ts`, where the Workers
 * runtime's fetch and its subrequest budget actually are.
 */

/**
 * How many consecutive failures before a cover is reported as dead.
 *
 * Two, not one. A CDN having a bad thirty seconds must not put a banner on the
 * site announcing that the collection's artwork is rotting — the whole value of
 * the notice is that it is worth acting on when it appears.
 */
export const DEAD_AFTER = 2;

/**
 * The same, for failures that never produced a status code.
 *
 * Higher, because "we could not reach it" is much weaker evidence than "the
 * host said 404". But not infinite: a URL whose host has stopped resolving
 * entirely is as broken as one returning 404, and five straight misses across
 * five separate runs is no longer a blip.
 */
export const UNREACHABLE_AFTER = 5;

/**
 * The next slice of cover URLs to probe, least recently checked first.
 *
 * `GROUP BY` rather than `DISTINCT` because several items share one image and
 * each URL must be fetched once, not once per item. Never-checked URLs sort
 * first: `COALESCE(..., '')` puts them before any real timestamp, so a freshly
 * added game's cover is probed on the next run rather than after a full lap of
 * the catalog.
 */
export async function listCoverUrlsToCheck(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT i.thumbnail_url AS url,
              MIN(COALESCE(cc.last_checked_at, '')) AS checked_at
         FROM item i
         LEFT JOIN cover_check cc ON cc.url = i.thumbnail_url
        WHERE i.thumbnail_url IS NOT NULL AND i.thumbnail_url != ''
        GROUP BY i.thumbnail_url
        ORDER BY checked_at ASC, i.thumbnail_url
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ url: string; checked_at: string }>();
  return results.map((r) => r.url);
}

export interface CoverProbeResult {
  url: string;
  outcome: CoverOutcome;
  statusCode: number | null;
  error: string | null;
}

/**
 * The one statement that records a probe — prepared, not run.
 *
 * Split out so a caller can choose between running one and `batch()`ing many
 * without two copies of this SQL drifting apart.
 *
 * The failure counter is maintained in SQL rather than read-modify-written in
 * JS, so two runs overlapping cannot both read 1 and both write 2.
 */
function coverCheckStatement(db: D1Database, r: CoverProbeResult): D1PreparedStatement {
  const ok = r.outcome === 'ok' ? 1 : 0;
  return db
    .prepare(
      `INSERT INTO cover_check
              (url, last_checked_at, status_code, ok, outcome, consecutive_failures, last_error)
       VALUES (?1, datetime('now'), ?2, ?3, ?4, CASE WHEN ?3 = 1 THEN 0 ELSE 1 END, ?5)
       ON CONFLICT(url) DO UPDATE SET
              last_checked_at      = datetime('now'),
              status_code          = ?2,
              ok                   = ?3,
              outcome              = ?4,
              consecutive_failures = CASE WHEN ?3 = 1
                                          THEN 0
                                          ELSE cover_check.consecutive_failures + 1 END,
              last_error           = ?5`,
    )
    .bind(r.url, r.statusCode, ok, r.outcome, r.error);
}

/** Record one probe. */
export async function recordCoverCheck(db: D1Database, r: CoverProbeResult): Promise<void> {
  await coverCheckStatement(db, r).run();
}

/**
 * Record a whole run's probes in **one** D1 call.
 *
 * 🔴 This is a SUBREQUEST fix, not a speed one. A Worker gets 50 subrequests
 * per invocation on the free plan and every D1 statement spends one; a cover
 * run that wrote its verdicts in a loop spent one per URL, which on top of the
 * probes themselves put the worst case at ~62 against that ceiling (the
 * 2026-08 audit's finding 5). ⚠️ **Going over TERMINATES the invocation rather
 * than throwing**, so the tail of a run — the writes, i.e. the entire point of
 * having probed anything — vanished with nothing logged.
 *
 * `db.batch()` sends all of them as a single call, so the write side of a run
 * costs **1** whatever the batch size is. That is what lets
 * `apps/worker/src/lib/cover-check.ts` derive its `COVER_BATCH` from the fetch
 * budget alone.
 *
 * The statements share one implicit transaction, which is also what we want:
 * a run's verdicts are one fact about one moment.
 *
 * An empty array is a no-op — `batch([])` is not worth finding out about.
 */
export async function recordCoverChecks(db: D1Database, rs: CoverProbeResult[]): Promise<void> {
  if (rs.length === 0) return;
  await db.batch(rs.map((r) => coverCheckStatement(db, r)));
}

/** Cover URLs that have never been probed. The run summary's "still to go". */
export async function countUncheckedCovers(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT i.thumbnail_url
           FROM item i
           LEFT JOIN cover_check cc ON cc.url = i.thumbnail_url
          WHERE i.thumbnail_url IS NOT NULL AND i.thumbnail_url != ''
            AND cc.url IS NULL
          GROUP BY i.thumbnail_url)`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * What the banner asks on load.
 *
 * One item per row: two games sharing a dead image are two broken cards and
 * both need fixing, even though only one URL was fetched.
 */
export async function coverHealth(db: D1Database): Promise<CoverHealth> {
  const failing = `(cc.outcome = 'dead'  AND cc.consecutive_failures >= ${DEAD_AFTER})
                OR (cc.outcome = 'error' AND cc.consecutive_failures >= ${UNREACHABLE_AFTER})`;

  const batched = await db.batch([
    db.prepare(
      `SELECT i.id, i.name, i.kind, cc.url, cc.status_code, cc.outcome,
              cc.consecutive_failures, cc.last_checked_at
         FROM cover_check cc
         JOIN item i ON i.thumbnail_url = cc.url
        WHERE ${failing}
        ORDER BY i.sort_name, i.name`,
    ),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM (SELECT 1 FROM item
            WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''
            GROUP BY thumbnail_url))                                    AS total,
         (SELECT COUNT(*) FROM cover_check cc
            WHERE EXISTS (SELECT 1 FROM item i WHERE i.thumbnail_url = cc.url)) AS checked,
         (SELECT COUNT(*) FROM cover_check cc
            WHERE cc.ok = 0 AND NOT (${failing}))                       AS suspect,
         (SELECT MAX(last_checked_at) FROM cover_check)                 AS last_run`,
    ),
  ]);

  type Row = {
    id: number;
    name: string;
    kind: string;
    url: string;
    status_code: number | null;
    outcome: string;
    consecutive_failures: number;
    last_checked_at: string;
  };

  const deadRows = (batched[0]?.results ?? []) as Row[];
  const stats = (batched[1]?.results ?? [])[0] as
    | { total: number; checked: number; suspect: number; last_run: string | null }
    | undefined;

  const dead: DeadCover[] = deadRows.map((r) => ({
    itemId: r.id,
    name: r.name,
    kind: r.kind as DeadCover['kind'],
    url: r.url,
    statusCode: r.status_code,
    outcome: r.outcome as CoverOutcome,
    consecutiveFailures: r.consecutive_failures,
    lastCheckedAt: r.last_checked_at,
  }));

  return {
    dead,
    total: stats?.total ?? 0,
    checked: stats?.checked ?? 0,
    suspect: stats?.suspect ?? 0,
    lastRunAt: stats?.last_run ?? null,
  };
}
