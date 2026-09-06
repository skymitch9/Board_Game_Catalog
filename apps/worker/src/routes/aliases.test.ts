/**
 * `routes/aliases.ts` — the other names a game answers to, and the last of the
 * three backfill routes.
 *
 * Two doors, both needed: `POST /backfill` imports BoardGameGeek's own
 * alternate-name list for the rows that carry a `bgg_id`, and `POST /items/:id`
 * is a person typing one. ⚠️ **The import is not sufficient on its own and the
 * manual door is not a fallback** — most of this catalog has no BGG id, and a
 * re-run must never delete something a person typed.
 *
 * Pinned here:
 *
 * 1. The blanket `editCatalog` covers all five routes, including the reads —
 *    aliases are a maintenance surface, not a browsing one.
 * 2. **A repeat alias is a SUCCESS, not a conflict.** Somebody typing the name
 *    they already typed means the same thing the second time, and a 409 would
 *    only make the screen argue with them. The route answers `added` plus the
 *    full list either way.
 * 3. The missing-token 502 is worded exactly like `editions` and `components`
 *    — three routes, one sentence about one secret.
 *
 * NOT proved: `runAliasBackfill`, or that a re-run really spares manual rows
 * (`replaceBggAliases` clears only `source = 'bgg'`, and that is `@bgc/db`'s to
 * prove).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { RUN_BGG_CALLS } from '../lib/alias-backfill.js';
import { aliasRoutes } from './aliases.js';

function appAs(role: Role) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 1,
      email: 'actor@example.test',
      displayName: 'Actor',
      role,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      approvedAt: '2026-01-01T00:00:00.000Z',
    } satisfies AppUser);
    await next();
  });
  app.route('/api/aliases', aliasRoutes);
  return app;
}

/** `changes` is what an INSERT/DELETE reports — 0 means "already there / gone". */
function stubDb(opts: { changes?: number } = {}) {
  const { changes = 1 } = opts;
  const sqlSeen: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          return { n: 0, total: 0 };
        },
        async run() {
          return { meta: { changes } };
        },
        async all() {
          return { results: [{ id: 1, alias: 'Die Siedler von Catan', source: 'manual' }] };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ results: [], meta: { changes: 0 } }));
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database, extra: Partial<Env> = {}) =>
  ({ DB: db, ...extra }) as unknown as Env;

async function call(role: Role, method: string, path: string, body?: unknown, env: Env = envWith(stubDb())) {
  return appAs(role).request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

const ROUTES = [
  { method: 'GET', path: '/api/aliases/status' },
  { method: 'GET', path: '/api/aliases/items/7' },
  { method: 'POST', path: '/api/aliases/items/7' },
  { method: 'DELETE', path: '/api/aliases/3' },
  { method: 'POST', path: '/api/aliases/backfill' },
] as const;

// ---------------------------------------------------------------------------

describe('every route — the READS included — is behind editCatalog', () => {
  for (const { method, path } of ROUTES) {
    for (const role of ['guest', 'member'] as const) {
      it(`${method} ${path} refuses a ${role} by name, and never runs a query`, async () => {
        const db = stubDb();
        const res = await call(role, method, path, undefined, envWith(db));
        assert.equal(res.status, 403);
        const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
        // ⚠️ Not `read`: an alias list is a maintenance surface. `GET
        // /items/:id` here is for one game's own EDIT page; the scan path
        // reads the whole table through `listItemAliases` instead.
        assert.equal(body.capability, 'editCatalog');
        assert.equal(body.role, role);
        assert.match(body.detail ?? '', /Your role does not permit this action/);
        assert.deepEqual(db._sql, []);
      });
    }

    it(`${method} ${path} tells a pending account it is awaiting approval`, async () => {
      const res = await call('pending', method, path);
      assert.match(String(((await res.json()) as { detail?: string }).detail), /awaiting approval/);
    });
  }
});

describe('GET /status costs no BoardGameGeek request', () => {
  it('answers coverage with no token set', async () => {
    const res = await call('contributor', 'GET', '/api/aliases/status');
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as { coverage?: unknown }).coverage !== undefined);
  });
});

describe('the manual door — a person typing a name', () => {
  it('records the alias and answers with the full list, not just an ok', async () => {
    const res = await call('contributor', 'POST', '/api/aliases/items/7', { alias: 'Die Siedler von Catan' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { added?: unknown; aliases?: unknown[] };
    assert.ok(body.added !== undefined);
    assert.ok(Array.isArray(body.aliases));
  });

  it('🔴 a REPEAT is a success, not a 409 — the screen must not argue with the typist', async () => {
    // `changes: 0` is what the insert reports for a name already present.
    const res = await call(
      'owner',
      'POST',
      '/api/aliases/items/7',
      { alias: 'Die Siedler von Catan' },
      envWith(stubDb({ changes: 0 })),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { aliases?: unknown[] };
    assert.ok(Array.isArray(body.aliases), 'the list comes back either way');
  });

  it('a one-character alias is refused — two is the floor everywhere in this repo', async () => {
    const res = await call('owner', 'POST', '/api/aliases/items/7', { alias: 'a' });
    assert.equal(res.status, 400);
  });

  it('an alias over 200 characters is refused rather than truncated', async () => {
    const res = await call('owner', 'POST', '/api/aliases/items/7', { alias: 'x'.repeat(201) });
    assert.equal(res.status, 400);
  });

  it('a body with no alias at all is a 400 with zod issues, not a silent no-op', async () => {
    const res = await call('owner', 'POST', '/api/aliases/items/7', {});
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(((await res.json()) as { detail?: unknown }).detail));
  });

  for (const path of ['/api/aliases/items/0', '/api/aliases/items/abc']) {
    it(`${path} is a 400 before any read or write`, async () => {
      const db = stubDb();
      const res = await call('owner', 'POST', path, { alias: 'Catan' }, envWith(db));
      assert.equal(res.status, 400);
      assert.deepEqual(db._sql, []);
    });
  }

  it('DELETE refuses a non-positive alias id before touching anything', async () => {
    const db = stubDb();
    const res = await call('owner', 'DELETE', '/api/aliases/0', undefined, envWith(db));
    assert.equal(res.status, 400);
    assert.deepEqual(db._sql, []);
  });

  it('DELETE reports WHETHER it removed anything rather than a bare ok', async () => {
    const gone = await call('owner', 'DELETE', '/api/aliases/3', undefined, envWith(stubDb({ changes: 0 })));
    assert.equal(((await gone.json()) as { deleted?: boolean }).deleted, false);

    const removed = await call('owner', 'DELETE', '/api/aliases/3');
    assert.equal(((await removed.json()) as { deleted?: boolean }).deleted, true);
  });
});

describe('no BGG token is a CONFIG failure, worded like its two siblings', () => {
  it('POST /backfill answers 502 naming the variable, never a 403', async () => {
    const res = await call('owner', 'POST', '/api/aliases/backfill');
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'upstream');
    assert.match(body.detail ?? '', /No BoardGameGeek API token configured/);
    assert.match(body.detail ?? '', /Set BGG_API_TOKEN/);
    assert.ok(!/role/i.test(body.detail ?? ''));
  });

  it(`?calls above ${RUN_BGG_CALLS} is refused rather than clamped`, async () => {
    const res = await call('owner', 'POST', `/api/aliases/backfill?calls=${RUN_BGG_CALLS + 1}`);
    assert.equal(res.status, 400);
  });

  it('a bad query string is refused BEFORE the token check', async () => {
    const res = await call('owner', 'POST', '/api/aliases/backfill?itemId=-1');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'bad_request');
  });
});
