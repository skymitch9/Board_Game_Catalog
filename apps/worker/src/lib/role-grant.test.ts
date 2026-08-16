/**
 * `canGrantRole` — the admin escalation limit from the 2026-08-16 role-ladder
 * redesign (packages/core/src/capabilities.ts). Pure function, no D1/fetch, so
 * these pin the decision table directly rather than standing up a fake Worker
 * environment — same approach as `index-push.test.ts` beside this file.
 *
 * The three cases the owner's design explicitly calls out, plus the sanity
 * checks on `owner` and the `pending`/unranked edges `canGrantRole`'s own
 * comment documents.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canGrantRole } from '@bgc/core';

// --- the three required cases -----------------------------------------------

test('admin attempting to grant admin -> FAILS (no self-escalation)', () => {
  assert.equal(canGrantRole('admin', 'admin'), false);
});

test('admin attempting to grant moderator -> PASSES (strictly beneath admin)', () => {
  assert.equal(canGrantRole('admin', 'moderator'), true);
});

test('moderator attempting to grant admin -> FAILS (moderator has no manageUsers, and admin is not beneath it either way)', () => {
  assert.equal(canGrantRole('moderator', 'admin'), false);
});

// --- owner sanity checks, and the choice documented on canGrantRole --------

test('owner granting admin -> PASSES', () => {
  assert.equal(canGrantRole('owner', 'admin'), true);
});

test('owner granting owner -> PASSES (owner is unrestricted by design; see canGrantRole)', () => {
  assert.equal(canGrantRole('owner', 'owner'), true);
});

// --- the rest of the ladder, both directions --------------------------------

test('admin may grant every rung strictly beneath it', () => {
  for (const role of ['moderator', 'contributor', 'member', 'guest'] as const) {
    assert.equal(canGrantRole('admin', role), true, `admin -> ${role}`);
  }
});

test('admin may not grant its own rung or anything above it', () => {
  assert.equal(canGrantRole('admin', 'admin'), false);
  assert.equal(canGrantRole('admin', 'owner'), false);
});

test('a contributor cannot escalate a member to contributor (rank equal, not strictly beneath)', () => {
  assert.equal(canGrantRole('contributor', 'contributor'), false);
});

test('a moderator may grant anything strictly beneath it, same as admin', () => {
  assert.equal(canGrantRole('moderator', 'contributor'), true);
  assert.equal(canGrantRole('moderator', 'guest'), true);
  assert.equal(canGrantRole('moderator', 'moderator'), false);
});

// --- pending: a demotion, never an escalation -------------------------------

test('granting pending (a revoke) is allowed from any real rung', () => {
  assert.equal(canGrantRole('admin', 'pending'), true);
  assert.equal(canGrantRole('moderator', 'pending'), true);
  assert.equal(canGrantRole('guest', 'pending'), true);
});

test('owner granting pending is allowed too, via the owner branch', () => {
  assert.equal(canGrantRole('owner', 'pending'), true);
});

test('pending itself may grant nothing — it is a status, not a rung', () => {
  assert.equal(canGrantRole('pending', 'guest'), false);
  assert.equal(canGrantRole('pending', 'pending'), true); // owner branch doesn't apply; pending target short-circuits before rank lookup
});
