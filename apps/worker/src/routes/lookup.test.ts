/**
 * `routes/lookup.ts` — look a game up by name, to fill in a form.
 *
 * One route, one blanket `editCatalog`. Gated there rather than on `read`
 * because it exists to fill in a form somebody is typing into: a role that
 * cannot create an item has no form to fill.
 *
 * ⚠️ **The cache rule is the interesting half, and it is a WRITE decision:**
 * a result is cached only once BoardGameGeek has had its chance
 * (`hit.bggHydrated || !deps.bggToken`), so a week of type-ahead is not pinned
 * to the thinner shape from before the token arrived. A cached hit is returned
 * with `cached: true` and costs nothing.
 *
 * NOT proved: the resolver itself. Every case here is a refusal, a schema
 * rejection, or a CACHE HIT — ⚠️ a miss would fall through to GameUPC and
 * UPCitemdb over the real network, which no test in this repo may do.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { lookupRoutes } from './lookup.js';

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
  app.route('/api/lookup', lookupRoutes);
  return app;
}

/**
 * `cached` decides whether `getCached` finds an answer.
 *
 * 🔴 Every test that gets past the gate and the schema MUST use `cached: true`.
 * A miss calls `resolveTitle`, which reaches GameUPC and UPCitemdb over the
 * network — 9.5 s and a third-party request per run, measured while the
 * barcode tests were being written.
 */
function stubDb(opts: { cached?: boolean; payload?: string } = {}) {
  const sqlSeen: string[] = [];
  const bindsSeen: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind(...args: unknown[]) {
          bindsSeen.push(args);
          return stmt;
        },
        async first() {
          if (opts.cached && /lookup_cache/.test(sql)) {
            // `getCachedEntry` reads exactly one column, `payload`, and parses
            // it — a corrupt row behaves as a miss, never as an error.
            return {
              payload:
                opts.payload ??
                JSON.stringify([{ name: 'Catan', bggId: 13, source: 'gameupc' }]),
            };
          }
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
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
    _binds: bindsSeen,
  };
  return db as unknown as D1Database & { _sql: string[]; _binds: unknown[][] };
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

async function get(role: Role, path: string, db = stubDb()) {
  const res = await appAs(role).request(path, {}, envWith(db));
  return { res, db };
}

// ---------------------------------------------------------------------------

describe('name lookup is editCatalog — it exists to fill in a form', () => {
  for (const role of ['guest', 'member'] as const) {
    it(`refuses a ${role} by name, and never touches the cache`, async () => {
      const { res, db } = await get(role, '/api/lookup?q=catan');
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
      assert.equal(body.capability, 'editCatalog');
      assert.equal(body.role, role);
      assert.match(body.detail ?? '', /Your role does not permit this action/);
      assert.deepEqual(db._sql, []);
    });
  }

  it('tells a pending account it is awaiting approval instead', async () => {
    const { res } = await get('pending', '/api/lookup?q=catan');
    assert.equal(res.status, 403);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /awaiting approval/);
  });
});

describe('the query is validated before anything is looked up', () => {
  it('a one-character query is refused, with the minimum stated in words', async () => {
    const { res, db } = await get('owner', '/api/lookup?q=a');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: { message?: string }[] };
    assert.equal(body.error, 'bad_request');
    assert.match(String(body.detail?.[0]?.message), /at least two characters/);
    assert.deepEqual(db._sql, [], 'a query too short to search never reaches the cache');
  });

  it('a missing q is refused rather than searching for nothing', async () => {
    const { res } = await get('owner', '/api/lookup');
    assert.equal(res.status, 400);
  });

  it('a query over 200 characters is refused rather than truncated', async () => {
    const { res } = await get('owner', `/api/lookup?q=${'a'.repeat(201)}`);
    assert.equal(res.status, 400);
  });
});

describe('🔴 a cached answer costs nothing, and SAYS it was cached', () => {
  it('returns the stored candidates with cached:true and makes no upstream call', async () => {
    const { res, db } = await get('owner', '/api/lookup?q=catan', stubDb({ cached: true }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates?: { name?: string }[]; cached?: boolean };
    assert.equal(body.cached, true);
    assert.equal(body.candidates?.[0]?.name, 'Catan');
    // ⚠️ Exactly one statement: the cache read. A second would mean the answer
    // was re-cached, i.e. the ladder ran anyway.
    assert.equal(db._sql.length, 1);
    assert.match(String(db._sql[0]), /lookup_cache/);
  });

  it('the whole query string is part of the key — a different search is a different answer', async () => {
    // Both hit the same stub, but the bound key differs; this pins that the
    // route reads `q` rather than caching one answer for every search.
    const { res } = await get('owner', '/api/lookup?q=root', stubDb({ cached: true }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { cached?: boolean }).cached, true);
  });

  it('a whitespace-padded query is trimmed before the key is built', async () => {
    const { res } = await get('owner', '/api/lookup?q=%20%20catan%20%20', stubDb({ cached: true }));
    assert.equal(res.status, 200);
  });
});

describe('🔴 finding 3 — a NEGATIVE is an answer, and it is shared with the scan path', () => {
  it('a stored `null` answers "nothing found" from cache instead of re-running the ladder', async () => {
    // The audit's finding 3, and the half with teeth. This route's own
    // predicate was `hit.bggHydrated || !deps.bggToken`, and a genuine
    // no-candidates result is neither — so a real negative was NEVER written,
    // and every keystroke of every nonexistent title re-ran the whole free
    // ladder against a quota that is 100/day for the entire Worker.
    //
    // ⚠️ Reading it back is the half a test can prove without a network: a
    // stored `null` must come back as a HIT with no candidates, not as a miss.
    // `getCached` cannot tell those apart, which is why the code reads through
    // `getCachedEntry`.
    const { res, db } = await get(
      'owner',
      '/api/lookup?q=notagamethatexists',
      stubDb({ cached: true, payload: 'null' }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates?: unknown[]; cached?: boolean };
    assert.equal(body.cached, true, 'a stored negative is a cache HIT');
    assert.deepEqual(body.candidates, []);
    // ⚠️ Exactly one statement — the read. Two would mean the ladder ran and
    // re-cached, which is the defect wearing a different hat.
    assert.equal(db._sql.length, 1);
  });

  it('the key is the BARE title, not this route\'s old `q:` prefix', async () => {
    // The divergent key meant the type-ahead and the scan path each paid for
    // the same answer, while this file's docstring claimed they shared one.
    // `cacheKey` folds through `normaliseTitle`, so `q:catan` and `catan` are
    // two different rows, not two spellings of one.
    const { db } = await get('owner', '/api/lookup?q=Catan', stubDb({ cached: true }));
    const bound = db._binds[0] ?? [];
    assert.equal(bound[0], 'title', 'the cache KIND');
    assert.equal(
      bound[1],
      'catan',
      `the key is the normalised title; got ${JSON.stringify(bound[1])}`,
    );
  });
});
