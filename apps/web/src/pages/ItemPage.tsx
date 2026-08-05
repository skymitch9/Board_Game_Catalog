import { useState } from 'react';
import { type MeResponse } from '@bgc/core';
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
