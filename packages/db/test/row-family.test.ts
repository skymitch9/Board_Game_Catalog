/**
 * The family badge's membership rule — *which family does this ROW belong to?*
 *
 * `familiesForRoots` exists so a search result can say "Dice Throne · 11 lines"
 * and link into the rest of the family. The one thing that has to be true of it
 * is that it agrees with `GroupCard`, always: a row must never claim a family
 * the collection page would refuse to fold, and must never stay silent about
 * one it would.
 *
 * It agrees by CONSTRUCTION — both read `ROOT_GROUP_CTE`, and there is no second
 * rule to drift. This file exists because "by construction" is a claim about SQL
 * that is easy to make and easy to get wrong, so every clause of the rule is
 * pinned here against a real SQLite with **every migration applied in order**:
 *
 *   1. **A series outranks a game system** when a tree carries both.
 *   2. **The value most of the tree carries wins** — the production case is one
 *      tree holding 20 rows of "D&D 2024" and one of the playtest sheet.
 *   3. ⚠️ **A grouping of one line is not a grouping.** A series only this box
 *      carries produces NO family, so the row renders exactly as it did before
 *      the badge existed. This is the clause a hand-rolled "does it have a
 *      series?" check would have got wrong, and it is why the badge reads the
 *      group card's rule rather than the column.
 *
 * ⚠️ SQLite, not D1: this pins the SQL and the schema. It says nothing about
 * D1's binding order or `db.batch` semantics. Same caveat, same reason, as
 * `family-score.test.ts` beside it.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { familiesForRoots } from '../src/items.js';

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
 * The two D1 methods `familiesForRoots` uses, over `node:sqlite`.
 *
 * Deliberately tiny and deliberately NOT a general D1 emulator — it forwards one
 * `prepare(...).bind(...).all()` and nothing else, so it cannot quietly make a
 * query pass that D1 would reject for using something this does not implement.
 */
function d1(db: DatabaseSync): Parameters<typeof familiesForRoots>[0] {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all() {
              const stmt = db.prepare(sql);
              return Promise.resolve({ results: stmt.all(...(params as never[])) });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof familiesForRoots>[0];
}

let seq = 0;

/** One line of the catalog: a base game, and the label(s) its rows carry. */
function addLine(
  db: DatabaseSync,
  opts: { name?: string; series?: string | null; gameSystem?: string | null },
): number {
  const name = opts.name ?? `Game ${++seq}`;
  db.prepare(
    `INSERT INTO item (name, kind, parent_item_id, root_game_id, series, game_system)
     VALUES (?, 'base', NULL, NULL, ?, ?)`,
  ).run(name, opts.series ?? null, opts.gameSystem ?? null);
  const id = Number(db.prepare('SELECT id FROM item WHERE name = ?').get(name)!['id']);
  // A base game is its own root — the shape `createItem` writes, and what
  // `ROOT_GROUP_CTE` groups on.
  db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').run(id);
  return id;
}

/** A row inside a line, carrying its own labels. */
function addChild(
  db: DatabaseSync,
  opts: {
    root: number;
    name?: string;
    kind?: string;
    series?: string | null;
    gameSystem?: string | null;
  },
): number {
  const name = opts.name ?? `Thing ${++seq}`;
  db.prepare(
    `INSERT INTO item (name, kind, parent_item_id, root_game_id, series, game_system)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(name, opts.kind ?? 'expansion', opts.root, opts.root, opts.series ?? null, opts.gameSystem ?? null);
  return Number(db.prepare('SELECT id FROM item WHERE name = ?').get(name)!['id']);
}

describe('familiesForRoots — a row only claims a family the group card would fold', () => {
  it('two lines sharing a series are one family, named and counted', async () => {
    const db = migratedDb();
    const one = addLine(db, { name: 'Dice Throne S1', series: 'Dice Throne' });
    const two = addLine(db, { name: 'Marvel Dice Throne', series: 'Dice Throne' });
    addChild(db, { root: two, name: 'Scarlet Witch', series: 'Dice Throne' });

    const families = await familiesForRoots(d1(db), [one, two]);
    assert.deepEqual(families.get(one), {
      key: 'series:Dice Throne',
      axis: 'series',
      name: 'Dice Throne',
      lines: 2,
      items: 3,
    });
    // The same family, stated identically on the other line — it is a fact
    // about the family, not about the row you happened to be looking at.
    assert.deepEqual(families.get(two), families.get(one));
  });

  it('🔴 a series only ONE line carries is not a family — the row gets nothing', async () => {
    const db = migratedDb();
    const lone = addLine(db, { name: 'Wingspan', series: 'Wingspan' });
    addChild(db, { root: lone, name: 'Europe', series: 'Wingspan' });

    const families = await familiesForRoots(d1(db), [lone]);
    assert.equal(families.size, 0);
    assert.equal(families.get(lone), undefined);
  });

  it('a line with no series and no system has no family', async () => {
    const db = migratedDb();
    const plain = addLine(db, { name: 'Go Fish' });

    assert.equal((await familiesForRoots(d1(db), [plain])).size, 0);
  });

  it('a series outranks a game system on the same tree', async () => {
    const db = migratedDb();
    // Both labels apply to both lines, so both would group; the series wins.
    const one = addLine(db, { name: 'Book A', series: 'Auroboros', gameSystem: 'D&D 5e (2014)' });
    const two = addLine(db, { name: 'Book B', series: 'Auroboros', gameSystem: 'D&D 5e (2014)' });

    const families = await familiesForRoots(d1(db), [one, two]);
    assert.equal(families.get(one)?.axis, 'series');
    assert.equal(families.get(one)?.name, 'Auroboros');
    assert.equal(families.get(two)?.key, 'series:Auroboros');
  });

  it('a game system groups when there is no series — the D&D 5e case', async () => {
    const db = migratedDb();
    const phb = addLine(db, { name: "Player's Handbook", gameSystem: 'D&D 5e (2014)' });
    const third = addLine(db, { name: 'Third-party module', gameSystem: 'D&D 5e (2014)' });

    const families = await familiesForRoots(d1(db), [phb, third]);
    assert.equal(families.get(phb)?.axis, 'system');
    assert.equal(families.get(phb)?.key, 'system:D&D 5e (2014)');
    assert.equal(families.get(phb)?.lines, 2);
  });

  it('⚠️ the value MOST of the tree carries wins — not the alphabetically first', async () => {
    const db = migratedDb();
    // The production shape: one tree holding 3 rows of "D&D 2024" and a single
    // playtest sheet. `MIN()` would file the whole line under the playtest.
    const big = addLine(db, { name: 'D&D 2024 core', gameSystem: 'D&D 2024' });
    addChild(db, { root: big, name: 'DMG 2024', gameSystem: 'D&D 2024' });
    addChild(db, { root: big, name: 'MM 2024', gameSystem: 'D&D 2024' });
    addChild(db, { root: big, name: 'Playtest sheet', gameSystem: 'D&D (playtest material)' });
    // A second line so the winning value is a grouping at all.
    const other = addLine(db, { name: 'D&D 2024 adventure', gameSystem: 'D&D 2024' });

    const families = await familiesForRoots(d1(db), [big, other]);
    assert.equal(families.get(big)?.name, 'D&D 2024');
    assert.equal(families.get(big)?.lines, 2);
  });

  it('`items` counts every row under the family, not just its lines', async () => {
    const db = migratedDb();
    const one = addLine(db, { name: 'Catan', series: 'Catan' });
    addChild(db, { root: one, name: 'Seafarers' });
    addChild(db, { root: one, name: 'Catan playmat', kind: 'accessory' });
    const two = addLine(db, { name: 'Starfarers', series: 'Catan' });

    // 2 roots + 2 children. Children carry no series of their own and still
    // count: the family is the lines' whole trees.
    assert.equal((await familiesForRoots(d1(db), [one, two])).get(one)?.items, 4);
  });

  it('⚠️ a name containing a colon survives the key — "D&D 5e (2014): Basic"', async () => {
    const db = migratedDb();
    const one = addLine(db, { name: 'Basic set', series: 'Legacy: Season 1' });
    const two = addLine(db, { name: 'Second box', series: 'Legacy: Season 1' });

    const family = (await familiesForRoots(d1(db), [one, two])).get(two)!;
    assert.equal(family.name, 'Legacy: Season 1');
    assert.equal(family.key, 'series:Legacy: Season 1');
  });

  it('only the roots asked about come back, but their counts are catalog-wide', async () => {
    const db = migratedDb();
    const asked = addLine(db, { name: 'Dice Throne S1', series: 'Dice Throne' });
    addLine(db, { name: 'Marvel Dice Throne', series: 'Dice Throne' });
    addLine(db, { name: 'Dice Throne Adventures', series: 'Dice Throne' });

    const families = await familiesForRoots(d1(db), [asked]);
    assert.equal(families.size, 1);
    // Three lines, though the page held one — the chip says how big the family
    // is, and the link it carries opens all three.
    assert.equal(families.get(asked)?.lines, 3);
  });

  it('no roots asked about is no read and an empty map', async () => {
    const db = migratedDb();
    addLine(db, { name: 'Dice Throne S1', series: 'Dice Throne' });
    addLine(db, { name: 'Marvel Dice Throne', series: 'Dice Throne' });

    // The `db` handed in would throw if it were used: nothing may be prepared.
    const families = await familiesForRoots(
      null as unknown as Parameters<typeof familiesForRoots>[0],
      [],
    );
    assert.equal(families.size, 0);
  });
});
