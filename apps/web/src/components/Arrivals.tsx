import { useState } from 'react';
import type { ItemDetail, PreorderArrival } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { KIND_LABEL } from './ItemTree';
import { DigitalTag, ErrorBox, ParentLabel } from './ui';

/**
 * "It arrived" — one control that empties a whole pledge off the preorder list.
 *
 * *"we need a 1 button click to change a pre order game from preordered to owned
 * and to have it update all the expansion too. It should prompt you and say what
 * has arrived so you can exclude things that didn't arrive with the preorder."*
 * — the owner.
 *
 * The shape of the problem is that a pledge is a *branch of the tree*, not a
 * row: Cyberpunk 2077 arrived as seven copies across three levels, and marking
 * them owned one at a time was seven trips through the copy editor. But a
 * pledge is also not reliably one delivery — waves ship separately, a stretch
 * goal is late, a retailer splits the order — so flipping the branch
 * unconditionally would trade seven correct edits for one wrong one. Hence the
 * checklist: everything is ticked, and the work is *unticking* what has not
 * turned up.
 *
 * **Nothing here is a new way to change a copy's status.** Each ticked row is an
 * ordinary `PATCH /api/copies/:id` with `{ status: 'owned' }` — the same call
 * the wishlist's "bought it" and the copy editor's dropdown make. This component
 * decides *which* rows to offer and nothing else, which is why a partial failure
 * is recoverable: whatever did not save is still `preordered` and still on the
 * list next time.
 */
export function Arrivals({
  item,
  canEdit,
  onArrived,
}: {
  item: ItemDetail;
  canEdit: boolean;
  /**
   * Reports back to the page, which reloads and outlives this component.
   *
   * The reload unmounts everything below the header, so a summary rendered here
   * would be destroyed by the thing that proves it — the same reason
   * `AddRelatedPanel` hands its note upwards rather than showing it.
   */
  onArrived: (note: string) => void;
}) {
  const [list, refreshList] = useAsync(() => api.arrivals(item.id), [item.id]);
  const [open, setOpen] = useState(false);
  /**
   * What has *not* turned up — the inverse of what you would expect, and
   * deliberately so.
   *
   * Holding the ticked set would mean seeding it from data that arrives after
   * this component mounts, and every such seed has a bug in it about what
   * happens when the list refreshes underneath it. Holding the exclusions makes
   * "everything is ticked" the empty set, which needs no seeding at all, and a
   * row that vanishes from the list simply stops being asked about.
   */
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Nothing to offer someone who cannot edit. The `preordered` badges in "Our
  // copies" already say what is on the way, so this would be a second telling
  // with a button they may not press.
  if (!canEdit) return null;

  // Quiet on the way in. This runs on every item page and answers "nothing" for
  // almost all of them, so a spinner here would be a flash of furniture above
  // the fold on 800 pages to serve a handful.
  if (list.state === 'loading') return null;
  if (list.state === 'error') {
    return (
      <p className="muted small arrivals-failed">
        Could not check what is still on preorder for this one.
      </p>
    );
  }

  const arrivals = list.data.arrivals;
  if (arrivals.length === 0) return null;

  const chosen = arrivals.filter((a) => !excluded.has(a.copyId));
  const heldBack = arrivals.length - chosen.length;
  const shared = commonNote(arrivals);

  const toggle = (copyId: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(copyId)) next.delete(copyId);
      else next.add(copyId);
      return next;
    });

  async function confirm() {
    setBusy(true);
    setError(null);
    setProblem(null);
    try {
      /*
        In parallel, and settled rather than raced: one row failing must not
        abandon the other ten, and it must not be reported as though the whole
        thing failed either. Each is an independent write to an independent row,
        so there is no order for them to be in.
      */
      const results = await Promise.allSettled(
        chosen.map((a) => api.updateCopy(a.copyId, { status: 'owned' })),
      );
      const failures = results.filter((r) => r.status === 'rejected');

      if (failures.length > 0) {
        // Deliberately not reported through `onArrived`: that reloads the page,
        // and a reload would replace this with the page's success-coloured note.
        // The list is refreshed instead, so what is left on it is exactly what
        // still needs doing.
        setError((failures[0] as PromiseRejectedResult).reason);
        setProblem(
          `${chosen.length - failures.length} of ${chosen.length} saved. The rest are still on preorder — nothing was lost, try again.`,
        );
        setExcluded(new Set());
        refreshList();
        return;
      }

      onArrived(summarise(chosen, heldBack));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card arrivals">
      <div className="section-head">
        <h2>
          On preorder
          <span className="count"> {arrivals.length}</span>
        </h2>
        {!open && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            It arrived
          </button>
        )}
      </div>

      {!open && (
        <p className="muted small">
          {arrivals.length === 1
            ? 'One thing here is paid for and still on its way.'
            : `${arrivals.length} things here are paid for and still on their way.`}{' '}
          When the box turns up, this marks the lot of them owned at once.
        </p>
      )}

      {problem && <p className="scan-note">{problem}</p>}
      {error != null && <ErrorBox error={error} what="Could not mark those as arrived" />}

      {open && (
        <>
          <p className="muted small">
            Untick anything that did <strong>not</strong> turn up — a wave still to ship,
            a stretch goal that is late. Unticked rows stay exactly as they are.
          </p>

          {/* Said once, because it is one fact about the pledge rather than
              twenty-two facts about its contents. See `commonNote`. */}
          {shared && (
            <p className="muted small arrivals-shared" title={shared}>
              {shared}
            </p>
          )}

          <ul className="arrivals-list">
            {arrivals.map((a) => (
              <ArrivalRow
                key={a.copyId}
                arrival={a}
                /* Whether the row above it is its own parent. Indentation reads
                   as "filed under the thing above" and is a lie when the parent
                   is not on this list — an accessory whose expansion arrived
                   months ago is two levels in with nothing above it to belong
                   to. Those rows name their parent instead. */
                nested={arrivals.some((other) => other.itemId === a.parentItemId)}
                checked={!excluded.has(a.copyId)}
                disabled={busy}
                /* Only what this row adds to the note already shown above the
                   list — usually nothing at all. */
                note={noteResidual(a.notes, shared)}
                onToggle={() => toggle(a.copyId)}
              />
            ))}
          </ul>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || chosen.length === 0}
              onClick={() => void confirm()}
            >
              {/* "all" only when it is doing more than the obvious. A one-row
                  list has no "all" to speak of, and "Mark all 1 as owned" is
                  the sort of sentence only a template writes. */}
              {busy
                ? 'Saving…'
                : chosen.length === 1
                  ? 'Mark it as owned'
                  : chosen.length === arrivals.length
                    ? `Mark all ${arrivals.length} as owned`
                    : `Mark ${chosen.length} as owned`}
            </button>
            {/* Only when it does something. "Tick everything" beside an
                already-full list is a button that reports success and changes
                nothing, which is worse than not being there. */}
            {heldBack > 0 && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => setExcluded(new Set())}
              >
                Tick everything
              </button>
            )}
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setExcluded(new Set());
                setProblem(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>

          {chosen.length === 0 && (
            <p className="muted small">
              Nothing is ticked, so there is nothing to mark. Close this and it is as
              though you never opened it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One line of the checklist.
 *
 * Two rows in one, and which one you see is the viewport's business rather
 * than this component's: the same elements are laid out side by side on a
 * desktop and stacked into name-then-metadata on a phone. Nothing is rendered
 * conditionally on width — a checklist that hides facts on small screens is a
 * checklist you cannot trust on the device it is most used on.
 */
function ArrivalRow({
  arrival,
  nested,
  checked,
  disabled,
  note,
  onToggle,
}: {
  arrival: PreorderArrival;
  nested: boolean;
  checked: boolean;
  disabled: boolean;
  /** Not `arrival.notes` — what it adds to the hoisted note. See `noteResidual`. */
  note: string | null;
  onToggle: () => void;
}) {
  return (
    <li className={checked ? 'arrival' : 'arrival arrival--held'}>
      <label style={nested ? { paddingLeft: arrival.depth * 16 } : undefined}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        {/* The name leads. On a phone it is the whole first line, because it is
            the only thing on the row you actually decide with — everything else
            qualifies it. */}
        <span className="child-name">
          {arrival.name}
          {!nested && <ParentLabel id={arrival.parentItemId} name={arrival.parentName} />}
        </span>
        <span className="arrival-meta">
          <span className="child-kind">{KIND_LABEL[arrival.kind]}</span>
          {/* Two of something is a fact about the shelf, and it is also the case
              this checklist cannot express: if one of the two turned up, untick
              the row and edit the copy by hand. */}
          {arrival.quantity > 1 && <span className="dupe-flag">×{arrival.quantity}</span>}
          {arrival.format === 'digital' && <DigitalTag />}
          {/* Clamped to one line, with the whole thing on hover. A pledge note
              runs to 150 characters and there can be twenty of them; given its
              own paragraph it becomes the page. */}
          {note && (
            <span className="arrival-note" title={note}>
              {note}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

/**
 * The note most of these rows are carrying, hoisted out of the list.
 *
 * Measured on the real catalog, which is the only reason this exists: the 22
 * rows of the Ascension 15th Anniversary pledge carry a 150-character note
 * describing *the pledge*, not the thing. Rendered per row that is twenty-two
 * near-identical lines distinguishing nothing.
 *
 * ⚠️ **It is a shared prefix, not a shared string, and a first version that
 * demanded equality never fired on the data it was written for.** Twenty rows
 * match exactly; the base game appends a sentence about playtime research and
 * one expansion appends a sentence about having no BoardGameGeek entry. So the
 * common part is hoisted and each row shows only what it adds — see
 * `noteResidual`, which is what stops those two rows redisplaying 150
 * characters of something already on screen.
 *
 * Needs two rows to agree before anything moves: hoisting a note off a single
 * row relocates it without saving a line.
 */
function commonNote(arrivals: PreorderArrival[]): string | null {
  if (arrivals.length < 2) return null;

  const counts = new Map<string, number>();
  for (const a of arrivals) {
    const note = a.notes?.trim();
    if (note) counts.set(note, (counts.get(note) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 1;
  for (const [note, count] of counts) {
    // `>` not `>=`, so a tie between two notes hoists neither — with nothing to
    // choose between them, picking one would be arbitrary and would make the
    // other row's residual read as though it were the exception.
    if (count > bestCount) {
      best = note;
      bestCount = count;
    }
  }
  return best;
}

/** What this row's note adds to the hoisted one — empty when it adds nothing. */
function noteResidual(note: string | null, common: string | null): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  if (!common) return trimmed;
  if (trimmed === common) return null;
  // Only strip a genuine prefix. A note that merely happens to share some words
  // keeps all of them — a half-sentence beginning mid-clause is worse than a
  // repeated one.
  return trimmed.startsWith(common) ? trimmed.slice(common.length).trim() || null : trimmed;
}

/**
 * What just happened, as a sentence the page can keep after it reloads.
 *
 * Says what was left behind as well as what was taken, because the held-back
 * rows are the entire reason this asks before acting — a summary that only
 * counted successes would read identically whether or not the unticking worked.
 */
function summarise(marked: PreorderArrival[], heldBack: number): string {
  const only = marked.length === 1 ? marked[0] : undefined;
  const took = only
    ? `“${only.name}” has arrived and is now owned.`
    : `${marked.length} things have arrived and are now owned.`;

  if (heldBack === 0) return took;
  return `${took} ${
    heldBack === 1 ? 'One thing is' : `${heldBack} things are`
  } still on preorder.`;
}
