import { useState } from 'react';
import { COPY_STATUSES, ITEM_KINDS, formatMoney, type ItemQuery, type MeResponse } from '@bgc/core';
import { api } from '../api';
import { useAsync, useDebounced } from '../hooks';
import { Link } from '../router';
import { ItemCard, KIND_LABEL } from '../components/ItemTree';
import { ExportLinks, QuickAdd } from '../components/QuickAdd';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';

export function CollectionPage({ me }: { me: MeResponse }) {
  const [quickAdding, setQuickAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [kind, setKind] = useState('');
  const [uncatalogued, setUncatalogued] = useState(false);
  const [duplicates, setDuplicates] = useState(false);

  const debouncedSearch = useDebounced(search);

  const query: ItemQuery = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(status ? { status: status as ItemQuery['status'] } : {}),
    ...(location ? { location } : {}),
    ...(kind ? { kind: kind as ItemQuery['kind'] } : {}),
    ...(uncatalogued ? { uncatalogued: true } : {}),
    ...(duplicates ? { duplicates: true } : {}),
  };

  const [reloads, setReloads] = useState(0);
  const [meta, refreshMeta] = useAsync(() => api.meta(), [reloads]);
  const [items] = useAsync(() => api.items(query), [
    debouncedSearch,
    status,
    location,
    kind,
    uncatalogued,
    duplicates,
    reloads,
  ]);

  const reload = () => {
    setReloads((n) => n + 1);
    refreshMeta();
  };

  const canEdit = me.capabilities.includes('editCatalog');
  const filtersActive = Boolean(
    debouncedSearch || status || location || kind || uncatalogued || duplicates,
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Collection</h1>
          {meta.state === 'ok' && (
            <p className="subtitle">
              {meta.data.stats.baseGames} games · {meta.data.stats.totalItems} items ·{' '}
              {meta.data.stats.ownedCopies} owned
              {meta.data.stats.wantedCopies > 0 && ` · ${meta.data.stats.wantedCopies} wanted`}
              {meta.data.stats.spentCents > 0 && ` · ${formatMoney(meta.data.stats.spentCents)}`}
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
            <button
              type="button"
              className="btn"
              onClick={() => setQuickAdding((q) => !q)}
            >
              Quick add
            </button>
            <Link to="/items/new" className="btn btn-primary">
              + Add game
            </Link>
          </div>
        )}
      </header>

      {canEdit && quickAdding && (
        <QuickAdd
          locations={meta.state === 'ok' ? meta.data.locations : []}
          onAdded={reload}
          onClose={() => setQuickAdding(false)}
        />
      )}

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

          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Location"
            disabled={meta.state !== 'ok' || meta.data.locations.length === 0}
          >
            <option value="">Anywhere</option>
            {meta.state === 'ok' &&
              meta.data.locations.map((l) => (
                <option key={l} value={l}>
                  {l}
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
                setLocation('');
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
