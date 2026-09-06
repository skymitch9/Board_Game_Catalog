/**
 * `routes/scan-jobs.ts` — the intake queue, and the file where THREE different
 * capabilities meet.
 *
 * The 2026-08-16 role redesign split scanning by cost (*"lets let contributors
 * scan barcodes only since those are free"* — the owner), replacing this file's
 * old blanket `.use('*', requireCapability('editCatalog'))` with three gates:
 *
 * | route | capability | why |
 * |---|---|---|
 * | `POST /` | `scanPhoto` | bills the Anthropic vision API |
 * | `POST /barcode` | `scanBarcode` | free — local table, then GameUPC/UPCitemdb |
 * | everything else | `editCatalog` | manages an existing job, spends nothing |
 *
 * ⚠️ **`scanBarcode` and `editCatalog` name the IDENTICAL role set today**
 * (both contributor+), and `scanPhoto` shares its set with `runResearch`. So a
 * role-only test cannot tell any of these apart — the `capability` field on the
 * wire is the only thing that can, which is why every assertion below is
 * against that exact string. This is the same reasoning
 * `library_catalog/apps/worker/src/routes/scan-jobs.test.ts` records, and the
 * same class of bug it was written for (routes gated on the wrong one of two
 * same-shaped capabilities).
 *
 * ⚠️ Also pinned: `/history` and `/barcode` are LITERALS registered before
 * `/:id`, so a job can never be called "history" or "barcode". Hono matches in
 * registration order, and swapping two lines here would route `/history` into
 * the single-job handler — a silent 404 or, worse, a `Number('history')` NaN.
 *
 * NOT proved here: the vision pipeline, the barcode ladder or any D1 write —
 * every case stops at the gate, at `safeParse`, or at the spending refusal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { scanJobRoutes } from './scan-jobs.js';

function userWith(role: Role): AppUser {
  return {
    id: 1,
    email: 'actor@example.test',
    displayName: 'Actor',
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

function appAs(role: Role, billingDenied: string[] | null = null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    c.set('billingDenied', billingDenied);
    await next();
  });
  app.route('/api/scan-jobs', scanJobRoutes);
  return app;
}

/**
 * A D1 stub that answers "no such job" to everything and remembers the SQL, so
 * a test can prove a refused caller never reached it.
 */
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

async function call(
  app: Hono<AppBindings>,
  method: string,
  path: string,
  body?: unknown,
  env: Env = envWith(stubDb()),
) {
  return app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

const SMALL_PHOTO = 'A'.repeat(128);

// ---------------------------------------------------------------------------
// 1. three capabilities, asserted by NAME
// ---------------------------------------------------------------------------

describe('POST / — the photo upload is scanPhoto, not editCatalog', () => {
  for (const role of ['guest', 'member', 'contributor'] as const) {
    it(`a ${role} is refused as scanPhoto`, async () => {
      const res = await call(appAs(role), 'POST', '/api/scan-jobs', {});
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string };
      // 🔴 A contributor holds `editCatalog` AND `scanBarcode`. If this route
      // were still on the old blanket gate, a contributor would be let through
      // to spend money on the vision API.
      assert.equal(body.capability, 'scanPhoto');
      assert.equal(body.role, role);
    });
  }

  it('a moderator clears the gate (fails on the empty body, not on role)', async () => {
    const res = await call(appAs('moderator'), 'POST', '/api/scan-jobs', {});
    assert.equal(res.status, 400);
  });

  it('a PENDING account is told it is awaiting approval', async () => {
    const res = await call(appAs('pending'), 'POST', '/api/scan-jobs', {});
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /awaiting approval by an owner/);
  });
});

describe('POST /barcode — the free rung is scanBarcode, one rung lower', () => {
  for (const role of ['guest', 'member'] as const) {
    it(`a ${role} is refused as scanBarcode`, async () => {
      const res = await call(appAs(role), 'POST', '/api/scan-jobs/barcode', {});
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'scanBarcode');
    });
  }

  it('🔴 a CONTRIBUTOR is let through here but refused on the photo route — the whole point of the split', async () => {
    const free = await call(appAs('contributor'), 'POST', '/api/scan-jobs/barcode', {});
    assert.equal(free.status, 400, 'barcodeScanSchema rejects the empty body — proof the handler ran');

    const paid = await call(appAs('contributor'), 'POST', '/api/scan-jobs', {});
    assert.equal(paid.status, 403);
  });

  it('a malformed barcode is refused in words, before any lookup', async () => {
    const db = stubDb();
    const res = await call(
      appAs('contributor'),
      'POST',
      '/api/scan-jobs/barcode',
      { barcode: 'ABCDEFGH' },
      envWith(db),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: unknown };
    assert.ok(body.detail, 'a refusal with no sentence is a bare status');
    assert.deepEqual(db._sql, [], 'nothing reached D1');
  });
});

describe('every managing route stays on editCatalog', () => {
  const MANAGING = [
    { method: 'GET', path: '/api/scan-jobs' },
    { method: 'GET', path: '/api/scan-jobs/history' },
    { method: 'GET', path: '/api/scan-jobs/7' },
    { method: 'POST', path: '/api/scan-jobs/7/enrich' },
    { method: 'POST', path: '/api/scan-jobs/7/cancel' },
    { method: 'POST', path: '/api/scan-jobs/7/titles' },
    { method: 'POST', path: '/api/scan-jobs/7/titles/0/relookup' },
    { method: 'POST', path: '/api/scan-jobs/7/titles/0/accept' },
    { method: 'POST', path: '/api/scan-jobs/7/done' },
    { method: 'DELETE', path: '/api/scan-jobs/7' },
  ] as const;

  for (const { method, path } of MANAGING) {
    it(`${method} ${path} refuses a member as editCatalog, and never reaches D1`, async () => {
      const db = stubDb();
      const res = await call(appAs('member'), method, path, method === 'GET' ? undefined : {}, envWith(db));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'editCatalog');
      assert.deepEqual(db._sql, []);
    });
  }

  it('a contributor manages a queue freely — 404 for a job that is not there, not 403', async () => {
    const res = await call(appAs('contributor'), 'GET', '/api/scan-jobs/7', undefined);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'not_found');
  });
});

// ---------------------------------------------------------------------------
// 2. literal routes registered before /:id
// ---------------------------------------------------------------------------

describe('the literal routes cannot be shadowed by /:id', () => {
  it('/history is the history page, not a job called "history"', async () => {
    const res = await call(appAs('owner'), 'GET', '/api/scan-jobs/history', undefined);
    // The single-job handler would answer 400 (`Number('history')` is NaN);
    // the history handler answers 200 with a page.
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok('jobs' in body || 'page' in body, `history answered ${JSON.stringify(body)}`);
  });

  it('POST /barcode is the barcode rung, not a job called "barcode"', async () => {
    // A job id path would 400 on the id; this 400s on the SCHEMA, and the two
    // are told apart by the body carrying zod issues.
    const res = await call(appAs('owner'), 'POST', '/api/scan-jobs/barcode', {});
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: unknown };
    assert.ok(Array.isArray(body.detail), 'expected zod issues, so the barcode handler ran');
  });
});

// ---------------------------------------------------------------------------
// 3. the spending gate on the one route that spends
// ---------------------------------------------------------------------------

describe('POST / — the spending gate, ANDed with scanPhoto', () => {
  const photoBody = { data: SMALL_PHOTO, mediaType: 'image/jpeg', mode: 'shelf' };

  it('"enforce" + denied refuses in words, and 🔴 creates NO job row', async () => {
    // ⚠️ Checked before `createScanJob`: a job created and then refused would
    // sit in the queue looking like work in progress nobody is doing.
    const db = stubDb();
    const res = await call(
      appAs('owner', ['scan.photo']),
      'POST',
      '/api/scan-jobs',
      photoBody,
      envWith(db, { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; feature?: string; needs?: string; how?: string };
    assert.equal(body.error, 'billing_denied');
    assert.equal(body.feature, 'scan.photo');
    assert.equal(body.needs, 'the estate owner');
    assert.match(body.how ?? '', /Spending panel/);
    assert.ok(
      !db._sql.some((s) => /INSERT INTO scan_job/i.test(s)),
      'a refusal must leave no trace but its sentence and one log line',
    );
  });

  it('"off" is inert — the denied set is not even consulted', async () => {
    const res = await call(
      appAs('owner', ['scan.photo']),
      'POST',
      '/api/scan-jobs',
      photoBody,
      envWith(stubDb(), { BILLING_POLICY: 'off' }),
    );
    assert.notEqual(res.status, 403);
  });

  it('a bad photo body is a 400 even under enforce — a bad request is not a billing refusal', async () => {
    const res = await call(
      appAs('owner', ['scan.photo']),
      'POST',
      '/api/scan-jobs',
      {},
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 400);
  });

  it('⚠️ the FREE rung is never billing-gated — scan.photo does not switch off barcodes', async () => {
    const res = await call(
      appAs('contributor', ['scan.photo']),
      'POST',
      '/api/scan-jobs/barcode',
      {},
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 400, 'the schema refused it, not the wallet');
  });
});
