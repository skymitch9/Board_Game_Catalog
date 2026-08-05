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

// ---------------------------------------------------------------------------
// Photo cache — "have we already looked at this exact box?"
// ---------------------------------------------------------------------------

export type PhotoMode = 'identify' | 'shelf';

/**
 * How long a photo reading stays trustworthy.
 *
 * Much shorter than the title cache. A title resolves to the same game
 * indefinitely; a *photo* only means "this is what was in front of the camera",
 * and a shelf gets rearranged. A day covers the case this exists for — shooting
 * the same box twice in one cataloguing session — without pretending a reading
 * from last week still describes the shelf.
 */
const PHOTO_TTL_HOURS = 24;

/** How many recent rows to compare against. Hamming distance cannot be indexed. */
const PHOTO_SCAN_LIMIT = 300;

/**
 * Find a recent photo whose difference hash is close enough to count as the same
 * subject.
 *
 * Returns the *nearest* match rather than the first under the threshold, because
 * a shelf holds several similar-looking boxes and "close enough" is not the same
 * as "closest".
 */
export async function getCachedPhoto<T>(
  db: D1Database,
  mode: PhotoMode,
  hash: string,
  maxDistance: number,
  distance: (a: string, b: string) => number,
): Promise<T | null> {
  if (!hash) return null;

  const { results } = await db
    .prepare(
      `SELECT hash, payload FROM photo_cache
        WHERE mode = ? AND created_at > datetime('now', ?)
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(mode, `-${PHOTO_TTL_HOURS} hours`, PHOTO_SCAN_LIMIT)
    .all<{ hash: string; payload: string }>();

  let best: { payload: string; d: number } | null = null;
  for (const row of results) {
    const d = distance(hash, row.hash);
    if (d <= maxDistance && (!best || d < best.d)) best = { payload: row.payload, d };
    if (best?.d === 0) break;
  }
  if (!best) return null;

  try {
    return JSON.parse(best.payload) as T;
  } catch {
    return null;
  }
}

/** Best-effort, like the rest of the cache: a failed write must not fail the read. */
export async function putCachedPhoto(
  db: D1Database,
  mode: PhotoMode,
  hash: string,
  payload: unknown,
): Promise<void> {
  if (!hash) return;
  try {
    await db
      .prepare(
        `INSERT INTO photo_cache (hash, mode, payload, created_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(hash, mode) DO UPDATE
           SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .bind(hash, mode, JSON.stringify(payload))
      .run();
  } catch {
    // Ignored on purpose.
  }
}
