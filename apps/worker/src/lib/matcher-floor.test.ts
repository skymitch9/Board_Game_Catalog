/**
 * The containment-ratio floor in matchIndexedTitle — raised 0.60 -> 0.68,
 * owner-approved 2026-08-16 on the measured evidence in
 * docs/info/matcher-thresholds.md.
 *
 * These pin the INCIDENT and the boundary, so the number cannot quietly move
 * back: "boss monster" vs "super boss monster 2" is 12/20 = 0.600 — exactly
 * on the old gate — and was auto-filed under the sequel on a real production
 * scan (job 13). At 0.68 it is refused and reaches the person as a new game.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchIndexedTitle, buildTitleIndex } from '@bgc/core';

const index = buildTitleIndex([
  { id: 1, name: 'Super Boss Monster 2', aliases: [] },
  { id: 2, name: 'Scythe: Invaders from Afar', aliases: [] },
  { id: 3, name: 'Wingspan', aliases: [] },
] as never);

test('the Boss Monster incident stays dead: base title does not match the sequel', () => {
  // 12/20 = 0.600 < 0.68 — refused. At the old 0.60 floor this matched.
  assert.equal(matchIndexedTitle(index, 'Boss Monster'), null);
});

test('exact matches never touch the floor', () => {
  assert.equal((matchIndexedTitle(index, 'Wingspan') as { id: number } | null)?.id, 3);
});

test('the Scythe guard the comment has always promised still holds', () => {
  // 'scythe' vs 'scythe: invaders from afar' = 6/26 — far under any floor.
  assert.equal(matchIndexedTitle(index, 'Scythe'), null);
});

test('a containment match ABOVE the floor still works', () => {
  // 'super boss monster' vs 'super boss monster 2' = 18/20 = 0.9 — admitted.
  assert.equal((matchIndexedTitle(index, 'Super Boss Monster') as { id: number } | null)?.id, 1);
});
