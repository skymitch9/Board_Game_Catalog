/**
 * Migration 0029 — the disposal column and the copy history — run against a
 * real SQLite, with the whole migration chain applied in order.
 *
 * ## Why this is the most important test in the feature
 *
 * `docs/info/copy-status-history.md` §4: *"⚠️ `ON DELETE CASCADE` would defeat
 * the entire feature. `copy` cascades from `item`, so deleting a game would
 * erase the record that you ever owned or sold it — the one fact this table
 * exists to keep."*
 *
 * That is a claim about two foreign keys and a cascade chain two hops long, and
 * it is exactly the kind of claim that reads correct and behaves otherwise.
 * Nothing but running it settles it, so this applies the shipping `.sql` files
 * — every one of them, in order, read from disk — and then deletes things.
 *
 * ⚠️ **`PRAGMA foreign_keys` defaults to OFF in SQLite and ON in D1.** Without
 * the pragma below, every deletion in here would "pass" by doing nothing at all
 * — the cascade would not fire, the SET NULL would not fire, and the history
 * would survive for the wrong reason.
 *
 * ⚠️ SQLite, not D1: this pins the SCHEMA — the FK actions, the triggers, the
 * CHECK — and says nothing about D1's binding order or `db.batch` semantics.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../migrations');
const MIGRATION_0029 = '0029_copy_disposal_history.sql';

/**
 * Every migration, in filename order, applied to one in-memory database.
 *
 * `db.exec` runs a whole file — which matters here in a way it did not for the
 * library's `0430` test: a `CREATE TRIGGER` body contains semicolons, so the
 * usual split-on-`;` helper would cut this migration's two triggers in half and
 * fail on a syntax error that has nothing to do with what is being tested.
 */
function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // See the header. This one line is the difference between a test and a
  // ceremony.
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/** One game with one owned copy, and the ids of both. */
function seed(db: DatabaseSync, name = 'Catan'): { itemId: number; copyId: number } {
  db.prepare("INSERT INTO item (name, kind) VALUES (?, 'base')").run(name);
  const itemId = Number(
    (db.prepare('SELECT id FROM item WHERE name = ?').get(name) as { id: number }).id,
  );
  db.prepare("INSERT INTO copy (item_id, status) VALUES (?, 'owned')").run(itemId);
  const copyId = Number(
    (db.prepare('SELECT id FROM copy WHERE item_id = ?').get(itemId) as { id: number }).id,
  );
  return { itemId, copyId };
}

/** The event `updateCopy` writes — the same INSERT shape, item_name and all. */
function recordDisposal(
  db: DatabaseSync,
  copyId: number,
  opts: { from?: string; to?: string; disposal?: string | null; counterpart?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO copy_event
       (copy_id, item_id, item_name, from_status, to_status, disposal, counterpart)
     SELECT c.id, c.item_id, i.name, ?, ?, ?, ?
       FROM copy c JOIN item i ON i.id = c.item_id
      WHERE c.id = ?`,
  ).run(
    opts.from ?? 'owned',
    opts.to ?? 'sold',
    opts.disposal === undefined ? 'given_away' : opts.disposal,
    opts.counterpart === undefined ? 'Dave' : opts.counterpart,
    copyId,
  );
}

function events(db: DatabaseSync): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM copy_event ORDER BY id').all() as Record<string, unknown>[];
}

describe('migration 0029 — the shape of the change', () => {
  /**
   * ⚠️ Comment lines stripped, and that is not a detail: the migration's header
   * explains at length why `ON DELETE CASCADE` is wrong, so a naive search of
   * the file finds the phrase in the argument AGAINST it and fails a correct
   * migration. Assert on what SQLite will run, never on the prose beside it.
   */
  const sql = readFileSync(join(MIGRATIONS, MIGRATION_0029), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('⚠️ does NOT rebuild `copy` — the whole point of option B', () => {
    // A 12-step rebuild silently drops migration 0002's two quantity triggers
    // and all five indexes. The cheap route is additive, and this is what keeps
    // somebody from "simplifying" it into the expensive one.
    assert.equal(/CREATE TABLE\s+copy\b/i.test(sql), false, 'must not recreate `copy`');
    assert.equal(/DROP TABLE/i.test(sql), false, 'must not drop anything');
    assert.match(sql, /ALTER TABLE copy ADD COLUMN disposal/i);
  });

  it("⚠️ the history FKs are SET NULL, and the word CASCADE appears nowhere", () => {
    // The single line that would defeat the feature.
    assert.equal(/ON DELETE CASCADE/i.test(sql), false);
    assert.equal((sql.match(/ON DELETE SET NULL/gi) ?? []).length, 2);
  });

  it('migration 0002\'s quantity triggers survive it', () => {
    const db = migratedDb();
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    assert.ok(names.includes('copy_quantity_positive_insert'));
    assert.ok(names.includes('copy_quantity_positive_update'));
    assert.ok(names.includes('copy_event_append_only_delete'));
    assert.ok(names.includes('copy_event_append_only_update'));
  });
});

describe('copy.disposal — the CHECK', () => {
  it('accepts the three reasons and NULL', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    for (const d of ['sold', 'given_away', 'lost', null]) {
      db.prepare('UPDATE copy SET disposal = ? WHERE id = ?').run(d, copyId);
    }
  });

  it('refuses anything else — the same way an invalid role does', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    assert.throws(
      () => db.prepare('UPDATE copy SET disposal = ? WHERE id = ?').run('donated', copyId),
      /CHECK constraint failed/i,
    );
  });

  it('⚠️ every pre-0029 copy reads NULL, not a value it never chose', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    const row = db.prepare('SELECT disposal FROM copy WHERE id = ?').get(copyId) as {
      disposal: string | null;
    };
    assert.equal(row.disposal, null);
  });
});

describe('⚠️ history does NOT cascade — the reason this table exists', () => {
  it('deleting the COPY leaves the event, with the copy link nulled', () => {
    const db = migratedDb();
    const { itemId, copyId } = seed(db);
    recordDisposal(db, copyId);

    db.prepare('DELETE FROM copy WHERE id = ?').run(copyId);

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM copy').get()['n' as never], 0);
    const [event] = events(db);
    assert.ok(event, 'the event must survive the copy');
    assert.equal(event['copy_id'], null, 'copy_id is SET NULL, not deleted');
    assert.equal(event['item_id'], itemId, 'the game is still there, so its link stands');
    assert.equal(event['item_name'], 'Catan');
    assert.equal(event['disposal'], 'given_away');
    assert.equal(event['counterpart'], 'Dave');
  });

  it('⚠️ deleting the GAME leaves it too — through TWO hops of cascade', () => {
    // item -> copy is ON DELETE CASCADE (migration 0001), so the copy goes; the
    // copy going must not take the event with it, and neither must the item.
    // This is the exact sequence §4 says would erase the record.
    const db = migratedDb();
    const { itemId, copyId } = seed(db);
    recordDisposal(db, copyId);

    db.prepare('DELETE FROM item WHERE id = ?').run(itemId);

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM copy').get()['n' as never], 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM item').get()['n' as never], 0);

    const [event] = events(db);
    assert.ok(event, 'the event must survive the game');
    assert.equal(event['copy_id'], null);
    assert.equal(event['item_id'], null);
    // The whole reason `item_name` is denormalised: with both ids gone, this is
    // the only thing left that says what the row is about.
    assert.equal(event['item_name'], 'Catan');
    assert.equal(event['from_status'], 'owned');
    assert.equal(event['to_status'], 'sold');
  });

  it('⚠️ and it still holds with recursive_triggers ON', () => {
    /*
      The subtle one. The append-only UPDATE trigger below must not refuse the
      UPDATE that a `SET NULL` foreign-key action performs. SQLite does not fire
      triggers for FK actions unless `recursive_triggers` is on — but that is a
      pragma, it is not ours to promise on D1, and a blanket abort would turn
      "delete a copy" into a hard error the day it changed. So: turn it on and
      delete anyway.
    */
    const db = migratedDb();
    db.exec('PRAGMA recursive_triggers = ON');
    const { itemId, copyId } = seed(db);
    recordDisposal(db, copyId);

    db.prepare('DELETE FROM item WHERE id = ?').run(itemId);

    const [event] = events(db);
    assert.ok(event, 'the delete must not have been aborted by the append-only trigger');
    assert.equal(event['copy_id'], null);
    assert.equal(event['item_id'], null);
    assert.equal(event['item_name'], 'Catan');
  });

  it('two games, one deleted — the other one\'s history is untouched', () => {
    const db = migratedDb();
    const kept = seed(db, 'Wingspan');
    const doomed = seed(db, 'Gloomhaven');
    recordDisposal(db, kept.copyId, { counterpart: 'Sam' });
    recordDisposal(db, doomed.copyId, { counterpart: 'Alex' });

    db.prepare('DELETE FROM item WHERE id = ?').run(doomed.itemId);

    const all = events(db);
    assert.equal(all.length, 2, 'both events survive');
    const surviving = all.find((e) => e['item_name'] === 'Wingspan');
    assert.equal(surviving?.['item_id'], kept.itemId, 'the kept game keeps its link');
    assert.equal(all.find((e) => e['item_name'] === 'Gloomhaven')?.['item_id'], null);
  });
});

describe('⚠️ the history is append-only, enforced by the database', () => {
  it('refuses a DELETE', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    recordDisposal(db, copyId);
    assert.throws(
      () => db.prepare('DELETE FROM copy_event').run(),
      /append-only/i,
    );
    assert.equal(events(db).length, 1);
  });

  it('refuses rewriting what happened', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    recordDisposal(db, copyId);
    for (const stmt of [
      "UPDATE copy_event SET disposal = 'sold'",
      "UPDATE copy_event SET to_status = 'owned'",
      "UPDATE copy_event SET counterpart = 'somebody else'",
      "UPDATE copy_event SET item_name = 'a different game'",
      "UPDATE copy_event SET at = '2001-01-01 00:00:00'",
      'UPDATE copy_event SET price_cents = 99999',
    ]) {
      assert.throws(() => db.prepare(stmt).run(), /append-only/i, stmt);
    }
    const [event] = events(db);
    assert.equal(event?.['disposal'], 'given_away');
    assert.equal(event?.['counterpart'], 'Dave');
  });

  it('⚠️ refuses re-POINTING an event at a different copy or game', () => {
    // The FK exception the trigger carries is "an id may go to NULL". Setting
    // one to a *different* id would let somebody move a sale onto another game,
    // which is editing history by another name.
    const db = migratedDb();
    const a = seed(db, 'One');
    const b = seed(db, 'Two');
    recordDisposal(db, a.copyId);
    assert.throws(
      () => db.prepare('UPDATE copy_event SET item_id = ?').run(b.itemId),
      /append-only/i,
    );
    assert.throws(
      () => db.prepare('UPDATE copy_event SET copy_id = ?').run(b.copyId),
      /append-only/i,
    );
  });

  it('a correction is a NEW event, and both are kept', () => {
    const db = migratedDb();
    const { copyId } = seed(db);
    recordDisposal(db, copyId, { disposal: 'sold', counterpart: 'Dave' });
    recordDisposal(db, copyId, { from: 'sold', to: 'sold', disposal: 'given_away' });

    const all = events(db);
    assert.equal(all.length, 2);
    assert.equal(all[0]?.['disposal'], 'sold', 'the first reading is still on the record');
    assert.equal(all[1]?.['disposal'], 'given_away');
  });
});
