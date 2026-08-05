import { Hono } from 'hono';
import { z } from 'zod';
import {
  MAX_PHOTO_BYTES,
  matchExistingTitle,
  type ShelfMatch,
} from '@bgc/core';
import { gameUpcConfig, lookupGameUpc } from '@bgc/barcode';
import { listItemNames } from '@bgc/db';
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
});

/** base64 is 4 chars per 3 bytes; check before decoding anything large. */
function tooLarge(base64: string): boolean {
  return Math.floor((base64.length * 3) / 4) > MAX_PHOTO_BYTES;
}

function upstream(err: unknown) {
  if (err instanceof ResearchError) {
    return { body: { error: 'upstream', detail: err.message }, status: err.status };
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

    try {
      const result = await identifyFromPhoto(c.env.ANTHROPIC_API_KEY, {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType,
      });
      return c.json(result);
    } catch (err) {
      const { body, status } = upstream(err);
      return c.json(body, status as 502);
    }
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

    let reading;
    try {
      reading = await readShelf(c.env.ANTHROPIC_API_KEY, {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType,
      });
    } catch (err) {
      const { body, status } = upstream(err);
      return c.json(body, status as 502);
    }

    const existing = await listItemNames(c.env.DB);
    const config = gameUpcConfig(c.env);

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

        // Not owned: ask GameUPC to turn the printed title into a BGG id.
        if (config) {
          try {
            // The `upc` path segment is ignored when `search` is supplied, but
            // the endpoint requires one, so pass a placeholder.
            const hit = await lookupGameUpc(config, '0000000000000', {
              search: title.text,
              searchMode: 'quality',
            });
            const best = hit.candidates[0];
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

    return c.json({
      matches,
      unreadable: reading.unreadable,
      usage: reading.usage,
    });
  });
