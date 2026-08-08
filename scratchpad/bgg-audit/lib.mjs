/**
 * Shared helpers for the read-only BGG audit (2026-08-08).
 *
 * READ ONLY. Nothing in here writes to D1 or to BoardGameGeek.
 *
 * Deliberately mirrors packages/bgg/src/client.ts (same serialising queue, same
 * 1.1s gap, same 202 retry, same 20-id /thing ceiling) rather than hand-rolling
 * a faster client, and packages/core/src/{vision,barcode}.ts for the string
 * comparisons, so the scores here are reproducible against the shipped code.
 */
import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Token — read from apps/worker/.dev.vars. NEVER printed.
// ---------------------------------------------------------------------------
export function readToken(devVarsPath) {
  const text = readFileSync(devVarsPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'BGG_API_TOKEN') continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error('BGG_API_TOKEN not found in .dev.vars');
}

// ---------------------------------------------------------------------------
// BGG client — a port of packages/bgg/src/client.ts
// ---------------------------------------------------------------------------
const BASE = 'https://boardgamegeek.com/xmlapi2';
/**
 * The shipped client uses 1100ms and gets away with it because every call goes
 * through Cloudflare's edge cache with a 7-day TTL. An 800-call uncached audit
 * does not: BGG started answering 429 about ninety seconds in.
 *
 * So the gap is adaptive — it starts near the shipped value, climbs hard on a
 * 429, and decays back down after a run of clean calls. BGG's own wiki suggests
 * ~5s, which is the ceiling here.
 */
const MIN_GAP_FLOOR_MS = 1600;
const MIN_GAP_CEILING_MS = 6000;
let currentGap = 2200;
let cleanRun = 0;
const MAX_202_RETRIES = 4;
const MAX_429_RETRIES = 6;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'name', 'link'].includes(name),
});

let queue = Promise.resolve();
let lastCall = 0;
export const stats = {
  calls: 0,
  retries202: 0,
  retries429: 0,
  errors: 0,
  hardFailures: 0,
  startedAt: Date.now(),
  get gap() {
    return currentGap;
  },
};

function schedule(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, currentGap - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export class BggError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function get(path, token) {
  if (!token) throw new BggError('No BGG token', 503);
  return schedule(async () => {
    let soft = 0; // 202s
    let limited = 0; // 429s
    let net = 0; // transport failures

    while (soft <= MAX_202_RETRIES && limited <= MAX_429_RETRIES && net <= 3) {
      stats.calls += 1;
      let res;
      try {
        res = await fetch(`${BASE}${path}`, {
          headers: {
            Accept: 'application/xml',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'board-game-catalog/0.1 (read-only audit)',
          },
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        stats.errors += 1;
        net += 1;
        await new Promise((r) => setTimeout(r, 3000 * net));
        continue;
      }

      if (res.status === 202) {
        stats.retries202 += 1;
        soft += 1;
        await new Promise((r) => setTimeout(r, 1500 * soft));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new BggError('BGG rejected the API token', 502);
      }
      if (res.status === 429) {
        /*
         * A 429 must never reach the caller as "no results" — that would put a
         * false UNMATCHED in the map with no way to tell it from a real one.
         * Widen the gap for every subsequent call, sleep out the window, retry.
         */
        stats.retries429 += 1;
        limited += 1;
        cleanRun = 0;
        currentGap = Math.min(MIN_GAP_CEILING_MS, Math.round(currentGap * 1.4));
        await new Promise((r) => setTimeout(r, 15_000 * limited));
        continue;
      }
      if (!res.ok) throw new BggError(`BGG returned ${res.status}`, res.status);

      const text = await res.text();
      if (!text.trim()) throw new BggError('BGG returned an empty response', 502);

      // Earn the gap back slowly after a clean run.
      cleanRun += 1;
      if (cleanRun >= 40 && currentGap > MIN_GAP_FLOOR_MS) {
        currentGap = Math.max(MIN_GAP_FLOOR_MS, Math.round(currentGap * 0.9));
        cleanRun = 0;
      }
      return parser.parse(text);
    }
    stats.hardFailures += 1;
    throw new BggError(
      limited > MAX_429_RETRIES ? 'BGG rate limit not cleared after 6 retries' : 'BGG request failed',
      limited > MAX_429_RETRIES ? 429 : 504,
    );
  });
}

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const attr = (node, name) => {
  const v = node?.[`@${name}`];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
};
const numAttr = (node, name) => {
  const raw = attr(node, name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function primaryName(node) {
  const names = asArray(node['name']);
  const primary = names.find((n) => attr(n, 'type') === 'primary') ?? names[0];
  return attr(primary, 'value') ?? '';
}

function alternateNames(node) {
  return asArray(node['name'])
    .filter((n) => attr(n, 'type') === 'alternate')
    .map((n) => decodeEntities(attr(n, 'value') ?? ''))
    .filter((v) => v !== '');
}

function linksOfType(node, type) {
  return asArray(node['link'])
    .filter((l) => attr(l, 'type') === type)
    .map((l) => ({ id: Number(attr(l, 'id')), value: decodeEntities(attr(l, 'value') ?? '') }))
    .filter((l) => Number.isFinite(l.id) && l.value !== '');
}

export async function search(token, query, types = ['boardgame', 'boardgameexpansion', 'boardgameaccessory']) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ query: trimmed, type: types.join(',') });
  const doc = await get(`/search?${params}`, token);
  const items = asArray(doc?.['items']?.['item']);
  return items
    .map((item) => ({
      bggId: Number(attr(item, 'id')),
      name: decodeEntities(primaryName(item)),
      yearPublished: numAttr(item['yearpublished'], 'value'),
      type: attr(item, 'type') ?? 'boardgame',
    }))
    .filter((r) => Number.isFinite(r.bggId) && r.name !== '');
}

export const MAX_THING_IDS = 20;

/** No versions=1: this audit never needs editions and the payload is 10x smaller. */
export async function things(token, ids, withVersions = false) {
  if (ids.length === 0) return [];
  if (ids.length > MAX_THING_IDS) {
    const out = [];
    for (let i = 0; i < ids.length; i += MAX_THING_IDS) {
      out.push(...(await things(token, ids.slice(i, i + MAX_THING_IDS), withVersions)));
    }
    return out;
  }
  const params = new URLSearchParams({
    id: ids.join(','),
    ...(withVersions ? { versions: '1' } : {}),
  });
  const doc = await get(`/thing?${params}`, token);
  const items = asArray(doc?.['items']?.['item']);
  return items.map((item) => {
    const publishers = linksOfType(item, 'boardgamepublisher');
    const designers = linksOfType(item, 'boardgamedesigner');
    return {
      bggId: Number(attr(item, 'id')),
      type: attr(item, 'type') ?? 'boardgame',
      name: decodeEntities(primaryName(item)),
      alternateNames: alternateNames(item),
      yearPublished: numAttr(item['yearpublished'], 'value'),
      publisher: publishers[0]?.value ?? null,
      publisherLinks: publishers.map((p) => ({ id: p.id, name: p.value })),
      designers: designers.map((d) => d.value).join(', ') || null,
      /** Which things list THIS as their expansion/accessory, and vice versa. */
      expansionLinks: linksOfType(item, 'boardgameexpansion'),
      accessoryLinks: linksOfType(item, 'boardgameaccessory'),
      integrationLinks: linksOfType(item, 'boardgameintegration'),
      compilationLinks: linksOfType(item, 'boardgamecompilation'),
    };
  });
}

// ---------------------------------------------------------------------------
// String comparison — ports of packages/core/src/vision.ts + barcode.ts
// ---------------------------------------------------------------------------

/** packages/core/src/vision.ts normaliseTitle, verbatim. */
export function normaliseTitle(raw) {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function titleWords(s) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

/** packages/core/src/barcode.ts titleSimilarity, verbatim. */
export function titleSimilarity(candidateName, searchedFor) {
  const a = titleWords(candidateName);
  const b = titleWords(searchedFor);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

const GENERIC_TITLE_WORDS = new Set([
  'expansion',
  'expansions',
  'extension',
  'edition',
  'miniature',
  'miniatures',
  'board',
  'game',
  'the',
]);

function withoutGenerics(words) {
  const kept = new Set();
  for (const word of words) if (!GENERIC_TITLE_WORDS.has(word)) kept.add(word);
  return kept.size > 0 ? kept : words;
}

/** packages/core/src/barcode.ts isFragmentOf, verbatim. THE trap-catcher. */
export function isFragmentOf(candidateName, searchedFor) {
  const a = withoutGenerics(titleWords(candidateName));
  const b = withoutGenerics(titleWords(searchedFor));
  if (a.size === 0 || b.size === 0) return false;
  if (a.size === b.size) return false;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const word of small) if (!large.has(word)) return false;
  return true;
}

export const MIN_SPINE_SIMILARITY = 0.7;

/** packages/core/src/barcode.ts isConfidentMatch, verbatim. */
export function isConfidentMatch(candidateName, searchedFor) {
  if (isFragmentOf(candidateName, searchedFor)) return false;
  return titleSimilarity(candidateName, searchedFor) >= MIN_SPINE_SIMILARITY;
}

// ---------------------------------------------------------------------------
// Publisher comparison
// ---------------------------------------------------------------------------
const PUBLISHER_NOISE =
  /\b(games?|gaming|studios?|publishing|publisher|entertainment|group|company|co|inc|llc|ltd|limited|gmbh|sa|sarl|srl|bv|ab|as|oy|kft|sp|zoo|z\s*o\s*o|edizioni|editions?|editrice|spiele|verlag|interactive|international|productions?|press|media|works|labs?|the)\b/g;

export function normalisePublisher(raw) {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(PUBLISHER_NOISE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Does our publisher string appear anywhere in BGG's publisher list?
 * Returns 'exact' | 'partial' | 'none' | 'unknown' (we hold no publisher).
 */
export function publisherAgreement(ourPublisher, bggPublisherNames) {
  if (!ourPublisher || !ourPublisher.trim()) return 'unknown';
  if (!bggPublisherNames || bggPublisherNames.length === 0) return 'unknown';
  const ours = normalisePublisher(ourPublisher);
  if (!ours) return 'unknown';
  const theirs = bggPublisherNames.map(normalisePublisher).filter(Boolean);
  if (theirs.includes(ours)) return 'exact';
  for (const t of theirs) {
    if (!t) continue;
    if (t.includes(ours) || ours.includes(t)) return 'partial';
    // Word-overlap fallback: "Roxley" vs "Roxley Game Laboratory".
    if (titleSimilarity(t, ours) >= 0.6) return 'partial';
  }
  return 'none';
}

export function tsv(...cells) {
  return cells
    .map((c) => (c == null ? '' : String(c).replace(/[\t\r\n]+/g, ' ').trim()))
    .join('\t');
}
