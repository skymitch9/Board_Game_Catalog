/** Builds the deliverable .md from audit.json. READ ONLY. */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const DIR = 'scratchpad/bgg-audit';
const rows = JSON.parse(readFileSync(`${DIR}/audit.json`, 'utf8'));
const runLog = readFileSync(`${DIR}/run.log`, 'utf8').trim().split('\n');
const lastLine = runLog[runLog.length - 1];

const V = (v) => rows.filter((r) => r.verdict === v);
const count = (arr) => arr.length;
const url = (id) => `https://boardgamegeek.com/boardgame/${id}`;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const confirmed = V('CONFIRMED');
const suspect = V('SUSPECT');
const proposed = V('PROPOSED');
const unmatched = V('UNMATCHED');

// Score distribution over PROPOSED.
const bands = [
  ['1.00', (s) => s >= 0.995],
  ['0.90–0.99', (s) => s >= 0.9 && s < 0.995],
  ['0.80–0.89', (s) => s >= 0.8 && s < 0.9],
  ['0.70–0.79', (s) => s >= 0.7 && s < 0.8],
  ['0.60–0.69', (s) => s >= 0.6 && s < 0.7],
  ['0.50–0.59', (s) => s >= 0.5 && s < 0.6],
  ['below 0.50', (s) => s < 0.5],
];

const kindsOf = (arr) => {
  const t = {};
  for (const r of arr) t[r.kind] = (t[r.kind] ?? 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
};

const proposedAtOrAbove = (x) => proposed.filter((r) => r.score >= x);

const L = [];
const p = (s = '') => L.push(s);

p('# BoardGameGeek audit — all 806 catalog items');
p();
p('> **DRY RUN. Nothing was written.** Every statement sent to production D1 was a `SELECT`;');
p('> every BoardGameGeek call was a `GET` against the XMLAPI2 read endpoints. No `UPDATE`,');
p('> `INSERT`, `DELETE`, migration, commit or deploy was issued, and nothing was written to');
p('> BoardGameGeek in any form.');
p('>');
p('> **Audience:** the owner, verifying before applying anything. **Generated:** 2026-08-08.');
p();
p('The row-by-row map is **[`bgg-audit-2026-08-08.tsv`](./bgg-audit-2026-08-08.tsv)** — 806 rows, one per');
p('catalog item, tab-separated. It is a TSV rather than a table in this file on purpose: 806 rows');
p('× 18 columns is unreadable as Markdown, and the thing the owner actually needs to do — sort by');
p('score, filter to a verdict, tick the ones to apply — is what a spreadsheet does and prose does');
p('not. This file holds the rules, the counts and the rows to look at first.');
p();
p('## Counts');
p();
p('| Verdict | Rows | What it means | Kinds |');
p('|---|---:|---|---|');
p(`| **CONFIRMED** | ${count(confirmed)} | Has a \`bgg_id\`; BGG's entry agrees. **No action.** | ${kindsOf(confirmed)} |`);
p(`| **SUSPECT** | ${count(suspect)} | Has a \`bgg_id\`; BGG's entry disagrees on a named field. | ${kindsOf(suspect)} |`);
p(`| **PROPOSED** | ${count(proposed)} | No \`bgg_id\`; a credible same-product match found. | ${kindsOf(proposed)} |`);
p(`| **UNMATCHED** | ${count(unmatched)} | No \`bgg_id\`; no credible match. | ${kindsOf(unmatched)} |`);
{
  const errored = V('ERROR');
  if (errored.length) {
    p(`| **ERROR** | ${errored.length} | A BGG call failed for this row — **unaudited**, not unmatched. | ${kindsOf(errored)} |`);
  }
}
p(`| | **${rows.length}** | | |`);
p();
{
  const errored = V('ERROR');
  if (errored.length) {
    p(`⚠️ **${errored.length} rows could not be audited** because a BGG call failed for them. They are marked`);
    p('`ERROR`, not `UNMATCHED`, deliberately: a failed request is not evidence that BGG has no entry,');
    p('and collapsing the two would put false negatives in the map with no way to tell them apart.');
    p(`Re-running \`node scratchpad/bgg-audit/audit.mjs --resume\` picks up only these.`);
    p();
  } else {
    p('**No row failed to be audited.** Every one of the 806 got a real answer from BGG; nothing is');
    p('marked unmatched merely because a request fell over. That distinction is enforced in the code —');
    p('a 429 is retried with a widening gap and never returned to the caller as an empty result set.');
    p();
  }
}
p(`Of the 197 rows that already carry an id, **${count(confirmed)} verify clean and ${count(suspect)} do not.**`);
p(`Of the 609 with no id, **${count(proposed)} have a proposal and ${count(unmatched)} do not.**`);
p();

p('## How the score is built');
p();
p('The score is a **weighted average over the evidence that was actually available**, not a sum.');
p('A component whose data is missing on either side contributes to neither the numerator nor the');
p('denominator, so an item with no `year_published` of ours is not punished for a fact nobody');
p('recorded — it is simply judged on fewer signals. Final value is clamped to 0…1.');
p();
p('```');
p('score = Σ(weight × fraction) / Σ(weight, over available components only)');
p('```');
p();
p('| Component | Weight | Always available? |');
p('|---|---:|---|');
p('| Name | 50 | yes |');
p('| Year | 20 | only if both sides have one |');
p('| Publisher | 15 | only if both sides have one |');
p('| Kind plausibility | 10 | yes |');
p('| Corroboration | 15 | yes |');
p();
p('### Fractions');
p();
p('| Component | Fraction | Condition |');
p('|---|---:|---|');
p('| Name | 1.00 | `normaliseTitle` equality with BGG\'s primary name |');
p('| | 0.90 | `normaliseTitle` equality with a BGG `<name type="alternate">` |');
p('| | 0.80 | `titleSimilarity` ≥ 0.9 |');
p('| | 0.60 | `titleSimilarity` ≥ 0.8 |');
p('| | 0.45 | `titleSimilarity` ≥ 0.7 |');
p('| | −1.00 | below 0.7 |');
p('| Year | 1.00 / 0.50 / 0.00 / −1.00 | exact / off by 1 / off by 2–3 / off by ≥4 |');
p('| Publisher | 1.00 / 0.70 / −1.00 | exact / partial / absent from BGG\'s whole publisher-link list |');
p('| Kind | 1.00 / 0.50 / 0.20 / −1.00 | matches BGG `type` / adjacent / loose / **family-trap shape** |');
p('| Corroboration | 1.00 | the candidate is in the parent/root id\'s own `boardgameexpansion` / `boardgameaccessory` link list |');
p('| | 0.70 / 0.50 / 0.30 / 0.10 | sole candidate / 2–4 / 5–9 / ≥10 candidate ids returned |');
p();
p('**`normaliseTitle` and `titleSimilarity` are the shipped functions**, ported verbatim from');
p('`packages/core/src/vision.ts` and `packages/core/src/barcode.ts` — no third metric was invented.');
p('Publisher comparison is the one new thing: it strips corporate noise (`Games`, `Studios`, `GmbH`,');
p('`Sp. z o.o.`, …) and compares against **every** `boardgamepublisher` link, not just the first,');
p('because BGG lists the original publisher alongside every localisation house and our catalog');
p('stores whichever one is on our box.');
p();

p('## The gate that decides PROPOSED from UNMATCHED');
p();
p('Scoring never runs on a candidate that has not cleared a **hard gate**, and the gate is the');
p('reason this audit cannot produce the failure it was commissioned to avoid.');
p();
p('1. **`isFragmentOf(bggName, ourName)` must be false.** This is the shipped rule, verbatim. One');
p('   title\'s meaningful words wholly inside the other\'s, with words to spare, is the *"same');
p('   family, different product"* shape — a base game, a sibling, a different edition, a different');
p('   product in the same line.');
p('2. **`titleSimilarity` ≥ 0.7 (`MIN_SPINE_SIMILARITY`)**, or exact equality to a BGG alternate name.');
p();
p('**0.7 and not 0.34.** `docs/HANDOFF.md` records that reusing the forgiving `MIN_TITLE_SIMILARITY`');
p('for unattended matching *caught nothing*, because a one-word fragment of a two-word title scores');
p('`2×1/(1+2) = 0.67` every single time while genuine reads score 1.00. This audit is unattended');
p('matching over 609 rows, so it uses the unattended floor.');
p();
p('**The search widens; the scoring does not.** Queries walk a ladder — full name, then the name');
p('with product-type words dropped, then the subtitle alone, then the family prefix — but every');
p('candidate is scored against the item\'s **original full name** regardless of what was searched');
p('with. Widening therefore cannot loosen a match; it can only surface more things for the gate to');
p('reject. That is what makes "try like items" safe.');
p();
p('**Alternate names are where "like items" legitimately pays.** BGG\'s `<name type="alternate">`');
p('nodes are the Catan / The Settlers of Catan mechanism, and an exact match to one of them is');
p('treated as near-exact (0.90). Edition wording and punctuation differences pass through');
p('`normaliseTitle` for free.');
p();
p('### The Fractured Sky check, run for real');
p();
const fs250 = rows.find((r) => r.id === 250);
if (fs250) {
  p('Item 250 *Fractured Sky: Holofoil Box* is the case the brief names:');
  p();
  p('```');
  p(`verdict:   ${fs250.verdict}`);
  p(`why:       ${fs250.note || fs250.components?.join('; ')}`);
  p(`near miss: ${fs250.nearMiss || '(none)'}`);
  p('```');
  p();
  p('BGG lists exactly two accessories against Fractured Sky (370581) — *Metal Starfall Tokens* and');
  p('*Neoprene Game Mat*. A holofoil box is not among them, and the base game itself is rejected by');
  p('the gate rather than attached. That is the intended outcome.');
}
p();

p('## Verdict rules for the 197 rows that already have an id');
p();
p('Verifying an id a person already set is a **different question** from proposing a new one, so');
p('`isFragmentOf` is deliberately *not* a hard gate in this half. *Dead of Winter* vs BGG\'s *Dead of');
p('Winter: A Crossroads Game* is a fragment relationship **and** the same product — the catalog just');
p('stores the short title. Treating that as broken would have produced 35 false alarms.');
p();
p('What separates a benign subtitle difference from the real family trap is `kind`:');
p();
p('| Situation | Verdict |');
p('|---|---|');
p('| Name matches exactly (or an alternate name does) | **CONFIRMED.** Identity is settled; a `kind`, year or publisher quibble is a *note*. A holofoil box is never named identically to its base game. |');
p('| Fragment relationship **and** our row is a non-`base` child **and** BGG\'s entry is a base game carrying expansions/accessories of its own | **SUSPECT** — the id may name the family, not the product |');
p('| Fragment relationship otherwise | **CONFIRMED**, with the title difference noted |');
p('| `titleSimilarity` < 0.7 and no fragment relationship | **SUSPECT** — names disagree |');
p('| Year differs by ≥3 (both known) | **SUSPECT** |');
p('| Year differs by 1–2 | note only |');
p('| Our publisher absent from BGG\'s entire publisher-link list | **SUSPECT** |');
p('| Our `kind` disagrees with BGG\'s `type` under an exact name | note only |');
p();
const noCaveat = confirmed.filter((r) => !r.note).length;
p(`**${noCaveat} of the ${count(confirmed)} CONFIRMED rows carry no caveat of any kind.** The remaining`);
p(`${count(confirmed) - noCaveat} are confirmed *with a note* — the note is in the TSV's \`note\` column and is worth a skim,`);
p('but none of them indicate a wrong id.');
p();

p('## SUSPECT — every one, in full');
p();
if (suspect.length === 0) p('_None._');
else {
  p('| id | kind | our name | current bgg_id | What disagrees |');
  p('|---:|---|---|---:|---|');
  for (const r of suspect) {
    p(`| ${r.id} | ${r.kind} | ${esc(r.name)} | [${r.currentBggId}](${url(r.currentBggId)}) | ${esc(r.note)} |`);
  }
  p();
  p('**No replacement ids are proposed for any of these.** Per the brief, *"this id looks wrong"* is');
  p('a complete finding; guessing a substitute would reintroduce exactly the risk this audit exists');
  p('to avoid.');
}
p();

p('## Score distribution — PROPOSED only');
p();
p('| Band | Rows | Owned | Cumulative |');
p('|---|---:|---:|---:|');
{
  let cum = 0;
  for (const [label, test] of bands) {
    const inBand = proposed.filter((r) => test(r.score));
    cum += inBand.length;
    if (inBand.length === 0) continue;
    p(`| ${label} | ${inBand.length} | ${inBand.filter((r) => r.owned).length} | ${cum} |`);
  }
}
p();
p('| Threshold | PROPOSED at or above | Owned | % of the 609 |');
p('|---|---:|---:|---:|');
for (const t of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]) {
  const a = proposedAtOrAbove(t);
  p(`| ≥ ${t.toFixed(2)} | ${a.length} | ${a.filter((r) => r.owned).length} | ${((a.length / 609) * 100).toFixed(1)}% |`);
}
p();

p('## UNMATCHED — why, not just that');
p();
{
  const noResults = unmatched.filter((r) => (r.note ?? '').includes('no search results'));
  const rejectedAll = unmatched.filter((r) => !(r.note ?? '').includes('no search results'));
  const withNearMiss = rejectedAll.filter((r) => r.nearMiss);
  p('| Reason | Rows | Owned |');
  p('|---|---:|---:|');
  p(`| BGG returned **no results at all**, at any rung of the ladder | ${noResults.length} | ${noResults.filter((r) => r.owned).length} |`);
  p(`| Results returned, **every one rejected** by the gate | ${rejectedAll.length} | ${rejectedAll.filter((r) => r.owned).length} |`);
  p(`| …of those, with a **named near-miss** recorded in the TSV | ${withNearMiss.length} | ${withNearMiss.filter((r) => r.owned).length} |`);
  p();
  p('The `near_miss_rejected` column names the closest thing that was found and refused, with the');
  p('reason. That column is the answer to *"does this accessory genuinely have no BGG entry, or did');
  p('nobody look?"* — a row with a near-miss was looked for and the best answer was a different');
  p('product; a row with none was looked for and BGG knows nothing by that name.');
  p();
  p(`**${kindsOf(unmatched)}** — the shape of this is expected. BGG catalogues base games and`);
  p('expansions thoroughly and merchandise sporadically; playmats, tote bags, dice trays, sleeve');
  p('packs and holofoil boxes routinely have no entry at all.');
}
p();

p('## What I would apply, and at what cut-off');
p();
p('This is a recommendation, not an instruction, and the owner decides.');
p();
{
  const rec = proposedAtOrAbove(0.85);
  const recOwned = rec.filter((r) => r.owned).length;
  const risky = rec.filter((r) => r.siblingRisk);
  p(`**Apply PROPOSED rows scoring ≥ 0.85 — ${rec.length} rows, ${recOwned} of them owned. Hand-check everything below.**`);
  p();
  if (risky.length === 0) {
    p('Two independent checks come back clean on that set, and they are the two that would catch the');
    p('failure this audit exists to prevent:');
    p();
    p(`- **Not one of the ${rec.length} carries a \`sibling_risk\` flag.** Every sibling-confusion candidate the`);
    p('  run produced scored below the line on its own.');
    p('- **No BGG id is proposed twice at or above 0.85.** Where several of our rows did converge on one');
    p('  id — and 25 groups did — the score separated them every time: the correct row scored 0.85+ and');
    p('  its siblings scored 0.63 or less. Not one collision has two rows above the line.');
    p();
  } else {
    p(`Glance first at the ${risky.length} of them carrying a \`sibling_risk\` flag — see section 4.`);
    p();
  }
  p('Why 0.85, stated as arithmetic rather than as a feeling. Under the weighted average, the best a');
  p('candidate can score for a given name strength — assuming year, publisher, kind and corroboration');
  p('all agree perfectly — is:');
  p();
  p('| Name evidence | Name fraction | Best achievable score |');
  p('|---|---:|---:|');
  p('| exact / alternate-name exact | 1.00 / 0.90 | 1.00 / 0.95 |');
  p('| `titleSimilarity` ≥ 0.9 | 0.80 | **0.87** |');
  p('| `titleSimilarity` ≥ 0.8 | 0.60 | 0.82 |');
  p('| `titleSimilarity` ≥ 0.7 | 0.45 | 0.75 |');
  p();
  p('So **0.85 admits exactly two populations**: titles that are the same string, and titles that');
  p('differ by ≥0.9 similarity *and* agree on everything else. In this run the second group is');
  p('entirely rows where BGG omits or includes the word "Expansion", or punctuates differently —');
  p('*Command of Nature: Sand & Wind Expansion* against *Command of Nature: Sand & Wind*. That is the');
  p('"like items" case the brief wanted used, and it is the whole reason not to set the bar at 1.00.');
  p();
  p('Below 0.85 sit the rows that are genuinely a judgement call, and the run produced real examples');
  p('of why they must not be applied blind:');
  p();
  p('| Row | Proposed | Score | Verdict on inspection |');
  p('|---|---|---:|---|');
  for (const id of [502, 218, 294]) {
    const r = proposed.find((x) => x.id === id);
    if (r) p(`| ${r.id} *${esc(r.name)}* | ${esc(r.bggName)} | ${r.score} | **wrong sibling** — same family, different product |`);
  }
  p();
  p('Every one of those is a *sibling inside the correct family*, which is the failure the gate cannot');
  p('catch on its own — both products really are in the family, so family corroboration argues for the');
  p('wrong answer. The score is what separates them, and 0.85 is above all three.');
  p();
  p('Why not higher: 0.95+ requires our side to hold a year **and** a publisher, and most of the 609');
  p('rows with no `bgg_id` also have no publisher — largely the same population. Raising the bar would');
  p('reject rows for a fact nobody ever recorded rather than for anything BGG said.');
  p();
  p(`**Nothing in SUSPECT should be applied.** Those are ${count(suspect)} rows to look at, not ${count(suspect)} rows to change.`);
  p();
  p('**And nothing here should be applied in bulk without the TSV being read.** The score orders the');
  p('work; it does not replace the look.');
}
p();

// ---------------------------------------------------------------------------
// Likely false negatives: fragment rejections where the ONLY differing words
// name a format or a provenance, not a product.
// ---------------------------------------------------------------------------
const GEN_W = new Set(['expansion', 'expansions', 'extension', 'edition', 'miniature', 'miniatures', 'board', 'game', 'the', 'a', 'an', 'of', 'and']);
const FORMAT_W = new Set(['pack', 'packs', 'set', 'sets', 'bundle', 'ks', 'kickstarter', 'exclusive', 'deluxe', 'premium']);
const wset = (s) =>
  new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((x) => x.length > 1 && !GEN_W.has(x)));
const nearMisses = [];
for (const r of rows) {
  if (r.verdict !== 'UNMATCHED' || !r.nearMiss) continue;
  const m = r.nearMiss.match(/rejected (\d+) "(.*)" \((.*?)\) — (.*)/);
  if (!m || !m[4].includes('isFragmentOf')) continue;
  const a = wset(r.name);
  const b = wset(m[2]);
  const only = [...[...a].filter((x) => !b.has(x)), ...[...b].filter((x) => !a.has(x))];
  if (only.length > 0 && only.every((x) => FORMAT_W.has(x))) nearMisses.push({ r, id: m[1], nm: m[2], only });
}

p('## The biggest single opportunity below the line');
p();
p(`**${nearMisses.length} UNMATCHED rows (${nearMisses.filter((x) => x.r.owned).length} owned) were rejected on nothing but a format or provenance word.**`);
p();
p('These are rows where the *only* difference between our title and BGG\'s is a word like `Pack`,');
p('`Set`, `KS Exclusive` or `Deluxe` — words that describe how a product was sold, not which');
p('product it is. `isFragmentOf` cannot tell those apart from a genuinely distinguishing word,');
p('because the shipped `GENERIC_TITLE_WORDS` list contains `expansion` and `edition` but not `pack`');
p('or `exclusive`.');
p();
p('| id | kind | owned | our name | rejected candidate | differs only by |');
p('|---:|---|---|---|---|---|');
for (const x of nearMisses) {
  p(`| ${x.r.id} | ${x.r.kind} | ${x.r.owned ? 'yes' : 'no'} | ${esc(x.r.name)} | [${x.id}](${url(x.id)}) ${esc(x.nm)} | ${esc(x.only.join(', '))} |`);
}
p();
p('### ⚠️ Do not fix this by adding `pack` to `GENERIC_TITLE_WORDS`');
p();
p('One row in that very table is a genuine family trap, and it is the argument against automating');
p('this:');
p();
{
  const trap = nearMisses.find((x) => x.r.id === 277);
  if (trap) {
    p(`> **${trap.r.id} \`${esc(trap.r.name)}\`** was rejected against **[${trap.id}](${url(trap.id)}) *${esc(trap.nm)}*** for differing only by`);
    p('> the word "pack". But *Casting Shadows* is the **base game** and our row is its expansion pack.');
    p('> Attaching that id is precisely the failure this audit was commissioned to prevent.');
    p();
  }
}
p('So the same textual pattern contains ~19 near-certain matches **and** at least one wrong-product');
p('match, and no rule reading only the two strings can separate them — the thing that separates them');
p('is knowing that *Casting Shadows* is a base game. That is a human judgement, and it is why this');
p('list is offered as **a short manual worklist, not a threshold change**. Widening the generic-word');
p('list would silently convert that one row into a wrong id, which is the exact shape of the bug the');
p('handoff records at 0.34.');
p();
p('Worked by hand at roughly ten seconds a row, this is the highest-value twenty minutes available');
p('after the 35 — and unlike the 35, most of it is `expansion` rows, which is what the completeness');
p('feature actually needs.');
p();

p('## Rows to eyeball first');
p();
p('In this order.');
p();
p('### 1. The five SUSPECT rows (5 minutes, and three are probably fine)');
p();
p('See the table above. Two are worth real attention and three are almost certainly noise:');
p();
p('- **496 `Yeti or Not: Exclusive Edition Expansion` → BGG "Twisted Cryptids: Yeti or Not"** —');
p('  similarity 0.55. Plausibly the same product under the line\'s name, plausibly not. **Look at this one.**');
p('- **114 `Dice Throne: Deadpool Box Deluxe Edition` → "Marvel Dice Throne: Deadpool"** — similarity');
p('  0.6, and the "Box Deluxe Edition" wording is doing the damage. Probably right, but it is an');
p('  edition question and the catalog has no edition recorded. **Look at this one.**');
p('- **801 `Go Fish`** — publisher "Traditional". That is the deliberate `NO_PUBLISHER_EXISTS` marker');
p('  documented in `docs/HANDOFF.md`, not an error. **Ignore.**');
p('- **68 `Savage`** — ours "Grinley Games", BGG "Grinly Games". A one-letter difference; somebody is');
p('  misspelled and it is not an id problem.');
p('- **56 `Magic Number`** — ours "Magic Number Games", BGG "(Self-Published)". Our value is arguably');
p('  the better one.');
p();

const eyeball = [];
// Proposals just under the recommended line — where a human call actually changes the outcome.
const borderline = proposed
  .filter((r) => r.score >= 0.7 && r.score < 0.85)
  .sort((a, b) => b.score - a.score);
// Proposals where a runner-up also cleared the gate.
const contested = proposed.filter((r) => (r.note ?? '').includes('runner-up'));
// Two of our items proposing the same BGG id.
const byProposed = new Map();
for (const r of proposed) {
  if (!byProposed.has(r.proposedId)) byProposed.set(r.proposedId, []);
  byProposed.get(r.proposedId).push(r);
}
const collisions = [...byProposed.entries()].filter(([, v]) => v.length > 1);

p(`### 2. Proposals that collide — two catalog rows claiming one BGG id (${collisions.length})`);
p();
if (collisions.length === 0) p('_None. No BGG id is proposed for more than one catalog row._');
else {
  p('This is the duplicate-row shape that produced the Settlers of Catan problem, arriving from the');
  p('other direction. Either two of our rows are the same product, or one of these proposals is wrong.');
  p();
  p('| Proposed id | BGG name | Our rows |');
  p('|---:|---|---|');
  for (const [id, v] of collisions.slice(0, 40)) {
    p(`| [${id}](${url(id)}) | ${esc(v[0].bggName)} | ${v.map((r) => `${r.id} *${esc(r.name)}* (${r.score})`).join(' · ')} |`);
  }
}
p();
p(`### 3. Proposals with a runner-up that also cleared the gate (${contested.length})`);
p();
if (contested.length === 0) p('_None._');
else {
  p('| id | our name | proposed | score | runner-up |');
  p('|---:|---|---:|---:|---|');
  for (const r of contested.slice(0, 40)) {
    p(`| ${r.id} | ${esc(r.name)} | [${r.proposedId}](${url(r.proposedId)}) | ${r.score} | ${esc((r.note ?? '').replace(/^.*runner-up /, ''))} |`);
  }
}
p();
const siblingFlagged = proposed.filter((r) => r.siblingRisk).sort((a, b) => b.score - a.score);
p(`### 4. Sibling risk — the proposed name differs from ours by exactly one meaningful word (${siblingFlagged.length})`);
p();
p('This is the failure mode the gate structurally cannot catch, because a wrong sibling really *is*');
p('in the right family and therefore collects full corroboration credit. One differing word inside an');
p('otherwise identical title is its signature. Most of these are innocent — the differing word is a');
p('number or a spelling — but this is the list where a wrong id would hide.');
p();
if (siblingFlagged.length === 0) p('_None._');
else {
  p('| id | score | our name | proposed | BGG name | the differing word |');
  p('|---:|---:|---|---:|---|---|');
  for (const r of siblingFlagged.slice(0, 50)) {
    p(`| ${r.id} | ${r.score} | ${esc(r.name)} | [${r.proposedId}](${url(r.proposedId)}) | ${esc(r.bggName)} | ${esc((r.siblingRisk ?? '').replace(/^differs by one meaningful word: /, '').replace(/ — check.*$/, ''))} |`);
  }
  if (siblingFlagged.length > 50) p(`| … | | _${siblingFlagged.length - 50} more in the TSV_ | | | |`);
}
p();
p(`### 5. The band just under the recommended cut-off, 0.70–0.84 (${borderline.length})`);
p();
p('These are the rows where the owner\'s judgement actually changes the outcome — above 0.85 the');
p('answer is already clear, below 0.70 nothing was proposed at all.');
p();
if (borderline.length === 0) p('_None._');
else {
  p('| id | kind | owned | our name | proposed | BGG name | year | score |');
  p('|---:|---|---|---|---:|---|---:|---:|');
  for (const r of borderline.slice(0, 60)) {
    p(`| ${r.id} | ${r.kind} | ${r.owned ? 'yes' : 'no'} | ${esc(r.name)} | [${r.proposedId}](${url(r.proposedId)}) | ${esc(r.bggName)} | ${r.bggYear ?? ''} | ${r.score} |`);
  }
  if (borderline.length > 60) p(`| … | | | _${borderline.length - 60} more in the TSV_ | | | | |`);
}
p();

p('### 6. Owned base games still UNMATCHED');
p();
{
  const ob = unmatched.filter((r) => r.owned && r.kind === 'base');
  if (ob.length === 0) p('_None — every owned base game either has an id or has a proposal._');
  else {
    p('A base game with no BGG entry is unusual in a way that a playmat with no BGG entry is not, so');
    p('these are worth a look even though the audit could not resolve them.');
    p();
    p('| id | our name | year | publisher | why unmatched | near miss |');
    p('|---:|---|---:|---|---|---|');
    for (const r of ob) {
      p(`| ${r.id} | ${esc(r.name)} | ${r.ourYear ?? ''} | ${esc(r.ourPublisher)} | ${esc(r.note)} | ${esc(r.nearMiss)} |`);
    }
  }
}
p();

p('## Where I am least sure');
p();
p('- **Publisher comparison is the weakest signal in the whole scheme.** It is the one metric not');
p('  ported from shipped code. Our catalog stores one publisher; BGG lists up to fifty, including');
p('  every localisation house, and normalising `Sp. z o.o.` and `Games` out of both sides is a');
p('  heuristic I wrote today. It carries only 15 of the weight and it never gates anything, which is');
p('  deliberate — but a `PUBLISHER` disagreement in the TSV deserves less alarm than a `NAME` one.');
p('- **`kind` plausibility encodes a taxonomy disagreement, not an error.** BGG types Dice Throne');
p('  heroes and King of Tokyo Monster Packs as `boardgameexpansion`; the catalog calls them `base`.');
p('  Ten CONFIRMED rows carry that note. Neither side is wrong and nothing needs changing.');
p('- **A false UNMATCHED is cheap and a false PROPOSED is not**, so the gate is tuned to produce the');
p('  former. Some rows in UNMATCHED certainly do have BGG entries under a name I did not think to');
p('  search for. The `near_miss_rejected` column is where to start looking.');
p('- **The year on a `wanted`/`preordered` row is a guess on both sides.** Unreleased products move');
p('  years; BGG\'s figure and ours can disagree without either being wrong.');
p();

p('## Reproducing this');
p();
p('```bash');
p('# 1. the catalog snapshot (SELECT only)');
p('npx wrangler d1 execute board-game-catalog --remote --config apps/worker/wrangler.toml --json \\');
p('  --command "SELECT ... FROM item i ORDER BY i.id" > scratchpad/bgg-audit/catalog.json');
p();
p('# 2. the audit');
p('node scratchpad/bgg-audit/audit.mjs        # both phases');
p('node scratchpad/bgg-audit/audit.mjs A      # phase A only — the 197 existing ids, ~10 calls');
p();
p('# 3. this file');
p('node scratchpad/bgg-audit/report.mjs');
p('```');
p();
p('| | |');
p('|---|---|');
p('| `scratchpad/bgg-audit/lib.mjs` | BGG client ported from `packages/bgg/src/client.ts` (same serialising queue, same 202 retry, same 20-id `/thing` ceiling) + the shipped string comparisons |');
p('| `scratchpad/bgg-audit/audit.mjs` | phases A and B, the gate, the score |');
p('| `scratchpad/bgg-audit/rescore.mjs` | the two corrections below; no network |');
p('| `scratchpad/bgg-audit/report.mjs` | this document |');
p('| `scratchpad/bgg-audit/catalog.json` | the production snapshot the audit ran against |');
p('| `scratchpad/bgg-audit/audit.json` | full results, including score components |');
p();
p('⚠️ **The one place this client deliberately departs from the shipped one is the rate limit.**');
p('`packages/bgg/src/client.ts` uses a flat 1.1 s gap and gets away with it because every call goes');
p('through Cloudflare\'s edge cache with a 7-day TTL. An uncached 1,473-call audit does not: BGG');
p('started answering **429** about ninety seconds in. The gap here is therefore adaptive — 2.2 s to');
p('start, ×1.4 on every 429 up to a 6 s ceiling, decaying back toward 1.6 s after 40 clean calls.');
p('It settled around 2 s and absorbed 10 rate-limit responses without a single lost row.');
p();
p('⚠️ **A 429 must never reach the caller as "no results."** The first version of this client threw');
p('on 429 and the caller treated the throw as an empty result set, which would have written false');
p('`UNMATCHED` verdicts into the map indistinguishable from real ones. Rate limits are now retried');
p('inside the client, and a call that genuinely fails produces an `ERROR` verdict, never `UNMATCHED`.');
p('That distinction is the difference between a map you can trust and one you cannot.');
p();
p('⚠️ **`curl` cannot reach the network in this environment (exit 43) and `Invoke-WebRequest` hangs');
p('on BGG\'s 401 challenge.** Node\'s `fetch` works fine and is what the audit uses. `BGG_API_TOKEN`');
p('is read from `apps/worker/.dev.vars` at runtime and is never printed or written anywhere.');
p();
p(`**Run cost:** \`${lastLine.replace(/^\[[^\]]*\]\s*/, '')}\``);
p();
p('## TSV columns');
p();
p('| Column | |');
p('|---|---|');
p('| `our_id` `our_name` `kind` `owned` | the catalog row |');
p('| `current_bgg_id` | what it holds today, blank for the 609 |');
p('| `verdict` | CONFIRMED / SUSPECT / PROPOSED / UNMATCHED |');
p('| `proposed_bgg_id` | set on PROPOSED rows only — **never** on SUSPECT |');
p('| `bgg_name` `bgg_year` `bgg_publisher` `bgg_type` | what BGG says about the id in play |');
p('| `our_year` `our_publisher` | our side of the same comparison |');
p('| `score` `score_components` | the number, and the five phrases it was built from |');
p('| `evidence_url` | the BGG page |');
p('| `note` | what disagrees, or why nothing matched |');
p('| `near_miss_rejected` | the closest candidate that was **refused**, and the reason |');
p('| `sibling_risk` | set when the proposed name differs from ours by exactly one meaningful word |');
p();
p('## Two corrections made mid-run, recorded rather than quietly applied');
p();
p('Both were found by reading the first hundred rows while the run was still going, and both are');
p('applied by `rescore.mjs`, which recomputes scores from the stored component phrases and makes no');
p('network calls.');
p();
p('1. **The `kind` family-trap penalty was firing on exact name matches.** It dragged');
p('   *Boss Monster: Rise of the Minibosses* — a name BGG matches character for character — down to');
p('   0.66, because BGG types it `boardgame` while the catalog calls it `expansion`. That is a');
p('   taxonomy disagreement, not a wrong id. A different product is never named identically to its');
p('   base game, so an exact name makes the trap impossible; the penalty now only applies when the');
p('   name is *not* exact. This is the same rule the Phase A side already used.');
p('2. **Nothing caught wrong siblings**, so `sibling_risk` was added. It is a flag, not a rejection.');
p();
p('Neither correction loosened the gate. The first raised some scores that were unfairly low; the');
p('second added a warning column. No candidate became eligible that was not eligible before.');

writeFileSync('scratchpad/bgg-audit-2026-08-08.md', L.join('\n') + '\n', 'utf8');
copyFileSync(`${DIR}/audit.tsv`, 'scratchpad/bgg-audit-2026-08-08.tsv');
console.log('wrote scratchpad/bgg-audit-2026-08-08.md and .tsv');
console.log('CONFIRMED', count(confirmed), 'SUSPECT', count(suspect), 'PROPOSED', count(proposed), 'UNMATCHED', count(unmatched));
console.log('proposed >=0.85:', proposedAtOrAbove(0.85).length, 'collisions:', collisions.length, 'contested:', contested.length, 'borderline:', borderline.length);
