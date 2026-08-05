import { useState } from 'react';
import {
  RELATION_TYPES,
  isTrustedMatch,
  type Item,
  type MeResponse,
  type RelatedItemRef,
  type RelationType,
  type UpdateItemInput,
} from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link, navigate } from '../router';
import { CopyForm, CopyRow } from '../components/CopyEditor';
import { ItemForm } from '../components/ItemForm';
import { KIND_LABEL, STATUS_TONE } from '../components/ItemTree';
import { Ratings } from '../components/Ratings';
import { Badge, ConfirmButton, EmptyState, ErrorBox, Spinner } from '../components/ui';

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
      <ItemForm
        existing={item}
        parentId={item.parentItemId}
        parentName={item.parent?.name ?? null}
        onSaved={() => navigate(`/items/${item.id}`)}
        onCancel={() => navigate(`/items/${item.id}`)}
      />
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
          <h1>
            {item.name}
            {item.yearPublished && <span className="item-year"> ({item.yearPublished})</span>}
          </h1>
          <p className="subtitle">
            {[
              item.publisher,
              item.designers,
              item.minPlayers && item.maxPlayers
                ? `${item.minPlayers}–${item.maxPlayers} players`
                : null,
              item.playtimeMin ? `${item.playtimeMin} min` : null,
              item.weight ? `weight ${item.weight}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No details recorded'}
          </p>
          <ExternalLinks item={item} />
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
 */
function LookupDetails({
  item,
  onFilled,
}: {
  item: Item;
  onFilled: (summary: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const missing = FILLABLE.filter(({ key }) => isBlank(item[key]));

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

  if (missing.length === 0) return null;

  return (
    <section className="card lookup-fill">
      <div className="lookup-fill__row">
        <div className="grow">
          <strong>No {inWords(missing.map((m) => m.label))} recorded</strong>
          <p className="muted small">
            A free lookup by name, from the same sources the scanner uses. Only blanks are
            filled — anything already written down stays as it is.
          </p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? 'Looking…' : 'Look up details'}
        </button>
      </div>

      {note && <p className="scan-note">{note}</p>}
      {error != null && <ErrorBox error={error} what="Could not look that up" />}
    </section>
  );
}

export const RELATION_LABEL: Record<RelationType, string> = {
  works_with: 'Works with',
  reimplements: 'Reimplements',
  integrates_with: 'Integrates with',
};

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

  // Don't show the section if there are no relations and the user can't edit.
  if (relatedItems.length === 0 && !canEdit) return null;

  return (
    <section className="card">
      <div className="section-head">
        <h2>
          Related games
          {relatedItems.length > 0 && <span className="count"> {relatedItems.length}</span>}
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

      {relatedItems.length === 0 && !adding ? (
        <p className="muted">
          No linked games{canEdit ? ' — link standalone games that play together.' : '.'}
        </p>
      ) : (
        <ul className="child-list">
          {relatedItems.map((rel) => (
            <li key={rel.relationId}>
              <Link to={`/items/${rel.itemId}`} className="child-link">
                {rel.thumbnailUrl && <img className="thumb thumb-sm" src={rel.thumbnailUrl} alt="" />}
                <span className="child-name">{rel.name}</span>
                <Badge tone="kind">{RELATION_LABEL[rel.relation]}</Badge>
              </Link>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-quiet btn-xs"
                  onClick={() => handleRemove(rel.relationId)}
                  aria-label={`Unlink ${rel.name}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Where to read more about this game.
 *
 * BoardGameGeek is derived, not stored: a `bggId` is all you need, and building
 * the URL means a scanned game links out the moment it resolves, with no extra
 * column and nothing to keep in sync. `rel="noreferrer"` on both because there
 * is no reason to leak where the click came from.
 */
function ExternalLinks({ item }: { item: { bggId: number | null; publisherUrl: string | null } }) {
  const links: { href: string; label: string }[] = [];

  if (item.bggId != null) {
    links.push({
      href: `https://boardgamegeek.com/boardgame/${item.bggId}`,
      label: 'BoardGameGeek',
    });
  }
  if (item.publisherUrl) {
    links.push({ href: item.publisherUrl, label: 'Publisher' });
  }

  if (links.length === 0) return null;

  return (
    <p className="external-links">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener">
          {l.label} ↗
        </a>
      ))}
    </p>
  );
}
