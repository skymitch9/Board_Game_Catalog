/**
 * `routes/export.ts` — the whole catalog in one request, and the route where a
 * privacy decision is made per CALLER rather than per route.
 *
 * ## Why this file exists
 *
 * Until 2026-09-05 the ratings join handed **every contributor every household
 * account's email address**. The fix moved the decision into
 * `lib/export-fields.ts` — one allow-list, one `canExportEmails`, one
 * `exportOmissions` — and `lib/export-fields.test.ts` pins that module.
 * ⚠️ **Nothing pinned that the ROUTE still calls it.** A route that rebuilt the
 * SQL inline, or checked `editCatalog` instead of `manageUsers`, would pass
 * every existing test in this repo and re-open the exposure. That is what the
 * SQL assertions below are for: they read the statement the route actually
 * handed the database.
 *
 * ## The two contracts pinned here
 *
 * - `export.json` carries `schemaVersion`, `counts` and `omitted`. A restore
 *   reads all three; `omitted` in particular is what stops "the accounts had no
 *   addresses" being confused with "whoever exported it could not see them".
 * - `export.csv`'s header row is a spreadsheet's column order. `disposal` sits
 *   beside `status` deliberately (KNOWN_ISSUES KI-4: a copy that was GIVEN AWAY
 *   is stored as `sold`, and an insurance inventory that says "sold" about a
 *   gift is wrong in the one direction that matters).
 *
 * NOT proved: a real D1 export. Every row here comes from a stub.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { exportRoutes } from './export.js';

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
  app.route('/api', exportRoutes);
  return app;
}

/** Remembers every statement, and answers one row per table. */
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
          if (/FROM copy c/.test(sql)) {
            return {
              results: [
                {
                  game: 'Root',
                  item: 'Root',
                  kind: 'game',
                  year: 2018,
                  publisher: 'Leder Games',
                  status: 'sold',
                  disposal: 'given_away',
                  is_sleeved: 1,
                  is_punched: 0,
                  lent_to: null,
                  completeness_notes: 'has, a comma',
                  notes: 'said "hello"',
                  added_at: '2026-01-01 00:00:00',
                },
              ],
            };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ results: [{ id: 1 }] }));
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

async function get(role: Role, path: string, db = stubDb()) {
  const res = await appAs(role).request(path, {}, envWith(db));
  return { res, db };
}

// ---------------------------------------------------------------------------
// 1. the gate on the route
// ---------------------------------------------------------------------------

describe('the export is editCatalog — a reader may not take the whole catalog', () => {
  for (const path of ['/api/export.json', '/api/export.csv']) {
    for (const role of ['guest', 'member'] as const) {
      it(`GET ${path} refuses a ${role} in words, and never runs a query`, async () => {
        const { res, db } = await get(role, path);
        assert.equal(res.status, 403);
        const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
        assert.equal(body.capability, 'editCatalog');
        assert.equal(body.role, role);
        assert.match(body.detail ?? '', /Your role does not permit this action/);
        assert.deepEqual(db._sql, []);
      });
    }

    it(`GET ${path} tells a pending account it is awaiting approval`, async () => {
      const { res } = await get('pending', path);
      assert.equal(res.status, 403);
      assert.match(String(((await res.json()) as { detail?: string }).detail), /awaiting approval/);
    });

    it(`GET ${path} lets a contributor through`, async () => {
      const { res } = await get('contributor', path);
      assert.equal(res.status, 200);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. the email allow-list — decided per caller, in one module
// ---------------------------------------------------------------------------

describe('🔴 who sees the account addresses is decided by `manageUsers`, not by the route gate', () => {
  it('a CONTRIBUTOR’s export asks the database for no email column at all', async () => {
    const { res, db } = await get('contributor', '/api/export.json');
    assert.equal(res.status, 200);
    const ratings = db._sql.find((s) => /FROM user_item ui/.test(s));
    assert.ok(ratings, 'the ratings query is gone from the export');
    // ⚠️ Read off the statement the route HANDED the database — the only place
    // an inline rebuild of this SQL would show up.
    assert.ok(!/u\.email/.test(ratings), `a contributor's export selected an address:\n${ratings}`);
    // Default-deny: an explicit allow-list, never `ui.*` and never
    // SELECT-*-minus-exclusions, which leaks the day a column is added.
    assert.ok(!/ui\.\*/.test(ratings), 'the ratings projection must be an explicit column list');
  });

  for (const role of ['admin', 'owner'] as const) {
    it(`an ${role}’s export DOES carry the address — they already read every one on the People page`, async () => {
      const { db } = await get(role, '/api/export.json');
      const ratings = db._sql.find((s) => /FROM user_item ui/.test(s));
      assert.match(String(ratings), /u\.email/);
    });
  }

  it('the join is present either way, so two people export the SAME rows', async () => {
    for (const role of ['contributor', 'owner'] as const) {
      const { db } = await get(role, '/api/export.json');
      const ratings = db._sql.find((s) => /FROM user_item ui/.test(s));
      assert.match(String(ratings), /JOIN app_user u ON u\.id = ui\.user_id/);
      assert.match(String(ratings), /ORDER BY ui\.id/);
    }
  });

  it('🔴 the file SAYS what it is missing, so a restore need not guess', async () => {
    const { res } = await get('contributor', '/api/export.json');
    const body = (await res.json()) as { omitted?: string[] };
    assert.equal(body.omitted?.length, 1);
    assert.match(String(body.omitted?.[0]), /ratings\[\]\.email/);
    // The way out, named: a refusal that does not say who to ask is half a
    // refusal, and this is the file-shaped version of one.
    assert.match(String(body.omitted?.[0]), /Ask an admin or the owner to re-export/);
  });

  it('an owner’s export omits nothing, and says so with an empty array rather than no key', async () => {
    const { res } = await get('owner', '/api/export.json');
    const body = (await res.json()) as { omitted?: string[] };
    assert.deepEqual(body.omitted, []);
  });
});

// ---------------------------------------------------------------------------
// 3. the JSON contract a restore reads
// ---------------------------------------------------------------------------

describe('export.json — the shape a restore depends on', () => {
  it('carries the schema version, the counts and every table', async () => {
    const { res } = await get('owner', '/api/export.json');
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of ['exportedAt', 'schemaVersion', 'omitted', 'counts', 'items', 'editions', 'copies', 'ratings', 'copyEvents']) {
      assert.ok(key in body, `${key} was dropped from export.json`);
    }
    // ⚠️ Names the last migration whose SHAPE this file knows about, so a
    // restore can tell what it is looking at.
    assert.equal(body['schemaVersion'], '0029_copy_disposal_history');
  });

  it('🔴 `copyEvents` is present — the one class of fact designed to outlive its row', async () => {
    // A backup that omits `copy_event` means the history that survives the
    // deletion of the copy and the game does not survive a restore.
    const { res } = await get('owner', '/api/export.json');
    const body = (await res.json()) as { copyEvents?: unknown[]; counts?: Record<string, number> };
    assert.ok(Array.isArray(body.copyEvents));
    assert.equal(typeof body.counts?.['copyEvents'], 'number');
  });

  it('the counts agree with the arrays beside them', async () => {
    const { res } = await get('owner', '/api/export.json');
    const body = (await res.json()) as { counts?: Record<string, number> } & Record<string, unknown>;
    for (const key of ['items', 'editions', 'copies', 'ratings', 'copyEvents']) {
      assert.equal(body.counts?.[key], (body[key] as unknown[]).length, `${key} count disagrees with its array`);
    }
  });

  it('downloads as a dated file rather than rendering in the tab', async () => {
    const { res } = await get('owner', '/api/export.json');
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="board-game-catalog-\d{4}-\d{2}-\d{2}\.json"/);
  });
});

// ---------------------------------------------------------------------------
// 4. the CSV contract a spreadsheet reads
// ---------------------------------------------------------------------------

describe('export.csv — the flat view for spreadsheets and insurance', () => {
  it('🔴 the header row carries `disposal` beside `status`, in this order', async () => {
    // KNOWN_ISSUES KI-4: a copy that was GIVEN AWAY is stored as `sold`. An
    // insurance inventory that says "sold" about a gift is wrong in the one
    // direction that matters, so the reason travels next to the status.
    const { res } = await get('owner', '/api/export.csv');
    const text = await res.text();
    const header = text.split('\n')[0];
    assert.equal(
      header,
      'game,item,kind,year,publisher,status,disposal,sleeved,punched,lent_to,completeness_notes,notes,added_at',
    );
  });

  it('quotes cells that would otherwise break the row, and doubles embedded quotes', async () => {
    const { res } = await get('owner', '/api/export.csv');
    const row = (await res.text()).split('\n')[1] ?? '';
    assert.match(row, /"has, a comma"/);
    assert.match(row, /"said ""hello"""/);
  });

  it('booleans read as yes/no rather than 1/0', async () => {
    const { res } = await get('owner', '/api/export.csv');
    const row = (await res.text()).split('\n')[1] ?? '';
    assert.match(row, /,yes,no,/);
  });

  it('downloads as a dated .csv', async () => {
    const { res } = await get('owner', '/api/export.csv');
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="board-game-catalog-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it('⚠️ the CSV carries no email column at all, for anybody', async () => {
    // It is one row per COPY, not per rating — there is no account on it, and
    // there must never be one added without the same allow-list the JSON uses.
    for (const role of ['contributor', 'owner'] as const) {
      const { res } = await get(role, '/api/export.csv');
      const header = (await res.text()).split('\n')[0] ?? '';
      assert.ok(!/email/i.test(header), `${role}'s CSV grew an email column`);
    }
  });
});
