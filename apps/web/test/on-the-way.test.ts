/**
 * `lib/on-the-way.ts` — the shut "On the way" header on the wishlist.
 *
 * NOT proved here: that the section renders, starts shut, or that its buttons
 * work. There is no component-rendering harness in this repo — same caveat as
 * `row-family.test.ts` beside it.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { WishlistEntry } from '@bgc/core';
import { onTheWayHeading } from '../src/lib/on-the-way';

function row(copyId: number, rootGameId: number, quantity = 1): WishlistEntry {
  return {
    copyId,
    itemId: 1000 + copyId,
    status: 'preordered',
    name: `Thing ${copyId}`,
    kind: 'expansion',
    parentItemId: rootGameId,
    parentName: `Game ${rootGameId}`,
    rootGameId,
    rootGameName: `Game ${rootGameId}`,
    thumbnailUrl: null,
    publisherUrl: null,
    sourceUrl: null,
    publisher: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bggId: null,
    quantity,
    notes: null,
    addedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('onTheWayHeading', () => {
  it('counts rows as copies and root games as pledges', () => {
    assert.equal(
      onTheWayHeading([row(1, 7), row(2, 7), row(3, 8)]),
      'On the way · 3 copies across 2 pledges',
    );
  });

  it('adds units only when they differ from rows', () => {
    assert.equal(
      onTheWayHeading([row(1, 7, 3), row(2, 8)]),
      'On the way · 2 copies across 2 pledges · 4 units',
    );
  });

  it('is singular for one of each', () => {
    assert.equal(onTheWayHeading([row(1, 7)]), 'On the way · 1 copy across 1 pledge');
  });

  it('a row with no root counts as its own pledge', () => {
    const lone = { ...row(1, 7), rootGameId: null };
    assert.equal(onTheWayHeading([lone, row(2, 7)]), 'On the way · 2 copies across 2 pledges');
  });
});
