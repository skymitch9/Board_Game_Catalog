/**
 * `routes/components.ts` — `game_component`, what BoardGameGeek says exists for
 * our games, and the "we have this" verdict a person can type over it.
 *
 * One blanket `editCatalog`, four routes, three claims worth pinning:
 *
 * 1. **A missing BGG token is a 502 with a sentence naming the variable** —
 *    the same wording as `editions` and `aliases`. Three routes, one refusal
 *    shape; a drift on any one of them is a person told a different story
 *    about the same missing secret.
 * 2. **`PUT /:id/manual` is a PUT because setting the same verdict twice is
 *    the same verdict**, and `state: null` is the UNDO — the same route, not a
 *    second endpoint that could drift from this one. `state: 'have' | null` and
 *    nothing else is legal.
 * 3. **`/status` and `/reclassify` cost no BoardGameGeek call at all.**
 *    `reclassify` is the reason the publisher lists are columns rather than
 *    transients: if the rule changes, one request makes every row agree again,
 *    for free.
 *
 * NOT proved: `runComponentBackfill`, the classifier, or any BGG traffic.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { RUN_BGG_CALLS } from '../lib/component-backfill.js';
import { componentRoutes } from './components.js';

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
  app.route('/api/components', componentRoutes);
  return app;
}

/** `changed` decides whether `setComponentManualState` reports a hit. */
function stubDb(opts: { changed?: boolean } = {}) {
  const { changed = true } = opts;
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
          return { meta: { changes: changed ? 1 : 0 } };
        },
        async all() {
          return { results: [] };
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
  { method: 'GET', path: '/api/components/status' },
  { method: 'POST', path: '/api/components/backfill' },
  { method: 'PUT', path: '/api/components/5/manual' },
  { method: 'POST', path: '/api/components/reclassify' },
] as const;

// ---------------------------------------------------------------------------

describe('every route is behind the blanket editCatalog gate', () => {
  for (const { method, path } of ROUTES) {
    for (const role of ['guest', 'member'] as const) {
      it(`${method} ${path} refuses a ${role} by name, and never runs a query`, async () => {
        const db = stubDb();
        const res = await call(role, method, path, undefined, envWith(db));
        assert.equal(res.status, 403);
        const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
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

describe('the two FREE routes cost no BoardGameGeek call', () => {
  it('GET /status answers with no token set', async () => {
    const res = await call('contributor', 'GET', '/api/components/status');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { coverage?: unknown };
    assert.ok(body.coverage !== undefined);
  });

  it('🔴 POST /reclassify answers with no token set — it re-decides from STORED publishers', async () => {
    // This is why the publisher lists are columns rather than transients: if
    // the rule changes, one free request makes every row agree again.
    const res = await call('contributor', 'POST', '/api/components/reclassify');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { updated?: unknown };
    assert.ok(body.updated !== undefined, 'it says how many rows it touched, not an ok');
  });

  it('reclassify accepts an ?itemId scope, and IGNORES a nonsense one rather than failing', async () => {
    // Deliberately forgiving: an unusable scope means "all of them", which is
    // the safe reading for a free, idempotent operation.
    for (const q of ['?itemId=7', '?itemId=abc', '?itemId=-1', '']) {
      const res = await call('owner', 'POST', `/api/components/reclassify${q}`);
      assert.equal(res.status, 200, `reclassify${q} failed`);
    }
  });
});

describe('no BGG token is a CONFIG failure, worded like its two siblings', () => {
  it('POST /backfill answers 502 naming the variable, never a 403', async () => {
    const res = await call('owner', 'POST', '/api/components/backfill');
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'upstream');
    assert.match(body.detail ?? '', /No BoardGameGeek API token configured/);
    assert.match(body.detail ?? '', /Set BGG_API_TOKEN/);
    assert.ok(!/role/i.test(body.detail ?? ''));
  });

  it(`?calls above ${RUN_BGG_CALLS} is refused rather than clamped — it IS the subrequest budget`, async () => {
    const res = await call('owner', 'POST', `/api/components/backfill?calls=${RUN_BGG_CALLS + 1}`);
    assert.equal(res.status, 400);
  });

  it('a bad query string is refused BEFORE the token check', async () => {
    const res = await call('owner', 'POST', '/api/components/backfill?calls=0');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'bad_request');
  });
});

describe('PUT /:id/manual — the owner saying "we have this"', () => {
  it('accepts `have`, and answers with the state it recorded', async () => {
    const res = await call('owner', 'PUT', '/api/components/5/manual', { state: 'have', note: 'in the big box' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id?: number; state?: string | null; note?: string | null };
    assert.equal(body.id, 5);
    assert.equal(body.state, 'have');
    assert.equal(body.note, 'in the big box');
  });

  it('🔴 `state: null` is the UNDO — the same route, not a second endpoint', async () => {
    const res = await call('owner', 'PUT', '/api/components/5/manual', { state: null });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state?: string | null; note?: string | null };
    assert.equal(body.state, null);
    // ⚠️ A withdrawn claim must not leave its reasoning behind to be read as
    // still true.
    assert.equal(body.note, null);
  });

  it('setting the SAME verdict twice is the same verdict — a PUT, not a conflict', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await call('owner', 'PUT', '/api/components/5/manual', { state: 'have' });
      assert.equal(res.status, 200);
    }
  });

  it('any other state is refused — `have` and null are the whole vocabulary', async () => {
    for (const state of ['want', 'missing', true, 0]) {
      const res = await call('owner', 'PUT', '/api/components/5/manual', { state });
      assert.equal(res.status, 400, `state=${JSON.stringify(state)} was accepted`);
    }
  });

  it('a note over 200 characters is refused rather than truncated', async () => {
    const res = await call('owner', 'PUT', '/api/components/5/manual', {
      state: 'have',
      note: 'x'.repeat(201),
    });
    assert.equal(res.status, 400);
  });

  it('a non-positive component id is a 400 in words, before any write', async () => {
    const db = stubDb();
    const res = await call('owner', 'PUT', '/api/components/0/manual', { state: 'have' }, envWith(db));
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /component id must be a positive integer/);
    assert.deepEqual(db._sql, []);
  });

  it('a component that is not there is a 404, not a silent success', async () => {
    const res = await call('owner', 'PUT', '/api/components/5/manual', { state: 'have' }, envWith(stubDb({ changed: false })));
    assert.equal(res.status, 404);
  });
});
