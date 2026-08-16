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
  GroupAxis,
  HealthResponse,
  Item,
  ItemAliasRef,
  ItemDetail,
  ItemPage,
  ItemQuery,
  MeResponse,
  PreorderArrival,
  Rating,
  RelatedItemRef,
  UpdateCopyInput,
  UpdateItemInput,
  UpsertRatingInput,
  WishlistEntry,
} from '@bgc/core';
import { getIdToken } from './lib/firebase';
import { describeApiError } from './lib/errors';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }

  /**
   * The sentence `ErrorBox` (and the handful of call sites that read this
   * directly) show a person. Was: zod issues flattened, else the server's raw
   * error code, else a bare `Request failed (403)` — exactly the "bare HTTP
   * status" `docs/info/ROLES.md` §1e (audiobook_catalog) says nobody may see.
   * `describeApiError` (lib/errors.ts) is now the one place that decides.
   */
  get detail(): string {
    return describeApiError(this.status, this.body);
  }
}

/**
 * The human sentence for anything a `catch` block might see — an `ApiError`,
 * a `TypeError` from `fetch` itself (offline, a dropped connection, CORS —
 * never a permission failure, `docs/info/ROLES.md` §1e is explicit on that),
 * or an ordinary `Error`. `ErrorBox` (`components/ui.tsx`) is built on this;
 * the few call sites that show an error outside `ErrorBox` should be too,
 * rather than re-deriving the same ternary.
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Every call carries a Firebase ID token.
 *
 * Until 2026-08-10 this sent no credentials at all: Cloudflare Access attached
 * a cookie before the request ever reached the Worker, so the browser
 * authenticated without the app's help. The Worker verifies a bearer token now,
 * which makes this the one place that knows how a request is authenticated.
 *
 * ⚠️ On a 401 the token is refreshed **once** and the request retried **once**.
 * A token expiring mid-session is ordinary and making somebody sign in again
 * for it would be the worst possible response — but retrying twice is a loop,
 * so a second 401 surfaces as an error and `App.tsx` shows the sign-in screen.
 */
async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await getIdToken(retried);
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401 && !retried) return req<T>(path, init, true);

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
  /** Wishlist rows — the same thing `/wishlist` counts, so the two agree. */
  wantedEntries: number;
  /** Paid for and on its way. Deliberately not folded into `wantedEntries`. */
  preorderedEntries: number;
  /** Items we hold more than one of. */
  duplicatedItems: number;
  /** Licences rather than objects. */
  digitalCopies: number;
}

/**
 * One series or one ruleset in use — the two things the collection page can
 * fold into a single entry and filter by.
 */
export interface GroupOption {
  axis: GroupAxis;
  name: string;
  /** Rows carrying it: 147 for Dice Throne, 79 for D&D 5e (2014). */
  items: number;
  /** Top-level lines those rows sit in: 11 and 9. */
  lines: number;
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

  meta: () => req<{ stats: CollectionStats; groups: GroupOption[] }>('/api/meta'),

  /**
   * One page of the collection. `total` is every match, not the page.
   *
   * Entries are game trees and, with `grouped`, whole series and rulesets folded
   * into one. The page size is the server's, so there is no way to ask for all
   * of it at once; anything that needs every item wants a different endpoint.
   */
  items: (query: ItemQuery = {}) => req<ItemPage>(`/api/items${toQueryString(query)}`),

  /**
   * Every item's id, name and kind, and every alternate name. The list
   * `items()` cannot give you.
   *
   * Matching read spine text against the collection needs all of it — a paged
   * browse would match against the first page and call everything else new.
   * `aliases` arrives with it and must be passed on with it: the matcher decides
   * a real name beats an alias, which it can only do seeing both.
   */
  itemNames: () =>
    req<{
      items: { id: number; name: string; kind: string }[];
      aliases: ItemAliasRef[];
    }>('/api/item-names'),
  item: (id: number) => req<{ item: ItemDetail }>(`/api/items/${id}`),

  /**
   * Only the copies marked `wanted` — item-level, not tree-level.
   *
   * `items({ status: 'wanted' })` answers a different question: which *games*
   * have something wanted anywhere in them. Both are right; only this one is a
   * shopping list.
   */
  wishlist: () => req<{ entries: WishlistEntry[] }>('/api/wishlist'),

  /**
   * Everything on preorder under one item — the checklist behind "it arrived".
   *
   * Read-only. Confirming a row is `updateCopy(copyId, { status: 'owned' })`,
   * the same call the wishlist's "bought it" makes, so there is one implementation
   * of what it means for a box to turn up.
   */
  arrivals: (itemId: number) =>
    req<{ arrivals: PreorderArrival[] }>(`/api/items/${itemId}/arrivals`),

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

  /**
   * Say by hand that we hold a component, or withdraw that.
   *
   * For components no BoardGameGeek id can settle — sleeves that came inside a
   * Kickstarter box against BGG's eleven per-hero sleeve entries. `state: null`
   * is the undo. Takes a `game_component` row id, not an item id.
   */
  setComponentManual: (componentId: number, state: 'have' | null, note?: string | null) =>
    put(`/api/components/${componentId}/manual`, { state, note: note ?? null }) as Promise<{
      id: number;
      state: 'have' | null;
      note: string | null;
    }>,

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
   * Run a lookup, and wait for it. **20 to 70 seconds** — do not add a timeout.
   *
   * It used to answer immediately and finish under `waitUntil`; that budget is
   * about thirty seconds and half of these lookups outlast it, silently. So the
   * server holds the request open now and the returned run is the *finished*
   * one. Polling `detailsRuns()` still works and is still worth doing — if this
   * promise never resolves because the connection dropped, the answer is in the
   * database anyway.
   *
   * `alreadyRunning` says the server handed back a run that was already in
   * flight rather than starting a second one; that one *is* unfinished, and
   * only the poll will say how it ended.
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

  /**
   * One page of the full scan record — every job ever taken in, newest first.
   * Unlike `scanJobs` this is not capped at 50; it is the answer to "which
   * photo produced which items", however long ago the photo was.
   */
  scanJobHistory: (page?: number) =>
    req<ScanJobHistoryPage>(
      `/api/scan-jobs/history${page && page > 1 ? `?page=${page}` : ''}`,
    ),

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

  /**
   * "I have looked at the box — it is that one."
   *
   * Promotes a suggestion to the row's identity, carrying the BoardGameGeek id,
   * publisher, year and cover with it. `candidate` indexes the row's own list,
   * so a runner-up can be chosen over the top answer.
   */
  acceptScanJobTitle: (id: number, index: number, candidate: number) =>
    post(`/api/scan-jobs/${id}/titles/${index}/accept`, { candidate }) as Promise<{
      job: ScanJob;
      title: EnrichedTitle;
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

/** One page of the scan record, shaped exactly like the worker's response. */
export interface ScanJobHistoryPage {
  jobs: ScanJob[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
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
  /**
   * Whether the catalog holds this game **now**, and how it got there.
   *
   * Computed by the server on every read and never stored. `alreadyOwned` above
   * is what enrichment found when the photo was processed, which stopped being
   * true the moment the owner dealt with the same box on another photo — this
   * is the answer to ask.
   */
  ownership?: TitleOwnership | null;
  /** Set when a retry searched with corrected text rather than what was read. */
  relookedUpAs?: string | null;
  /**
   * The runners-up, best first, including the one on the row.
   *
   * The top answer being wrong does not mean the lookup knew nothing — the free
   * databases return a ranked list and the box in your hand is often second.
   */
  candidates?: TitleSuggestion[];
  /**
   * A person looked at the box and confirmed this identification.
   *
   * Never inferred. It is the one answer the review screen used not to have:
   * before it, saying "yes, it really is that game" meant retyping the name and
   * throwing away the id, publisher, year and cover that came with the match.
   */
  acceptedMatch?: boolean;

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

/**
 * A queued title that turns out to be in the catalog, and why.
 *
 * The "why" is the part that matters on screen. *Already yours* is not enough
 * when the reason is that you added it from a different photo two minutes ago —
 * without saying so, the row reads as the app having lost your work rather than
 * as work you have already done.
 */
export interface TitleOwnership {
  itemId: number;
  name: string;
  /**
   * `catalog` — it was in the collection by some other route: a barcode, a
   * typed name, an earlier session. `this-job` / `other-job` — a review screen
   * put it there, this one or another.
   */
  via: 'catalog' | 'this-job' | 'other-job';
  /** How that other job took it in, so the note can say "photo" or "scan". */
  jobMode: 'shelf' | 'single' | 'barcode' | null;
}

/**
 * A suggestion on a scan-job row, trimmed to what a person recognises a box by.
 *
 * Deliberately **not** the whole `BarcodeCandidate`: five full ones made a
 * single job's payload 23 KB of BoardGameGeek prose, and the queue polls that
 * blob every 2.5 seconds while anything is working.
 */
export interface TitleSuggestion {
  name: string;
  bggId: number | null;
  publisher: string | null;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  kind: string;
  confidence: string;
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
