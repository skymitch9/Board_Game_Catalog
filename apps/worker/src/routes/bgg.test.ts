/**
 * `routes/bgg.ts` — BoardGameGeek resolution, behind one blanket `editCatalog`.
 *
 * ⚠️ The blanket gate is the thing to pin: `.use('*', requireCapability(...))`
 * covers routes that do not exist yet, so a route added below it inherits the
 * gate rather than escaping it. A test that names only today's five routes
 * would not notice the day somebody moves the `.use` down the file.
 *
 * The other claim here is the missing-token behaviour. BGG has required a
 * bearer since July 2025, and with none set every route must answer **502 with
 * a sentence naming the doc** rather than failing oddly — a configuration
 * failure, never a permission one. `packages/bgg`'s client raises that as a
 * `BggError(503)` and this file maps it to 502; both numbers are pinned so the
 * mapping cannot drift silently.
 *
 * NOT proved: any real BGG call. Every case here either stops at the gate, at
 * `safeParse`, or at the no-token throw — nothing in this file touches the
 * network.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { bggRoutes } from './bgg.js';

function appAs(role: Role) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set(
      'user',
      {
        id: 1,
        email: 'actor@example.test',
        displayName: 'Actor',
        role,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        approvedAt: '2026-01-01T00:00:00.000Z',
      } satisfies AppUser,
    );
    await next();
  });
  app.route('/api/bgg', bggRoutes);
  return app;
}

/** One item (id 7) so `POST /match/:id` gets past its 404. */
function stubDb(opts: { noItem?: boolean } = {}) {
  const sqlSeen: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM item WHERE id = \?/.test(sql) && !opts.noItem) {
            return {
              id: 7,
              bgg_id: null,
              kind: 'game',
              parent_item_id: null,
              root_game_id: 7,
              pending_parent_name: null,
              name: 'Test Game',
              sort_name: 'test game',
              year_published: null,
              publisher: null,
              publisher_url: null,
              source_url: null,
              game_system: null,
              series: null,
              designers: null,
              min_players: null,
              max_players: null,
              playtime_min: null,
              weight: null,
              thumbnail_url: null,
              description: null,
              created_at: '2026-01-01 00:00:00',
              updated_at: '2026-01-01 00:00:00',
            };
          }
          return null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
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
  { method: 'POST', path: '/api/bgg/match/7', body: {} },
  { method: 'GET', path: '/api/bgg/search?q=catan' },
  { method: 'GET', path: '/api/bgg/things/13' },
  { method: 'POST', path: '/api/bgg/import', body: { bggId: 13 } },
  { method: 'POST', path: '/api/bgg/import-many', body: { items: [{ bggId: 13 }] } },
] as const;

// ---------------------------------------------------------------------------

describe('every route is behind the blanket editCatalog gate', () => {
  for (const { method, path } of ROUTES) {
    // No body at all on purpose: the gate must refuse before `safeParse`, so a
    // 400 here would mean the schema ran first and the gate second.
    for (const role of ['guest', 'member'] as const) {
      it(`${method} ${path} refuses a ${role}, and never reaches D1`, async () => {
        const db = stubDb();
        const res = await call(role, method, path, undefined, envWith(db));
        assert.equal(res.status, 403);
        const parsed = (await res.json()) as { capability?: string; role?: string; detail?: string };
        assert.equal(parsed.capability, 'editCatalog');
        assert.equal(parsed.role, role);
        assert.match(parsed.detail ?? '', /Your role does not permit this action/);
        assert.deepEqual(db._sql, []);
      });
    }

    it(`${method} ${path} tells a pending account it is awaiting approval instead`, async () => {
      const res = await call('pending', method, path, undefined);
      assert.equal(res.status, 403);
      assert.match(String(((await res.json()) as { detail?: string }).detail), /awaiting approval/);
    });
  }

  it('🔴 an UNKNOWN route under /api/bgg is 404 — the gate covers the prefix, not a list', async () => {
    // The blanket `.use('*')` is what makes a route added later inherit the
    // gate. A 404 here (rather than a 200) proves nothing escapes the mount.
    const res = await call('owner', 'GET', '/api/bgg/not-a-route');
    assert.equal(res.status, 404);
  });
});

describe('no BGG token is a CONFIG failure, worded and numbered consistently', () => {
  for (const { method, path, body } of ROUTES.map((r) => ({ body: undefined, ...r }))) {
    it(`${method} ${path} answers 502 naming the doc, not a 403 and not a crash`, async () => {
      const res = await call('owner', method, path, body);
      assert.equal(res.status, 502, 'a BggError(503) is mapped to 502 at the route');
      const parsed = (await res.json()) as { error?: string; detail?: string };
      assert.equal(parsed.error, 'upstream');
      assert.match(parsed.detail ?? '', /No BoardGameGeek API token configured/);
      assert.match(parsed.detail ?? '', /SETUP\.md/);
      // ⚠️ A missing token is not a role problem. Wording it as one sends
      // somebody asking for access that would not help.
      assert.ok(!/role/i.test(parsed.detail ?? ''));
    });
  }
});

describe('the request is validated before anything upstream is attempted', () => {
  it('a one-character search is refused by the schema, with the minimum stated', async () => {
    const res = await call('owner', 'GET', '/api/bgg/search?q=a');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: { message?: string }[] };
    assert.match(String(body.detail?.[0]?.message), /at least two characters/);
  });

  it('a non-numeric BGG id is a 400 in words', async () => {
    const res = await call('owner', 'GET', '/api/bgg/things/abc');
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /invalid BGG id/);
  });

  it('an import with no bggId is a 400, not a 502', async () => {
    const res = await call('owner', 'POST', '/api/bgg/import', {});
    assert.equal(res.status, 400);
  });

  it('⚠️ a bulk import is capped at 25 — the throttle is not a suggestion', async () => {
    const res = await call('owner', 'POST', '/api/bgg/import-many', {
      items: Array.from({ length: 26 }, (_, i) => ({ bggId: i + 1 })),
    });
    assert.equal(res.status, 400);
  });

  it('an empty bulk import is a 400 rather than a no-op 200', async () => {
    const res = await call('owner', 'POST', '/api/bgg/import-many', { items: [] });
    assert.equal(res.status, 400);
  });

  it('POST /match/:id 404s for a game that is gone, before any BGG call', async () => {
    const res = await call('owner', 'POST', '/api/bgg/match/7', {}, envWith(stubDb({ noItem: true })));
    assert.equal(res.status, 404);
  });

  it('POST /match/:id refuses a non-numeric id in words', async () => {
    const db = stubDb();
    const res = await call('owner', 'POST', '/api/bgg/match/abc', {}, envWith(db));
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /invalid id/);
    assert.deepEqual(db._sql, []);
  });
});
