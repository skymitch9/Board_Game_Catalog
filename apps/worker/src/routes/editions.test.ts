/**
 * `routes/editions.ts` — populating `edition`, the printings the cover picker
 * chooses between.
 *
 * Both write routes and the status read sit behind one blanket `editCatalog`.
 * Two claims are worth a test:
 *
 * 1. **A missing BGG token answers 502 with a SENTENCE naming the variable**,
 *    not a bare status and not a permission refusal. This is the third of the
 *    three backfill routes to word it the same way (`components`, `aliases`,
 *    here), and the wording is what a person acts on.
 * 2. **`GET /status` costs no BoardGameGeek request.** That is its whole
 *    reason for existing — "how much is left to do" must be answerable without
 *    spending a call — so it must answer even with no token set at all.
 *
 * ⚠️ `POST /campaign` needs no token and must never grow one: it reads stored
 * covers and writes editions, and gating it on the token would make a free,
 * local operation fail for a remote reason.
 *
 * NOT proved: `runEditionBackfill` itself, or any BGG traffic.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { BACKFILL_LIMIT } from '../lib/edition-backfill.js';
import { editionRoutes } from './editions.js';

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
  app.route('/api/editions', editionRoutes);
  return app;
}

function stubDb() {
  const sqlSeen: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          return { n: 0 };
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
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ results: [], meta: { changes: 0 } }));
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database, extra: Partial<Env> = {}) =>
  ({ DB: db, ...extra }) as unknown as Env;

async function call(role: Role, method: string, path: string, env: Env = envWith(stubDb())) {
  return appAs(role).request(path, { method }, env);
}

const ROUTES = [
  { method: 'GET', path: '/api/editions/status' },
  { method: 'POST', path: '/api/editions/backfill' },
  { method: 'POST', path: '/api/editions/campaign' },
] as const;

// ---------------------------------------------------------------------------

describe('every route is behind the blanket editCatalog gate', () => {
  for (const { method, path } of ROUTES) {
    for (const role of ['guest', 'member'] as const) {
      it(`${method} ${path} refuses a ${role} by name, and never runs a query`, async () => {
        const db = stubDb();
        const res = await call(role, method, path, envWith(db));
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

describe('🔴 GET /status costs no BoardGameGeek request — that is why it exists', () => {
  it('answers with no token set at all', async () => {
    const res = await call('contributor', 'GET', '/api/editions/status');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { itemsAwaitingPrintings?: number };
    assert.equal(typeof body.itemsAwaitingPrintings, 'number');
  });
});

describe('no BGG token is a CONFIG failure, said in words and named', () => {
  it('POST /backfill answers 502 naming the variable, never a 403', async () => {
    const res = await call('owner', 'POST', '/api/editions/backfill');
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'upstream');
    // What happened, and what it needs BY NAME.
    assert.match(body.detail ?? '', /No BoardGameGeek API token configured/);
    assert.match(body.detail ?? '', /Set BGG_API_TOKEN/);
    assert.ok(!/role/i.test(body.detail ?? ''), 'a missing token is not a permission problem');
  });

  it('⚠️ POST /campaign needs NO token — it is free and local', async () => {
    // Gating this on the token would make a local operation fail for a remote
    // reason, which is the shape of an outage misreported as a config error.
    const res = await call('owner', 'POST', '/api/editions/campaign');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { run?: unknown };
    assert.ok(body.run !== undefined, 'it answers what it DID, not an ok');
  });
});

describe('the backfill query string is validated, and the limit is capped', () => {
  it(`?limit above ${BACKFILL_LIMIT} is refused rather than clamped`, async () => {
    const res = await call('owner', 'POST', `/api/editions/backfill?limit=${BACKFILL_LIMIT + 1}`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: unknown };
    assert.equal(body.error, 'bad_request');
    assert.ok(Array.isArray(body.detail));
  });

  it('?limit=0 is refused — a backfill of nothing is a mistake', async () => {
    const res = await call('owner', 'POST', '/api/editions/backfill?limit=0');
    assert.equal(res.status, 400);
  });

  it('?itemId=0 is refused — the per-item button always names a real row', async () => {
    const res = await call('owner', 'POST', '/api/editions/backfill?itemId=0');
    assert.equal(res.status, 400);
  });

  it('🔴 a bad query string is refused BEFORE the token check — the more specific fault wins', async () => {
    // Both faults are present. Reporting "no token" for a request that was
    // malformed anyway would send somebody to fix the wrong thing.
    const res = await call('owner', 'POST', '/api/editions/backfill?limit=-5');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'bad_request');
  });

  it('a valid query string with a token set gets past both checks', async () => {
    const res = await call('owner', 'POST', '/api/editions/backfill?limit=1&itemId=7', envWith(stubDb(), { BGG_API_TOKEN: 'set' }));
    assert.notEqual(res.status, 400);
    assert.notEqual(res.status, 502);
  });
});
