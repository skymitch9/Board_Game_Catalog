/**
 * `routes/covers.ts` — cover-image health, and the file with a SPLIT gate on a
 * two-line mount.
 *
 * `.use('*', requireCapability('read'))` covers the whole file, and
 * `POST /check` adds `requireCapability('editCatalog')` on top. Reading the
 * verdict is browsing — anyone who can see the collection can see that some of
 * its pictures are broken — while running a check makes outbound requests and
 * writes rows. A single blanket `editCatalog` would be the easy "tidy", and it
 * would take the health panel away from every reader; a single blanket `read`
 * would hand every member an outbound-request button. Both directions are
 * pinned below.
 *
 * Also pinned: `?limit=` is CAPPED, not merely defaulted. A forced check is the
 * natural place for somebody to type a large number, and the subrequest ceiling
 * does not care that the request was deliberate.
 *
 * NOT proved: the cover check itself (`lib/cover-check.ts`) or any R2 access.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { COVER_BATCH } from '../lib/cover-check.js';
import { coverRoutes } from './covers.js';

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
  app.route('/api/covers', coverRoutes);
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
          return { n: 0, total: 0, broken: 0 };
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
    // `coverHealth` batches its three counts. Results carry `meta` as well as
    // `results` because callers read both.
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

// ---------------------------------------------------------------------------

describe('reading the verdict is browsing — `read`, so a guest may see it', () => {
  for (const path of ['/api/covers/health', '/api/covers/storage']) {
    it(`GET ${path} refuses only a pending account`, async () => {
      const res = await call('pending', 'GET', path);
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; detail?: string };
      assert.equal(body.capability, 'read');
      assert.match(body.detail ?? '', /awaiting approval/);
    });

    for (const role of ['guest', 'member', 'contributor'] as const) {
      it(`GET ${path} lets a ${role} look`, async () => {
        const res = await call(role, 'GET', path);
        assert.equal(res.status, 200);
      });
    }
  }
});

describe('🔴 running a check is a WRITE — editCatalog, on top of the blanket', () => {
  for (const role of ['guest', 'member'] as const) {
    it(`POST /check refuses a ${role} as editCatalog, and never runs a query`, async () => {
      const db = stubDb();
      const res = await call(role, 'POST', '/api/covers/check', envWith(db));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      // ⚠️ Not `read`: the blanket let them in, and the route's own gate is
      // what refused. A single blanket gate in either direction breaks one of
      // these two cases.
      assert.equal(body.capability, 'editCatalog');
      assert.deepEqual(db._sql, []);
    });
  }

  it('a contributor may force a slice', async () => {
    const res = await call('contributor', 'POST', '/api/covers/check');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { run?: unknown; health?: unknown };
    // Answers what it DID and where that leaves things — a bare ok would make
    // "it ran and found nothing" indistinguishable from "it did not run".
    assert.ok(body.run !== undefined);
    assert.ok(body.health !== undefined);
  });
});

describe('the limit is CAPPED, not merely defaulted', () => {
  it(`?limit above ${COVER_BATCH * 2} is refused rather than clamped`, async () => {
    const db = stubDb();
    const res = await call('owner', 'POST', `/api/covers/check?limit=${COVER_BATCH * 2 + 1}`, envWith(db));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: unknown };
    assert.equal(body.error, 'bad_request');
    assert.ok(Array.isArray(body.detail));
    assert.deepEqual(db._sql, [], 'the subrequest ceiling does not care that the request was deliberate');
  });

  it('?limit=0 is refused too — a check of nothing is a mistake, not a no-op', async () => {
    const res = await call('owner', 'POST', '/api/covers/check?limit=0');
    assert.equal(res.status, 400);
  });

  it(`?limit exactly at the cap (${COVER_BATCH * 2}) is allowed`, async () => {
    const res = await call('owner', 'POST', `/api/covers/check?limit=${COVER_BATCH * 2}`);
    assert.equal(res.status, 200);
  });

  it('a non-numeric limit is refused rather than coerced to the default', async () => {
    const res = await call('owner', 'POST', '/api/covers/check?limit=lots');
    assert.equal(res.status, 400);
  });
});

describe('GET /storage — a property of the DEPLOYMENT, not of the collection', () => {
  it('says it is off, and WHY, when no bucket is bound', async () => {
    const res = await call('guest', 'GET', '/api/covers/storage');
    const body = (await res.json()) as { enabled?: boolean; maxBytes?: number; reason?: string };
    assert.equal(body.enabled, false);
    assert.equal(typeof body.maxBytes, 'number');
    // ⚠️ A bare `enabled: false` would leave an operator with nowhere to go.
    assert.match(body.reason ?? '', /no R2 bucket bound/);
    assert.match(body.reason ?? '', /stored as the hotlink given/);
  });

  it('carries no `reason` when it IS on — the key is the problem, not a status', async () => {
    const res = await call('guest', 'GET', '/api/covers/storage', envWith(stubDb(), {
      COVERS: {} as unknown as R2Bucket,
      COVERS_BASE_URL: 'https://gamecovers.heygabi.ai',
    }));
    const body = (await res.json()) as { enabled?: boolean; reason?: string };
    assert.equal(body.enabled, true);
    assert.equal(body.reason, undefined);
  });

  it('⚠️ "both, or neither" — one half of the config alone is NOT enabled', async () => {
    // A route that read one without the other would fall back to a hotlink
    // silently, which is a misconfiguration wearing a feature's clothes.
    const res = await call('guest', 'GET', '/api/covers/storage', envWith(stubDb(), {
      COVERS: {} as unknown as R2Bucket,
    }));
    assert.equal(((await res.json()) as { enabled?: boolean }).enabled, false);
  });
});
