import { useCallback, useRef, useState } from 'react';
import { PHOTO_LONG_EDGE, type BarcodeCandidate, type Item } from '@bgc/core';
import { api, type BarcodeLookup } from '../api';
import { captureFrame, fileToPhoto, onceSteady } from '../lib/camera';
import { preloadDecoder, startScanLoop } from '../lib/scanner';
import { createItemFromCandidate, copyDefaults } from '../lib/catalog-add';
import { CameraStage } from './CameraStage';
import { Link } from '../router';
import { ErrorBox, Spinner } from './ui';

/**
 * Wanting the box in your hands.
 *
 * *"for wishlist add, utilize our existing technology for scanning barcodes and
 * individual photos to add games to it."* — the owner.
 *
 * ⚠️ **This reverses a decision recorded on `WishlistPage`**, which said that
 * sending somebody to the scanner to record something they do not have was
 * "always the wrong direction — that page is for boxes in your hand". The
 * observation was right and the conclusion was half of one: standing in a shop
 * holding a box you have *not* bought is precisely a box in your hand, and it is
 * the single commonest way a thing gets wanted. What was wrong was sending them
 * to `/scan`, which adds what it finds as **owned** and navigates away. So the
 * camera comes here instead of the page sending people there.
 *
 * ## It reuses the rungs rather than reimplementing them
 *
 * `startScanLoop`, `captureFrame`, `CameraStage` and `api.barcode` /
 * `api.identifyPhoto` are the same ones `/scan` uses, in the same order and for
 * the same reasons: a barcode is exact and free and comes back in about a
 * second, a photo reads the title off the cover in three to five. The slow paid
 * rung — Claude on a barcode number, one to two minutes — is deliberately *not*
 * offered here. It exists for a box you own and cannot identify; it is far too
 * much to spend on deciding whether to want something.
 *
 * Photos are never stored. Captured from a live frame, uploaded, read, dropped.
 */
export function WishlistScan({
  mode,
  onAdded,
  onError,
}: {
  mode: 'barcode' | 'photo';
  /** The item that just became wanted — the caller offers its expansions next. */
  onAdded: (item: Item, message: string) => void;
  onError: (err: unknown) => void;
}) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lookup, setLookup] = useState<BarcodeLookup | null>(null);
  const [candidates, setCandidates] = useState<BarcodeCandidate[] | null>(null);

  const stopLoopRef = useRef<(() => void) | null>(null);
  const stopSteadyRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopEverything = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    stopSteadyRef.current?.();
    stopSteadyRef.current = null;
    setActive(false);
  }, []);

  const reset = useCallback(() => {
    setLookup(null);
    setCandidates(null);
    setNote(null);
    setError(null);
  }, []);

  const shoot = useCallback(
    async (video: HTMLVideoElement) => {
      setBusy('Reading the box…');
      setError(null);
      try {
        const photo = await captureFrame(video, PHOTO_LONG_EDGE);
        stopEverything();
        const res = await api.identifyPhoto(photo);
        setCandidates(res.candidates);
        if (res.unreadable || res.candidates.length === 0) {
          setNote(
            'Could not read that one. Fill more of the frame with the box, and keep glare off the title.',
          );
        }
      } catch (err) {
        setError(err);
      } finally {
        setBusy(null);
      }
    },
    [stopEverything],
  );

  const onReady = useCallback(
    (video: HTMLVideoElement) => {
      videoRef.current = video;
      if (mode === 'barcode') {
        stopLoopRef.current?.();
        stopLoopRef.current = startScanLoop({
          video,
          onScan: async ({ code }) => {
            stopEverything();
            setBusy('Looking that barcode up…');
            try {
              setLookup(await api.barcode(code));
            } catch (err) {
              setError(err);
            } finally {
              setBusy(null);
            }
          },
          onError: () => undefined, // a frame that will not decode is normal
        });
        return;
      }
      stopSteadyRef.current?.();
      stopSteadyRef.current = onceSteady(video, () => void shoot(video));
    },
    [mode, shoot, stopEverything],
  );

  /**
   * Put one candidate on the wishlist.
   *
   * The item may already exist — a barcode we have seen before resolves to a
   * catalog row — and then wanting it is a fact about a *copy*, so a copy is
   * the only thing created. Owning one and wanting another are both true at
   * once, which is how the `×2` rows on this list came about in the first
   * place.
   */
  async function want(candidate: BarcodeCandidate, existing: Item | null) {
    setBusy(`Adding ${candidate.name}…`);
    setError(null);
    try {
      const item = existing ?? (await createItemFromCandidate(candidate));
      await api.createCopy(item.id, copyDefaults('wanted'));
      onAdded(item, `“${item.name}” is on the wishlist.`);
    } catch (err) {
      setError(err);
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  const matched = lookup?.match?.item ?? null;
  const showResults = lookup != null || candidates != null;

  return (
    <div className="wishlist-scan">
      {!showResults && (
        <>
          <CameraStage
            active={active}
            hint={
              mode === 'barcode'
                ? 'Hold the barcode steady and fill the frame. No flash on iPhone — find good light.'
                : 'Fill the frame with the front of the box.'
            }
            onStart={() => {
              reset();
              preloadDecoder();
              setActive(true);
            }}
            onReady={onReady}
            onStop={() => {
              stopLoopRef.current?.();
              stopLoopRef.current = null;
            }}
          >
            {mode === 'photo' && (
              <div className="camera-stage__actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy != null}
                  onClick={() => {
                    // Tapping is an override: cancel the watcher so it cannot
                    // fire a second shot a moment later.
                    stopSteadyRef.current?.();
                    stopSteadyRef.current = null;
                    if (videoRef.current) void shoot(videoRef.current);
                  }}
                >
                  Read this box
                </button>
              </div>
            )}
          </CameraStage>

          {/* The way in on a desktop, and the way back in on a phone whose
              camera the browser will not open. `fileToPhoto` does the same
              downscale `captureFrame` does, so the upload is the same size. */}
          {!active && mode === 'photo' && (
            <label className="btn btn-quiet wishlist-scan__file">
              Choose a photo instead
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={busy != null}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy('Reading…');
                  setError(null);
                  try {
                    const res = await api.identifyPhoto(await fileToPhoto(file, PHOTO_LONG_EDGE));
                    setCandidates(res.candidates);
                    if (res.candidates.length === 0) setNote('Nothing readable in that photo.');
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </label>
          )}
        </>
      )}

      {busy && <Spinner label={busy} />}
      {error != null && <ErrorBox error={error} what="That did not work" />}
      {note && <p className="scan-note">{note}</p>}

      {/* Already in the catalog. Said plainly rather than hidden, because it is
          the answer to a question worth asking in a shop — and it does not stop
          you wanting another, which is a real case for a game you lend out. */}
      {matched && (
        <div className="scan-result scan-result--owned">
          <h2>{matched.name}</h2>
          <p className="muted small">
            Already in the catalog. Adding it here records that you want{' '}
            <strong>another</strong> one.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy != null}
              onClick={() =>
                void want({ name: matched.name, bggId: matched.bggId } as BarcodeCandidate, matched)
              }
            >
              Want another
            </button>
            <Link to={`/items/${matched.id}`} className="btn btn-quiet">
              Open it
            </Link>
          </div>
        </div>
      )}

      {showResults && (
        <CandidateList
          candidates={candidates ?? lookup?.candidates ?? []}
          busy={busy != null}
          emptyNote={
            matched
              ? null
              : mode === 'barcode'
                ? 'Nothing known for that barcode. Try the photo tab — it reads the title off the cover.'
                : 'No match. Try typing the name instead.'
          }
          onWant={(c) => void want(c, null)}
          onAgain={() => {
            reset();
            setActive(true);
          }}
        />
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  busy,
  emptyNote,
  onWant,
  onAgain,
}: {
  candidates: BarcodeCandidate[];
  busy: boolean;
  emptyNote: string | null;
  onWant: (candidate: BarcodeCandidate) => void;
  onAgain: () => void;
}) {
  return (
    <div className="wishlist-scan__results">
      {candidates.length === 0 && emptyNote && <p className="muted small">{emptyNote}</p>}

      {candidates.map((candidate, i) => (
        <div className="quickadd-hint" key={`${candidate.bggId ?? 'x'}-${i}`}>
          {candidate.thumbnailUrl && (
            <img src={candidate.thumbnailUrl} alt="" className="quickadd-hint__thumb" />
          )}
          <span className="quickadd-hint__body">
            <strong>{candidate.name}</strong>
            <span className="muted small">
              {[candidate.publisher, candidate.yearPublished].filter(Boolean).join(' · ')}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onWant(candidate)}
          >
            + Wishlist
          </button>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onAgain}>
          Scan another
        </button>
      </div>
    </div>
  );
}
