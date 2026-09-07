import { useCallback, useRef, useState } from 'react';
import { api, describeError, type EnrichedTitle, type ScanJob } from '../api';
import { fileToImageSource } from '../lib/camera';
import { decodeStill, preloadDecoder, startScanLoop } from '../lib/scanner';
import { replaceByCode } from '../lib/scan-rows';
import { CameraStage } from './CameraStage';
import { Badge, ErrorBox } from './ui';
import { Link } from '../router';

/**
 * Scanning box after box, straight onto the queue.
 *
 * The camera does not stop between codes and nothing is confirmed at scan time
 * — that is what the review screen is for. Ten boxes should be ten scans, not
 * ten round trips through a form.
 *
 * Three things make it trustworthy while you are looking at the boxes rather
 * than the phone:
 *
 * 1. **A running list**, newest first, saying what each code turned into.
 * 2. **A beep**, because the whole point is not watching the screen. Different
 *    pitches for queued / already-owned / not-found, so you can work by ear.
 * 3. **One code, one line.** See `acceptedRef` below — this is the bug this
 *    feature would otherwise ship with.
 */

type RowState = 'pending' | 'queued' | 'check' | 'owned' | 'unknown' | 'unreachable' | 'error';

interface Row {
  code: string;
  state: RowState;
  name?: string | null;
  ownedQuantity?: number | null;
  existingItemId?: number | null;
  detail?: string;
}

const STATE_LABEL: Record<RowState, string> = {
  pending: 'Looking up…',
  queued: 'Queued',
  check: 'Queued · check at review',
  owned: 'Already yours',
  unknown: 'Not in any database',
  unreachable: 'Lookup unavailable',
  error: 'Failed',
};

const STATE_TONE: Record<RowState, 'neutral' | 'owned' | 'wanted' | 'kind'> = {
  pending: 'neutral',
  queued: 'owned',
  check: 'neutral',
  owned: 'kind',
  unknown: 'wanted',
  unreachable: 'wanted',
  error: 'wanted',
};

/**
 * What a returned line actually says.
 *
 * Two distinctions here are worth more than they look:
 *
 * - `lookupFailed` is not "nothing found". A quota exhaustion recorded as "this
 *   game does not exist" is a lie that outlives the outage, and this project has
 *   been bitten by exactly that before.
 * - `needsConfirmation` is not "found". GameUPC answers an unknown code with
 *   fifteen confident-looking guesses, so a band below `high` means *probably*,
 *   and the person holding the box is the one who can settle it.
 */
function stateOf(title: EnrichedTitle): RowState {
  // A containment-kind ownership claim is a GUESS ("Boss Monster 2" contains
  // "Boss Monster") and the review screen will ask "same game?" rather than
  // file it. Announcing "Already yours" here — with the lower you-have-it beep
  // — would have the person shelve a box the queue is still asking about.
  if (title.alreadyOwned) return title.matchKind === 'containment' ? 'check' : 'owned';
  if (title.lookupFailed) return 'unreachable';
  if (!title.resolvedName) return 'unknown';
  return title.needsConfirmation ? 'check' : 'queued';
}

/**
 * A short tone per outcome. Web Audio, so there is no asset to serve and no
 * CSP question; the context is created inside a click handler, which is what
 * iOS requires before it will make any sound at all.
 */
function useBeeper() {
  const ctxRef = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    if (ctxRef.current) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctxRef.current = new Ctor();
    } catch {
      // No audio is a degraded experience, never a broken one.
    }
  }, []);

  const beep = useCallback((hz: number, ms = 90) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch {
      /* ignore */
    }
  }, []);

  return { unlock, beep };
}

const TONE: Record<RowState, number> = {
  pending: 0,
  queued: 880,
  check: 740, // between "got it" and "you have it": stop and look at this one
  owned: 620, // lower, so "you already have this" is audibly not a new game
  unknown: 330,
  unreachable: 330,
  error: 220,
};

export function BarcodeQueue({
  onQueueChanged,
  onWantPhoto,
}: {
  /** A job was opened or appended to, so the list below should refetch. */
  onQueueChanged: () => void;
  /** Nothing knew a code — offer the photo path without leaving the page. */
  onWantPhoto: () => void;
}) {
  const [active, setActive] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [job, setJob] = useState<ScanJob | null>(null);
  const [error, setError] = useState<unknown>(null);

  const stopLoopRef = useRef<(() => void) | null>(null);
  const { unlock, beep } = useBeeper();

  /**
   * Every code accepted in this session, for the whole session.
   *
   * Not a few-second cooldown, which is the obvious version and is not enough:
   * after the cooldown expires the box is usually *still in front of the
   * camera*, the two confirmations rebuild instantly, and one box becomes five
   * queue entries. The cost of remembering permanently is that a second,
   * genuinely identical copy has to be recorded as a quantity at review rather
   * than by scanning it twice — much the better trade, and the server refuses
   * the duplicate as well.
   */
  const acceptedRef = useRef<Set<string>>(new Set());

  /**
   * One request at a time, in scan order.
   *
   * Each append is a read-modify-write of the job's title list, so two in
   * flight at once would lose one of them. The camera does not wait for this
   * chain — scanning stays live while the lookups catch up behind it.
   */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const jobIdRef = useRef<number | null>(null);

  const submit = useCallback(
    async (code: string) => {
      try {
        const res = await api.scanBarcodeToQueue(code, jobIdRef.current);
        jobIdRef.current = res.job.id;
        setJob(res.job);
        const state = stateOf(res.title);
        setRows((prev) =>
          prev.map((r) =>
            r.code === code && r.state === 'pending'
              ? {
                  code,
                  state,
                  name: res.title.resolvedName ?? res.title.existingName ?? res.title.title,
                  ownedQuantity: res.title.ownedQuantity ?? null,
                  existingItemId: res.title.existingItemId,
                  detail: res.title.reason ?? undefined,
                }
              : r,
          ),
        );
        beep(TONE[state]);
        onQueueChanged();
      } catch (err) {
        // A failed request must not stop the camera; it is one line, reported
        // on its own row, and the next box is already coming.
        const detail = describeError(err);
        setRows((prev) =>
          prev.map((r) =>
            r.code === code && r.state === 'pending' ? { ...r, state: 'error', detail } : r,
          ),
        );
        beep(TONE.error);
        // Allow a retry by pointing at the same box again.
        acceptedRef.current.delete(code);
      }
    },
    [beep, onQueueChanged],
  );

  const accept = useCallback(
    (code: string) => {
      if (acceptedRef.current.has(code)) return;
      acceptedRef.current.add(code);
      // ⚠️ REPLACE, never prepend. The only way to reach `accept` twice with
      // one code is a retry after a failure, and the failed row KEPT that code
      // — so a plain prepend gave two `<li>` the same React key, and left the
      // stale `error` row sitting above the new answer, contradicting it. See
      // `lib/scan-rows.ts`. 2026-08 audit, finding 16.
      setRows((prev) => replaceByCode(prev, { code, state: 'pending' }));
      chainRef.current = chainRef.current.then(() => submit(code));
    },
    [submit],
  );

  const onReady = useCallback(
    (video: HTMLVideoElement) => {
      stopLoopRef.current?.();
      stopLoopRef.current = startScanLoop({
        video,
        continuous: true,
        ignore: (code) => acceptedRef.current.has(code),
        onScan: ({ code }) => accept(code),
        onError: () => undefined, // a frame that will not decode is normal
      });
    },
    [accept],
  );

  const stop = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    setActive(false);
  }, []);

  /**
   * The path for when `getUserMedia` will not play.
   *
   * Camera access has been a recurring problem on iOS in this project — an
   * in-app browser whose host never wired up the media-capture delegate, an
   * insecure origin, a permission the owner declined once — and until now the
   * barcode tab had no way through any of them, because the still decoder
   * existed and nothing called it. One photo per code is slower than the live
   * loop and infinitely faster than not being able to scan.
   */
  const decodeFile = useCallback(
    async (file: File) => {
      setError(null);
      unlock();
      let handle: { source: CanvasImageSource; release: () => void } | null = null;
      try {
        handle = await fileToImageSource(file);
        const scan = await decodeStill(handle.source);
        if (!scan) {
          setError(
            new Error(
              'No barcode could be read in that picture. Fill more of the frame with the code, straight on, and avoid glare.',
            ),
          );
          return;
        }
        if (acceptedRef.current.has(scan.code)) {
          setError(new Error(`${scan.code} is already on this list.`));
          return;
        }
        accept(scan.code);
      } catch (err) {
        setError(err);
      } finally {
        handle?.release();
      }
    },
    [accept, unlock],
  );

  const queued = rows.filter((r) => r.state === 'queued' || r.state === 'check').length;
  const nothingKnown = rows.some((r) => r.state === 'unknown');

  return (
    <div className="barcode-queue">
      <CameraStage
        active={active}
        hint="Point at the barcode and hold still. It keeps scanning — work through the stack without tapping anything."
        onStart={() => {
          setError(null);
          unlock(); // must happen inside the click, or iOS stays silent
          preloadDecoder();
          setActive(true);
        }}
        onReady={onReady}
        onStop={() => {
          stopLoopRef.current?.();
          stopLoopRef.current = null;
        }}
      />

      {active && (
        <div className="barcode-queue__bar">
          <span className="muted small">
            Scanning{rows.length > 0 ? ` · ${rows.length} read` : '…'}
          </span>
          <button type="button" className="btn btn-quiet" onClick={stop}>
            Stop scanning
          </button>
        </div>
      )}

      {!active && (
        <label className="scan-fallback">
          <span className="muted">
            Camera not working? Photograph one barcode at a time, or pick a picture
            you already have — nothing taken here is saved to your library.
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void decodeFile(file);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {error != null && <ErrorBox error={error} what="Scan" />}

      {rows.length > 0 && (
        <>
          <ul className="scanned-list">
            {rows.map((r) => (
              <li key={r.code} className={`scanned-row scanned-row--${r.state}`}>
                <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge>
                <div className="scanned-row__body">
                  <strong>{r.name ?? r.code}</strong>
                  <span className="muted small">
                    <code>{r.code}</code>
                    {r.state === 'owned' && r.ownedQuantity != null && (
                      <>
                        {' · '}
                        {r.ownedQuantity === 0
                          ? 'catalogued, none marked owned'
                          : `${r.ownedQuantity} held`}
                      </>
                    )}
                  </span>
                  {r.detail && <span className="muted small">{r.detail}</span>}
                  {r.existingItemId != null && (
                    <Link to={`/items/${r.existingItemId}`}>Open it</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/*
            A dead end here is a common experience, not an edge case: most of
            this catalog is crowdfunding, and those boxes frequently carry no
            retail barcode at all. So the alternative is offered in the same
            breath rather than left to be discovered.
          */}
          {nothingKnown && (
            <p className="scan-note">
              Some of those are in no free database — they are on the queue under
              whatever retail title we could find, to be named at review.{' '}
              <button type="button" className="linklike" onClick={onWantPhoto}>
                Photograph the box instead
              </button>{' '}
              if you would rather have the title read off the cover.
            </p>
          )}

          {job && (
            <div className="barcode-queue__done">
              <Link to={`/scan-jobs/${job.id}`} className="btn btn-primary">
                Review {queued > 0 ? `${queued} scanned game${queued === 1 ? '' : 's'}` : 'this batch'}
              </Link>
              <span className="muted small">
                Nothing is added to the collection until you review it.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
