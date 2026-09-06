/**
 * `routes/catalog.ts` — the biggest route file, and the only one whose gate is
 * decided by DATA rather than by which route was hit.
 *
 * ## The wishlist split, which is why this file needed tests most
 *
 * The 2026-08-16 role redesign split wanting from curating:
 *
 * | action | capability | rung |
 * |---|---|---|
 * | add a `wanted` copy ("I want this") | `suggestWishlist` | member+ |
 * | edit / remove a copy that IS `wanted` | `manageWishlist` | contributor+ |
 * | everything else about a copy | `editCatalog` | contributor+ |
 *
 * ⚠️ **`requireCapability` cannot express this**, so `catalog.ts` picks the
 * capability inside the handler and calls its own `forbidden()`. Three
 * consequences this file pins:
 *
 * 1. **`manageWishlist` is read from the row AS IT STANDS, never from the body.**
 *    Un-wanting a row is exactly the curation the capability exists to gate, so
 *    reading `patch.status` instead of `existing.status` would let a `member`
 *    delete anything by first setting it to `owned`.
 * 2. **`forbidden()`'s body is the SAME SHAPE `requireCapability` returns.** Two
 *    refusal shapes on one API is how a client ends up handling only one.
 * 3. **`manageWishlist` and `editCatalog` name the identical role set today**,
 *    so a role-only test cannot tell them apart — every assertion is on the
 *    `capability` field.
 *
 * Also pinned: the status/disposal rule is applied to the state a PATCH would
 * LEAVE BEHIND, not to the body it arrived in — `updateCopySchema` is
 * `.partial()` and cannot see the merge.
 *
 * NOT proved: any real query. Every case stops at a gate, at `safeParse`, at
 * the merge rule, or at a stubbed read.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { catalogRoutes } from './catalog.js';

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

function appAs(role: Role) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    await next();
  });
  app.route('/api', catalogRoutes);
  return app;
}

/**
 * One item (id 7) and one copy (id 9) whose status the test chooses. `noItem`
 * and `noCopy` make each one absent, so 404 and 403 can be told apart.
 */
function stubDb(
  opts: { copyStatus?: string; disposal?: string | null; noItem?: boolean; noCopy?: boolean } = {},
) {
  const { copyStatus = 'owned', disposal = null, noItem = false, noCopy = false } = opts;
  const sqlSeen: string[] = [];

  const itemRow = {
    id: 7,
    bgg_id: null,
    kind: 'game',
    parent_item_id: null,
    root_game_id: 7,
    pending_parent_name: null,
    name: 'Test Game',
    sort_name: 'test game',
    year_published: 2024,
    publisher: null,
    publisher_url: null,
    source_url: null,
    game_system: null,
    series: null,
    designers: null,
    min_players: 2,
    max_players: 4,
    playtime_min: 60,
    weight: null,
    thumbnail_url: null,
    description: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };

  const copyRow = {
    id: 9,
    item_id: 7,
    edition_id: null,
    applies_to_copy_id: null,
    quantity: 1,
    status: copyStatus,
    format: 'physical',
    is_sleeved: 0,
    is_punched: 0,
    completeness_notes: null,
    lent_to: null,
    notes: null,
    disposal,
    created_at: '2026-01-01 00:00:00',
  };

  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM item WHERE id = \?/.test(sql)) return noItem ? null : itemRow;
          if (/FROM copy WHERE id = \?/.test(sql)) return noCopy ? null : copyRow;
          return null;
        },
        async run() {
          return { meta: { changes: 1, last_row_id: 9 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      // ⚠️ `meta.changes` matters: `updateCopy` reads it off the FIRST result to
      // decide between "updated" and "no such row", so a batch stub without it
      // turns every status move into a 500.
      return stmts.map(() => ({ results: [], meta: { changes: 1 } }));
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

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

// ---------------------------------------------------------------------------
// 1. the blanket read gate
// ---------------------------------------------------------------------------

const READS = [
  '/api/items',
  '/api/item-names',
  '/api/items/7',
  '/api/items/7/covers',
  '/api/items/7/completeness',
  '/api/items/7/arrivals',
  '/api/items/7/history',
  '/api/items/7/relations',
  '/api/meta',
  '/api/wishlist',
  '/api/retag',
] as const;

describe('reading the collection needs an approved role — `pending` sees nothing', () => {
  for (const path of READS) {
    it(`GET ${path} refuses a pending account, worded as approval`, async () => {
      const db = stubDb();
      const res = await call(appAs('pending'), 'GET', path, undefined, envWith(db));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: string; capability?: string; detail?: string };
      assert.equal(body.error, 'forbidden');
      assert.equal(body.capability, 'read');
      assert.match(body.detail ?? '', /awaiting approval by an owner/);
      assert.deepEqual(db._sql, [], 'a pending account never reaches the collection');
    });
  }

  it('a GUEST may read all of it — that is the whole reason `guest` exists', async () => {
    for (const path of READS) {
      const res = await call(appAs('guest'), 'GET', path, undefined);
      assert.notEqual(res.status, 403, `${path} refused a guest`);
    }
  });
});

describe('an id that is not an id is a 400 in words, not a 404 and not a crash', () => {
  for (const path of ['/api/items/abc', '/api/items/0/covers', '/api/items/-1/history']) {
    it(`GET ${path}`, async () => {
      const db = stubDb();
      const res = await call(appAs('owner'), 'GET', path, undefined, envWith(db));
      assert.equal(res.status, 400);
      assert.match(String(((await res.json()) as { detail?: string }).detail), /invalid id/);
      assert.deepEqual(db._sql, []);
    });
  }
});

describe('⚠️ "nothing ever happened" and "no such game" are different answers', () => {
  it('a game with no history answers `{ events: [] }`', async () => {
    const res = await call(appAs('guest'), 'GET', '/api/items/7/history', undefined);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { events?: unknown[] };
    assert.deepEqual(body.events, []);
  });

  it('a game that is gone answers 404', async () => {
    const res = await call(appAs('guest'), 'GET', '/api/items/7/history', undefined, envWith(stubDb({ noItem: true })));
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// 2. the wishlist split
// ---------------------------------------------------------------------------

describe('POST /items/:id/copies — the capability depends on the STATUS asked for', () => {
  it('🔴 a MEMBER may add a `wanted` copy — "I want this" is member+', async () => {
    const res = await call(appAs('member'), 'POST', '/api/items/7/copies', { status: 'wanted' });
    assert.equal(res.status, 201, 'suggestWishlist covers a member');
  });

  it('🔴 the same MEMBER may NOT add an `owned` copy — that is editCatalog', async () => {
    const res = await call(appAs('member'), 'POST', '/api/items/7/copies', { status: 'owned' });
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    // ⚠️ The SAME four keys `requireCapability` returns. `catalog.ts` has its
    // own `forbidden()` because the capability is not known until the body is
    // read — two refusal SHAPES on one API is how a client ends up handling
    // only one of them.
    assert.deepEqual(Object.keys(body).sort(), ['capability', 'detail', 'error', 'role']);
    assert.equal(body['error'], 'forbidden');
    assert.equal(body['capability'], 'editCatalog');
    assert.equal(body['role'], 'member');
    assert.match(String(body['detail']), /Your role does not permit this action/);
  });

  it('the DEFAULT status is `owned`, so an empty body needs editCatalog', async () => {
    const res = await call(appAs('member'), 'POST', '/api/items/7/copies', {});
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { capability?: string }).capability, 'editCatalog');
  });

  it('a contributor may add either', async () => {
    for (const status of ['wanted', 'owned'] as const) {
      const res = await call(appAs('contributor'), 'POST', '/api/items/7/copies', { status });
      assert.equal(res.status, 201, `contributor could not add ${status}`);
    }
  });

  it('a pending account is refused by the blanket `read` gate first', async () => {
    const res = await call(appAs('pending'), 'POST', '/api/items/7/copies', { status: 'wanted' });
    const body = (await res.json()) as { capability?: string; detail?: string };
    assert.equal(body.capability, 'read');
    assert.match(body.detail ?? '', /awaiting approval/);
  });

  it('404 for a game that is not there, checked BEFORE the capability is chosen', async () => {
    const res = await call(
      appAs('member'),
      'POST',
      '/api/items/7/copies',
      { status: 'owned' },
      envWith(stubDb({ noItem: true })),
    );
    assert.equal(res.status, 404);
  });
});

describe('PATCH/DELETE /copies/:id — the capability is read from the ROW, not the body', () => {
  it('🔴 a member may not un-want a wanted copy — that is manageWishlist, contributor+', async () => {
    const res = await call(
      appAs('member'),
      'PATCH',
      '/api/copies/9',
      { status: 'owned' },
      envWith(stubDb({ copyStatus: 'wanted' })),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string };
    // ⚠️ If this read `patch.status` instead of `existing.status`, the body
    // above says `owned` and the check would have asked for `editCatalog` —
    // the same refusal for a member, but the wrong reason, and the reverse
    // case (`{status:'wanted'}` against an owned row) would have let them
    // through.
    assert.equal(body.capability, 'manageWishlist');
  });

  it('🔴 a member may not DELETE a wanted copy either', async () => {
    const res = await call(appAs('member'), 'DELETE', '/api/copies/9', undefined, envWith(stubDb({ copyStatus: 'wanted' })));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { capability?: string }).capability, 'manageWishlist');
  });

  it('a member editing an OWNED copy is refused as editCatalog — the other branch', async () => {
    const res = await call(appAs('member'), 'PATCH', '/api/copies/9', { notes: 'hi' }, envWith(stubDb({ copyStatus: 'owned' })));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { capability?: string }).capability, 'editCatalog');
  });

  it('a contributor may curate the wishlist', async () => {
    const res = await call(
      appAs('contributor'),
      'PATCH',
      '/api/copies/9',
      { status: 'owned' },
      envWith(stubDb({ copyStatus: 'wanted' })),
    );
    assert.equal(res.status, 200);
  });

  it('404 for a copy that is gone, before any capability is chosen', async () => {
    const res = await call(appAs('member'), 'PATCH', '/api/copies/9', { notes: 'x' }, envWith(stubDb({ noCopy: true })));
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// 3. the status/disposal rule, applied to the MERGED state
// ---------------------------------------------------------------------------

describe('the disposal rule is applied to what the PATCH would LEAVE BEHIND', () => {
  it('🔴 `{status:"sold"}` against a row with NO disposal is refused, in words', async () => {
    const res = await call(appAs('owner'), 'PATCH', '/api/copies/9', { status: 'sold' }, envWith(stubDb({ copyStatus: 'owned', disposal: null })));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.match(String(body.detail), /say what happened to it — sold, given away or lost/);
  });

  it('🔴 the IDENTICAL body against a row that already says `given_away` is fine', async () => {
    // ⚠️ Two identical requests, two different answers. `updateCopySchema` is
    // `.partial()` and cannot see this; only the merge can.
    const res = await call(
      appAs('owner'),
      'PATCH',
      '/api/copies/9',
      { status: 'sold' },
      envWith(stubDb({ copyStatus: 'sold', disposal: 'given_away' })),
    );
    assert.equal(res.status, 200);
  });

  it('moving OFF `sold` while a disposal remains is REJECTED, never quietly corrected', async () => {
    // The tempting shortcut — nulling the disposal — silently discards a fact
    // the caller sent, and a caller that meant something else never finds out.
    const res = await call(
      appAs('owner'),
      'PATCH',
      '/api/copies/9',
      { status: 'owned' },
      envWith(stubDb({ copyStatus: 'sold', disposal: 'sold' })),
    );
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /cannot also be recorded as/);
  });

  it('an explicit `{disposal:null}` reads as the instruction it is — "it is ours again"', async () => {
    const res = await call(
      appAs('owner'),
      'PATCH',
      '/api/copies/9',
      { status: 'owned', disposal: null },
      envWith(stubDb({ copyStatus: 'sold', disposal: 'lost' })),
    );
    assert.equal(res.status, 200);
  });

  it('a CREATE carries the same rule, from the schema rather than the merge', async () => {
    const res = await call(appAs('owner'), 'POST', '/api/items/7/copies', { status: 'sold' });
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// 4. the rest of the gates
// ---------------------------------------------------------------------------

describe('items and relations are editCatalog; ratings are `rate`', () => {
  const EDITS: { method: string; path: string; body?: unknown }[] = [
    { method: 'POST', path: '/api/items', body: { name: 'X', kind: 'game' } },
    { method: 'PATCH', path: '/api/items/7', body: { name: 'Y' } },
    { method: 'DELETE', path: '/api/items/7' },
    { method: 'POST', path: '/api/items/7/relations', body: { toItemId: 8, relation: 'related' } },
    { method: 'DELETE', path: '/api/relations/3' },
  ];

  for (const { method, path, body } of EDITS) {
    it(`${method} ${path} refuses a member as editCatalog`, async () => {
      const db = stubDb();
      const res = await call(appAs('member'), method, path, body, envWith(db));
      assert.equal(res.status, 403);
      assert.equal(((await res.json()) as { capability?: string }).capability, 'editCatalog');
      assert.deepEqual(db._sql, [], 'a refused edit never reaches the catalog');
    });
  }

  it('🔴 a GUEST may not rate — that is the whole difference between guest and member', async () => {
    const res = await call(appAs('guest'), 'PUT', '/api/items/7/rating', { rating: 8 });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { capability?: string }).capability, 'rate');
  });

  it('a MEMBER may rate, and may withdraw a rating', async () => {
    const put = await call(appAs('member'), 'PUT', '/api/items/7/rating', { rating: 8 });
    assert.notEqual(put.status, 403);

    const del = await call(appAs('member'), 'DELETE', '/api/items/7/rating', undefined);
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { deleted: true });
  });

  it('a guest may not withdraw one either', async () => {
    const res = await call(appAs('guest'), 'DELETE', '/api/items/7/rating', undefined);
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { capability?: string }).capability, 'rate');
  });
});
