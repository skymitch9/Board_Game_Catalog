import { useCallback, useEffect, useState } from 'react';

/**
 * A router in thirty lines. The app has four routes and no need for nested
 * layouts or loaders, so a dependency would cost more than it saves.
 *
 * Deep links work because the Worker serves index.html for any non-/api path
 * (see apps/worker/src/index.ts).
 */

export type Route =
  | { name: 'collection' }
  | { name: 'item'; id: number }
  | { name: 'newItem'; parentId: number | null }
  | { name: 'editItem'; id: number }
  | { name: 'notFound' };

function parse(pathname: string, search: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'collection' };

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
