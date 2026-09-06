/**
 * `setUserRole` — the ONE role-write path, and the last-owner guard that now
 * lives inside it (KI-7, ported from `library_catalog` on 2026-09-05).
 *
 * ## Why this file exists at the db layer rather than only at the routes
 *
 * The route tests (`apps/worker/src/routes/users.test.ts` and `admin.test.ts`)
 * prove the two mounts *inherit* the guard and word the refusal. They run
 * against a hand-written stub, so what they cannot prove is that the guard's
 * own SQL is right — that `countOwners()` counts what it says, that the
 * before-read sees the row's CURRENT role, and that a refused write leaves the
 * table untouched. This file runs the real functions against a real SQLite with
 * **every migration applied in order**, so those three are measured rather than
 * asserted.
 *
 * ## The bug it pins
 *
 * The guard used to sit in the two routes keyed on `userId === actor.id`, so it
 * fired only on a self-edit. An `admin` — who may grant every rung beneath
 * `admin` — could demote somebody ELSE who was an `owner`, drive
 * `countOwners()` to 0, and after that no role in this app could ever mint an
 * `owner` again. `setUserRole` takes no actor role at all, which is the point:
 * the rule is about the TARGET, and a write that would remove the final owner
 * is refused no matter who asks.
 *
 * ⚠️ SQLite, not D1: this pins the SQL and the schema. It says nothing about
 * D1's binding order or `db.batch` semantics. Same caveat as
 * `family-score.test.ts`, and the same `PRAGMA foreign_keys` line.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { countOwners, setUserRole } from '../src/users.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../migrations');

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
 * The three D1 methods `setUserRole` and `countOwners` use, over `node:sqlite`.
 *
 * Deliberately tiny and deliberately NOT a general D1 emulator — it forwards
 * `first()` and `run()`, with `bind()` optional because `countOwners` does not
 * bind. Anything else these functions started using would throw here rather
 * than quietly pass.
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
      run() {
        const info = db.prepare(sql).run(...(params as never[]));
        return Promise.resolve({ meta: { changes: Number(info.changes) } });
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

let seq = 0;

function addUser(db: DatabaseSync, role: string): number {
  const email = `p${++seq}@example.test`;
  db.prepare('INSERT INTO app_user (email, role) VALUES (?, ?)').run(email, role);
  return Number(db.prepare('SELECT id FROM app_user WHERE email = ?').get(email)!['id']);
}

function roleOf(db: DatabaseSync, id: number): string {
  return String(db.prepare('SELECT role FROM app_user WHERE id = ?').get(id)!['role']);
}

describe('setUserRole — the last-owner guard is keyed on the TARGET', () => {
  it('refuses to demote the only owner, and says which refusal it is', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');
    const admin = addUser(db, 'admin');

    const result = await setUserRole(d1(db), { userId: owner, role: 'member', approvedBy: admin });

    assert.equal(result.ok, false);
    // ⚠️ Distinguishable from `not_found`: the two get different words and
    // different statuses at the routes (400 vs 404).
    assert.equal(result.ok === false && result.reason, 'last_owner');
  });

  it('🔴 the refused write changes NOTHING — the row keeps its role', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');
    const admin = addUser(db, 'admin');

    await setUserRole(d1(db), { userId: owner, role: 'member', approvedBy: admin });

    assert.equal(roleOf(db, owner), 'owner');
    assert.equal(await countOwners(d1(db)), 1, 'countOwners must not have been driven to 0');
  });

  it('allows the demotion once a SECOND owner exists', async () => {
    const db = migratedDb();
    const first = addUser(db, 'owner');
    const second = addUser(db, 'owner');

    const result = await setUserRole(d1(db), { userId: first, role: 'member', approvedBy: second });

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.user.role, 'member');
    assert.equal(roleOf(db, first), 'member');
    assert.equal(await countOwners(d1(db)), 1);
  });

  it('never blocks a write that keeps or creates an owner', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');
    const member = addUser(db, 'member');

    // Promoting while exactly one owner exists: the guard keys on the target's
    // current role, so a member becoming an owner is not its business.
    const promote = await setUserRole(d1(db), { userId: member, role: 'owner', approvedBy: owner });
    assert.equal(promote.ok, true);

    // Re-approving the only owner AS owner is not a demotion either.
    const keep = await setUserRole(d1(db), { userId: owner, role: 'owner', approvedBy: owner });
    assert.equal(keep.ok, true);
  });

  it('demoting a NON-owner is untouched by the guard, even with one owner in the table', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');
    const admin = addUser(db, 'admin');

    // The old route-level guard fired on `userId === actor.id` regardless of the
    // target's role, so an admin demoting themselves while one owner existed was
    // refused with a sentence about owners that had nothing to do with them.
    const result = await setUserRole(d1(db), { userId: admin, role: 'member', approvedBy: admin });

    assert.equal(result.ok, true);
    assert.equal(roleOf(db, admin), 'member');
    assert.equal(roleOf(db, owner), 'owner');
  });

  it('a target that does not exist is `not_found`, and is not confused with `last_owner`', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');

    const result = await setUserRole(d1(db), { userId: 9999, role: 'member', approvedBy: owner });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'not_found');
  });

  it('a successful write stamps approved_at and approved_by', async () => {
    const db = migratedDb();
    const owner = addUser(db, 'owner');
    const target = addUser(db, 'member');

    await setUserRole(d1(db), { userId: target, role: 'contributor', approvedBy: owner });

    const row = db.prepare('SELECT role, approved_at, approved_by FROM app_user WHERE id = ?').get(target)!;
    assert.equal(row['role'], 'contributor');
    assert.equal(row['approved_by'], owner);
    assert.ok(String(row['approved_at']).length > 0);
  });
});
