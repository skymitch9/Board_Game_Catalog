import { copyStateLabel, type CopyEvent } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { formatDate } from '../lib/dates';

/**
 * What has happened to this game — the append-only record.
 *
 * *"For sold and lent we can mark them as not owned anymore but we should keep
 * a history of them items."* — the owner, 2026-08-09. This is the second half
 * of that sentence, and the half a status column cannot do: setting `sold`
 * OVERWRITES `owned`, so "we had this from March to August" is gone the moment
 * it is recorded.
 *
 * ⚠️ **There is no edit and no delete here, and there never will be.**
 * `copy_event` carries triggers refusing both (migration 0029). Correcting a
 * mistake is a new event, the same way buying something back is a new copy.
 *
 * Renders nothing at all when there is no history — which is every game in the
 * catalog today. An empty "History" card on 640 pages would be 640 places to
 * learn nothing.
 */
export function CopyHistory({ itemId }: { itemId: number }) {
  const [events] = useAsync(() => api.itemHistory(itemId), [itemId]);

  // ⚠️ A failed load is silent on purpose, and it is the one thing here worth
  // arguing about. This is a supplementary panel beside the shelf; an error box
  // for a history nobody asked to see would report a fault in a section that,
  // for almost every game, has nothing in it. The shelf above is what carries
  // the copy's own state, and it fails loudly.
  if (events.state !== 'ok') return null;
  if (events.data.events.length === 0) return null;

  return (
    <section className="card">
      <div className="section-head">
        <h2>History</h2>
      </div>
      <ul className="history-list">
        {events.data.events.map((e) => (
          <HistoryRow key={e.id} event={e} />
        ))}
      </ul>
      <p className="muted small">
        Every status change is recorded here and nothing can remove it — including
        deleting the copy, or the game.
      </p>
    </section>
  );
}

/** "$25.00", or null when there was no money. */
function formatPrice(cents: number | null): string | null {
  if (cents == null) return null;
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

/**
 * One line of history, in English rather than in columns.
 *
 * "Given away to Dave" beats a `from_status`/`to_status` pair for the same
 * reason the copy badge reads "given away" and not "sold": the stored shape is
 * a storage decision, and the person reading it should never have to know that
 * a gift is filed under `sold`.
 */
function HistoryRow({ event }: { event: CopyEvent }) {
  const to = copyStateLabel(event.toStatus, event.disposal);
  const from = event.fromStatus ? copyStateLabel(event.fromStatus, null) : null;
  const price = formatPrice(event.priceCents);

  const detail = [
    event.counterpart ? `to ${event.counterpart}` : null,
    price ? `for ${price}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className="history-row">
      <span className="history-when">{formatDate(event.at, { dateStyle: 'medium' })}</span>
      <span className="history-what">
        {from ? `${from} → ${to}` : to}
        {detail ? ` ${detail}` : ''}
      </span>
      {event.note && <span className="history-note">{event.note}</span>}
      {/* The copy is gone but the event is not — see migration 0029's SET NULL.
          Saying so is what stops the row reading as a bug. */}
      {event.copyId == null && (
        <span className="muted small">that copy has since been removed from the catalog</span>
      )}
    </li>
  );
}
