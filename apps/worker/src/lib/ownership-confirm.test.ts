/**
 * Confirm-first for containment matches — the sequel-class guard.
 *
 * The measurement in docs/info/matcher-thresholds.md proved the sequel class
 * ("X 2", "Super X") unfixable by any containment floor: length ratios sit
 * near 1.0 and " 2" is invisible to word-level similarity (1-char tokens are
 * dropped). 836/836 synthetic "X 2" probes matched their base at every
 * plausible floor. So the guess class stopped being automatic: the matcher now
 * says HOW it matched, and a containment match reaches the review screen as
 * "looks like X — same game?" instead of silently filing under already-owned —
 * which is the failure that LOSES a game, because nobody re-checks that list.
 *
 * These tests pin the plumbing: kind out of the matcher, question out of
 * `resolveOwnership`, the person's answer honoured both ways, legacy rows
 * (no `matchKind` persisted) behaving exactly as before.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTitleIndex,
  matchIndexedTitle,
  matchIndexedTitleDetailed,
} from '@bgc/core';
import type { ScannedTitle } from './barcode-scan.js';
import { countOutstanding, resolveOwnership, type OwnershipContext } from './scan-ownership.js';

const items = [
  { id: 1, name: 'Super Boss Monster 2', kind: 'base' },
  { id: 2, name: 'Wingspan', kind: 'base' },
  { id: 3, name: 'Catan', kind: 'base' },
];
const aliases = [{ itemId: 3, alias: 'The Settlers of Catan' }];

const ctx: OwnershipContext = {
  items,
  aliases,
  index: buildTitleIndex(items, aliases),
  byId: new Map(items.map((i) => [i.id, i])),
  addedBy: new Map(),
};

/** A minimal queue row — every required field, nothing decided. */
function row(over: Partial<ScannedTitle> = {}): ScannedTitle {
  return {
    title: 'Super Boss Monster',
    confidence: 'high',
    position: 1,
    alreadyOwned: false,
    existingItemId: null,
    existingName: null,
    bggId: null,
    resolvedName: null,
    thumbnailUrl: null,
    publisher: null,
    yearPublished: null,
    similarity: null,
    proposedKind: null,
    proposedParentId: null,
    proposedParentName: null,
    inferredParentName: null,
    reason: null,
    ...over,
  };
}

// --- The matcher says how it matched ---------------------------------------

test('detailed matcher tags each pass: exact, alias, containment', () => {
  assert.deepEqual(
    matchIndexedTitleDetailed(ctx.index, 'Wingspan')?.matchKind,
    'exact',
  );
  const viaAlias = matchIndexedTitleDetailed(ctx.index, 'The Settlers of Catan');
  assert.equal(viaAlias?.item.id, 3);
  assert.equal(viaAlias?.matchKind, 'alias');
  // 'super boss monster' vs 'super boss monster 2' = 18/20 — over the 0.68
  // floor, so it matches, but only as the guess it is.
  const viaContainment = matchIndexedTitleDetailed(ctx.index, 'Super Boss Monster');
  assert.equal(viaContainment?.item.id, 1);
  assert.equal(viaContainment?.matchKind, 'containment');
});

test('plain matchIndexedTitle is unchanged: same item, no kind', () => {
  assert.equal((matchIndexedTitle(ctx.index, 'Super Boss Monster') as { id: number } | null)?.id, 1);
  assert.equal(matchIndexedTitle(ctx.index, 'Boss Monster'), null);
});

// --- resolveOwnership turns the guess into a question -----------------------

test('a containment match resolves as a PENDING question, not a fact', () => {
  const o = resolveOwnership(row(), 7, ctx);
  assert.equal(o?.itemId, 1);
  assert.equal(o?.matchKind, 'containment');
  assert.equal(o?.pendingConfirmation, true);
});

test('exact and alias matches stay automatic', () => {
  const exact = resolveOwnership(row({ title: 'Wingspan' }), 7, ctx);
  assert.equal(exact?.pendingConfirmation, false);
  assert.equal(exact?.matchKind, 'exact');
  const alias = resolveOwnership(row({ title: 'The Settlers of Catan' }), 7, ctx);
  assert.equal(alias?.pendingConfirmation, false);
  assert.equal(alias?.matchKind, 'alias');
});

test('"yes, same game" settles the row', () => {
  const o = resolveOwnership(row({ ownershipConfirmed: true }), 7, ctx);
  assert.equal(o?.itemId, 1);
  assert.equal(o?.pendingConfirmation, false);
});

test('"no, different game" makes the row an add-candidate again', () => {
  assert.equal(resolveOwnership(row({ ownershipRejected: true }), 7, ctx), null);
});

test('rejection suppresses only the guess class — an exact match still counts', () => {
  const o = resolveOwnership(row({ title: 'Wingspan', ownershipRejected: true }), 7, ctx);
  assert.equal(o?.itemId, 2);
  assert.equal(o?.pendingConfirmation, false);
});

// --- Persisted claims: enrichment-time matches and legacy rows ---------------

test('a claim persisted as containment (enrichment/barcode path) still asks', () => {
  const t = row({ alreadyOwned: true, existingItemId: 1, existingName: 'Super Boss Monster 2', matchKind: 'containment' });
  const o = resolveOwnership(t, 7, ctx);
  assert.equal(o?.itemId, 1);
  assert.equal(o?.pendingConfirmation, true);
});

test('a rejected persisted containment claim is not honoured', () => {
  const t = row({
    title: 'Boss Monster', // matches nothing at the 0.68 floor
    alreadyOwned: true,
    existingItemId: 1,
    existingName: 'Super Boss Monster 2',
    matchKind: 'containment',
    ownershipRejected: true,
  });
  assert.equal(resolveOwnership(t, 7, ctx), null);
});

test('LEGACY row: a claim with no matchKind stays trusted — the old behaviour', () => {
  // Rows enriched before the kind was recorded, and exact-barcode hits, both
  // carry existingItemId and no matchKind. Absent field = settled, no question.
  const t = row({ alreadyOwned: true, existingItemId: 1, existingName: 'Super Boss Monster 2' });
  const o = resolveOwnership(t, 7, ctx);
  assert.equal(o?.itemId, 1);
  assert.equal(o?.matchKind, null);
  assert.equal(o?.pendingConfirmation, false);
});

// --- The question keeps the job open ----------------------------------------

test('an unanswered question counts as outstanding; an answered one does not', () => {
  assert.equal(countOutstanding([row()], 7, ctx), 1);
  assert.equal(countOutstanding([row({ ownershipConfirmed: true })], 7, ctx), 0);
  // Rejected: no ownership any more, so it is outstanding as an add-candidate.
  assert.equal(countOutstanding([row({ ownershipRejected: true })], 7, ctx), 1);
  // Identity matches never were outstanding.
  assert.equal(countOutstanding([row({ title: 'Wingspan' })], 7, ctx), 0);
});
