#!/usr/bin/env node
/**
 * The accessory-implies-the-game sweep — a REPORT, and only ever a report.
 *
 * `docs/TODO.md`, *What still wants a person*: **"Accessory implies the game —
 * a sweep worth doing"**. Proved on Here to Slay, where six accessories
 * (*Warriors & Druids* ×3, *Berserkers & Necromancers* ×3) sat in the
 * collection with no expansion row behind them, and both expansions turned out
 * to be real. They are now items 858 and 859. *Banner Quest* is the control
 * case — accessory and expansion both present.
 *
 * 🔴 **THIS SCRIPT WRITES NOTHING TO D1, AND CANNOT BE MADE TO.** Every query
 * it issues is checked against `assertReadOnly` before it is handed to
 * wrangler, and a `--commit` (or `--apply`, or `--write`) flag is REFUSED with
 * exit 2 rather than honoured. **Which rows to change is the owner's decision**,
 * and the whole point of the sweep is to put a table in front of him — not to
 * act on a name-matching heuristic that is wrong at the edges by construction.
 *
 * The rule it applies is documented in full in `lib/implied-product.mjs`; that
 * module is pure, and `test/implied-product.test.mjs` pins it against the Here
 * to Slay case and the Banner Quest control without touching the network.
 *
 * ## Usage
 *
 * ```
 * node scripts/accessory-implies-game.mjs                  # read D1, write the CSV
 * node scripts/accessory-implies-game.mjs --out=<path>     # somewhere else
 * node scripts/accessory-implies-game.mjs --top=25         # longer head table
 * node scripts/accessory-implies-game.mjs --save-source=<json>   # keep the raw pull
 * node scripts/accessory-implies-game.mjs --from=<json>    # re-analyse it, no D1
 * ```
 *
 * The CSV lands in `docs/archive/` dated, because it is a one-off data dump and
 * that is where `catalog-platform/docs/DOCS_STANDARD.md` files those. Re-running
 * on the same day overwrites that day's file rather than accumulating.
 *
 * ⚠️ **`--from` exists so a reading can be re-analysed without hitting D1
 * again** — the rule changes more often than the data does, and a live read per
 * iteration is both slow and pointless. Pass it a file written by
 * `--save-source`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sweep, PRESENT, MISSING, AMBIGUOUS } from './lib/implied-product.mjs';

const REPO_ROOT = process.cwd(); // invoked from the repo root, like every script here
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');
const ARCHIVE_DIR = path.join(REPO_ROOT, 'docs', 'archive');
const DB = 'board-game-catalog';

// ---------------------------------------------------------------------------
// 🔴 The refusal, first — before anything reads a flag it might act on.
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const WRITE_FLAGS = ['--commit', '--apply', '--write', '--fix', '--yes'];
const asked = argv.filter((a) => WRITE_FLAGS.includes(a.split('=')[0]));
if (asked.length > 0) {
  console.error(`🔴 REFUSED: ${asked.join(' ')}`);
  console.error('');
  console.error('This sweep is a REPORT and has no write mode — not a disabled one, none at all.');
  console.error('It proposes rows by matching NAMES, which is wrong at the edges by construction');
  console.error('(see the vocabulary note in scripts/lib/implied-product.mjs), and which rows to');
  console.error('change is the owner\'s decision. Read the CSV, then write the SQL by hand.');
  process.exit(2);
}

const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value ?? true;
};

const TODAY = new Date().toISOString().slice(0, 10);
const OUT = flag('out') || path.join(ARCHIVE_DIR, `accessory-implies-game-${TODAY}.csv`);
const TOP = Number(flag('top', 15));
const FROM = flag('from');
const SAVE_SOURCE = flag('save-source');

// ---------------------------------------------------------------------------
// D1, read-only — the pattern is rehost-covers.mjs's, and so is the reason.
// ---------------------------------------------------------------------------

/**
 * 🔴 A mechanical guard, per the estate's "mechanical guards beat written
 * advice" rule: this script's promise to write nothing is enforced here rather
 * than by everyone remembering. Anything that is not a single leading SELECT is
 * refused before wrangler sees it.
 */
export function assertReadOnly(sql) {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (!/^SELECT\b/i.test(flat)) {
    throw new Error(`refusing a non-SELECT query: ${flat.slice(0, 80)}`);
  }
  if (/;\s*\S/.test(flat)) {
    throw new Error('refusing a query with a second statement after a semicolon');
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|VACUUM)\b/i.test(flat)) {
    throw new Error(`refusing a query containing a write keyword: ${flat.slice(0, 80)}`);
  }
  return flat;
}

function wranglerBin() {
  // ⚠️ Resolve wrangler's own entry and run it with `node`, never `npx` and
  // never `{ shell: true }` — on Windows cmd.exe re-splits already-quoted
  // arguments (Node's DEP0190), which truncates a SQL string at its first
  // space. rehost-covers.mjs's header records the measurement.
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('wrangler/package.json', { paths: [REPO_ROOT] });
  const pkg = require(pkgPath);
  return path.join(path.dirname(pkgPath), pkg.bin.wrangler);
}

function d1Query(bin, sql) {
  const safe = assertReadOnly(sql);
  const out = execFileSync(
    process.execPath,
    [bin, 'd1', 'execute', DB, '--remote', '--json', '--command', safe],
    { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 },
  );
  // `--command` (unlike `--file`) is clean JSON on stdout — no preamble to strip.
  return JSON.parse(out)[0].results;
}

const ITEM_SQL = `
  SELECT i.id, i.kind, i.parent_item_id, i.root_game_id, i.name, i.series, i.bgg_id,
         (SELECT COUNT(*) FROM copy c WHERE c.item_id = i.id AND c.status IN ('owned','preordered','lent')) AS held,
         (SELECT COUNT(*) FROM copy c WHERE c.item_id = i.id AND c.status = 'wanted') AS wanted
    FROM item i
   ORDER BY i.id`;

const RELATION_SQL = 'SELECT from_item_id, to_item_id, relation FROM item_relation';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const COLUMNS = [
  'id', 'name', 'kind', 'series', 'bgg_id', 'held', 'wanted',
  'root_id', 'base_game', 'base_status', 'name_matches_base', 'base_note',
  'subject', 'subject_rows', 'implied_product', 'implied_status', 'matched_by',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(findings) {
  const lines = [COLUMNS.join(',')];
  for (const f of findings) lines.push(COLUMNS.map((c) => csvCell(f[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function main() {
  let items;
  let relations;

  if (FROM) {
    const saved = JSON.parse(readFileSync(FROM, 'utf8'));
    ({ items, relations } = saved);
    console.log(`read ${items.length} items / ${relations.length} relations from ${FROM} (NOT a live read)`);
  } else {
    const bin = wranglerBin();
    console.log(`reading ${DB} --remote, read-only …`);
    items = d1Query(bin, ITEM_SQL);
    relations = d1Query(bin, RELATION_SQL);
    console.log(`read ${items.length} items / ${relations.length} relations from production D1`);
  }

  const { findings, counts } = sweep({ items, relations });

  if (!existsSync(path.dirname(OUT))) mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, toCsv(findings), 'utf8');
  // ⚠️ The raw pull is NOT saved beside the CSV by default: it would be a
  // second copy of the same facts in `docs/archive/`, and the CSV is the one
  // that carries the answer. `--save-source=<path>` when you want to iterate on
  // the rule without re-reading D1.
  if (SAVE_SOURCE) {
    writeFileSync(SAVE_SOURCE, JSON.stringify({ items, relations }), 'utf8');
    console.log(`raw pull saved to ${SAVE_SOURCE} — re-analyse it with --from=<that path>`);
  }

  const named = findings.filter((f) => f.subject !== '');
  const missing = named.filter((f) => f.implied_status === MISSING);

  console.log(`\n=== the collection ===`);
  console.log(table(
    Object.entries(counts.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n]),
    ['kind', 'rows'],
  ));
  console.log(`\n${counts.rows} non-base rows swept.`);

  console.log(`\n=== question 1 — the implied BASE GAME (by root_game_id / parent_item_id) ===`);
  console.log(table(
    [[PRESENT, counts.base.PRESENT], [MISSING, counts.base.MISSING], [AMBIGUOUS, counts.base.AMBIGUOUS]],
    ['status', 'rows'],
  ));
  console.log(`\n${counts.nameDisagreesWithBase} of those rows share NO leading word with their base game's`);
  console.log('name (the `name_matches_base` column). That is normal for a themed line and is');
  console.log('also what a wrong parent link looks like — it is corroboration, not a status.');

  const baseAmbiguous = findings.filter((f) => f.base_status === AMBIGUOUS);
  if (baseAmbiguous.length > 0) {
    console.log(`\n--- the ${baseAmbiguous.length} rows that reach no base game ---`);
    console.log(table(
      baseAmbiguous.map((f) => [f.id, f.name.slice(0, 58), f.base_game.slice(0, 40), f.base_note.slice(0, 46)]),
      ['id', 'title', 'its root', 'why'],
    ));
  }

  console.log(`\n=== question 2 — the implied PRODUCT, read out of the row's own name ===`);
  console.log(table(
    [
      [PRESENT, named.filter((f) => f.implied_status === PRESENT).length],
      [MISSING, missing.length],
      [AMBIGUOUS, named.filter((f) => f.implied_status === AMBIGUOUS).length],
    ],
    ['status', 'rows'],
  ));
  console.log(`\n${named.length} of ${counts.rows} rows name a product beyond their base game;`);
  console.log(`the other ${counts.rows - named.length} are packaging only (\"Central Play Mat\") or are expansions,`);
  console.log('which are the product and so imply none.');

  // Grouped, because three sleeves for one missing expansion is ONE errand.
  const groups = new Map();
  for (const f of missing) {
    const key = `${f.root_id}::${f.subject}`;
    if (!groups.has(key)) groups.set(key, { base: f.base_game, subject: f.subject, rows: [] });
    groups.get(key).rows.push(f);
  }
  // Ties break on how many of the naming accessories are actually HELD: owning
  // the sleeve is the evidence that makes the missing product worth asking
  // about, and a wishlist row implying a product implies much less.
  const heldIn = (g) => g.rows.reduce((n, r) => n + (Number(r.held) > 0 ? 1 : 0), 0);
  const ranked = [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || heldIn(b) - heldIn(a) || a.base.localeCompare(b.base),
  );

  console.log(`\n=== the head of the report: ${ranked.length} distinct products implied but not in the collection ===`);
  console.log('⚠️ Sorted by how many accessories name the same subject. THAT is the confidence');
  console.log('   column: a subject on three different kinds of thing is a product name; a subject');
  console.log('   seen once is usually just a description the vocabulary failed to strip.\n');
  console.log(table(
    ranked.slice(0, TOP).map((g) => [
      g.rows.length,
      heldIn(g),
      `${g.base} — ${g.subject}`.slice(0, 58),
      g.rows.map((r) => r.name.replace(`${g.base}`, '').replace(/^[\s:–-]+/, '')).join(' · ').slice(0, 76),
    ]),
    ['acc', 'held', 'implied product (title — subject)', 'the accessories that name it'],
  ));

  console.log(`\nCSV: ${path.relative(REPO_ROOT, OUT).replace(/\\/g, '/')}  (${findings.length} rows)`);
  console.log('🔴 Nothing was written to D1. Which of these rows to change is the owner\'s call.');
}

main();
