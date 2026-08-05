import { normaliseBarcode, normaliseTitle } from '@bgc/core';

/**
 * A small cache for external lookups.
 *
 * Resolving a title is deterministic and costs a round trip, so re-photographing
 * the same shelf was paying for the same nine answers again. This remembers them.
 *
 * What it deliberately does *not* cache: the vision call. A new photo is
 * genuinely new input, and pretending otherwise would mean hashing images and
 * returning stale readings for a shelf that has since changed.
 */

export type CacheKind = 'barcode' | 'title';

/**
 * A week. Long enough that a cataloguing session and its follow-ups all hit,
 * short enough that GameUPC's crowdsourced data — which improves as people
 * confirm matches, including ours — gets picked up again reasonably soon.
 */
const TTL_DAYS = 7;

/** Fold the question so two spellings of it share one row. */
export function cacheKey(kind: CacheKind, raw: string): string {
  return kind === 'barcode' ? normaliseBarcode(raw) : normaliseTitle(raw);
}

export async function getCached<T>(
  db: D1Database,
  kind: CacheKind,
  raw: string,
): Promise<T | null> {
  const key = cacheKey(kind, raw);
  if (!key) return null;

  const row = await db
    .prepare(
      `SELECT payload FROM lookup_cache
        WHERE kind = ? AND key = ?
          AND created_at > datetime('now', ?)`,
    )
    .bind(kind, key, `-${TTL_DAYS} days`)
    .first<{ payload: string }>();

  if (!row) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    // A corrupt row should behave exactly like a miss, never like an error.
    return null;
  }
}

/**
 * Store a result. Best-effort by design: a cache write failing must never fail
 * the lookup that produced it.
 */
export async function putCached(
  db: D1Database,
  kind: CacheKind,
  raw: string,
  payload: unknown,
): Promise<void> {
  const key = cacheKey(kind, raw);
  if (!key) return;

  try {
    await db
      .prepare(
        `INSERT INTO lookup_cache (kind, key, payload, created_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(kind, key) DO UPDATE
           SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .bind(kind, key, JSON.stringify(payload))
      .run();
  } catch {
    // Ignored on purpose — see the doc comment.
  }
}

/** Drop everything past its TTL. Nothing calls this on a schedule yet. */
export async function sweepCache(db: D1Database): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM lookup_cache WHERE created_at <= datetime('now', ?)`)
    .bind(`-${TTL_DAYS} days`)
    .run();
  return res.meta.changes ?? 0;
}
