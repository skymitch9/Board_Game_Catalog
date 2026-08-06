import { useCallback, useEffect, useState } from 'react';

/**
 * A router in thirty lines. The app has four routes and no need for nested
 * layouts or loaders, so a dependency would cost more than it saves.
 *
 * Deep links work because the Worker serves index.html for any non-/api path
 * (see apps/worker/src/index.ts).
 */

/** The tabs on /scan and on /scan-jobs. Kept here so `parse` can validate them. */
export type ScanMode = 'barcode' | 'photo' | 'shelf' | 'manual';
export type AddMode = 'barcode' | 'shelf' | 'single';

const SCAN_MODES: readonly ScanMode[] = ['barcode', 'photo', 'shelf', 'manual'];
const ADD_MODES: readonly AddMode[] = ['barcode', 'shelf', 'single'];

export type Route =
  | { name: 'collection' }
  | { name: 'item'; id: number }
  | { name: 'newItem'; parentId: number | null }
  | { name: 'editItem'; id: number }
  | { name: 'people' }
  | { name: 'wishlist' }
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

function parse(pathname: string, search: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'collection' };

  if (parts[0] === 'people' && parts.length === 1) return { name: 'people' };
  if (parts[0] === 'wishlist' && parts.length === 1) return { name: 'wishlist' };
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
