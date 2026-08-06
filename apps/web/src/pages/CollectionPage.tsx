import { useEffect, useState } from 'react';
import { COPY_STATUSES, ITEM_KINDS, type ItemQuery, type MeResponse } from '@bgc/core';
import { api } from '../api';
import { useAsync, useDebounced } from '../hooks';
import { Link } from '../router';
import { GroupCard, ItemCard, KIND_LABEL } from '../components/ItemTree';
import { ExportLinks } from '../components/QuickAdd';
import { EmptyState, ErrorBox, Pager, Spinner } from '../components/ui';

/**
 * The filter dropdown's value: one string covering both axes.
 *
 * `series:Dice Throne` and `system:D&D 5e (2014)` are the same kind of choice to
 * the person making it, and a second dropdown asking the same question in a
 * different column would be a worse control, not a more precise one. Split back
 * into the two query parameters on the way out.
 */
function splitGroupValue(value: string): { series?: string; gameSystem?: string } {
  const cut = value.indexOf(':');
  if (cut < 0) return {};
  const name = value.slice(cut + 1);
  return value.startsWith('series:') ? { series: name } : { gameSystem: name };
}

export function CollectionPage({ me }: { me: MeResponse }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [uncatalogued, setUncatalogued] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const [group, setGroup] = useState('');
  // On by default. The page's problem is one line of eleven boxes dominating
  // it, so the collapsed view is the one worth opening on; the checkbox is for
  // when you want the whole shelf laid out.
  const [collapse, setCollapse] = useState(true);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounced(search);
  const chosen = splitGroupValue(group);

  // Any change to what is being filtered invalidates where you were in it —
  // page 4 of the whole catalog is not page 4 of a search for "catan".
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, kind, uncatalogued, duplicates, group, collapse]);

  const query: ItemQuery = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(status ? { status: status as ItemQuery['status'] } : {}),
    ...(kind ? { kind: kind as ItemQuery['kind'] } : {}),
    ...(uncatalogued ? { uncatalogued: true } : {}),
    ...(duplicates ? { duplicates: true } : {}),
    ...chosen,
    // Sent only when true: the server coerces the string, so "false" would read
    // as true — the same convention the other flags here follow.
    ...(collapse ? { grouped: true } : {}),
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
    group,
    collapse,
    page,
  ]);

  // Every page change lands at the top of the list, whichever set of controls
  // was pressed — pressing "Next" at the bottom and being left staring at the
  // end of a page you have not read yet is the bug this avoids.
  //
  // Instant, not smooth: there is no animation here to hold back for
  // `prefers-reduced-motion`, and a half-second glide up the length of a
  // twenty-five card list would only delay the content arriving. Note that
  // `behavior: 'auto'` defers to CSS `scroll-behavior`, which this app never
  // sets to `smooth`; if that ever changes, this becomes an animation and will
  // need the motion query.
  const goToPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const openGroup = (key: string) => {
    setGroup(key);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const canEdit = me.capabilities.includes('editCatalog');
  const filtersActive = Boolean(
    debouncedSearch || status || kind || uncatalogued || duplicates || group,
  );
  // Only offered when there is something to choose between. A collection of
  // board games with no series and no rulesets recorded gets no dropdown, and a
  // control with one empty option in it teaches you nothing.
  const options = meta.state === 'ok' ? meta.data.groups : [];
  const seriesOptions = options.filter((o) => o.axis === 'series');
  const systemOptions = options.filter((o) => o.axis === 'system');

  // Searching and being inside a group both switch collapsing off server-side —
  // folding a hero's hit into a series card answers neither half of "which box
  // is Scarlet Witch in", and folding an opened group back up would make the
  // filter do nothing. Said here so the checkbox does not claim otherwise.
  const collapseApplies = !debouncedSearch && !group;

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
              {/* Two numbers, not one. Together they used to read "262 wanted"
                  over a wishlist of 25 — see `collectionStats`. The wanted
                  figure links, because it now counts what /wishlist counts. */}
              {meta.data.stats.wantedEntries > 0 && (
                <>
                  {' · '}
                  <Link to="/wishlist">{meta.data.stats.wantedEntries} wanted</Link>
                </>
              )}
              {meta.data.stats.preorderedEntries > 0 &&
                ` · ${meta.data.stats.preorderedEntries} on the way`}
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
              One action, because there is one thing you do on this screen.

              This row reached five buttons of equal weight by accretion — each
              addition reasonable on its own, and the row unreadable by the end.
              Every one of them has now gone somewhere it belongs:

              - "Scan a barcode" pointed at `/scan-jobs?add=barcode`, the tab
                "+ Add games" already opens on, so it was a shortcut to the
                button beside it. "Check a game" (`/scan`) opened the same tab
                strip over the same camera. Both gone; the owner's words were
                that they all seem to go to the same place.
              - "Type a name" is not a different act from adding a game, it is
                the same act done with a keyboard, so it is now the fourth tab
                inside "+ Add games" alongside Barcode, Shelf photo and One box.
              - "Related games" and "Missing details" are places you visit
                occasionally to work a list down, not things you do to the
                collection. They moved to the top bar beside Wishlist, where
                they appear only while they have something outstanding.

              Nothing else goes here. If a new entry point seems necessary, it
              almost certainly belongs on the screen it leads to.
            */}
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

          {/* One control for both axes. A series and a game system are the same
              kind of choice — "show me everything in this line" — and the
              counts say how much of the catalog each reaches across however
              many separate trees it is filed in. */}
          {options.length > 0 && (
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              aria-label="Series or game system"
            >
              <option value="">Any series or system</option>
              {seriesOptions.length > 0 && (
                <optgroup label="Series">
                  {seriesOptions.map((o) => (
                    <option key={`series:${o.name}`} value={`series:${o.name}`}>
                      {o.name} ({o.items})
                    </option>
                  ))}
                </optgroup>
              )}
              {systemOptions.length > 0 && (
                <optgroup label="Game system">
                  {systemOptions.map((o) => (
                    <option key={`system:${o.name}`} value={`system:${o.name}`}>
                      {o.name} ({o.items})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}

          {options.length > 0 && collapseApplies && (
            <label className="check-inline">
              <input
                type="checkbox"
                checked={collapse}
                onChange={(e) => setCollapse(e.target.checked)}
              />
              Collapse series
            </label>
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
                setGroup('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {items.state === 'loading' && <Spinner label="Loading collection…" />}
      {items.state === 'error' && <ErrorBox error={items.error} what="Could not load the collection" />}

      {items.state === 'ok' && items.data.entries.length === 0 && (
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

      {items.state === 'ok' && items.data.entries.length > 0 && (
        <>
          {/* Above the list as well as below it, directly under the filters, so
              paging does not require reading to the bottom first. */}
          <Pager
            page={items.data.page}
            pageSize={items.data.pageSize}
            pageCount={items.data.pageCount}
            total={items.data.total}
            onPage={goToPage}
            position="top"
          />
          <p className="result-count muted">
            {/* The count is every match, not the page. Saying "25 games" while
                paging through 107 would read as a filter nobody applied.

                Both numbers when they differ, because the difference is the
                whole feature: "104 entries · 114 games" says plainly that ten
                cards are standing in for more than one line each. */}
            {items.data.total} {items.data.total === 1 ? 'entry' : 'entries'}
            {items.data.totalRoots !== items.data.total &&
              ` · ${items.data.totalRoots} game${items.data.totalRoots === 1 ? '' : 's'}`}
            {filtersActive && ' matching'}
            {items.data.pageCount > 1 &&
              ` · page ${items.data.page} of ${items.data.pageCount}`}
            {canEdit && <ExportLinks />}
          </p>
          <div className="item-list">
            {items.data.entries.map((entry) =>
              entry.kind === 'group' ? (
                <GroupCard
                  key={entry.key}
                  group={entry.group}
                  onOpen={() => openGroup(entry.key)}
                />
              ) : (
                <ItemCard key={entry.key} node={entry.tree} />
              ),
            )}
          </div>

          <Pager
            page={items.data.page}
            pageSize={items.data.pageSize}
            pageCount={items.data.pageCount}
            total={items.data.total}
            onPage={goToPage}
            position="bottom"
          />
        </>
      )}
    </>
  );
}
