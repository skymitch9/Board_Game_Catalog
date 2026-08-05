import { useState } from 'react';
import { COPY_STATUSES, ITEM_KINDS, type ItemQuery, type MeResponse } from '@bgc/core';
import { api } from '../api';
import { useAsync, useDebounced } from '../hooks';
import { Link } from '../router';
import { ItemCard, KIND_LABEL } from '../components/ItemTree';
import { ExportLinks } from '../components/QuickAdd';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';

export function CollectionPage({ me }: { me: MeResponse }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [uncatalogued, setUncatalogued] = useState(false);
  const [duplicates, setDuplicates] = useState(false);

  const debouncedSearch = useDebounced(search);

  const query: ItemQuery = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(status ? { status: status as ItemQuery['status'] } : {}),
    ...(kind ? { kind: kind as ItemQuery['kind'] } : {}),
    ...(uncatalogued ? { uncatalogued: true } : {}),
    ...(duplicates ? { duplicates: true } : {}),
  };

  // Nothing on this page writes any more — adding happens on /scan, editing on
  // an item — so both loads are mount-and-filter, with no refresh to plumb.
  const [meta] = useAsync(() => api.meta(), []);
  const [items] = useAsync(() => api.items(query), [
    debouncedSearch,
    status,
    kind,
    uncatalogued,
    duplicates,
  ]);

  const canEdit = me.capabilities.includes('editCatalog');
  const filtersActive = Boolean(
    debouncedSearch || status || kind || uncatalogued || duplicates,
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Collection</h1>
          {meta.state === 'ok' && (
            <p className="subtitle">
              {meta.data.stats.baseGames} game{meta.data.stats.baseGames !== 1 ? 's' : ''}
              {meta.data.stats.expansions > 0 && ` · ${meta.data.stats.expansions} expansion${meta.data.stats.expansions !== 1 ? 's' : ''}`}
              {meta.data.stats.accessories > 0 && ` · ${meta.data.stats.accessories} accessor${meta.data.stats.accessories !== 1 ? 'ies' : 'y'}`}
              {meta.data.stats.wantedCopies > 0 && ` · ${meta.data.stats.wantedCopies} wanted`}
              {meta.data.stats.duplicatedItems > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => setDuplicates(true)}
                  >
                    {meta.data.stats.duplicatedItems} owned 2+
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="head-actions">
            {/* The queue is the front door: photograph the shelf, review at
                leisure. Everything else — barcode, typing — is reachable from
                there rather than competing with it here. */}
            <Link to="/scan-jobs" className="btn btn-primary">
              + Add games
            </Link>
          </div>
        )}
      </header>

      <div className="filters card">
        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search games, expansions, publishers, designers…"
          aria-label="Search"
        />
        <div className="filter-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {COPY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Any type</option>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>

          <label className="check-inline">
            <input
              type="checkbox"
              checked={uncatalogued}
              onChange={(e) => setUncatalogued(e.target.checked)}
            />
            Nothing recorded yet
          </label>

          <label className="check-inline">
            <input
              type="checkbox"
              checked={duplicates}
              onChange={(e) => setDuplicates(e.target.checked)}
            />
            We own 2+
          </label>

          {filtersActive && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setSearch('');
                setStatus('');
                setKind('');
                setUncatalogued(false);
                setDuplicates(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {items.state === 'loading' && <Spinner label="Loading collection…" />}
      {items.state === 'error' && <ErrorBox error={items.error} what="Could not load the collection" />}

      {items.state === 'ok' && items.data.items.length === 0 && (
        <EmptyState title={filtersActive ? 'Nothing matches' : 'The catalog is empty'}>
          {filtersActive ? (
            <p className="muted">Try loosening the filters.</p>
          ) : canEdit ? (
            <p className="muted">
              Start with a base game — expansions and accessories file underneath it.
            </p>
          ) : (
            <p className="muted">Nothing has been added yet.</p>
          )}
        </EmptyState>
      )}

      {items.state === 'ok' && items.data.items.length > 0 && (
        <>
          <p className="result-count muted">
            {items.data.items.length} game{items.data.items.length === 1 ? '' : 's'}
            {filtersActive && ' matching'}
            {canEdit && <ExportLinks />}
          </p>
          <div className="item-list">
            {items.data.items.map((node) => (
              <ItemCard key={node.id} node={node} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
