import { Hono } from 'hono';
import { z } from 'zod';
import {
  MAX_PHOTO_BYTES,
  hammingDistance,
  matchExistingTitle,
  PHOTO_HASH_MAX_DISTANCE,
  type BarcodeCandidate,
  type ShelfMatch,
} from '@bgc/core';
import { gameUpcConfig, lookupGameUpc, resolveTitle } from '@bgc/barcode';
import {
  getCached,
  getCachedPhoto,
  listItemNames,
  putCached,
  putCachedPhoto,
} from '@bgc/db';
import { ResearchError, identifyFromPhoto, isPhotoMediaType, readShelf } from '@bgc/research';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Reading games off photographs.
 *
 * Barcodes are a weak primitive for board games — measured, half of them are in
 * no database at all, and Kickstarter editions frequently carry none. The title
 * is printed on the box in very large type, and a vision call reads it in about
 * five seconds with no web search, against 74-137 seconds for asking about a
 * barcode number. Photo-first is both faster and more reliable here.
 *
 * **Photos are transient.** They arrive, get read, and are dropped. Nothing is
 * written to D1 or R2, and the client captures from a live camera frame rather
 * than the photo library so nothing lands in the user's camera roll either.
 */

const photoSchema = z.object({
  /** Base64, no data: URL prefix — the client strips it before sending. */
  data: z.string().min(64),
  mediaType: z.string().refine(isPhotoMediaType, 'unsupported image type'),
  /** 64-bit dHash from the client. Absent just means no caching for this shot. */
  hash: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});

/** base64 is 4 chars per 3 bytes; check before decoding anything large. */
function tooLarge(base64: string): boolean {
  return Math.floor((base64.length * 3) / 4) > MAX_PHOTO_BYTES;
}

/**
 * Turn an upstream failure into something the person holding the phone can act
 * on.
 *
 * The auth branch exists because it was got wrong once: a rejected API key
 * surfaced as "Could not read that photo", which sent someone looking at their
 * lighting and camera angle when the actual problem was a rotated key that had
 * not been pushed to production. An authentication failure has nothing to do
 * with the photo and must never be described as though it does.
 */
function upstream(err: unknown) {
  if (err instanceof ResearchError) {
    return { body: { error: 'upstream', detail: err.message }, status: err.status };
  }

  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return {
      body: {
        error: 'config',
        detail:
          'The Anthropic API key was rejected. This is a configuration problem, not a problem with your photo — the key was probably rotated without being pushed to production. Run `npm run secrets:push`.',
      },
      status: 503,
    };
  }
  if (status === 429) {
    return {
      body: {
        error: 'rate_limited',
        detail: 'Rate limited by the Anthropic API. Wait a moment and try again.',
        retryable: true,
      },
      status: 429,
    };
  }

  return {
    body: {
      error: 'upstream',
      detail: `Could not read that photo: ${(err as Error).message}. This call is occasionally flaky — trying again usually works.`,
      retryable: true,
    },
    status: 502,
  };
}

/**
 * Resolve a title to its best candidate, remembering the answer.
 *
 * Re-photographing a shelf used to re-resolve every title on it — nine games,
 * nine round trips, every time. Resolution is deterministic, so it is cached.
 * The vision call above is not, and cannot be: a new photo is genuinely new
 * input, and a shelf changes.
 *
 * A miss is cached too, as `null`. Titles that resolve to nothing are exactly
 * the ones you would otherwise re-ask about on every pass.
 */
async function cachedResolve(
  db: D1Database,
  deps: Parameters<typeof resolveTitle>[0],
  title: string,
): Promise<BarcodeCandidate | null> {
  const cached = await getCached<BarcodeCandidate | null>(db, 'title', title);
  if (cached !== null) return cached;

  const hit = await resolveTitle(deps, title);
  const best = hit.candidates[0] ?? null;
  // Only cache once BGG hydration has had its chance, or a week of lookups
  // would be pinned to the un-hydrated shape from before the token arrived.
  if (best === null || hit.bggHydrated || !deps.bggToken) {
    await putCached(db, 'title', title, best);
  }
  return best;
}

export const visionRoutes = new Hono<AppBindings>()
  /** One box, read carefully. Returns candidates in the shared shape. */
  .post('/identify', requireCapability('runResearch'), async (c) => {
    const parsed = photoSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    if (tooLarge(parsed.data.data)) {
      return c.json(
        { error: 'bad_request', detail: 'That photo is too large. Downscale before sending.' },
        413,
      );
    }

    // Photographing a box, not adding it, and photographing it again a minute
    // later is a real pattern — and it used to pay for a second identical
    // reading. Match on the perceptual hash rather than the bytes, because two
    // handheld shots of the same cover are never byte-identical.
    const hash = parsed.data.hash;
    if (hash) {
      const hit = await getCachedPhoto<unknown>(
        c.env.DB,
        'identify',
        hash,
        PHOTO_HASH_MAX_DISTANCE,
        hammingDistance,
      );
      if (hit) return c.json({ ...(hit as object), cached: true });
    }

    let result;
    try {
      result = await identifyFromPhoto(c.env.ANTHROPIC_API_KEY, {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType,
      });
    } catch (err) {
      const { body, status } = upstream(err);
      return c.json(body, status as 503);
    }

    // Reading the name off the box is only half the job. Resolve each title the
    // same way shelf mode does, so a photographed box comes back with a cover,
    // a year and a BGG id rather than a bare string. Free, and adds ~1s.
    const deps = { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN };
    const resolved = await Promise.all(
      result.candidates.map(async (candidate) => {
        const best = await cachedResolve(c.env.DB, deps, candidate.name);
        if (!best) return candidate;
        return {
          ...candidate,
          // The model read the box in front of us, so its own reading wins on
          // anything it could actually see. The lookup only fills the gaps.
          bggId: best.bggId,
          thumbnailUrl: candidate.thumbnailUrl ?? best.thumbnailUrl,
          yearPublished: candidate.yearPublished ?? best.yearPublished,
          publisher: candidate.publisher ?? best.publisher,
          sourceUrl: best.sourceUrl,
        };
      }),
    );

    const payload = { ...result, candidates: resolved };
    // Only remember a reading that actually said something. Caching "unreadable"
    // would lock in a bad photo and make the obvious fix — take a better one —
    // stop working for a day.
    if (hash && resolved.length > 0 && !result.unreadable) {
      await putCachedPhoto(c.env.DB, 'identify', hash, payload);
    }
    return c.json(payload);
  })

  /**
   * A shelf of spines, read broadly, then matched against what we already know.
   *
   * Matching happens here rather than in the model call because it is free and
   * instant: the local catalog is one query, and GameUPC's search costs nothing.
   * Asking the model to resolve twelve titles via web search would take minutes.
   */
  .post('/shelf', requireCapability('runResearch'), async (c) => {
    const parsed = photoSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    if (tooLarge(parsed.data.data)) {
      return c.json(
        { error: 'bad_request', detail: 'That photo is too large. Downscale before sending.' },
        413,
      );
    }

    // Same photo cache as single-box, kept under its own mode: a shelf photo
    // asks a different question of the same pixels and must never answer a box
    // lookup. The 24-hour TTL matters more here — shelves get rearranged.
    const hash = parsed.data.hash;
    if (hash) {
      const hit = await getCachedPhoto<unknown>(
        c.env.DB,
        'shelf',
        hash,
        PHOTO_HASH_MAX_DISTANCE,
        hammingDistance,
      );
      if (hit) return c.json({ ...(hit as object), cached: true });
    }

    let reading;
    try {
      reading = await readShelf(c.env.ANTHROPIC_API_KEY, {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType,
      });
    } catch (err) {
      const { body, status } = upstream(err);
      return c.json(body, status as 503);
    }

    const existing = await listItemNames(c.env.DB);
    const deps = { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN };

    // Resolve unknown titles concurrently — these are independent free lookups
    // and doing them in series would make a full shelf feel slow.
    const matches: ShelfMatch[] = await Promise.all(
      reading.titles.map(async (title): Promise<ShelfMatch> => {
        const owned = matchExistingTitle(title.text, existing);
        if (owned) {
          return {
            title,
            existingItemId: owned.id,
            existingName: owned.name,
            bggId: null,
            resolvedName: null,
            thumbnailUrl: null,
          };
        }

        // Not owned: resolve the printed title, reusing the cache so a shelf
        // photographed twice does not pay for the same answers twice.
        if (deps.gameUpc) {
          try {
            const best = await cachedResolve(c.env.DB, deps, title.text);
            if (best) {
              return {
                title,
                existingItemId: null,
                existingName: null,
                bggId: best.bggId,
                resolvedName: best.name,
                thumbnailUrl: best.thumbnailUrl,
              };
            }
          } catch {
            // A quota error or a miss is not a reason to lose the title — the
            // user can still add it by hand from what the spine said.
          }
        }

        return {
          title,
          existingItemId: null,
          existingName: null,
          bggId: null,
          resolvedName: null,
          thumbnailUrl: null,
        };
      }),
    );

    const payload = { matches, unreadable: reading.unreadable, usage: reading.usage };
    if (hash && matches.length > 0 && !reading.unreadable) {
      await putCachedPhoto(c.env.DB, 'shelf', hash, payload);
    }
    return c.json(payload);
  });
