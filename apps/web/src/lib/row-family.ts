/**
 * Whether a collection row should wear its family chip, and what it says.
 *
 * ⚠️ **The membership rule is NOT here, and must never be reimplemented here.**
 * `node.family` arrives already decided by `ROOT_GROUP_CTE` in
 * `packages/db/src/items.ts` — the one rule `GroupCard` folds on, tested in
 * `packages/db/test/row-family.test.ts` — so a row can never claim a family the
 * collection page would refuse to fold. A `series` column read directly here
 * would be that second rule, and would put a chip on the 4 lines whose series
 * nothing else shares.
 *
 * What is left for this file is the only question the database cannot answer:
 * is saying it **useful on the screen you are on**.
 */
import type { ItemFamilyRef, ItemNode } from '@bgc/core';

/**
 * The family worth naming on this row, or `null` for no chip at all.
 *
 * `null` in two cases, and the first is the common one:
 *
 * 1. **The row has no family** — no series or system, or one nothing else
 *    shares. Most of the catalog, and the row renders exactly as it did before
 *    the chip existed.
 * 2. **The collection is already filtered to that family.** Eleven Dice Throne
 *    rows each captioned "Dice Throne · 11 lines", every one of them linking to
 *    the page you are standing on, is the filter read back to you eleven times.
 *
 * `activeGroup` is the URL's own `group` value (`series:Dice Throne`), compared
 * against the same key the chip would link to — one string, both ends.
 */
export function familyToShow(node: ItemNode, activeGroup?: string): ItemFamilyRef | null {
  if (!node.family) return null;
  return node.family.key === activeGroup ? null : node.family;
}
