/**
 * Scan jobs — the intake queue.
 *
 * Two ways in, one queue, one review screen:
 *
 * - **A photo.** Upload → vision reads titles (async via `waitUntil`) → free
 *   lookups enrich → the job lands in `review`. Each photo is its own job.
 * - **A barcode.** Exact, so there is nothing to read: the code resolves
 *   against our own `edition.barcode` table and then the free services, and one
 *   title is appended to a job that stays open for the next scan. A stack of
 *   boxes is therefore *one* job with N titles, not N jobs — otherwise ten
 *   boxes would mean ten round trips through the review screen, which is the
 *   thing bulk intake exists to avoid.
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
  toIso,
  updateScanJobStatus,
} from '@bgc/db';
import { isPhotoMediaType, readShelf, identifyFromPhoto, type PhotoMediaType } from '@bgc/research';
import type { AppBindings, Env } from '../env.js';
import {
  resolveScannedBarcode,
  toSuggestions,
  validateBarcode,
  type ScannedTitle,
} from '../lib/barcode-scan.js';
import { cachedResolveAll } from '../lib/resolve-title.js';
import {
  countOutstanding,
  ownershipContext,
  shouldAutoClose,
  withFreshOwnership,
} from '../lib/scan-ownership.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * One line of an intake job. Declared in `lib/barcode-scan.ts` because both
 * producers — a photographed spine and a scanned code — have to agree on it.
 */
type EnrichedTitle = ScannedTitle;

/**
 * How long a job may sit at `enriching` before we call it dead.
 *
 * A chunk of eight lookups takes a couple of seconds and stamps `processed_at`
 * when it lands, so anything past this has stopped rather than slowed down.
 */
const STALE_AFTER_MS = 90_000;

/** Has this job's enrichment stopped beating? */
function isStale(job: { status: string; processedAt: string | null }): boolean {
  if (job.status !== 'enriching') return false;
  if (!job.processedAt) return true;
  // `toIso` because SQLite writes "YYYY-MM-DD HH:MM:SS" with no zone marker,
  // and Date.parse reads that shape as local time — which on a Worker is UTC,
  // but relying on the runtime's zone for correctness is how this bites later.
  const at = Date.parse(toIso(job.processedAt));
  return Number.isNaN(at) || Date.now() - at > STALE_AFTER_MS;
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

/**
 * `jobId` is the batch this scan belongs to. The client sends back whatever the
 * previous scan returned, so a session of scanning appends to one job; omitting
 * it opens a new one, which is what the first scan of a session does.
 */
const barcodeScanSchema = z.object({
  barcode: z.string().trim().min(8).max(20),
  jobId: z.number().int().positive().nullable().optional(),
});

/** Which suggestion the person picked. 0 is the one already on the row. */
const acceptSchema = z.object({
  candidate: z.number().int().min(0).max(20).default(0),
});

export const scanJobRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  /**
   * --- List all jobs -------------------------------------------------------
   *
   * Ownership is answered here, against the catalog as it stands, rather than
   * trusted from what enrichment wrote — so "3 still to sort" counts what is
   * still genuinely unsorted after everything the owner has done since. And a
   * job the last of whose titles was settled from another photo closes itself,
   * because nothing else is ever going to write to it.
   */
  .get('/', async (c) => {
    // Validate rather than cast: an unrecognised ?status= should list
    // everything, not silently match no rows.
    const raw = c.req.query('status');
    const status = statusSchema.safeParse(raw);
    const [listed, ctx] = await Promise.all([
      listScanJobs(c.env.DB, status.success ? { status: status.data } : undefined),
      ownershipContext(c.env.DB),
    ]);

    const jobs = [];
    for (const job of listed) {
      const settled = shouldAutoClose(job, ctx);
      if (settled) await updateScanJobStatus(c.env.DB, job.id, 'done');
      jobs.push(withFreshOwnership(settled ? { ...job, status: 'done' as const } : job, ctx));
    }
    return c.json({ jobs });
  })

  // --- Get a single job ----------------------------------------------------
  //
  // No auto-close here, deliberately: this is the review screen's own fetch,
  // and a page that marks itself finished as you open it is disconcerting even
  // when it is right. The queue does it a moment later, once you go back.
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id || !Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    return c.json({ job: withFreshOwnership(job, await ownershipContext(c.env.DB)) });
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

  /**
   * One scanned barcode → one line on an open job.
   *
   * Registered before `/:id/...` and matched as a literal, so a job can never
   * be called "barcode". Nothing here is deferred to `waitUntil`: the whole
   * ladder is fast and free, and the person scanning wants the name back before
   * they put the box down.
   */
  .post('/barcode', async (c) => {
    const parsed = barcodeScanSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const checked = validateBarcode(parsed.data.barcode);
    if (!checked.ok) return c.json({ error: 'bad_request', detail: checked.detail }, 400);
    const code = checked.code;

    // Find the batch, or open one. A finished job is never appended to — its
    // outstanding count has already been dealt with and reopening it would make
    // "all sorted" untrue after the fact.
    let job = parsed.data.jobId ? await getScanJob(c.env.DB, parsed.data.jobId) : null;
    if (job && (job.mode !== 'barcode' || job.status === 'done')) job = null;
    if (!job) job = await createScanJob(c.env.DB, { photoKey: NOT_STORED, mode: 'barcode' });

    const titles: EnrichedTitle[] = job.enriched ? JSON.parse(job.enriched) : [];
    const already = titles.findIndex((t) => t.barcode === code);

    /*
     * The same code twice.
     *
     * The client already refuses to re-submit a code it has accepted this
     * session, but a box left in front of the camera is the single most likely
     * way this feature turns one game into five queue entries, so the server
     * refuses too — one barcode is one line, whatever arrives.
     *
     * The exception is a line whose lookup never reached a service. Pointing the
     * camera at that box again is the obvious way to ask again, so it re-runs
     * in place rather than answering with the failure it already recorded.
     */
    if (already >= 0 && !titles[already]!.lookupFailed) {
      const ctx = await ownershipContext(c.env.DB);
      return c.json({
        job: withFreshOwnership(job, ctx),
        index: already,
        title: titles[already],
        duplicate: true,
      });
    }

    const index = already >= 0 ? already : titles.length;
    titles[index] = { ...(await resolveScannedBarcode(c.env, code, index + 1)) };

    // Straight to `review`: there is no reading step to wait for.
    const updated = await updateScanJobStatus(c.env.DB, job.id, 'review', {
      enriched: JSON.stringify(titles),
    });

    // After the write, never before it — the resolved copy is for reading only.
    const ctx = await ownershipContext(c.env.DB);
    return c.json(
      {
        job: withFreshOwnership(updated ?? job, ctx),
        index,
        title: titles[index],
        duplicate: false,
      },
      201,
    );
  })

  /**
   * Enrich the next chunk — the continue button, and the retry button.
   *
   * This used to accept a job **only** at status `read`, which meant a job that
   * died at `enriching` had no way out at all: the three that stalled had to be
   * moved back by hand with SQL. Anything not terminal is now acceptable.
   *
   * `enriching` is only accepted once it has stopped beating. A chunk takes a
   * few seconds and touches `processed_at` when it lands, so a run in flight is
   * left alone and a run that was killed is not — without that check, a retry
   * would race a live invocation and enrich the same titles twice.
   */
  .post('/:id/enrich', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    if (job.status === 'done') {
      return c.json({ error: 'bad_request', detail: 'That job is finished.' }, 400);
    }
    if (!job.rawTitles) {
      return c.json(
        { error: 'bad_request', detail: 'Nothing was read from that photo, so there is nothing to look up.' },
        400,
      );
    }
    if (job.status === 'enriching' && !isStale(job)) {
      // Not an error: the answer to "please continue" is that it already is.
      return c.json({ job, running: true });
    }

    c.executionCtx.waitUntil(processEnrichment(c.env, job.id));
    return c.json({ job: { ...job, status: 'enriching' }, running: true });
  })

  /**
   * Stop a job without throwing away what it read.
   *
   * The only control here used to be Delete, which takes the titles with it —
   * so abandoning a photo that was going wrong meant losing the reading that had
   * already been paid for. This marks it finished instead: it leaves the active
   * queue, and every title it found is still on the row.
   */
  .post('/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request' }, 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const updated = await updateScanJobStatus(c.env.DB, id, 'done', {
      error: job.error ?? 'Stopped before it finished.',
    });
    return c.json({ job: updated });
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

    /*
     * Close the job when, and only when, nothing on it is still waiting.
     *
     * This is not the auto-close that was removed. That one fired on *adding
     * the easy ones* and took the unfinished rows with it — the rows worth
     * coming back to were exactly the ones not in that batch. This fires when
     * `countOutstanding` reaches zero, which means every title has been added,
     * dismissed, or is in the catalog already. There is nothing left to come
     * back to, and the queue should not keep asking.
     *
     * `done`, not deleted: the row is the only record of which photo produced
     * which items, and the history view that would show it does not exist yet.
     *
     * The count is taken *after* the write, so this add's own items are in the
     * catalog by the time ownership is resolved — which is what lets a second
     * line naming the same game on this same photo settle itself.
     */
    const written =
      (await updateScanJobStatus(c.env.DB, id, job.status, {
        enriched: JSON.stringify(titles),
      })) ?? job;

    const ctx = await ownershipContext(c.env.DB);
    const outstanding = countOutstanding(titles, id, ctx);
    const updated =
      outstanding === 0
        ? ((await updateScanJobStatus(c.env.DB, id, 'done')) ?? written)
        : written;

    return c.json({ job: withFreshOwnership(updated, ctx), outstanding });
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
    let candidates: BarcodeCandidate[] = [];
    try {
      candidates = await cachedResolveAll(c.env.DB, deps, query, { force: true });
    } catch (err) {
      return c.json({ error: 'lookup_failed', detail: (err as Error).message }, 502);
    }
    const best = candidates[0] ?? null;

    const similarity = best ? titleSimilarity(best.name, query) : null;
    entry.bggId = best?.bggId ?? null;
    entry.resolvedName = best?.name ?? null;
    entry.thumbnailUrl = best?.thumbnailUrl ?? null;
    entry.publisher = best?.publisher ?? null;
    entry.yearPublished = best?.yearPublished ?? null;
    entry.similarity = similarity;
    entry.candidates = toSuggestions(candidates);
    // A fresh answer is a fresh question: whatever was accepted was accepted
    // about the *previous* identity, and carrying the flag over would mark a
    // name nobody has looked at as human-confirmed.
    entry.acceptedMatch = false;
    entry.relookedUpAs = query === entry.title ? null : query;
    // We reached a service and it answered, so whatever this row said about an
    // unreachable lookup is no longer true — including when the answer is that
    // nothing matches. Leaving the flag set would keep offering a retry for a
    // question that has now been asked properly.
    entry.lookupFailed = false;

    const updated = await updateScanJobStatus(c.env.DB, id, job.status, {
      enriched: JSON.stringify(titles),
    });

    // A corrected name is a new question about the catalog too: "Wingsapn"
    // matched nothing, "Wingspan" may well be a game the owner already added
    // from the other photo. Resolving on the way out asks it.
    const ctx = await ownershipContext(c.env.DB);
    return c.json({
      job: updated ? withFreshOwnership(updated, ctx) : null,
      title: entry,
      found: best !== null,
    });
  })

  /**
   * "I have looked at the box. It is that one."
   *
   * The answer the review screen could not give. A `medium`-confidence barcode
   * hit, or a name that only loosely matches a read spine, is shown untrusted
   * and unticked — correctly, because GameUPC answers an unknown code with
   * fifteen confident-looking guesses. But when the guess is *right*, the only
   * route into the catalog was to retype the name by hand, which threw away the
   * BoardGameGeek id, publisher, year and cover that came with it.
   *
   * Accepting promotes a candidate to the row's identity and carries everything
   * the lookup found. `candidate` selects from the runners-up, because the top
   * answer being wrong does not mean the list is.
   *
   * The catalog is not touched here: this settles what the row *claims*, and
   * adding it is still the ordinary `POST /api/items` the review screen makes.
   */
  .post('/:id/titles/:index/accept', async (c) => {
    const id = Number(c.req.param('id'));
    const index = Number(c.req.param('index'));
    if (!id || !Number.isInteger(index) || index < 0) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const parsed = acceptSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const job = await getScanJob(c.env.DB, id);
    if (!job || !job.enriched) return c.json({ error: 'not_found' }, 404);

    const titles = JSON.parse(job.enriched) as EnrichedTitle[];
    const entry = titles[index];
    if (!entry) return c.json({ error: 'not_found' }, 404);

    const chosen = entry.candidates?.[parsed.data.candidate];
    if (!chosen) {
      return c.json(
        { error: 'bad_request', detail: 'That suggestion is no longer on this row.' },
        400,
      );
    }

    entry.resolvedName = chosen.name;
    entry.bggId = chosen.bggId;
    entry.publisher = chosen.publisher;
    entry.yearPublished = chosen.yearPublished;
    entry.thumbnailUrl = chosen.thumbnailUrl;
    // A person's eyes on the box beat any similarity score, so the row stops
    // being judged by one. `acceptedMatch` is what the review screen reads to
    // treat it as confident, and what the copy's notes record afterwards.
    entry.similarity = 1;
    entry.needsConfirmation = false;
    entry.acceptedMatch = true;

    /*
     * Re-classify against the name just chosen, rather than keeping what was
     * decided about the old one.
     *
     * Two things would otherwise be wrong, and the second is not cosmetic. The
     * `reason` still read "Nobody has confirmed this code — check it against the
     * box", directly under a line saying a person had. And the proposed parent
     * belonged to a different game: accept "Catan: Seafarers" over a top answer
     * of "Catan" and the row must now propose Catan as its parent, not root
     * itself beside it.
     */
    const [classified] = classifyShelfResults(
      [{ name: chosen.name, bggId: chosen.bggId, thumbnailUrl: chosen.thumbnailUrl }],
      await listItemNames(c.env.DB),
    );
    entry.proposedKind = classified?.proposedKind ?? chosen.kind ?? 'base';
    entry.proposedParentId = classified?.proposedParentId ?? null;
    entry.proposedParentName = classified?.proposedParentName ?? null;
    entry.inferredParentName = classified?.inferredParentName ?? null;
    entry.reason = classified?.reason ?? null;

    const updated = await updateScanJobStatus(c.env.DB, id, job.status, {
      enriched: JSON.stringify(titles),
    });

    // Accepting settles what the row *is*, which can settle whether we have it:
    // a `medium` guess nobody trusted may name a game the catalog already holds.
    const ctx = await ownershipContext(c.env.DB);
    return c.json({ job: updated ? withFreshOwnership(updated, ctx) : null, title: entry });
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

/**
 * Step 2: resolve titles through free lookups and classify — a chunk at a time.
 *
 * **Why this is not one pass.** It used to `Promise.all` over every title at
 * once. Measured against production on 2026-08-06, the three shelves that died
 * held 73, 55 and 39 titles and the three that finished held 3, 2 and 3:
 *
 *   job 5, 6, 7   5976 / 5814 / 3101 chars of titles   stuck at `enriching`
 *   job 3, 4, 8    313 /  168 /  325 chars             reached `review`
 *
 * A Worker on the free plan gets **50 subrequests per invocation**, and every
 * D1 call counts as one alongside every fetch. One title costs about four — a
 * lookup-cache read, GameUPC, BoardGameGeek hydration, a cache write — so 73
 * titles is roughly 290. Exceeding the cap **terminates** the invocation rather
 * than throwing into a catch, and that kills `waitUntil` with it: no error was
 * recorded and `enriched` was never written. A stall with an empty error column
 * is indistinguishable from "still working", which is why the owner waited
 * twenty minutes before asking.
 *
 * So: one bounded chunk per invocation, written when it finishes, resuming from
 * whatever is already in `enriched`. A photo that blows up now loses at most one
 * chunk, and a large shelf finishes across several invocations instead of dying
 * in the first.
 *
 * Splitting the *photograph* into pieces — which was also suggested — would not
 * help here. Vision already succeeds on all 73 titles; it is only the
 * per-title enrichment that runs out of budget.
 */

/** Free-plan ceiling is 50 subrequests per invocation. Stay well inside it. */
const SUBREQUEST_BUDGET = 40;
/** Cache read, GameUPC, BoardGameGeek hydration, cache write. */
const SUBREQUESTS_PER_TITLE = 4;
/** Reading the job, listing item names, and the status and progress writes. */
const SUBREQUESTS_FIXED = 5;

/**
 * Titles per invocation. Eight, from (40 - 5) / 4 rounded down.
 *
 * Do not raise this to make a big shelf finish in fewer passes. The pass that
 * exceeds the ceiling is not slow, it is *silently killed*, which is the entire
 * failure this replaces. Continuing is cheap: the queue page asks for the next
 * chunk on its own.
 */
const TITLES_PER_RUN = Math.floor(
  (SUBREQUEST_BUDGET - SUBREQUESTS_FIXED) / SUBREQUESTS_PER_TITLE,
);

/** One title: are we holding it already, and if not, what is it? */
async function enrichOne(
  env: Env,
  deps: { gameUpc: ReturnType<typeof gameUpcConfig>; bggToken: string | undefined },
  existing: { id: number; name: string; kind: string }[],
  title: ShelfTitle,
): Promise<EnrichedTitle> {
  const base = {
    title: title.text,
    confidence: title.confidence,
    position: title.position,
    proposedKind: null as string | null,
    proposedParentId: null as number | null,
    proposedParentName: null as string | null,
    inferredParentName: null as string | null,
    reason: null as string | null,
  };

  const owned = matchExistingTitle(title.text, existing);
  if (owned) {
    return {
      ...base,
      alreadyOwned: true,
      existingItemId: owned.id,
      existingName: owned.name,
      bggId: null,
      resolvedName: null,
      thumbnailUrl: null,
      publisher: null,
      yearPublished: null,
      similarity: null,
    };
  }

  let candidates: BarcodeCandidate[] = [];
  try {
    candidates = await cachedResolveAll(env.DB, deps, title.text);
  } catch {
    // Not fatal. The title still shows for review under the name read off the
    // spine, which is a real name whatever the databases think of it.
  }
  const best = candidates[0] ?? null;

  return {
    ...base,
    alreadyOwned: false,
    existingItemId: null,
    existingName: null,
    bggId: best?.bggId ?? null,
    resolvedName: best?.name ?? null,
    thumbnailUrl: best?.thumbnailUrl ?? null,
    publisher: best?.publisher ?? null,
    yearPublished: best?.yearPublished ?? null,
    // Kept so a weak top answer is not the end of the conversation: the box the
    // owner is holding is often the second name on the list. Trimmed, because
    // this blob rides on every poll of the queue — see `toSuggestions`.
    candidates: toSuggestions(candidates),
    // Kept rather than enforced: the review screen shows a weak match and
    // leaves it unticked, which tells the truth about what was found instead of
    // quietly discarding a name that is on the shelf.
    similarity: best ? titleSimilarity(best.name, title.text) : null,
  };
}

/**
 * Decide kind and parent across everything resolved so far.
 *
 * Pure, and makes no subrequests, so it is cheap to redo on every chunk — and it
 * has to be redone, because a title's proposed parent can be a sibling that only
 * turns up in a later chunk.
 */
function classifyAll(
  rows: EnrichedTitle[],
  existing: { id: number; name: string; kind: string }[],
): EnrichedTitle[] {
  const fresh = rows
    .filter((r) => !r.alreadyOwned)
    .map((r) => ({ name: r.resolvedName ?? r.title, bggId: r.bggId, thumbnailUrl: r.thumbnailUrl }));
  const classified = classifyShelfResults(fresh, existing);

  let idx = 0;
  return rows.map((r) => {
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
    const cls = classified[idx++];
    return {
      ...r,
      proposedKind: cls?.proposedKind ?? 'base',
      proposedParentId: cls?.proposedParentId ?? null,
      proposedParentName: cls?.proposedParentName ?? null,
      inferredParentName: cls?.inferredParentName ?? null,
      reason: cls?.reason ?? null,
    };
  });
}

async function processEnrichment(env: Env, jobId: number): Promise<void> {
  try {
    const job = await getScanJob(env.DB, jobId);
    if (!job || !job.rawTitles) {
      await failJob(env, jobId, 'No raw titles to enrich');
      return;
    }

    const titles: ShelfTitle[] = JSON.parse(job.rawTitles);
    // Resume from whatever survived. Truncated rather than trusted: a shorter
    // `enriched` is progress, a longer one means `raw_titles` changed underneath
    // it, and redoing a few lookups is cheaper than reasoning about that.
    const soFar: EnrichedTitle[] = job.enriched ? JSON.parse(job.enriched) : [];
    soFar.length = Math.min(soFar.length, titles.length);
    const done = soFar.length;

    if (done >= titles.length) {
      // Nothing left to do — somebody asked again for a job already finished.
      await updateScanJobStatus(env.DB, jobId, 'review', {
        enriched: JSON.stringify(classifyAll(soFar, await listItemNames(env.DB))),
      });
      return;
    }

    // `enriching` now stamps `processed_at`, so a finished chunk is a heartbeat
    // and a job that has stopped beating can be told from one still working.
    await updateScanJobStatus(env.DB, jobId, 'enriching');

    const existing = await listItemNames(env.DB);
    const deps = { gameUpc: gameUpcConfig(env), bggToken: env.BGG_API_TOKEN };

    const stop = Math.min(titles.length, done + TITLES_PER_RUN);
    const chunk = await Promise.all(
      titles.slice(done, stop).map((t) => enrichOne(env, deps, existing, t)),
    );
    soFar.push(...chunk);

    const enriched = JSON.stringify(classifyAll(soFar, existing));

    if (soFar.length >= titles.length) {
      await updateScanJobStatus(env.DB, jobId, 'review', { enriched });
      return;
    }

    // Paused, not failed, and deliberately back at `read`: the status means
    // "titles read, not all enriched", which is exactly true, and it is the
    // status `/enrich` already accepts, so continuing needs no new mechanism.
    await updateScanJobStatus(env.DB, jobId, 'read', { enriched });
  } catch (err) {
    // Whatever chunks were written stay written — `failJob` sets the status and
    // the error and touches nothing else.
    await failJob(env, jobId, (err as Error).message);
  }
}
