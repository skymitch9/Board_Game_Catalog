import { useCallback, useRef, useState } from 'react';
import {
  ITEM_KINDS,
  PHOTO_LONG_EDGE,
  SHELF_LONG_EDGE,
  classifyShelfResults,
  type BarcodeCandidate,
  type ClassifiedItem,
  type ItemKind,
  type MeResponse,
  type ShelfMatch,
} from '@bgc/core';
import { api, ApiError, type BarcodeLookup } from '../api';
import { captureFrame, fileToPhoto, onceSteady } from '../lib/camera';
import { preloadDecoder, startScanLoop } from '../lib/scanner';
import { CameraStage } from '../components/CameraStage';
import { QuickAdd } from '../components/QuickAdd';
import { KIND_LABEL } from '../components/ItemTree';
import { Badge, ErrorBox, Spinner } from '../components/ui';
import { Link, navigate } from '../router';

/**
 * Adding a game: by barcode, by photo, by shelf, or by hand.
 *
 * This is the one way in. There used to be three — a Scan page, an Add page and
 * a Quick add panel on the collection — which meant choosing a route before
 * knowing which would work. Now the choice is a tab, and switching costs
 * nothing.
 *
 * The ordering here reflects what things actually cost. A barcode lookup hits
 * the local table and two free services and comes back in about a second. A
 * photo takes three to five. Asking Claude about a *barcode number* takes one to
 * two minutes, so it is never automatic — it sits behind a button that says how
 * long it will take. Typing costs a person's time, which is why it is last.
 *
 * Photos are never stored. They are captured from a live frame, uploaded, read,
 * and dropped; nothing reaches the camera roll and nothing is kept server-side.
 */

type Mode = 'barcode' | 'photo' | 'shelf' | 'manual';

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'barcode', label: 'Barcode', blurb: 'Fastest when the box has one. Free.' },
  { id: 'photo', label: 'One box', blurb: 'Reads the title off the cover. A few seconds.' },
  { id: 'shelf', label: 'Whole shelf', blurb: 'Reads every spine at once. Best for bulk.' },
  { id: 'manual', label: 'Manually', blurb: 'Type the name. Looks the rest up as you go.' },
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

  const stopLoopRef = useRef<(() => void) | null>(null);
  const stopSteadyRef = useRef<(() => void) | null>(null);
  /**
   * Auto-capture fires when the phone stops moving. On by default because the
   * alternative — reach for a button while holding a box steady one-handed — is
   * the awkward part of this screen.
   */
  const [autoCapture, setAutoCapture] = useState(true);
  const canResearch = me.capabilities.includes('runResearch');
  const canEdit = me.capabilities.includes('editCatalog');

  const reset = useCallback(() => {
    setLookup(null);
    setCandidates(null);
    setShelf(null);
    setNote(null);
    setError(null);
  }, []);

  const stopEverything = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    stopSteadyRef.current?.();
    stopSteadyRef.current = null;
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
          if (res.unreadable || res.candidates.length === 0) {
            setNote(
              'Could not read that one. Try filling more of the frame with the box, and avoid glare on the title.',
            );
          }
        } else {
          const res = await api.readShelf(photo);
          setShelf(res.matches);
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
      if (mode === 'barcode') {
        onBarcodeReady(video);
        return;
      }
      if (mode === 'manual') return; // no camera on this tab
      // Photo modes: shoot as soon as the phone settles, unless switched off.
      stopSteadyRef.current?.();
      stopSteadyRef.current = autoCapture
        ? onceSteady(video, () => void shoot(video, mode))
        : null;
    },
    [autoCapture, mode, onBarcodeReady, shoot],
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
      overrideKind?: ItemKind,
      overrideParentId?: number | null,
    ): Promise<number | null> => {
      if (goToItem) setBusy(`Adding ${candidate.name}…`);
      setError(null);
      try {
        const kind = overrideKind ?? 'base';
        const parentItemId = kind === 'base' ? null : (overrideParentId ?? null);

        const { item } = await api.createItem({
          name: candidate.name,
          kind,
          parentItemId,
          bggId: candidate.bggId,
          yearPublished: candidate.yearPublished,
          publisher: candidate.publisher,
          thumbnailUrl: candidate.thumbnailUrl,
          minPlayers: candidate.minPlayers,
          maxPlayers: candidate.maxPlayers,
          playtimeMin: candidate.playtimeMin,
          description: candidate.description,
        });

        // Scanning a game means you own it — create a copy so it counts.
        await api.createCopy(item.id, {
          quantity: 1,
          status: 'owned',
          isSleeved: false,
          isPunched: false,
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
        <h1>Add a game</h1>
        <Link to="/">Back to collection</Link>
      </header>

      <div className="scan-modes" role="tablist">
        {/* Typing a game in needs write access, and so does the name lookup
            behind it; offering the tab to a reader would only lead to a 403. */}
        {MODES.filter((m) => m.id !== 'manual' || canEdit).map((m) => (
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

      {/* The typed path: the same Quick add that used to live on the collection
          page, inline here so switching to it never loses the tab you were on. */}
      {mode === 'manual' && <QuickAdd />}

      {!showResults && mode !== 'manual' && (
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
          {(mode === 'photo' || mode === 'shelf') && (
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
                  if (videoRef.current) void shoot(videoRef.current, mode);
                }}
              >
                {mode === 'photo' ? 'Read this box' : 'Read this shelf'}
              </button>
              <label className="auto-toggle">
                <input
                  type="checkbox"
                  checked={autoCapture}
                  onChange={(e) => {
                    setAutoCapture(e.target.checked);
                    if (!e.target.checked) {
                      stopSteadyRef.current?.();
                      stopSteadyRef.current = null;
                    } else if (videoRef.current) {
                      stopSteadyRef.current = onceSteady(videoRef.current, () => {
                        if (videoRef.current) void shoot(videoRef.current, mode);
                      });
                    }
                  }}
                />
                Auto
              </label>
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
          onAdd={(c) => addCandidate(c, lookup?.barcode ?? null)}
        />
      )}

      {shelf && (
        <ShelfResult
          matches={shelf}
          onAdd={(c, kind, parentId) => addCandidate(c, null, false, kind, parentId)}
        />
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
 * The file-picker path.
 *
 * Verified not to write to the camera roll — Safari presents a picker whose
 * result is handed to the page and discarded; saving would require the host app
 * to call `UIImageWriteToSavedPhotosAlbum`, and Safari never does.
 *
 * Kept because it works in contexts `getUserMedia` does not — notably in-app
 * browsers whose host app never wired up the media-capture delegate.
 *
 * **No `capture` attribute, deliberately.** It used to say `capture="environment"`,
 * which on iOS opens the rear camera *directly* and offers no Photo Library
 * option at all — so a photo already taken, of a shelf in another room or a box
 * that has since been put away, simply could not be used. Without it Safari
 * shows the full menu: Photo Library, Take Photo, Choose File. Android loses a
 * shortcut straight to the camera, which is a fair trade for a whole input
 * being reachable.
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
  if (mode === 'barcode' || mode === 'manual') return null;
  return (
    <label className="scan-fallback">
      <span className="muted">
        Camera not working? Take a photo or choose one you already have — nothing
        taken here is saved to your library.
      </span>
      <input
        type="file"
        accept="image/*"
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
}: {
  candidates: BarcodeCandidate[];
  onAdd: (c: BarcodeCandidate) => void;
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
 * A shelf photo's results: classify, review, then add.
 *
 * The flow is: scan -> classify (auto-detect expansions by title prefix) ->
 * show a review screen where the user can adjust kind and parent -> batch add.
 */
function ShelfResult({
  matches,
  onAdd,
}: {
  matches: ShelfMatch[];
  onAdd: (
    c: BarcodeCandidate,
    kind?: ItemKind,
    parentId?: number | null,
  ) => Promise<number | null>;
}) {
  const owned = matches.filter((m) => m.existingItemId != null);
  const fresh = matches.filter((m) => m.existingItemId == null);

  const [existingItems, setExistingItems] = useState<{ id: number; name: string; kind: string }[]>([]);
  const [classified, setClassified] = useState<ClassifiedItem[] | null>(null);
  const [classifyRan, setClassifyRan] = useState(false);

  // Run classification once on first render.
  if (!classifyRan) {
    setClassifyRan(true);
    api.items().then((res) => {
      const flat: { id: number; name: string; kind: string }[] = [];
      function walk(nodes: typeof res.items) {
        for (const n of nodes) {
          flat.push({ id: n.id, name: n.name, kind: n.kind });
          if (n.children) walk(n.children);
        }
      }
      walk(res.items);
      setExistingItems(flat);

      const freshItems = fresh.map((m) => ({
        name: m.resolvedName ?? m.title.text,
        bggId: m.bggId,
        thumbnailUrl: m.thumbnailUrl,
      }));
      setClassified(classifyShelfResults(freshItems, flat));
    }).catch(() => {
      const freshItems = fresh.map((m) => ({
        name: m.resolvedName ?? m.title.text,
        bggId: m.bggId,
        thumbnailUrl: m.thumbnailUrl,
      }));
      setClassified(classifyShelfResults(freshItems, []));
    });
  }

  const [kindOverrides, setKindOverrides] = useState<Record<number, ItemKind>>({});
  const [parentOverrides, setParentOverrides] = useState<Record<number, number | null>>({});
  const [selected, setSelected] = useState<Set<number>>(() => new Set(fresh.map((_, i) => i)));
  const [results, setResults] = useState<Record<number, { itemId: number } | { error: string }>>({});
  const [adding, setAdding] = useState(false);
  const [batchIds, setBatchIds] = useState<Record<number, number>>({});

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const getKind = (i: number): ItemKind =>
    kindOverrides[i] ?? classified?.[i]?.proposedKind ?? 'base';

  const getParentId = (i: number): number | null =>
    parentOverrides[i] !== undefined
      ? (parentOverrides[i] ?? null)
      : (classified?.[i]?.proposedParentId ?? null);

  async function addSelected() {
    if (!classified) return;
    setAdding(true);

    // Base games first so expansions can reference them.
    const pending = [...selected]
      .filter((i) => !results[i])
      .sort((a, b) => (getKind(a) === 'base' ? 0 : 1) - (getKind(b) === 'base' ? 0 : 1));

    for (const i of pending) {
      const item = classified[i];
      const m = fresh[i];
      if (!item || !m) continue;

      const kind = getKind(i);
      let parentId = getParentId(i);

      // Resolve batch parent references:
      // - Negative IDs are pseudo-IDs for not-yet-added items (-(idx+1) -> idx)
      // - Null with a proposedParentName means auto-classified batch sibling
      if (kind !== 'base' && parentId != null && parentId < 0) {
        const batchIdx = -(parentId + 1);
        parentId = batchIds[batchIdx] ?? null;
      } else if (kind !== 'base' && parentId == null && item.proposedParentName) {
        const parentIdx = classified.findIndex(
          (c) => c.proposedKind === 'base' && c.name === item.proposedParentName,
        );
        if (parentIdx >= 0 && batchIds[parentIdx]) {
          parentId = batchIds[parentIdx]!;
        }
      }

      // Expansion without a resolved parent -> add as base.
      const effectiveKind = kind !== 'base' && !parentId ? 'base' : kind;

      try {
        const candidate = toCandidate(m);
        const itemId = await onAdd(candidate, effectiveKind, parentId);
        if (itemId) {
          setResults((r) => ({ ...r, [i]: { itemId } }));
          setBatchIds((b) => ({ ...b, [i]: itemId }));
        } else {
          setResults((r) => ({ ...r, [i]: { error: 'could not add' } }));
        }
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
  const pendingCount = [...selected].filter((i) => !results[i]).length;

  const parentOptions = [
    ...existingItems.filter((it) => it.kind === 'base'),
    ...Object.entries(batchIds).map(([idx, id]) => ({
      id,
      name: classified?.[Number(idx)]?.name ?? `Item ${id}`,
      kind: 'base' as const,
      isBatch: true,
    })),
    // Items in this scan classified as base but not yet added — available as
    // parents so expansions can reference them before the add runs.
    ...(classified ?? [])
      .map((item, idx) => ({ item, idx }))
      .filter(({ item, idx }) =>
        (kindOverrides[idx] ?? item.proposedKind) === 'base' && !batchIds[idx],
      )
      .map(({ item, idx }) => ({
        id: -(idx + 1), // negative pseudo-ID for not-yet-added batch items
        name: item.name,
        kind: 'base' as const,
        isBatch: true,
      })),
  ];

  if (!classified) return <Spinner label="Classifying..." />;

  return (
    <div className="scan-result">
      <p className="muted">
        Read {matches.length} title{matches.length === 1 ? '' : 's'}
        {owned.length > 0 && ` \u00b7 ${owned.length} already yours`}
        {addedCount > 0 && ` \u00b7 ${addedCount} added`}
      </p>

      {fresh.length > 0 && (
        <>
          <div className="shelf-actions">
            <button
              type="button"
              className="primary"
              disabled={adding || pendingCount === 0}
              onClick={addSelected}
            >
              {adding
                ? `Adding\u2026 ${addedCount}`
                : pendingCount === 0
                  ? 'All done'
                  : `Add ${pendingCount} game${pendingCount === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
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
            {classified.map((item, i) => {
              const m = fresh[i];
              if (!m) return null;
              const result = results[i];
              const kind = getKind(i);
              const parentId = getParentId(i);

              return (
                <li key={i} className="candidate">
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
                      aria-label={`Add ${item.name}`}
                    />
                  )}

                  {item.thumbnailUrl && (
                    <img src={item.thumbnailUrl} alt="" className="candidate__thumb" />
                  )}

                  <div className="candidate__body">
                    <strong>{item.name}</strong>
                    {m.resolvedName && m.resolvedName !== m.title.text && (
                      <span className="muted">read as &quot;{m.title.text}&quot;</span>
                    )}

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
                              const val = e.target.value ? Number(e.target.value) : null;
                              setParentOverrides((o) => ({ ...o, [i]: val }));
                            }}
                            disabled={adding}
                            aria-label="Parent game"
                          >
                            <option value="">-- pick a parent --</option>
                            {parentOptions.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        )}

                        {item.reason && (
                          <span className="muted small">{item.reason}</span>
                        )}
                      </div>
                    )}

                    {result && 'itemId' in result && (
                      <Link to={`/items/${result.itemId}`}>Added -- open it</Link>
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
                <span className="muted">read as &quot;{m.title.text}&quot;</span>
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

