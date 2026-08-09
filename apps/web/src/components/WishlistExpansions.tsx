import { useEffect, useState } from 'react';
import type { ComponentStatus, GameCompleteness } from '@bgc/core';
import { api } from '../api';
import { addComponent } from '../lib/catalog-add';
import { Link } from '../router';
import { ErrorBox, Spinner } from './ui';

/**
 * What else this game has, offered the moment it lands on the wishlist.
 *
 * *"if a game is added, grab the expansions so we can quick add those… add a
 * see expansions expansion area where we can check them to add them to wishlist
 * too."* — the owner.
 *
 * The thought behind it is the one you actually have in a shop: you want
 * Everdell, and Everdell has six expansions, and you would like the good ones on
 * the list before you forget they exist. Reaching them today means saving the
 * game, finding it in the collection, opening it, and scrolling to *What else
 * exists* — four steps away from the screen you are standing on.
 *
 * ## Nothing is ticked to begin with, and that is the opposite of `Arrivals`
 *
 * The two look like the same checklist and mean opposite things. A preorder
 * arriving is a claim that has *already happened* and the tick confirms it, so
 * everything starts ticked. Wanting an expansion has not happened, and wanting
 * all six of them is a claim nobody made — a panel that started ticked would
 * turn one deliberate act into a shopping list somebody has to prune.
 *
 * ## It asks BoardGameGeek at most once, and only for a game just added
 *
 * The component lists are cached and swept weekly by cron; a game added a
 * minute ago has never been swept, so `state` comes back `never_checked` and
 * there is nothing to show. One `POST /api/components/backfill?itemId=` fixes
 * that in about a second. It fires once, automatically, because the owner asked
 * for the expansions to be *grabbed* — but only here, on a row this session just
 * created, and never on the report itself where a button already exists.
 */
export function WishlistExpansions({
  itemId,
  gameName,
  onAdded,
}: {
  itemId: number;
  gameName: string;
  /** So the wishlist behind this can refresh, and say what happened. */
  onAdded: (message: string) => void;
}) {
  const [report, setReport] = useState<GameCompleteness | null>(null);
  const [state, setState] = useState<'loading' | 'asking' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        let data = await api.completeness(itemId);

        // Never swept, but it has an id to sweep with — so sweep it. This is the
        // "grab the expansions" half of the request, and it is the only reason
        // this panel is worth opening on a game added seconds ago.
        if (data.state === 'never_checked' && data.bggId != null) {
          if (live) setState('asking');
          await api.backfillComponents({ itemId });
          if (!live) return;
          data = await api.completeness(itemId);
        }

        if (!live) return;
        setReport(data);
        setState('ready');
      } catch (err) {
        if (!live) return;
        setError(err);
        setState('error');
      }
    })();

    return () => {
      live = false;
    };
  }, [itemId]);

  if (state === 'loading' || state === 'asking') {
    return (
      <Spinner
        label={
          state === 'asking'
            ? 'Asking BoardGameGeek what else exists…'
            : 'Looking for expansions…'
        }
      />
    );
  }

  // Quiet on failure. This is a bonus offered after the thing the person came
  // for has already worked, and an error box about a lookup they did not ask
  // for would read as though the wishlist add had failed.
  if (state === 'error' || !report) {
    return (
      <p className="muted small">
        Could not check what expansions exist for this one.{' '}
        <Link to={`/items/${itemId}`}>Open the game</Link> to look again.
      </p>
    );
  }

  /*
    Only expansions — accessories, promos and the third-party pile are all on
    the game's own page, one link away. This panel answers "what else can I
    *play*".

    ⚠️ **And only rows the catalog has never heard of.** `outstanding` is
    everything not proven `held`, and a copy marked `wanted` is not held — so a
    component put on the wishlist a moment ago comes back in this very list,
    with `matchedItemId` set and the note "Already on your wishlist". Left in,
    it is a ticked box that adds the same thing twice, and the second attempt
    fails on the unique BoardGameGeek id index. `AddComponent` on the
    completeness report drops its buttons on exactly this test, for exactly this
    reason.
  */
  const offered = report.expansions.outstanding.filter((c) => c.matchedItemId == null);

  if (report.state !== 'checked' || offered.length === 0) {
    return (
      <p className="muted small">
        {report.bggId == null
          ? 'Not matched to BoardGameGeek, so there is no expansion list to offer. '
          : 'No expansions outstanding for this one. '}
        <Link to={`/items/${itemId}`}>Open the game</Link> to see everything filed under it.
      </p>
    );
  }

  const chosen = offered.filter((c) => picked.has(c.bggId));

  const toggle = (bggId: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(bggId)) next.delete(bggId);
      else next.add(bggId);
      return next;
    });

  async function addChosen() {
    setBusy(true);
    setError(null);
    try {
      /*
        Sequential, deliberately, where `Arrivals` fires its writes in parallel.
        Each of these creates an *item*, and `createItem` runs the orphan sweep
        on the way out; several of those racing on one parent is a needless
        argument over the same rows. A wishlist add is also half a dozen rows at
        most, against a preorder's twenty-two.
      */
      const done: string[] = [];
      const failed: string[] = [];
      for (const component of chosen) {
        try {
          await addComponent(component, itemId, 'wanted');
          done.push(component.name);
        } catch {
          failed.push(component.name);
        }
      }

      if (done.length > 0) {
        onAdded(
          done.length === 1
            ? `“${done[0]}” is on the wishlist too.`
            : `${done.length} expansions of ${gameName} are on the wishlist too.`,
        );
      }
      if (failed.length > 0) {
        setError(new Error(`Could not add: ${failed.join(', ')}.`));
      }

      // Drop what landed and keep what did not, so a retry repeats only the
      // failures — and re-read the report, because what was just created is no
      // longer outstanding.
      setPicked(new Set(chosen.filter((c) => failed.includes(c.name)).map((c) => c.bggId)));
      setReport(await api.completeness(itemId));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wishlist-expansions">
      {/* A disclosure, not an open list. The panel appears under a game that has
          just been added — the job is done, and six more rows unfurling
          uninvited would read as though it were not. */}
      <button
        type="button"
        className="btn btn-quiet wishlist-expansions__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Hide expansions' : `See expansions (${offered.length})`}
      </button>

      {open && (
        <>
          <p className="muted small">
            Tick anything you want as well. Nothing is ticked to start with —
            adding a game is not the same as wanting everything made for it.
          </p>

          {error != null && <ErrorBox error={error} what="Could not add all of those" />}

          <ul className="wishlist-expansions__list">
            {offered.map((component) => (
              <ExpansionRow
                key={component.bggId}
                component={component}
                checked={picked.has(component.bggId)}
                disabled={busy}
                onToggle={() => toggle(component.bggId)}
              />
            ))}
          </ul>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || chosen.length === 0}
              onClick={() => void addChosen()}
            >
              {busy
                ? 'Adding…'
                : chosen.length === 0
                  ? 'Nothing ticked'
                  : chosen.length === 1
                    ? 'Add it to the wishlist'
                    : `Add ${chosen.length} to the wishlist`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ExpansionRow({
  component,
  checked,
  disabled,
  onToggle,
}: {
  component: ComponentStatus;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="wishlist-expansion">
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        <span className="child-name">{component.name}</span>
        {component.yearPublished && (
          <span className="muted small">{component.yearPublished}</span>
        )}
        {/* The report's own words for why this is not simply held — "Already on
            your wishlist", "a name matched but no id agrees". Shown because it
            is the difference between a thing worth ticking and one already
            dealt with. */}
        {component.note && <span className="wishlist-expansion__note">{component.note}</span>}
      </label>
    </li>
  );
}
