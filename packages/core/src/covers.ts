/**
 * Whose picture a row shows when it has none of its own.
 *
 * A leaf module: it imports a type from `details.ts` and nothing else, so the
 * database layer and the web app can both build on it. See `constants.ts` for
 * why the import order in this package matters.
 *
 * ## Why this exists
 *
 * *"for 161 just use the base game photo, maybe we should use that as a default
 * fallback so no matter what everything has an image"* — the owner, about Deep
 * Rock Galactic: Barrel Flick Game.
 *
 * Measured against production's 760 rows: **437 have a cover of their own, 322
 * have an ancestor that does, and exactly one has neither** (Excursion Tiles 1,
 * a standalone accessory with no parent to borrow from). So the fallback is not
 * a rare rescue — it is what three hundred rows in the collection will show.
 *
 * ## The two rules, and why each is the way it is
 *
 * 1. **Nearest ancestor, not the root.** A Dice Throne hero's playmat takes the
 *    hero's art before the box's, because the hero is the more specific answer
 *    to "what is this a picture of". Walking to the root would put the same
 *    Marvel Dice Throne box on all fifty-five of them.
 * 2. **Resolved at read time, never written.** The same reasoning as
 *    `INHERITED_FIELDS` in `details.ts`, plus one more that is specific to
 *    covers: a stored URL would be probed by the cover-health cron twice an hour
 *    for every row that copied it, so 322 rows would turn one dead link into
 *    323 alarms. Nothing here writes; `thumbnail_url` stays NULL until the row
 *    genuinely has art of its own, and the day it does the borrowed picture
 *    simply stops being used.
 *
 * ## What it does *not* do
 *
 * It does not distinguish "nobody has looked for a cover" from "there is no
 * cover to find". That distinction was considered and dropped: with 322 of the
 * 323 blanks now answered by an ancestor, it would be a column carrying one row.
 */

import type { InheritedDetail } from './details.js';

/** Enough of an ancestor to lend its picture. */
export interface CoverLender {
  id: number;
  name: string;
  thumbnailUrl: string | null;
}

/** True for null, undefined, and a string of nothing but spaces. */
function blank(url: string | null | undefined): boolean {
  return url == null || url.trim() === '';
}

/**
 * The picture this row borrows, or null when it needs none and when none exists.
 *
 * `ancestors` must be **nearest first** — the parent, then the grandparent. Both
 * callers produce that order already: the recursive CTE in
 * `resolveInheritedDetails` orders by depth, and the tree walker in `buildTrees`
 * pushes each node's parent on the front as it descends.
 *
 * Returns null for a row that has its own cover, so a caller can treat a
 * non-null answer as "this picture belongs to something else" without a second
 * test — which is exactly the condition the item page needs in order to say so.
 */
export function inheritCover(
  own: string | null,
  ancestors: readonly CoverLender[],
): InheritedDetail | null {
  if (!blank(own)) return null;
  const source = ancestors.find((a) => !blank(a.thumbnailUrl));
  if (!source) return null;
  return { value: source.thumbnailUrl as string, fromItemId: source.id, fromName: source.name };
}
