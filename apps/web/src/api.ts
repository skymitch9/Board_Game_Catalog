import type {
  AppUser,
  BarcodeCandidate,
  ComponentBackfillRun,
  CoverCandidates,
  GameCompleteness,
  CoverCheckRun,
  CoverHealth,
  EditionBackfillRun,
  ShelfMatch,
  Copy,
  CreateCopyInput,
  CreateItemInput,
  CreateRelationInput,
  DetailsRun,
  HealthResponse,
  Item,
  ItemDetail,
  ItemPage,
  ItemQuery,
  MeResponse,
  Rating,
  RelatedItemRef,
  UpdateCopyInput,
  UpdateItemInput,
  UpsertRatingInput,
  WishlistEntry,
} from '@bgc/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }

  /** Zod issues come back as an array; flatten them for display. */
  get detail(): string {
    const b = this.body as { detail?: unknown; error?: string } | null;
    if (!b) return `Request failed (${this.status})`;
    if (typeof b.detail === 'string') return b.detail;
    if (Array.isArray(b.detail)) {
      return b.detail
        .map((i: { path?: (string | number)[]; message?: string }) =>
          i.path?.length ? `${i.path.join('.')}: ${i.message}` : (i.message ?? ''),
        )
        .join('; ');
    }
    return b.error ?? `Request failed (${this.status})`;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const send = (method: string) => (path: string, data?: unknown) =>
  req(path, { method, body: data === undefined ? undefined : JSON.stringify(data) });

const post = send('POST');
const patch = send('PATCH');
const put = send('PUT');
const del = send('DELETE');

export interface CollectionStats {
  baseGames: number;
  expansions: number;
  accessories: number;
  totalItems: number;
  ownedCopies: number;
  wantedCopies: number;
  /** Items we hold more than one of. */
  duplicatedItems: number;
  /** Licences rather than objects. */
  digitalCopies: number;
}

/** One ruleset in use, and how many items need it. */
export interface GameSystemCount {
  name: string;
  items: number;
}

function toQueryString(query: ItemQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => req<HealthResponse>('/api/health'),
  me: () => req<MeResponse>('/api/me'),

  meta: () =>
    req<{ stats: CollectionStats; gameSystems: GameSystemCount[] }>('/api/meta'),

  /**
   * One page of game trees. `total` is every match, not the page — see ItemPage.
   *
   * The page size is the server's, so there is no way to ask for all 107 groups
   * at once; anything that needs every item wants a different endpoint.
   */
  items: (query: ItemQuery = {}) => req<ItemPage>(`/api/items${toQueryString(query)}`),

  /**
   * Every item's id, name and kind. The list `items()` cannot give you.
   *
   * Matching read spine text against the collection needs all of it — a paged
   * browse would match against the first page and call everything else new.
   */
  itemNames: () =>
    req<{ items: { id: number; name: string; kind: string }[] }>('/api/item-names'),
  item: (id: number) => req<{ item: ItemDetail }>(`/api/items/${id}`),

  /**
   * Only the copies marked `wanted` — item-level, not tree-level.
   *
   * `items({ status: 'wanted' })` answers a different question: which *games*
   * have something wanted anywhere in them. Both are right; only this one is a
   * shopping list.
   */
  wishlist: () => req<{ entries: WishlistEntry[] }>('/api/wishlist'),

  createItem: (data: CreateItemInput) =>
    post('/api/items', data) as Promise<{ item: Item; adopted: Item[] }>,
  updateItem: (id: number, data: UpdateItemInput) =>
    patch(`/api/items/${id}`, data) as Promise<{ item: Item }>,
  deleteItem: (id: number) => del(`/api/items/${id}`) as Promise<{ deleted: boolean }>,

  createCopy: (itemId: number, data: CreateCopyInput) =>
    post(`/api/items/${itemId}/copies`, data) as Promise<{ copy: Copy }>,
  updateCopy: (id: number, data: UpdateCopyInput) =>
    patch(`/api/copies/${id}`, data) as Promise<{ copy: Copy }>,
  deleteCopy: (id: number) => del(`/api/copies/${id}`) as Promise<{ deleted: boolean }>,

  users: () => req<{ users: AppUser[] }>('/api/users'),

  // --- Cover images ---------------------------------------------------------
  // Read a stored verdict; never probe on render. The covers are hotlinked from
  // other people's CDNs and there are hundreds of them.

  coverHealth: () => req<{ health: CoverHealth }>('/api/covers/health'),

  /** Force a slice now instead of waiting for the half-hourly cron. */
  checkCovers: (limit?: number) =>
    post(`/api/covers/check${limit ? `?limit=${limit}` : ''}`, {}) as Promise<{
      run: CoverCheckRun;
      health: CoverHealth;
    }>,

  // --- Printings and their covers -------------------------------------------
  // An item has several known printings, each with a cover, and one of them
  // represents our copy. Choosing is an ordinary item PATCH — see `updateItem`.

  /** Every cover this item could wear, deduplicated, selected one first. */
  covers: (itemId: number) => req<CoverCandidates>(`/api/items/${itemId}/covers`),

  /**
   * Fetch printings from BoardGameGeek. Idempotent, and meant to be re-run as
   * items gain a `bggId`. Pass an itemId to ask about one game only.
   */
  backfillEditions: (opts: { itemId?: number; limit?: number; force?: boolean } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return post(`/api/editions/backfill${qs ? `?${qs}` : ''}`, {}) as Promise<{
      run: EditionBackfillRun;
    }>;
  },

  // --- What am I missing ----------------------------------------------------
  // Read a cached answer; never look it up live. A BoardGameGeek call is ~1.1s
  // and the lists barely change — the weekly cron is what keeps them current.

  /** Official expansions and accessories that exist, versus what we hold. */
  completeness: (itemId: number) =>
    req<GameCompleteness>(`/api/items/${itemId}/completeness`),

  /**
   * Ask BoardGameGeek what exists. Idempotent, budgeted, meant to be re-run.
   *
   * Pass an itemId to check one game now instead of waiting for Monday.
   */
  backfillComponents: (opts: { itemId?: number; calls?: number; force?: boolean } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return post(`/api/components/backfill${qs ? `?${qs}` : ''}`, {}) as Promise<{
      run: ComponentBackfillRun;
    }>;
  },

  /** Record every crowdfunding cover as a printing, so swapping away keeps it. */
  recordCampaignCovers: () =>
    post('/api/editions/campaign', {}) as Promise<{
      run: { considered: number; added: number };
    }>,

  /** Fill a form from a title. Free rungs only, cached, no model call. */
  lookup: (q: string) =>
    req<{ candidates: BarcodeCandidate[]; cached: boolean }>(
      `/api/lookup?q=${encodeURIComponent(q)}`,
    ),

  cache: () => req<{ stats: CacheStats }>('/api/cache'),
  clearCache: (target: 'all' | 'lookups' = 'all') =>
    del(`/api/cache?target=${target}`) as Promise<{ removed: number; stats: CacheStats }>,
  setRole: (userId: number, role: AppUser['role']) =>
    patch(`/api/users/${userId}/role`, { role }) as Promise<{ user: AppUser }>,

  rate: (itemId: number, data: UpsertRatingInput) =>
    put(`/api/items/${itemId}/rating`, data) as Promise<{ rating: Rating }>,
  unrate: (itemId: number) => del(`/api/items/${itemId}/rating`) as Promise<{ deleted: boolean }>,

  // --- Relations ------------------------------------------------------------

  addRelation: (itemId: number, data: CreateRelationInput) =>
    post(`/api/items/${itemId}/relations`, data) as Promise<{ relation: { id: number } }>,
  removeRelation: (relationId: number) =>
    del(`/api/relations/${relationId}`) as Promise<{ deleted: boolean }>,

  // --- Scanning -------------------------------------------------------------
  // The free rungs first; the paid ones are separate calls the user asks for.

  /** Local table, then GameUPC, then UPCitemdb. Fast and free. */
  barcode: (code: string) => req<BarcodeLookup>(`/api/barcode/${encodeURIComponent(code)}`),

  /** The slow rung: Claude with web search. 1-2 minutes — warn before calling. */
  identifyBarcode: (barcode: string) =>
    post('/api/barcode/identify', { barcode }) as Promise<{
      barcode: string;
      candidates: BarcodeCandidate[];
      usage: ResearchUsage;
    }>,

  /**
   * Attach a barcode to an item — the write that makes the *next* scan of that
   * box instant and offline. Also the point at which the match can be given
   * back to GameUPC: pass `contribute` when there was no `updateUrl` to hand,
   * which is the case for a code nobody had catalogued.
   */
  linkBarcode: (data: {
    itemId: number;
    barcode: string;
    editionId?: number | null;
    editionName?: string | null;
    bggId?: number | null;
    updateUrl?: string | null;
    contribute?: boolean;
    name?: string | null;
  }) => post('/api/barcode/link', data) as Promise<{ barcode: string; contributed: boolean }>,

  /** One box, read from a photo. ~3-5s, no web search. */
  identifyPhoto: (photo: { data: string; mediaType: string }) =>
    post('/api/vision/identify', photo) as Promise<{
      candidates: BarcodeCandidate[];
      unreadable: boolean;
      usage: ResearchUsage;
    }>,

  /** A shelf of spines, matched against the collection and GameUPC. */
  readShelf: (photo: { data: string; mediaType: string }) =>
    post('/api/vision/shelf', photo) as Promise<{
      matches: ShelfMatch[];
      unreadable: boolean;
      usage: ResearchUsage;
    }>,

  retagSuggestions: () => req<{ suggestions: RetagSuggestion[] }>('/api/retag'),

  // --- Filling in missing details -------------------------------------------

  needsDetails: () =>
    req<{ items: NeedsDetails[]; centsEach: { low: number; high: number } }>(
      '/api/research/needs-details',
    ),

  /**
   * Start a lookup. Returns as soon as the run exists, not when it finishes.
   *
   * The work happens on the server under `waitUntil`, so this resolving means
   * "it is running", never "it is done" — poll `detailsRuns()` for the outcome.
   * `alreadyRunning` says the server handed back a run that was already in
   * flight rather than starting a second one.
   */
  startItemDetails: (id: number) =>
    post(`/api/research/${id}/details`, {}) as Promise<{
      run: DetailsRun;
      alreadyRunning: boolean;
    }>,

  /** The latest run for every game that has been looked up. */
  detailsRuns: () => req<{ runs: DetailsRun[] }>('/api/research/details-runs'),

  // --- Scan Jobs (photo queue) ----------------------------------------------

  scanJobs: (status?: string) =>
    req<{ jobs: ScanJob[] }>(`/api/scan-jobs${status ? `?status=${status}` : ''}`),

  scanJob: (id: number) => req<{ job: ScanJob }>(`/api/scan-jobs/${id}`),

  createScanJob: (data: { data: string; mediaType: string; mode: 'shelf' | 'single' }) =>
    post('/api/scan-jobs', data) as Promise<{ job: ScanJob }>,

  /**
   * Put one scanned barcode on the queue.
   *
   * Pass the `jobId` the previous scan returned and a stack of boxes becomes a
   * single job with one line each; omit it and a new batch opens. `duplicate`
   * comes back true when the code was already on that job, which is the server
   * refusing to turn one box left in front of the camera into five entries.
   */
  scanBarcodeToQueue: (barcode: string, jobId?: number | null) =>
    post('/api/scan-jobs/barcode', { barcode, jobId: jobId ?? null }) as Promise<{
      job: ScanJob;
      index: number;
      title: EnrichedTitle;
      duplicate: boolean;
    }>,

  /**
   * Look up the next chunk of a photo's titles.
   *
   * Not "start enrichment" — enrichment is bounded per invocation, so this is
   * called repeatedly until the job reaches `review`. Also the retry: it
   * accepts any job that is not finished, including one whose invocation was
   * killed partway.
   */
  enrichScanJob: (id: number) =>
    post(`/api/scan-jobs/${id}/enrich`, {}) as Promise<{ job: ScanJob; running: boolean }>,

  /** Stop a job, keeping the titles it read. Distinct from deleting the row. */
  cancelScanJob: (id: number) =>
    post(`/api/scan-jobs/${id}/cancel`, {}) as Promise<{ job: ScanJob }>,

  completeScanJob: (id: number) =>
    post(`/api/scan-jobs/${id}/done`, {}) as Promise<{ job: ScanJob }>,

  /** Record per-title outcomes without finishing the job. */
  updateScanJobTitles: (
    id: number,
    updates: { index: number; addedItemId?: number | null; dismissed?: boolean }[],
  ) =>
    post(`/api/scan-jobs/${id}/titles`, { updates }) as Promise<{
      job: ScanJob;
      outstanding: number;
    }>,

  /** Ask again about one title, optionally with corrected text. */
  relookupScanJobTitle: (id: number, index: number, q?: string) =>
    post(
      `/api/scan-jobs/${id}/titles/${index}/relookup${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      {},
    ) as Promise<{ job: ScanJob; title: EnrichedTitle; found: boolean }>,

  deleteScanJob: (id: number) =>
    del(`/api/scan-jobs/${id}`) as Promise<{ deleted: boolean }>,
};

export interface RetagSuggestion {
  itemId: number;
  name: string;
  currentKind: string;
  proposedParentId: number;
  proposedParentName: string;
  confident: boolean;
  reason: string;
}

export interface NeedsDetails {
  id: number;
  name: string;
  kind: string;
  /** Human-readable field names, for showing what a run would add. */
  missing: string[];
}

export interface CacheStats {
  titles: number;
  barcodes: number;
  oldest: string | null;
}

export interface ScanJob {
  id: number;
  status: 'uploaded' | 'reading' | 'read' | 'enriching' | 'review' | 'done' | 'failed';
  mode: 'shelf' | 'single' | 'barcode';
  photoKey: string;
  rawTitles: string | null;
  enriched: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
}

export interface EnrichedTitle {
  title: string;
  confidence: 'high' | 'medium' | 'low';
  position: number;
  alreadyOwned: boolean;
  existingItemId: number | null;
  existingName: string | null;
  bggId: number | null;
  resolvedName: string | null;
  thumbnailUrl: string | null;
  publisher: string | null;
  yearPublished: number | null;
  /** How well `resolvedName` matches what was read, 0..1. Null if unresolved. */
  similarity: number | null;
  proposedKind: string | null;
  proposedParentId: number | null;
  proposedParentName: string | null;
  /** Base game implied by the title but absent from the collection. */
  inferredParentName: string | null;
  reason: string | null;
  /** The item this became, once added. Survives so the job can be revisited. */
  addedItemId?: number | null;
  /** Deliberately not wanted — distinct from simply not dealt with yet. */
  dismissed?: boolean;
  /** Set when a retry searched with corrected text rather than what was read. */
  relookedUpAs?: string | null;

  // --- Only ever set on a barcode-sourced row -------------------------------

  /** The code that was scanned. Absent on anything that came from a photo. */
  barcode?: string | null;
  /** The lookup services could not be reached — not the same as knowing nothing. */
  lookupFailed?: boolean;
  /** How many we hold, when the code is already on something in the collection. */
  ownedQuantity?: number | null;
  /** GameUPC's write-back endpoint, so confirming the match can be given back. */
  updateUrl?: string | null;
  /** Plausible but unconfirmed: shown, and left unticked for a human to judge. */
  needsConfirmation?: boolean;
}

export interface ResearchUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCents: number;
}

export interface BarcodeLookup {
  barcode: string;
  /** True when this barcode is already attached to something we own. */
  owned: boolean;
  match: { item: Item; editionId: number; editionName: string | null } | null;
  candidates: BarcodeCandidate[];
  verified: boolean;
  inferredName?: string | null;
  updateUrls?: Record<number, string>;
  trace: { source: string; outcome: string }[];
  /** Every free rung missed — the paid one is the only thing left to try. */
  exhausted: boolean;
}
