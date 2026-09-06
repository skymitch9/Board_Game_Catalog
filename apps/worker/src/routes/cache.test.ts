/**
 * `routes/cache.ts` — the smallest route file, and the one with the most
 * surprising gate.
 *
 * ⚠️ **It is `manageUsers`, not `editCatalog`, and that is deliberate.** Every
 * row behind these routes is "we asked the internet this before" — never
 * catalog data — so clearing is cheap and safe, and the worst outcome is paying
 * for a lookup again. It is gated on `manageUsers` because it is an OPERATOR
 * action: whoever can promote people is the person who should be poking at
 * internals. That reasoning is easy to lose, and "it only clears a cache, let
 * contributors do it" is exactly the tidy that this test exists to catch.
 *
 * NOT proved: that clearing actually removes rows — `cacheStats`/`clearCache`
 * are `@bgc/db`'s, and this is the route around them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { cacheRoutes } from './cache.js';

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
  app.route('/api/cache', cacheRoutes);
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
          return { meta: { changes: 3 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    // `cacheStats` batches its one grouped count.
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ results: [], meta: { changes: 0 } }));
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

async function call(role: Role, method: string, path: string, db = stubDb()) {
  const res = await appAs(role).request(path, { method }, envWith(db));
  return { res, db };
}

// ---------------------------------------------------------------------------

describe('🔴 cache maintenance is an OPERATOR action — manageUsers, not editCatalog', () => {
  for (const method of ['GET', 'DELETE'] as const) {
    for (const role of ['guest', 'member', 'contributor', 'moderator'] as const) {
      it(`${method} /api/cache refuses a ${role} by that name, and never runs a query`, async () => {
        const { res, db } = await call(role, method, '/api/cache');
        assert.equal(res.status, 403);
        const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
        // ⚠️ A `moderator` is refused here and allowed on every catalog write —
        // this line is the whole distinction, and only the name records it.
        assert.equal(body.capability, 'manageUsers');
        assert.equal(body.role, role);
        assert.match(body.detail ?? '', /Your role does not permit this action/);
        assert.deepEqual(db._sql, []);
      });
    }

    it(`${method} /api/cache tells a pending account it is awaiting approval`, async () => {
      const { res } = await call('pending', method, '/api/cache');
      assert.match(String(((await res.json()) as { detail?: string }).detail), /awaiting approval/);
    });

    for (const role of ['admin', 'owner'] as const) {
      it(`${method} /api/cache lets an ${role} through`, async () => {
        const { res } = await call(role, method, '/api/cache');
        assert.equal(res.status, 200);
      });
    }
  }
});

describe('the routes answer with something usable', () => {
  it('GET reports the stats rather than an empty ok', async () => {
    const { res } = await call('owner', 'GET', '/api/cache');
    const body = (await res.json()) as { stats?: unknown };
    assert.ok(body.stats !== undefined, 'a maintenance page needs the numbers, not an ok');
  });

  it('DELETE says how much it removed AND what is left', async () => {
    // "It ran and removed nothing" and "it ran and removed 300 rows" are the
    // two outcomes an operator must be able to tell apart.
    const { res } = await call('owner', 'DELETE', '/api/cache');
    const body = (await res.json()) as { removed?: unknown; stats?: unknown };
    assert.ok(body.removed !== undefined);
    assert.ok(body.stats !== undefined);
  });

  it('an unrecognised ?target= is a 400, not a silent clear-everything', async () => {
    // 🔴 Defaulting a bad target to `all` would turn a typo into a wider
    // destructive action than the caller asked for.
    const { res, db } = await call('owner', 'DELETE', '/api/cache?target=everything');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; detail?: unknown };
    assert.equal(body.error, 'bad_request');
    assert.ok(Array.isArray(body.detail), 'the zod issues say which values are legal');
    assert.deepEqual(db._sql, [], 'nothing was cleared on the way to the refusal');
  });

  it('an ABSENT target defaults to `all`, which is the documented behaviour', async () => {
    const { res } = await call('owner', 'DELETE', '/api/cache');
    assert.equal(res.status, 200);
  });

  it('`lookups` is accepted as the narrower target', async () => {
    const { res } = await call('owner', 'DELETE', '/api/cache?target=lookups');
    assert.equal(res.status, 200);
  });
});
