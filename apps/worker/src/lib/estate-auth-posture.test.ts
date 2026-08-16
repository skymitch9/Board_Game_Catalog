/**
 * `AUTH_POSTURE.defaultRole` (apps/worker/src/middleware/estate.ts) —
 * the estate default-grant role this app writes to `app_user.role` on
 * `default_grant` in enforce mode (`estateGate`, same file).
 *
 * ## Why this exists
 *
 * `declareAuthPosture` (apps/worker/src/estate-auth/config.ts, materialised
 * from catalog-platform) types `defaultRole` as a bare `string | null` — it
 * is a cross-app module with no knowledge of this app's `Role` union, so it
 * can validate "is this surface public" but it CANNOT validate "is this
 * string one of OUR current roles." Nothing between `declareAuthPosture` and
 * a live D1 write closes that gap; a typo'd or stale `defaultRole` reaches
 * `grantEstateDefaultRole` and gets written to `app_user.role` as-is.
 *
 * The 2026-08-16 role-ladder redesign (packages/core/src/constants.ts) did
 * exactly the rename this guards against: `viewer` -> `guest`. `estate.ts`
 * was updated by hand (its own comment calls out the rename), but nothing
 * MECHANICAL checked that the new literal actually lands in `ROLES` — a
 * human read the diff correctly this time. The next rename might not get
 * the same care, and a `defaultRole` that drifts from `ROLES` fails
 * silently: `estateGate` writes it straight to `app_user.role` with no
 * validation, so the person granted default access gets a role no route's
 * `CAPABILITY_MATRIX` recognises — `can()` returns false for every
 * capability including plain `read`, and nothing errors.
 *
 * Deliberately NOT `assert.equal(AUTH_POSTURE.defaultRole, 'guest')`: that
 * would be circular (today's literal against today's literal, passing no
 * matter which way both drift together) and wouldn't catch a rename that
 * updates `ROLES` but misses this one reference. Checking membership in the
 * live `ROLES` set is what makes this fail the way the real incident should
 * have failed one: rename the ladder, forget this file, and `ROLES.includes`
 * goes false.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from '@bgc/core';
import { AUTH_POSTURE } from '../middleware/estate.js';

test('AUTH_POSTURE.defaultRole is either null or a role that currently exists in ROLES', () => {
  assert.ok(
    AUTH_POSTURE.defaultRole === null || (ROLES as readonly string[]).includes(AUTH_POSTURE.defaultRole),
    `AUTH_POSTURE.defaultRole is '${AUTH_POSTURE.defaultRole}', which is not in ROLES [${ROLES.join(', ')}] ` +
      `— a default-grant would write a role no capability check recognises`,
  );
});

test('this surface is non-public, so defaultRole must be a real role, not null', () => {
  // declareAuthPosture already refuses `public: true` with a non-null
  // defaultRole; this is the converse the games surface actually relies on
  // (public: false) — a null default here would mean default_grant silently
  // grants nothing, the opposite of §5.4's contract.
  assert.equal(AUTH_POSTURE.public, false);
  assert.notEqual(AUTH_POSTURE.defaultRole, null);
});

test('defaultRole is not `pending` — a status, never a grantable rung', () => {
  // `pending` is deliberately excluded from ROLE_LADDER (constants.ts) and
  // from every capability row: a default-grant that landed on `pending`
  // would be indistinguishable from "not approved," defeating the point of
  // estate-wide default admission (§5.4).
  assert.notEqual(AUTH_POSTURE.defaultRole, 'pending');
});
