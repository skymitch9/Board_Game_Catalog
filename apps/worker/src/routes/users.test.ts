/**
 * `routes/users.ts` — the People page's surface, and the most role-bearing
 * file in this Worker.
 *
 * Written 2026-09-05 to close the named gap in
 * `catalog-platform/docs/info/test-inventory-2026-09-05.md` §5.2: *"16 route
 * files and zero route tests … `users.ts` and `admin.ts` are role-bearing
 * surfaces."* The harness is the library catalog's
 * (`library_catalog/apps/worker/src/routes/users-role-guard.test.ts` and
 * `audits.test.ts`) — build a real `Request` through a bare Hono app, plant a
 * role with a fake `requireAuth`, keep `requireCapability` real, and read the
 * refusal back off the wire.
 *
 * ## What this proves
 *
 * 1. **The four causes of a refusal stay distinct**, because the fixes differ:
 *    *not signed in* (401), *awaiting approval* (403 worded as approval),
 *    *insufficient role* (403 worded as role), and *misconfigured* (500) —
 *    a server failure is never dressed as a permission failure.
 * 2. **The escalation limit is enforced in the ROUTE**, not merely in
 *    `canGrantRole`: `role-grant.test.ts` pins the pure function, and nothing
 *    pinned that this handler calls it. A route that forgot the call would
 *    pass every existing test in this repo.
 * 3. **The write goes through `setUserRole`** — the one canonical role-write
 *    path — asserted by reading the SQL the stub was handed. A bespoke inline
 *    `UPDATE app_user` here would be a second place a persisted role is
 *    written, which is the "functions that produce persisted keys are
 *    migrations, not edits" rule in its role-shaped form.
 *
 * ## What it does NOT prove
 *
 * Nothing here touches a live D1 or a real Firebase token. `resolveIdentity`
 * is exercised only on the paths that return before `jwtVerify` (no bearer,
 * no project id); signature verification itself is `estate-auth`'s own suite.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';
import { userRoutes } from './users.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function userWith(role: Role, id = 1): AppUser {
  return {
    id,
    email: `actor-${id}@example.test`,
    displayName: 'Actor',
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * A D1 stub that answers every read these routes make and REMEMBERS the SQL it
 * was handed, so a test can assert which write path ran.
 *
 * `targetRole` is the role the target row currently holds; `ownerCount` is what
 * `countOwners()` answers. The UPDATE is a no-op and the re-read afterwards
 * returns the row at its new role, the way the real one does.
 */
function stubDb(opts: { targetRole?: Role; ownerCount?: number; newRole?: Role; missing?: boolean } = {}) {
  const { targetRole = 'member', ownerCount = 2, newRole = 'member', missing = false } = opts;
  const sqlSeen: string[] = [];
  let written = false;

  const row = (role: Role) => ({
    id: 2,
    email: 'target@example.test',
    display_name: 'Target',
    role,
    first_seen_at: '2026-01-01 00:00:00',
    approved_at: '2026-01-01 00:00:00',
  });

  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/COUNT\(\*\) AS n FROM app_user WHERE role = 'owner'/.test(sql)) return { n: ownerCount };
          if (/COUNT\(\*\) AS n FROM app_user WHERE role = 'pending'/.test(sql)) return { n: 0 };
          if (/FROM app_user WHERE id = \?/.test(sql)) {
            if (missing) return null;
            return row(written ? newRole : targetRole);
          }
          return { n: 0 };
        },
        async run() {
          written = true;
          return { meta: { changes: 1 } };
        },
        async all() {
          if (/FROM app_user/.test(sql)) return { results: [row(targetRole)] };
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch() {
      written = true;
      return [];
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

function envWith(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, ESTATE_APP: 'games', ...extra } as unknown as Env;
}

/** The People-page surface with a role planted, `requireCapability` untouched. */
function appAs(role: Role, id = 1) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role, id));
    await next();
  });
  app.route('/api', userRoutes);
  return app;
}

async function patchRole(
  actor: { role: Role; id?: number },
  target: { id: number; role?: Role; ownerCount?: number },
  newRole: Role,
) {
  const db = stubDb({
    ...(target.role != null ? { targetRole: target.role } : {}),
    ...(target.ownerCount != null ? { ownerCount: target.ownerCount } : {}),
    newRole,
  });
  const res = await appAs(actor.role, actor.id ?? 1).request(
    `/api/users/${target.id}/role`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    },
    envWith(db),
  );
  return { res, db };
}

// ---------------------------------------------------------------------------
// 1. the four causes of a refusal, kept apart
// ---------------------------------------------------------------------------

describe('the four refusals are four different answers', () => {
  /**
   * The blanket `requireAuth()` mounted in `index.ts` is what every route in
   * this Worker sits behind, so it is exercised here once rather than in
   * sixteen files. No Authorization header reaches `readBearer`, which returns
   * null long before any signature check — no network, no JWKS.
   */
  it('NOT SIGNED IN → 401, and it is not a 403', async () => {
    const app = new Hono<AppBindings>();
    app.use('/api/*', requireAuth());
    app.route('/api', userRoutes);
    const res = await app.request(
      '/api/me',
      {},
      envWith(stubDb(), { FIREBASE_PROJECT_ID: 'audiobook-catalog' }),
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'unauthenticated');
  });

  /**
   * ⚠️ FAILING ON PURPOSE — the bare-code defect, left visible rather than
   * fixed here. `middleware/auth.ts:64` answers `{ error: 'unauthenticated' }`
   * with no sentence at all, while `middleware/estate.ts`'s two refusals each
   * carry a worded `detail` (pinned by `lib/estate-refusals.test.ts`). The
   * estate rule is that a person never sees a bare status OR a bare code: say
   * what happened, what it needs, and how to get it. See KNOWN_ISSUES KI-6.
   */
  it.todo('🔴 BUG (KI-6): the 401 body carries no worded detail — a bare code on the wire', async () => {
    const app = new Hono<AppBindings>();
    app.use('/api/*', requireAuth());
    app.route('/api', userRoutes);
    const res = await app.request(
      '/api/me',
      {},
      envWith(stubDb(), { FIREBASE_PROJECT_ID: 'audiobook-catalog' }),
    );
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /sign in/i);
  });

  it('MISCONFIGURED → 500, and it is never worded as a permission problem', async () => {
    // No FIREBASE_PROJECT_ID: the verifier throws, and an outage or a config
    // error must not send somebody asking for access they already have.
    const app = new Hono<AppBindings>();
    app.use('/api/*', requireAuth());
    app.route('/api', userRoutes);
    const res = await app.request('/api/me', {}, envWith(stubDb()));
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'misconfigured');
    assert.match(body.detail ?? '', /FIREBASE_PROJECT_ID/);
    assert.ok(!/role/i.test(body.detail ?? ''), 'a config failure is not a role failure');
  });

  it('AWAITING APPROVAL → 403 that says so, and does not mention roles', async () => {
    const res = await appAs('pending').request('/api/users', {}, envWith(stubDb()));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; capability?: string; role?: string; detail?: string };
    assert.equal(body.error, 'forbidden');
    assert.equal(body.capability, 'manageUsers');
    assert.equal(body.role, 'pending');
    assert.match(body.detail ?? '', /awaiting approval by an owner/);
    // Sending an unapproved account to ask for a higher role sends them to ask
    // for something that would not help.
    assert.ok(!/does not permit/.test(body.detail ?? ''), 'that is the other refusal');
  });

  for (const role of ['guest', 'member', 'contributor', 'moderator'] as const) {
    it(`INSUFFICIENT ROLE → 403 naming the capability and the role (${role})`, async () => {
      const res = await appAs(role).request('/api/users', {}, envWith(stubDb()));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
      assert.equal(body.capability, 'manageUsers');
      assert.equal(body.role, role);
      assert.match(body.detail ?? '', /Your role does not permit this action/);
      assert.ok(!/awaiting approval/.test(body.detail ?? ''), 'that is the pending refusal');
    });
  }

  it('🔴 a refused caller never reaches the database', async () => {
    const db = stubDb();
    await appAs('member').request('/api/users', {}, envWith(db));
    assert.deepEqual(db._sql, [], 'the gate ran after the work, not before it');
  });
});

// ---------------------------------------------------------------------------
// 2. GET /me — the first call the web app makes
// ---------------------------------------------------------------------------

describe('GET /api/me', () => {
  it('answers for every role, `pending` included — it is the holding screen’s own call', async () => {
    const res = await appAs('pending').request('/api/me', {}, envWith(stubDb()));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { role?: string; capabilities?: string[]; chores?: unknown };
    assert.equal(body.role, 'pending');
    assert.deepEqual(body.capabilities, []);
    // No `editCatalog` and no `manageUsers`, so the counts are never paid for.
    assert.equal(body.chores, null);
  });

  it('a reader gets `read` and no chores', async () => {
    const res = await appAs('guest').request('/api/me', {}, envWith(stubDb()));
    const body = (await res.json()) as { capabilities?: string[]; chores?: unknown };
    assert.deepEqual(body.capabilities, ['read']);
    assert.equal(body.chores, null);
  });

  it('a contributor gets the chore counts (the `editCatalog` half of the union)', async () => {
    const res = await appAs('contributor').request('/api/me', {}, envWith(stubDb()));
    const body = (await res.json()) as { chores?: Record<string, number> | null };
    assert.ok(body.chores, 'a role that can act on the queues must be told they exist');
    assert.equal(typeof body.chores?.['pendingUsers'], 'number');
  });

  it('⚠️ a failing chore count answers `null` rather than failing sign-in', async () => {
    const exploding = {
      prepare() {
        throw new Error('D1_ERROR: no such table: item');
      },
    } as unknown as D1Database;
    const res = await appAs('owner').request('/api/me', {}, envWith(exploding));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { chores?: unknown; role?: string };
    assert.equal(body.chores, null);
    assert.equal(body.role, 'owner');
  });
});

// ---------------------------------------------------------------------------
// 3. PATCH /api/users/:id/role — the escalation limit, in the route
// ---------------------------------------------------------------------------

describe('PATCH /api/users/:id/role — the escalation limit is checked HERE', () => {
  it('an admin may not mint another admin, and is told which role and why', async () => {
    const { res, db } = await patchRole({ role: 'admin' }, { id: 2 }, 'admin');
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'forbidden');
    assert.match(body.detail ?? '', /Your role \(admin\) may not grant 'admin'/);
    assert.deepEqual(db._sql, [], 'a refused grant must not touch app_user');
  });

  it('an admin may not mint an owner', async () => {
    const { res } = await patchRole({ role: 'admin' }, { id: 2 }, 'owner');
    assert.equal(res.status, 403);
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /may not grant 'owner'/);
  });

  it('an admin MAY grant every rung beneath it, and revoke to pending', async () => {
    for (const role of ['moderator', 'contributor', 'member', 'guest', 'pending'] as const) {
      const { res } = await patchRole({ role: 'admin' }, { id: 2 }, role);
      assert.equal(res.status, 200, `admin → ${role} should be allowed`);
    }
  });

  it('an owner is unrestricted — including adding a co-owner', async () => {
    const { res } = await patchRole({ role: 'owner' }, { id: 2 }, 'owner');
    assert.equal(res.status, 200);
  });

  it('a bad id is a 400 in words, before any parse or write', async () => {
    const db = stubDb();
    const res = await appAs('owner').request(
      '/api/users/not-a-number/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.match(String(body.detail), /user id must be an integer/);
    assert.deepEqual(db._sql, []);
  });

  it('an unknown role is refused by the schema, not silently ignored', async () => {
    const db = stubDb();
    const res = await appAs('owner').request(
      '/api/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'superuser' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(db._sql, []);
  });

  it('a target that does not exist is a 404, not a silent success', async () => {
    const db = stubDb({ missing: true });
    const res = await appAs('owner').request(
      '/api/users/999/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// 4. the last-owner guard
// ---------------------------------------------------------------------------

describe('the last-owner guard', () => {
  it('the only owner may not demote THEMSELVES, and is told what to do first', async () => {
    // actor id 1 editing user 1, one owner in the table.
    const db = stubDb({ targetRole: 'owner', ownerCount: 1, newRole: 'member' });
    const res = await appAs('owner', 1).request(
      '/api/users/1/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.match(String(body.detail), /only owner — promote someone else first/);
  });

  it('an owner may demote themselves while a second owner remains', async () => {
    const db = stubDb({ targetRole: 'owner', ownerCount: 2, newRole: 'member' });
    const res = await appAs('owner', 1).request(
      '/api/users/1/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 200);
  });

  /**
   * 🔴 FAILING ON PURPOSE — a real, live privilege bug. See KNOWN_ISSUES KI-7.
   *
   * The guard is keyed on `userId === actor.id`, so it fires only when the
   * actor is editing themselves. Nothing on either role-write path reads the
   * TARGET's current role, so an `admin` — who may grant every rung beneath
   * `admin`, `pending` included — can demote the last remaining `owner`.
   * `countOwners()` reaches 0, and after that no role in this app can ever
   * mint an `owner` again, because an `admin` may not grant one.
   *
   * `library_catalog` had exactly this bug (2026-08 audit HIGH) and fixed it by
   * moving the guard into `setUserRole` and keying it on the target's current
   * role. This repo never took that fix. Left `.todo` deliberately: the fix is
   * role-bearing and is the conductor's call, not a test agent's.
   */
  it.todo('🔴 BUG (KI-7): an admin can demote the LAST owner — countOwners() reaches 0', async () => {
    const { res } = await patchRole({ role: 'admin', id: 1 }, { id: 2, role: 'owner', ownerCount: 1 }, 'member');
    assert.equal(res.status, 400, 'demoting the final owner must be refused whoever asks');
  });

  it('⚠️ the hole is real, and this pins the CURRENT behaviour so the fix is visible', async () => {
    // Not an endorsement — a measurement. When KI-7 is fixed this test flips to
    // 400 and the `.todo` above becomes the live one. Two tests, one truth.
    const { res } = await patchRole({ role: 'admin', id: 1 }, { id: 2, role: 'owner', ownerCount: 1 }, 'member');
    assert.equal(res.status, 200, 'today the demotion succeeds — see KNOWN_ISSUES KI-7');
  });
});

// ---------------------------------------------------------------------------
// 5. the canonical write path
// ---------------------------------------------------------------------------

describe('the role write goes through `setUserRole`, and nowhere else', () => {
  it('🔴 the UPDATE is `@bgc/db`’s, stamping approved_at and approved_by', async () => {
    const { res, db } = await patchRole({ role: 'owner', id: 7 }, { id: 2 }, 'contributor');
    assert.equal(res.status, 200);
    const update = db._sql.find((s) => /UPDATE app_user/.test(s));
    assert.ok(update, 'no UPDATE reached the database at all');
    // The exact statement `setUserRole` issues. A bespoke inline UPDATE here
    // would be a second place a persisted role is written.
    assert.equal(update, 'UPDATE app_user SET role = ?, approved_at = ?, approved_by = ? WHERE id = ?');
  });

  it('exactly ONE role UPDATE per request — no second write path fires alongside it', async () => {
    const { db } = await patchRole({ role: 'owner' }, { id: 2 }, 'member');
    assert.equal(db._sql.filter((s) => /UPDATE app_user/.test(s)).length, 1);
  });

  it('the response echoes the row as re-read, not the role that was asked for', async () => {
    const { res } = await patchRole({ role: 'owner' }, { id: 2, role: 'guest' }, 'moderator');
    const body = (await res.json()) as { user?: { role?: string; id?: number } };
    assert.equal(body.user?.role, 'moderator');
    assert.equal(body.user?.id, 2);
  });
});
