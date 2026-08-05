import { useState } from 'react';
import type { MeResponse } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link } from '../router';

/**
 * "Three covers have stopped loading."
 *
 * A maintenance notice, not an error: nothing is broken about the catalog, an
 * image somebody else hosts has gone. So it is quiet, it is dismissible, and it
 * says nothing at all until a cover has failed on more than one run — the
 * server decides that, and only reports covers it is confident about.
 *
 * Dismissal is per browser session on purpose. Remembering it forever would
 * mean the one person who dismissed it never hears about the next dead cover
 * either; forgetting it on reload would make it nag. A session is the span in
 * which "yes, I know" is still true.
 */
const DISMISS_KEY = 'bgc.coverBannerDismissed';

export function CoverHealthBanner({ me }: { me: MeResponse }) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) !== null,
  );
  const [state] = useAsync(() => api.coverHealth(), []);

  // A failed or pending check is not worth saying anything about — this is a
  // notice about images, and it must never become the reason a page looks broken.
  if (dismissed || state.state !== 'ok' || state.data.health.dead.length === 0) return null;

  const dead = state.data.health.dead;
  const canEdit = me.capabilities.includes('editCatalog');
  // Several items can share one image, so the count of broken cards and the
  // count of dead links are different numbers. The cards are what you see.
  const urls = new Set(dead.map((d) => d.url)).size;

  return (
    <aside className="notice" role="status">
      <div className="notice__body">
        <strong>
          {dead.length} cover{dead.length === 1 ? '' : 's'} stopped loading
          {urls < dead.length && ` (${urls} image${urls === 1 ? '' : 's'})`}
        </strong>
        <span className="muted small">
          {canEdit
            ? 'The pictures are hotlinked from BoardGameGeek, Kickstarter and Gamefound — one of them has moved or removed a file. Open a game and use Edit to point it somewhere else.'
            : 'The pictures are hosted elsewhere and one has moved. An owner can repoint them.'}
        </span>
        <span className="notice__items">
          {dead.slice(0, 8).map((d) => (
            <Link key={d.itemId} to={`/items/${d.itemId}`}>
              {d.name}
            </Link>
          ))}
          {dead.length > 8 && <span className="muted small">and {dead.length - 8} more</span>}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
