/**
 * UPCitemdb, trial tier — no key, no signup, 100 lookups a day per IP.
 *
 * This does not know what a board game is. What it does have is broad retail
 * coverage, including hobby titles GameUPC has never seen, and it returns the
 * product *title*. That title is the bridge: feed it back to GameUPC's `search`
 * parameter and a barcode nobody has mapped can still land on a BGG id.
 *
 * The quota is per IP, and a Worker is one IP for every user, so 100/day is a
 * whole-app budget rather than a per-person one. Only call this after GameUPC
 * has already missed.
 */

export class UpcItemDbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RawItem {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  images?: string[];
}

interface RawResponse {
  code?: string;
  total?: number;
  items?: RawItem[];
}

export interface UpcItemDbResult {
  title: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  /**
   * Retail blurb. Not authoritative and often marketing copy, but for a game
   * whose box we never photographed it is better than an empty page — and it
   * frequently states the player count and playing time in prose.
   */
  description: string | null;
}

/**
 * Shelf-listing furniture. Order matters: the longer phrases go first so their
 * pieces are gone before the shorter patterns can strip half of one and leave
 * the rest stranded.
 */
const NOISE = [
  /\bages?\s*\d+\s*(?:\+|and\s+up|&\s*up)?/gi, // "Ages 10+", "Age 8 and up"
  /\bfor\s*\d+\s*(?:[-–—]\s*\d+\s*)?(?:players?|people)\b/gi, // "for 1-5 players"
  /\b\d+\s*[-–—]\s*\d+\s*(?:players?|people)\b/gi, // "1-5 Players"
  /\b\d+\s*(?:players?|people)\b/gi,
  /\b\d+\s*(?:[-–—]\s*\d+\s*)?(?:min(?:ute)?s?|hours?)\b/gi, // playtime
  /\b(?:board|card|tile|dice|family|strategy)\s+game\b/gi,
  /\bgames?\b/gi,
  /\b(?:brand\s+)?new\b|\bsealed\b|\bofficial\b|\bfactory\b/gi,
  /\b[A-Z0-9]{2,}\d{3,}\b/g, // distributor SKUs: "CN3071"
  /\b\d{5,}\b/g,
];

/** Punctuation left dangling once the words between it are gone. */
const DEBRIS: [RegExp, string][] = [
  [/\s*\(\s*\)\s*/g, ' '], // emptied parentheses
  [/\s*([,;|/&+])\s*(?=[,;|/&+])/g, ''], // runs of separators collapse to one
  [/\s+([,;.])/g, '$1'], // space before punctuation
  [/\s*([,;])\s*/g, '$1 '], // one space after a separator
];

/**
 * Retail titles are written for shelf listings, not for lookups:
 * "Asmodee CATAN Studio CN3071 Catan 5-6 Player Extension Board Game Ages 10+".
 * Strip the furniture so the leftover is a usable *search term*.
 *
 * Deliberately conservative — over-trimming loses the actual title, and the
 * caller keeps the raw string for display anyway. Returns '' when stripping ate
 * everything, which the caller reads as "no usable search term".
 *
 * Note what is NOT stripped: the brand. In this hobby the publisher's name is
 * very often the game's name — CATAN Studio makes Catan, Stonemaier makes
 * Wingspan — so removing it turned "Catan 5-6 Player Extension" into
 * "Asmodee Extension". A redundant word costs a search nothing; a missing title
 * costs it everything.
 */
export function cleanRetailTitle(title: string): string {
  let out = title;
  for (const pattern of NOISE) out = out.replace(pattern, ' ');
  for (const [pattern, replacement] of DEBRIS) out = out.replace(pattern, replacement);
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;|/&+-]+|[\s,;|/&+-]+$/g, '')
    .trim();
}

export async function lookupUpcItemDb(barcode: string): Promise<UpcItemDbResult | null> {
  const res = await fetch(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
    {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 60 * 60 * 24 * 30, cacheEverything: true },
    } as RequestInit,
  );

  if (res.status === 404) return null;
  if (res.status === 429) {
    throw new UpcItemDbError(
      'UPCitemdb daily quota reached (100/day, shared across the whole app).',
      429,
    );
  }
  if (!res.ok) throw new UpcItemDbError(`UPCitemdb returned ${res.status}`, 502);

  const body = (await res.json()) as RawResponse;
  // Their errors arrive with HTTP 200 and a code in the body.
  if (body.code && body.code !== 'OK') {
    if (body.code === 'EXCEED_LIMIT') {
      throw new UpcItemDbError('UPCitemdb daily quota reached.', 429);
    }
    return null;
  }

  const item = body.items?.[0];
  if (!item?.title) return null;

  return {
    title: item.title,
    brand: item.brand ?? null,
    category: item.category ?? null,
    description: item.description ?? null,
    imageUrl: item.images?.[0] ?? null,
  };
}
