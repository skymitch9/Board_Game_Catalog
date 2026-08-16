/**
 * `CAPABILITY_MATRIX` and `can` — the owner-approved role matrix from the
 * 2026-08-16 role-ladder redesign (packages/core/src/capabilities.ts). Pins
 * three things down directly rather than trusting a read of the table:
 *
 *  - the new roles exist and read/write access lands where the table says
 *  - the wishlist split (suggestWishlist vs manageWishlist) is real, not
 *    folded back into one capability
 *  - the migration invariant the owner asked to be verified: everything the
 *    old `manager` role could do, the new `moderator` role can still do —
 *    checked here as "manager's old capability list is a subset of
 *    moderator's new one", which is the only way `viewer`/`rater`/`manager`
 *    ->`guest`/`member`/`moderator` can be a pure rename and not a
 *    regression for anyone already in production.
 *
 * `scanBarcode` and `scanPhoto` are tested here too: this repo *does* have a
 * scan concept (barcode + photo intake, `apps/worker/src/routes/scan-jobs.ts`
 * and `routes/vision.ts`), so both halves of split #2 apply, unlike a catalog
 * with no scan feature at all.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { can, ROLE_LADDER, ROLES, type Role } from '@bgc/core';

const ALL_ROLES: readonly Role[] = ROLES;

/** Every role the matrix should list for a capability, cumulative from `from`. */
function fromRung(from: (typeof ROLE_LADDER)[number]): Role[] {
  const start = ROLE_LADDER.indexOf(from);
  return ROLE_LADDER.slice(start) as unknown as Role[];
}

function assertExactly(capability: Parameters<typeof can>[1], expected: readonly Role[]) {
  const holders = ALL_ROLES.filter((r) => can(r, capability));
  assert.deepEqual(
    new Set(holders),
    new Set(expected),
    `${capability}: expected {${expected.join(',')}}, got {${holders.join(',')}}`,
  );
}

// --- the ladder itself -------------------------------------------------------

test('ROLE_LADDER is guest < member < contributor < moderator < admin < owner, pending excluded', () => {
  assert.deepEqual(ROLE_LADDER, [
    'guest',
    'member',
    'contributor',
    'moderator',
    'admin',
    'owner',
  ]);
  assert.ok(!(ROLE_LADDER as readonly string[]).includes('pending'));
});

test('every new role is in ROLES, and pending is still last-in-spirit (not a ladder rung)', () => {
  for (const role of ['guest', 'member', 'contributor', 'moderator', 'admin', 'owner', 'pending']) {
    assert.ok(ALL_ROLES.includes(role as Role), `${role} missing from ROLES`);
  }
});

// --- the approved matrix, row by row -----------------------------------------

test('read: everyone approved, guest included', () => {
  assertExactly('read', fromRung('guest'));
});

test('rate: member and above, not guest', () => {
  assertExactly('rate', fromRung('member'));
});

test('runResearch and reviewFindings: moderator and above', () => {
  assertExactly('runResearch', fromRung('moderator'));
  assertExactly('reviewFindings', fromRung('moderator'));
});

test('manageUsers: admin and above — no longer owner-exclusive', () => {
  assertExactly('manageUsers', fromRung('admin'));
});

// --- split #1: the wishlist ---------------------------------------------------

test('suggestWishlist (member+) and manageWishlist (contributor+) are genuinely different rows', () => {
  assertExactly('suggestWishlist', fromRung('member'));
  assertExactly('manageWishlist', fromRung('contributor'));

  // The split is real: a member can suggest but not manage.
  assert.equal(can('member', 'suggestWishlist'), true);
  assert.equal(can('member', 'manageWishlist'), false);
});

// --- split #2: scanning by cost (this repo HAS a scan concept) --------------

test('scanBarcode (free, contributor+) and scanPhoto (paid, moderator+) are different rows', () => {
  assertExactly('scanBarcode', fromRung('contributor'));
  assertExactly('scanPhoto', fromRung('moderator'));

  // A contributor gets the free rung and not the paid one.
  assert.equal(can('contributor', 'scanBarcode'), true);
  assert.equal(can('contributor', 'scanPhoto'), false);
});

// --- the no-regression invariant the owner asked to be verified -------------

test('everything the old `manager` role could do, `moderator` can still do (manager -> moderator is a pure rename)', () => {
  // The pre-redesign capability set for `manager`, transcribed from the
  // CAPABILITY_MATRIX this replaced (packages/core/src/capabilities.ts,
  // git history) rather than derived from the current one, so this test
  // cannot be trivially satisfied by changing both sides together.
  const oldManagerCapabilities = [
    'read',
    'rate',
    'editCatalog',
    'runResearch',
    'reviewFindings',
  ] as const;

  for (const capability of oldManagerCapabilities) {
    assert.equal(
      can('moderator', capability),
      true,
      `moderator lost '${capability}', which manager used to have`,
    );
  }
});

test('moderator did not merely inherit manager\'s set — it gained the two new cost-split scan capabilities', () => {
  assert.equal(can('moderator', 'scanBarcode'), true);
  assert.equal(can('moderator', 'scanPhoto'), true);
});
