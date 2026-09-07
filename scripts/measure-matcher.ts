/**
 * Measurement harness for `matchExistingTitle`'s containment floor.
 *
 * MEASUREMENT ONLY — this script changes nothing. It exists because the
 * similarity floor was once set to 0.34 "and did nothing" (docs/HANDOFF.md,
 * two-thresholds section), and the standing rule in docs/TODO.md is that the
 * matcher is not touched again without numbers. This produces the numbers.
 *
 * What it measures
 * ----------------
 * `matchIndexedTitle` (packages/core/src/vision.ts) answers "you already own
 * this" three ways: exact-after-normalise, exact alias, then substring
 * containment gated by a length ratio — `shorter/longer >= 0.6`. The exact and
 * alias passes have no threshold; **the 0.6 char-length ratio is the only
 * tunable knob**, and it is the one that filed `BOSS MONSTER` under
 * `Super Boss Monster 2` ("boss monster" = 12 chars, "super boss monster 2"
 * = 20 chars, 12/20 = 0.60 — exactly on the gate).
 *
 * Note the 0.34 / 0.7 floors in barcode.ts (`MIN_TITLE_SIMILARITY`,
 * `MIN_SPINE_SIMILARITY`) gate a DIFFERENT question — how well a free-database
 * lookup result matches the searched title. They never touch
 * `matchExistingTitle`. Measuring them against the catalog matcher is exactly
 * the mistake that made 0.34 "do nothing"; this harness sweeps the knob the
 * matcher actually has, and separately evaluates barcode.ts's word-level
 * machinery as a *candidate replacement* gate.
 *
 * Inputs
 * ------
 * The real production catalog, read-only:
 *
 *   npx wrangler d1 execute board-game-catalog --remote \
 *     --config apps/worker/wrangler.toml --json \
 *     --command "SELECT id, name, kind, parent_item_id, root_game_id FROM item ORDER BY id"
 *   ... and item_alias the same way.
 *
 * Run `npx tsx scripts/measure-matcher.ts` to query live (SELECT only), or
 * `--items <file> --aliases <file> --scans <file>` to reuse saved `--json`
 * pulls (the scans pull is the `scan_job` SELECT in `loadCatalog`). Real
 * production shelf reads (including job 13, the actual BOSS MONSTER scan) are
 * replayed descriptively at the end.
 *
 * Probe sets
 * ----------
 *  LOO   every real catalog name, matched against the catalog minus itself —
 *        simulates scanning a title whose own row is absent; any hit is a
 *        cross-match between two DIFFERENT products (split family/unrelated)
 *  POS   synthetic same-game reads built from each real name (caps, reprint
 *        suffixes, truncated last word, interior OCR noise) — a miss here is a
 *        false reject
 *  NEG   synthetic different-game reads built from each real name (unowned
 *        base-game prefix, sequel " 2", "Super " prefix, single trailing word)
 *        — a hit here is a false accept, the lost-game failure mode
 *
 * Gate designs swept
 * ------------------
 *  A  char-length ratio floor (production shape; 0.60 is today's value)
 *  B  word-overlap floor: containment + `titleSimilarity(key, target) >= f`
 *  C  containment + `isConfidentMatch` (barcode.ts fragment veto + 0.7) — one
 *     row, not a sweep, since its floor is fixed
 *
 * Every probe is also run through the real `matchIndexedTitle`, and the run
 * aborts if design A at 0.60 ever disagrees with it — the harness measures the
 * shipped algorithm or nothing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  buildTitleIndex,
  isConfidentMatch,
  matchIndexedTitle,
  normaliseTitle,
  titleSimilarity,
  type ItemAliasRef,
  type TitleIndex,
} from '@bgc/core';

interface Item {
  id: number;
  name: string;
  kind: string;
  parent_item_id: number | null;
  root_game_id: number | null;
}

// ---------------------------------------------------------------------------
// Load the catalog
// ---------------------------------------------------------------------------

function d1Json(sql: string): unknown {
  const out = execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'wrangler', 'd1', 'execute', 'board-game-catalog', '--remote',
      '--config', 'apps/worker/wrangler.toml', '--json', '--command', sql,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' },
  );
  return JSON.parse(out);
}

function firstResults(parsed: unknown): unknown[] {
  const arr = parsed as { results: unknown[] }[];
  if (!Array.isArray(arr) || !arr[0] || !Array.isArray(arr[0].results)) {
    throw new Error('unexpected wrangler --json shape');
  }
  return arr[0].results;
}

/**
 * ⚠️ `scans` is in this signature because the body returns it and `main`
 * destructures it. It was missing until 2026-09-06 — an ordinary type error,
 * which escaped only because `scripts/` is not a workspace, has no
 * `tsconfig.json`, and runs under `tsx`, which strips types rather than
 * checking them; the root `typecheck` is `--workspaces --if-present`, so
 * nothing in this directory has ever been type-checked. 2026-08 audit, finding
 * 22. Zero runtime impact — and the signature is the only description of this
 * function a reader gets, so a wrong one is worse than none.
 */
function loadCatalog(): {
  items: Item[];
  aliases: ItemAliasRef[];
  scans: { jobId: number; titles: string[] }[];
} {
  const argv = process.argv.slice(2);
  const arg = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };

  const itemsFile = arg('--items');
  const aliasFile = arg('--aliases');

  // PowerShell's `>` writes UTF-8 with a BOM, which JSON.parse rejects.
  const readJson = (file: string): unknown =>
    JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));

  const itemsRaw = itemsFile
    ? firstResults(readJson(itemsFile))
    : firstResults(
        d1Json('SELECT id, name, kind, parent_item_id, root_game_id FROM item ORDER BY id'),
      );
  const aliasRaw = aliasFile
    ? firstResults(readJson(aliasFile))
    : firstResults(d1Json('SELECT item_id, alias FROM item_alias ORDER BY item_id'));

  const scansFile = arg('--scans');
  const scansRaw = scansFile
    ? firstResults(readJson(scansFile))
    : firstResults(
        d1Json(
          "SELECT id, raw_titles FROM scan_job WHERE mode='shelf' AND raw_titles IS NOT NULL ORDER BY id",
        ),
      );

  const items = itemsRaw as Item[];
  const aliases = (aliasRaw as { item_id: number; alias: string }[]).map((r) => ({
    itemId: r.item_id,
    alias: r.alias,
  }));
  const scans = (scansRaw as { id: number; raw_titles: string }[]).map((r) => ({
    jobId: r.id,
    titles: (JSON.parse(r.raw_titles) as { text: string }[]).map((t) => t.text),
  }));
  return { items, aliases, scans };
}

// ---------------------------------------------------------------------------
// Parameterised re-statements of the production matcher
// ---------------------------------------------------------------------------

type Gate = (key: string, target: string) => boolean;

/**
 * `matchIndexedTitle` with the containment gate injected. With
 * `charRatioGate(0.6)` this must be — and is asserted to be — the production
 * algorithm. `excludeId` removes one item so a real name can be probed against
 * the catalog it does not belong to (leave-one-out).
 */
function matchWithGate(
  index: TitleIndex<Item>,
  title: string,
  gate: Gate,
  excludeId: number | null = null,
): Item | null {
  const target = normaliseTitle(title);
  if (target.length < 2) return null;

  const entries =
    excludeId === null ? index.entries : index.entries.filter((e) => e.item.id !== excludeId);

  const exact = entries.find((e) => e.key === target);
  if (exact) return exact.item;

  const aliased = index.aliasKeys.get(target);
  if (aliased && aliased.id !== excludeId) return aliased;

  return (
    entries
      .filter((e) => {
        if (e.key.length < 3) return false;
        const contains = e.key.includes(target) || target.includes(e.key);
        if (!contains) return false;
        return gate(e.key, target);
      })
      .sort((a, b) => b.key.length - a.key.length)[0]?.item ?? null
  );
}

const charRatioGate = (floor: number): Gate => (key, target) => {
  const shorter = Math.min(key.length, target.length);
  const longer = Math.max(key.length, target.length);
  return shorter / longer >= floor;
};

const wordSimGate = (floor: number): Gate => (key, target) =>
  titleSimilarity(key, target) >= floor;

const confidentGate: Gate = (key, target) => isConfidentMatch(key, target);

// ---------------------------------------------------------------------------
// Probe construction
// ---------------------------------------------------------------------------

interface Probe {
  text: string;
  /** The item this probe is a read of, when it is a read of one (POS). */
  sameAs: Item | null;
  cls: string;
}

function extractPrefix(name: string): string | null {
  const colonIdx = name.indexOf(':');
  if (colonIdx > 2) return name.slice(0, colonIdx).trim();
  const dashIdx = name.indexOf(' - ');
  if (dashIdx > 2) return name.slice(0, dashIdx).trim();
  const enDashIdx = name.indexOf(' – ');
  if (enDashIdx > 2) return name.slice(0, enDashIdx).trim();
  return null;
}

function buildProbes(items: Item[], aliases: ItemAliasRef[]) {
  // Every folded string that legitimately names something owned. A synthetic
  // probe whose fold lands on one of these cannot be scored honestly (its
  // ground truth is contested), so it is skipped rather than mislabelled.
  const ownedKeys = new Set<string>();
  for (const i of items) ownedKeys.add(normaliseTitle(i.name));
  for (const a of aliases) ownedKeys.add(normaliseTitle(a.alias));

  const pos: Probe[] = [];
  const neg: Probe[] = [];

  for (const item of items) {
    const name = item.name;
    const words = name.split(/\s+/).filter(Boolean);

    // POS: same game, said the way a spine or a noisy read says it.
    pos.push({ text: name.toUpperCase(), sameAs: item, cls: 'pos-caps' });
    pos.push({ text: `${name} 2nd Edition`, sameAs: item, cls: 'pos-reprint' });
    pos.push({ text: `${name}: Second Edition`, sameAs: item, cls: 'pos-reprint' });
    if (words.length >= 3) {
      const truncated = words.slice(0, -1).join(' ');
      if (!ownedKeys.has(normaliseTitle(truncated))) {
        pos.push({ text: truncated.toUpperCase(), sameAs: item, cls: 'pos-trunc' });
      }
    }
    const noisy = name.replace(/o/i, '0');
    if (noisy !== name && !ownedKeys.has(normaliseTitle(noisy))) {
      pos.push({ text: noisy.toUpperCase(), sameAs: item, cls: 'pos-ocr' });
    }

    // NEG: a different product wearing a related name.
    const prefix = extractPrefix(name);
    if (prefix && !ownedKeys.has(normaliseTitle(prefix))) {
      neg.push({ text: prefix.toUpperCase(), sameAs: null, cls: 'neg-base-prefix' });
    }
    if (!ownedKeys.has(normaliseTitle(`${name} 2`))) {
      neg.push({ text: `${name.toUpperCase()} 2`, sameAs: null, cls: 'neg-sequel' });
    }
    if (!ownedKeys.has(normaliseTitle(`Super ${name}`))) {
      neg.push({ text: `SUPER ${name.toUpperCase()}`, sameAs: null, cls: 'neg-super' });
    }
    if (words.length >= 2) {
      const last = words[words.length - 1]!;
      if (last.length >= 4 && !ownedKeys.has(normaliseTitle(last))) {
        neg.push({ text: last.toUpperCase(), sameAs: null, cls: 'neg-one-word' });
      }
    }
  }

  // De-duplicate probe texts within each set (many items share prefixes).
  const dedupe = (probes: Probe[]): Probe[] => {
    const seen = new Set<string>();
    return probes.filter((p) => {
      const k = `${p.cls} ${normaliseTitle(p.text)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return { pos: dedupe(pos), neg: dedupe(neg) };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`;
}

function main() {
  const { items, aliases, scans } = loadCatalog();
  const index = buildTitleIndex(items, aliases);
  const byId = new Map(items.map((i) => [i.id, i]));
  const root = (i: Item): number => i.root_game_id ?? i.id;

  console.log(`# Matcher threshold measurement — ${new Date().toISOString().slice(0, 10)}`);
  console.log();
  console.log(`Catalog: ${items.length} items, ${aliases.length} aliases (remote D1, read-only).`);

  // --- Parity: design A at 0.60 IS the production matcher, on every probe ---
  const { pos, neg } = buildProbes(items, aliases);
  const allTexts = [
    ...pos.map((p) => p.text),
    ...neg.map((p) => p.text),
    ...items.map((i) => i.name),
    'BOSS MONSTER',
  ];
  let parityChecked = 0;
  for (const text of allTexts) {
    const a = matchWithGate(index, text, charRatioGate(0.6));
    const b = matchIndexedTitle(index, text);
    if ((a?.id ?? null) !== (b?.id ?? null)) {
      throw new Error(`parity failure on "${text}": harness=${a?.id} production=${b?.id}`);
    }
    parityChecked += 1;
  }
  console.log(`Parity: harness gate @0.60 ≡ production \`matchIndexedTitle\` on all ${parityChecked} probes.`);
  console.log(`Probes: ${pos.length} synthetic same-game (POS), ${neg.length} synthetic different-game (NEG), ${items.length} leave-one-out (LOO).`);
  console.log();

  // --- The sweep ---
  const floors = [
    0.34, 0.40, 0.45, 0.50, 0.55, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70,
    0.72, 0.75, 0.80, 0.85, 0.90, 0.95,
  ];

  interface Row {
    label: string;
    gate: Gate;
    faNeg: number;       // NEG probes matched (false accepts)
    frPos: number;       // POS probes missed (false rejects)
    frPosNontrivial: number; // POS misses excluding pos-ocr (which no floor can save)
    looCross: number;    // LOO probes matched to a different item
    looFamily: number;   //   ... of which same root_game_id family
    examplesFA: string[];
  }

  const posNontrivial = pos.filter((p) => p.cls !== 'pos-ocr');

  const measure = (label: string, gate: Gate): Row => {
    const row: Row = {
      label, gate, faNeg: 0, frPos: 0, frPosNontrivial: 0, looCross: 0, looFamily: 0,
      examplesFA: [],
    };
    for (const p of neg) {
      const m = matchWithGate(index, p.text, gate);
      if (m) {
        row.faNeg += 1;
        if (row.examplesFA.length < 8) row.examplesFA.push(`"${p.text}" → "${m.name}" [${p.cls}]`);
      }
    }
    for (const p of pos) {
      const m = matchWithGate(index, p.text, gate);
      const hit = m !== null && p.sameAs !== null && m.id === p.sameAs.id;
      if (!hit) {
        row.frPos += 1;
        if (p.cls !== 'pos-ocr') row.frPosNontrivial += 1;
      }
    }
    for (const item of items) {
      const m = matchWithGate(index, item.name, gate, item.id);
      if (m && m.id !== item.id) {
        row.looCross += 1;
        const other = byId.get(m.id);
        if (other && root(other) === root(item)) row.looFamily += 1;
      }
    }
    return row;
  };

  console.log('## Design A — char-length ratio floor (production shape; 0.60 today)');
  console.log();
  console.log('| floor | NEG false-accepts | POS false-rejects | POS FR excl. OCR | LOO cross-matches | LOO same-family |');
  console.log('|---|---|---|---|---|---|');
  const rowsA: Row[] = [];
  for (const f of floors) {
    const r = measure(`A@${f.toFixed(2)}`, charRatioGate(f));
    rowsA.push(r);
    console.log(
      `| ${f.toFixed(2)} | ${r.faNeg} (${pct(r.faNeg, neg.length)}) | ${r.frPos} (${pct(r.frPos, pos.length)}) | ${r.frPosNontrivial} (${pct(r.frPosNontrivial, posNontrivial.length)}) | ${r.looCross} | ${r.looFamily} |`,
    );
  }
  console.log();

  console.log('## Design B — word-overlap floor (`titleSimilarity`) on containment candidates');
  console.log();
  console.log('| floor | NEG false-accepts | POS false-rejects | POS FR excl. OCR | LOO cross-matches | LOO same-family |');
  console.log('|---|---|---|---|---|---|');
  for (const f of floors) {
    const r = measure(`B@${f.toFixed(2)}`, wordSimGate(f));
    console.log(
      `| ${f.toFixed(2)} | ${r.faNeg} (${pct(r.faNeg, neg.length)}) | ${r.frPos} (${pct(r.frPos, pos.length)}) | ${r.frPosNontrivial} (${pct(r.frPosNontrivial, posNontrivial.length)}) | ${r.looCross} | ${r.looFamily} |`,
    );
  }
  console.log();

  console.log('## Design C — containment + `isConfidentMatch` (fragment veto + 0.7 word floor)');
  console.log();
  const rc = measure('C', confidentGate);
  console.log(
    `NEG false-accepts: ${rc.faNeg} (${pct(rc.faNeg, neg.length)}) · POS false-rejects: ${rc.frPos} (${pct(rc.frPos, pos.length)}) · POS FR excl. OCR: ${rc.frPosNontrivial} (${pct(rc.frPosNontrivial, posNontrivial.length)}) · LOO cross: ${rc.looCross} (family ${rc.looFamily})`,
  );
  console.log();

  // --- Per-class detail at the interesting floors ---
  const detailFloors = [0.60, 0.65, 0.70];
  console.log('## Per-class detail (design A)');
  console.log();
  const classes = [...new Set([...pos, ...neg].map((p) => p.cls))].sort();
  console.log(`| class | probes | ${detailFloors.map((f) => `matched @${f.toFixed(2)}`).join(' | ')} |`);
  console.log(`|---|---|${detailFloors.map(() => '---').join('|')}|`);
  for (const cls of classes) {
    const set = [...pos, ...neg].filter((p) => p.cls === cls);
    const counts = detailFloors.map(
      (f) => set.filter((p) => matchWithGate(index, p.text, charRatioGate(f)) !== null).length,
    );
    console.log(`| ${cls} | ${set.length} | ${counts.join(' | ')} |`);
  }
  console.log();

  // --- What actually flips between 0.60 and 0.70 ---
  console.log('## Probes whose outcome differs between floors 0.60 and 0.70 (design A)');
  console.log();
  for (const p of [...pos, ...neg]) {
    const at60 = matchWithGate(index, p.text, charRatioGate(0.6));
    const at70 = matchWithGate(index, p.text, charRatioGate(0.7));
    if ((at60?.id ?? null) !== (at70?.id ?? null)) {
      const verdict = p.sameAs
        ? at60 && at60.id === p.sameAs.id && !at70
          ? 'LOSES a genuine match'
          : 'changes'
        : at60 && !at70
          ? 'kills a false accept'
          : 'changes';
      console.log(
        `- [${p.cls}] "${p.text}": 0.60 → ${at60 ? `"${at60.name}"` : 'null'} · 0.70 → ${at70 ? `"${at70.name}"` : 'null'} — ${verdict}`,
      );
    }
  }
  console.log();

  // --- LOO cross-matches at the current floor, named ---
  console.log('## Leave-one-out cross-matches at today\'s floor 0.60 (design A)');
  console.log();
  for (const item of items) {
    const m = matchWithGate(index, item.name, charRatioGate(0.6), item.id);
    if (m && m.id !== item.id) {
      const fam = root(m) === root(item) ? 'same family' : 'UNRELATED';
      console.log(`- "${item.name}" (${item.kind}) → "${m.name}" (${m.kind}) — ${fam}`);
    }
  }
  console.log();

  // --- Real production shelf reads, descriptively (no ground-truth labels) ---
  console.log('## Real shelf scans (production `scan_job.raw_titles`) — 0.60 vs 0.68');
  console.log();
  console.log(
    'No ground-truth labels exist for these, so this is descriptive: every real',
  );
  console.log('vision read whose outcome the floor change would alter.');
  console.log();
  let scanTitles = 0;
  let scanMatched60 = 0;
  let scanExact = 0;
  const survivors: string[] = [];
  for (const scan of scans) {
    for (const text of scan.titles) {
      scanTitles += 1;
      const target = normaliseTitle(text);
      const isExact =
        index.entries.some((e) => e.key === target) || index.aliasKeys.has(target);
      if (isExact) scanExact += 1;
      const at60 = matchWithGate(index, text, charRatioGate(0.6));
      if (at60) scanMatched60 += 1;
      const at68 = matchWithGate(index, text, charRatioGate(0.68));
      if ((at60?.id ?? null) !== (at68?.id ?? null)) {
        console.log(
          `- job ${scan.jobId}: "${text}": 0.60 → ${at60 ? `"${at60.name}"` : 'null'} · 0.68 → ${at68 ? `"${at68.name}"` : 'null'}`,
        );
      } else if (at68 && !isExact) {
        survivors.push(`- job ${scan.jobId}: "${text}" → "${at68.name}"`);
      }
    }
  }
  console.log();
  console.log(
    `Across ${scans.length} real shelf scans: ${scanTitles} vision reads, ${scanMatched60} matched at 0.60 (${scanExact} of them exact/alias — untouched by any floor).`,
  );
  console.log();
  console.log('Containment matches on real reads that survive at 0.68:');
  console.log();
  for (const s of survivors) console.log(s);
  console.log();

  // --- The named incident ---
  console.log('## BOSS MONSTER reproduction');
  console.log();
  const bmFloors = [0.34, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70];
  for (const f of bmFloors) {
    const m = matchWithGate(index, 'BOSS MONSTER', charRatioGate(f));
    console.log(`- floor ${f.toFixed(2)}: BOSS MONSTER → ${m ? `"${m.name}" (id ${m.id})` : 'no match'}`);
  }
  const mProd = matchIndexedTitle(index, 'BOSS MONSTER');
  console.log(`- production \`matchIndexedTitle\`: → ${mProd ? `"${mProd.name}" (id ${mProd.id})` : 'no match'}`);
  const mB = matchWithGate(index, 'BOSS MONSTER', wordSimGate(0.7));
  console.log(`- design B @0.70: → ${mB ? `"${mB.name}"` : 'no match'} (titleSimilarity("super boss monster 2", "boss monster") = ${titleSimilarity('super boss monster 2', 'boss monster').toFixed(2)})`);
  const mC = matchWithGate(index, 'BOSS MONSTER', confidentGate);
  console.log(`- design C: → ${mC ? `"${mC.name}"` : 'no match'}`);
}

main();
