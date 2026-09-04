/**
 * Where a scan LANDS — the shelf, or the wishlist.
 *
 * ## ⚠️ WHY THIS EXISTS, IN THE OWNER'S WORDS
 *
 * 2026-09-04, from his phone: *"let's add that when you scan something you can
 * add it to library or wishlist. Do this for both games and the libraries."*
 * The library catalog shipped its half the same morning; this is that switch,
 * ported to the games catalog, from `library_catalog/apps/web/src/lib/scan-target.ts`.
 *
 * What "can't" meant there was true here too: a wishlist add DID exist — the
 * completeness report's *+ Wishlist* button and the wishlist page's own
 * `WishlistAdd` / `WishlistScan` door — but `/scan` has written
 * `status: 'owned'` on every copy it has ever created, so a barcode in a shop
 * could only ever mean "I own this".
 *
 * ## ⚠️ ONE CHOICE PER SWEEP, NOT ONE PER GAME
 *
 * The standing complaint about the scan screen is taps, and somebody walking a
 * shop with a list is doing ONE thing. Ten scans is one tap, not ten. The
 * per-game answer already exists on the *Manually* tab, whose full status
 * dropdown asks the question outright — which is why this switch is not drawn
 * over it (see `ScanPage`).
 *
 * ## ⚠️ SESSION storage, not local
 *
 * The difference is deliberate and is about what the choice MEANS:
 *
 * | | remembered | why |
 * |---|---|---|
 * | A habit (a theme, a default view) | across visits (`localStorage`) | it is who you are |
 * | Target (this file) | for the session (`sessionStorage`) | an ERRAND — you are in a shop right now, and tomorrow you are not |
 *
 * ⚠️ `shelf` must stay the default: it is what every scan has written since the
 * feature existed, and a remembered wishlist target that outlived the shop trip
 * would silently stop recording games that are physically in the person's
 * hands.
 */

import type { CopyStatus } from '@bgc/core';

/** The two things a scan can mean. */
export type ScanTarget = 'shelf' | 'wishlist';

export const SCAN_TARGETS: readonly ScanTarget[] = ['shelf', 'wishlist'];

/** ⚠️ Not a preference — a compatibility promise. See the header. */
export const DEFAULT_SCAN_TARGET: ScanTarget = 'shelf';

/**
 * Per-browser, per-SESSION.
 *
 * ⚠️ The key follows THIS app's own convention — `bgc.coverBannerDismissed` in
 * `CoverHealthBanner.tsx` is the only other key this app owns, and it is dotted
 * camelCase under a `bgc.` prefix — rather than the library catalog's
 * `lc_scan_target_v1`. Same reasoning, different house style: somebody clearing
 * "the catalog's keys" out of a browser finds all of them under one prefix.
 */
const KEY = 'bgc.scanTarget';

/** The word on the button, and the word in the sentence under it. */
export const TARGET_LABEL: Record<ScanTarget, string> = {
  shelf: 'Shelf',
  wishlist: 'Wishlist',
};

/** Is this string one of the two targets? */
export function isScanTarget(value: unknown): value is ScanTarget {
  return typeof value === 'string' && (SCAN_TARGETS as readonly string[]).includes(value);
}

/**
 * The remembered choice, or `shelf`.
 *
 * ⚠️ Never throws and never rejects loudly: an unreadable value degrades to
 * `shelf`, which is what this code did before the target existed — so the worst
 * case of the persistence failing is the old behaviour, not a broken screen. A
 * private-mode browser throws on the accessor itself, and storage is
 * user-writable, so the value is validated on every read.
 */
export function loadScanTarget(): ScanTarget {
  try {
    const raw = sessionStorage.getItem(KEY);
    return isScanTarget(raw) ? raw : DEFAULT_SCAN_TARGET;
  } catch {
    return DEFAULT_SCAN_TARGET;
  }
}

export function saveScanTarget(target: ScanTarget): void {
  try {
    sessionStorage.setItem(KEY, target);
  } catch {
    /* private mode. Not worth telling anyone about — the sweep still works. */
  }
}

/**
 * The `copy.status` a scan writes.
 *
 * ⚠️ **The one place the mapping is written.** `ScanPage` held the string
 * `'owned'` inline, which is exactly how a second write path silently keeps the
 * old behaviour when a feature like this arrives.
 *
 * `preordered` is deliberately NOT reachable from here: a pre-order is a want
 * somebody has already paid for, and a barcode in a shop is not evidence of a
 * payment. Neither are `lent` or `sold`, which are things that happen to a copy
 * you already have.
 *
 * ⚠️ `wanted` is also the status the Worker gates on `suggestWishlist`
 * (`routes/catalog.ts` — `status === 'wanted' ? 'suggestWishlist' : 'editCatalog'`),
 * which is why the switch is drawn against that same capability and not a
 * guess at it.
 */
export function copyStatusFor(target: ScanTarget): Extract<CopyStatus, 'owned' | 'wanted'> {
  return target === 'wishlist' ? 'wanted' : 'owned';
}

/** The label on a scan row's add button — the action, named. */
export function addActionLabel(target: ScanTarget): string {
  return target === 'wishlist' ? 'Add to wishlist' : 'Add';
}

/**
 * The shelf-photo review screen's one button, which adds a whole batch.
 *
 * ⚠️ Not in the library catalog's copy of this module, because its bulk path
 * adds row by row. Here the count is in the button, so the words about WHERE
 * they land have to be in the same string or the switch's promise is silently
 * dropped on the one screen that adds the most rows at once.
 */
export function bulkAddLabel(target: ScanTarget, count: number): string {
  const games = `${count} game${count === 1 ? '' : 's'}`;
  return target === 'wishlist' ? `Add ${games} to wishlist` : `Add ${games}`;
}

/** The one line under the switch. */
export function targetSentence(target: ScanTarget, subject = 'Scanned games'): string {
  return target === 'wishlist'
    ? `${subject} go on your wishlist — a want, not a copy you own.`
    : `${subject} go on your shelf.`;
}

/**
 * What a settled row says it did.
 *
 * ⚠️ Each outcome keeps its own words: "Added" over a want would claim a game
 * is on the shelf.
 *
 * ⚠️ Deliberately a plain target, where the library catalog's version takes an
 * object (`arrived`, `summary`, `owned`). Both of those outrank the target
 * there because they are outcomes of a pre-order prompt and a rescan question
 * that this screen does not have — inventing the parameters here would be three
 * arguments no caller can ever set.
 */
export function addedLabel(target: ScanTarget): string {
  return target === 'wishlist' ? 'Added to wishlist' : 'Added';
}
