/**
 * 🔴 The public projection's allow-list — the one sentence in
 * `src/index-projection.ts` that nothing enforced.
 *
 * That module's header (line 6) states the rule this file exists to make
 * mechanical:
 *
 *   > ⚠️ DEFAULT-DENY, BY EXPLICIT ALLOW-LIST — never `SELECT *` minus
 *   > exclusions. […] NEVER exported: prices, vendors, conditions, locations,
 *   > `lent_to`, completeness notes, per-person ratings, emails, acquisition
 *   > dates.
 *
 * Until this file, that was prose. The rows built here are pushed to the
 * SHARED, PUBLIC index Worker (`catalog-platform/apps/index-worker`), so the
 * failure mode is not a broken page — it is private household data on a public
 * surface, shipped by a one-word edit to the `SELECT` with every other test in
 * the repo green. The estate testing audit (2026-09-07 §4.1) ranked it the
 * highest-value single test in this repo, and named the two siblings that
 * already have one: `library_catalog`'s `index-projection-origin.test.ts` (the
 * shape copied here) and `audiobook_catalog`'s `test_index_push.py`.
 *
 * ⚠️ Both halves are pinned on purpose, because the leak has two doors:
 *   1. **The QUERY** — a column added to the `SELECT`, or a `JOIN` onto
 *      `copy` / `user_item` / `app_user`, which is exactly how `u.email`
 *      reached `/api/export.json` in the 2026-08 audit's finding 4
 *      (`apps/worker/src/lib/export-fields.test.ts` is that story).
 *   2. **The MAPPING** — a `...row` spread, which would carry whatever the
 *      query happened to return no matter how narrow the `SELECT` looked. The
 *      value-level test below feeds a deliberately over-wide source row so a
 *      spread cannot pass.
 *
 * ⚠️ This says nothing about D1 itself: the fake below records the SQL and
 * hands back rows. It pins the projection's contract, not the driver.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SITE_ORIGIN, buildIndexProjection, type IndexProjectionRow } from '../src/index-projection.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../migrations');

/**
 * 🔴 THE ALLOW-LIST. The complete list of `item` columns permitted to leave
 * this catalog, in the order the `SELECT` names them. Changing this array is
 * changing what the public index can see: it is a decision, not a refactor.
 */
const ALLOWED_COLUMNS = [
  'id',
  'kind',
  'parent_item_id',
  'name',
  'series',
  'year_published',
  'publisher',
  'thumbnail_url',
] as const;

/** The complete set of keys a pushed row may carry (the index's push contract). */
const PROJECTED_KEYS = [
  'source_id',
  'title',
  'series',
  'year',
  'publisher',
  'format',
  'kind',
  'parent_source_id',
  'cover_url',
  'detail_url',
] as const;

/**
 * The module header's own never-exported list, resolved to the real column
 * names that hold each thing. Kept as names rather than a category so the
 * assertion can be mechanical.
 */
const NEVER_EXPORTED = [
  'price_paid_cents', // prices
  'currency', //         prices
  'vendor', //           vendors
  'condition', //        conditions
  'location', //         locations
  'lent_to', //          lent_to
  'completeness_notes', // completeness notes
  'rating', //           per-person ratings (user_item)
  'email', //            emails (app_user)
  'acquired_on', //      acquisition dates
  'notes', //            free text on a copy, same class
] as const;

/** The tables those columns live in. A join is the other way they arrive. */
const NEVER_JOINED = ['copy', 'user_item', 'app_user'] as const;

/** A source row shaped as `SELECT *` would return it — private columns and all. */
const OVER_WIDE_ROW = {
  id: 7,
  kind: 'base',
  parent_item_id: null,
  name: 'A Game',
  series: null,
  year_published: 2019,
  publisher: 'A Publisher',
  thumbnail_url: 'https://covers.example/a.jpg',
  // Everything below must never reach a pushed row, by query or by spread.
  price_paid_cents: 4999,
  currency: 'USD',
  vendor: 'A Vendor',
  condition: 'like_new',
  location: 'Hall closet, shelf 3',
  lent_to: 'A Neighbour',
  completeness_notes: 'missing one meeple',
  // ⚠️ Deliberately 8.25 and not 9: the value scan below is a substring test,
  // and "9" is a substring of the allowed `year_published` 2019. A one-character
  // private value cannot be distinguished from a legitimate one.
  rating: 8.25,
  email: 'someone@example.com',
  acquired_on: '2019-04-01',
  notes: 'private',
};

/** Records every statement prepared, and answers with the row it is given. */
function captureDb(row: Record<string, unknown> = OVER_WIDE_ROW) {
  const prepared: string[] = [];
  const db = {
    prepare(sql: string) {
      prepared.push(sql);
      return {
        all: async () => ({ results: [row] }),
        first: async () => row,
        bind: () => ({ all: async () => ({ results: [row] }), first: async () => row }),
      };
    },
  };
  return { db: db as never, prepared };
}

/** The comma-separated names between `SELECT` and the first `FROM`. */
function selectedColumns(sql: string): string[] {
  const match = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(sql);
  assert.ok(match, `no SELECT … FROM found in:\n${sql}`);
  return (match[1] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function projectionSql(): Promise<string> {
  const { db, prepared } = captureDb();
  await buildIndexProjection(db);
  assert.equal(prepared.length, 1, 'the projection prepared more than one statement');
  return prepared[0] ?? '';
}

describe('the public projection is default-deny — the QUERY', () => {
  it('🔴 selects EXACTLY the allow-list, in order', async () => {
    // The whole finding in one assertion. A column added to the SELECT at
    // src/index-projection.ts:63 fails here and nowhere else.
    assert.deepEqual(selectedColumns(await projectionSql()), [...ALLOWED_COLUMNS]);
  });

  it('🔴 never `SELECT *`, and never a qualified `item.*`', async () => {
    for (const column of selectedColumns(await projectionSql())) {
      assert.ok(
        column !== '*' && !column.endsWith('.*'),
        `the projection selects \`${column}\` — the star form leaks the next column added`,
      );
    }
  });

  it('🔴 names no never-exported column, anywhere in the statement', async () => {
    const sql = await projectionSql();
    for (const column of NEVER_EXPORTED) {
      assert.ok(
        !new RegExp(`\\b${column}\\b`, 'i').test(sql),
        `the projection statement mentions \`${column}\` — the module header forbids it`,
      );
    }
  });

  it('🔴 reads `item` alone — no join reaches the private tables', async () => {
    const sql = await projectionSql();
    for (const table of NEVER_JOINED) {
      assert.ok(
        !new RegExp(`\\b(JOIN|FROM)\\s+${table}\\b`, 'i').test(sql),
        `the projection joins \`${table}\` — that table holds never-exported columns`,
      );
    }
  });
});

describe('the public projection is default-deny — the MAPPED ROW', () => {
  it('🔴 emits exactly the push contract’s keys, and no others', async () => {
    const { db } = captureDb();
    const [row] = await buildIndexProjection(db);
    assert.ok(row, 'the projection returned no rows');
    assert.deepEqual(Object.keys(row as IndexProjectionRow), [...PROJECTED_KEYS]);
  });

  it('🔴 an over-wide source row leaks nothing — a `...row` spread cannot pass', async () => {
    // The query could be perfect and a spread would still ship everything the
    // driver handed back. OVER_WIDE_ROW carries every private column; if any of
    // them survive into the pushed row, it is here that it shows.
    const { db } = captureDb();
    const rows = await buildIndexProjection(db);
    const serialised = JSON.stringify(rows);
    for (const column of NEVER_EXPORTED) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(rows[0] ?? {}, column),
        `the pushed row carries a \`${column}\` key`,
      );
      const value = OVER_WIDE_ROW[column as keyof typeof OVER_WIDE_ROW];
      // Short values cannot be told apart from legitimate ones by a substring
      // test (see the 8.25 note above); the key check covers them.
      if (value !== undefined && String(value).length >= 3) {
        assert.ok(
          !serialised.includes(String(value)),
          `the pushed row carries the ${column} VALUE (${String(value)})`,
        );
      }
    }
  });

  it('the allowed columns still arrive, mapped as the index expects', async () => {
    const { db } = captureDb();
    const [row] = await buildIndexProjection(db);
    assert.deepEqual(row, {
      source_id: '7',
      title: 'A Game',
      series: null,
      year: 2019,
      publisher: 'A Publisher',
      format: 'boardgame',
      kind: 'base',
      parent_source_id: null,
      cover_url: 'https://covers.example/a.jpg',
      detail_url: `${SITE_ORIGIN}/items/7`,
    });
  });

  it('ownership status deliberately does NOT travel', async () => {
    // Module header: the index points at /items/:id and THIS catalog answers
    // owned-versus-wanted. A `status` key here would be a design change.
    const { db } = captureDb();
    const [row] = await buildIndexProjection(db);
    for (const key of ['status', 'owned', 'copies']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(row ?? {}, key), `the pushed row carries \`${key}\``);
    }
  });
});

describe('the allow-list against the live schema — the drift guard', () => {
  it('🔴 every allowed column still exists on `item` in migrations/', () => {
    // A default-deny list has one silent failure mode: a migration renames or
    // drops a column and the projection starts pushing nulls (or throws in
    // production). Same trick export-fields.test.ts plays on user_item.
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let body: string | null = null;
    const added: string[] = [];
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const m of sql.matchAll(/CREATE TABLE (?:item|item_new)\s*\(([\s\S]*?)\n\);/g)) {
        body = m[1] ?? null;
        added.length = 0; // a rebuild supersedes every earlier ALTER
      }
      for (const m of sql.matchAll(/ALTER TABLE item\s+ADD COLUMN\s+(\w+)/gi)) {
        if (m[1]) added.push(m[1]);
      }
    }
    assert.ok(body, 'no CREATE TABLE item found in migrations/ — has the table been renamed?');

    // ⚠️ Strip `--` comments BEFORE splitting, not after. `parent_item_id`'s
    // comment reads "…may belong to an expansion, not just a base game." — a
    // top-level comma inside prose, which split that definition in half and made
    // the column look as though migrations/ had dropped it. Cost the first run
    // of this file; the same latent bug sits in export-fields.test.ts's copy of
    // this parser, which survives only because `user_item`'s comments carry no
    // commas. See docs/info/gotchas.md.
    const stripped = (body as string)
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');

    // Split on TOP-LEVEL commas: `kind`'s CHECK holds its own comma list.
    const defs: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of stripped) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        defs.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    defs.push(current);

    const columns = new Set(
      defs
        .map((def) =>
          def
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('--'))
            .join(' ')
            .trim(),
        )
        .filter(Boolean)
        .filter((def) => !/^(UNIQUE|PRIMARY KEY|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(def))
        .map((def) => def.split(/\s+/)[0])
        .filter((name): name is string => typeof name === 'string' && /^\w+$/.test(name))
        .concat(added),
    );

    for (const column of ALLOWED_COLUMNS) {
      assert.ok(columns.has(column), `the allow-list names \`item.${column}\`, which migrations/ no longer defines`);
    }
  });

  it('🔴 no never-exported column has been added to `item` and quietly allowed', () => {
    // The forbidden names live on `copy`/`user_item`/`app_user` today. If one
    // ever migrates onto `item`, the allow-list must still refuse it.
    for (const column of NEVER_EXPORTED) {
      assert.ok(
        !(ALLOWED_COLUMNS as readonly string[]).includes(column),
        `\`${column}\` is on the allow-list — the module header forbids exporting it`,
      );
    }
  });
});
