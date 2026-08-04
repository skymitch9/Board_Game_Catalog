import { useCallback, useEffect, useState } from 'react';

export type Async<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T }
  | { state: 'error'; error: unknown };

/**
 * Fetch-on-mount with a manual refresh. Deliberately small: the app has no
 * cross-page cache to invalidate, so a query library would be scaffolding
 * around a problem we don't have yet.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): [Async<T>, () => void] {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setResult({ state: 'loading' });
    fn()
      .then((data) => live && setResult({ state: 'ok', data }))
      .catch((error) => live && setResult({ state: 'error', error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return [result, refresh];
}

/** Delay a fast-changing value — used so typing doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
