/**
 * `listWishlist` must survive a wishlist longer than D1's bind ceiling.
 *
 * ## The incident
 *
 * 2026-11-04 11:2x Phoenix, deploy dbc60d49 — the one that put the pre-orders
 * on the wishlist as "On the way". The page went from 25 wanted rows to 148
 * rows, nearly all coverless, and `ancestorCoversFor` bound every one of their
 * ids into a single `IN (...)`: 148 ids + the depth. D1 refuses a statement
 * with more than 100 bound variables, so `GET /api/wishlist` answered
 * `D1_ERROR: too many SQL variables` and the whole page read "Could not load
 * the wishlist". The suite had passed 929/929 — it runs on `node:sqlite`,
 * whose ceiling is 999, so nothing in it could see the failure.
 *
 * ## What this test does about it
 *
 * The D1 shim below does what the real one does: **it refuses any statement
 * bound with more than 100 variables.** Then it builds a wishlist of 150
 * coverless rows and asks for the page. Proven to go red against the
 * un-chunked `ancestorCoversFor` (one statement, 151 binds) and green once it
 * reads in chunks of `ANCESTOR_IDS_PER_READ`.
 *
 * It also checks the chunking did not lose the lending: every row borrows its
 * game's cover, including the ones that fall in the second chunk.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ANCESTOR_IDS_PER_READ, listWishlist } from '../src/items.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../migrations');

/** What D1 allows per statement. The number the incident was measured against. */
const D1_MAX_VARIABLES = 100;

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
 * The D1 methods `listWishlist` uses, over `node:sqlite`, with D1's bind
 * ceiling enforced — the one thing `node:sqlite` is more generous about and
 * the whole reason this file exists. Records the largest bind it saw so the
 * test can say how close to the edge the code runs.
 */
function d1(db: DatabaseSync, seen: { maxBinds: number; statements: number }) {
  const all = (sql: string, params: unknown[]) => {
    seen.statements += 1;
    seen.maxBinds = Math.max(seen.maxBinds, params.length);
    if (params.length > D1_MAX_VARIABLES) {
      return Promise.reject(
        new Error(`D1_ERROR: too many SQL variables at offset ${sql.length}: SQLITE_ERROR`),
      );
    }
    const stmt = db.prepare(sql);
    return Promise.resolve({ results: stmt.all(...(params as never[])) });
  };
  return {
    prepare(sql: string) {
      return {
        all: () => all(sql, []),
        bind(...params: unknown[]) {
          return { all: () => all(sql, params) };
        },
      };
    },
  } as unknown as Parameters<typeof listWishlist>[0];
}

function addGame(db: DatabaseSync, name: string, cover: string): number {
  db.prepare(
    `INSERT INTO item (name, kind, parent_item_id, root_game_id, thumbnail_url)
     VALUES (?, 'base', NULL, NULL, ?)`,
  ).run(name, cover);
  const id = Number(db.prepare('SELECT id FROM item WHERE name = ?').get(name)!['id']);
  db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').run(id);
  return id;
}

/** A coverless row under a game, on the wishlist with the given status. */
function addWanted(db: DatabaseSync, root: number, name: string, status: string): number {
  db.prepare(
    `INSERT INTO item (name, kind, parent_item_id, root_game_id, thumbnail_url)
     VALUES (?, 'expansion', ?, ?, NULL)`,
  ).run(name, root, root);
  const id = Number(db.prepare('SELECT id FROM item WHERE name = ?').get(name)!['id']);
  db.prepare(`INSERT INTO copy (item_id, status) VALUES (?, ?)`).run(id, status);
  return id;
}

describe('listWishlist — a long wishlist stays under D1\'s 100-variable ceiling', () => {
  it('🔴 150 coverless rows (more than one chunk) load, and every one borrows its cover', async () => {
    const db = migratedDb();
    const game = addGame(db, 'Big Pledge', 'https://covers.example/big-pledge.jpg');
    const ROWS = 150;
    for (let n = 1; n <= ROWS; n += 1) {
      // Mixed, as the live page is: the pre-orders are what pushed it over.
      addWanted(db, game, `Stretch goal ${String(n).padStart(3, '0')}`, n % 3 === 0 ? 'wanted' : 'preordered');
    }

    const seen = { maxBinds: 0, statements: 0 };
    const entries = await listWishlist(d1(db, seen));

    assert.equal(entries.length, ROWS);
    assert.ok(
      seen.maxBinds <= D1_MAX_VARIABLES,
      `a statement bound ${seen.maxBinds} variables; D1 allows ${D1_MAX_VARIABLES}`,
    );
    // The main read plus two chunks of ancestors (99 + 51).
    assert.equal(seen.statements, 1 + Math.ceil(ROWS / ANCESTOR_IDS_PER_READ));

    const borrowed = entries.filter((e) => e.inheritedCover?.value === 'https://covers.example/big-pledge.jpg');
    assert.equal(borrowed.length, ROWS, 'rows in the second chunk must borrow a cover too');
    assert.equal(entries.filter((e) => e.status === 'preordered').length, ROWS - ROWS / 3);
  });

  it('the ceiling constant leaves exactly one hole for the depth bind', () => {
    assert.equal(ANCESTOR_IDS_PER_READ + 1, D1_MAX_VARIABLES);
  });

  it('two copies of one item are one chain, not two binds', async () => {
    const db = migratedDb();
    const game = addGame(db, 'Twice Wanted', 'https://covers.example/twice.jpg');
    const id = addWanted(db, game, 'Promo pack', 'wanted');
    db.prepare(`INSERT INTO copy (item_id, status) VALUES (?, 'preordered')`).run(id);

    const seen = { maxBinds: 0, statements: 0 };
    const entries = await listWishlist(d1(db, seen));

    assert.equal(entries.length, 2);
    // One id + the depth: the duplicate did not cost a second hole.
    assert.equal(seen.maxBinds, 2);
    assert.ok(entries.every((e) => e.inheritedCover?.value === 'https://covers.example/twice.jpg'));
  });
});
