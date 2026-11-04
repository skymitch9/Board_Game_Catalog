import type { WishlistEntry } from '@bgc/core';

/**
 * The header of the wishlist's "On the way" section — the one line somebody
 * sees while the section is shut, which is how it starts.
 *
 * *"In the board game site the pre-orders don't go to the wishlist for marking
 * as arrived, like the books do."* — the owner, 2026-11-03. Measured that day:
 * 123 preordered rows (132 units) across 27 pledges, against 25 wanted rows. So
 * the section starts shut and this line is the whole of it until tapped; it has
 * to say how much is behind it.
 *
 * Counts **rows** ("copies") because rows are what is underneath, and adds units
 * only when they differ — the same rule the wanted groups' headers follow.
 * "Pledges" are root games: a pledge arrives as a box holding a game and
 * everything filed under it, which is what the section groups by.
 */
export function onTheWayHeading(entries: readonly WishlistEntry[]): string {
  const rows = entries.length;
  const units = entries.reduce((sum, e) => sum + e.quantity, 0);
  const pledges = new Set(entries.map((e) => e.rootGameId ?? e.itemId)).size;

  let text =
    `On the way · ${rows} ${rows === 1 ? 'copy' : 'copies'} across ` +
    `${pledges} ${pledges === 1 ? 'pledge' : 'pledges'}`;
  if (units !== rows) text += ` · ${units} units`;
  return text;
}
