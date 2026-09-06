/**
 * `routes/barcode.ts` — the cheapest-rung-first ladder, and three capabilities
 * chosen by COST rather than by what the route does.
 *
 * | route | capability | why |
 * |---|---|---|
 * | `GET /:code` | `read` | browsing — "do we already own this?", in a shop |
 * | `POST /identify` | `runResearch` | Claude **plus a web search**, ~1¢ and 74–137 s |
 * | `POST /link` | `editCatalog` | the only route here that writes |
 *
 * ⚠️ `GET /:code` being `read` is deliberate and is the easiest of these to
 * "tidy" into `editCatalog` — it sits beside two write-ish routes and looks out
 * of place. It is not: checking a barcode against the collection is the thing
 * you most want while standing in a shop, and a `member` must be able to do it.
 *
 * ⚠️ `POST /identify` is on `runResearch`, NOT `scanPhoto`, even though it is a
 * "scan": it is a research action about a NUMBER, not a photo, and it buys a
 * web search on top of the model call. Two costs, two switches — its billing
 * feature id is `barcode.paid`, not `scan.photo`. Both facts are asserted
 * below by name, because the two capabilities hold the identical role set and
 * a status code cannot tell them apart.
 *
 * NOT proved: the GameUPC/UPCitemdb ladder itself, the Claude call, or the
 * GameUPC contribution — every case here stops at the gate, at
 * `validateBarcode`, or at the spending refusal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { barcodeRoutes } from './barcode.js';

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
  app.route('/api/barcode', barcodeRoutes);
  return app;
}

/**
 * A store with one game in it.
 *
 * `owned` decides whether `findByBarcode` finds the code: `'yes'` answers on
 * every call (the local hit), `'after-write'` answers null first and the row
 * afterwards (what `linkBarcode` sees when it succeeds), `'no'` never answers.
 *
 * ⚠️ **No test may leave `owned: 'no'` on a WELL-FORMED code for `GET /:code`.**
 * A local miss falls straight through to GameUPC and UPCitemdb over the real
 * network — measured 9.5 s in one such case while this file was being written,
 * which is a suite that phones a third party every run. Every `GET` case below
 * is therefore either a local hit or a malformed code.
 */
function stubDb(opts: { owned?: 'yes' | 'no' | 'after-write' } = {}) {
  const { owned = 'no' } = opts;
  const sqlSeen: string[] = [];
  let writes = 0;

  const match = {
    edition_id: 11,
    edition_name: 'First printing',
    id: 4,
    bgg_id: 13,
    kind: 'game',
    parent_item_id: null,
    root_game_id: 4,
    pending_parent_name: null,
    name: 'Catan',
    sort_name: 'catan',
    year_published: 1995,
    publisher: 'Kosmos',
    publisher_url: null,
    source_url: null,
    game_system: null,
    series: null,
    designers: null,
    min_players: 3,
    max_players: 4,
    playtime_min: 60,
    weight: null,
    thumbnail_url: null,
    description: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };

  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM edition e/.test(sql)) {
            if (owned === 'yes') return match;
            if (owned === 'after-write') return writes > 0 ? match : null;
            return null;
          }
          return null;
        },
        async run() {
          writes += 1;
          return { meta: { changes: 1, last_row_id: 11 } };
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

/** A well-formed UPC-A that passes the check digit. */
const GOOD_BARCODE = '029000071018';

// ---------------------------------------------------------------------------

describe('GET /:code — the free ladder is `read`, so a member may use it in a shop', () => {
  it('a PENDING account is refused, worded as approval', async () => {
    const res = await call(appAs('pending'), 'GET', `/api/barcode/${GOOD_BARCODE}`, undefined);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string; detail?: string };
    assert.equal(body.capability, 'read');
    assert.match(body.detail ?? '', /awaiting approval by an owner/);
  });

  for (const role of ['guest', 'member'] as const) {
    it(`🔴 a ${role} is NOT refused — this is browsing, not editing`, async () => {
      const res = await call(appAs(role), 'GET', '/api/barcode/nonsense', undefined);
      // A 400 from `validateBarcode` proves the handler ran; a 403 would mean
      // somebody had "tidied" this route onto `editCatalog`.
      assert.equal(res.status, 400);
    });
  }

  it('a malformed code is refused in words, before any lookup', async () => {
    const db = stubDb();
    const res = await call(appAs('member'), 'GET', '/api/barcode/12', undefined, envWith(db));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'bad_request');
    assert.ok((body.detail ?? '').length > 0, 'a refusal with no sentence is a bare status');
    assert.deepEqual(db._sql, [], 'a code that cannot be a barcode never reaches D1');
  });

  it('🔴 a code we already own stops at the LOCAL rung — no paid ladder is climbed', async () => {
    // The happy path, against a faked store. The whole point of the local
    // table is that a re-scan costs nothing, so a local hit must return
    // without so much as a free upstream call.
    const res = await call(
      appAs('member'),
      'GET',
      `/api/barcode/${GOOD_BARCODE}`,
      undefined,
      envWith(stubDb({ owned: 'yes' })),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      barcode?: string;
      owned?: boolean;
      match?: { item?: { name?: string } };
      candidates?: unknown[];
      trace?: { source: string; outcome: string }[];
      exhausted?: boolean;
    };
    assert.equal(body.barcode, GOOD_BARCODE);
    assert.equal(body.owned, true);
    assert.equal(body.match?.item?.name, 'Catan');
    assert.deepEqual(body.candidates, []);
    // ⚠️ The trace is the evidence that no rung beyond `local` ran. A caller
    // reading only `owned` could not tell a free answer from a paid one.
    assert.deepEqual(body.trace, [{ source: 'local', outcome: 'already in the collection' }]);
    assert.equal(body.exhausted, false);
  });
});

describe('POST /identify — the paid rung is `runResearch`, not `scanPhoto`', () => {
  for (const role of ['guest', 'member', 'contributor'] as const) {
    it(`a ${role} is refused as runResearch`, async () => {
      const res = await call(appAs(role), 'POST', '/api/barcode/identify', { barcode: GOOD_BARCODE });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string };
      // ⚠️ `scanPhoto` would refuse the same three roles. Only the name is
      // evidence of which gate actually ran.
      assert.equal(body.capability, 'runResearch');
      assert.equal(body.role, role);
    });
  }

  it('🔴 a CONTRIBUTOR may scan free but not pay — the cost split, on one file', async () => {
    const free = await call(
      appAs('contributor'),
      'GET',
      `/api/barcode/${GOOD_BARCODE}`,
      undefined,
      envWith(stubDb({ owned: 'yes' })),
    );
    assert.equal(free.status, 200);

    const paid = await call(appAs('contributor'), 'POST', '/api/barcode/identify', { barcode: GOOD_BARCODE });
    assert.equal(paid.status, 403);
  });

  it('a bad body is a 400 before any spending decision', async () => {
    const res = await call(appAs('owner', ['barcode.paid']), 'POST', '/api/barcode/identify', {}, envWith(stubDb(), { BILLING_POLICY: 'enforce' }));
    assert.equal(res.status, 400);
  });

  it('a malformed barcode is a 400 before any spending decision', async () => {
    const res = await call(
      appAs('owner', ['barcode.paid']),
      'POST',
      '/api/barcode/identify',
      { barcode: 'ABCDEFGH' },
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 400);
  });

  it('🔴 the spending switch is `barcode.paid`, its OWN id — not `scan.photo`', async () => {
    const res = await call(
      appAs('owner', ['barcode.paid']),
      'POST',
      '/api/barcode/identify',
      { barcode: GOOD_BARCODE },
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; feature?: string; needs?: string; how?: string };
    assert.equal(body.error, 'billing_denied');
    assert.equal(body.feature, 'barcode.paid');
    assert.equal(body.needs, 'the estate owner');
    assert.match(body.how ?? '', /Spending panel/);
  });

  it('⚠️ switching PHOTO scanning off does not switch this rung off — two costs, two switches', async () => {
    const res = await call(
      appAs('owner', ['scan.photo']),
      'POST',
      '/api/barcode/identify',
      { barcode: GOOD_BARCODE },
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.notEqual(res.status, 403);
  });
});

describe('POST /link — the only route here that writes', () => {
  for (const role of ['guest', 'member'] as const) {
    it(`a ${role} is refused as editCatalog`, async () => {
      const db = stubDb();
      const res = await call(
        appAs(role),
        'POST',
        '/api/barcode/link',
        { itemId: 1, barcode: GOOD_BARCODE },
        envWith(db),
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'editCatalog');
      assert.deepEqual(db._sql, [], 'a refused caller must not reach the write');
    });
  }

  it('a contributor may link, and the write comes back as a match', async () => {
    const db = stubDb({ owned: 'after-write' });
    const res = await call(
      appAs('contributor'),
      'POST',
      '/api/barcode/link',
      { itemId: 4, barcode: GOOD_BARCODE },
      envWith(db),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      barcode?: string;
      match?: { item?: { id?: number } };
      contributed?: boolean;
    };
    assert.equal(body.barcode, GOOD_BARCODE);
    assert.equal(body.match?.item?.id, 4);
    // ⚠️ `contributed` is always present, and false when GameUPC is
    // unconfigured. A missing key would read as "we don't know".
    assert.equal(body.contributed, false);
  });

  it('🔴 a barcode already on ANOTHER game is a 409 naming it, not a silent overwrite', async () => {
    const res = await call(
      appAs('owner'),
      'POST',
      '/api/barcode/link',
      { itemId: 99, barcode: GOOD_BARCODE },
      envWith(stubDb({ owned: 'yes' })),
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; detail?: string; itemId?: number };
    assert.equal(body.error, 'conflict');
    assert.match(body.detail ?? '', /already linked to "Catan"/);
    assert.equal(body.itemId, 4, 'the conflicting game is named so the screen can offer it');
  });

  it('re-linking the SAME barcode to the SAME game is a success, not a conflict', async () => {
    const res = await call(
      appAs('owner'),
      'POST',
      '/api/barcode/link',
      { itemId: 4, barcode: GOOD_BARCODE },
      envWith(stubDb({ owned: 'yes' })),
    );
    assert.equal(res.status, 200);
  });

  it('a body missing itemId is a 400, not a partial write', async () => {
    const db = stubDb();
    const res = await call(appAs('owner'), 'POST', '/api/barcode/link', { barcode: GOOD_BARCODE }, envWith(db));
    assert.equal(res.status, 400);
    assert.deepEqual(db._sql, []);
  });

  it('a malformed barcode is refused before the write, in words', async () => {
    const db = stubDb();
    const res = await call(
      appAs('owner'),
      'POST',
      '/api/barcode/link',
      { itemId: 1, barcode: '99999999' },
      envWith(db),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.ok((body.detail ?? '').length > 0);
    assert.deepEqual(db._sql, []);
  });

  it('⚠️ linking is never billing-gated — a catalog write costs nothing', async () => {
    const res = await call(
      appAs('owner', ['barcode.paid', 'scan.photo', 'research.tier']),
      'POST',
      '/api/barcode/link',
      { itemId: 4, barcode: GOOD_BARCODE },
      envWith(stubDb({ owned: 'after-write' }), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 200);
  });
});
