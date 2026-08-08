/**
 * BGG audit — READ ONLY. 2026-08-08.
 *
 * Reads the catalog snapshot in catalog.json (dumped from production D1 with a
 * SELECT) and BoardGameGeek's XMLAPI2 (GET only). Writes nothing anywhere except
 * files under scratchpad/bgg-audit/.
 *
 * Phase A: verify the 197 items that already carry a bgg_id.
 * Phase B: look for a match for the 609 that do not.
 *
 * The trap this is built around: a search for an accessory surfaces its base
 * game. Matching that would make the accessory claim the base game's identity.
 * So the *search* widens freely and the *scoring* is strict, and every candidate
 * must clear isFragmentOf() — the same rule isConfidentMatch uses — against the
 * item's ORIGINAL full name.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  readToken,
  search,
  things,
  normaliseTitle,
  titleSimilarity,
  isFragmentOf,
  publisherAgreement,
  stats,
  MIN_SPINE_SIMILARITY,
} from './lib.mjs';

const DIR = 'scratchpad/bgg-audit';
const token = readToken('apps/worker/.dev.vars');
const catalog = JSON.parse(readFileSync(`${DIR}/catalog.json`, 'utf8'))[0].results;
const byId = new Map(catalog.map((r) => [r.id, r]));

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const owned = (r) => (r.statuses ?? '').split(',').includes('owned');

// ---------------------------------------------------------------------------
// Scoring — every number here is stated in the deliverable so it can be argued
// with. Weighted average over the evidence that was ACTUALLY AVAILABLE, so an
// item with no year on our side is not punished for it.
// ---------------------------------------------------------------------------
const WEIGHTS = { name: 50, year: 20, publisher: 15, kind: 10, corroboration: 15 };

function nameComponent(ourName, thing) {
  const ours = normaliseTitle(ourName);
  const theirs = normaliseTitle(thing.name);
  if (ours === theirs) return { fraction: 1.0, why: 'name exact (normalised)' };
  for (const alt of thing.alternateNames ?? []) {
    if (normaliseTitle(alt) === ours) return { fraction: 0.9, why: `alternate-name exact ("${alt}")` };
  }
  const sim = titleSimilarity(thing.name, ourName);
  const r = Math.round(sim * 100) / 100;
  if (sim >= 0.9) return { fraction: 0.8, why: `name similarity ${r}` };
  if (sim >= 0.8) return { fraction: 0.6, why: `name similarity ${r}` };
  if (sim >= MIN_SPINE_SIMILARITY) return { fraction: 0.45, why: `name similarity ${r}` };
  return { fraction: -1, why: `name similarity ${r} (below ${MIN_SPINE_SIMILARITY})` };
}

function yearComponent(ourYear, theirYear) {
  if (!ourYear || !theirYear) return { available: false, fraction: 0, why: 'year unknown one side' };
  const d = Math.abs(ourYear - theirYear);
  if (d === 0) return { available: true, fraction: 1.0, why: `year exact (${ourYear})` };
  if (d === 1) return { available: true, fraction: 0.5, why: `year off by 1 (${ourYear} vs ${theirYear})` };
  if (d <= 3) return { available: true, fraction: 0.0, why: `year off by ${d} (${ourYear} vs ${theirYear})` };
  return { available: true, fraction: -1, why: `year off by ${d} (${ourYear} vs ${theirYear})` };
}

function publisherComponent(ourPub, thing) {
  const names = (thing.publisherLinks ?? []).map((p) => p.name);
  const verdict = publisherAgreement(ourPub, names);
  if (verdict === 'unknown') return { available: false, fraction: 0, why: 'publisher unknown one side' };
  if (verdict === 'exact') return { available: true, fraction: 1.0, why: `publisher exact (${ourPub})` };
  if (verdict === 'partial') return { available: true, fraction: 0.7, why: `publisher partial (${ourPub} ~ BGG list)` };
  return {
    available: true,
    fraction: -1,
    why: `publisher absent from BGG list (ours "${ourPub}", BGG "${names.slice(0, 3).join('; ')}")`,
  };
}

/**
 * Our `kind` against BGG's `type` and its links.
 *
 * The row that matters: our accessory/expansion/promo matching a BGG entry typed
 * `boardgame` that itself HAS expansions or accessories is the family trap in
 * numeric form — the id names a base game, not the product.
 */
function kindComponent(ourKind, thing, nameIsExact = false) {
  const t = thing.type;
  // An exact name settles identity, so the family trap is impossible and the
  // harsh penalty below must not fire — see rescore.mjs correction 1.
  const trap = (why) => (nameIsExact ? { fraction: 0.2, why: `${why} (name matches exactly, so not the trap)` } : { fraction: -1, why });
  const hasChildren = (thing.expansionLinks?.length ?? 0) + (thing.accessoryLinks?.length ?? 0) > 0;
  if (ourKind === 'base') {
    if (t === 'boardgame') return { fraction: 1.0, why: 'kind base ~ BGG boardgame' };
    return trap(`kind base vs BGG ${t}`);
  }
  if (ourKind === 'expansion') {
    if (t === 'boardgameexpansion') return { fraction: 1.0, why: 'kind expansion ~ BGG boardgameexpansion' };
    if (t === 'boardgameaccessory') return { fraction: 0.5, why: 'kind expansion vs BGG accessory' };
    if (t === 'boardgame' && hasChildren)
      return trap('kind expansion vs BGG base game that HAS expansions/accessories (family trap shape)');
    return { fraction: 0.2, why: 'kind expansion vs BGG boardgame (nobody’s expansion)' };
  }
  if (ourKind === 'accessory' || ourKind === 'upgrade') {
    if (t === 'boardgameaccessory') return { fraction: 1.0, why: `kind ${ourKind} ~ BGG boardgameaccessory` };
    if (t === 'boardgameexpansion') return { fraction: 0.5, why: `kind ${ourKind} vs BGG expansion` };
    if (t === 'boardgame' && hasChildren)
      return trap(`kind ${ourKind} vs BGG base game that HAS expansions/accessories (family trap shape)`);
    return { fraction: 0.2, why: `kind ${ourKind} vs BGG boardgame` };
  }
  if (ourKind === 'promo') {
    if (t === 'boardgameexpansion' || t === 'boardgameaccessory')
      return { fraction: 1.0, why: `kind promo ~ BGG ${t}` };
    if (t === 'boardgame' && hasChildren)
      return trap('kind promo vs BGG base game that HAS expansions/accessories (family trap shape)');
    return { fraction: 0.2, why: 'kind promo vs BGG boardgame' };
  }
  return { fraction: 0.5, why: `kind ${ourKind} unclassified` };
}

function corroborationComponent({ fromFamilyLinks, candidateCount }) {
  if (fromFamilyLinks)
    return { fraction: 1.0, why: 'listed as an expansion/accessory of the parent id we already hold' };
  if (candidateCount === 1) return { fraction: 0.7, why: 'sole candidate id in the search' };
  if (candidateCount <= 4) return { fraction: 0.5, why: `${candidateCount} candidate ids` };
  if (candidateCount <= 9) return { fraction: 0.3, why: `${candidateCount} candidate ids` };
  return { fraction: 0.1, why: `${candidateCount} candidate ids` };
}

function scoreCandidate(row, thing, ctx) {
  const name = nameComponent(row.name, thing);
  const year = yearComponent(row.year_published, thing.yearPublished);
  const pub = publisherComponent(row.publisher, thing);
  const kind = kindComponent(row.kind, thing, name.fraction >= 0.9);
  const corr = corroborationComponent(ctx);

  let num = WEIGHTS.name * name.fraction + WEIGHTS.kind * kind.fraction + WEIGHTS.corroboration * corr.fraction;
  let den = WEIGHTS.name + WEIGHTS.kind + WEIGHTS.corroboration;
  if (year.available) {
    num += WEIGHTS.year * year.fraction;
    den += WEIGHTS.year;
  }
  if (pub.available) {
    num += WEIGHTS.publisher * pub.fraction;
    den += WEIGHTS.publisher;
  }
  const score = Math.max(0, Math.min(1, num / den));
  return {
    score: Math.round(score * 100) / 100,
    components: [name.why, year.why, pub.why, kind.why, corr.why],
    name,
    year,
    pub,
    kind,
    corr,
  };
}

// ---------------------------------------------------------------------------
// The hard gate. Nothing that fails this can ever become a PROPOSED.
// ---------------------------------------------------------------------------
function gate(ourName, thing) {
  if (isFragmentOf(thing.name, ourName))
    return { pass: false, reason: 'same family, different product (isFragmentOf)' };
  const sim = titleSimilarity(thing.name, ourName);
  if (sim >= MIN_SPINE_SIMILARITY) return { pass: true, reason: `similarity ${Math.round(sim * 100) / 100}` };
  for (const alt of thing.alternateNames ?? []) {
    if (normaliseTitle(alt) === normaliseTitle(ourName))
      return { pass: true, reason: `alternate name "${alt}"` };
    if (!isFragmentOf(alt, ourName) && titleSimilarity(alt, ourName) >= MIN_SPINE_SIMILARITY)
      return { pass: true, reason: `alternate name "${alt}" similarity` };
  }
  return { pass: false, reason: `similarity ${Math.round(sim * 100) / 100} < ${MIN_SPINE_SIMILARITY}` };
}

// ---------------------------------------------------------------------------
// Query ladder. Widening is safe because the gate above is applied to the
// item's original full name regardless of what was searched with.
// ---------------------------------------------------------------------------
const GENERIC_QUERY_WORDS = new Set([
  'expansion', 'expansions', 'pack', 'edition', 'the', 'board', 'game', 'promo',
  'mini', 'set', 'kit', 'a', 'an', 'of', 'and',
]);

function cleanQuery(s) {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[–—‒]/g, ' ')
    .replace(/[^\p{L}\p{N}&'\s:-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function queryLadder(row) {
  const out = [];
  const push = (q) => {
    const c = cleanQuery(q ?? '');
    if (c && c.length > 1 && !out.includes(c)) out.push(c);
  };

  push(row.name);

  // Rung 2 — drop words that say what KIND of product this is, not which one.
  const stripped = row.name
    .replace(/[–—‒:,-]/g, ' ')
    .split(/\s+/)
    .filter((w) => !GENERIC_QUERY_WORDS.has(w.toLowerCase()))
    .join(' ');
  push(stripped);

  // Rung 3 — the subtitle on its own; BGG often orders the words differently.
  const parts = row.name.split(/\s*[:–—-]\s*/).filter(Boolean);
  if (parts.length > 1) push(parts.slice(1).join(' '));

  // Rung 4 — the family prefix. Collects the near-miss for the UNMATCHED note.
  if (parts.length > 1) push(parts[0]);
  if (row.parent_name) push(row.parent_name.split(/\s*[:–—-]\s*/)[0]);

  return out;
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
const searchCache = new Map();
/** Queries whose call genuinely failed — so a failure never reads as "no results". */
const failedQueries = new Set();
async function cachedSearch(q) {
  const key = q.toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);
  let res;
  try {
    res = await search(token, q);
  } catch (err) {
    log(`  SEARCH FAILED "${q}": ${err.message}`);
    failedQueries.add(key);
    searchCache.set(key, []);
    return [];
  }
  // BGG returns the same id once per type; dedupe.
  const seen = new Set();
  const deduped = res.filter((r) => (seen.has(r.bggId) ? false : (seen.add(r.bggId), true)));
  searchCache.set(key, deduped);
  return deduped;
}

const thingCache = new Map();
/** Ids whose /thing call failed outright — distinct from "BGG has no such id". */
const failedThings = new Set();
async function getThings(ids) {
  const missing = [...new Set(ids)].filter((i) => !thingCache.has(i) && Number.isFinite(i));
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 20) {
      const chunk = missing.slice(i, i + 20);
      try {
        const got = await things(token, chunk);
        for (const t of got) thingCache.set(t.bggId, t);
        // Ids BGG simply does not return are a real answer: no such thing.
        for (const id of chunk) if (!thingCache.has(id)) thingCache.set(id, null);
      } catch (err) {
        log(`  THING CHUNK FAILED [${chunk.join(',')}]: ${err.message}`);
        for (const id of chunk) {
          failedThings.add(id);
          if (!thingCache.has(id)) thingCache.set(id, null);
        }
      }
    }
  }
  return ids.map((i) => thingCache.get(i)).filter(Boolean);
}

const url = (id) => `https://boardgamegeek.com/boardgame/${id}`;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const rows = [];

async function phaseA() {
  const have = catalog.filter((r) => r.bgg_id);
  log(`Phase A: verifying ${have.length} existing bgg_ids`);
  await getThings(have.map((r) => r.bgg_id));

  for (const row of have) {
    const thing = thingCache.get(row.bgg_id);
    if (!thing) {
      // A failed call is not evidence of a missing id. Keep the two apart.
      const failed = failedThings.has(row.bgg_id);
      rows.push({
        row, verdict: failed ? 'ERROR' : 'SUSPECT', proposedId: '', thing: null, score: 0,
        components: [failed ? 'BGG call failed' : 'BGG returned no entry for this id'],
        note: failed
          ? 'A BGG CALL FAILED for this row — treat as unaudited, not as a bad id'
          : 'id not found on BGG (deleted, merged, or never existed)',
        nearMiss: '',
      });
      continue;
    }
    const s = scoreCandidate(row, thing, { fromFamilyLinks: false, candidateCount: 1 });

    /*
     * Verifying an id a person already set is NOT the same question as proposing
     * a new one, so isFragmentOf is not a hard gate here. "Dead of Winter" vs
     * "Dead of Winter: A Crossroads Game" is a fragment relationship AND the same
     * product — the catalog simply stores the short title.
     *
     * What separates that from the item-250 family trap is `kind`: a fragment
     * relationship is only alarming when OUR row is a child product and BGG's
     * entry is a base game with expansions/accessories of its own. And an exact
     * name match settles identity outright — a holofoil box is never named
     * identically to its base game — so kind/year/publisher quibbles under an
     * exact name are notes, never identity failures.
     */
    const ours = normaliseTitle(row.name);
    const nameExact =
      ours === normaliseTitle(thing.name) ||
      (thing.alternateNames ?? []).some((a) => normaliseTitle(a) === ours);
    const sim = Math.round(titleSimilarity(thing.name, row.name) * 100) / 100;
    const fragment = isFragmentOf(thing.name, row.name);
    const childCount = (thing.expansionLinks?.length ?? 0) + (thing.accessoryLinks?.length ?? 0);
    const bggIsBaseWithChildren = thing.type === 'boardgame' && childCount > 0;

    const disagreements = [];
    const notes = [];

    if (nameExact) {
      // Identity settled by the name itself.
    } else if (fragment && row.kind !== 'base' && bggIsBaseWithChildren) {
      disagreements.push(
        `NAME+KIND: our ${row.kind} "${row.name}" points at BGG "${thing.name}", a base game carrying ${childCount} expansions/accessories of its own — this id may name the family rather than the product`,
      );
    } else if (fragment) {
      notes.push(`title differs by a subtitle: BGG says "${thing.name}" (similarity ${sim})`);
    } else if (sim < MIN_SPINE_SIMILARITY) {
      disagreements.push(`NAME: similarity ${sim} — we say "${row.name}", BGG says "${thing.name}"`);
    } else {
      notes.push(`name similarity ${sim}: BGG says "${thing.name}"`);
    }

    if (s.year.available) {
      const d = Math.abs(row.year_published - thing.yearPublished);
      if (d >= 3) disagreements.push(`YEAR: ours ${row.year_published}, BGG ${thing.yearPublished} (off by ${d})`);
      else if (d >= 1) notes.push(`year off by ${d}: ours ${row.year_published}, BGG ${thing.yearPublished}`);
    }
    if (s.pub.available && s.pub.fraction < 0) {
      disagreements.push(
        `PUBLISHER: ours "${row.publisher}" appears nowhere in BGG's ${thing.publisherLinks.length} publisher links (BGG lists "${thing.publisherLinks.slice(0, 3).map((p) => p.name).join('; ')}")`,
      );
    }
    if (s.kind.fraction < 0 && !disagreements.some((d) => d.startsWith('NAME+KIND'))) {
      notes.push(`kind: we say ${row.kind}, BGG types it ${thing.type}`);
    }

    rows.push({
      row,
      verdict: disagreements.length ? 'SUSPECT' : 'CONFIRMED',
      proposedId: '',
      thing,
      score: s.score,
      components: s.components,
      note: [...disagreements, ...notes].join(' | '),
      nearMiss: '',
    });
  }
  log(`Phase A done. calls=${stats.calls}`);
}

async function phaseB() {
  const missing = catalog.filter((r) => !r.bgg_id);
  // Owned base games first, then owned expansions, then everything else — so a
  // truncated run still answers the questions that matter most.
  const priority = (r) => {
    const o = owned(r) ? 0 : 3;
    const k = r.kind === 'base' ? 0 : r.kind === 'expansion' ? 1 : 2;
    return o + k;
  };
  const ordered = [...missing].sort((a, b) => priority(a) - priority(b) || a.id - b.id);
  log(`Phase B: ${ordered.length} items with no bgg_id`);

  // Resume: a run this long must not be all-or-nothing.
  const done = new Set(rows.map((r) => r.row.id));
  const todo = ordered.filter((r) => !done.has(r.id));
  if (todo.length !== ordered.length) log(`  resuming: ${ordered.length - todo.length} already done`);

  let n = 0;
  for (const row of todo) {
    n += 1;

    const nameGate = (candidateName) =>
      !isFragmentOf(candidateName, row.name) &&
      titleSimilarity(candidateName, row.name) >= MIN_SPINE_SIMILARITY;

    /*
     * Candidate pool 1 — the parent/root id's own boardgameexpansion and
     * boardgameaccessory links. COSTS NO CALLS: those parents are the 197 ids
     * Phase A already hydrated. It is also the strongest pool available, because
     * it is BGG's own curated list of the products in that family, and a base
     * game never appears in its own link list — so the family trap cannot enter
     * through here at all.
     */
    const familyIds = new Set();
    const familyNames = new Map();
    for (const relId of [row.parent_item_id, row.root_game_id]) {
      const rel = relId != null ? byId.get(relId) : null;
      if (!rel?.bgg_id || rel.id === row.id) continue;
      const t = thingCache.get(rel.bgg_id);
      if (!t) continue;
      for (const l of [...(t.expansionLinks ?? []), ...(t.accessoryLinks ?? [])]) {
        if (l.id === rel.bgg_id) continue;
        familyIds.add(l.id);
        if (!familyNames.has(l.id)) familyNames.set(l.id, l.value);
      }
    }
    const familyHits = [...familyIds].filter((id) => nameGate(familyNames.get(id) ?? ''));

    // Candidate pool 2 — the search ladder, skipped entirely when the curated
    // family list already answered. Stop on a gate hit; otherwise allow one
    // widening rung, and only exhaust the ladder when nothing came back at all.
    const searchIds = new Set();
    const searchNames = new Map();
    let searchFailed = false;
    if (familyHits.length === 0) {
      let rungsUsed = 0;
      let gateHit = false;
      for (const q of queryLadder(row)) {
        rungsUsed += 1;
        const res = await cachedSearch(q);
        if (failedQueries.has(q.toLowerCase())) searchFailed = true;
        for (const r of res) {
          searchIds.add(r.bggId);
          if (!searchNames.has(r.bggId)) searchNames.set(r.bggId, r);
          if (nameGate(r.name)) gateHit = true;
        }
        if (gateHit) break;
        if (searchIds.size > 0 && rungsUsed >= 2) break;
        if (rungsUsed >= 4) break;
      }
    }

    const allIds = [...new Set([...familyIds, ...searchIds])];
    // Hydrate only what could plausibly matter — anything whose NAME already
    // clears the gate. Hydrating the rest would cost calls to learn nothing.
    const worthHydrating = allIds.filter((id) =>
      familyIds.has(id) ? nameGate(familyNames.get(id) ?? '') : nameGate(searchNames.get(id)?.name ?? ''),
    );

    const hydrated = await getThings(worthHydrating);
    if (worthHydrating.some((id) => failedThings.has(id))) searchFailed = true;

    const scored = [];
    const rejected = [];
    for (const t of hydrated) {
      const g = gate(row.name, t);
      if (!g.pass) {
        rejected.push({ t, reason: g.reason });
        continue;
      }
      const s = scoreCandidate(row, t, {
        fromFamilyLinks: familyIds.has(t.bggId),
        candidateCount: allIds.length || 1,
      });
      scored.push({ t, s });
    }
    // Candidates we never hydrated are rejections too — record the closest.
    const noteRejection = (id, name, year, type) => {
      rejected.push({
        t: { bggId: id, name, yearPublished: year, type },
        reason: isFragmentOf(name, row.name)
          ? 'same family, different product (isFragmentOf)'
          : `similarity ${Math.round(titleSimilarity(name, row.name) * 100) / 100} < ${MIN_SPINE_SIMILARITY}`,
      });
    };
    for (const [id, r] of searchNames) {
      if (worthHydrating.includes(id)) continue;
      noteRejection(id, r.name, r.yearPublished, r.type);
    }
    for (const id of familyIds) {
      if (worthHydrating.includes(id)) continue;
      noteRejection(id, familyNames.get(id) ?? '', null, 'family-link');
    }

    scored.sort((a, b) => b.s.score - a.s.score);
    const best = scored[0];

    let nearMiss = '';
    if (rejected.length) {
      // The near-miss worth naming is the closest one by raw similarity.
      rejected.sort(
        (a, b) => titleSimilarity(b.t.name, row.name) - titleSimilarity(a.t.name, row.name),
      );
      const r = rejected[0];
      nearMiss = `rejected ${r.t.bggId} "${r.t.name}" (${r.t.yearPublished ?? '?'}) — ${r.reason}`;
    }

    if (best) {
      rows.push({
        row, verdict: 'PROPOSED', proposedId: best.t.bggId, thing: best.t,
        score: best.s.score, components: best.s.components,
        note: scored.length > 1
          ? `${scored.length} candidates cleared the gate; runner-up ${scored[1].t.bggId} "${scored[1].t.name}" at ${scored[1].s.score}`
          : '',
        nearMiss,
      });
    } else {
      const why = searchFailed
        ? 'A BGG CALL FAILED for this row — treat as unaudited, not as unmatched'
        : allIds.length === 0
          ? 'no search results at any rung of the ladder'
          : `${allIds.length} candidate(s) found, none the same product`;
      rows.push({
        row, verdict: searchFailed ? 'ERROR' : 'UNMATCHED', proposedId: '', thing: null, score: 0,
        components: [why], note: why, nearMiss,
      });
    }

    if (n % 25 === 0) {
      const mins = (Date.now() - stats.startedAt) / 60000;
      const eta = (mins / n) * (todo.length - n);
      writeOut(); // checkpoint — whatever is finished stays usable
      log(
        `  ${n}/${ordered.length} — calls=${stats.calls} gap=${stats.gap}ms 429s=${stats.retries429} ` +
          `failed=${stats.hardFailures} ${mins.toFixed(1)}min eta=${eta.toFixed(0)}min`,
      );
      writeFileSync(
        `${DIR}/progress.json`,
        JSON.stringify({ n, total: ordered.length, calls: stats.calls, gap: stats.gap }),
      );
    }
  }
  log(`Phase B done. calls=${stats.calls}`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function writeOut() {
  const header = [
    'our_id', 'our_name', 'kind', 'owned', 'current_bgg_id', 'verdict', 'proposed_bgg_id',
    'bgg_name', 'bgg_year', 'bgg_publisher', 'bgg_type', 'our_year', 'our_publisher',
    'score', 'score_components', 'evidence_url', 'note', 'near_miss_rejected',
  ];
  const lines = [header.join('\t')];
  const clean = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());
  for (const r of rows) {
    const t = r.thing;
    const idForUrl = r.proposedId || r.row.bgg_id;
    lines.push(
      [
        r.row.id, r.row.name, r.row.kind, owned(r.row) ? 'yes' : 'no', r.row.bgg_id ?? '',
        r.verdict, r.proposedId ?? '',
        t?.name ?? '', t?.yearPublished ?? '', t?.publisher ?? '', t?.type ?? '',
        r.row.year_published ?? '', r.row.publisher ?? '',
        r.verdict === 'CONFIRMED' || r.verdict === 'PROPOSED' ? r.score : '',
        (r.components ?? []).join('; '),
        idForUrl ? url(idForUrl) : '',
        r.note ?? '', r.nearMiss ?? '',
      ].map(clean).join('\t'),
    );
  }
  writeFileSync(`${DIR}/audit.tsv`, lines.join('\n'), 'utf8');
  writeFileSync(`${DIR}/audit.json`, JSON.stringify(rows.map((r) => ({
    id: r.row.id, name: r.row.name, kind: r.row.kind, owned: owned(r.row),
    currentBggId: r.row.bgg_id, verdict: r.verdict, proposedId: r.proposedId,
    bggName: r.thing?.name ?? null, bggYear: r.thing?.yearPublished ?? null,
    bggPublisher: r.thing?.publisher ?? null, bggType: r.thing?.type ?? null,
    ourYear: r.row.year_published, ourPublisher: r.row.publisher,
    score: r.score, components: r.components, note: r.note, nearMiss: r.nearMiss,
  })), null, 1), 'utf8');

  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  log('verdicts', JSON.stringify(counts));
  log(
    `${stats.calls} BGG calls (${stats.retries429} were 429 retries, ${stats.retries202} were 202 retries, ` +
      `${stats.hardFailures} failed outright), final gap ${stats.gap}ms, ` +
      `${((Date.now() - stats.startedAt) / 60000).toFixed(1)} minutes`,
  );
}

const only = process.argv[2];
await phaseA();
if (only !== 'A' && process.argv.includes('--resume') && existsSync(`${DIR}/audit.json`)) {
  const prior = JSON.parse(readFileSync(`${DIR}/audit.json`, 'utf8'));
  const have = new Set(rows.map((r) => r.row.id));
  for (const r of prior) {
    if (have.has(r.id) || !byId.has(r.id)) continue;
    rows.push({
      row: byId.get(r.id), verdict: r.verdict, proposedId: r.proposedId,
      thing: r.bggName
        ? { bggId: r.proposedId || r.currentBggId, name: r.bggName, yearPublished: r.bggYear, publisher: r.bggPublisher, type: r.bggType }
        : null,
      score: r.score, components: r.components, note: r.note, nearMiss: r.nearMiss,
    });
  }
  log(`resumed ${rows.length} rows from a previous run`);
}
if (only !== 'A') await phaseB();
rows.sort((a, b) => a.row.id - b.row.id);
writeOut();
