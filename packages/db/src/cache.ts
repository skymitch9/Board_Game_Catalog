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

/**
 * Read an entry, distinguishing "we have no answer" from "the answer is null".
 *
 * `getCached` cannot tell those apart — both come back as `null` — so a lookup
 * that legitimately resolved to *nothing found* reads back exactly like an
 * empty cache and gets asked again. That is the wrong way round: a title that
 * resolves to nothing is precisely the one worth remembering, because it will
 * otherwise re-run the whole free ladder on every pass, and UPCitemdb's free
 * quota is 100/day for the entire Worker rather than per person.
 *
 * `null` here means miss. `{ value }` means hit, and `value` may itself be null.
 */
export async function getCachedEntry<T>(
  db: D1Database,
  kind: CacheKind,
  raw: string,
): Promise<{ value: T } | null> {
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
    return { value: JSON.parse(row.payload) as T };
  } catch {
    // A corrupt row should behave exactly like a miss, never like an error.
    return null;
  }
}

/**
 * The convenient form, for callers that never store a null payload. If you
 * cache negative results, reach for `getCachedEntry` instead.
 */
export async function getCached<T>(
  db: D1Database,
  kind: CacheKind,
  raw: string,
): Promise<T | null> {
  const entry = await getCachedEntry<T>(db, kind, raw);
  return entry ? entry.value : null;
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
// Maintenance
// ---------------------------------------------------------------------------

export interface CacheStats {
  titles: number;
  barcodes: number;
  /** Oldest surviving entry, so "is anything stale in here?" is answerable. */
  oldest: string | null;
}

export async function cacheStats(db: D1Database): Promise<CacheStats> {
  const [lookup] = await db.batch([
    db.prepare(
      `SELECT kind, COUNT(*) AS n, MIN(created_at) AS oldest
         FROM lookup_cache GROUP BY kind`,
    ),
  ]);

  const rows = (lookup?.results ?? []) as { kind: string; n: number; oldest: string | null }[];

  const oldest = rows.map((r) => r.oldest)
    .filter((v): v is string => !!v)
    .sort()[0];

  return {
    titles: rows.find((r) => r.kind === 'title')?.n ?? 0,
    barcodes: rows.find((r) => r.kind === 'barcode')?.n ?? 0,
    oldest: oldest ?? null,
  };
}

export type CacheTarget = 'all' | 'lookups';

/**
 * Empty a cache.
 *
 * Worth being clear about what this does *not* touch: the catalog. Everything
 * here is "we asked the internet this before" — deleting it costs a repeat
 * lookup and nothing else, which is exactly why it is safe to offer as a button.
 */
export async function clearCache(db: D1Database, target: CacheTarget): Promise<number> {
  let removed = 0;
  if (target === 'all' || target === 'lookups') {
    const res = await db.prepare('DELETE FROM lookup_cache').run();
    removed += res.meta.changes ?? 0;
  }
  return removed;
}
