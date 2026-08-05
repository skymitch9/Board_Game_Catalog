import { useCallback, useState } from 'react';
import {
  ITEM_KINDS,
  MIN_SPINE_SIMILARITY,
  SHELF_LONG_EDGE,
  PHOTO_LONG_EDGE,
  type Item,
  type ItemKind,
  type MeResponse,
} from '@bgc/core';
import { api, type EnrichedTitle, type ScanJob } from '../api';
import { useAsync, useInterval } from '../hooks';
import { fileToPhoto } from '../lib/camera';
import { KIND_LABEL } from '../components/ItemTree';
import { Badge, ErrorBox, Spinner } from '../components/ui';
import { Link } from '../router';

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
  t.resolvedName != null && t.similarity != null && t.similarity < MIN_SPINE_SIMILARITY;

/**
 * The name to actually save.
 *
 * A doubtful match falls back to what was read off the spine. Ticking one means
 * "this game is on my shelf", not "and it is that other game" — so the title
 * survives and the lookup's identity does not.
 */
const effectiveName = (t: EnrichedTitle): string =>
  isDoubtful(t) ? t.title : (t.resolvedName ?? t.title);

const STATUS_TONE: Record<ScanJob['status'], 'neutral' | 'owned' | 'wanted' | 'kind'> = {
  uploaded: 'neutral',
  reading: 'neutral',
  read: 'neutral',
  enriching: 'neutral',
  review: 'owned',
  done: 'kind',
  failed: 'wanted',
};

export function ScanJobsPage({ me }: { me: MeResponse }) {
  const [jobs, refresh] = useAsync(() => api.scanJobs(), []);
  const [live, setLive] = useState<ScanJob[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'shelf' | 'single'>('shelf');

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

  // Deliberately does not swallow its own failures: the uploader below runs the
  // decode and the upload in one loop, and both fail the same way to the person
  // holding the phone, so both are reported from one place.
  const upload = useCallback(async (data: string, mediaType: string) => {
    setUploading(true);
    try {
      await api.createScanJob({ data, mediaType, mode });
      reload();
    } finally {
      setUploading(false);
    }
  }, [mode, reload]);

  const canEdit = me.capabilities.includes('editCatalog');
  if (!canEdit) {
    return <p className="muted">Only editors can use scan jobs.</p>;
  }

  return (
    <div className="scan-jobs-page">
      <header className="page-head">
        <div>
          <h1>Photo Queue</h1>
          <p className="subtitle">
            Upload photos of shelves or boxes. They get read, looked up, and queued for your review.
          </p>
        </div>
        <Link to="/" className="btn btn-quiet">Collection</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Upload" />}

      <section className="card">
        <div className="section-head">
          <h2>Upload photos</h2>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'shelf' | 'single')}
            aria-label="Photo mode"
          >
            <option value="shelf">Shelf (many spines)</option>
            <option value="single">Single box</option>
          </select>
        </div>

        <PhotoUploader
          mode={mode}
          uploading={uploading}
          onPhoto={upload}
          onError={setError}
          onStart={() => setError(null)}
        />
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
          <p className="muted">No photos uploaded yet. Take some pictures of your shelves above.</p>
        )}
        {shown !== null && shown.length > 0 && (
          <ul className="job-list">
            {shown.map((job) => (
              <JobRow key={job.id} job={job} onChanged={reload} />
            ))}
          </ul>
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

function JobRow({ job, onChanged }: { job: ScanJob; onChanged: () => void }) {
  const isReviewable = job.status === 'review';
  const isFailed = job.status === 'failed';
  const isProcessing = ['uploaded', 'reading', 'enriching'].includes(job.status);

  return (
    <li className="job-row">
      <div className="job-row__info">
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        <span className="job-row__time">
          {new Date(job.createdAt).toLocaleString()}
        </span>
        <span className="muted">{job.mode === 'shelf' ? 'Shelf' : 'Single box'}</span>
        {isProcessing && <Spinner label="" />}
      </div>
      <div className="job-row__actions">
        {isReviewable && (
          <Link to={`/scan-jobs/${job.id}`} className="btn btn-primary">
            Review
          </Link>
        )}
        {isFailed && (
          <span className="muted small">{job.error ?? 'Unknown error'}</span>
        )}
        {job.status === 'done' && (
          <span className="muted small">Reviewed</span>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-xs"
          onClick={async () => {
            await api.deleteScanJob(job.id);
            onChanged();
          }}
          aria-label="Delete job"
        >
          Delete
        </button>
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

  if (job.status !== 'review' || !job.enriched) {
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
  const fresh = titles.filter((t) => !t.alreadyOwned);
  const owned = titles.filter((t) => t.alreadyOwned);

  // Initialise selection on first render. Doubtful matches start unticked —
  // adding a wrong game is far more annoying to undo than ticking a box.
  if (selected === null) {
    setSelected(new Set(fresh.map((_, i) => i).filter((i) => !isDoubtful(fresh[i]!))));
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
      .filter((i) => !results[i])
      .sort((a, b) => (getKind(a) === 'base' ? 0 : 1) - (getKind(b) === 'base' ? 0 : 1));

    const batchIds: Record<number, number> = {};

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
          isSleeved: false,
          isPunched: false,
        });

        batchIds[i] = item.id;
        setResults((r) => ({ ...r, [i]: { itemId: item.id } }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setResults((r) => ({ ...r, [i]: { error: msg } }));
      }
    }

    // Mark job done.
    try {
      await api.completeScanJob(id);
    } catch {
      // Non-fatal — the items are added.
    }

    setAdding(false);
  }

  const addedCount = Object.values(results).filter((r) => 'itemId' in r).length;
  const pendingCount = [...selected].filter((i) => !results[i]).length;

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
                  selected.size === fresh.length ? new Set() : new Set(fresh.map((_, i) => i)),
                )
              }
            >
              {selected.size === fresh.length ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <ul className="candidate-list shelf-classify">
            {fresh.map((t, i) => {
              const result = results[i];
              const kind = getKind(i);
              const parentId = getParentId(i);
              const doubtful = isDoubtful(t);

              return (
                <li key={i} className={doubtful ? 'candidate candidate--doubtful' : 'candidate'}>
                  {result ? (
                    <span className="shelf-outcome" aria-hidden="true">
                      {'itemId' in result ? '\u2713' : '!'}
                    </span>
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
                        Tick it to add &quot;{t.title}&quot; on its own.
                      </span>
                    ) : (
                      t.resolvedName &&
                      t.resolvedName !== t.title && (
                        <span className="muted">read as &quot;{t.title}&quot;</span>
                      )
                    )}
                    {t.publisher && !doubtful && <span className="muted">{t.publisher}</span>}

                    {!result && (
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
                <span className="muted">read as &quot;{t.title}&quot;</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
