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
  titleSimilarity,
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

/**
 * One line of a read photo, as it stands after enrichment and any review.
 *
 * `addedItemId` and `dismissed` are the outcome fields — everything else is
 * what was read or looked up. A title with neither set is unfinished business,
 * which is the state the whole screen exists to make visible.
 */
interface EnrichedTitle {
  title: string;
  confidence: string;
  position: number;
  alreadyOwned: boolean;
  existingItemId: number | null;
  existingName: string | null;
  bggId: number | null;
  resolvedName: string | null;
  thumbnailUrl: string | null;
  publisher: string | null;
  yearPublished: number | null;
  similarity: number | null;
  proposedKind: string | null;
  proposedParentId: number | null;
  proposedParentName: string | null;
  inferredParentName: string | null;
  reason: string | null;
  addedItemId?: number | null;
  dismissed?: boolean;
  /** Set when a retry searched with corrected text rather than the spine's. */
  relookedUpAs?: string | null;
}

/** Titles still wanting a decision — not added, not dismissed, not already owned. */
function countOutstanding(titles: EnrichedTitle[]): number {
  return titles.filter((t) => !t.alreadyOwned && !t.addedItemId && !t.dismissed).length;
}

const titleUpdatesSchema = z.object({
  updates: z
    .array(
      z.object({
        index: z.number().int().min(0),
        addedItemId: z.number().int().positive().nullable().optional(),
        dismissed: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * What goes in `photo_key` now that nothing is stored.
 *
 * The column is NOT NULL and older rows hold real keys, so it stays rather than
 * being migrated away — a marker says plainly that this row never had a photo
 * anywhere, which is more useful than an empty string.
 */
const NOT_STORED = 'not-stored';

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

    // The photo is never stored. It goes straight from this request into the
    // vision call below and is then gone — it lives only in memory, for the few
    // seconds that call takes.
    //
    // It used to be written to R2 first, and nothing ever read it back: vision
    // takes the base64 from the request, enrichment works from the extracted
    // titles, and the review screen shows no image. The bucket was write-only
    // storage whose whole job was to be deleted later, and forgetting to delete
    // it on one code path was all it took to keep photos indefinitely. Not
    // writing it is a guarantee; remembering to delete it was a habit.
    const job = await createScanJob(c.env.DB, {
      photoKey: NOT_STORED,
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

  /**
   * Record what happened to individual titles, without finishing the job.
   *
   * The behaviour this replaces: adding the titles that looked right marked the
   * *whole photo* reviewed, and everything you had not dealt with — the wrong
   * names, the missed expansion tags, the ones whose lookup came back bare —
   * disappeared with it. The good ones were the cheap part; the ones needing a
   * second look were the ones worth keeping, and they were exactly what got
   * thrown away.
   *
   * So outcomes are per title and the job stays put. A title is `added` (with
   * the item it became), `dismissed` (deliberately not wanted), or neither —
   * and neither is the state worth coming back to.
   */
  .post('/:id/titles', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const parsed = titleUpdatesSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const job = await getScanJob(c.env.DB, id);
    if (!job || !job.enriched) return c.json({ error: 'not_found' }, 404);

    const titles = JSON.parse(job.enriched) as EnrichedTitle[];
    for (const update of parsed.data.updates) {
      const entry = titles[update.index];
      if (!entry) continue;
      if (update.addedItemId !== undefined) entry.addedItemId = update.addedItemId;
      if (update.dismissed !== undefined) entry.dismissed = update.dismissed;
    }

    const updated = await updateScanJobStatus(c.env.DB, id, job.status, {
      enriched: JSON.stringify(titles),
    });

    return c.json({ job: updated, outstanding: countOutstanding(titles) });
  })

  /**
   * Ask again about one title.
   *
   * Most of what goes wrong in a shelf read is per-title, not per-photo: the
   * spine read correctly but the lookup came back with no cover, or with a game
   * that only shares a word. Re-running the whole job would re-pay for vision
   * over a photo that was read perfectly well. This re-asks about one line, and
   * skips the cache, because the person pressing it has seen the answer and
   * judged it wrong — better evidence than a week-old entry.
   */
  .post('/:id/titles/:index/relookup', async (c) => {
    const id = Number(c.req.param('id'));
    const index = Number(c.req.param('index'));
    if (!id || !Number.isInteger(index) || index < 0) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const job = await getScanJob(c.env.DB, id);
    if (!job || !job.enriched) return c.json({ error: 'not_found' }, 404);

    const titles = JSON.parse(job.enriched) as EnrichedTitle[];
    const entry = titles[index];
    if (!entry) return c.json({ error: 'not_found' }, 404);

    // The text to search with: whatever the person corrected it to, else what
    // the spine said. A corrected name is the whole point — "Wingsapn" will
    // never resolve, and re-asking with the same misread is theatre.
    const query = (c.req.query('q') ?? entry.title).trim();
    if (!query) return c.json({ error: 'bad_request', detail: 'nothing to look up' }, 400);

    const deps = { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN };
    let best: BarcodeCandidate | null = null;
    try {
      best = await cachedResolve(c.env.DB, deps, query, { force: true });
    } catch (err) {
      return c.json({ error: 'lookup_failed', detail: (err as Error).message }, 502);
    }

    const similarity = best ? titleSimilarity(best.name, query) : null;
    entry.bggId = best?.bggId ?? null;
    entry.resolvedName = best?.name ?? null;
    entry.thumbnailUrl = best?.thumbnailUrl ?? null;
    entry.publisher = best?.publisher ?? null;
    entry.yearPublished = best?.yearPublished ?? null;
    entry.similarity = similarity;
    entry.relookedUpAs = query === entry.title ? null : query;

    const updated = await updateScanJobStatus(c.env.DB, id, job.status, {
      enriched: JSON.stringify(titles),
    });

    return c.json({ job: updated, title: entry, found: best !== null });
  })

  // --- Mark a job as done (user reviewed) -----------------------------------
  .post('/:id/done', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const updated = await updateScanJobStatus(c.env.DB, id, 'done');
    return c.json({ job: updated });
  })

  // --- Delete a job ---------------------------------------------------------
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    await deleteScanJob(c.env.DB, id);
    return c.json({ deleted: true });
  });

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------

/** Record a failure. Nothing to clean up: the photo was never stored. */
async function failJob(env: Env, jobId: number, message: string): Promise<void> {
  await updateScanJobStatus(env.DB, jobId, 'failed', { error: message });
}

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
      await failJob(env, jobId, 'No ANTHROPIC_API_KEY configured');
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
    await failJob(env, jobId, (err as Error).message);
  }
}

/** Step 2: Resolve titles through free lookups and classify. */
async function processEnrichment(env: Env, jobId: number): Promise<void> {
  try {
    await updateScanJobStatus(env.DB, jobId, 'enriching');

    const job = await getScanJob(env.DB, jobId);
    if (!job || !job.rawTitles) {
      await failJob(env, jobId, 'No raw titles to enrich');
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
            similarity: null as number | null,
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
          // Kept rather than enforced: the review screen shows a weak match and
          // leaves it unticked, which tells the truth about what was found
          // instead of quietly discarding a name that is on the shelf.
          similarity: best ? titleSimilarity(best.name, title.text) : null,
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
      if (r.alreadyOwned) {
        return {
          ...r,
          proposedKind: null,
          proposedParentId: null,
          proposedParentName: null,
          inferredParentName: null,
          reason: null,
        };
      }
      const cls = classified[classIdx++];
      return {
        ...r,
        proposedKind: cls?.proposedKind ?? 'base',
        proposedParentId: cls?.proposedParentId ?? null,
        proposedParentName: cls?.proposedParentName ?? null,
        inferredParentName: cls?.inferredParentName ?? null,
        reason: cls?.reason ?? null,
      };
    });

    await updateScanJobStatus(env.DB, jobId, 'review', {
      enriched: JSON.stringify(finalResults),
    });
  } catch (err) {
    await failJob(env, jobId, (err as Error).message);
  }
}
