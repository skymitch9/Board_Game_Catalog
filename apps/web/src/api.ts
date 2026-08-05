import type {
  AppUser,
  BarcodeCandidate,
  ShelfMatch,
  Copy,
  CreateCopyInput,
  CreateItemInput,
  HealthResponse,
  Item,
  ItemDetail,
  ItemNode,
  ItemQuery,
  MeResponse,
  Rating,
  UpdateCopyInput,
  UpdateItemInput,
  UpsertRatingInput,
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
  totalItems: number;
  ownedCopies: number;
  wantedCopies: number;
  /** Items we hold more than one of. */
  duplicatedItems: number;
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

  meta: () => req<{ stats: CollectionStats }>('/api/meta'),

  items: (query: ItemQuery = {}) =>
    req<{ items: ItemNode[] }>(`/api/items${toQueryString(query)}`),
  item: (id: number) => req<{ item: ItemDetail }>(`/api/items/${id}`),

  createItem: (data: CreateItemInput) => post('/api/items', data) as Promise<{ item: Item }>,
  updateItem: (id: number, data: UpdateItemInput) =>
    patch(`/api/items/${id}`, data) as Promise<{ item: Item }>,
  deleteItem: (id: number) => del(`/api/items/${id}`) as Promise<{ deleted: boolean }>,

  createCopy: (itemId: number, data: CreateCopyInput) =>
    post(`/api/items/${itemId}/copies`, data) as Promise<{ copy: Copy }>,
  updateCopy: (id: number, data: UpdateCopyInput) =>
    patch(`/api/copies/${id}`, data) as Promise<{ copy: Copy }>,
  deleteCopy: (id: number) => del(`/api/copies/${id}`) as Promise<{ deleted: boolean }>,

  users: () => req<{ users: AppUser[] }>('/api/users'),

  cache: () => req<{ stats: CacheStats }>('/api/cache'),
  clearCache: (target: 'all' | 'lookups' | 'photos' = 'all') =>
    del(`/api/cache?target=${target}`) as Promise<{ removed: number; stats: CacheStats }>,
  setRole: (userId: number, role: AppUser['role']) =>
    patch(`/api/users/${userId}/role`, { role }) as Promise<{ user: AppUser }>,

  rate: (itemId: number, data: UpsertRatingInput) =>
    put(`/api/items/${itemId}/rating`, data) as Promise<{ rating: Rating }>,
  unrate: (itemId: number) => del(`/api/items/${itemId}/rating`) as Promise<{ deleted: boolean }>,

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

  linkBarcode: (data: {
    itemId: number;
    barcode: string;
    editionId?: number | null;
    editionName?: string | null;
    bggId?: number | null;
    updateUrl?: string | null;
  }) => post('/api/barcode/link', data) as Promise<{ barcode: string; contributed: boolean }>,

  /** One box, read from a photo. ~3-5s, no web search. */
  identifyPhoto: (photo: { data: string; mediaType: string; hash?: string }) =>
    post('/api/vision/identify', photo) as Promise<{
      candidates: BarcodeCandidate[];
      unreadable: boolean;
      usage: ResearchUsage;
      /** True when this answer came from a recent identical photo, not a fresh call. */
      cached?: boolean;
    }>,

  /** A shelf of spines, matched against the collection and GameUPC. */
  readShelf: (photo: { data: string; mediaType: string; hash?: string }) =>
    post('/api/vision/shelf', photo) as Promise<{
      matches: ShelfMatch[];
      unreadable: boolean;
      usage: ResearchUsage;
      cached?: boolean;
    }>,
};

export interface CacheStats {
  titles: number;
  barcodes: number;
  photos: number;
  oldest: string | null;
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
