/**
 * Scan jobs — photo upload queue with progressive enrichment.
 *
 * Upload a photo → store in R2 → vision reads titles (async via waitUntil) →
 * free lookups enrich → results land in 'review' for the user to confirm.
 *
 * Multiple photos can be uploaded in succession; each gets its own job.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  classifyShelfResults,
  matchExistingTitle,
  type BarcodeCandidate,
  type ShelfTitle,
} from '@bgc/core';
import { gameUpcConfig } from '@bgc/barcode';
import {
  createScanJob,
  deleteScanJob,
  getScanJob,
  listItemNames,
  listScanJobs,
  updateScanJobStatus,
} from '@bgc/db';
import { isPhotoMediaType, readShelf, identifyFromPhoto, type PhotoMediaType } from '@bgc/research';
import type { AppBindings, Env } from '../env.js';
import { cachedResolve } from '../lib/resolve-title.js';
import { requireCapability } from '../middleware/auth.js';

const statusSchema = z.enum([
  'uploaded',
  'reading',
  'read',
  'enriching',
  'review',
  'done',
  'failed',
]);

const uploadSchema = z.object({
  data: z.string().min(64),
  mediaType: z.string().refine(isPhotoMediaType, 'unsupported image type'),
  mode: z.enum(['shelf', 'single']).default('shelf'),
});

export const scanJobRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  // --- List all jobs -------------------------------------------------------
  .get('/', async (c) => {
    // Validate rather than cast: an unrecognised ?status= should list
    // everything, not silently match no rows.
    const raw = c.req.query('status');
    const status = statusSchema.safeParse(raw);
    const jobs = await listScanJobs(c.env.DB, status.success ? { status: status.data } : undefined);
    return c.json({ jobs });
  })

  // --- Get a single job ----------------------------------------------------
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id || !Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    return c.json({ job });
  })

  // --- Upload a photo and start processing ---------------------------------
  .post('/', async (c) => {
    const parsed = uploadSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    // Store photo in R2.
    const photoKey = `scan/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const photoBytes = Uint8Array.from(atob(parsed.data.data), (c) => c.charCodeAt(0));
    await c.env.PHOTOS.put(photoKey, photoBytes, {
      httpMetadata: { contentType: parsed.data.mediaType },
    });

    // Create the job row.
    const job = await createScanJob(c.env.DB, {
      photoKey,
      mode: parsed.data.mode,
    });

    // Kick off vision processing without blocking the response.
    // c.executionCtx.waitUntil keeps the worker alive after responding.
    c.executionCtx.waitUntil(
      processVision(c.env, job.id, parsed.data.data, parsed.data.mediaType as PhotoMediaType, parsed.data.mode),
    );

    return c.json({ job }, 201);
  })

  // --- Manually trigger enrichment (for jobs stuck at 'read') ---------------
  .post('/:id/enrich', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    if (job.status !== 'read') {
      return c.json({ error: 'bad_request', detail: `Job is ${job.status}, not 'read'` }, 400);
    }

    c.executionCtx.waitUntil(processEnrichment(c.env, job.id));
    return c.json({ job: { ...job, status: 'enriching' } });
  })

  // --- Mark a job as done (user reviewed) -----------------------------------
  .post('/:id/done', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const updated = await updateScanJobStatus(c.env.DB, id, 'done');

    // Clean up the photo from R2.
    await c.env.PHOTOS.delete(job.photoKey).catch(() => undefined);

    return c.json({ job: updated });
  })

  // --- Delete a job ---------------------------------------------------------
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (job) {
      await c.env.PHOTOS.delete(job.photoKey).catch(() => undefined);
    }
    await deleteScanJob(c.env.DB, id);
    return c.json({ deleted: true });
  });

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------

/** Step 1: Run vision to extract titles from the photo. */
async function processVision(
  env: Env,
  jobId: number,
  base64Data: string,
  mediaType: PhotoMediaType,
  mode: string,
): Promise<void> {
  try {
    await updateScanJobStatus(env.DB, jobId, 'reading');

    if (!env.ANTHROPIC_API_KEY) {
      await updateScanJobStatus(env.DB, jobId, 'failed', {
        error: 'No ANTHROPIC_API_KEY configured',
      });
      return;
    }

    let titles: ShelfTitle[];

    if (mode === 'shelf') {
      const result = await readShelf(env.ANTHROPIC_API_KEY, {
        data: base64Data,
        mediaType,
      });
      titles = result.titles;
    } else {
      const result = await identifyFromPhoto(env.ANTHROPIC_API_KEY, {
        data: base64Data,
        mediaType,
      });
      // Single-box mode returns candidates; convert to title shape.
      titles = result.candidates.map((c, i) => ({
        text: c.name,
        position: i + 1,
        confidence: c.confidence as 'high' | 'medium' | 'low',
        note: c.note ?? null,
      }));
    }

    await updateScanJobStatus(env.DB, jobId, 'read', {
      rawTitles: JSON.stringify(titles),
    });

    // Immediately proceed to enrichment.
    await processEnrichment(env, jobId);
  } catch (err) {
    await updateScanJobStatus(env.DB, jobId, 'failed', {
      error: (err as Error).message,
    });
  }
}

/** Step 2: Resolve titles through free lookups and classify. */
async function processEnrichment(env: Env, jobId: number): Promise<void> {
  try {
    await updateScanJobStatus(env.DB, jobId, 'enriching');

    const job = await getScanJob(env.DB, jobId);
    if (!job || !job.rawTitles) {
      await updateScanJobStatus(env.DB, jobId, 'failed', {
        error: 'No raw titles to enrich',
      });
      return;
    }

    const titles: ShelfTitle[] = JSON.parse(job.rawTitles);
    const existing = await listItemNames(env.DB);
    const deps = { gameUpc: gameUpcConfig(env), bggToken: env.BGG_API_TOKEN };

    // For each title: check if owned, then try free lookups.
    const enrichedResults = await Promise.all(
      titles.map(async (title) => {
        const owned = matchExistingTitle(title.text, existing);
        if (owned) {
          return {
            title: title.text,
            confidence: title.confidence,
            position: title.position,
            alreadyOwned: true,
            existingItemId: owned.id,
            existingName: owned.name,
            bggId: null as number | null,
            resolvedName: null as string | null,
            thumbnailUrl: null as string | null,
            publisher: null as string | null,
            yearPublished: null as number | null,
          };
        }

        // Try free resolution.
        let best: BarcodeCandidate | null = null;
        try {
          best = await cachedResolve(env.DB, deps, title.text);
        } catch {
          // Lookup failure is not fatal — the title still shows for review.
        }

        return {
          title: title.text,
          confidence: title.confidence,
          position: title.position,
          alreadyOwned: false,
          existingItemId: null as number | null,
          existingName: null as string | null,
          bggId: best?.bggId ?? null,
          resolvedName: best?.name ?? null,
          thumbnailUrl: best?.thumbnailUrl ?? null,
          publisher: best?.publisher ?? null,
          yearPublished: best?.yearPublished ?? null,
        };
      }),
    );

    // Classify the non-owned items (expansion detection).
    const freshItems = enrichedResults
      .filter((r) => !r.alreadyOwned)
      .map((r) => ({
        name: r.resolvedName ?? r.title,
        bggId: r.bggId,
        thumbnailUrl: r.thumbnailUrl,
      }));

    const classified = classifyShelfResults(freshItems, existing);

    // Merge classification back into enriched results.
    let classIdx = 0;
    const finalResults = enrichedResults.map((r) => {
      if (r.alreadyOwned) return { ...r, proposedKind: null, proposedParentId: null, proposedParentName: null, reason: null };
      const cls = classified[classIdx++];
      return {
        ...r,
        proposedKind: cls?.proposedKind ?? 'base',
        proposedParentId: cls?.proposedParentId ?? null,
        proposedParentName: cls?.proposedParentName ?? null,
        reason: cls?.reason ?? null,
      };
    });

    await updateScanJobStatus(env.DB, jobId, 'review', {
      enriched: JSON.stringify(finalResults),
    });
  } catch (err) {
    await updateScanJobStatus(env.DB, jobId, 'failed', {
      error: (err as Error).message,
    });
  }
}
