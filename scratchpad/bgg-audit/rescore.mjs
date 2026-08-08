/**
 * Rescoring pass. NO NETWORK, NO WRITES — recomputes scores from the component
 * phrases already recorded in audit.json.
 *
 * Two corrections found by spot-checking the live run:
 *
 * 1. The `kind` "family-trap shape" penalty (−1) was firing on rows whose NAME
 *    matches BGG exactly. That is incoherent: a different product is never named
 *    identically to its base game, so an exact name settles identity and the
 *    trap is impossible. It was firing on Boss Monster sets that BGG types as
 *    `boardgame` while the catalog calls them `expansion` — a taxonomy
 *    disagreement, not a wrong id — and pushing correct matches down to 0.61.
 *    Same reasoning already applied on the Phase A side; this makes Phase B
 *    agree with it.
 *
 * 2. Adds `sibling_risk`: the proposed name differs from ours by exactly one
 *    meaningful (non-generic) word. That is the signature of a wrong sibling
 *    inside the right family — "Christmas Expansion Pack" matched against
 *    "Nightmares Expansion Pack" — which the similarity floor alone does not
 *    catch on longer titles. It is a flag for the eye, not a rejection.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'scratchpad/bgg-audit';
const rows = JSON.parse(readFileSync(`${DIR}/audit.json`, 'utf8'));
const WEIGHTS = { name: 50, year: 20, publisher: 15, kind: 10, corroboration: 15 };

const num = (s, re) => {
  const m = String(s).match(re);
  return m ? Number(m[1]) : null;
};

function nameFraction(phrase) {
  if (phrase === 'name exact (normalised)') return 1.0;
  if (phrase.startsWith('alternate-name exact')) return 0.9;
  const sim = num(phrase, /similarity ([\d.]+)/);
  if (sim == null) return null;
  if (sim >= 0.9) return 0.8;
  if (sim >= 0.8) return 0.6;
  if (sim >= 0.7) return 0.45;
  return -1;
}

function yearFraction(phrase) {
  if (phrase.includes('unknown')) return null;
  if (phrase.startsWith('year exact')) return 1.0;
  const d = num(phrase, /off by (\d+)/);
  if (d == null) return null;
  if (d === 1) return 0.5;
  if (d <= 3) return 0.0;
  return -1;
}

function publisherFraction(phrase) {
  if (phrase.includes('unknown')) return null;
  if (phrase.startsWith('publisher exact')) return 1.0;
  if (phrase.startsWith('publisher partial')) return 0.7;
  return -1;
}

/**
 * CORRECTION 1, stated generally: **an exact name settles identity, so no
 * `kind` disagreement can be evidence of a wrong id.** A different product is
 * never named character-for-character like the one we hold. Every harsh kind
 * penalty (−1) is therefore softened to 0.20 — "the taxonomies disagree" —
 * whenever the name matched exactly or via an alternate name.
 *
 * Both harsh penalties are covered, and both are real taxonomy disagreements
 * rather than errors:
 *   - "family trap shape"          our expansion/accessory vs a BGG base game
 *   - "kind base vs BGG <type>"    our base vs a BGG expansion — Dice Throne
 *                                  heroes, King of Tokyo Monster Packs
 */
function kindFraction(phrase, nameIsExact) {
  const harsh =
    phrase.includes('family trap shape') || /^kind base vs BGG (boardgameexpansion|boardgameaccessory)$/.test(phrase);
  if (harsh) return nameIsExact ? 0.2 : -1;
  if (/kind \w+ ~ BGG/.test(phrase)) return 1.0;
  if (phrase.includes('vs BGG accessory') || phrase.includes('vs BGG expansion')) return 0.5;
  if (phrase.includes('unclassified')) return 0.5;
  return 0.2;
}

function corroborationFraction(phrase) {
  if (phrase.startsWith('listed as an expansion/accessory')) return 1.0;
  if (phrase.startsWith('sole candidate')) return 0.7;
  const n = num(phrase, /^(\d+) candidate ids/);
  if (n == null) return 0.5;
  if (n <= 4) return 0.5;
  if (n <= 9) return 0.3;
  return 0.1;
}

// --- sibling detector -------------------------------------------------------
const GENERIC = new Set([
  'expansion', 'expansions', 'extension', 'edition', 'miniature', 'miniatures',
  'board', 'game', 'the', 'pack', 'set', 'box', 'a', 'an', 'of', 'and',
]);
const words = (s) =>
  new Set(
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1 && !GENERIC.has(w)),
  );

function siblingRisk(ourName, bggName) {
  const a = words(ourName);
  const b = words(bggName);
  if (a.size === 0 || b.size === 0) return '';
  const onlyOurs = [...a].filter((w) => !b.has(w));
  const onlyTheirs = [...b].filter((w) => !a.has(w));
  // Exactly one meaningful word on each side that the other does not have.
  if (onlyOurs.length === 1 && onlyTheirs.length === 1) {
    return `differs by one meaningful word: ours "${onlyOurs[0]}" vs BGG "${onlyTheirs[0]}" — check this is not a sibling product`;
  }
  return '';
}

// --- rescore ----------------------------------------------------------------
let changed = 0;
let flagged = 0;
for (const r of rows) {
  if (r.verdict !== 'PROPOSED' && r.verdict !== 'CONFIRMED') continue;
  const c = r.components ?? [];
  if (c.length < 5) continue;

  const nf = nameFraction(c[0]);
  if (nf == null) continue;
  const nameIsExact = nf >= 0.9;
  const yf = yearFraction(c[1]);
  const pf = publisherFraction(c[2]);
  const kf = kindFraction(c[3], nameIsExact);
  const cf = corroborationFraction(c[4]);

  let n = WEIGHTS.name * nf + WEIGHTS.kind * kf + WEIGHTS.corroboration * cf;
  let d = WEIGHTS.name + WEIGHTS.kind + WEIGHTS.corroboration;
  if (yf != null) { n += WEIGHTS.year * yf; d += WEIGHTS.year; }
  if (pf != null) { n += WEIGHTS.publisher * pf; d += WEIGHTS.publisher; }

  const score = Math.round(Math.max(0, Math.min(1, n / d)) * 100) / 100;
  if (score !== r.score) {
    r.scoreBefore = r.score;
    r.score = score;
    changed += 1;
  }

  if (r.verdict === 'PROPOSED') {
    r.siblingRisk = siblingRisk(r.name, r.bggName);
    if (r.siblingRisk) flagged += 1;
  }
}

writeFileSync(`${DIR}/audit.json`, JSON.stringify(rows, null, 1), 'utf8');

// Rewrite the TSV with the corrected score and the new column.
const header = [
  'our_id', 'our_name', 'kind', 'owned', 'current_bgg_id', 'verdict', 'proposed_bgg_id',
  'bgg_name', 'bgg_year', 'bgg_publisher', 'bgg_type', 'our_year', 'our_publisher',
  'score', 'score_components', 'evidence_url', 'note', 'near_miss_rejected', 'sibling_risk',
];
const clean = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());
const lines = [header.join('\t')];
for (const r of rows) {
  const idForUrl = r.proposedId || r.currentBggId;
  lines.push([
    r.id, r.name, r.kind, r.owned ? 'yes' : 'no', r.currentBggId ?? '',
    r.verdict, r.proposedId ?? '',
    r.bggName ?? '', r.bggYear ?? '', r.bggPublisher ?? '', r.bggType ?? '',
    r.ourYear ?? '', r.ourPublisher ?? '',
    r.verdict === 'CONFIRMED' || r.verdict === 'PROPOSED' ? r.score : '',
    (r.components ?? []).join('; '),
    idForUrl ? `https://boardgamegeek.com/boardgame/${idForUrl}` : '',
    r.note ?? '', r.nearMiss ?? '', r.siblingRisk ?? '',
  ].map(clean).join('\t'));
}
writeFileSync(`${DIR}/audit.tsv`, lines.join('\n'), 'utf8');
console.log(`rescored: ${changed} scores changed, ${flagged} sibling-risk flags`);
