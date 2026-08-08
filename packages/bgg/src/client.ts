import { XMLParser } from 'fast-xml-parser';

/**
 * BoardGameGeek XML API2 client.
 *
 * Free, no key, and rate-limited enough that every call goes through a
 * serialising queue with a minimum gap. BGG also answers `202 Accepted` to mean
 * "queued, ask again shortly" rather than "done", so a naive fetch gets an empty
 * body and looks like a miss.
 *
 * There is no DOM in Workers, so parsing is fast-xml-parser rather than
 * DOMParser.
 */

const BASE = 'https://boardgamegeek.com/xmlapi2';

/** BGG asks for roughly one request a second; be a good citizen. */
const MIN_GAP_MS = 1100;
const MAX_202_RETRIES = 4;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'name', 'link'].includes(name),
});

/** Serialises requests within this isolate and keeps them a beat apart. */
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // Keep the chain alive even when a call rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

export class BggError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get(path: string, token: string): Promise<unknown> {
  if (!token) {
    throw new BggError(
      'No BoardGameGeek API token configured. BGG required registration and bearer tokens ' +
        'from July 2025 — see docs/SETUP.md.',
      503,
    );
  }

  return schedule(async () => {
    for (let attempt = 0; attempt <= MAX_202_RETRIES; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Accept: 'application/xml',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'board-game-catalog/0.1',
        },
        // Cloudflare edge cache — BGG data barely changes, and this keeps us
        // well inside their rate limit without needing a KV namespace.
        cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true },
      } as RequestInit);

      if (res.status === 202) {
        // Queued on BGG's side. Back off and ask again.
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new BggError(
          'BoardGameGeek rejected our API token. Check BGG_API_TOKEN is set and still valid.',
          502,
        );
      }
      if (res.status === 429) {
        throw new BggError('BoardGameGeek is rate-limiting us; try again shortly', 429);
      }
      if (!res.ok) {
        throw new BggError(`BoardGameGeek returned ${res.status}`, 502);
      }

      const text = await res.text();
      if (!text.trim()) {
        throw new BggError('BoardGameGeek returned an empty response', 502);
      }
      return parser.parse(text);
    }
    throw new BggError('BoardGameGeek kept the request queued; try again shortly', 504);
  });
}

// ---------------------------------------------------------------------------
// Shapes we care about
// ---------------------------------------------------------------------------

export type BggType = 'boardgame' | 'boardgameexpansion' | 'boardgameaccessory';

export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
  type: BggType;
}

export interface BggEdition {
  bggVersionId: number;
  name: string | null;
  year: number | null;
  publisher: string | null;
  language: string | null;
  imageUrl: string | null;
}

export interface BggThing {
  bggId: number;
  type: BggType;
  name: string;
  /**
   * Every other name BGG lists for this game — see `alternateNames`. Feeds
   * `item_alias`, which is how a rescan reading "The Settlers of Catan" finds
   * the "Catan" already on the shelf.
   */
  alternateNames: string[];
  yearPublished: number | null;
  description: string | null;
  thumbnailUrl: string | null;
  publisher: string | null;
  /**
   * Every publisher BoardGameGeek links, with its id.
   *
   * `publisher` above is the first name and is what the catalog stores for
   * display. This is the whole set, and the ids are what the official /
   * third-party split compares — a linked entity id cannot drift the way
   * "Rebel Sp. z o.o." can. Most things carry several: the original publisher
   * plus every localisation house.
   */
  publisherLinks: { id: number; name: string }[];
  designers: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  weight: number | null;
  editions: BggEdition[];
  /** Expansions and accessories BGG links to this game. */
  related: { bggId: number; name: string; type: 'expansion' | 'accessory' }[];
}

// ---------------------------------------------------------------------------
// Parsing helpers — the XML is loose, so every read is defensive.
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
const attr = (node: unknown, name: string): string | null => {
  const v = (node as Node | null)?.[`@${name}`];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
};
const numAttr = (node: unknown, name: string): number | null => {
  const raw = attr(node, name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** BGG returns several <name> nodes; the primary one is the title. */
function primaryName(node: Node): string {
  const names = asArray<Node>(node['name']);
  const primary = names.find((n) => attr(n, 'type') === 'primary') ?? names[0];
  return attr(primary, 'value') ?? '';
}

/**
 * The names that are not the title — localisations, reissues, former titles.
 *
 * These were parsed and thrown away for months, and they are the answer to
 * *"Settlers of Catan and Catan are the same game"*: BGG 13's primary name is
 * **Catan** and its alternates include **The Settlers of Catan**, **Die Siedler
 * von Catan** and sixty more. BoardGameGeek already models the thing the catalog
 * needed a model for, so `item_alias` imports it rather than inventing one.
 *
 * Returned verbatim and unfiltered. Deciding which of them are safe to match on
 * is a question about *this* catalog — whether another game already answers to
 * that string — and it is answered in `buildTitleIndex`, which is the only place
 * that can see both sides.
 */
function alternateNames(node: Node): string[] {
  return asArray<Node>(node['name'])
    .filter((n) => attr(n, 'type') === 'alternate')
    .map((n) => decodeEntities(attr(n, 'value') ?? ''))
    .filter((v) => v !== '');
}

function linksOfType(node: Node, type: string): { id: number; value: string }[] {
  return asArray<Node>(node['link'])
    .filter((l) => attr(l, 'type') === type)
    .map((l) => ({ id: Number(attr(l, 'id')), value: attr(l, 'value') ?? '' }))
    .filter((l) => Number.isFinite(l.id) && l.value !== '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function search(
  token: string,
  query: string,
  types: BggType[] = ['boardgame', 'boardgameexpansion', 'boardgameaccessory'],
): Promise<BggSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ query: trimmed, type: types.join(',') });
  const doc = (await get(`/search?${params}`, token)) as Node;
  const items = asArray<Node>((doc['items'] as Node | undefined)?.['item']);

  return items
    .map((item) => ({
      bggId: Number(attr(item, 'id')),
      name: decodeEntities(primaryName(item)),
      yearPublished: numAttr(item['yearpublished'], 'value'),
      type: (attr(item, 'type') ?? 'boardgame') as BggType,
    }))
    .filter((r) => Number.isFinite(r.bggId) && r.name !== '');
}

/**
 * Ids BoardGameGeek will accept in one `/thing` call.
 *
 * **Twenty is a hard ceiling, not a guideline.** Measured 2026-08-05: a request
 * for 36 ids answered `400 Bad Request` outright — no partial result, no
 * warning, just a failed call that a caller batching "about twenty" would read
 * as BGG being down. Exported so every batching caller uses the same number.
 */
export const MAX_THING_IDS = 20;

/**
 * Fetch things by id, chunking at the ceiling above.
 *
 * The chunking is here rather than left to callers because the failure it
 * prevents is silent at every call site: `hydrateFromBgg` passes however many
 * candidates a barcode search produced, and GameUPC has returned 101 for one
 * search. That call answered 400, the `catch` treated it as a BGG outage, and
 * every candidate went un-hydrated with no error anywhere.
 *
 * Callers that care about the *number of requests* — anything running inside a
 * Worker's subrequest budget — should still batch explicitly with
 * `MAX_THING_IDS` so their arithmetic stays visible.
 */
export async function things(
  token: string,
  ids: number[],
  withVersions = true,
): Promise<BggThing[]> {
  if (ids.length === 0) return [];
  if (ids.length > MAX_THING_IDS) {
    const out: BggThing[] = [];
    for (let i = 0; i < ids.length; i += MAX_THING_IDS) {
      out.push(...(await things(token, ids.slice(i, i + MAX_THING_IDS), withVersions)));
    }
    return out;
  }

  const params = new URLSearchParams({
    id: ids.join(','),
    stats: '1',
    ...(withVersions ? { versions: '1' } : {}),
  });
  const doc = (await get(`/thing?${params}`, token)) as Node;
  const items = asArray<Node>((doc['items'] as Node | undefined)?.['item']);

  return items.map((item): BggThing => {
    const stats = (item['statistics'] as Node | undefined)?.['ratings'] as Node | undefined;
    const publishers = linksOfType(item, 'boardgamepublisher');
    const designers = linksOfType(item, 'boardgamedesigner');

    const versionItems = asArray<Node>((item['versions'] as Node | undefined)?.['item']);
    const editions: BggEdition[] = versionItems.map((v) => {
      const vPublishers = linksOfType(v, 'boardgamepublisher');
      const vLanguages = linksOfType(v, 'language');
      return {
        bggVersionId: Number(attr(v, 'id')),
        name: decodeEntities(primaryName(v)) || null,
        year: numAttr(v['yearpublished'], 'value'),
        publisher: vPublishers[0]?.value ?? null,
        language: vLanguages[0]?.value ?? null,
        imageUrl: typeof v['thumbnail'] === 'string' ? (v['thumbnail'] as string) : null,
      };
    });

    const related = [
      ...linksOfType(item, 'boardgameexpansion').map((l) => ({
        bggId: l.id,
        name: decodeEntities(l.value),
        type: 'expansion' as const,
      })),
      ...linksOfType(item, 'boardgameaccessory').map((l) => ({
        bggId: l.id,
        name: decodeEntities(l.value),
        type: 'accessory' as const,
      })),
    ];

    const rawDescription = item['description'];

    return {
      bggId: Number(attr(item, 'id')),
      type: (attr(item, 'type') ?? 'boardgame') as BggType,
      name: decodeEntities(primaryName(item)),
      alternateNames: alternateNames(item),
      yearPublished: numAttr(item['yearpublished'], 'value'),
      description:
        typeof rawDescription === 'string'
          ? decodeEntities(rawDescription).replace(/<br\s*\/?>/gi, '\n').slice(0, 4000)
          : null,
      thumbnailUrl: typeof item['thumbnail'] === 'string' ? (item['thumbnail'] as string) : null,
      publisher: publishers[0]?.value ?? null,
      publisherLinks: publishers.map((p) => ({ id: p.id, name: decodeEntities(p.value) })),
      designers: designers.map((d) => d.value).join(', ') || null,
      minPlayers: numAttr(item['minplayers'], 'value'),
      maxPlayers: numAttr(item['maxplayers'], 'value'),
      playtimeMin: numAttr(item['playingtime'], 'value'),
      weight: stats ? numAttr(stats['averageweight'], 'value') : null,
      editions,
      related,
    };
  });
}

export async function thing(token: string, id: number): Promise<BggThing | null> {
  const [first] = await things(token, [id]);
  return first ?? null;
}

/** BGG's own type vocabulary mapped onto ours. */
export function kindForBggType(type: BggType): 'base' | 'expansion' | 'accessory' {
  if (type === 'boardgameexpansion') return 'expansion';
  if (type === 'boardgameaccessory') return 'accessory';
  return 'base';
}
