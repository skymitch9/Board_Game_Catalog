import { MAX_COVER_BYTES, MIN_COVER_BYTES, coverObjectKey, sniffImageType, type CoverHoster } from '@bgc/core';
import type { Env } from '../env.js';

/**
 * The intake half of the covers consolidation
 * (catalog-platform/docs/info/covers-consolidation-plan.md §2.4) — the one-
 * time migration (scripts/rehost-covers.mjs) moved the 1,124 URLs that
 * already existed; this is what stops the count growing back. Wired into
 * `updateItem()`/`createItem()` (packages/db/src/items.ts), the single choke
 * point those functions already are for `thumbnail_url` writes.
 *
 * ⚠️ "Both, or neither", same rule as library's storage() helper: a route
 * that read COVERS without COVERS_BASE_URL, or vice versa, would store an
 * object nobody can resolve the URL for.
 */

/** Is there anywhere to put a rehosted file? Both halves or neither. */
function storage(env: Env): { bucket: R2Bucket; baseUrl: string } | null {
  if (!env.COVERS || !env.COVERS_BASE_URL) return null;
  return { bucket: env.COVERS, baseUrl: env.COVERS_BASE_URL.replace(/\/+$/, '') };
}

/** `true` for a URL already on our own bucket — the short-circuit the plan asks for. */
function alreadyHosted(url: string, baseUrl: string): boolean {
  return url.startsWith(`${baseUrl}/`);
}

/**
 * Fetch, verify, hash and upload one URL, returning the `gamecovers.
 * heygabi.ai` address it now lives at. Never throws — every failure mode
 * (network, non-image bytes, too small, too big) resolves back to the
 * ORIGINAL url, because a hosting hiccup at save time must not lose the
 * cover the person just picked.
 */
async function rehostOne(url: string, store: { bucket: R2Bucket; baseUrl: string }): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': 'board-game-catalog (private household catalog)' },
    });
  } catch (err) {
    console.warn('cover intake: fetch failed, keeping hotlink', url, err);
    return url;
  }
  if (!res.ok) {
    console.warn('cover intake: fetch not ok, keeping hotlink', url, res.status);
    return url;
  }

  const declaredLength = Number(res.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_COVER_BYTES * 1.1) {
    console.warn('cover intake: declared length over ceiling, keeping hotlink', url, declaredLength);
    return url;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_COVER_BYTES || bytes.byteLength < MIN_COVER_BYTES) {
    console.warn('cover intake: size outside floor/ceiling, keeping hotlink', url, bytes.byteLength);
    return url;
  }

  const type = sniffImageType(bytes);
  if (!type) {
    console.warn('cover intake: not a sniffable image, keeping hotlink', url);
    return url;
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = coverObjectKey(url, hex, type);
  const hostedUrl = `${store.baseUrl}/${key}`;

  // Content-addressed: if this exact byte content is already stored, the PUT
  // is a harmless overwrite of an identical object, so no existence check is
  // needed before it.
  await store.bucket.put(key, bytes, {
    httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return hostedUrl;
}

/**
 * Build the hook `updateItem`/`createItem` call before writing
 * `thumbnail_url` — `undefined` when the bucket isn't configured, which
 * `packages/db` treats as "store the URL as given", identical to today's
 * behaviour.
 */
export function makeCoverHoster(env: Env): CoverHoster | undefined {
  const store = storage(env);
  if (!store) return undefined;
  return async (url: string) => {
    if (alreadyHosted(url, store.baseUrl)) return url;
    return rehostOne(url, store);
  };
}

/** What `GET /api/cover-storage` reports — mirrors library's pattern. */
export function coverStorageStatus(env: Env): { enabled: boolean; maxBytes: number; reason?: string } {
  const store = storage(env);
  return {
    enabled: store !== null,
    maxBytes: MAX_COVER_BYTES,
    ...(store
      ? {}
      : {
          reason:
            'Cover rehosting is not switched on: this Worker has no R2 bucket bound. New covers are stored as the hotlink given.',
        }),
  };
}
