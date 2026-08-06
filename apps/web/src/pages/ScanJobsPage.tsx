import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ITEM_KINDS,
  isConfidentMatch,
  SHELF_LONG_EDGE,
  PHOTO_LONG_EDGE,
  type Item,
  type ItemKind,
  type MeResponse,
} from '@bgc/core';
import { api, ApiError, type EnrichedTitle, type ScanJob } from '../api';
import { useAsync, useInterval } from '../hooks';
import { fileToPhoto } from '../lib/camera';
import { formatDateTime } from '../lib/dates';
import { BarcodeQueue } from '../components/BarcodeQueue';
import { KIND_LABEL } from '../components/ItemTree';
import { Badge, ConfirmButton, ErrorBox, Spinner } from '../components/ui';
import { Link, type AddMode } from '../router';

const MODE_LABEL: Record<ScanJob['mode'], string> = {
  shelf: 'Shelf photo',
  single: 'Single box',
  barcode: 'Barcodes',
};

const STATUS_LABEL: Record<ScanJob['status'], string> = {
  uploaded: 'Uploading',
  reading: 'Reading photo',
  read: 'Read',
  enriching: 'Looking up games',
  review: 'Ready for review',
  done: 'Done',
  failed: 'Failed',
};

/** Titles still wanting a decision. Drives "4 left" on a job row. */
function outstandingOf(job: ScanJob): number | null {
  if (!job.enriched) return null;
  try {
    const titles = JSON.parse(job.enriched) as EnrichedTitle[];
    return titles.filter((t) => !t.alreadyOwned && !t.addedItemId && !t.dismissed).length;
  } catch {
    return null;
  }
}

/**
 * Statuses that still change on their own. Reading and looking up happen on the
 * server after the upload has been answered, so while a job is in one of these
 * the page has to keep asking; the rest are terminal and it can stop.
 */
const IN_FLIGHT: ReadonlySet<ScanJob['status']> = new Set([
  'uploaded',
  'reading',
  'read',
  'enriching',
]);

/**
 * How far through its titles a photo has got.
 *
 * Enrichment is bounded per invocation — a Worker gets 50 subrequests and one
 * title costs about four — so a 73-title shelf arrives over several passes. This
 * is what makes those passes visible instead of looking like a stall, which is
 * exactly what the old all-or-nothing version looked like when it died.
 *
 * Null for a barcode job: it has no `raw_titles`, because there was nothing to
 * read.
 */
function progressOf(job: ScanJob): { done: number; total: number } | null {
  if (!job.rawTitles) return null;
  try {
    const total = (JSON.parse(job.rawTitles) as unknown[]).length;
    const done = job.enriched ? (JSON.parse(job.enriched) as unknown[]).length : 0;
    return { done, total };
  } catch {
    return null;
  }
}

/** More titles to look up. */
const isUnfinished = (job: ScanJob): boolean => {
  const p = progressOf(job);
  return p != null && p.done < p.total && job.status !== 'done';
};

/** Slow enough not to be a nuisance, quick enough that a shelf read feels live. */
const POLL_MS = 2500;

/**
 * A lookup that only loosely matches what was read off the spine.
 *
 * The free databases match on a single word, so "Zorblax Quandary" comes back
 * as *Quandary* with a real id, a year and cover art — indistinguishable, at a
 * glance, from a good match. These are still shown, because the title is on the
 * shelf whatever the database thinks, but they are not ticked for you.
 */
const isDoubtful = (t: EnrichedTitle): boolean =>
  t.resolvedName != null &&
  // Judged from the names themselves rather than the stored score, so the
  // fragment rule applies here too — and so a re-lookup is judged against the
  // text it actually searched with, not the spine's original misreading.
  !isConfidentMatch(t.resolvedName, t.relookedUpAs ?? t.title);

/**
 * The name to actually save.
 *
 * A doubtful match falls back to what was read off the spine. Ticking one means
 * "this game is on my shelf", not "and it is that other game" — so the title
 * survives and the lookup's identity does not.
 */
/**
 * What a person typed for a barcode row, when they typed something.
 *
 * A photographed spine falls back to the text that was read off the box, which
 * is a real name. A barcode row's `title` is thirteen digits, so it has no such
 * fallback — the typed name is it.
 *
 * "Name it here" has to keep working when the lookup *still* knows nothing
 * afterwards, and for this catalog that is the ordinary case rather than the
 * edge: most of it is crowdfunding, and those boxes are in no retail database
 * whatever you call them. It also has to survive a **doubtful** answer, which
 * is the case that caught this out: typing a real name and getting back a
 * one-word match left the row offering to add the barcode "on its own".
 */
const typedName = (t: EnrichedTitle): string | null =>
  t.barcode ? (t.relookedUpAs ?? null) : null;

const effectiveName = (t: EnrichedTitle): string =>
  isDoubtful(t)
    ? (typedName(t) ?? t.title)
    : (t.resolvedName ?? typedName(t) ?? t.title);

/**
 * Would this row enter the collection named after its own barcode?
 *
 * Asked of the name that would actually be saved rather than of the fields that
 * produce it, so every route to the same bad outcome is covered by one check.
 */
const isNameless = (t: EnrichedTitle): boolean =>
  t.barcode != null && effectiveName(t) === t.barcode;

/**
 * Should this row be ticked for you?
 *
 * Two different reasons not to be, and they are not the same reason:
 *
 * - **doubtful** — the *identity* is not trustworthy. A spine read matched
 *   something that only shares a word, so ticking it saves the title alone.
 * - **needsConfirmation** — the identity is probably right but nobody has
 *   confirmed it. A GameUPC barcode hit banded `medium` is the case: for a real
 *   Ticket to Ride code the right answer came back first, at `medium`, ahead of
 *   fourteen wrong ones. Dropping its BGG id would throw away a cover and a
 *   publisher for a game the owner is about to confirm by looking at the box.
 *
 * So they share "leave it unticked" and nothing else.
 *
 * The third case is a barcode nothing resolved. A spine read that resolves to
 * nothing still has a *name* on it, read off the box, and adding it under that
 * name is right. A barcode has thirteen digits — ticking one by default put
 * "653341070005" in the collection as a game, which is what `isNameless` is
 * for. Type a name over it and it ticks itself, because it now has one.
 */
const autoTicked = (t: EnrichedTitle): boolean =>
  !isDoubtful(t) && !t.needsConfirmation && !isNameless(t);

const STATUS_TONE: Record<ScanJob['status'], 'neutral' | 'owned' | 'wanted' | 'kind'> = {
  uploaded: 'neutral',
  reading: 'neutral',
  read: 'neutral',
  enriching: 'neutral',
  review: 'owned',
  done: 'kind',
  failed: 'wanted',
};

/**
 * The three ways onto the queue, ordered by how certain each one is.
 *
 * **Barcode is first because it is the only exact identification this app
 * has.** A code carries a check digit and names one printing; reading a title
 * off a box is a guess, and this catalog has had Brink, Iliad and Moon matched
 * to the wrong games at a perfect 1.00 similarity. The photo paths are the
 * fallback for boxes with no code — which is a large slice of a mostly
 * crowdfunded collection, so they are not a lesser feature, just a later rung.
 */
const ADD_MODES: { id: AddMode; label: string; blurb: string }[] = [
  { id: 'barcode', label: 'Barcode', blurb: 'Exact, free, and keeps scanning. Best when the box has one.' },
  { id: 'shelf', label: 'Shelf photo', blurb: 'Reads every spine at once. Best for bulk.' },
  { id: 'single', label: 'One box', blurb: 'Reads the title off a single cover.' },
];

export function ScanJobsPage({ me, add }: { me: MeResponse; add?: AddMode | null }) {
  const [jobs, refresh] = useAsync(() => api.scanJobs(), []);
  const [live, setLive] = useState<ScanJob[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Barcode by default, and `?add=` lets an entry point elsewhere land straight
  // on the right one — the collection page's "Scan a barcode" button does.
  const [mode, setMode] = useState<AddMode>(add ?? 'barcode');

  // The polled copy once there is one, else the first load. Kept separate from
  // `useAsync` on purpose: its refresh drops back to `loading`, which would
  // blink the whole list out of existence every few seconds while polling.
  const shown = live ?? (jobs.state === 'ok' ? jobs.data.jobs : null);
  const inFlight = shown?.some((j) => IN_FLIGHT.has(j.status)) ?? false;

  useInterval(() => {
    void api.scanJobs()
      .then((r) => setLive(r.jobs))
      // A dropped poll is not worth an error box; the next one is 2.5s away.
      .catch(() => undefined);
  }, POLL_MS, inFlight);

  // Anything that changes the list itself — an upload, a delete — goes back to
  // the authoritative fetch rather than letting a stale polled copy shadow it.
  const reload = useCallback(() => {
    setLive(null);
    refresh();
  }, [refresh]);

  /**
   * Ask for the next chunk, automatically, until the photo is finished.
   *
   * Keyed on `${id}:${done}` rather than on the id alone, which is the whole
   * safety of it: each distinct point of progress is asked for exactly once, so
   * a chunk that advances triggers the next one and a chunk that does not
   * advance stops rather than spinning. The Retry button clears the keys, which
   * is what makes it mean "try that again" rather than "try it once ever".
   */
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!shown) return;
    for (const job of shown) {
      // `enriching` belongs to a pass already running; the server refuses a
      // second one anyway, and stale jobs come back to `read` on retry.
      if (job.status !== 'read' || !isUnfinished(job)) continue;
      const key = `${job.id}:${progressOf(job)?.done ?? 0}`;
      if (attemptedRef.current.has(key)) continue;
      attemptedRef.current.add(key);
      void api.enrichScanJob(job.id).catch(() => undefined);
    }
  }, [shown]);

  const retry = useCallback(async (id: number) => {
    for (const key of [...attemptedRef.current]) {
      if (key.startsWith(`${id}:`)) attemptedRef.current.delete(key);
    }
    await api.enrichScanJob(id).catch(() => undefined);
    reload();
  }, [reload]);

  // Deliberately does not swallow its own failures: the uploader below runs the
  // decode and the upload in one loop, and both fail the same way to the person
  // holding the phone, so both are reported from one place.
  const upload = useCallback(async (data: string, mediaType: string) => {
    setUploading(true);
    try {
      // Narrowed rather than cast: the uploader is only mounted on a photo tab,
      // and `createScanJob` genuinely has no barcode meaning.
      await api.createScanJob({ data, mediaType, mode: mode === 'single' ? 'single' : 'shelf' });
      reload();
    } finally {
      setUploading(false);
    }
  }, [mode, reload]);

  // A job you have finished with should stop competing for attention, without
  // its row being thrown away — see the note by the archive below.
  const active = (shown ?? []).filter((j) => j.status !== 'done');
  const finished = (shown ?? []).filter((j) => j.status === 'done');

  const canEdit = me.capabilities.includes('editCatalog');
  if (!canEdit) {
    return <p className="muted">Only editors can use scan jobs.</p>;
  }

  return (
    <div className="scan-jobs-page">
      <header className="page-head">
        <div>
          <h1>Add games</h1>
          <p className="subtitle">
            Scan barcodes or photograph your shelves. Everything lands in the same queue
            below and waits there until you have dealt with it — nothing disappears
            because you only got through half.
          </p>
        </div>
        <Link to="/" className="btn btn-quiet">Collection</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Upload" />}

      <section className="card">
        <div className="scan-modes" role="tablist">
          {ADD_MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'scan-mode scan-mode--on' : 'scan-mode'}
              onClick={() => setMode(m.id)}
            >
              <strong>{m.label}</strong>
              <span className="muted">{m.blurb}</span>
            </button>
          ))}
        </div>

        {mode === 'barcode' ? (
          <BarcodeQueue onQueueChanged={reload} onWantPhoto={() => setMode('single')} />
        ) : (
          <PhotoUploader
            mode={mode}
            uploading={uploading}
            onPhoto={upload}
            onError={setError}
            onStart={() => setError(null)}
          />
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Jobs</h2>
          <div className="section-head__actions">
            {inFlight && <span className="muted small">Working&hellip;</span>}
            <button type="button" className="btn btn-quiet" onClick={reload}>
              Refresh
            </button>
          </div>
        </div>

        {jobs.state === 'loading' && shown === null && <Spinner label="Loading jobs..." />}
        {jobs.state === 'error' && shown === null && (
          <ErrorBox error={jobs.error} what="Could not load jobs" />
        )}
        {shown !== null && shown.length === 0 && (
          <p className="muted">Nothing on the queue. Scan a barcode or photograph a shelf above.</p>
        )}
        {active.length > 0 && (
          <ul className="job-list">
            {active.map((job) => (
              <JobRow key={job.id} job={job} onChanged={reload} onRetry={retry} />
            ))}
          </ul>
        )}
        {active.length === 0 && finished.length > 0 && (
          <p className="muted">Everything on the queue has been dealt with.</p>
        )}

        {/*
          Finished jobs leave the active queue but are not deleted. Deleting
          would take the titles with it, and with no history view yet that is
          the only record of which photo produced which items — keep the row and
          hide it, rather than losing what it knew.
        */}
        {finished.length > 0 && (
          <details className="job-archive">
            <summary>{finished.length} finished</summary>
            <ul className="job-list">
              {finished.map((job) => (
                <JobRow key={job.id} job={job} onChanged={reload} onRetry={retry} />
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

function PhotoUploader({
  mode,
  uploading,
  onPhoto,
  onError,
  onStart,
}: {
  mode: 'shelf' | 'single';
  uploading: boolean;
  onPhoto: (data: string, mediaType: string) => Promise<void>;
  onError: (err: unknown) => void;
  onStart: () => void;
}) {
  const [count, setCount] = useState(0);

  /**
   * Read each photo, then upload it, reporting anything that goes wrong.
   *
   * The reporting is the point. This used to let `fileToPhoto` throw straight
   * through an unhandled promise, so picking a photo the browser could not
   * decode did nothing whatsoever — no error, no spinner, no row. A photo from
   * the iPhone camera roll is HEIC where one taken through the picker is JPEG,
   * so "the camera works and my library doesn't" was the same silent failure
   * both times.
   */
  async function handleFiles(files: FileList) {
    onStart();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      try {
        const photo = await fileToPhoto(
          file,
          mode === 'shelf' ? SHELF_LONG_EDGE : PHOTO_LONG_EDGE,
        );
        // Awaited, so a multi-photo selection uploads in order rather than
        // firing every request at once and racing the `uploading` flag.
        await onPhoto(photo.data, photo.mediaType);
        setCount((c) => c + 1);
      } catch (err) {
        // One unreadable photo out of ten should not abandon the other nine.
        onError(err);
      }
    }
  }

  return (
    <div className="photo-uploader">
      <label className="upload-area">
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploading}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void handleFiles(files);
            e.target.value = '';
          }}
        />
        <span className="upload-area__label">
          {uploading ? 'Uploading...' : 'Tap to take photos or select from gallery'}
        </span>
        <span className="muted small">
          Multiple photos welcome. Each becomes a separate job in the queue.
        </span>
      </label>
      {count > 0 && (
        <p className="muted">{count} photo{count === 1 ? '' : 's'} uploaded this session</p>
      )}
    </div>
  );
}

function JobRow({
  job,
  onChanged,
  onRetry,
}: {
  job: ScanJob;
  onChanged: () => void;
  onRetry: (id: number) => void;
}) {
  // Anything with titles on it can be opened, including a finished job — see
  // the note on the review page. Only a job with nothing read has no inside.
  const isReviewable = job.enriched != null;
  const isFailed = job.status === 'failed';
  const isProcessing = ['uploaded', 'reading', 'enriching'].includes(job.status);
  const outstanding = outstandingOf(job);
  const progress = progressOf(job);
  const unfinished = isUnfinished(job);

  return (
    <li className="job-row">
      <div className="job-row__info">
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        {/* Progress, not a spinner. A shelf arrives over several passes, and a
            number that moves is the difference between "working" and the stall
            that used to look identical to it. */}
        {progress && unfinished && (
          <span className="muted small">
            {progress.done} of {progress.total} looked up
          </span>
        )}
        {/* Through `formatDateTime`, because the column is SQLite's own
            "YYYY-MM-DD HH:MM:SS" with no zone marker — `new Date()` read that as
            local time and every row here displayed the wrong clock. */}
        <span className="job-row__time">{formatDateTime(job.createdAt)}</span>
        <span className="muted">{MODE_LABEL[job.mode]}</span>
        {/* The number that decides whether this photo still wants you. */}
        {isReviewable && outstanding !== null && (
          <span className={outstanding > 0 ? 'job-row__left' : 'muted small'}>
            {outstanding > 0 ? `${outstanding} still to sort` : 'all sorted'}
          </span>
        )}
        {isProcessing && <Spinner label="" />}
      </div>
      <div className="job-row__actions">
        {isReviewable && (
          <Link
            to={`/scan-jobs/${job.id}`}
            className={outstanding === 0 ? 'btn btn-quiet' : 'btn btn-primary'}
          >
            {outstanding === 0 ? 'Look again' : 'Review'}
          </Link>
        )}
        {isFailed && (
          <span className="muted small">{job.error ?? 'Unknown error'}</span>
        )}
        {job.status === 'done' && (
          <span className="muted small">Reviewed</span>
        )}

        {/* Retry, because a job that stopped partway used to have no way out at
            all — the three that stalled had to be moved back with SQL. */}
        {(isFailed || unfinished) && (
          <button
            type="button"
            className="btn btn-quiet btn-xs"
            onClick={() => onRetry(job.id)}
          >
            Retry
          </button>
        )}

        {/* Stop, keeping the titles. Delete was the only control here, and it
            takes the reading with it. */}
        {job.status !== 'done' && (
          <button
            type="button"
            className="btn btn-quiet btn-xs"
            onClick={async () => {
              await api.cancelScanJob(job.id);
              onChanged();
            }}
          >
            Stop
          </button>
        )}

        <ConfirmButton
          className="btn btn-quiet btn-xs"
          confirmLabel="Delete, losing the titles?"
          onConfirm={async () => {
            await api.deleteScanJob(job.id);
            onChanged();
          }}
        >
          Delete
        </ConfirmButton>
      </div>
    </li>
  );
}

/**
 * Review page for a single scan job.
 * Shows all enriched titles with proposed kinds, lets user adjust and add.
 */
export function ScanJobReviewPage({ id, me }: { id: number; me: MeResponse }) {
  const [jobState] = useAsync(() => api.scanJob(id), [id]);
  const [live, setLive] = useState<ScanJob | null>(null);
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<Record<number, { itemId: number } | { error: string }>>({});
  const [kindOverrides, setKindOverrides] = useState<Record<number, ItemKind>>({});
  const [parentOverrides, setParentOverrides] = useState<Record<number, number | string | null>>({});
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [adoptions, setAdoptions] = useState<Item[]>([]);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [retryText, setRetryText] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);

  const job = live ?? (jobState.state === 'ok' ? jobState.data.job : null);

  // Opening this by URL while the photo is still being read should resolve
  // itself rather than looking stuck. Polling stops once the job reaches
  // 'review', so it never fights the results rendered after adding.
  useInterval(() => {
    void api.scanJob(id)
      .then((r) => setLive(r.job))
      .catch(() => undefined);
  }, POLL_MS, job !== null && IN_FLIGHT.has(job.status));

  if (job === null) {
    if (jobState.state === 'error') {
      return <ErrorBox error={jobState.error} what="Could not load job" />;
    }
    return <Spinner />;
  }

  // Openable whenever there is something read, not only at status 'review'.
  // A job marked done still holds every title it found, and "done" was often
  // something the old code decided on your behalf the moment you added the
  // easy ones — the rows worth revisiting are precisely the ones inside it.
  if (!job.enriched) {
    return (
      <div className="card">
        <h2>Job #{job.id}</h2>
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        {job.error && <p className="muted">{job.error}</p>}
        <p><Link to="/scan-jobs">Back to queue</Link></p>
      </div>
    );
  }

  const titles: EnrichedTitle[] = JSON.parse(job.enriched);

  // The original index travels with each row: it is the address the server
  // stores outcomes against, and `fresh` is a filtered view whose positions
  // do not match it.
  const freshEntries = titles
    .map((t, originalIndex) => ({ t, originalIndex }))
    .filter((e) => !e.t.alreadyOwned);
  const fresh = freshEntries.map((e) => e.t);
  const owned = titles.filter((t) => t.alreadyOwned);

  /** What already happened to this row, whether this visit or a previous one. */
  const outcomeOf = (i: number): { itemId: number } | { error: string } | null => {
    const local = results[i];
    if (local) return local;
    const persisted = fresh[i]?.addedItemId;
    return persisted ? { itemId: persisted } : null;
  };

  const isSettled = (i: number): boolean => outcomeOf(i) !== null || !!fresh[i]?.dismissed;
  const outstanding = fresh.filter((_, i) => !isSettled(i));

  // Initialise selection on first render. Anything already dealt with stays
  // out of it, and doubtful matches start unticked — adding a wrong game is
  // far more annoying to undo than ticking a box.
  if (selected === null) {
    setSelected(
      new Set(
        fresh
          .map((_, i) => i)
          .filter((i) => !isSettled(i) && autoTicked(fresh[i]!)),
      ),
    );
    return <Spinner />;
  }

  // Parent options: existing collection items that were detected as parents,
  // PLUS other items in this same batch that are classified as base games.
  // Use a negative pseudo-ID for batch items (they don't have real IDs yet).
  const parentOptions: { id: number | string; name: string; isBatch: boolean }[] = [];

  // Existing collection parents detected during enrichment.
  const seenIds = new Set<number>();
  for (const t of titles) {
    if (t.proposedParentId && t.proposedParentName && !seenIds.has(t.proposedParentId)) {
      seenIds.add(t.proposedParentId);
      parentOptions.push({ id: t.proposedParentId, name: t.proposedParentName, isBatch: false });
    }
  }

  // Other items in this batch that are (or will be) base games — available as
  // parents before they're actually saved. Use `batch:N` as a placeholder ID.
  fresh.forEach((t, idx) => {
    const k = kindOverrides[idx] ?? (t.proposedKind as ItemKind | null) ?? 'base';
    if (k === 'base') {
      parentOptions.push({
        id: `batch:${idx}`,
        name: effectiveName(t),
        isBatch: true,
      });
    }
  });

  const getKind = (i: number): ItemKind =>
    kindOverrides[i] ?? (fresh[i]?.proposedKind as ItemKind | null) ?? 'base';

  const getParentId = (i: number): number | string | null =>
    parentOverrides[i] !== undefined
      ? (parentOverrides[i] ?? null)
      : (fresh[i]?.proposedParentId ?? null);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev!);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  async function addSelected() {
    setAdding(true);
    setError(null);

    // Base games first.
    const pending = [...selected!]
      .filter((i) => !isSettled(i) && !isNameless(fresh[i]!))
      .sort((a, b) => (getKind(a) === 'base' ? 0 : 1) - (getKind(b) === 'base' ? 0 : 1));

    const batchIds: Record<number, number> = {};
    const added: { index: number; addedItemId: number }[] = [];

    for (const i of pending) {
      const t = fresh[i];
      if (!t) continue;

      const kind = getKind(i);
      const rawParentId = getParentId(i);

      // Resolve batch references: "batch:3" means "the item at index 3 in this batch".
      let parentId: number | null = null;
      if (typeof rawParentId === 'string' && rawParentId.startsWith('batch:')) {
        const batchIdx = Number(rawParentId.slice(6));
        parentId = batchIds[batchIdx] ?? null;
      } else if (typeof rawParentId === 'number') {
        parentId = rawParentId;
      }

      // No demotion. An expansion whose base game is not here yet stays an
      // expansion and remembers the name it is waiting for; it used to be saved
      // as a base game instead, which put it in the collection as a root and
      // lost what it actually was. `pendingParentName` is what lets the catalog
      // reunite them when the base game finally turns up.
      const orphan = kind !== 'base' && !parentId;
      const pendingParentName = orphan
        ? (t.inferredParentName ?? t.proposedParentName ?? null)
        : null;

      // A doubtful match contributes its title and nothing else. Carrying the
      // id, cover and year across would put another game's identity on this
      // row, which is the exact failure the similarity floor exists to stop.
      const doubtful = isDoubtful(t);

      try {
        const { item, adopted } = await api.createItem({
          name: effectiveName(t),
          kind,
          parentItemId: kind === 'base' ? null : parentId,
          pendingParentName,
          bggId: doubtful ? null : t.bggId,
          publisher: doubtful ? null : t.publisher,
          yearPublished: doubtful ? null : t.yearPublished,
          thumbnailUrl: doubtful ? null : t.thumbnailUrl,
        });

        // Adding a base game can reunite it with expansions catalogued earlier.
        if (adopted.length > 0) setAdoptions((a) => [...a, ...adopted]);

        await api.createCopy(item.id, {
          quantity: 1,
          status: 'owned',
          // A photograph — or a barcode — is of a physical thing by construction.
          format: 'physical',
          isSleeved: false,
          isPunched: false,
        });

        /*
         * Keep the code, when there was one.
         *
         * This is the write that closes the loop: scanning the same box again
         * answers "already in your collection" from our own table, instantly
         * and with no network. Without it the barcode is thrown away the moment
         * the game is added, and every rescan pays the full ladder again.
         *
         * `contribute` offers the mapping back to GameUPC. It matters most for
         * exactly the codes that arrived here unresolved — nobody has
         * catalogued those, which is why the lookup came back empty.
         *
         * Best-effort throughout: the game is added either way, and a barcode
         * already spoken for (409) is information, not a failure of this add.
         */
        if (t.barcode) {
          await api
            .linkBarcode({
              itemId: item.id,
              barcode: t.barcode,
              bggId: doubtful ? null : t.bggId,
              updateUrl: t.updateUrl ?? null,
              contribute: true,
              name: effectiveName(t),
            })
            .catch(() => undefined);
        }

        batchIds[i] = item.id;
        setResults((r) => ({ ...r, [i]: { itemId: item.id } }));
        added.push({ index: freshEntries[i]!.originalIndex, addedItemId: item.id });
      } catch (err) {
        // `detail`, not `message`. An ApiError's message is "API 409", which is
        // what this row said when the catalog refused a duplicate — the useful
        // sentence ("Ticket to Ride is already in the collection.") was in the
        // body all along and never reached the screen.
        const msg = err instanceof ApiError ? err.detail : String(err);
        setResults((r) => ({ ...r, [i]: { error: msg } }));
      }
    }

    // Record which titles became which items, and leave the job open.
    //
    // This used to mark the whole photo done here, which is what made the
    // unfinished rows vanish: the ones that needed a correction were precisely
    // the ones not in this batch. The job now closes only when you say so.
    if (added.length > 0) {
      try {
        const { job: saved } = await api.updateScanJobTitles(id, added);
        setLive(saved);
      } catch {
        // The items exist either way; a failed bookkeeping write costs a
        // re-tick on the next visit, not a lost game.
      }
    }

    setAdding(false);
  }

  /** Set a row aside without adding it — a real answer, not an unfinished one. */
  async function dismiss(i: number) {
    try {
      const { job: saved } = await api.updateScanJobTitles(id, [
        { index: freshEntries[i]!.originalIndex, dismissed: true },
      ]);
      setLive(saved);
      setSelected((prev) => {
        const next = new Set(prev!);
        next.delete(i);
        return next;
      });
    } catch (err) {
      setError(err);
    }
  }

  /** Ask again about one row, with corrected text when the spine was misread. */
  async function relookup(i: number, query?: string) {
    setBusyRow(i);
    setError(null);
    try {
      const { job: saved } = await api.relookupScanJobTitle(
        id,
        freshEntries[i]!.originalIndex,
        query,
      );
      setLive(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusyRow(null);
    }
  }

  const addedCount = fresh.filter((_, i) => {
    const outcome = outcomeOf(i);
    return outcome !== null && 'itemId' in outcome;
  }).length;
  // Nameless rows are excluded rather than refused: "Select all" reaches them,
  // and adding one would file a dog bed's barcode as a game called
  // 653341070005. Leaving them out keeps the button's count honest and keeps
  // the row fixable — it says on its face that it needs a name.
  const pendingCount = [...selected].filter(
    (i) => !isSettled(i) && !isNameless(fresh[i]!),
  ).length;

  return (
    <div className="scan-jobs-page">
      <header className="page-head">
        <div>
          <h1>Review scan</h1>
          <p className="subtitle">
            {fresh.length} new title{fresh.length === 1 ? '' : 's'} found
            {owned.length > 0 && ` \u00b7 ${owned.length} already owned`}
            {addedCount > 0 && ` \u00b7 ${addedCount} added`}
          </p>
        </div>
        <Link to="/scan-jobs" className="btn btn-quiet">Back to queue</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Add" />}

      {adoptions.length > 0 && (
        <section className="card">
          <h3>Reunited with what was waiting</h3>
          <p className="muted small">
            These were catalogued before the game they belong to, and have just been
            filed under it.
          </p>
          <ul className="child-list">
            {adoptions.map((a) => (
              <li key={a.id}>
                <Link to={`/items/${a.id}`}>{a.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fresh.length > 0 && (
        <section className="card">
          <div className="shelf-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={adding || pendingCount === 0}
              onClick={addSelected}
            >
              {adding
                ? `Adding... ${addedCount}`
                : pendingCount === 0
                  ? 'All done'
                  : `Add ${pendingCount} game${pendingCount === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={adding}
              onClick={() =>
                setSelected(
                  selected.size > 0
                    ? new Set()
                    : new Set(fresh.map((_, i) => i).filter((i) => !isSettled(i))),
                )
              }
            >
              {selected.size > 0 ? 'Clear all' : 'Select all'}
            </button>
            {outstanding.length === 0 && (
              <span className="muted small">
                Everything on this photo is dealt with. It stays here until you delete it.
              </span>
            )}
          </div>

          <ul className="candidate-list shelf-classify">
            {fresh.map((t, i) => {
              const result = outcomeOf(i);
              const kind = getKind(i);
              const parentId = getParentId(i);
              const doubtful = isDoubtful(t);
              const dismissed = !!t.dismissed;
              const unresolved = t.resolvedName == null;

              return (
                <li
                  key={i}
                  className={
                    dismissed
                      ? 'candidate candidate--dismissed'
                      : doubtful || t.needsConfirmation
                        ? 'candidate candidate--doubtful'
                        : 'candidate'
                  }
                >
                  {result ? (
                    <span className="shelf-outcome" aria-hidden="true">
                      {'itemId' in result ? '\u2713' : '!'}
                    </span>
                  ) : dismissed ? (
                    <span className="shelf-outcome" aria-hidden="true">&ndash;</span>
                  ) : (
                    <input
                      type="checkbox"
                      className="shelf-check"
                      checked={selected.has(i)}
                      disabled={adding}
                      onChange={() => toggle(i)}
                      aria-label={`Add ${t.resolvedName ?? t.title}`}
                    />
                  )}

                  {t.thumbnailUrl && !doubtful && (
                    <img src={t.thumbnailUrl} alt="" className="candidate__thumb" />
                  )}

                  <div className="candidate__body">
                    <strong>{effectiveName(t)}</strong>
                    {doubtful ? (
                      <span className="candidate__doubt">
                        Closest match was &quot;{t.resolvedName}&quot;, which is
                        different enough that it is probably not the same game.
                        Tick it to add &quot;{effectiveName(t)}&quot; on its own.
                      </span>
                    ) : (
                      t.resolvedName &&
                      t.resolvedName !== t.title && (
                        <span className="muted">read as &quot;{t.title}&quot;</span>
                      )
                    )}
                    {/* A different kind of not-sure from `doubtful`: the name is
                        probably right, nobody has confirmed it, and the person
                        holding the box can settle it in a second. */}
                    {!doubtful && t.needsConfirmation && (
                      <span className="candidate__doubt">
                        Nobody has confirmed this barcode. Check it against the box
                        before ticking it.
                      </span>
                    )}
                    {t.publisher && !doubtful && <span className="muted">{t.publisher}</span>}
                    {t.relookedUpAs && (
                      <span className="muted small">looked up as &quot;{t.relookedUpAs}&quot;</span>
                    )}
                    {/* Which code this was. Worth showing plainly: it is the
                        thing that will be saved against the game, and on an
                        unresolved row it is the only fact anyone has. */}
                    {t.barcode && (
                      <span className="muted small">
                        <code>{t.barcode}</code>
                        {/* The full explanation lives in `reason` below; this is
                            only the one thing `reason` cannot say, because it is
                            about what happens next rather than what was found. */}
                        {unresolved &&
                          ' — name it here and it is saved against the game, and offered back to GameUPC.'}
                      </span>
                    )}

                    {/*
                      The repair bench for one row.
                      Vision reading the spine correctly and the lookup coming
                      back empty are different failures, and the second one used
                      to be terminal: the title was right, the cover was missing,
                      and there was nothing to do but add it bare or lose it.
                      Correcting the text and asking again fixes both the misread
                      spine and the lookup that simply had a bad day.
                    */}
                    {!result && !dismissed && (
                      <div className="candidate__repair">
                        <input
                          type="text"
                          value={retryText[i] ?? t.relookedUpAs ?? t.title}
                          onChange={(e) => setRetryText((s) => ({ ...s, [i]: e.target.value }))}
                          disabled={adding || busyRow === i}
                          aria-label="Text to look up"
                          className="candidate__repair-input"
                        />
                        <button
                          type="button"
                          className="btn btn-quiet btn-xs"
                          disabled={adding || busyRow === i}
                          onClick={() => relookup(i, (retryText[i] ?? t.title).trim())}
                        >
                          {busyRow === i ? 'Looking…' : 'Look up again'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-xs"
                          disabled={adding || busyRow === i}
                          onClick={() => dismiss(i)}
                        >
                          Not wanted
                        </button>
                        {unresolved && (
                          <span className="muted small">
                            {t.barcode
                              ? 'Nothing found for this code, so there is no name to add it under yet — type one above.'
                              : 'Nothing found for this one — it will be added under the name read off the spine.'}
                          </span>
                        )}
                      </div>
                    )}

                    {dismissed && <span className="muted small">Set aside.</span>}

                    {!result && !dismissed && (
                      <div className="shelf-classify__controls">
                        <select
                          value={kind}
                          onChange={(e) => {
                            const newKind = e.target.value as ItemKind;
                            setKindOverrides((o) => ({ ...o, [i]: newKind }));
                            if (newKind === 'base') {
                              setParentOverrides((o) => ({ ...o, [i]: null }));
                            }
                          }}
                          disabled={adding}
                          aria-label="Type"
                        >
                          {ITEM_KINDS.map((k) => (
                            <option key={k} value={k}>{KIND_LABEL[k]}</option>
                          ))}
                        </select>

                        {kind !== 'base' && (
                          <select
                            value={parentId ?? ''}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              // Could be a number (existing) or "batch:N" (sibling).
                              const parsed = val && !val.startsWith('batch:') ? Number(val) : val;
                              setParentOverrides((o) => ({ ...o, [i]: parsed }));
                            }}
                            disabled={adding}
                            aria-label="Parent game"
                          >
                            <option value="">
                              {t.inferredParentName
                                ? `${t.inferredParentName} — not here yet, wait for it`
                                : 'Not in the collection yet — wait for it'}
                            </option>
                            {parentOptions
                              .filter((p) => p.id !== `batch:${i}`) // can't be your own parent
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}{p.isBatch ? ' (this scan)' : ''}
                                </option>
                              ))}
                          </select>
                        )}

                        {t.reason && <span className="muted small">{t.reason}</span>}
                      </div>
                    )}

                    {result && 'itemId' in result && (
                      <Link to={`/items/${result.itemId}`}>Added &mdash; open it</Link>
                    )}
                    {result && 'error' in result && (
                      <span className="muted candidate__note">{result.error}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {owned.length > 0 && (
        <section className="card">
          <h3>{owned.length} already in your collection</h3>
          <ul className="child-list">
            {owned.map((t, i) => (
              <li key={i}>
                <Link to={`/items/${t.existingItemId}`}>{t.existingName}</Link>{' '}
                {/* A scanned code and a read spine are different evidence, and
                    the duplicate check working is worth saying out loud. */}
                {t.barcode ? (
                  <span className="muted">
                    scanned <code>{t.barcode}</code>
                    {t.ownedQuantity != null && t.ownedQuantity > 0 && ` · ${t.ownedQuantity} held`}
                  </span>
                ) : (
                  <span className="muted">read as &quot;{t.title}&quot;</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
