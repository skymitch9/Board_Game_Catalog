import { useCallback, useRef, useState } from 'react';
import {
  ITEM_KINDS,
  PHOTO_LONG_EDGE,
  SHELF_LONG_EDGE,
  classifyShelfResults,
  type BarcodeCandidate,
  type ClassifiedItem,
  type Item,
  type ItemKind,
  type MeResponse,
  type ShelfMatch,
} from '@bgc/core';
import { api, describeError, type BarcodeLookup } from '../api';
import { captureFrame, fileToPhoto, onceSteady } from '../lib/camera';
import { addModeSpec, type AddMode } from '../lib/add-modes';
import { copyDefaults, createItemFromCandidate } from '../lib/catalog-add';
import {
  DEFAULT_SCAN_TARGET,
  SCAN_TARGETS,
  TARGET_LABEL,
  addActionLabel,
  addedLabel,
  bulkAddLabel,
  copyStatusFor,
  loadScanTarget,
  saveScanTarget,
  targetSentence,
  type ScanTarget,
} from '../lib/scan-target';
import { preloadDecoder, startScanLoop } from '../lib/scanner';
import { CameraStage } from './CameraStage';
import { QuickAdd } from './QuickAdd';
import { KIND_LABEL } from './ItemTree';
import { Badge, ErrorBox, Spinner } from './ui';
import { Link, navigate } from '../router';

/**
 * The scanner: the tabs, the camera loop, the lookups, and the rows they
 * produce — everything between "which way am I identifying this game" and "it
 * is in the catalog now".
 *
 * ## ⚠️ WHY THIS WAS EXTRACTED OUT OF `ScanPage`, 2026-09-04
 *
 * The owner, from his phone, verbatim:
 *
 * > *"I want to have all scanning be the same menu and then have the option to
 * > add to wishlist or add to catalog. No need to go to a different route."*
 *
 * Asked whether the wishlist page keeps its own **+ Add something** door:
 * **"Keep it."**
 *
 * So there are two doors and **one** scanner. `/scan` is one; the wishlist
 * page's *+ Add something* is the other. Before this, the wishlist door ran its
 * own camera loop, its own barcode and photo lookups and its own add path
 * (`WishlistScan.tsx`, 326 lines, deleted by the commit that wired this up) —
 * which is a second menu, which is exactly what the owner asked not to have.
 *
 * ## ⚠️ WHY THE WISHLIST DOOR HAS A CAMERA AT ALL — the 2026-08 reversal
 *
 * Carried here verbatim-ish from `WishlistScan`'s header, because the file is
 * gone and the argument is not:
 *
 * > *"for wishlist add, utilize our existing technology for scanning barcodes
 * > and individual photos to add games to it."* — the owner.
 * >
 * > ⚠️ **This reverses a decision recorded on `WishlistPage`**, which said that
 * > sending somebody to the scanner to record something they do not have was
 * > "always the wrong direction — that page is for boxes in your hand". The
 * > observation was right and the conclusion was half of one: standing in a
 * > shop holding a box you have *not* bought is precisely a box in your hand,
 * > and it is the single commonest way a thing gets wanted. What was wrong was
 * > sending them to `/scan`, which adds what it finds as **owned** and
 * > navigates away.
 *
 * Both halves of that "what was wrong" are now fixed rather than worked around:
 * the *Adding to* switch means `/scan` no longer only writes `owned`, and this
 * panel navigates away only when its caller has nothing better to do with what
 * was just added (see `onAdded`). So the camera comes to the wishlist page as
 * this component, instead of the page reimplementing one.
 *
 * ## ⚠️ WHAT EACH DOOR STILL OWNS
 *
 * | | `/scan` (`ScanPage`) | the wishlist door (`WishlistAdd`) |
 * |---|---|---|
 * | the target | its **Shelf \| Wishlist** switch, drawn here | **pinned** `wishlist`, no switch |
 * | tabs offered | all four, filtered by capability | barcode and one-box only |
 * | after an add | opens the game | hands it to the expansions offer |
 * | backing out | nothing — you are on a page | **Cancel** shuts the door |
 *
 * Which tabs, and what each costs in permission, is `lib/add-modes.ts`.
 *
 * ## The rungs, and why they are in this order
 *
 * The ordering reflects what things actually cost. A barcode lookup hits the
 * local table and two free services and comes back in about a second. A photo
 * takes three to five. Asking Claude about a *barcode number* takes one to two
 * minutes, so it is never automatic — it sits behind a button that says how
 * long it will take. Typing costs a person's time, which is why it is last.
 *
 * Photos are never stored. They are captured from a live frame, uploaded, read,
 * and dropped; nothing reaches the camera roll and nothing is kept server-side.
 *
 * ## ⚠️ ONE WRITE PATH
 *
 * `copyDefaults(copyStatusFor(target))` lives on exactly one line in this app's
 * add paths — `recordCopy` below — and every add either door makes goes through
 * it. `ScanJobsPage` (the intake queue) has its own `createCopy` with its own
 * hardcoded status; that screen is a different job and was deliberately left
 * alone.
 */

/**
 * ⚠️ Props diverge from the library catalog's `AddBookPanel` in two named ways,
 * both deliberate:
 *
 *  - **`pinTarget` is the target itself, not a boolean beside a `target`
 *    prop.** One value cannot disagree with itself: there is no way to hand
 *    this panel a target it then ignores.
 *  - **No `onFinished`.** Over there it closes a scan *job*; this repo's sweeps
 *    live on `/scan-jobs`, a separate screen with its own queue, so an
 *    `onFinished` here would be a prop no caller could ever fire.
 */
export function ScanPanel({
  me,
  modes,
  showTabs = true,
  initialMode,
  pinTarget,
  onAdded,
  onCancel,
}: {
  /**
   * Whose capabilities decide what is offered *inside* the panel: the paid
   * ask-Claude rung (`runResearch`), whether a scanned barcode is linked to the
   * game afterwards (`editCatalog`), and whether the target switch is drawn at
   * all (`suggestWishlist`). Which TABS are offered is the door's decision and
   * arrives as `modes`.
   */
  me: MeResponse;
  /**
   * The tabs to offer, in the order to draw them — from `lib/add-modes.ts`.
   *
   * ⚠️ This is the list the panel WORKS from, not only the list it draws: with
   * `showTabs` off it is still what says which tab is live.
   */
  modes: readonly AddMode[];
  /**
   * Draw the tab strip.
   *
   * ⚠️ Default ON, because that is `/scan`'s behaviour for **every** role —
   * including a reader, whose filter leaves exactly one tab and who has always
   * seen a strip of one. An earlier draft hid the strip whenever `modes` held a
   * single entry, which would have quietly changed that screen for the one role
   * least able to report it.
   *
   * The wishlist door turns it OFF: it draws its own three-way strip (type /
   * barcode / one box) above this panel and hands down the single tab that is
   * live, so a strip here would be a second row saying the same thing.
   */
  showTabs?: boolean;
  /** The tab to open on. `/scan` passes `?mode=`; defaults to barcode. */
  initialMode?: AddMode | null;
  /**
   * Pin the target and draw no switch.
   *
   * ⚠️ Absent is the `/scan` behaviour: the switch is drawn (behind
   * `suggestWishlist`) and the choice is remembered for the session. Present is
   * the wishlist door: everything this panel creates is a want, and a switch
   * offering to put a game on the shelf *from the wishlist page* would be a
   * control whose only correct setting is the one it already has.
   */
  pinTarget?: ScanTarget;
  /**
   * A game landed in the catalog. `bulk` is true for a shelf-photo row, which
   * is one of many and must not trigger anything that interrupts the batch.
   *
   * ⚠️ **Its ABSENCE is the `/scan` behaviour**: with no `onAdded`, a single
   * add navigates to the game it just created, which is what that screen has
   * always done. A caller that passes one is saying it has something better to
   * do with the result — the wishlist door offers the game's expansions — so
   * the panel navigates nowhere and leaves the screen standing.
   */
  onAdded?: (item: Item, info: { bulk: boolean }) => void;
  /**
   * Backing out of the panel entirely. `/scan` passes nothing (there is nothing
   * to back out of — it is a page); the wishlist door passes its close.
   */
  onCancel?: () => void;
}) {
  // `/scan?mode=photo` lands on the right tab. Barcode stays the default: it is
  // the only exact identification here, and it is free.
  const [mode, setMode] = useState<AddMode>(initialMode ?? 'barcode');
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
  /*
   * `suggestWishlist` (member+) — the same capability `WishlistPage` gates its
   * Add door on, and the same one `POST /items/:id/copies` demands when the
   * status is `wanted` (`routes/catalog.ts`). Matching the server's check
   * rather than guessing at it is the point: a switch that writes a status the
   * Worker then refuses is the worst of the ways this could fail.
   */
  const canSuggest = me.capabilities.includes('suggestWishlist');

  /*
   * ⚠️ **Where this sweep LANDS** — the owner's 2026-09-04 ask, from his phone:
   * *"let's add that when you scan something you can add it to library or
   * wishlist."*
   *
   * ONE choice for the whole sweep, written on the tap, remembered for the
   * SESSION and not across visits: a shop trip is an errand, not a habit.
   * `lib/scan-target.ts` carries the argument.
   */
  const [scanTarget, setScanTarget] = useState<ScanTarget>(() =>
    pinTarget ? pinTarget : loadScanTarget(),
  );
  /*
   * ⚠️ The MECHANICAL guard, not just an undrawn switch: a `wishlist` stored in
   * an earlier session must not survive a change of role. Everything below
   * reads `target`, never `scanTarget`, so there is no path on which somebody
   * without `suggestWishlist` writes a want.
   *
   * A pinned target outranks both, and is not gated here — the door that pins
   * it is itself mounted behind `suggestWishlist`.
   */
  const target: ScanTarget = pinTarget ?? (canSuggest ? scanTarget : DEFAULT_SCAN_TARGET);

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
   * ⚠️ **THE ONE WRITE.** Every game either door adds — scanned, photographed,
   * batched off a shelf, or wanted a second time — becomes a copy through this
   * line and no other.
   *
   * `copyDefaults(copyStatusFor(target))` appears exactly once in this app's
   * add paths as a result. It was two places before 2026-09-04: `ScanPage`'s
   * `addCandidate` and `WishlistScan`'s `want`, and the second one had a
   * hardcoded `'wanted'` that no switch could ever have reached.
   *
   * ⚠️ `ScanJobsPage` (the intake queue) has a `createCopy` of its own with its
   * own hardcoded status. That screen is a different job — nothing is confirmed
   * at scan time there — and was deliberately left alone.
   */
  const recordCopy = useCallback(
    (itemId: number) => api.createCopy(itemId, copyDefaults(copyStatusFor(target))),
    [target],
  );

  /**
   * Want ANOTHER of a game the catalog already has.
   *
   * ⚠️ Carried from `WishlistScan`, whose words this keeps: *"The item may
   * already exist — a barcode we have seen before resolves to a catalog row —
   * and then wanting it is a fact about a **copy**, so a copy is the only thing
   * created. Owning one and wanting another are both true at once, which is how
   * the `×2` rows on this list came about in the first place."*
   *
   * So this deliberately does NOT go through `addCandidate`: that one creates
   * an item first, and doing so here would mint a duplicate catalog row for a
   * game we can already see.
   */
  const wantExisting = useCallback(
    async (item: Item) => {
      setBusy(`Adding ${item.name}…`);
      setError(null);
      try {
        await recordCopy(item.id);
        onAdded?.(item, { bulk: false });
        if (!onAdded) navigate(`/items/${item.id}`);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(null);
      }
    },
    [onAdded, recordCopy],
  );

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
      pendingParentName?: string | null,
    ): Promise<number | null> => {
      if (goToItem) setBusy(`Adding ${candidate.name}…`);
      setError(null);
      try {
        const kind = overrideKind ?? 'base';

        // A candidate describes *a game*, and this row may not be one — the
        // lookup that produced it was given a title read off a box. The policy
        // that stops "Dice Throne Vanguard: Dice Tray" acquiring 2–6 players and
        // a description of a dice game lives in `lib/catalog-add.ts`, shared
        // with the completeness report.
        const item = await createItemFromCandidate(candidate, {
          kind,
          parentItemId: overrideParentId ?? null,
          pendingParentName: pendingParentName ?? null,
        });

        // Scanning a game used to mean you own it. Since 2026-09-04 it means
        // whatever the target says — a copy on the shelf, or a want on the
        // wishlist. `physical` either way: a barcode or a cover means the box
        // is in front of you, whether or not it is going home with you.
        await recordCopy(item.id);

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

        onAdded?.(item, { bulk: !goToItem });
        // ⚠️ Only when the caller had nothing better to do with it — see the
        // note on `onAdded`. The wishlist door offers the game's expansions
        // next, and navigating away would throw that offer on the floor.
        if (goToItem && !onAdded) navigate(`/items/${item.id}`);
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
    [canEdit, lookup, onAdded, recordCopy],
  );

  // --- render --------------------------------------------------------------

  const showResults = lookup || candidates || shelf;

  return (
    <>
      {/* ⚠️ Drawn unless the caller says it drew its own — see `showTabs`. A
          strip of one is still a strip: that is what a reader has always seen
          on `/scan`, and the extraction was not allowed to change it. */}
      {showTabs && (
        <div className="scan-modes" role="tablist">
          {modes.map((id) => {
            const spec = addModeSpec(id);
            return (
              <button
                key={id}
                // ⚠️ Explicit, because this panel is now rendered inside the
                // wishlist door's <form>: a bare <button> there defaults to
                // `submit`, so choosing a tab would submit the typed-name form.
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={mode === id ? 'scan-mode scan-mode--on' : 'scan-mode'}
                onClick={() => {
                  stopEverything();
                  reset();
                  setMode(id);
                }}
              >
                <strong>{spec.label}</strong>
                <span className="muted">{spec.blurb}</span>
              </button>
            );
          })}
        </div>
      )}

      {/*
        ⚠️ **SHELF or WISHLIST** — the owner's 2026-09-04 ask, and the one
        control here that changes what a scan MEANS rather than how it reads a
        box. It sits under the tabs and above the camera because it is the thing
        somebody arrives having already decided.

        ⚠️ It is not drawn on the *Manually* tab, where the library catalog's
        equivalent does render. The reason they differ: that tab is `QuickAdd`,
        whose form already carries a full copy-status dropdown, so a two-state
        switch above it would be a second answer to a question already being
        asked — and the dropdown, which can also say `preordered` or `lent`, is
        the better one.

        ⚠️ No refusal sentence, because there is no refusal to explain: without
        `suggestWishlist` the switch is not rendered at all and every scan goes
        to the shelf, exactly as it did before this existed. A person who never
        had the choice is not being told "no" — nothing has changed for them.
      */}
      {!pinTarget && canSuggest && mode !== 'manual' && (
        <div className="scan-target">
          <span className="scan-target__label" id="scan-target-label">
            Adding to
          </span>
          <div className="scan-target__opts" role="group" aria-labelledby="scan-target-label">
            {SCAN_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={target === t}
                onClick={() => {
                  setScanTarget(t);
                  // Written on the tap, not on unmount: a phone that locks
                  // mid-sweep is the case this screen is built around, and an
                  // unmount handler is exactly what that does not run.
                  saveScanTarget(t);
                }}
              >
                {TARGET_LABEL[t]}
              </button>
            ))}
          </div>
          <span className="muted scan-target__note">{targetSentence(target)}</span>
        </div>
      )}

      {/* ⚠️ Pinned: no switch, but the sentence stays. A door that silently
          decides where things land is worse than one that offers a choice —
          somebody scanning a box has to be able to read what it is about to
          mean, whether or not they can change it. */}
      {pinTarget && (
        <p className="muted small scan-target__note">
          {targetSentence(target, 'Games you add here')}
        </p>
      )}

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

      {/* `target` goes to all three so no add button, batch button or settled
          row can say "Added" over a want. It is the effective target, never
          `scanTarget` — see the guard where it is computed. */}
      {lookup && (
        <BarcodeResult
          lookup={lookup}
          canResearch={canResearch}
          busy={busy != null}
          target={target}
          onAskClaude={() => askClaude(lookup.barcode)}
          onAdd={(c) => addCandidate(c, lookup.barcode)}
          onWantExisting={wantExisting}
        />
      )}

      {candidates && candidates.length > 0 && (
        <CandidateList
          candidates={candidates}
          target={target}
          onAdd={(c) => addCandidate(c, lookup?.barcode ?? null)}
        />
      )}

      {shelf && (
        <ShelfResult
          matches={shelf}
          target={target}
          onAdd={(c, kind, parentId, pendingParentName) =>
            addCandidate(c, null, false, kind, parentId, pendingParentName)
          }
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

      {/* Only a door has a way out. `/scan` passes no `onCancel` and draws
          nothing here, which is the DOM it has always had. */}
      {onCancel && (
        <div className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </>
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
  mode: AddMode;
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
  busy,
  target,
  onAskClaude,
  onAdd,
  onWantExisting,
}: {
  lookup: BarcodeLookup;
  canResearch: boolean;
  busy: boolean;
  /** Where this sweep lands — it names the add button, and it decides two branches below. */
  target: ScanTarget;
  onAskClaude: () => void;
  onAdd: (c: BarcodeCandidate) => void;
  /** Want another of a game the catalog already has — no new item. */
  onWantExisting: (item: Item) => void;
}) {
  if (lookup.owned && lookup.match) {
    const existing = lookup.match.item;
    return (
      <div className="scan-result scan-result--owned">
        <Badge tone="owned">Already in your collection</Badge>
        <h2>
          <Link to={`/items/${existing.id}`}>{existing.name}</Link>
        </h2>
        {lookup.match.editionName && <p className="muted">{lookup.match.editionName}</p>}

        {/*
          ⚠️ On a WANT this is not a dead end, and that is carried from
          `WishlistScan`, which said it plainly: *"Already in the catalog.
          Adding it here records that you want **another** one."* It is a real
          case for a game you lend out, and it is how the `×2` rows on the
          wishlist came about.

          On a SHELF sweep the answer is still just the answer — "you already
          own this" is the question somebody came here to ask, and offering to
          add a second copy over it would be answering a question nobody asked.
        */}
        {target === 'wishlist' && (
          <>
            <p className="muted small">
              Adding it here records that you want <strong>another</strong> one.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onWantExisting(existing)}
              >
                Want another
              </button>
              <Link to={`/items/${existing.id}`} className="btn btn-quiet">
                Open it
              </Link>
            </div>
          </>
        )}
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
        <CandidateList candidates={lookup.candidates} target={target} onAdd={onAdd} />
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
          {/*
            ⚠️ The paid rung is NOT offered over a want, and the reason is
            `WishlistScan`'s, kept: *"The slow paid rung — Claude on a barcode
            number, one to two minutes — is deliberately not offered here. It
            exists for a box you own and cannot identify; it is far too much to
            spend on deciding whether to want something."*

            That argument is about the TARGET, not about which door you came
            through, which is why it is written against `target` and applies to
            `/scan` with the switch on Wishlist as well.
          */}
          {target === 'wishlist' ? (
            <p className="muted">
              Try photographing the box instead — it reads the title off the cover.
            </p>
          ) : canResearch ? (
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
  target,
  onAdd,
}: {
  candidates: BarcodeCandidate[];
  /** Where this sweep lands — it names the add button. */
  target: ScanTarget;
  onAdd: (c: BarcodeCandidate) => void;
}) {
  return (
    <ul className="candidate-list">
      {candidates.map((c, i) => (
        <li key={`${c.bggId ?? c.name}-${i}`} className="candidate">
          {c.thumbnailUrl && (
            <img src={c.thumbnailUrl} alt="" className="candidate__thumb" loading="lazy" />
          )}
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
            {addActionLabel(target)}
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
  target,
  onAdd,
}: {
  matches: ShelfMatch[];
  /**
   * Where this sweep lands. Bulk goes through the same `addCandidate` as every
   * other row, so it already writes the right status — this is only so the
   * words agree with the write. A batch button reading "Add 9 games" over a
   * wishlist sweep is the same lie as a row reading "Added".
   */
  target: ScanTarget;
  onAdd: (
    c: BarcodeCandidate,
    kind?: ItemKind,
    parentId?: number | null,
    pendingParentName?: string | null,
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
    // `itemNames`, not `items`: the browse endpoint is paged, and classifying a
    // shelf against one page of it would report everything past group 25 as a
    // game you do not own.
    api.itemNames().then((res) => {
      const flat = res.items;
      setExistingItems(flat);

      const freshItems = fresh.map((m) => ({
        name: m.resolvedName ?? m.title.text,
        bggId: m.bggId,
        thumbnailUrl: m.thumbnailUrl,
      }));
      // Alternate names too, so a spine reading "The Settlers of Catan:
      // Seafarers" proposes the box filed as "Catan" as its parent rather than
      // rooting itself beside it. The server's ownership pass already uses
      // them; this is the same catalog answering the same way.
      setClassified(classifyShelfResults(freshItems, flat, res.aliases ?? []));
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

      // No demotion. An expansion whose base game is not here yet stays an
      // expansion and remembers what it is waiting for, rather than entering
      // the collection as a root and losing what it was.
      const pendingParentName =
        kind !== 'base' && !parentId
          ? (item.inferredParentName ?? item.proposedParentName ?? null)
          : null;

      try {
        const candidate = toCandidate(m);
        const itemId = await onAdd(candidate, kind, parentId, pendingParentName);
        if (itemId) {
          setResults((r) => ({ ...r, [i]: { itemId } }));
          setBatchIds((b) => ({ ...b, [i]: itemId }));
        } else {
          setResults((r) => ({ ...r, [i]: { error: 'could not add' } }));
        }
      } catch (err) {
        setResults((r) => ({
          ...r,
          [i]: { error: describeError(err) },
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
        {/* "9 added" / "9 added to wishlist": the tally is a settled row too,
            and the sweep it summarises may not have gone on the shelf. */}
        {addedCount > 0 && ` \u00b7 ${addedCount} ${addedLabel(target).toLowerCase()}`}
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
                  : bulkAddLabel(target, pendingCount)}
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
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="candidate__thumb"
                      loading="lazy"
                    />
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
                      <Link to={`/items/${result.itemId}`}>
                        {addedLabel(target)} -- open it
                      </Link>
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
