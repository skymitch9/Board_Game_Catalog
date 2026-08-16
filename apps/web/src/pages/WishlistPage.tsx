import { useMemo, useState } from 'react';
import { buyLinksFor, type BuyLink, type MeResponse, type WishlistEntry } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link } from '../router';
import { KIND_LABEL } from '../components/ItemTree';
import {
  Badge,
  ConfirmButton,
  Cover,
  EmptyState,
  ErrorBox,
  ParentLabel,
  Spinner,
} from '../components/ui';
import { WishlistAddForm } from '../components/WishlistAdd';

/**
 * What we want but do not have, filed under the game it belongs to.
 *
 * Item-level on purpose. The collection page filters game *trees*, so a wanted
 * expansion pulls in its base game and everything else filed under it — right
 * for browsing, useless as a shopping list. This page asks the server for the
 * copies actually marked `wanted` and shows exactly those.
 *
 * ## Read on a phone, standing in a shop
 *
 * *"I don't want to scroll 50 Dice Throne playmats to see other things I want to
 * buy in a game store or at a con"* — the owner. That sentence decides the whole
 * layout: this is a list somebody thumbs through one-handed with a box in the
 * other, not a page anybody sits and reads.
 */

/**
 * One game and everything wanted from it.
 *
 * Keyed on the **root**, which is what `rootGameId` gives us — see the comment
 * on that field. Grouping on the immediate parent would file the eight X-Men
 * playmats under eight separate hero boxes and solve nothing.
 */
interface WishlistGroup {
  id: number;
  name: string;
  entries: WishlistEntry[];
  /** Rows, which is what the section holds. */
  rows: number;
  /** Units, which is what you would carry out of the shop. Differs rarely. */
  units: number;
}

/**
 * Above this many rows, a section starts shut.
 *
 * **Measured against production, 2026-08-08.** 25 wanted rows across 7 games:
 * 8 (Dice Throne: X-Men), 8 (Marvel Dice Throne), 4 (Ark Nova), 2, 1, 1, 1 —
 * and 18 of those 25 are literally playmats. So the owner's complaint is real
 * and it is not close: four fifths of the list is Dice Throne accessories, and
 * the five rows they bury are the ones anybody would buy in a shop.
 *
 * Five is where the line goes because a phone shows about five of these rows at
 * once. A section that cannot fit on one screen is a section that pushes
 * everything after it off the bottom, which is exactly the complaint. Above the
 * line: both eights. Below it: everything else, still open, so **the four Ark
 * Nova rows and the Pangea cup holder are visible without a single tap** — zero
 * taps for what was buried, one tap for what did the burying.
 *
 * Collapsing *everything* by default was the other candidate and is worse: it
 * turns the page into a menu, and the thing the owner asked to see would then
 * cost a tap it does not cost today.
 *
 * Nothing is lost when a section is shut, because the count is on the header.
 */
const COLLAPSE_ABOVE = 5;

function groupByGame(entries: WishlistEntry[]): WishlistGroup[] {
  // Insertion order, which is the server's order: it sorts by the root game's
  // sort name, so groups come out alphabetical and contiguous with no second
  // sort here to disagree with it.
  const byRoot = new Map<number, WishlistGroup>();
  for (const entry of entries) {
    const id = entry.rootGameId ?? entry.itemId;
    const group = byRoot.get(id) ?? {
      id,
      name: entry.rootGameName ?? entry.name,
      entries: [],
      rows: 0,
      units: 0,
    };
    group.entries.push(entry);
    group.rows += 1;
    group.units += entry.quantity;
    byRoot.set(id, group);
  }
  return [...byRoot.values()];
}

export function WishlistPage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.wishlist(), []);
  /** Copy ids currently being flipped, so a row can't be double-submitted. */
  const [busy, setBusy] = useState<number | null>(null);
  /** One line of "that worked", shared by buying a row and by adding one. */
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  /**
   * Only the sections somebody has actually opened or shut, by root id.
   *
   * Deliberately not the set of open sections: a row leaving the list when it is
   * bought re-groups everything, and an absolute set would have to be reconciled
   * with data it no longer matches. Holding just the overrides means the size
   * rule keeps deciding for every section nobody has touched, including any that
   * appear later.
   */
  const [choice, setChoice] = useState<Record<number, boolean>>({});
  /** The add form, which is shut until asked for — see `WishlistAdd`. */
  const [adding, setAdding] = useState(false);

  // The wishlist split (2026-08-16 role redesign): `suggestWishlist`
  // (member+) is "I want this" — the Add door; `manageWishlist`
  // (contributor+) is curate/remove — marking a row bought or taking it off
  // the list. See capabilities.ts for the full split.
  const canSuggest = me.capabilities.includes('suggestWishlist');
  const canManage = me.capabilities.includes('manageWishlist');
  const entries = state.state === 'ok' ? state.data.entries : [];
  const groups = useMemo(() => groupByGame(entries), [entries]);

  const isOpen = (g: WishlistGroup) => choice[g.id] ?? g.rows <= COLLAPSE_ABOVE;
  const anyShut = groups.some((g) => !isOpen(g));

  const setAll = (open: boolean) =>
    setChoice(Object.fromEntries(groups.map((g) => [g.id, open])));

  async function markBought(entry: WishlistEntry) {
    setBusy(entry.copyId);
    setError(null);
    try {
      // The ordinary copy update — the same call the item page's copy editor
      // makes. Nothing about buying a game is special enough to deserve its own
      // endpoint, and a second write path is a second one to keep correct.
      await api.updateCopy(entry.copyId, { status: 'owned' });
      setNotice(`“${entry.name}” is now marked as owned.`);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Changed your mind — take it off the list.
   *
   * **Deletes the `wanted` copy and nothing else.** A wishlist row *is* a copy,
   * so this is the ordinary `DELETE /api/copies/:id` — the same call the item
   * page's copy list makes. No wishlist-specific write route, for the reason
   * written on `/wishlist` itself: a second way to change what is on the list is
   * a second thing to keep honest.
   *
   * ⚠️ **The catalog row stays**, deliberately, even when this was its only
   * copy. Deleting the item would cascade to its children, ratings, barcodes and
   * relations — and for a row that has been in the catalog for months and merely
   * gained a wanted copy, that is destroying evidence to undo a shopping
   * decision. What is left is an item with no copies, which the collection shows
   * honestly as "not catalogued" and which can be deleted from its own page in
   * two taps by somebody who has looked at what they are deleting.
   */
  async function removeWanted(entry: WishlistEntry) {
    setBusy(entry.copyId);
    setError(null);
    try {
      await api.deleteCopy(entry.copyId);
      setNotice(`“${entry.name}” is off the wishlist.`);
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
              ? entries.length === 0
                ? 'Nothing on the list'
                : `${entries.length} game${entries.length === 1 ? '' : 's'} wanted · ` +
                  `${groups.length} ${groups.length === 1 ? 'game' : 'games'}`
              : 'Games we want but do not have'}
          </p>
        </div>
        <div className="head-actions">
          {/* First in the row, and the only primary button on the screen. The
              owner came here, could not find a way to add something, and had to
              ask — so this is not a control to tuck away behind a menu. */}
          {canSuggest && !adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add
            </button>
          )}
          {groups.length > 1 && (
            <button type="button" className="btn btn-quiet" onClick={() => setAll(anyShut)}>
              {anyShut ? 'Open all' : 'Close all'}
            </button>
          )}
          <Link to="/" className="btn btn-quiet">
            Collection
          </Link>
        </div>
      </header>

      {canSuggest && adding && (
        <WishlistAddForm
          me={me}
          onAdded={(message) => {
            setNotice(message);
            refresh();
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {notice && <p className="lookup-filled">{notice}</p>}
      {error != null && <ErrorBox error={error} what="Could not mark that as bought" />}

      {state.state === 'loading' && <Spinner label="Loading the wishlist…" />}
      {state.state === 'error' && (
        <ErrorBox error={state.error} what="Could not load the wishlist" />
      )}

      {state.state === 'ok' && entries.length === 0 && (
        <EmptyState title="Nothing wanted yet">
          <p className="muted">
            A game lands here when one of its copies has the status{' '}
            <strong>wanted</strong> — set that when adding it, or change an existing
            copy&rsquo;s status on the game&rsquo;s page.
          </p>
          {/* The page's own door, not a link to `/scan`. Sending somebody to
              the scanner to record something they do not have yet was always
              the wrong direction — that page is for boxes in your hand. */}
          {canSuggest && !adding && (
            <p className="muted">
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                + Add something
              </button>
            </p>
          )}
        </EmptyState>
      )}

      {state.state === 'ok' && entries.length > 0 && (
        <>
          {/* Said once, at the top, rather than on each of twenty-five rows. A
              shop link is a search and the page has to say so somewhere; the
              place that costs least is here. */}
          <p className="muted small wishlist-legend">
            Shop links search that shop for the item&rsquo;s name — most of this list was
            crowdfunded and never sold at retail, so an empty result is a real answer.
          </p>

          <div className="item-list">
            {groups.map((group) => {
              const open = isOpen(group);
              return (
                <section className="card wishlist-group" key={group.id}>
                  {/*
                    The whole header is the toggle, not a caret beside it. This
                    is the control the owner presses most on this screen and it
                    is pressed with a thumb, so it gets the full width of the
                    card rather than a 20px chevron.
                  */}
                  <button
                    type="button"
                    className="item-head wishlist-group__head"
                    aria-expanded={open}
                    aria-controls={`wishlist-group-${group.id}`}
                    onClick={() => setChoice({ ...choice, [group.id]: !open })}
                  >
                    {/* The first row that HAS art, not the first row — the same
                        rule `GroupCard` uses, and for the same reason: a wanted
                        row's cover is usually borrowed and some have none. */}
                    <Cover
                      item={{
                        thumbnailUrl:
                          group.entries.find((e) => e.thumbnailUrl)?.thumbnailUrl ?? null,
                        inheritedCover: group.entries.find((e) => e.inheritedCover)
                          ?.inheritedCover,
                      }}
                    />
                    <span className="item-head-text">
                      <span className="item-name">{group.name}</span>
                      <span className="item-sub">
                        {/* Rows, because rows are what is underneath. Units only
                            when they differ, which today is the one entry we
                            want two of — see the handoff on why the header
                            figure and the card figure count different things. */}
                        {group.rows} wanted
                        {group.units !== group.rows && ` · ${group.units} to buy`}
                      </span>
                    </span>
                    <span className="children-toggle__caret" aria-hidden="true" data-open={open}>
                      ▸
                    </span>
                  </button>

                  {/* The container is always in the tree so `aria-controls`
                      always points at something; its rows are not, so a shut
                      section of eight playmats costs no render. */}
                  <ul
                    className="candidate-list wishlist"
                    id={`wishlist-group-${group.id}`}
                    hidden={!open}
                  >
                    {open &&
                      group.entries.map((entry) => (
                        <WishlistRow
                          key={entry.copyId}
                          entry={entry}
                          canManage={canManage}
                          busy={busy === entry.copyId}
                          onBought={() => void markBought(entry)}
                          onRemoved={() => void removeWanted(entry)}
                        />
                      ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function WishlistRow({
  entry,
  canManage,
  busy,
  onBought,
  onRemoved,
}: {
  entry: WishlistEntry;
  /** Curate/remove — `manageWishlist` (contributor+), not `suggestWishlist`. */
  canManage: boolean;
  busy: boolean;
  onBought: () => void;
  /** Take it off the list — see `removeWanted` for what that does and does not delete. */
  onRemoved: () => void;
}) {
  return (
    <li className="candidate">
      {/* 20 of the 25 wanted rows have no cover of their own — a thing nobody
          has bought yet rarely does — so this is mostly the game's art,
          borrowed. The linked parent name beside it is what keeps that legible;
          a dashed placeholder is the last resort. */}
      <Cover item={entry} />

      <div className="candidate__body">
        <strong>
          <Link to={`/items/${entry.itemId}`}>{entry.name}</Link>
          {/* The box it belongs to, linked. Naming it was already right; making
              it clickable is what turns "which one is Marine Worlds for?" into
              one tap instead of a search. */}
          <ParentLabel id={entry.parentItemId} name={entry.parentName} />
          {entry.yearPublished && <span className="item-year"> ({entry.yearPublished})</span>}
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

        <BuyLinks entry={entry} />

        {entry.notes && <span className="candidate__note">{entry.notes}</span>}
      </div>

      {canManage && (
        <span className="wishlist-row__actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onBought}>
            {busy ? 'Saving…' : 'Mark as bought'}
          </button>
          {/*
            Two taps, via `ConfirmButton`, and quiet rather than red beside a
            primary button — the pair is asymmetric in consequence and a thumb
            moving fast must not read them as one control with two endings.
            "Mark as bought" is recoverable in a tap; this is not.
          */}
          <ConfirmButton
            className="btn btn-quiet danger-text"
            confirmLabel="Really remove?"
            onConfirm={onRemoved}
          >
            Remove
          </ConfirmButton>
        </span>
      )}
    </li>
  );
}

/**
 * Where to buy this row, best first.
 *
 * The ranking and every URL live in `packages/core/src/buy-links.ts`, which is
 * pure and has the research written down in it with a date. This component only
 * decides how the answer looks — so a shop moving, or the ranking changing, is
 * an edit to one file that no screen has to hear about.
 *
 * A search is drawn differently from a first-party link on purpose. The chip
 * for a shop carries a magnifier and an `aria-label` that says "Search X for
 * …", because sending somebody to a results page while implying it is a product
 * page is the one dishonest thing this feature could do.
 */
function BuyLinks({ entry }: { entry: WishlistEntry }) {
  const links = useMemo(() => buyLinksFor(entry), [entry]);
  if (links.length === 0) return null;

  return (
    <span className="buy-links">
      {links.map((link) => (
        <a
          key={link.href + link.label}
          className={`buy-link buy-link--${link.kind}`}
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          title={link.note}
          aria-label={labelFor(link, entry.name)}
        >
          {link.kind === 'search' && (
            <span className="buy-link__glyph" aria-hidden="true">
              ⌕
            </span>
          )}
          {link.label}
        </a>
      ))}
    </span>
  );
}

/** The chip's text is short; what a screen reader gets is not. */
function labelFor(link: BuyLink, name: string): string {
  if (link.kind === 'search') return `Search ${link.label} for ${name}. ${link.note}`;
  return `${link.label}. ${link.note}`;
}
