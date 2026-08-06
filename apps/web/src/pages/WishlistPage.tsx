import { useState } from 'react';
import type { MeResponse, WishlistEntry } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link } from '../router';
import { KIND_LABEL } from '../components/ItemTree';
import { Badge, Cover, EmptyState, ErrorBox, ParentLabel, Spinner } from '../components/ui';

/**
 * What we want but do not have.
 *
 * Item-level on purpose. The collection page filters game *trees*, so a wanted
 * expansion pulls in its base game and everything else filed under it — right
 * for browsing, useless as a shopping list. This page asks the server for the
 * copies actually marked `wanted` and shows exactly those.
 */
export function WishlistPage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.wishlist(), []);
  /** Copy ids currently being flipped, so a row can't be double-submitted. */
  const [busy, setBusy] = useState<number | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const canEdit = me.capabilities.includes('editCatalog');

  async function markBought(entry: WishlistEntry) {
    setBusy(entry.copyId);
    setError(null);
    try {
      // The ordinary copy update — the same call the item page's copy editor
      // makes. Nothing about buying a game is special enough to deserve its own
      // endpoint, and a second write path is a second one to keep correct.
      await api.updateCopy(entry.copyId, { status: 'owned' });
      setBought(`“${entry.name}” is now marked as owned.`);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Wishlist</h1>
          <p className="subtitle">
            {state.state === 'ok'
              ? state.data.entries.length === 0
                ? 'Nothing on the list'
                : `${state.data.entries.length} game${state.data.entries.length === 1 ? '' : 's'} wanted`
              : 'Games we want but do not have'}
          </p>
        </div>
        <div className="head-actions">
          <Link to="/" className="btn btn-quiet">
            Collection
          </Link>
        </div>
      </header>

      {bought && <p className="lookup-filled">{bought}</p>}
      {error != null && <ErrorBox error={error} what="Could not mark that as bought" />}

      {state.state === 'loading' && <Spinner label="Loading the wishlist…" />}
      {state.state === 'error' && (
        <ErrorBox error={state.error} what="Could not load the wishlist" />
      )}

      {state.state === 'ok' && state.data.entries.length === 0 && (
        <EmptyState title="Nothing wanted yet">
          <p className="muted">
            A game lands here when one of its copies has the status{' '}
            <strong>wanted</strong> — set that when adding it, or change an existing
            copy&rsquo;s status on the game&rsquo;s page.
          </p>
          {canEdit && (
            <p className="muted">
              <Link to="/scan">Add a game</Link>
            </p>
          )}
        </EmptyState>
      )}

      {state.state === 'ok' && state.data.entries.length > 0 && (
        <ul className="candidate-list wishlist">
          {state.data.entries.map((entry) => (
            <li key={entry.copyId} className="candidate">
              {/* 20 of the 25 wanted rows have no cover of their own — a thing
                  nobody has bought yet rarely does — so this is mostly the
                  game's art, borrowed. The linked parent name beside it is what
                  keeps that legible; a dashed placeholder is the last resort. */}
              <Cover item={entry} />

              <div className="candidate__body">
                <strong>
                  <Link to={`/items/${entry.itemId}`}>{entry.name}</Link>
                  {/* The box it belongs to, linked. Naming it was already right;
                      making it clickable is what turns "which one is Marine
                      Worlds for?" into one tap instead of a search. */}
                  <ParentLabel id={entry.parentItemId} name={entry.parentName} />
                  {entry.yearPublished && (
                    <span className="item-year"> ({entry.yearPublished})</span>
                  )}
                  {entry.quantity > 1 && <span className="muted small"> ×{entry.quantity}</span>}
                </strong>

                <span className="candidate__meta">
                  <Badge tone="wanted">wanted</Badge>
                  {entry.kind !== 'base' && <Badge tone="kind">{KIND_LABEL[entry.kind]}</Badge>}
                </span>

                <span className="muted">
                  {[
                    entry.publisher,
                    entry.minPlayers && entry.maxPlayers
                      ? `${entry.minPlayers}–${entry.maxPlayers} players`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No details yet'}
                </span>

                {entry.notes && <span className="candidate__note">{entry.notes}</span>}
              </div>

              {canEdit && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === entry.copyId}
                  onClick={() => void markBought(entry)}
                >
                  {busy === entry.copyId ? 'Saving…' : 'Mark as bought'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
