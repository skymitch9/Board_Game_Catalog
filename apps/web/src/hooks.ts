import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * Run `callback` every `ms`, but only while `active`.
 *
 * The gate matters more than the timer. Work that finishes on the server —
 * a photo being read, titles being looked up — has no way to tell the browser,
 * so the browser has to ask. But a page left open in a background tab would
 * then ask forever about answers that stopped changing hours ago, so polling
 * stops the moment nothing is still in flight.
 *
 * The callback is held in a ref so that passing a fresh closure each render
 * does not tear down and restart the timer.
 */
export function useInterval(callback: () => void, ms: number, active: boolean): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
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
