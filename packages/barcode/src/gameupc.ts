import type { BarcodeCandidate, Confidence } from '@bgc/core';

/**
 * GameUPC — a crowdsourced UPC → BoardGameGeek-ID map.
 *
 * This is the one lookup service that is actually about board games, and it is
 * free. It answers with a BGG id, which is the same identifier the BGG import
 * already speaks, so a scan becomes an ordinary import rather than a parallel
 * code path.
 *
 * It is also the only rung of the ladder we can give back to: confirming a
 * candidate POSTs the choice to the shared database, so the next person to scan
 * that box gets a `verified` answer. That is the same self-healing idea as
 * writing back to `edition.barcode`, except collective.
 *
 * Caveats worth remembering: one hobbyist maintainer, and the `test` stage is
 * wiped periodically. Treat a miss as normal, not as an outage.
 */

const STAGES = {
  /** Public demo key works here. Data is wiped periodically. */
  test: 'https://api.gameupc.com/test',
  dev: 'https://api.gameupc.com/dev',
  v1: 'https://api.gameupc.com/v1',
} as const;

export type GameUpcStage = keyof typeof STAGES;

/** Published in GameUPC's own demo; fine for the `test` stage, useless for `v1`. */
export const GAMEUPC_DEMO_KEY = 'test_test_test_test_test';

export class GameUpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GameUpcConfig {
  apiKey: string;
  stage: GameUpcStage;
}

/**
 * Resolve config from the environment, falling back to the demo key against
 * `test` so the feature is exercisable before the production key arrives.
 * Returns null only when we have deliberately been switched off.
 */
export function gameUpcConfig(env: {
  GAMEUPC_API_KEY?: string;
  GAMEUPC_STAGE?: string;
}): GameUpcConfig | null {
  const stage = (env.GAMEUPC_STAGE ?? (env.GAMEUPC_API_KEY ? 'v1' : 'test')) as GameUpcStage;
  if (!(stage in STAGES)) return null;
  const apiKey = env.GAMEUPC_API_KEY ?? (stage === 'test' ? GAMEUPC_DEMO_KEY : '');
  if (!apiKey) return null;
  return { apiKey, stage };
}

interface RawVersion {
  version_id?: number;
  name?: string;
  language?: string;
  confidence?: number;
}

interface RawBggInfo {
  id?: number;
  name?: string;
  published?: number | string;
  thumbnail_url?: string;
  image_url?: string;
  page_url?: string;
  update_url?: string;
  confidence?: number;
  versions?: RawVersion[];
}

interface RawResponse {
  upc?: string;
  name?: string;
  searched_for?: string;
  bgg_info_status?: string;
  bgg_info?: RawBggInfo[];
}

export interface GameUpcResult {
  candidates: BarcodeCandidate[];
  /** Human-confirmed by the community — safe to present as the obvious answer. */
  verified: boolean;
  /** Retail title GameUPC inferred, useful even when it found no game. */
  inferredName: string | null;
  /** Per-candidate write-back endpoints, keyed by BGG id. */
  updateUrls: Record<number, string>;
}

/**
 * GameUPC reports confidence as a number whose scale is not documented. Observed
 * values run from the teens (a weak name-match guess) to the high eighties (a
 * confirmed mapping), so band it conservatively rather than pretend to precision.
 */
function bandConfidence(raw: number | undefined, verified: boolean): Confidence {
  if (verified) return 'high';
  if (typeof raw !== 'number') return 'low';
  if (raw >= 70) return 'high';
  if (raw >= 30) return 'medium';
  return 'low';
}

/** `published` comes back as a string ("1995"), so coerce before trusting it. */
function toYear(v: number | string | undefined): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 1000 ? n : null;
}

/**
 * GameUPC reports "no idea" as the literal string "None" rather than null or an
 * absent field. Verified live against four real barcodes. Passing that through
 * would put the word "None" in front of the user as a suggested title.
 */
function realName(v: string | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed === '' || trimmed === 'None' ? null : trimmed;
}

export async function lookupGameUpc(
  config: GameUpcConfig,
  barcode: string,
  opts: { search?: string; searchMode?: 'speed' | 'quality' } = {},
): Promise<GameUpcResult> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  if (opts.searchMode) params.set('search_mode', opts.searchMode);
  const qs = params.toString();

  const res = await fetch(`${STAGES[config.stage]}/upc/${encodeURIComponent(barcode)}${qs ? `?${qs}` : ''}`, {
    headers: { 'x-api-key': config.apiKey, Accept: 'application/json' },
    // Barcode→game mappings are effectively immutable; cache hard at the edge.
    cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true },
  } as RequestInit);

  // A barcode nobody has catalogued is the common case, not an error.
  if (res.status === 404) {
    return { candidates: [], verified: false, inferredName: null, updateUrls: {} };
  }
  if (res.status === 429) {
    throw new GameUpcError('GameUPC daily lookup quota reached; try again tomorrow.', 429);
  }
  if (res.status === 401 || res.status === 403) {
    throw new GameUpcError('GameUPC rejected our API key. Check GAMEUPC_API_KEY.', 502);
  }
  if (!res.ok) {
    throw new GameUpcError(`GameUPC returned ${res.status}`, 502);
  }

  const body = (await res.json()) as RawResponse;
  const verified = body.bgg_info_status === 'verified';
  const infos = Array.isArray(body.bgg_info) ? body.bgg_info : [];

  const updateUrls: Record<number, string> = {};
  const candidates: BarcodeCandidate[] = [];

  for (const info of infos) {
    if (typeof info.id !== 'number' || !info.name) continue;
    if (info.update_url) updateUrls[info.id] = info.update_url;

    // Only name a printing when there is exactly one to name. GameUPC returns
    // every version BGG knows about — Catan has 136 — and `versions[0]` is
    // whichever came back first, so showing it told a US retail scan it was the
    // "Arabic/English edition". An unnamed printing is better than a wrong one.
    const onlyVersion = info.versions?.length === 1 ? info.versions[0] : undefined;

    candidates.push({
      name: info.name,
      bggId: info.id,
      publisher: null, // GameUPC does not carry it; BGG hydration fills this in.
      yearPublished: toYear(info.published),
      // GameUPC has no kind vocabulary. Assume base and let BGG correct it.
      kind: 'base',
      editionName: onlyVersion?.name ?? null,
      thumbnailUrl: info.thumbnail_url ?? info.image_url ?? null,
      confidence: bandConfidence(info.confidence, verified && infos.length === 1),
      source: 'gameupc',
      sourceUrl: info.page_url ?? null,
      note: verified ? 'Community-verified barcode match.' : null,
    });
  }

  return {
    candidates,
    verified,
    inferredName: realName(body.name) ?? realName(body.searched_for),
    updateUrls,
  };
}

/**
 * Give a confirmed match back to the shared database.
 *
 * Deliberately best-effort: this runs after the user's own catalog write has
 * already succeeded, and GameUPC being down is not a reason to fail their scan.
 */
export async function contributeGameUpc(
  config: GameUpcConfig,
  updateUrl: string,
  userId: string,
): Promise<boolean> {
  if (userId.length < 8) return false;
  try {
    const res = await fetch(updateUrl, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
