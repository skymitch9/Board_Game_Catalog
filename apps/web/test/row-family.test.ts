/**
 * `lib/row-family.ts` — when a collection row wears its family chip.
 *
 * The chip's *membership* rule is not tested here and is not implemented here:
 * it is `ROOT_GROUP_CTE` in `packages/db/src/items.ts`, pinned against a real
 * schema in `packages/db/test/row-family.test.ts`. What this file pins is the
 * half that decides whether saying it helps on the screen you are on — and, in
 * particular, the promise that **a row with no family renders exactly as it did
 * before the chip existed**, which is the regression that would reach every one
 * of the catalog's rows at once.
 *
 * NOT proved here: that `ItemCard` draws the chip, that the link is focusable,
 * or that anything at all appears on the page. There is no component-rendering
 * harness in this repo — same caveat as `enriched.test.ts` beside it.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { ItemFamilyRef, ItemNode } from '@bgc/core';
import { familyToShow } from '../src/lib/row-family';

const DICE_THRONE: ItemFamilyRef = {
  key: 'series:Dice Throne',
  axis: 'series',
  name: 'Dice Throne',
  lines: 11,
  items: 147,
};

/** The two fields this decision reads, over a node the type system accepts. */
function row(family?: ItemFamilyRef): ItemNode {
  return { id: 1, name: 'Marvel Dice Throne', copies: [], children: [], family } as unknown as ItemNode;
}

describe('familyToShow — the chip appears where it says something', () => {
  it('names the family when the row has one', () => {
    assert.deepEqual(familyToShow(row(DICE_THRONE)), DICE_THRONE);
  });

  it('🔴 a row with NO family is null — every such row renders as it always did', () => {
    assert.equal(familyToShow(row()), null);
    // And an active filter cannot conjure one onto it.
    assert.equal(familyToShow(row(), 'series:Dice Throne'), null);
  });

  it('stays silent while the collection is already filtered to that family', () => {
    assert.equal(familyToShow(row(DICE_THRONE), 'series:Dice Throne'), null);
  });

  it('but speaks up inside a DIFFERENT family, and while searching', () => {
    assert.deepEqual(familyToShow(row(DICE_THRONE), 'series:Catan'), DICE_THRONE);
    // No filter at all is the search case — `activeGroup` is the empty string
    // the URL parses to, not undefined, so both spellings are checked.
    assert.deepEqual(familyToShow(row(DICE_THRONE), ''), DICE_THRONE);
    assert.deepEqual(familyToShow(row(DICE_THRONE), undefined), DICE_THRONE);
  });

  it('⚠️ compares the whole key, not the name — series and system are different families', () => {
    // A system that happens to share a series' name must not silence it: the
    // key carries the axis, which is exactly why the comparison is on the key.
    assert.deepEqual(familyToShow(row(DICE_THRONE), 'system:Dice Throne'), DICE_THRONE);
  });
});
