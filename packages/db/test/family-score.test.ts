/**
 * The family roll-up — the QUERY half: *which rows are the family?*
 *
 * The arithmetic is pinned in `apps/worker/src/lib/family-score.test.ts`. This
 * file runs the actual SQL of `getFamilyMembers` against a real SQLite with
 * **every migration applied in order**, because the claim it has to settle is a
 * claim about a recursive CTE over two different notions of "belongs together",
 * and that is exactly the kind of claim that reads correct and behaves
 * otherwise:
 *
 *   1. **Containment** (`root_game_id`) — Catan's expansions and playmats.
 *   2. **`same_family` relations**, and TRANSITIVELY — link Starfarers to Catan
 *      and New Energies to Catan and all three are one family, with no row
 *      between the outer two. `getRelatedItems` already treats family that way;
 *      a score that did not would disagree with the list rendered beside it.
 *
 * ⚠️ **`root_game_id` is NULLABLE**, and a base game inserted without one is
 * ordinary in this catalog. Every comparison is on `COALESCE(root_game_id, id)`
 * and the "a null root is its own root" case has its own test, because getting
 * it wrong drops un-nested games out of their own family and the score still
 * looks like a number.
 *
 * ⚠️ **`PRAGMA foreign_keys` defaults to OFF in SQLite and ON in D1** — same
 * note as `copy-event-no-cascade.test.ts`, and the same one line to fix it.
 *
 * ⚠️ SQLite, not D1: this pins the SQL and the schema. It says nothing about
 * D1's binding order or `db.batch` semantics.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFamilyMembers, getFamilyScore } from '../src/family-score.js';

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
 * The two D1 methods `getFamilyMembers` uses, over `node:sqlite`.
 *
 * Deliberately tiny and deliberately NOT a general D1 emulator: it forwards one
 * `prepare(...).bind(...).all()` and nothing else, so it cannot quietly make a
 * query pass that D1 would reject for using something this does not implement.
 */
function d1(db: DatabaseSync): Parameters<typeof getFamilyMembers>[0] {
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
  } as unknown as Parameters<typeof getFamilyMembers>[0];
}

let seq = 0;

function addUser(db: DatabaseSync): number {
  const email = `p${++seq}@example.test`;
  // `member` — the role ladder (migration 0027) retired `rater`.
  db.prepare("INSERT INTO app_user (email, role) VALUES (?, 'member')").run(email);
  return Number(db.prepare('SELECT id FROM app_user WHERE email = ?').get(email)!['id']);
}

/**
 * One catalog row. `root` is passed EXPLICITLY — including `null` — because
 * nothing in the schema fills it in (the app does), and the null case is one of
 * the things under test.
 */
function addItem(
  db: DatabaseSync,
  opts: { name: string; kind: string; parent?: number | null; root?: number | null },
): number {
  db.prepare('INSERT INTO item (name, kind, parent_item_id, root_game_id) VALUES (?, ?, ?, ?)').run(
    opts.name,
    opts.kind,
    opts.parent ?? null,
    opts.root ?? null,
  );
  const id = Number(db.prepare('SELECT id FROM item WHERE name = ?').get(opts.name)!['id']);
  // A base game is its own root unless the caller said otherwise — the shape
  // `createItem` writes. `root: null` is honoured, not overwritten.
  if (opts.root === undefined && opts.parent == null && opts.kind === 'base') {
    db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').run(id);
  }
  return id;
}

function rate(db: DatabaseSync, itemId: number, userId: number, rating: number | null): void {
  db.prepare('INSERT INTO user_item (item_id, user_id, rating, notes) VALUES (?, ?, ?, ?)').run(
    itemId,
    userId,
    rating,
    rating === null ? 'played it, no strong opinion' : null,
  );
}

function relate(db: DatabaseSync, from: number, to: number, relation = 'same_family'): void {
  db.prepare('INSERT INTO item_relation (from_item_id, to_item_id, relation) VALUES (?, ?, ?)').run(
    from,
    to,
    relation,
  );
}

/** Member ids, sorted — what the traversal actually found. */
async function familyIds(db: DatabaseSync, itemId: number): Promise<number[]> {
  const members = await getFamilyMembers(d1(db), itemId);
  return members.map((m) => m.itemId).sort((a, b) => a - b);
}

describe('family membership — base only', () => {
  it('a lone base game is its own family of one, and scores its own rating', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    rate(db, catan, owner, 4.5);

    assert.deepEqual(await familyIds(db, catan), [catan]);
    const score = await getFamilyScore(d1(db), catan);
    assert.equal(score.score, 4.5);
    assert.equal(score.members, 1);
    assert.equal(score.hasBase, true);
  });

  it('⚠️ a base row with a NULL root_game_id is still its own root', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    // Explicitly null — the COALESCE is the only thing keeping this in a family.
    const game = addItem(db, { name: 'Go Fish', kind: 'base', root: null });
    const mat = addItem(db, { name: 'Go Fish mat', kind: 'accessory', parent: game, root: game });
    rate(db, game, owner, 3);
    rate(db, mat, owner, 1);

    assert.deepEqual(await familyIds(db, game), [game, mat]);
    // (3×6 + 1×1) / 7
    assert.equal((await getFamilyScore(d1(db), game)).score, 2.71);
  });

  it('an unrelated game is not in the family', async () => {
    const db = migratedDb();
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    addItem(db, { name: 'Wingspan', kind: 'base' });
    assert.deepEqual(await familyIds(db, catan), [catan]);
  });
});

describe('family membership — base + expansions (containment)', () => {
  it('the whole tree is the family, whichever row you open it from', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    const seafarers = addItem(db, {
      name: 'Seafarers',
      kind: 'expansion',
      parent: catan,
      root: catan,
    });
    const mat = addItem(db, { name: 'Catan mat', kind: 'accessory', parent: catan, root: catan });
    rate(db, catan, owner, 5);
    rate(db, seafarers, owner, 3);
    rate(db, mat, owner, 0.5);

    const expected = [catan, seafarers, mat].sort((a, b) => a - b);
    assert.deepEqual(await familyIds(db, catan), expected);
    // ⚠️ Asked from the NESTED row: an expansion's page must show the same
    // family number as its base game's page, or the two disagree in public.
    assert.deepEqual(await familyIds(db, seafarers), expected);

    const fromBase = await getFamilyScore(d1(db), catan);
    const fromExpansion = await getFamilyScore(d1(db), seafarers);
    assert.equal(fromBase.score, 4.06); // (5×6 + 3×2 + 0.5×1) / 9 = 36.5 / 9
    assert.deepEqual(fromExpansion, fromBase);
  });

  it('an item nobody rated is still a member — the denominator is honest', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    const seafarers = addItem(db, {
      name: 'Seafarers',
      kind: 'expansion',
      parent: catan,
      root: catan,
    });
    // Never rated at all: no user_item row (the LEFT JOIN miss).
    addItem(db, { name: 'Cities & Knights', kind: 'expansion', parent: catan, root: catan });
    // Rated with notes and no score: a user_item row with a NULL rating.
    const promo = addItem(db, { name: 'Helpers promo', kind: 'promo', parent: catan, root: catan });
    rate(db, catan, owner, 5);
    rate(db, seafarers, owner, 4);
    rate(db, promo, owner, null);

    const score = await getFamilyScore(d1(db), catan);
    assert.equal(score.members, 4);
    assert.equal(score.rated, 2, 'the unrated and the notes-only rows are members, not scores');
    assert.equal(score.score, 4.75); // (5×6 + 4×2) / 8 — the nulls contribute nothing
  });
});

describe('family membership — the same_family closure is TRANSITIVE', () => {
  /** Catan ← Starfarers, Catan ← New Energies. Three trees, one family. */
  function catanverse(db: DatabaseSync) {
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    const seafarers = addItem(db, {
      name: 'Seafarers',
      kind: 'expansion',
      parent: catan,
      root: catan,
    });
    const starfarers = addItem(db, { name: 'Starfarers', kind: 'base' });
    const energies = addItem(db, { name: 'New Energies', kind: 'base' });
    relate(db, catan, starfarers);
    relate(db, catan, energies);
    return { catan, seafarers, starfarers, energies };
  }

  it('⚠️ two games linked only through a third are still one family', async () => {
    const db = migratedDb();
    const { catan, seafarers, starfarers, energies } = catanverse(db);
    const whole = [catan, seafarers, starfarers, energies].sort((a, b) => a - b);

    // There is no row between Starfarers and New Energies. Both must still see
    // each other, and both must see Catan's nested expansion.
    assert.deepEqual(await familyIds(db, starfarers), whole);
    assert.deepEqual(await familyIds(db, energies), whole);
    assert.deepEqual(await familyIds(db, catan), whole);
  });

  it('a link attached to a NESTED row still joins the two whole trees', async () => {
    const db = migratedDb();
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    const seafarers = addItem(db, {
      name: 'Seafarers',
      kind: 'expansion',
      parent: catan,
      root: catan,
    });
    const starfarers = addItem(db, { name: 'Starfarers', kind: 'base' });
    const starmat = addItem(db, {
      name: 'Starfarers mat',
      kind: 'accessory',
      parent: starfarers,
      root: starfarers,
    });
    // The link hangs off the expansion, not the base game.
    relate(db, seafarers, starfarers);

    const whole = [catan, seafarers, starfarers, starmat].sort((a, b) => a - b);
    assert.deepEqual(await familyIds(db, catan), whole);
    assert.deepEqual(await familyIds(db, starmat), whole);
  });

  it('every member of a family gets the SAME number, from any of its pages', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    const { catan, seafarers, starfarers, energies } = catanverse(db);
    rate(db, catan, owner, 5);
    rate(db, seafarers, owner, 3);
    rate(db, starfarers, owner, 4);
    rate(db, energies, owner, 2);

    // (5×6 + 3×2 + 4×6 + 2×6) / (6 + 2 + 6 + 6) = 72 / 20
    const expected = 3.6;
    for (const id of [catan, seafarers, starfarers, energies]) {
      assert.equal((await getFamilyScore(d1(db), id)).score, expected, `from item ${id}`);
    }
  });

  it('⚠️ the OTHER relation kinds are not family and are not walked', async () => {
    const db = migratedDb();
    const phb = addItem(db, { name: "Player's Handbook", kind: 'base' });
    const auroboros = addItem(db, { name: 'Auroboros', kind: 'base' });
    const unmatched = addItem(db, { name: 'Unmatched: Robin Hood', kind: 'base' });
    const other = addItem(db, { name: 'Unmatched: Bigfoot', kind: 'base' });
    relate(db, auroboros, phb, 'requires');
    relate(db, unmatched, other, 'works_with');

    assert.deepEqual(await familyIds(db, phb), [phb], 'requires is a dependency, not a family');
    assert.deepEqual(await familyIds(db, unmatched), [unmatched], 'works_with is a pair, not a family');
  });
});

describe('family membership — a family with no base game', () => {
  it('an orphan expansion scores over its own tail and reports hasBase false', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    // The base game is not catalogued — the expansion is its own root.
    const expansion = addItem(db, { name: 'Some expansion', kind: 'expansion', root: null });
    const mat = addItem(db, {
      name: 'Its playmat',
      kind: 'accessory',
      parent: expansion,
      root: expansion,
    });
    rate(db, expansion, owner, 4);
    rate(db, mat, owner, 2);

    const score = await getFamilyScore(d1(db), expansion);
    assert.equal(score.hasBase, false);
    assert.equal(score.score, 3.33); // (4×2 + 2×1) / 3
    assert.equal(score.members, 2);
  });
});

describe('family membership — several raters', () => {
  it('two people rating one box average with each other, not against the family', async () => {
    const db = migratedDb();
    const owner = addUser(db);
    const her = addUser(db);
    const catan = addItem(db, { name: 'Catan', kind: 'base' });
    const seafarers = addItem(db, {
      name: 'Seafarers',
      kind: 'expansion',
      parent: catan,
      root: catan,
    });
    rate(db, catan, owner, 5);
    rate(db, catan, her, 4);
    rate(db, seafarers, owner, 3);

    const score = await getFamilyScore(d1(db), catan);
    // Catan is 4.5 (the mean of 5 and 4) once, not 5 and 4 twice:
    // (4.5×6 + 3×2) / 8
    assert.equal(score.score, 4.13);
    assert.equal(score.rated, 2, 'two rated ITEMS, three ratings');
  });
});
