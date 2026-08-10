/**
 * How much maintenance work the catalog is currently carrying.
 *
 * Two screens exist only to be emptied — "Related games" (`/retag`) and
 * "Missing details" (`/details`) — and a permanent nav slot each is a poor
 * trade when both are usually empty. So the nav draws them only while they
 * have something outstanding, which needs a count before either page is open.
 *
 * ## Why this rides on `/api/me`
 *
 * The nav lives in `App.tsx`, which already fetches `/api/me` once at startup
 * and renders nothing until it lands. Two extra round trips on every page load,
 * purely to decide whether to draw a link, would cost more than the links are
 * worth. Folding two integers into a payload already on the wire costs three
 * D1 reads and no requests.
 *
 * The consequence, which is the honest trade: **the counts are as of the last
 * full page load.** Clear the details queue and come back and the nav still
 * offers it until something reloads the app. A stale link to an empty screen is
 * mildly annoying; a link that vanished while you were mid-task would be worse.
 *
 * ## Only for people who can act on them
 *
 * The first two screens write to the catalog, so a reader is never offered
 * either and never pays for the count. `pendingUsers` answers to `manageUsers`
 * instead, so `/api/me` asks for the set when the role holds **either**
 * capability. Both are owner-only today and the union is the same thing; it is
 * written as a union so that splitting the roles later cannot silently hide a
 * count from someone who can act on it.
 */

import { suggestRetags } from '@bgc/core';
import {
  countItemsNeedingDetails,
  countPendingUsers,
  listRelationPairs,
  listTopLevelItems,
} from '@bgc/db';

export interface Chores {
  /** Top-level games whose name says they belong to another, not yet answered. */
  relatedGames: number;
  /** Games with blanks that nobody has paid to look up yet. */
  missingDetails: number;
  /**
   * People stuck on the holding screen waiting to be let in.
   *
   * Unlike the other two, nothing else in the app mentions these at all — there
   * is no email and no push, and the People link looked identical whether
   * nobody or six people were waiting. Somebody could sit on that screen
   * indefinitely while the owner had no way of knowing.
   */
  pendingUsers: number;
}

/**
 * The same two questions the two pages ask, counted rather than listed.
 *
 * `suggestRetags` needs the whole top-level list to run — it matches every
 * name's leading fragments against every other name — but that is 114 rows on
 * this catalog and one query, not a per-row lookup. It already drops pairs that
 * are linked, so a zero here genuinely means there is nothing to answer.
 */
export async function outstandingChores(db: D1Database): Promise<Chores> {
  const [items, pairs, missingDetails, pendingUsers] = await Promise.all([
    listTopLevelItems(db),
    listRelationPairs(db),
    countItemsNeedingDetails(db),
    countPendingUsers(db),
  ]);
  return { relatedGames: suggestRetags(items, pairs).length, missingDetails, pendingUsers };
}
