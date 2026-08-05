import type { BarcodeCandidate } from '@bgc/core';
import { resolveTitle, type ResolveDeps } from '@bgc/barcode';
import { getCachedEntry, putCached } from '@bgc/db';

/**
 * Resolve a title to its best candidate, remembering the answer.
 *
 * Re-photographing a shelf used to re-resolve every title on it — nine games,
 * nine round trips, every time. Resolution is deterministic, so it is cached.
 * The vision call that produced the titles is not, and cannot be: a new photo
 * is genuinely new input, and a shelf changes.
 *
 * A miss is cached too, as `null`. Titles that resolve to nothing are exactly
 * the ones you would otherwise re-ask about on every pass — which is why this
 * reads through `getCachedEntry` rather than `getCached`, the latter being
 * unable to tell a stored `null` from an empty cache.
 *
 * The vision route and the scan-job queue both want precisely this, and had a
 * copy each.
 */
export async function cachedResolve(
  db: D1Database,
  deps: ResolveDeps,
  title: string,
): Promise<BarcodeCandidate | null> {
  const cached = await getCachedEntry<BarcodeCandidate | null>(db, 'title', title);
  if (cached) return cached.value;

  // With no GameUPC config there is no ladder to run, and `resolveTitle` says
  // so by returning nothing. Caching that would pin a week of empty answers in
  // place the moment a key is configured, so leave the cache untouched.
  if (!deps.gameUpc) return null;

  const hit = await resolveTitle(deps, title);
  const best = hit.candidates[0] ?? null;
  // Only cache once BGG hydration has had its chance, or a week of lookups
  // would be pinned to the un-hydrated shape from before the token arrived.
  if (best === null || hit.bggHydrated || !deps.bggToken) {
    await putCached(db, 'title', title, best);
  }
  return best;
}
