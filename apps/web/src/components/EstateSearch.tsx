import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getIdToken, signIn, signOutNow, watchAuth } from '../lib/firebase';
import { navigate } from '../router';

/**
 * "Search the whole estate" — a thin React host for `<estate-search>`, the ONE
 * cross-catalog search box (catalog-platform `docs/TODO.md` item 0; the element
 * itself is `sites/heygabi-home/public/assets/estate-search.js` over there,
 * materialised into `apps/web/public/estate/` by
 * `scripts/sync-estate-search.mjs`).
 *
 * ## ⚠️ This does NOT replace the collection search
 *
 * `pages/CollectionPage.tsx` searches THIS catalog server-side against
 * `/api/collection?q=…`, with facets, grouping and pagination that a shared
 * component cannot replicate and should not try to. It is untouched by this
 * file and must stay that way. What is added here is the *other* question —
 * "do we own this on ANY shelf?" — asked against the shared index at
 * index.heygabi.ai, which reaches the audiobooks and the library as well as the
 * games. Two boxes because they are two questions; that is why this one is
 * folded away behind a disclosure rather than sitting beside the collection
 * search competing for the same keystrokes.
 *
 * ## What a wrapper for a custom element is, and is not
 *
 * It is a ref, three property assignments and one event listener. It is NOT a
 * reimplementation: ranking, keyboard nav, the debounced-abortable fetch, the
 * sign-in flash fix and every scrap of copy live in the component, so an
 * improvement made upstream arrives here on the next build. Nothing about the
 * search itself may be re-derived in this file.
 *
 * ## ⚠️ Why the element is created by hand instead of rendered as JSX
 *
 * The component's constructor does `this.authAdapter = null`. A custom element
 * is upgraded — constructor, then `connectedCallback` — the moment it is
 * defined AND in the document, and `connectedCallback` is what boots auth. A
 * React `ref` callback only fires after insertion, so anything it sets is
 * either wiped by a later upgrade or arrives after the boot has already given
 * up on the adapter and dynamically imported a sibling `estate-auth.js`
 * instead — which would put a SECOND Firebase app on a page that already has
 * one (`lib/firebase.ts`). Creating the element ourselves lets the adapter be
 * set between `createElement` and `appendChild`, which is the only window that
 * is provably before `connectedCallback`. Do not "simplify" this into JSX.
 *
 * ## Routing
 *
 * `estate-search:select` is cancelable and fires instead of the component's
 * default `window.open(url, '_blank')`. A hit from THIS catalog is routed
 * in-app through `router.tsx`'s `navigate()` — this app has no
 * `react-router-dom`, it has a hand-rolled pushState router, so there is no
 * `useNavigate` and no `<Link>` in the react-router sense. Hits from the
 * audiobook or library catalogs are left alone: they live on other origins and
 * a new tab is the right answer for them.
 */

/** Where `sync-estate-search.mjs` puts the component. Vite copies public/ verbatim. */
const ESTATE_SEARCH_URL = '/estate/estate-search.js';

const TAG = 'estate-search';

/**
 * The adapter surface `estate-search.js` expects (its `estate-auth.js` shape).
 * Supplying it as a property is the documented way to skip the dynamic import
 * — see the constructor note above for why that matters here specifically.
 */
interface EstateAuthAdapter {
  watchAuth: (cb: (user: User | null) => void) => () => void;
  idToken: () => Promise<string | null>;
  signIn: () => Promise<{
    ok?: boolean;
    cancelled?: boolean;
    error?: string;
    ownerAction?: boolean;
  }>;
  signOutUser: () => Promise<void>;
  /**
   * ⚠️ Deliberately absent. The component calls it only when present, and the
   * redirect leg of sign-in belongs to `App.tsx`'s auth gate, not to a search
   * box in the nav — a second `getRedirectResult()` racing the app's own
   * session restore is a bug looking for somewhere to happen.
   */
}

/** One catalog row as the shared index reports it (only the fields used here). */
interface EstateHit {
  source?: string;
  detail_url?: string | null;
}

interface EstateSearchElement extends HTMLElement {
  authAdapter: EstateAuthAdapter | null;
  intakeFilter: ((data: unknown, ctx: { kind: 'search' | 'universe' }) => unknown) | null;
}

/**
 * This app's own Firebase session, wearing the adapter's shape.
 *
 * ⚠️ `lib/firebase.ts` stays the one implementation — this is a translation
 * layer over it, never a second sign-in. `signIn()` there throws; the component
 * wants a result object, and the two error codes worth naming are the same two
 * `SignIn.tsx` names (a closed popup is a change of mind, not a failure; an
 * unauthorised domain is an owner console action nobody signed in can fix).
 */
const authAdapter: EstateAuthAdapter = {
  watchAuth,
  idToken: () => getIdToken(),
  signOutUser: () => signOutNow(),
  async signIn() {
    try {
      await signIn();
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { cancelled: true };
      }
      if (code === 'auth/unauthorized-domain') {
        return {
          error:
            `Sign-in is blocked because ${window.location.hostname} is not an authorised domain ` +
            'on the shared Firebase project. Owner action (console only): Firebase → project ' +
            'audiobook-catalog → Authentication → Settings → Authorised domains.',
          ownerAction: true,
        };
      }
      return { error: (err as Error)?.message ?? 'Sign-in failed. Try again.' };
    }
  },
};

/**
 * Load the component once per page. Kept module-level rather than in a ref so a
 * remount (or a second box, should one ever be added) reuses the same import.
 */
let modulePromise: Promise<unknown> | null = null;
function loadEstateSearch(): Promise<unknown> {
  if (!modulePromise) {
    // `@vite-ignore` + a non-literal specifier: this file lives in public/ and
    // must NOT be pulled into the bundle. It is a copy of an upstream module
    // that has its own no-cache header precisely so it can be replaced without
    // rebuilding this app.
    const url = ESTATE_SEARCH_URL;
    modulePromise = import(/* @vite-ignore */ url).then(() => customElements.whenDefined(TAG));
  }
  return modulePromise;
}

/**
 * The in-app path for a hit, or null when it belongs to another catalog.
 *
 * `hit.source` is the shared index's own vocabulary — this catalog pushes as
 * `game` (`apps/worker/src/lib/index-push.ts`). Only the URL's PATH is ever
 * used, never its origin, so a hit can only ever route somewhere on this
 * origin: `packages/db/src/index-projection.ts` builds these as
 * `https://boardgames.heygabi.ai/items/:id`, and `/items/:id` is a route
 * `router.tsx` already parses. An unrecognised path lands on the app's own
 * not-found screen, which is a far better failure than a new tab to nowhere.
 */
function localPathFor(url: string | null | undefined, hit: EstateHit | null): string | null {
  if (!url || hit?.source !== 'game') return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function EstateSearch() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  // `setOpen` is stable, so this listener is installed once at mount and never
  // needs replacing — which is what keeps the effect below from tearing the
  // element down and rebooting its auth on every render.
  const onSelect = useCallback((event: Event) => {
    const detail = (event as CustomEvent<{ url?: string | null; hit?: EstateHit | null }>).detail;
    const path = localPathFor(detail?.url, detail?.hit ?? null);
    if (!path) return; // another catalog, another origin — let it open a tab
    event.preventDefault(); // the event is cancelable; this is the SPA hand-off
    setOpen(false); // the answer is the page you are about to be on
    navigate(path);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;

    void loadEstateSearch().then(
      () => {
        if (!live || !hostRef.current) return;
        const el = document.createElement(TAG) as EstateSearchElement;
        el.setAttribute('auth', 'authed');
        // Everything, not just games — the whole point is the shelves this app
        // cannot show. (Scoping to `source="game"` would make it a worse
        // duplicate of the collection search.)
        el.setAttribute('source', 'all');
        el.setAttribute('hint', 'Checks the audiobooks and the library too, not just this catalog.');
        el.setAttribute('placeholder-authed', 'Search every shelf — title, author or series…');
        // ⚠️ Before appendChild, and that ordering is load-bearing — see the
        // constructor note in this file's header.
        el.authAdapter = authAdapter;
        el.addEventListener('estate-search:select', onSelect);
        hostRef.current.appendChild(el);
      },
      (err) => {
        // A missing component is worth saying out loud rather than leaving an
        // empty box: the copy is a build artifact, so its absence means the
        // build did not run the syncer.
        console.error('[estate-search] component failed to load', err);
        if (live) setFailed(true);
      },
    );

    return () => {
      live = false;
      host.replaceChildren();
    };
  }, [onSelect]);

  return (
    <details className="estate-search" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Search the whole estate</summary>
      <div className="estate-search__body">
        {failed && (
          <p className="error-text">
            The estate search box could not be loaded. Its file is generated at build time by{' '}
            <code>scripts/sync-estate-search.mjs</code>; the collection search above is unaffected.
          </p>
        )}
        <div ref={hostRef} />
      </div>
    </details>
  );
}
