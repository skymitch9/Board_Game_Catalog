import { useCallback, useRef, useState } from 'react';
import {
  PHOTO_LONG_EDGE,
  SHELF_LONG_EDGE,
  type BarcodeCandidate,
  type MeResponse,
  type ShelfMatch,
} from '@bgc/core';
import { api, ApiError, type BarcodeLookup } from '../api';
import { captureFrame, fileToPhoto } from '../lib/camera';
import { preloadDecoder, startScanLoop } from '../lib/scanner';
import { CameraStage } from '../components/CameraStage';
import { Badge, ErrorBox, Spinner } from '../components/ui';
import { Link, navigate } from '../router';

/**
 * Scanning: barcode, one box, or a whole shelf.
 *
 * The ordering here reflects what things actually cost. A barcode lookup hits
 * the local table and two free services and comes back in about a second. A
 * photo takes three to five. Asking Claude about a *barcode number* takes one to
 * two minutes, so it is never automatic — it sits behind a button that says how
 * long it will take.
 *
 * Photos are never stored. They are captured from a live frame, uploaded, read,
 * and dropped; nothing reaches the camera roll and nothing is kept server-side.
 */

type Mode = 'barcode' | 'photo' | 'shelf';

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'barcode', label: 'Barcode', blurb: 'Fastest when the box has one. Free.' },
  { id: 'photo', label: 'One box', blurb: 'Reads the title off the cover. A few seconds.' },
  { id: 'shelf', label: 'Whole shelf', blurb: 'Reads every spine at once. Best for bulk.' },
];

export function ScanPage({ me }: { me: MeResponse }) {
  const [mode, setMode] = useState<Mode>('barcode');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [lookup, setLookup] = useState<BarcodeLookup | null>(null);
  const [candidates, setCandidates] = useState<BarcodeCandidate[] | null>(null);
  const [shelf, setShelf] = useState<ShelfMatch[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** True when the last photo reading was served from a previous identical shot. */
  const [fromCache, setFromCache] = useState(false);

  const stopLoopRef = useRef<(() => void) | null>(null);
  const canResearch = me.capabilities.includes('runResearch');
  const canEdit = me.capabilities.includes('editCatalog');

  const reset = useCallback(() => {
    setLookup(null);
    setCandidates(null);
    setShelf(null);
    setNote(null);
    setError(null);
    setFromCache(false);
  }, []);

  const stopEverything = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    setActive(false);
  }, []);

  // --- barcode -------------------------------------------------------------

  const onBarcodeReady = useCallback(
    (video: HTMLVideoElement) => {
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
    },
    [stopEverything],
  );

  // --- photo / shelf -------------------------------------------------------

  const shoot = useCallback(
    async (video: HTMLVideoElement, which: 'photo' | 'shelf') => {
      setBusy(which === 'photo' ? 'Reading the box…' : 'Reading the shelf…');
      setError(null);
      try {
        const photo = await captureFrame(
          video,
          which === 'photo' ? PHOTO_LONG_EDGE : SHELF_LONG_EDGE,
        );
        stopEverything();
        if (which === 'photo') {
          const res = await api.identifyPhoto(photo);
          setCandidates(res.candidates);
          setFromCache(res.cached === true);
          if (res.unreadable || res.candidates.length === 0) {
            setNote(
              'Could not read that one. Try filling more of the frame with the box, and avoid glare on the title.',
            );
          }
        } else {
          const res = await api.readShelf(photo);
          setShelf(res.matches);
          setFromCache(res.cached === true);
          if (res.unreadable || res.matches.length === 0) {
            setNote('No titles were legible. Try getting closer, or straighter on to the spines.');
          }
        }
      } catch (err) {
        setError(err);
      } finally {
        setBusy(null);
      }
    },
    [stopEverything],
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onReady = useCallback(
    (video: HTMLVideoElement) => {
      videoRef.current = video;
      if (mode === 'barcode') onBarcodeReady(video);
    },
    [mode, onBarcodeReady],
  );

  // --- the slow rung -------------------------------------------------------

  const askClaude = useCallback(async (barcode: string) => {
    setBusy('Searching the web. This usually takes a minute or two…');
    setError(null);
    try {
      const res = await api.identifyBarcode(barcode);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setNote('Nothing found for that barcode. Try the photo mode instead — it reads the title.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }, []);

  // --- adding --------------------------------------------------------------

  /**
   * Add one candidate to the collection.
   *
   * `goToItem` is false for shelf mode. Navigating away after a single add threw
   * away every other title the photo found, which made a nine-game shelf photo
   * strictly worse than typing nine names — the whole point is bulk intake.
   */
  const addCandidate = useCallback(
    async (
      candidate: BarcodeCandidate,
      barcode: string | null,
      goToItem = true,
    ): Promise<number | null> => {
      if (goToItem) setBusy(`Adding ${candidate.name}…`);
      setError(null);
      try {
        // An expansion needs a parent, and we do not know it from a scan. Create
        // it as its own entry and say so — nesting is a deliberate choice the
        // user makes in the item editor.
        const detectedNonBase = candidate.kind !== 'base';
        const { item } = await api.createItem({
          name: candidate.name,
          kind: 'base',
          bggId: candidate.bggId,
          yearPublished: candidate.yearPublished,
          publisher: candidate.publisher,
          thumbnailUrl: candidate.thumbnailUrl,
          minPlayers: candidate.minPlayers,
          maxPlayers: candidate.maxPlayers,
          playtimeMin: candidate.playtimeMin,
          description: candidate.description,
        });

        if (barcode && canEdit) {
          await api
            .linkBarcode({
              itemId: item.id,
              barcode,
              editionName: candidate.editionName,
              bggId: candidate.bggId,
              updateUrl: lookup?.updateUrls?.[candidate.bggId ?? -1] ?? null,
            })
            .catch(() => undefined); // the game is added; a failed link is not fatal
        }

        if (detectedNonBase) {
          setNote(
            `Added "${candidate.name}". It looks like a ${candidate.kind} — open it to nest it under its base game.`,
          );
        }
        if (goToItem) navigate(`/items/${item.id}`);
        return item.id;
      } catch (err) {
        // In bulk mode one failure must not sink the batch, so it is reported
        // per row by the caller rather than blanking the whole screen.
        if (goToItem) setError(err);
        else throw err;
        return null;
      } finally {
        if (goToItem) setBusy(null);
      }
    },
    [canEdit, lookup],
  );

  // --- render --------------------------------------------------------------

  const showResults = lookup || candidates || shelf;

  return (
    <div className="scan-page">
      <header className="scan-header">
        <h1>Scan</h1>
        <Link to="/">Back to collection</Link>
      </header>

      <div className="scan-modes" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'scan-mode scan-mode--on' : 'scan-mode'}
            onClick={() => {
              stopEverything();
              reset();
              setMode(m.id);
            }}
          >
            <strong>{m.label}</strong>
            <span className="muted">{m.blurb}</span>
          </button>
        ))}
      </div>

      {!showResults && (
        <CameraStage
          active={active}
          hint={
            mode === 'barcode'
              ? 'Hold the barcode steady and fill the frame. No flash on iPhone — find good light.'
              : mode === 'photo'
                ? 'Fill the frame with the front of the box.'
                : 'Stand back far enough to get a whole row of spines in frame.'
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
          {mode !== 'barcode' && (
            <div className="camera-stage__actions">
              <button
                type="button"
                className="primary"
                disabled={busy != null}
                onClick={() => videoRef.current && shoot(videoRef.current, mode)}
              >
                {mode === 'photo' ? 'Read this box' : 'Read this shelf'}
              </button>
            </div>
          )}
        </CameraStage>
      )}

      {!active && !showResults && (
        <PhotoFallback
          mode={mode}
          disabled={busy != null}
          onPhoto={async (file) => {
            setBusy('Reading…');
            setError(null);
            try {
              const photo = await fileToPhoto(
                file,
                mode === 'shelf' ? SHELF_LONG_EDGE : PHOTO_LONG_EDGE,
              );
              if (mode === 'shelf') {
                const res = await api.readShelf(photo);
                setShelf(res.matches);
              } else {
                const res = await api.identifyPhoto(photo);
                setCandidates(res.candidates);
              }
            } catch (err) {
              setError(err);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {busy && <Spinner label={busy} />}
      {error != null && <ErrorBox error={error} what="Scan" />}
      {note && <p className="scan-note">{note}</p>}

      {lookup && (
        <BarcodeResult
          lookup={lookup}
          canResearch={canResearch}
          onAskClaude={() => askClaude(lookup.barcode)}
          onAdd={(c) => addCandidate(c, lookup.barcode)}
        />
      )}

      {candidates && candidates.length > 0 && (
        <CandidateList
          candidates={candidates}
          cached={fromCache}
          onAdd={(c) => addCandidate(c, lookup?.barcode ?? null)}
        />
      )}

      {shelf && (
        <ShelfResult matches={shelf} cached={fromCache} onAdd={(c) => addCandidate(c, null, false)} />
      )}

      {showResults && (
        <button
          type="button"
          onClick={() => {
            reset();
            setActive(false);
          }}
        >
          Scan another
        </button>
      )}
    </div>
  );
}

/**
 * The `<input capture>` path.
 *
 * Verified not to write to the camera roll — Safari presents a picker whose
 * result is handed to the page and discarded; saving would require the host app
 * to call `UIImageWriteToSavedPhotosAlbum`, and Safari never does.
 *
 * Kept because it works in contexts `getUserMedia` does not — notably in-app
 * browsers whose host app never wired up the media-capture delegate.
 *
 * `accept` is plain `image/*` on purpose: adding `image/heic` makes Safari 17+
 * silently transcode *every* selection to HEIC.
 */
function PhotoFallback({
  mode,
  disabled,
  onPhoto,
}: {
  mode: Mode;
  disabled: boolean;
  onPhoto: (file: File) => void;
}) {
  if (mode === 'barcode') return null;
  return (
    <label className="scan-fallback">
      <span className="muted">Camera not working? Take a photo instead — it is not saved to your library.</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPhoto(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function BarcodeResult({
  lookup,
  canResearch,
  onAskClaude,
  onAdd,
}: {
  lookup: BarcodeLookup;
  canResearch: boolean;
  onAskClaude: () => void;
  onAdd: (c: BarcodeCandidate) => void;
}) {
  if (lookup.owned && lookup.match) {
    return (
      <div className="scan-result scan-result--owned">
        <Badge tone="owned">Already in your collection</Badge>
        <h2>
          <Link to={`/items/${lookup.match.item.id}`}>{lookup.match.item.name}</Link>
        </h2>
        {lookup.match.editionName && <p className="muted">{lookup.match.editionName}</p>}
      </div>
    );
  }

  return (
    <div className="scan-result">
      <p className="muted">
        Barcode <code>{lookup.barcode}</code>
        {lookup.verified && ' · community-verified match'}
      </p>

      {lookup.candidates.length > 0 ? (
        <CandidateList candidates={lookup.candidates} onAdd={onAdd} />
      ) : (
        <div className="scan-empty">
          <p>
            Nothing free knew this barcode
            {lookup.inferredName ? (
              <>
                , but it looks like <strong>{lookup.inferredName}</strong>
              </>
            ) : null}
            .
          </p>
          {canResearch ? (
            <>
              <button type="button" onClick={onAskClaude}>
                Search the web for it
              </button>
              <p className="muted">
                Takes a minute or two and costs about a penny. Photographing the box is usually
                faster.
              </p>
            </>
          ) : (
            <p className="muted">Ask an owner to look this one up.</p>
          )}
        </div>
      )}

      <details className="scan-trace">
        <summary>Where we looked</summary>
        <ul>
          {lookup.trace.map((t, i) => (
            <li key={i}>
              <code>{t.source}</code> — {t.outcome}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function CandidateList({
  candidates,
  onAdd,
  cached = false,
}: {
  candidates: BarcodeCandidate[];
  onAdd: (c: BarcodeCandidate) => void;
  /** This whole reading came from a previous identical photo, not a fresh call. */
  cached?: boolean;
}) {
  return (
    <ul className="candidate-list">
      {candidates.map((c, i) => (
        <li key={`${c.bggId ?? c.name}-${i}`} className="candidate">
          {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="candidate__thumb" />}
          <div className="candidate__body">
            <strong>{c.name}</strong>
            <span className="muted">
              {[c.publisher, c.yearPublished, c.editionName].filter(Boolean).join(' · ')}
            </span>
            <span className="candidate__meta">
              <Badge tone={c.confidence === 'high' ? 'owned' : c.confidence === 'low' ? 'wanted' : 'neutral'}>
                {c.confidence}
              </Badge>
              <span className="muted">{c.source}</span>
              {cached && (
                <span className="muted cached-tag" title="Served from a recent identical photo — no model call">
                  cached
                </span>
              )}
              {c.kind !== 'base' && <Badge tone="kind">{c.kind}</Badge>}
            </span>
            {c.note && <span className="muted candidate__note">{c.note}</span>}
          </div>
          <button type="button" className="primary" onClick={() => onAdd(c)}>
            Add
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A shelf photo's results: tick what you want, add them all at once.
 *
 * This is the whole point of shelf mode, and it was got wrong first time round —
 * each row had its own Add button that navigated to the new item, discarding
 * every other title the photo had found. A nine-game shelf could add one game.
 *
 * So: selection is local, adding is a batch, and nothing navigates. Rows report
 * their own outcome, because one failure in a batch of nine must not lose the
 * other eight.
 */
function ShelfResult({
  matches,
  onAdd,
  cached = false,
}: {
  matches: ShelfMatch[];
  onAdd: (c: BarcodeCandidate) => Promise<number | null>;
  cached?: boolean;
}) {
  const owned = matches.filter((m) => m.existingItemId != null);
  const fresh = matches.map((m, i) => ({ m, i })).filter(({ m }) => m.existingItemId == null);

  // Everything not already owned starts ticked: the common case is "add this
  // shelf", and unticking the odd one is less work than ticking eight.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(fresh.map(({ i }) => i)),
  );
  const [results, setResults] = useState<Record<number, { itemId: number } | { error: string }>>({});
  const [adding, setAdding] = useState(false);

  const pending = fresh.filter(({ i }) => selected.has(i) && !results[i]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  async function addSelected() {
    setAdding(true);
    // Sequential, not parallel: each add is a write, and a burst of concurrent
    // inserts makes the "already in the collection" conflict check race itself.
    for (const { m, i } of pending) {
      try {
        const itemId = await onAdd(toCandidate(m));
        setResults((r) => ({ ...r, [i]: itemId ? { itemId } : { error: 'could not add' } }));
      } catch (err) {
        setResults((r) => ({
          ...r,
          [i]: { error: err instanceof ApiError ? err.detail : String(err) },
        }));
      }
    }
    setAdding(false);
  }

  const addedCount = Object.values(results).filter((r) => 'itemId' in r).length;

  return (
    <div className="scan-result">
      <p className="muted">
        Read {matches.length} title{matches.length === 1 ? '' : 's'}
        {owned.length > 0 && ` · ${owned.length} already yours`}
        {addedCount > 0 && ` · ${addedCount} added`}
        {cached && ' · from a recent identical photo'}
      </p>

      {fresh.length > 0 && (
        <>
          <div className="shelf-actions">
            <button
              type="button"
              className="primary"
              disabled={adding || pending.length === 0}
              onClick={addSelected}
            >
              {adding
                ? `Adding… ${addedCount}/${pending.length + addedCount}`
                : pending.length === 0
                  ? 'Nothing selected'
                  : `Add ${pending.length} game${pending.length === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              disabled={adding}
              onClick={() =>
                setSelected(
                  selected.size === fresh.length ? new Set() : new Set(fresh.map(({ i }) => i)),
                )
              }
            >
              {selected.size === fresh.length ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <ul className="candidate-list">
            {fresh.map(({ m, i }) => {
              const result = results[i];
              return (
                <li key={i} className="candidate">
                  {result ? (
                    <span className="shelf-outcome" aria-hidden="true">
                      {'itemId' in result ? '✓' : '!'}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      className="shelf-check"
                      checked={selected.has(i)}
                      disabled={adding}
                      onChange={() => toggle(i)}
                      aria-label={`Add ${m.resolvedName ?? m.title.text}`}
                    />
                  )}

                  {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="candidate__thumb" />}

                  <div className="candidate__body">
                    <strong>{m.resolvedName ?? m.title.text}</strong>
                    {m.resolvedName && m.resolvedName !== m.title.text && (
                      <span className="muted">read as “{m.title.text}”</span>
                    )}
                    <span className="candidate__meta">
                      <Badge tone={m.title.confidence === 'high' ? 'owned' : 'neutral'}>
                        {m.title.confidence}
                      </Badge>
                      <span className="muted">position {m.title.position}</span>
                    </span>
                    {m.title.note && <span className="muted candidate__note">{m.title.note}</span>}
                    {result && 'itemId' in result && (
                      <Link to={`/items/${result.itemId}`}>Added — open it</Link>
                    )}
                    {result && 'error' in result && (
                      <span className="muted candidate__note">{result.error}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {owned.length > 0 && (
        <details className="scan-trace">
          <summary>{owned.length} already in your collection</summary>
          <ul>
            {owned.map((m, i) => (
              <li key={i}>
                <Link to={`/items/${m.existingItemId}`}>{m.existingName}</Link>{' '}
                <span className="muted">read as “{m.title.text}”</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A shelf reading, shaped like every other candidate so one add path serves all. */
function toCandidate(m: ShelfMatch): BarcodeCandidate {
  return {
    name: m.resolvedName ?? m.title.text,
    bggId: m.bggId,
    publisher: null,
    yearPublished: null,
    kind: 'base',
    editionName: null,
    thumbnailUrl: m.thumbnailUrl,
    // A spine shows a title and nothing else.
    minPlayers: null,
    maxPlayers: null,
    playtimeMin: null,
    description: null,
    confidence: m.title.confidence,
    source: 'llm',
    sourceUrl: null,
    note: null,
  };
}

export { ApiError };
