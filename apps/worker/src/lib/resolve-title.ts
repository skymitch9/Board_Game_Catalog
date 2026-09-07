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
/**
 * How many runners-up are worth keeping.
 *
 * The review screen offers them when the top answer looks wrong, and a list
 * nobody will read to the bottom is just payload — the whole `enriched` blob
 * rides on every poll of the queue.
 */
const KEEP_CANDIDATES = 5;

/**
 * Read the stored answer for a title, or `null` if there is not one.
 *
 * ⚠️ **A stored `null` is an answer** — "we asked, and this game does not
 * exist" — and it comes back as `[]`, not as a miss. That is the whole reason
 * this reads through `getCachedEntry` rather than `getCached`: the latter
 * cannot tell a stored `null` from an empty cache, and a caller that confuses
 * them re-runs the full ladder on every keystroke for every title that does not
 * exist.
 *
 * Exported so a caller that must report *whether* it was cached (the
 * `/api/lookup` route says so in its body) does not have to hand-roll a second
 * copy of the read and the shape-normalisation below.
 */
export async function readCachedTitle(
  db: D1Database,
  title: string,
): Promise<BarcodeCandidate[] | null> {
  const cached = await getCachedEntry<BarcodeCandidate[] | BarcodeCandidate | null>(
    db,
    'title',
    title,
  );
  if (!cached) return null;
  const value = cached.value;
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The best answer, and the runners-up a person may prefer at review. */
export async function cachedResolve(
  db: D1Database,
  deps: ResolveDeps,
  title: string,
  options?: {
    /**
     * Skip the cache read and re-ask.
     *
     * For the "try this one again" button on a review screen. A person pressing
     * it has looked at the result and decided it is wrong, which is better
     * evidence than a week-old cache entry — and if the answer really is
     * unchanged, the write below simply refreshes it.
     */
    force?: boolean;
  },
): Promise<BarcodeCandidate | null> {
  return (await cachedResolveAll(db, deps, title, options))[0] ?? null;
}

/**
 * The same lookup, keeping the runners-up.
 *
 * The review screen needs them because the top answer being wrong does not mean
 * the lookup knew nothing — GameUPC hands back a ranked list, and the game the
 * owner is holding is often second. Offering only the winner made "no" the
 * owner's only available answer.
 *
 * **The cache entry can be either shape.** It used to hold a single candidate;
 * it now holds the list. A stored object is read as a one-element list rather
 * than being invalidated, so a week of existing entries stay useful and simply
 * offer no alternatives until they expire.
 */
export async function cachedResolveAll(
  db: D1Database,
  deps: ResolveDeps,
  title: string,
  options?: { force?: boolean },
): Promise<BarcodeCandidate[]> {
  if (!options?.force) {
    const cached = await readCachedTitle(db, title);
    if (cached) return cached;
  }

  // With no GameUPC config there is no ladder to run, and `resolveTitle` says
  // so by returning nothing. Caching that would pin a week of empty answers in
  // place the moment a key is configured, so leave the cache untouched.
  if (!deps.gameUpc) return [];

  const hit = await resolveTitle(deps, title);
  const candidates = hit.candidates.slice(0, KEEP_CANDIDATES);

  // A lookup that could not run tells us nothing about the game, so it must not
  // be remembered as if it had. Caching a quota exhaustion or a 5xx would pin
  // "this game does not exist" in place for a week — and the week you are most
  // likely to blow the shared UPCitemdb quota is the week you are bulk-scanning
  // a shelf, which is exactly when you can least afford it.
  if (hit.failed) return candidates;

  // Only cache once BGG hydration has had its chance, or a week of lookups
  // would be pinned to the un-hydrated shape from before the token arrived.
  if (candidates.length === 0 || hit.bggHydrated || !deps.bggToken) {
    await putCached(db, 'title', title, candidates.length > 0 ? candidates : null);
  }
  return candidates;
}
