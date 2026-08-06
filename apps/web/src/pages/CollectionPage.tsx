import { useEffect, useState } from 'react';
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
  const [gameSystem, setGameSystem] = useState('');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounced(search);

  // Any change to what is being filtered invalidates where you were in it —
  // page 4 of the whole catalog is not page 4 of a search for "catan".
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, kind, uncatalogued, duplicates, gameSystem]);

  const query: ItemQuery = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(status ? { status: status as ItemQuery['status'] } : {}),
    ...(kind ? { kind: kind as ItemQuery['kind'] } : {}),
    ...(uncatalogued ? { uncatalogued: true } : {}),
    ...(duplicates ? { duplicates: true } : {}),
    ...(gameSystem ? { gameSystem } : {}),
    ...(page > 1 ? { page } : {}),
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
    gameSystem,
    page,
  ]);

  const goToPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const canEdit = me.capabilities.includes('editCatalog');
  const filtersActive = Boolean(
    debouncedSearch || status || kind || uncatalogued || duplicates || gameSystem,
  );
  // Only offered when there is something to choose between. A collection of
  // board games records no rulesets, and a dropdown with one empty option in it
  // is a control that teaches you nothing.
  const systems = meta.state === 'ok' ? meta.data.gameSystems : [];

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
              {meta.data.stats.digitalCopies > 0 && ` · ${meta.data.stats.digitalCopies} digital`}
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
            {/*
              Three doors, and the middle one exists because the first two were
              not enough.

              "Add games" is bulk intake and "Check a game" is the one-off
              in-a-shop question — that split is still right, and neither has
              moved. What was wrong is that barcode scanning lived *only* behind
              "Check a game", so the fastest and most exact way to add a game
              was hidden behind a button that sounded like it only answered a
              question. The owner went looking for it under "Add games" and
              concluded the feature had been removed.

              So barcode scanning is now a first-class tab of Add games — the
              first one, since a code is the only exact identification here —
              and this button is a direct way in. It goes to the same page as
              "Add games", named for what you do rather than for the queue you
              end up in.
            */}
            <Link to="/scan-jobs" className="btn btn-primary">
              + Add games
            </Link>
            <Link to="/scan-jobs?add=barcode" className="btn btn-quiet">
              Scan a barcode
            </Link>
            <Link to="/scan" className="btn btn-quiet">
              Check a game
            </Link>
            <Link to="/retag" className="btn btn-quiet">
              Related games
            </Link>
            <Link to="/details" className="btn btn-quiet">
              Fill in details
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

          {systems.length > 0 && (
            <select
              value={gameSystem}
              onChange={(e) => setGameSystem(e.target.value)}
              aria-label="Game system"
            >
              <option value="">Any system</option>
              {systems.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.items})
                </option>
              ))}
            </select>
          )}

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
                setGameSystem('');
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
            {/* The count is every match, not the page. Saying "25 games" while
                paging through 107 would read as a filter nobody applied. */}
            {items.data.total} game{items.data.total === 1 ? '' : 's'}
            {filtersActive && ' matching'}
            {items.data.pageCount > 1 &&
              ` · page ${items.data.page} of ${items.data.pageCount}`}
            {canEdit && <ExportLinks />}
          </p>
          <div className="item-list">
            {items.data.items.map((node) => (
              <ItemCard key={node.id} node={node} />
            ))}
          </div>

          {items.data.pageCount > 1 && (
            <nav className="pager" aria-label="Collection pages">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={items.data.page <= 1}
                onClick={() => goToPage(items.data.page - 1)}
              >
                ← Previous
              </button>
              <span className="pager__where">
                {(items.data.page - 1) * items.data.pageSize + 1}–
                {Math.min(items.data.page * items.data.pageSize, items.data.total)} of{' '}
                {items.data.total}
              </span>
              <button
                type="button"
                className="btn btn-quiet"
                disabled={items.data.page >= items.data.pageCount}
                onClick={() => goToPage(items.data.page + 1)}
              >
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
