import { useCallback, useEffect, useState } from 'react';
import { COPY_STATUSES, ITEM_KINDS } from '@bgc/core';

/**
 * A router in thirty lines. The app has four routes and no need for nested
 * layouts or loaders, so a dependency would cost more than it saves.
 *
 * Deep links work because the Worker serves index.html for any non-/api path
 * (see apps/worker/src/index.ts).
 */

/** The tabs on /scan and on /scan-jobs. Kept here so `parse` can validate them. */
export type ScanMode = 'barcode' | 'photo' | 'shelf' | 'manual';
export type AddMode = 'barcode' | 'shelf' | 'single' | 'manual';

const SCAN_MODES: readonly ScanMode[] = ['barcode', 'photo', 'shelf', 'manual'];
const ADD_MODES: readonly AddMode[] = ['barcode', 'shelf', 'single', 'manual'];

/**
 * What the collection page is showing, as opposed to which page it is.
 *
 * It lives in the URL so that opening a game and pressing Back returns you to
 * the search you were in the middle of, rather than to an unfiltered page 1.
 * Every field has a default, and an unrecognised value in the query string
 * falls back to it — the same forgiveness `?mode=` gets, and the reason
 * `?page=abc` cannot produce a NaN here.
 */
export type CollectionFilters = {
  q: string;
  status: string;
  kind: string;
  uncatalogued: boolean;
  duplicates: boolean;
  /** `series:Name` or `system:Name`; see `splitGroupValue` on the page. */
  group: string;
  collapse: boolean;
  page: number;
};

export type Route =
  | { name: 'collection'; filters: CollectionFilters }
  | { name: 'item'; id: number }
  | { name: 'newItem'; parentId: number | null }
  | { name: 'editItem'; id: number }
  | { name: 'people' }
  | { name: 'wishlist' }
  | { name: 'export' }
  // `?mode=` and `?add=` let an entry point elsewhere land on the right tab,
  // rather than on the right page and the wrong one. Both are optional and both
  // fall back to the page's own default, so an unrecognised value is harmless.
  | { name: 'scan'; mode: ScanMode | null }
  | { name: 'scanJobs'; add: AddMode | null }
  | { name: 'scanJobReview'; id: number }
  | { name: 'retag' }
  | { name: 'detailsQueue' }
  | { name: 'notFound' };

/** A query parameter, but only if it is one of the values the page understands. */
function pick<T extends string>(search: string, key: string, allowed: readonly T[]): T | null {
  const raw = new URLSearchParams(search).get(key);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** A checkbox in the query string. Only `1` and `0` speak; anything else defers. */
function flag(search: string, key: string, fallback: boolean): boolean {
  const raw = new URLSearchParams(search).get(key);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

/** A page number, or 1. `Number(null)`, `Number('')` and `Number('abc')` all fail the test. */
function positiveInt(search: string, key: string): number {
  const n = Number(new URLSearchParams(search).get(key));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * The group filter is open-ended — the names come from the catalog, so there is
 * no closed set to check against. The prefix is all that can be validated, and
 * it is enough to keep junk out of a request.
 */
function groupValue(search: string): string {
  const raw = new URLSearchParams(search).get('group') ?? '';
  const axis = raw.startsWith('series:') || raw.startsWith('system:');
  const name = raw.slice(raw.indexOf(':') + 1);
  return axis && name ? raw : '';
}

function parseCollection(search: string): CollectionFilters {
  return {
    q: new URLSearchParams(search).get('q') ?? '',
    status: pick(search, 'status', COPY_STATUSES) ?? '',
    kind: pick(search, 'kind', ITEM_KINDS) ?? '',
    uncatalogued: flag(search, 'uncatalogued', false),
    duplicates: flag(search, 'duplicates', false),
    group: groupValue(search),
    collapse: flag(search, 'collapse', true),
    page: positiveInt(search, 'page'),
  };
}

/**
 * The inverse of `parseCollection`, kept beside it so the parameter names have
 * one definition. Defaults are omitted, so a plain browse is `/` and not
 * `/?q=&status=&page=1`.
 */
export function collectionPath(f: CollectionFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status) p.set('status', f.status);
  if (f.kind) p.set('kind', f.kind);
  if (f.uncatalogued) p.set('uncatalogued', '1');
  if (f.duplicates) p.set('duplicates', '1');
  if (f.group) p.set('group', f.group);
  if (!f.collapse) p.set('collapse', '0');
  if (f.page > 1) p.set('page', String(f.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : '/';
}

function parse(pathname: string, search: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'collection', filters: parseCollection(search) };

  if (parts[0] === 'people' && parts.length === 1) return { name: 'people' };
  if (parts[0] === 'wishlist' && parts.length === 1) return { name: 'wishlist' };
  // `/export`, with no extension — the files themselves are `/api/export.csv`
  // and `/api/export.json`, and the Worker only hands non-`/api` paths to this
  // router, so the two can never be confused for each other.
  if (parts[0] === 'export' && parts.length === 1) return { name: 'export' };
  // One flat route, no hash segments: a standalone PWA on iOS re-prompts for
  // camera permission on every route change (WebKit #215884). The tab is a
  // query parameter for the same reason — changing it must not change the path.
  if (parts[0] === 'scan' && parts.length === 1) {
    return { name: 'scan', mode: pick(search, 'mode', SCAN_MODES) };
  }

  if (parts[0] === 'retag' && parts.length === 1) return { name: 'retag' };
  if (parts[0] === 'details' && parts.length === 1) return { name: 'detailsQueue' };

  if (parts[0] === 'scan-jobs') {
    if (parts.length === 1) {
      return { name: 'scanJobs', add: pick(search, 'add', ADD_MODES) };
    }
    const id = Number(parts[1]);
    if (Number.isInteger(id) && id > 0) return { name: 'scanJobReview', id };
  }

  if (parts[0] === 'items') {
    if (parts[1] === 'new') {
      const parent = new URLSearchParams(search).get('parent');
      const parentId = parent ? Number(parent) : null;
      return { name: 'newItem', parentId: Number.isInteger(parentId) ? parentId : null };
    }
    const id = Number(parts[1]);
    if (Number.isInteger(id) && id > 0) {
      if (parts[2] === 'edit') return { name: 'editItem', id };
      if (parts.length === 2) return { name: 'item', id };
    }
  }

  return { name: 'notFound' };
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Rewrite the URL in place: no history entry, and no popstate.
 *
 * ⚠️ Do not "fix" this into `navigate`. The collection filters are written here
 * on every change, and the search box is live — a pushState per keystroke would
 * put ten entries in the history for a ten-character search and make Back
 * useless in a different way. What Back has to do is return you to the search
 * you left, and for that the collection URL only has to be *correct at the
 * moment you navigate away*, which replaceState gives for free at one entry per
 * page.
 *
 * Withholding the popstate matters just as much: the page that owns this state
 * is already re-rendering from it, and telling the router would remount that
 * page underneath itself mid-keystroke.
 */
export function replaceUrl(path: string): void {
  window.history.replaceState({}, '', path);
}

export function useRoute(): Route {
  const read = useCallback(() => parse(window.location.pathname, window.location.search), []);
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, [read]);

  return route;
}

/** Anchor that routes client-side but still behaves like a real link. */
export function Link({
  to,
  children,
  className,
  style,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <a
      href={to}
      className={className}
      style={style}
      onClick={(e) => {
        // Let modified clicks (new tab, download) behave natively.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
