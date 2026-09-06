/**
 * `routes/admin.ts` — the FEDERATED admin surface, called cross-origin from
 * `https://heygabi.ai/admin`.
 *
 * Written 2026-09-05 with `users.test.ts`, closing §5.2 of
 * `catalog-platform/docs/info/test-inventory-2026-09-05.md`.
 *
 * This surface is the one place in the Worker where a role can be changed from
 * a page served by a DIFFERENT app, so three things are pinned here that the
 * People page's twin does not need:
 *
 * 1. **Same gate, same rule, same write path as `routes/users.ts`.** The file's
 *    own header promises *"federation, not centralization … nothing here lets
 *    the estate redefine a games role"*. A drift between the two surfaces would
 *    mean the estate page could do something the in-app page could not, which
 *    is exactly the thing the promise rules out. The escalation cases below are
 *    deliberately the same table as the People page's, run against this mount.
 * 2. **The CORS origin is one locked value, never a wildcard**, and the
 *    preflight is answerable without a bearer (it carries none — see the mount
 *    comment in `index.ts`).
 * 3. **The JSON shape is a CONTRACT with another repo.** `catalog-platform`'s
 *    admin page populates its role dropdown from `roles` and addresses the
 *    PATCH by `users[].id`; it identifies this catalog by `app`. Renaming a key
 *    here breaks a page in a repo whose tests cannot see this file.
 *
 * NOT proved here: that the cross-origin page actually calls it (that is
 * `catalog-platform`'s side), and nothing touches a live D1.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ROLES, type AppUser, type Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { ADMIN_PAGE_ORIGIN, adminCors, adminRoutes } from './admin.js';

// ---------------------------------------------------------------------------
// harness — the same shape as users.test.ts, mounted on /api/admin
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

function stubDb(opts: { targetRole?: Role; ownerCount?: number; newRole?: Role; missing?: boolean } = {}) {
  const { targetRole = 'member', ownerCount = 2, newRole = 'member', missing = false } = opts;
  const sqlSeen: string[] = [];
  let written = false;

  const row = (role: Role, id = 2) => ({
    id,
    email: `target-${id}@example.test`,
    display_name: `Target ${id}`,
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
          if (/FROM app_user/.test(sql)) return { results: [row('owner', 1), row(targetRole, 2)] };
          return { results: [] };
        },
      };
      return stmt;
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

function envWith(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, ESTATE_APP: 'games', ...extra } as unknown as Env;
}

function appAs(role: Role, id = 1) {
  const app = new Hono<AppBindings>();
  app.use('/api/admin/*', adminCors());
  app.use('*', async (c, next) => {
    c.set('user', userWith(role, id));
    await next();
  });
  app.route('/api/admin', adminRoutes);
  return app;
}

/** The mount as `index.ts` builds it, minus `requireAuth` — CORS in front. */
function corsOnlyApp() {
  const app = new Hono<AppBindings>();
  app.use('/api/admin/*', adminCors());
  app.route('/api/admin', adminRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// 1. the gate
// ---------------------------------------------------------------------------

const GATED = [
  { method: 'GET', path: '/api/admin/users' },
  { method: 'PATCH', path: '/api/admin/users/2/role' },
  { method: 'POST', path: '/api/admin/index-push' },
] as const;

describe('every route on the federated surface is gated on manageUsers', () => {
  for (const { method, path } of GATED) {
    for (const role of ['guest', 'member', 'contributor', 'moderator'] as const) {
      it(`${method} ${path} refuses a ${role} in words, naming the capability`, async () => {
        const db = stubDb();
        const res = await appAs(role).request(
          path,
          { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? null : '{}' },
          envWith(db),
        );
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error?: string; capability?: string; role?: string; detail?: string };
        assert.equal(body.error, 'forbidden');
        assert.equal(body.capability, 'manageUsers');
        assert.equal(body.role, role);
        assert.match(body.detail ?? '', /Your role does not permit this action/);
        assert.deepEqual(db._sql, [], 'a refused caller must not reach the database');
      });
    }

    it(`${method} ${path} tells a PENDING account it is awaiting approval instead`, async () => {
      const res = await appAs('pending').request(
        path,
        { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? null : '{}' },
        envWith(stubDb()),
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as { detail?: string };
      assert.match(body.detail ?? '', /awaiting approval by an owner/);
    });
  }

  for (const role of ['owner', 'admin'] as const) {
    it(`an ${role} is let through to GET /users`, async () => {
      const res = await appAs(role).request('/api/admin/users', {}, envWith(stubDb()));
      assert.equal(res.status, 200);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. the cross-repo JSON contract
// ---------------------------------------------------------------------------

describe('GET /api/admin/users — the shape heygabi.ai/admin consumes', () => {
  it('names this app, and publishes the role vocabulary VERBATIM', async () => {
    const res = await appAs('owner').request('/api/admin/users', {}, envWith(stubDb()));
    const body = (await res.json()) as { app?: string; roles?: string[]; users?: unknown[] };
    assert.equal(body.app, 'games');
    // The dropdown on the estate page is built from this array. Hardcoding it
    // there is the drift this key exists to prevent, so it must be the real
    // constant and in the real order.
    assert.deepEqual(body.roles, [...ROLES]);
    assert.ok(Array.isArray(body.users));
  });

  it('every user row carries exactly the four keys the page addresses', async () => {
    const res = await appAs('owner').request('/api/admin/users', {}, envWith(stubDb()));
    const body = (await res.json()) as { users?: Record<string, unknown>[] };
    const first = body.users?.[0];
    assert.ok(first);
    assert.deepEqual(Object.keys(first).sort(), ['displayName', 'email', 'id', 'role']);
    // ⚠️ Deliberately NOT the whole `AppUser`: the People page's own
    // `GET /api/users` returns the full row, this projection does not, and a
    // cross-origin surface gaining `firstSeenAt`/`approvedAt` would be a
    // widening nobody asked for.
  });

  it('the PATCH answers with the user under a `user` key, not bare', async () => {
    const res = await appAs('owner').request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'moderator' }),
      },
      envWith(stubDb({ newRole: 'moderator' })),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user?: Record<string, unknown> };
    assert.ok(body.user);
    assert.deepEqual(Object.keys(body.user).sort(), ['displayName', 'email', 'id', 'role']);
  });
});

// ---------------------------------------------------------------------------
// 3. CORS — one locked origin, and a preflight that needs no bearer
// ---------------------------------------------------------------------------

describe('CORS is a locked list, not a wildcard', () => {
  it('the origin is exactly the estate admin page', () => {
    assert.equal(ADMIN_PAGE_ORIGIN, 'https://heygabi.ai');
  });

  it('a preflight from the admin page is answered WITHOUT any Authorization header', async () => {
    // ⚠️ This is why `adminCors()` mounts before `requireAuth` in index.ts: the
    // browser sends no bearer on an OPTIONS, so a blanket auth gate would 401
    // the preflight and the real request would never be sent.
    const res = await corsOnlyApp().request(
      '/api/admin/users',
      {
        method: 'OPTIONS',
        headers: {
          origin: ADMIN_PAGE_ORIGIN,
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization,content-type',
        },
      },
      envWith(stubDb()),
    );
    assert.ok(res.status === 204 || res.status === 200, `preflight answered ${res.status}`);
    assert.equal(res.headers.get('access-control-allow-origin'), ADMIN_PAGE_ORIGIN);
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /PATCH/);
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/i);
  });

  it('🔴 another origin is never handed an allow-origin header', async () => {
    const res = await corsOnlyApp().request(
      '/api/admin/users',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'PATCH',
        },
      },
      envWith(stubDb()),
    );
    const allow = res.headers.get('access-control-allow-origin');
    assert.ok(allow !== '*', 'a wildcard would open the role-write surface to any page');
    assert.ok(
      allow == null || allow === ADMIN_PAGE_ORIGIN,
      `an unexpected origin was echoed back: ${allow}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. the escalation limit and the write path — identical to the People page
// ---------------------------------------------------------------------------

describe('federation does not mean a second policy', () => {
  it('an admin may not mint another admin here either', async () => {
    const db = stubDb();
    const res = await appAs('admin').request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /Your role \(admin\) may not grant 'admin'/);
    assert.deepEqual(db._sql, []);
  });

  it('an admin may not mint an owner here either', async () => {
    const res = await appAs('admin').request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      },
      envWith(stubDb()),
    );
    assert.equal(res.status, 403);
  });

  it('the only owner may not demote themselves from the estate page either', async () => {
    const res = await appAs('owner', 1).request(
      '/api/admin/users/1/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(stubDb({ targetRole: 'owner', ownerCount: 1, newRole: 'member' })),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.match(String(body.detail), /only owner — promote someone else first/);
  });

  /**
   * ✅ **KI-7, fixed 2026-09-05.** This was `.todo` and failing on purpose — the
   * same hole as `routes/users.ts`, reachable from the cross-origin surface as
   * well.
   *
   * ⚠️ **This case is the argument for where the fix went.** The guard is in
   * `@bgc/db`'s `setUserRole`, keyed on the target's current role, so this
   * mount inherits it without a line of its own. A route-level fix would have
   * had to be written twice and would have been the drift the file header
   * already warns about.
   */
  it('an admin may NOT demote the last owner from the estate page either', async () => {
    const res = await appAs('admin', 1).request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(stubDb({ targetRole: 'owner', ownerCount: 1, newRole: 'member' })),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'bad_request');
    assert.match(String(body.detail), /only owner — promote someone else first/);
  });

  it('and MAY demote an owner here while a second owner remains', async () => {
    const res = await appAs('admin', 1).request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(stubDb({ targetRole: 'owner', ownerCount: 2, newRole: 'member' })),
    );
    assert.equal(res.status, 200);
  });

  it('🔴 the write is `@bgc/db`’s `setUserRole`, byte for byte the People page’s statement', async () => {
    const db = stubDb();
    await appAs('owner').request(
      '/api/admin/users/2/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'contributor' }),
      },
      envWith(db),
    );
    const updates = db._sql.filter((s) => /UPDATE app_user/.test(s));
    assert.equal(updates.length, 1);
    assert.equal(updates[0], 'UPDATE app_user SET role = ?, approved_at = ?, approved_by = ? WHERE id = ?');
  });

  it('a bad id is refused before anything is parsed or written', async () => {
    const db = stubDb();
    const res = await appAs('owner').request(
      '/api/admin/users/abc/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      },
      envWith(db),
    );
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /user id must be an integer/);
    assert.deepEqual(db._sql, []);
  });
});

// ---------------------------------------------------------------------------
// 5. POST /index-push — the manual escape hatch
// ---------------------------------------------------------------------------

describe('POST /api/admin/index-push', () => {
  it('says it did nothing, in words, when the index is not configured', async () => {
    // ⚠️ INDEX_URL/INDEX_PUSH_TOKEN are unset in production on purpose. A
    // silent 200 here would be indistinguishable from a push that happened.
    const res = await appAs('owner').request('/api/admin/index-push', { method: 'POST' }, envWith(stubDb()));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { app?: string; skipped?: string };
    assert.equal(body.app, 'games');
    assert.match(body.skipped ?? '', /INDEX_URL \/ INDEX_PUSH_TOKEN not configured/);
  });

  it('adds no push logic of its own — it names this app and forwards the result', async () => {
    const res = await appAs('admin').request('/api/admin/index-push', { method: 'POST' }, envWith(stubDb()));
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['app', 'skipped']);
  });
});
