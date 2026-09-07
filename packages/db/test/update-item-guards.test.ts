/**
 * `updateItem` — the two guards `createItem` had and the edit path did not.
 *
 * Both are 2026-08 audit findings, and both have the same shape: a rule the
 * CREATE path states clearly, which the PATCH path never learned. An item can
 * be edited into a state it could never have been created in.
 *
 * - **Finding 7** — `bgg_id` is editable and `idx_item_bgg` is UNIQUE, so
 *   correcting a scan's wrong match to an id the catalog already holds hit the
 *   index and threw a raw `D1_ERROR: UNIQUE constraint failed`. The route maps
 *   only `ItemError`, so a person saw a 500 with a database string in it where
 *   `createItem` would have said *"X is already in the collection."*
 * - **Finding 8** — the base-with-a-parent contradiction was checked only when
 *   `parentItemId` was in the patch, so `PATCH {kind:'base'}` alone onto an
 *   item that still has a parent produced a base game filed under another
 *   tree: mis-rooted, and invisible to every listing that selects by root.
 *
 * ⚠️ **Real SQLite with every migration applied**, not a hand-written stub —
 * finding 7 is *about* a UNIQUE index, and a stub cannot have one. Same caveat
 * as the sibling files: this pins the SQL and the schema, and says nothing
 * about D1's binding order or `db.batch` semantics.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ItemError, createItem, getItem, updateItem } from '../src/items.js';

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
 * The four D1 methods these functions use, over `node:sqlite`.
 *
 * ⚠️ `run()` must report `last_row_id` — `createItem` reads it to return the
 * row it just wrote — and `changes`, which the update path checks.
 */
function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params = args;
        return stmt;
      },
      first(col?: string) {
        const row = db.prepare(sql).get(...(params as never[])) ?? null;
        if (row && col) return Promise.resolve((row as Record<string, unknown>)[col] ?? null);
        return Promise.resolve(row);
      },
      all() {
        return Promise.resolve({ results: db.prepare(sql).all(...(params as never[])) });
      },
      run() {
        const info = db.prepare(sql).run(...(params as never[]));
        return Promise.resolve({
          meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
        });
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

/** A base game, the minimum this schema will accept. */
async function addBase(db: D1Database, name: string, bggId?: number) {
  return createItem(db, { kind: 'base', name, bggId: bggId ?? null } as never);
}

// ---------------------------------------------------------------------------

describe('finding 7 — editing bgg_id onto a taken id is a 409, not a raw D1 error', () => {
  it('refuses the clash, and NAMES the game already holding that id', async () => {
    const raw = migratedDb();
    const db = d1(raw);
    const catan = await addBase(db, 'Catan', 13);
    const wrong = await addBase(db, 'Scanned Wrong', 999999);

    // ⚠️ `rejects` with the TYPE, not just any throw: the whole point is that
    // the route can recognise it. An unmapped error is what produced the 500.
    await assert.rejects(
      () => updateItem(db, wrong.id, { bggId: 13 } as never),
      (err: unknown) => {
        assert.ok(err instanceof ItemError, `expected ItemError, got ${String(err)}`);
        assert.equal(err.status, 409, 'the same status createItem answers a collision with');
        assert.match(err.message, /Catan/, 'names the game, so the person can go and look');
        assert.match(err.message, /already in the collection/);
        return true;
      },
    );

    // And nothing moved.
    assert.equal((await getItem(db, wrong.id))?.bggId, 999999);
    assert.equal((await getItem(db, catan.id))?.bggId, 13);
  });

  it('⚠️ re-sending an item OWN bgg_id is not a clash — every save-the-form screen does it', async () => {
    const db = d1(migratedDb());
    const catan = await addBase(db, 'Catan', 13);

    const updated = await updateItem(db, catan.id, { bggId: 13, name: 'Catan (2015)' } as never);

    assert.equal(updated?.name, 'Catan (2015)', 'the rest of the patch still applied');
    assert.equal(updated?.bggId, 13);
  });

  it('moving to a FREE id is allowed, and actually moves', async () => {
    const db = d1(migratedDb());
    const item = await addBase(db, 'Scanned Wrong', 999999);

    const updated = await updateItem(db, item.id, { bggId: 822 } as never);

    assert.equal(updated?.bggId, 822);
  });

  it('clearing bgg_id to null is allowed even while another row holds one', async () => {
    // `idx_item_bgg` is UNIQUE *where bgg_id IS NOT NULL*, so nulls never
    // collide — and the guard must not invent a collision the index would not
    // have had.
    const db = d1(migratedDb());
    await addBase(db, 'Catan', 13);
    const other = await addBase(db, 'Unmatched', 4242);

    const updated = await updateItem(db, other.id, { bggId: null } as never);

    assert.equal(updated?.bggId, null);
  });
});

describe('finding 8 — a base game cannot be edited INTO another tree', () => {
  /** A base game with an expansion filed under it. */
  async function baseWithExpansion(db: D1Database) {
    const base = await addBase(db, 'Root');
    const exp = await createItem(db, {
      kind: 'expansion',
      name: 'Root: The Riverfolk Expansion',
      parentItemId: base.id,
    } as never);
    return { base, exp };
  }

  it('🔴 PATCH {kind:"base"} ALONE is refused while the item still has a parent', async () => {
    // The finding itself. The guard used to sit inside `if (parentItemId !==
    // undefined)`, so a patch that mentioned only `kind` never reached it:
    // `newRoot` stayed null, `retargetSubtreeRoot` never ran, and the row
    // became a base game filed under another game's tree.
    const db = d1(migratedDb());
    const { exp } = await baseWithExpansion(db);

    await assert.rejects(
      () => updateItem(db, exp.id, { kind: 'base' } as never),
      (err: unknown) => {
        assert.ok(err instanceof ItemError, `expected ItemError, got ${String(err)}`);
        assert.equal(err.status, 400);
        // ⚠️ The words have to fit the case. The original message says "say
        // what it becomes in the same change", which is advice for the OTHER
        // direction and reads as nonsense to somebody who only changed `kind`.
        assert.match(err.message, /detach it in the same change/);
        return true;
      },
    );
  });

  it('and the refused patch changes NOTHING — the row keeps its kind and its parent', async () => {
    const db = d1(migratedDb());
    const { base, exp } = await baseWithExpansion(db);

    await updateItem(db, exp.id, { kind: 'base' } as never).catch(() => undefined);

    const after = await getItem(db, exp.id);
    assert.equal(after?.kind, 'expansion');
    assert.equal(after?.parentItemId, base.id);
    assert.equal(after?.rootGameId, base.id, 'and it is still rooted where it was');
  });

  it('the same change WITH the detach is allowed, and re-roots the item on itself', async () => {
    // The way through, and the sentence the refusal points at.
    const db = d1(migratedDb());
    const { exp } = await baseWithExpansion(db);

    const updated = await updateItem(db, exp.id, {
      kind: 'base',
      parentItemId: null,
    } as never);

    assert.equal(updated?.kind, 'base');
    assert.equal(updated?.parentItemId, null);
    assert.equal(updated?.rootGameId, exp.id, 'a base game roots itself, or it disappears');
  });

  it('setting a parent on something that is ALREADY base is still refused, with the original words', async () => {
    // The direction that always worked. Kept so the fix cannot quietly swap
    // which case gets which sentence.
    const db = d1(migratedDb());
    const a = await addBase(db, 'Wingspan');
    const b = await addBase(db, 'Everdell');

    await assert.rejects(
      () => updateItem(db, b.id, { parentItemId: a.id } as never),
      (err: unknown) => {
        assert.ok(err instanceof ItemError);
        assert.match(err.message, /say what it becomes/);
        return true;
      },
    );
  });

  it('a patch that touches neither kind nor parent is unaffected', async () => {
    const db = d1(migratedDb());
    const { exp } = await baseWithExpansion(db);

    const updated = await updateItem(db, exp.id, { yearPublished: 2018 } as never);

    assert.equal(updated?.yearPublished, 2018);
    assert.equal(updated?.kind, 'expansion');
  });
});
