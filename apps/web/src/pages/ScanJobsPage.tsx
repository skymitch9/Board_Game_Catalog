import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ITEM_KINDS,
  isDoubtfulMatch,
  scanRowName,
  SHELF_LONG_EDGE,
  PHOTO_LONG_EDGE,
  type Item,
  type ItemKind,
  type MeResponse,
} from '@bgc/core';
import { api, ApiError, type EnrichedTitle, type ScanJob, type TitleOwnership } from '../api';
import { useAsync, useInterval } from '../hooks';
import { fileToPhoto } from '../lib/camera';
import { formatDateTime } from '../lib/dates';
import { BarcodeQueue } from '../components/BarcodeQueue';
import { QuickAdd } from '../components/QuickAdd';
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

/**
 * Titles still wanting a decision. Drives "4 still to sort" on a job row.
 *
 * `ownership` rather than `alreadyOwned`: the first is what the catalog says
 * now, the second is what it said when the photo was read. Two photographs of
 * one shelf share boxes, and this number used to keep counting a game the owner
 * had already dealt with on the other photo.
 */
function outstandingOf(job: ScanJob): number | null {
  if (!job.enriched) return null;
  try {
    const titles = JSON.parse(job.enriched) as EnrichedTitle[];
    return titles.filter((t) => !t.ownership && !t.addedItemId && !t.dismissed).length;
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

/*
 * Both of these used to be written out here.
 *
 * They now come from `@bgc/core`, because the server classifies each row by the
 * name it would be saved under and this screen is what decides that name. Two
 * copies of the rule meant the server could propose a parent for one name while
 * the button saved another — see `scanRowName`. Nothing about the behaviour on
 * this screen changed; the definition simply moved to where both callers are.
 */
const isDoubtful = isDoubtfulMatch;
const effectiveName = scanRowName;

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

/**
 * Is this row waiting on a judgement only a person holding the box can make?
 *
 * Three ways to get here and one answer to all of them: show what was found and
 * let the owner say yes. Before this, "no" was the only answer the screen could
 * express — a weak match could be dismissed or retyped, and retyping threw away
 * the BoardGameGeek id, publisher, year and cover that came with it.
 *
 * The third case is the one the owner actually hit: a barcode banded `low`,
 * where the row carries no `resolvedName` at all but the guesses are still on
 * it. The app knew the name and had no way to be told it was right.
 */
const wantsHumanCall = (t: EnrichedTitle): boolean =>
  !t.acceptedMatch &&
  (t.candidates?.length ?? 0) > 0 &&
  (isDoubtful(t) || !!t.needsConfirmation || t.resolvedName == null);

/**
 * An unconfirmed row from before suggestions were kept.
 *
 * Rows enriched by the old code carry a match and no candidate list, so there
 * is nothing to offer — and the owner has six real jobs sitting at review in
 * exactly that state. Pressing "Look up again" re-asks and stores the list, so
 * the way out is one click; without saying so, the screen would simply look
 * like it lacked the feature on the rows that need it most.
 */
const needsRelookupToAccept = (t: EnrichedTitle): boolean =>
  !t.acceptedMatch &&
  (t.candidates?.length ?? 0) === 0 &&
  (isDoubtful(t) || !!t.needsConfirmation);

/**
 * Why this row wants nothing from you — in the words that make it read as
 * progress rather than as a loss.
 *
 * The owner's complaint was that two photographs of one shelf argued with each
 * other: resolve a box on one and the other went on offering it. It no longer
 * does — but a row that silently changed its mind and now says "already yours"
 * is only half an answer, and the missing half is *you* did that, a minute ago,
 * on the other photo.
 */
function ownershipNote(o: TitleOwnership, jobMode: ScanJob['mode']): string {
  if (o.via === 'catalog') return 'Already in your collection';
  if (o.via === 'this-job') {
    return jobMode === 'barcode'
      ? 'Added from another scan in this batch'
      : 'Added from another line on this photo';
  }
  return o.jobMode === 'barcode' ? 'Added from a barcode scan' : 'Added from another photo';
}

function OwnershipNote({ o, jobMode }: { o: TitleOwnership; jobMode: ScanJob['mode'] }) {
  return (
    <span className="muted small">
      {ownershipNote(o, jobMode)} &mdash;{' '}
      <Link to={`/items/${o.itemId}`}>{o.name}</Link>
    </span>
  );
}

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
 * The four ways to add a game, ordered by how certain each one is.
 *
 * **Barcode is first because it is the only exact identification this app
 * has.** A code carries a check digit and names one printing; reading a title
 * off a box is a guess, and this catalog has had Brink, Iliad and Moon matched
 * to the wrong games at a perfect 1.00 similarity. The photo paths are the
 * fallback for boxes with no code — which is a large slice of a mostly
 * crowdfunded collection, so they are not a lesser feature, just a later rung.
 *
 * **Typing is last, and it is here at all because it is the same job.** It used
 * to be a separate button in the collection header called "Type a name", which
 * made a screen headed "Add games" the place where you could do three of the
 * four ways of adding a game. The owner's words: *add a game and type a name
 * are the same thing.* Every way in now lives on one screen.
 *
 * It is the one tab that does not create a scan job, and deliberately so: a
 * typed name is already an unambiguous answer, and pushing it through a review
 * queue would ask a person to confirm what they had just typed. The queue below
 * exists to hold readings that need a judgement — this tab has none to hold.
 */
const ADD_MODES: { id: AddMode; label: string; blurb: string }[] = [
  { id: 'barcode', label: 'Barcode', blurb: 'Exact, free, and keeps scanning. Best when the box has one.' },
  { id: 'shelf', label: 'Shelf photo', blurb: 'Reads every spine at once. Best for bulk.' },
  { id: 'single', label: 'One box', blurb: 'Reads the title off a single cover.' },
  { id: 'manual', label: 'Type a name', blurb: 'No code, no box to hand. Looks the rest up as you type.' },
];

export function ScanJobsPage({ me, add }: { me: MeResponse; add?: AddMode | null }) {
  const [jobs, refresh] = useAsync(() => api.scanJobs(), []);
  const [live, setLive] = useState<ScanJob[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Barcode by default, and `?add=` lets an entry point elsewhere land straight
  // on the right tab — `/scan` points here with `?add=barcode`, and `?add=manual`
  // is what an old "Type a name" link should now be aimed at.
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
            Scan a barcode, photograph a shelf, or type a name — every way in is a tab
            below. Anything read off a code or a photo lands in the queue and waits
            there until you have dealt with it, so nothing disappears because you only
            got through half.
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
        ) : mode === 'manual' ? (
          // The same component the check screen uses, not a second copy of the
          // form: it already keeps focus in the name field, holds status and
          // quantity steady between saves, and offers a lookup on what you have
          // typed so far. Nothing about it is specific to where it is mounted.
          <QuickAdd />
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

  /**
   * Is there anything left to stop?
   *
   * The three processing statuses, plus a job parked at `read` with titles still
   * to look up — that one *is* working, because the queue page asks for its next
   * chunk on its own, and dropping Stop there would leave a 73-title shelf with
   * no way out between chunks. `review`, `done` and `failed` have nothing in
   * flight; a failed job is set aside with Delete, or restarted with Retry.
   */
  const isWorking = isProcessing || (job.status === 'read' && unfinished);

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
            takes the reading with it.

            Only while there is something to stop. It used to show on every job
            that was not `done` — including one sitting at `review` waiting for
            you, and one that had already failed — where pressing it does
            nothing you would recognise as stopping. A control that does not act
            is worse than no control: it invites the click and then has to
            explain itself. */}
        {isWorking && (
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
  //
  // A row belongs in the "already owned" list only if it was owned when the
  // photo was read *and* the catalog still holds it. The second half matters
  // because ownership is now answered fresh: a game deleted since is genuinely
  // outstanding again, and hiding it in a list headed "already in your
  // collection" would be the same stale claim in the other direction.
  //
  // Rows that became owned *after* enrichment stay in the list below instead,
  // ticked off and saying why — see `isSettled`.
  const freshEntries = titles
    .map((t, originalIndex) => ({ t, originalIndex }))
    .filter((e) => !(e.t.alreadyOwned && e.t.ownership));
  const fresh = freshEntries.map((e) => e.t);
  const owned = titles.filter((t) => t.alreadyOwned && t.ownership);

  /** What already happened to this row, whether this visit or a previous one. */
  const outcomeOf = (i: number): { itemId: number } | { error: string } | null => {
    const local = results[i];
    if (local) return local;
    const persisted = fresh[i]?.addedItemId;
    return persisted ? { itemId: persisted } : null;
  };

  /*
   * Settled, by any of the three routes there are.
   *
   * `ownership` is the one that is not a decision made here: the game reached
   * the catalog some other way — most often the *other* photograph of this same
   * shelf — and asking about it again would be asking the owner to decide
   * something they have already decided.
   *
   * The row stays where it is rather than moving to the "already owned" list
   * below, on purpose. It is index-addressed (`freshEntries` carries the
   * server's index for it) and, more importantly, a row that vanishes reads as
   * lost work where a row that ticks itself and says why reads as progress.
   */
  const isSettled = (i: number): boolean =>
    outcomeOf(i) !== null || !!fresh[i]?.dismissed || !!fresh[i]?.ownership;
  const outstanding = fresh.filter((_, i) => !isSettled(i));
  const resolvedElsewhere = fresh.filter((t) => t.ownership).length;

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
          // Written down because the two are not the same evidence, and a month
          // from now nothing else would tell them apart: a verified lookup said
          // this is the game, an accepted guess means somebody read the box and
          // agreed. If the identity is ever questioned, this is where the
          // question starts.
          notes: t.acceptedMatch
            ? `Identity confirmed by hand at review on ${new Date().toISOString().slice(0, 10)} — the lookup was not confident.`
            : null,
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

  /**
   * "I have looked at the box. It is that one."
   *
   * Promotes a suggestion to the row's identity on the server, so the decision
   * survives a reload and is recorded on the copy when the game is added. The
   * row ticks itself afterwards: a person who just confirmed a match should not
   * then have to remember to select it.
   */
  async function acceptMatch(i: number, candidate: number) {
    setBusyRow(i);
    setError(null);
    try {
      const { job: saved } = await api.acceptScanJobTitle(
        id,
        freshEntries[i]!.originalIndex,
        candidate,
      );
      setLive(saved);
      setSelected((prev) => new Set(prev!).add(i));
    } catch (err) {
      setError(err);
    } finally {
      setBusyRow(null);
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
            {/* Said out loud, because it is the number that changed while the
                owner was working on a different photo. */}
            {resolvedElsewhere > 0 && ` \u00b7 ${resolvedElsewhere} settled elsewhere`}
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
              // Dealt with somewhere else since this photo was read. Every
              // control below is suppressed for it: there is nothing left to
              // decide, and offering to add it again is the whole bug.
              const settled = !result && !dismissed ? (t.ownership ?? null) : null;

              return (
                <li
                  key={i}
                  className={
                    dismissed || settled
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
                  ) : settled ? (
                    <span className="shelf-outcome" aria-hidden="true">&#10003;</span>
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
                    <img src={t.thumbnailUrl} alt="" className="candidate__thumb" loading="lazy" />
                  )}

                  <div className="candidate__body">
                    <strong>{effectiveName(t)}</strong>
                    {/* First line under the name, because it is the answer to
                        "what am I looking at" — everything else on this row is
                        about a decision that no longer needs making. */}
                    {settled && <OwnershipNote o={settled} jobMode={job.mode} />}
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

                    {/* Said plainly, because it is a claim about the catalog:
                        this identity was not established by a lookup, it was
                        established by a person looking at a box. The same
                        sentence is written onto the copy when the game is
                        added. */}
                    {t.acceptedMatch && (
                      <span className="muted small">
                        Confirmed by hand — the lookup was not sure.
                      </span>
                    )}

                    {/*
                      The answer the screen used not to have.

                      A weak match could be dismissed or retyped, and retyping
                      threw away the BoardGameGeek id, publisher, year and cover
                      that came with it. Each suggestion says its name, year and
                      publisher, because a wrong accept writes a bad identity
                      into the catalog — this project has done that three times
                      (Brink, Iliad and Moon, all perfect 1.00 name matches to
                      the wrong game) and none of them would have survived
                      being read out loud next to the box.
                    */}
                    {!result && !dismissed && !settled && wantsHumanCall(t) && (
                      <div className="candidate__accept">
                        <span className="muted small">
                          {t.barcode
                            ? 'Nobody has confirmed this code. If one of these is the box in your hand, say so:'
                            : 'Not sure enough to tick for you. If one of these is the game, say so:'}
                        </span>
                        <ul className="suggest-list">
                          {t.candidates!.map((cand, ci) => (
                            <li key={`${cand.bggId ?? cand.name}-${ci}`} className="suggest">
                              {cand.thumbnailUrl && (
                                <img
                                  src={cand.thumbnailUrl}
                                  alt=""
                                  className="suggest__thumb"
                                  loading="lazy"
                                />
                              )}
                              <span className="suggest__body">
                                <strong>{cand.name}</strong>
                                <span className="muted small">
                                  {[
                                    cand.yearPublished ? String(cand.yearPublished) : null,
                                    cand.publisher,
                                    cand.bggId ? `BGG ${cand.bggId}` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') || 'no other details'}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn btn-quiet btn-xs"
                                disabled={adding || busyRow === i}
                                onClick={() => void acceptMatch(i, ci)}
                              >
                                Yes, this one
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!result && !dismissed && !settled && needsRelookupToAccept(t) && (
                      <span className="muted small">
                        This one was looked up before suggestions were kept. Press
                        &ldquo;Look up again&rdquo; and you can accept a match rather than
                        retyping it.
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
                    {!result && !dismissed && !settled && (
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
                        {/* Suppressed when suggestions are on offer above: the
                            row is not empty, it is unconfirmed, and telling
                            somebody "nothing was found" directly beneath a list
                            of what was found reads as a broken screen. */}
                        {unresolved && !wantsHumanCall(t) && (
                          <span className="muted small">
                            {t.barcode
                              ? 'Nothing found for this code, so there is no name to add it under yet — type one above.'
                              : 'Nothing found for this one — it will be added under the name read off the spine.'}
                          </span>
                        )}
                      </div>
                    )}

                    {dismissed && <span className="muted small">Set aside.</span>}

                    {!result && !dismissed && !settled && (
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
                {/* The freshly resolved item, not the one enrichment wrote
                    down: a game renamed since would otherwise be listed under
                    a name the catalog no longer uses. */}
                <Link to={`/items/${t.ownership!.itemId}`}>{t.ownership!.name}</Link>{' '}
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
                {/* Where it came from, when it did not simply predate the
                    photo. "Already owned" is true and unhelpful if the reason
                    is that the owner added it from the other photo minutes
                    ago. */}
                {t.ownership!.via !== 'catalog' && (
                  <span className="muted small">
                    {' · '}
                    {ownershipNote(t.ownership!, job.mode).toLowerCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
