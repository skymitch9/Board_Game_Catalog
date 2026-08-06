import { useState } from 'react';
import {
  DETAIL_FIELD_LABEL,
  RELATION_TYPES,
  detailGaps,
  isTrustedMatch,
  type InheritedDetail,
  type ItemDetail,
  type MeResponse,
  type RelatedItemRef,
  type RelationType,
  type UpdateItemInput,
} from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link, navigate } from '../router';
import { Completeness } from '../components/Completeness';
import { CopyForm, CopyRow } from '../components/CopyEditor';
import { ItemForm } from '../components/ItemForm';
import { KIND_LABEL, STATUS_TONE } from '../components/ItemTree';
import { Ratings } from '../components/Ratings';
import {
  Badge,
  ConfirmButton,
  DigitalTag,
  EmptyState,
  ErrorBox,
  Spinner,
} from '../components/ui';

export function ItemPage({
  id,
  me,
  editing = false,
}: {
  id: number;
  me: MeResponse;
  editing?: boolean;
}) {
  const [detail, refresh] = useAsync(() => api.item(id), [id]);
  const [addingCopy, setAddingCopy] = useState(false);
  /**
   * Held here rather than inside the lookup panel: refreshing puts the page
   * back through its loading state, which unmounts everything below it. The
   * report of what changed has to outlive the reload that proves it.
   */
  const [filledNote, setFilledNote] = useState<string | null>(null);

  const canEdit = me.capabilities.includes('editCatalog');
  const canRate = me.capabilities.includes('rate');

  if (detail.state === 'loading') return <Spinner />;
  if (detail.state === 'error') {
    return <ErrorBox error={detail.error} what="Could not load this item" />;
  }

  const item = detail.data.item;
  const reload = () => refresh();

  if (editing) {
    return (
      <>
        <ItemForm
          existing={item}
          parentId={item.parentItemId}
          parentName={item.parent?.name ?? null}
          onSaved={() => navigate(`/items/${item.id}`)}
          onCancel={() => navigate(`/items/${item.id}`)}
        />
        {/* Unlinking lives here rather than beside the links themselves, so
            breaking a connection takes a deliberate trip to the edit screen
            while making one stays a single tap. */}
        <LinkEditor itemId={item.id} related={item.relatedItems} onChanged={reload} />
      </>
    );
  }

  return (
    <>
      <nav className="crumbs">
        <Link to="/">Collection</Link>
        {item.parent && (
          <>
            <span aria-hidden="true">›</span>
            <Link to={`/items/${item.parent.id}`}>{item.parent.name}</Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span className="crumb-current">{item.name}</span>
      </nav>

      <header className="page-head item-detail-head">
        {item.thumbnailUrl && <img className="thumb thumb-lg" src={item.thumbnailUrl} alt="" />}
        <div className="grow">
          <Badge tone="kind">{KIND_LABEL[item.kind]}</Badge>
          {/* Only when there is one. A board game carries its rules in the box,
              so most items have nothing here, and an empty badge or an
              "unknown" would be noise on 516 of 640 pages. */}
          {item.gameSystem && <Badge tone="lent">{item.gameSystem}</Badge>}
          <h1>
            {item.name}
            {item.yearPublished && <span className="item-year"> ({item.yearPublished})</span>}
          </h1>
          <Subtitle item={item} />
          <ExternalLinks item={item} />
          <Dependencies related={item.relatedItems} />
        </div>
        {canEdit && (
          <div className="head-actions">
            <Link to={`/items/${item.id}/edit`} className="btn btn-quiet">
              Edit
            </Link>
            <ConfirmButton
              confirmLabel={
                item.children.length > 0
                  ? `Delete and ${item.children.length} child item(s)?`
                  : 'Really delete?'
              }
              onConfirm={async () => {
                await api.deleteItem(item.id);
                navigate(item.parent ? `/items/${item.parent.id}` : '/');
              }}
            >
              Delete
            </ConfirmButton>
          </div>
        )}
      </header>

      {filledNote && <p className="lookup-filled">{filledNote}</p>}

      {canEdit && (
        <LookupDetails
          item={item}
          onFilled={(summary) => {
            setFilledNote(summary);
            reload();
          }}
          canResearch={me.capabilities.includes('runResearch')}
        />
      )}

      {item.description && <p className="description card">{item.description}</p>}

      <section className="card">
        <div className="section-head">
          <h2>Our copies</h2>
          {canEdit && !addingCopy && (
            <button type="button" className="btn btn-quiet" onClick={() => setAddingCopy(true)}>
              + Add copy
            </button>
          )}
        </div>

        {addingCopy && (
          <CopyForm
            itemId={item.id}
            onDone={() => {
              setAddingCopy(false);
              reload();
            }}
            onCancel={() => setAddingCopy(false)}
          />
        )}

        {item.copies.length === 0 && !addingCopy && (
          <p className="muted">
            Nothing recorded for this one yet
            {canEdit ? ' — add a copy to say we hold it.' : '.'}
          </p>
        )}

        {item.copies.length > 0 && (
          <ul className="copy-list">
            {item.copies.map((copy) => (
              <CopyRow key={copy.id} copy={copy} canEdit={canEdit} onChanged={reload} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>
            Expansions &amp; accessories
            {item.children.length > 0 && <span className="count"> {item.children.length}</span>}
          </h2>
          {canEdit && (
            <Link to={`/items/new?parent=${item.id}`} className="btn btn-quiet">
              + Add
            </Link>
          )}
        </div>

        {item.children.length === 0 ? (
          <p className="muted">
            Nothing filed under this{canEdit ? ' — expansions, promos, sleeves and inserts go here.' : '.'}
          </p>
        ) : (
          <ul className="child-list">
            {item.children.map((child) => {
              const primary = child.copies[0];
              return (
                <li key={child.id}>
                  <Link to={`/items/${child.id}`} className="child-link">
                    <span className="child-kind">{KIND_LABEL[child.kind]}</span>
                    <span className="child-name">{child.name}</span>
                    {/* A container of D&D Beyond books has 53 children and not
                        one of them can be handed across the table. Saying so
                        here is the difference between a shelf and a library
                        card. */}
                    {child.copies.length > 0 &&
                      child.copies.every((c) => c.format === 'digital') && <DigitalTag />}
                    {primary ? (
                      <Badge tone={STATUS_TONE[primary.status]}>
                        {child.copies.length > 1 ? `${child.copies.length} copies` : primary.status}
                      </Badge>
                    ) : (
                      <span className="muted">not catalogued</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Only on the game itself. The report is always about the tree's root,
          so rendering it on an expansion's page would repeat the base game's
          answer under a heading that reads as being about the expansion. */}
      {item.parentItemId == null && <Completeness item={item} canEdit={canEdit} />}

      <RelatedGames
        itemId={item.id}
        relatedItems={item.relatedItems}
        canEdit={canEdit}
        onChanged={reload}
      />

      <Ratings
        itemId={item.id}
        ratings={item.ratings}
        myEmail={me.email}
        canRate={canRate}
        onChanged={reload}
      />
    </>
  );
}

/**
 * Publisher and publisher site, as this page should show them.
 *
 * A playmat's publisher is its game's publisher, and the catalog deliberately
 * does not write that onto the playmat's row — a stored copy would be
 * indistinguishable later from a fact somebody checked, and would go stale the
 * moment the game's was corrected. So the value is resolved here, on the way to
 * the screen, and carries where it came from. See `packages/core/src/details.ts`.
 *
 * **The site is only borrowed alongside the publisher.** An item that records
 * its own publisher but no URL gets nothing: linking it to the ancestor's
 * website would name one company and point at another's.
 */
function resolvePublisher(item: ItemDetail): {
  publisher: string | null;
  publisherUrl: string | null;
  /** The ancestor the values were borrowed from — null when they are this item's own. */
  from: InheritedDetail | null;
} {
  const own = !isBlank(item.publisher);
  const borrowedName = own ? null : (item.inherited.publisher ?? null);
  const borrowedUrl = own ? null : (item.inherited.publisherUrl ?? null);

  return {
    publisher: own ? item.publisher : (borrowedName?.value ?? null),
    publisherUrl: isBlank(item.publisherUrl)
      ? (borrowedUrl?.value ?? null)
      : item.publisherUrl,
    from: borrowedName ?? borrowedUrl,
  };
}

/**
 * The line under the name — and the one place a value shown here may not be
 * this item's own.
 *
 * An inherited publisher is shown with a muted "from <game>" beside it rather
 * than silently, because a fact borrowed from the box upstairs and a fact
 * somebody looked up should not read identically. The name links, so the claim
 * can be checked in one tap.
 */
function Subtitle({ item }: { item: ItemDetail }) {
  const { publisher, from } = resolvePublisher(item);

  const rest = [
    item.designers,
    item.minPlayers && item.maxPlayers ? `${item.minPlayers}–${item.maxPlayers} players` : null,
    item.playtimeMin ? `${item.playtimeMin} min` : null,
    item.weight ? `weight ${item.weight}` : null,
  ].filter((part): part is string => Boolean(part));

  if (!publisher && rest.length === 0) {
    return <p className="subtitle">No details recorded</p>;
  }

  return (
    <p className="subtitle">
      {publisher}
      {publisher && from && (
        <span className="inherited-from">
          {' '}
          from <Link to={`/items/${from.fromItemId}`}>{from.fromName}</Link>
        </span>
      )}
      {publisher && rest.length > 0 && ' · '}
      {rest.join(' · ')}
    </p>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState title="No such page">
      <p className="muted">
        <Link to="/">Back to the collection</Link>
      </p>
    </EmptyState>
  );
}

/**
 * The details a name lookup can supply, in the order they get reported back.
 *
 * The keys are deliberately shared with `BarcodeCandidate`: a candidate and an
 * item name these fields identically, which is what lets one loop do the work
 * of seven near-identical assignments.
 */
type FillableKey =
  | 'publisher'
  | 'yearPublished'
  | 'minPlayers'
  | 'maxPlayers'
  | 'playtimeMin'
  | 'description'
  | 'thumbnailUrl';

const FILLABLE: { key: FillableKey; label: string }[] = [
  { key: 'publisher', label: 'publisher' },
  { key: 'yearPublished', label: 'year' },
  { key: 'minPlayers', label: 'min players' },
  { key: 'maxPlayers', label: 'max players' },
  { key: 'playtimeMin', label: 'play time' },
  { key: 'description', label: 'description' },
  { key: 'thumbnailUrl', label: 'cover image' },
];

const isBlank = (v: string | number | null): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '');

/** "publisher, year and cover image" — a sentence, not a list of columns. */
function inWords(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Fill in what nobody has got round to typing.
 *
 * The rule that makes this safe to offer at all: it only ever writes into
 * fields that are empty. A human who recorded a publisher knows something the
 * lookup does not — that the box on our shelf is the Spanish printing, say —
 * and a free API is in no position to correct them.
 *
 * Only shown while something is actually missing, so a fully-recorded game
 * carries no invitation to re-fetch what it already knows.
 *
 * **Missing and expected are two different things.** A dice tray is not asked
 * for a player count, so announcing that it has none would be scolding a record
 * for being exactly what it should be. `detailGaps` decides what is expected —
 * the same function the details queue is built from — and anything else that
 * happens to be blank is offered rather than demanded. The buttons stay either
 * way: this is the only per-item way in, and an expansion big enough to want a
 * description of its own should not have to be researched from the queue.
 */
function LookupDetails({
  item,
  onFilled,
  canResearch,
}: {
  item: ItemDetail;
  onFilled: (summary: string) => void;
  /** The web search costs money, so it is owner-only like the other paid calls. */
  canResearch: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // What a lookup could write into. A field answered by the game upstairs is
  // excluded: without that, every playmat in the catalog would offer to fill in
  // a publisher directly under a subtitle already displaying one.
  const missing = FILLABLE.filter(({ key }) => isBlank(item[key]) && !(key in item.inherited));

  // What this row is asked for and does not have — the queue's own test, so the
  // page and the queue can never disagree about whether a record is finished.
  // Empty for everything filed under a game.
  const gaps = detailGaps(item).map((field) => DETAIL_FIELD_LABEL[field]);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { candidates } = await api.lookup(item.name);
      const best = candidates[0];

      if (!best) {
        setNote(
          `No match for “${item.name}”. Photographing the box reads more off it than a name search can.`,
        );
        return;
      }
      if (!isTrustedMatch(best.name, item.name)) {
        setNote(
          `The closest thing found was “${best.name}”, which is different enough that nothing was changed.`,
        );
        return;
      }

      // TypeScript cannot see through the key union to prove this write sound,
      // so the claim is made once, here, rather than seven times below.
      const patch: Partial<Record<FillableKey, string | number>> = {};
      const filled: string[] = [];
      for (const { key, label } of missing) {
        const value = best[key];
        if (value == null || value === '') continue;
        patch[key] = value;
        filled.push(label);
      }

      if (filled.length === 0) {
        setNote(`“${best.name}” was found, but it knew nothing we were missing.`);
        return;
      }

      await api.updateItem(item.id, patch as UpdateItemInput);
      onFilled(`Filled in ${inWords(filled)} from “${best.name}”.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The paid fallback: Claude, with the open web.
   *
   * Offered separately rather than as an automatic second attempt, because it
   * costs a few cents and the free lookup is right often enough that spending
   * on every blank field would be silly. It is also the only thing that finds a
   * publisher — the free sources carry none at all, which is why a scanned
   * collection has an empty publisher on every game.
   */
  async function runWeb() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.fillItemDetails(item.id);
      const filled = Object.keys(res.filled);
      if (filled.length === 0) {
        setNote(res.detail ?? 'Nothing new was found on the web either.');
        return;
      }
      onFilled(`Filled in ${inWords(filled)} from the web.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (missing.length === 0 && gaps.length === 0) return null;

  return (
    <section className="card lookup-fill">
      <div className="lookup-fill__row">
        <div className="grow">
          {gaps.length > 0 ? (
            <>
              <strong>No {inWords(gaps)} recorded</strong>
              <p className="muted small">
                Only blanks are filled — anything already written down stays as it is.
                The free lookup uses the same sources as the scanner; searching the web
                costs a few cents and is the only thing that finds a publisher.
              </p>
            </>
          ) : (
            <>
              <strong>Nothing more is expected of this one</strong>
              <p className="muted small">
                Anything filed under a game takes that game&rsquo;s publisher, and is not
                asked for a year, a player count or a description of its own. Look it up
                anyway if you want the extra detail — only blanks are filled.
              </p>
            </>
          )}
        </div>
        <div className="lookup-fill__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
            {busy ? 'Looking…' : 'Free lookup'}
          </button>
          {canResearch && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => void runWeb()}
            >
              Search the web
            </button>
          )}
        </div>
      </div>

      {note && <p className="scan-note">{note}</p>}
      {error != null && <ErrorBox error={error} what="Could not look that up" />}
    </section>
  );
}

/**
 * Removing links, on the edit screen.
 *
 * Only links this game actually holds can be removed. A family member reached
 * through another game — Starfarers and New Energies are both Catans, without a
 * row between them — has no link of its own to break, and is shown greyed with
 * the reason rather than silently omitted, so the list matches what the game
 * page displays.
 */
function LinkEditor({
  itemId,
  related,
  onChanged,
}: {
  itemId: number;
  related: RelatedItemRef[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (related.length === 0) return null;

  async function unlink(relationId: number) {
    setBusy(relationId);
    setError(null);
    try {
      await api.removeRelation(relationId);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>Linked games</h2>
      <p className="muted small">
        Links are added from a game&rsquo;s page or the related games screen. This is
        where they come off.
      </p>

      {error != null && <ErrorBox error={error} what="Could not unlink" />}

      <ul className="child-list">
        {related.map((rel) => (
          <li key={rel.itemId}>
            <Link to={`/items/${rel.itemId}`} className="child-link">
              <span className="child-name">{rel.name}</span>
              <Badge tone="kind">{relationLabel(rel)}</Badge>
            </Link>
            {rel.relationId === null ? (
              <span className="muted small">via the family</span>
            ) : (
              <ConfirmButton
                confirmLabel={busy === rel.relationId ? 'Unlinking…' : 'Really unlink?'}
                onConfirm={() => void unlink(rel.relationId!)}
              >
                Unlink
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export const RELATION_LABEL: Record<RelationType, string> = {
  same_family: 'Same family',
  works_with: 'Works with',
  reimplements: 'Reimplements',
  integrates_with: 'Integrates with',
  requires: 'Requires',
};

/**
 * The label as read from *this* item's end.
 *
 * Only `requires` differs by direction, and getting it wrong is not a wording
 * nit — "Requires" on the core book's page is a false statement about what the
 * collection contains.
 */
function relationLabel(rel: RelatedItemRef): string {
  if (rel.relation === 'requires' && !rel.outgoing) return 'Needed by';
  return RELATION_LABEL[rel.relation];
}

/**
 * Standalone games that belong together — Dice Throne characters, Unmatched
 * fighters, standalone expansions that combine with a family. Each keeps its own
 * top-level entry in the collection; the link shows the connection without
 * nesting.
 */
function RelatedGames({
  itemId,
  relatedItems,
  canEdit,
  onChanged,
}: {
  itemId: number;
  relatedItems: RelatedItemRef[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [relation, setRelation] = useState<RelationType>('works_with');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(targetId);
    if (!id || id === itemId) return;
    setBusy(true);
    setError(null);
    try {
      await api.addRelation(itemId, { toItemId: id, relation });
      setTargetId('');
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(relationId: number) {
    try {
      await api.removeRelation(relationId);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  // `requires` is not shown here: it is a hard dependency, not a family
  // resemblance, and it already reads as a sentence at the top of the page.
  // Listing it in both places would say the same thing twice and, worse, would
  // say it without its direction.
  const linked = relatedItems.filter((r) => r.relation !== 'requires');

  // Don't show the section if there are no relations and the user can't edit.
  if (linked.length === 0 && !canEdit) return null;

  return (
    <section className="card">
      <div className="section-head">
        <h2>
          Related games
          {linked.length > 0 && <span className="count"> {linked.length}</span>}
        </h2>
        {canEdit && !adding && (
          <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>
            + Link
          </button>
        )}
      </div>

      {error != null && <ErrorBox error={error} what="Could not update relation" />}

      {adding && (
        <form className="relation-add" onSubmit={handleAdd}>
          <input
            type="number"
            placeholder="Item ID to link"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            required
            autoFocus
          />
          <select value={relation} onChange={(e) => setRelation(e.target.value as RelationType)}>
            {RELATION_TYPES.map((r) => (
              <option key={r} value={r}>{RELATION_LABEL[r]}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy || !targetId}>
            {busy ? 'Linking…' : 'Link'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}

      {linked.length === 0 && !adding ? (
        <p className="muted">
          No linked games{canEdit ? ' — link standalone games that play together.' : '.'}
        </p>
      ) : (
        /* No unlink button here on purpose. Easy to add, hard to break: a
           stray tap on a × beside a game you were about to open should not
           quietly sever a link, and half of these rows are family by
           implication anyway and have no single row to remove. Unlinking lives
           on the edit form, where you have already said you are editing. */
        <ul className="child-list">
          {linked.map((rel) => (
            <li key={rel.itemId}>
              <Link to={`/items/${rel.itemId}`} className="child-link">
                {rel.thumbnailUrl && <img className="thumb thumb-sm" src={rel.thumbnailUrl} alt="" />}
                <span className="child-name">{rel.name}</span>
                <Badge tone="kind">{relationLabel(rel)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What this cannot be used without, and what cannot be used without it.
 *
 * A plain statement rather than a badge, because it is a fact about whether the
 * thing is usable at all: Auroboros is unplayable without the Player's Handbook,
 * and a page that says nothing about that is hiding the most important thing it
 * knows.
 *
 * **The direction is the whole point.** `requires` is stored from the supplement
 * to the core book, and `outgoing` says which end you are standing at. Rendering
 * both ends with one sentence would have the Player's Handbook — which eight
 * things depend on — announcing that it requires all eight of them. So the two
 * directions get two different sentences, and the incoming one deliberately does
 * not use the word "requires" at all.
 */
function Dependencies({ related }: { related: RelatedItemRef[] }) {
  const requires = related.filter((r) => r.relation === 'requires' && r.outgoing);
  const neededBy = related.filter((r) => r.relation === 'requires' && !r.outgoing);
  if (requires.length === 0 && neededBy.length === 0) return null;

  const list = (refs: RelatedItemRef[]) =>
    refs.map((r, i) => (
      <span key={r.itemId}>
        {i > 0 && ', '}
        <Link to={`/items/${r.itemId}`}>{r.name}</Link>
      </span>
    ));

  return (
    <p className="requires">
      {requires.length > 0 && (
        <span className="requires__line">
          <strong>Requires:</strong> {list(requires)}
        </span>
      )}
      {neededBy.length > 0 && (
        <span className="requires__line muted">
          Needed by {neededBy.length === 1 ? '' : `${neededBy.length} things: `}
          {list(neededBy)}
        </span>
      )}
    </p>
  );
}

/** "Kickstarter", "Gamefound", or just "Campaign" for anywhere else. */
function campaignLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('kickstarter.com')) return 'Kickstarter';
    if (host.endsWith('gamefound.com')) return 'Gamefound';
    if (host.endsWith('backerkit.com')) return 'BackerKit';
    return 'Campaign';
  } catch {
    return 'Campaign';
  }
}

/**
 * Where to read more about this game.
 *
 * BoardGameGeek is derived, not stored: a `bggId` is all you need, and building
 * the URL means a scanned game links out the moment it resolves, with no extra
 * column and nothing to keep in sync. `rel="noreferrer"` on both because there
 * is no reason to leak where the click came from.
 */
function ExternalLinks({ item }: { item: ItemDetail }) {
  const links: { href: string; label: string; title?: string }[] = [];
  const { publisherUrl, from } = resolvePublisher(item);

  if (item.bggId != null) {
    links.push({
      href: `https://boardgamegeek.com/boardgame/${item.bggId}`,
      label: 'BoardGameGeek',
    });
  }
  if (publisherUrl) {
    // Titled, not relabelled: it is still the publisher's site, and a link that
    // read "Publisher (from Dice Throne Vanguard)" would say in the busiest row
    // on the page what the subtitle already says one line above.
    links.push({
      href: publisherUrl,
      label: 'Publisher',
      ...(isBlank(item.publisherUrl) && from ? { title: `From ${from.fromName}` } : {}),
    });
  }
  /*
    Where this pledge came from, which is not where the publisher lives — an
    item can have both, and for two thirds of this catalog the campaign page is
    the only authoritative record the box ever had. Named after the host so the
    two links cannot be confused for each other at a glance.
  */
  if (item.sourceUrl) {
    links.push({ href: item.sourceUrl, label: campaignLabel(item.sourceUrl) });
  }

  if (links.length === 0) return null;

  return (
    <p className="external-links">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener" title={l.title}>
          {l.label} ↗
        </a>
      ))}
    </p>
  );
}
