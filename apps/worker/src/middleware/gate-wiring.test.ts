/**
 * `middleware/estate.ts` + `middleware/auth.ts` — the WRAPPERS, executed.
 *
 * Written 2026-09-05 to kill three mutation survivors recorded in
 * `catalog-platform/docs/info/mutation-run-2026-09-05.md` §5 S2. That run's
 * finding, in one sentence: *"the estate tests the functions that DECIDE and
 * does not test the code that ACTS on the decision"* — the pure predicates
 * (`combineEstateAndLocal`, `estateMode`, `resolveEstateApp`, the capability
 * matrix) went 7-for-7 against deliberate breakage, and the middleware that
 * reads them went 0-for-3:
 *
 * | id | the mutation that survived |
 * |---|---|
 * | BD-06 | `requireCapability` short-circuited (`if (false && !can(…))`) — every capability gate in the Worker opened |
 * | BD-11 | `estate.ts:231` `if (mode === 'shadow') return null` → `'enforce'` — enforce stops refusing, shadow starts |
 * | BD-12 | `estate.ts:109` `actionFor('revoked')` returns `deny: false` — the shadow soak's greppable WOULD-DENY token disappears |
 *
 * BD-06 was already killed by the route tests added the same day
 * (`routes/users.test.ts` and its fifteen siblings, 157 failing cases); the one
 * case in §1 below is the explicit, named pin so the guard does not depend on
 * a route file continuing to exist. BD-11 and BD-12 were still alive when this
 * file was written, and §2/§3 are what kill them.
 *
 * ## How it runs the real thing
 *
 * `requireAuth()` is mounted exactly as `index.ts` mounts it, over a real
 * `node:sqlite` database with every migration applied — so `upsertUserOnLogin`,
 * `readEstateCache`, `writeEstateCache` and `grantEstateDefaultRole` execute
 * their real SQL. Identity comes through `resolveIdentity`'s **dev bypass**
 * (`ENVIRONMENT === 'development'` + `DEV_EMAIL`), which is the only path into
 * this middleware that needs no network and no minted token.
 *
 * The estate cache is seeded FRESH (`estate_checked_at` = now), so
 * `estateCheck` short-circuits on the cache and `/seen` is never called —
 * except in §4, where `fetch` is replaced to force the unreachable branch.
 *
 * ## What this does NOT prove
 *
 * No live D1, no real Firebase token, no real `/seen` call. Signature
 * verification is `estate-auth`'s own suite; the §3.1 verdict table is
 * `combineEstateAndLocal`'s. This file proves only that the wrapper carries the
 * verdict to the wire at the strength `ESTATE_CHECK` names.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { requireAuth, requireCapability } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../../migrations');

const EMAIL = 'gate-wiring@example.test';

/** Every migration, in filename order, applied to one in-memory database. */
function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/**
 * The four D1 methods this stack uses, over `node:sqlite`. Deliberately not a
 * general emulator — anything else the middleware started calling would throw
 * here rather than quietly pass.
 */
function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params = args;
        return stmt;
      },
      first() {
        return Promise.resolve(db.prepare(sql).get(...(params as never[])) ?? null);
      },
      all() {
        return Promise.resolve({ results: db.prepare(sql).all(...(params as never[])) });
      },
      run() {
        const info = db.prepare(sql).run(...(params as never[]));
        return Promise.resolve({ meta: { changes: Number(info.changes) } });
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

/**
 * Seed the person: a local role, and an estate cache answer stamped NOW so the
 * TTL short-circuit fires and no `/seen` call is attempted.
 *
 * `locallyDecided` is `approved_at IS NOT NULL` — §3.1's "an owner stamped
 * this row" fact, which is what separates `default_grant` from
 * `request_screen`.
 */
function seed(
  db: DatabaseSync,
  opts: { role: Role; estate: string | null; locallyDecided?: boolean; checkedAt?: string | null },
): number {
  const checkedAt =
    opts.checkedAt === undefined ? new Date().toISOString() : opts.checkedAt;
  db.prepare(
    `INSERT INTO app_user (email, display_name, role, approved_at, estate_status, estate_checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    EMAIL,
    'Gate Wiring',
    opts.role,
    (opts.locallyDecided ?? opts.role !== 'pending') ? new Date().toISOString() : null,
    opts.estate,
    opts.estate === null ? null : checkedAt,
  );
  return Number(db.prepare('SELECT id FROM app_user WHERE email = ?').get(EMAIL)!['id']);
}

function envWith(db: DatabaseSync, mode: string | undefined, extra: Partial<Env> = {}): Env {
  return {
    DB: d1(db),
    ENVIRONMENT: 'development',
    DEV_EMAIL: EMAIL,
    DEV_NAME: 'Gate Wiring',
    OWNER_EMAILS: '',
    ESTATE_APP: 'games',
    ESTATE_AUTH_URL: 'https://auth.example.test',
    ESTATE_APP_TOKEN_GAMES: 'test-token',
    ...(mode === undefined ? {} : { ESTATE_CHECK: mode }),
    ...extra,
  } as unknown as Env;
}

/** `index.ts`'s own shape: one blanket `requireAuth()`, then the route. */
function gatedApp() {
  const app = new Hono<AppBindings>();
  app.use('/api/*', requireAuth());
  app.get('/api/probe', (c) => c.json({ ok: true, role: c.get('user').role }));
  return app;
}

/** Run one request and capture every `console.log`/`console.error` line it emits. */
async function probe(env: Env): Promise<{ res: Response; logs: string[] }> {
  const logs: string[] = [];
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  try {
    const res = await gatedApp().request('/api/probe', {}, env);
    return { res, logs };
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
}

const estateLine = (logs: string[]) => logs.find((l) => l.startsWith('estate ')) ?? '';

// ---------------------------------------------------------------------------
// 1. requireCapability actually gates (BD-06)
// ---------------------------------------------------------------------------

describe('requireCapability is WIRED, not merely correct', () => {
  /**
   * `lib/capabilities.test.ts` pins `can()` itself, and it is 5-for-5 against
   * mutation. What nothing pinned until the route tests landed is that the
   * middleware CALLS it and turns `false` into a 403 — the mutation
   * `if (false && !can(user.role, capability))` opened every gate in the
   * Worker and 22 named tests stayed green.
   */
  it('🔴 a role without the capability is REFUSED — the gate is not decorative', async () => {
    const app = new Hono<AppBindings>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 1,
        email: EMAIL,
        displayName: null,
        role: 'member',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        approvedAt: '2026-01-01T00:00:00.000Z',
      });
      await next();
    });
    app.get('/x', requireCapability('manageUsers'), (c) => c.json({ reached: true }));

    const res = await app.request('/x', {}, {} as unknown as Env);
    assert.equal(res.status, 403, 'the handler must never be reached');
    const body = (await res.json()) as { error?: string; capability?: string; reached?: boolean };
    assert.equal(body.error, 'forbidden');
    assert.equal(body.capability, 'manageUsers');
    assert.equal(body.reached, undefined);
  });

  it('a role WITH the capability passes through untouched', async () => {
    const app = new Hono<AppBindings>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 1,
        email: EMAIL,
        displayName: null,
        role: 'owner',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        approvedAt: '2026-01-01T00:00:00.000Z',
      });
      await next();
    });
    app.get('/x', requireCapability('manageUsers'), (c) => c.json({ reached: true }));

    const res = await app.request('/x', {}, {} as unknown as Env);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { reached: true });
  });
});

// ---------------------------------------------------------------------------
// 2. the mode × verdict table — which mode ACTS (BD-11)
// ---------------------------------------------------------------------------

describe('ESTATE_CHECK decides which mode acts — off observes, shadow logs, enforce refuses', () => {
  it('🔴 ENFORCE + revoked → 403 estate_revoked, with the sentence', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { res, logs } = await probe(envWith(db, 'enforce'));

    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'estate_revoked');
    // A person never sees a bare code: what happened, what it needs, how to fix.
    assert.match(body.detail ?? '', /ask an owner to restore it/);
    assert.match(estateLine(logs), /^estate enforce:/);
  });

  it('🔴 SHADOW + revoked → 200, the response is UNCHANGED', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { res, logs } = await probe(envWith(db, 'shadow'));

    assert.equal(res.status, 200, 'shadow may never refuse — that is the whole point of shadow');
    assert.deepEqual(await res.json(), { ok: true, role: 'member' });
    assert.match(estateLine(logs), /^estate shadow:/);
    assert.match(estateLine(logs), /\(response unchanged\)/);
  });

  it('OFF + revoked → 200 and NOT ONE LOG LINE — no /seen, no cache write, nothing', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { res, logs } = await probe(envWith(db, undefined));

    assert.equal(res.status, 200);
    assert.equal(estateLine(logs), '', 'off is inert: a deploy carrying this code changes nothing');
  });

  it('an unrecognised ESTATE_CHECK is OFF, and says so — it may not silently enforce', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { res, logs } = await probe(envWith(db, 'enfroce'));

    assert.equal(res.status, 200);
    assert.ok(
      logs.some((l) => /unrecognised ESTATE_CHECK value 'enfroce'/.test(l)),
      'a typo must name itself on every request',
    );
  });

  it('ENFORCE + approved + locally active → proceed, on the local role', async () => {
    const db = migratedDb();
    seed(db, { role: 'moderator', estate: 'approved' });
    const { res } = await probe(envWith(db, 'enforce'));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, role: 'moderator' });
  });

  it('ENFORCE + approved + never locally decided → the default grant LANDS in the row', async () => {
    const db = migratedDb();
    const id = seed(db, { role: 'pending', estate: 'approved', locallyDecided: false });
    const { res } = await probe(envWith(db, 'enforce'));

    assert.equal(res.status, 200);
    // `guest`, deliberately the SMALLER of the two read-capable roles.
    assert.deepEqual(await res.json(), { ok: true, role: 'guest' });
    assert.equal(String(db.prepare('SELECT role FROM app_user WHERE id = ?').get(id)!['role']), 'guest');
  });

  it('🔴 SHADOW + approved + never locally decided → the grant is LOGGED and NEVER written', async () => {
    const db = migratedDb();
    const id = seed(db, { role: 'pending', estate: 'approved', locallyDecided: false });
    const { res, logs } = await probe(envWith(db, 'shadow'));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, role: 'pending' }, 'shadow writes no role');
    assert.equal(String(db.prepare('SELECT role FROM app_user WHERE id = ?').get(id)!['role']), 'pending');
    assert.match(estateLine(logs), /would=grant default role 'guest'/);
  });
});

// ---------------------------------------------------------------------------
// 3. the greppable soak token (BD-12)
// ---------------------------------------------------------------------------

describe("the shadow soak's WOULD-DENY token is the evidence the flip depends on", () => {
  /**
   * §9 step 5/6 of the design: run shadow for days and flip to enforce when
   * `grep WOULD-DENY` is empty for household members. A verdict whose
   * `actionFor(...).deny` silently became `false` would print a clean log for a
   * request enforce-mode WOULD have refused — the soak reads as evidence of
   * safety while measuring nothing. That is exactly what BD-12 mutated, and
   * nothing went red.
   */
  it('🔴 SHADOW + revoked prints WOULD-DENY', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { logs } = await probe(envWith(db, 'shadow'));

    const line = estateLine(logs);
    assert.match(line, /verdict=revoked/);
    assert.match(line, /WOULD-DENY/);
  });

  it('🔴 ENFORCE + revoked prints DENIED', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { logs } = await probe(envWith(db, 'enforce'));

    assert.match(estateLine(logs), /DENIED/);
  });

  it('a verdict that does NOT deny prints neither token', async () => {
    const db = migratedDb();
    seed(db, { role: 'moderator', estate: 'approved' });
    const { logs } = await probe(envWith(db, 'shadow'));

    const line = estateLine(logs);
    assert.match(line, /verdict=proceed/);
    assert.ok(!/WOULD-DENY/.test(line), 'a proceed is not a would-deny');
    assert.ok(!/DENIED/.test(line), 'and it is not a denial either');
  });

  it('the log line names the APP — two instances serve one bundle (F-5)', async () => {
    const db = migratedDb();
    seed(db, { role: 'member', estate: 'revoked' });
    const { logs } = await probe(envWith(db, 'shadow'));

    assert.match(estateLine(logs), /app=games/);
  });
});

// ---------------------------------------------------------------------------
// 4. the outage is not a denial
// ---------------------------------------------------------------------------

describe('an unreachable directory is named, and never dressed as a refusal', () => {
  async function withDeadFetch<T>(fn: () => Promise<T>): Promise<T> {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('estate directory is down');
    }) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = real;
    }
  }

  it('🔴 ENFORCE + no cache + no local standing → 503 estate_unreachable, not 403', async () => {
    const db = migratedDb();
    seed(db, { role: 'pending', estate: null, locallyDecided: false });
    const { res, logs } = await withDeadFetch(() => probe(envWith(db, 'enforce')));

    assert.equal(res.status, 503, 'a server failure is NOT a permission failure');
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'estate_unreachable');
    assert.match(body.detail ?? '', /try again shortly/);
    assert.match(estateLine(logs), /verdict=estate_unreachable/);
  });

  it('ENFORCE + no cache + a standing local role → proceeds (open for the admitted)', async () => {
    const db = migratedDb();
    seed(db, { role: 'moderator', estate: null });
    const { res } = await withDeadFetch(() => probe(envWith(db, 'enforce')));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, role: 'moderator' });
  });

  it('SHADOW + no cache + no local standing → 200, would-deny logged', async () => {
    const db = migratedDb();
    seed(db, { role: 'pending', estate: null, locallyDecided: false });
    const { res, logs } = await withDeadFetch(() => probe(envWith(db, 'shadow')));

    assert.equal(res.status, 200);
    assert.match(estateLine(logs), /WOULD-DENY/);
  });
});
