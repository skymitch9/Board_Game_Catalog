/**
 * Firebase: Google sign-in, and the ID token the Worker verifies.
 *
 * ## Why this file exists at all
 *
 * Until 2026-08-10 this app had no sign-in code. Cloudflare Access intercepted
 * the page load, ran Google itself, and set a cookie the Worker read — so the
 * client never touched auth. `SignIn.tsx` existed only for the case where that
 * cookie expired with the tab open, and its "Sign in with Google" button was a
 * `window.location.assign('/')` that bounced off Access.
 *
 * Access is going away because it is a second allowlist that has to be edited
 * by hand before the app can even say "you're pending" — see the header comment
 * in `apps/worker/src/middleware/auth.ts`. So the client now does the sign-in,
 * and sends a token the Worker verifies against Google's keys.
 *
 * ## ⚠️ The one thing that must NOT be copied from `audiobook_catalog`
 *
 * `audiobook_catalog/site/identity.js` calls `signOut()` immediately after
 * capturing the identity, keeping only a display name in `localStorage`. That
 * is correct *there*: its Firestore rules never check `request.auth`, so a live
 * token could only expire and poison writes, and its own `isAdmin()` says in as
 * many words that identity there is *"PRESENTATION ONLY … not, and cannot be,
 * an access control."*
 *
 * Here the token **is** the access control. This app keeps the session alive
 * and refreshes it. The failure that motivated the detach — a stale token
 * breaking writes — is handled by refreshing on a 401 (see `api.ts`) rather
 * than by throwing the session away.
 *
 * ⚠️ Updated 2026-08-16 — the paragraph this replaces was stale. Firebase web
 * auth sessions are **origin-scoped** (separate IndexedDB per origin), not
 * shared across the estate, so loading the audiobook site does NOT sign you
 * out of this app. That was true when this comment was first written (the
 * audiobook site used to `signOut()` on every load to protect its
 * presentation-only identity), but `audiobook_catalog/site/identity.js` v2
 * (2026-08-14) removed that detach, and it never crossed origins to begin
 * with even when it existed. `catalog-platform/docs/HEYGABI_LAYOUT.md` §1.3's
 * "no more auth origins" rule still stands, but its real remaining cost is
 * authorised-domain/console surface (see
 * `catalog-platform/docs/info/sso-design.md` §2), not a cross-app sign-out
 * hazard. As of this same date `authDomain` below points at
 * `auth.heygabi.ai` (a same-site reverse proxy to the Firebase auth ceremony,
 * `sso-design.md` §4.1) purely to make sign-in reliable on mobile — it still
 * does not share a session with the other surfaces (§4.1: "does NOT give
 * session sharing").
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

/**
 * The shared project's web config, matching `library_catalog` verbatim.
 *
 * ⚠️ `projectId` must stay `audiobook-catalog`. It is what makes one Google
 * account one person across all three catalogs, and it must match
 * `FIREBASE_PROJECT_ID` in `apps/worker/wrangler.toml` or every request 401s.
 *
 * These values are public by design — a Firebase web config ships to every
 * browser and is not a secret. The access control is the Worker's token
 * verification, not the obscurity of an API key.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',
  authDomain: 'auth.heygabi.ai',
  projectId: 'audiobook-catalog',
};

let app: FirebaseApp | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

/**
 * Fires once Firebase has decided whether a session exists, and again on every
 * change.
 *
 * ⚠️ The first call is **not** synchronous and its first argument can be `null`
 * simply because Firebase has not finished restoring a persisted session yet.
 * Treating that first `null` as "signed out" is the classic bug here: it shows
 * the sign-in screen to somebody who is already signed in, every single load.
 * `App.tsx` waits for this before it calls `/api/me` for that reason.
 */
export function watchAuth(cb: (user: User | null) => void): () => void {
  // ⚠️ The estate-SSO bootstrap is kicked off HERE, and this is why no
  // component needed editing to gain single sign-on: watchAuth is the one
  // call every auth-aware surface in this app already makes at boot
  // (hooks.ts's useAuth, the EstateSearch adapter). Guarded to run once per
  // page load however many listeners subscribe, and never awaited — it
  // resolves on its own and fires this very listener when it succeeds,
  // which is what the UI already re-renders from.
  startEstateSso();
  return onAuthStateChanged(getAuth(firebaseApp()), cb);
}

export async function signIn(): Promise<void> {
  const auth = getAuth(firebaseApp());
  const provider = new GoogleAuthProvider();
  // On localhost Chrome's COOP blocks popup communication — both sibling sites
  // hit this, and the fix is a redirect rather than a retry.
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocal) {
    await signInWithRedirect(auth, provider);
    return;
  }
  await signInWithPopup(auth, provider);
  // Let this sign-in travel to the rest of the estate (see the SSO section
  // below). Awaited because it is one fast request and a person who signs in
  // here may click straight through to another catalog; a failure is silent
  // and leaves this origin signed in regardless.
  await publishEstateSession();
}

export async function signOutNow(): Promise<void> {
  await signOut(getAuth(firebaseApp()));
  // Sign-out is LOCAL + COOKIE-CLEAR (design §9 Q4): this ends the session
  // here and stops it travelling, but an origin that has already localised
  // one keeps it until it ends naturally. Full single-sign-out would need
  // every origin to re-check the cookie on every load, which reintroduces
  // the "one page signs you out from under another" failure class the
  // audiobook site's v1 identity code died of. The security-relevant lever
  // is estate revocation, which shuts every door within minutes regardless.
  try {
    sessionStorage.removeItem(PUBLISH_MARK);
  } catch {
    /* storage unavailable — nothing was marked anyway */
  }
  try {
    await fetch(SESSION_URL, { method: 'DELETE', credentials: 'include' });
  } catch {
    /* local session is already gone; a stranded cookie expires on its own */
  }
}

// ==================== Estate SSO (sso-design.md §4.3, Phase 3) ====================
//
// THE PROBLEM: Firebase web auth state is per-ORIGIN (its own IndexedDB per
// origin) — the very fact the header comment above already explains as the
// reason loading the audiobook site does NOT sign you out of this app. The
// same fact has a cost: a sign-in on heygabi.ai or any sibling catalog left
// this app signed out too. The owner hit it directly — "Ebooks makes me
// login every time why is it not inheriting login from main page?"
//
// THE MECHANISM: an HttpOnly cookie on the PARENT domain (`.heygabi.ai`, set
// by auth.heygabi.ai) plus a Worker-minted Firebase custom token. Sign in
// interactively once, anywhere on the estate; every other origin trades that
// cookie for a short-lived custom token and calls signInWithCustomToken() to
// build its OWN ordinary local session. Because the result is an ordinary
// session, `watchAuth` and `getIdToken()` keep working untouched — exactly
// why this shape beat relaying tokens through a hidden iframe (design §4.2).
//
// ⚠️ THIS IS NOT AUTHORITY, and the distinction matters here because in THIS
// app the token IS the access control. Nothing about that changes: the
// Worker still verifies a real Firebase ID token against Google's keys and
// still consults the estate directory in ENFORCE mode on every request. The
// cookie only decides whether the browser gets a session at all — it moves
// the SIGN-IN, never the authority, and can only produce a session the same
// person would get by tapping the Google button themselves. The mint route
// additionally refuses a revoked estate member outright, so revocation still
// shuts this door within minutes.
//
// ⚠️ SILENT BY DEFAULT, STATUS QUO ON FAILURE. Every path swallows its errors
// and returns false. No cookie, a Worker outage, an unset signing key, or a
// browser that partitions the cookie away all degrade to exactly today's
// behaviour: SignIn.tsx renders and works. Nothing here throws, blocks first
// paint, or is awaited by a render path.

const SESSION_URL = 'https://auth.heygabi.ai/api/session';
const SESSION_TOKEN_URL = 'https://auth.heygabi.ai/api/session/token';

/** Publish-once marker for this browser tab — see publishEstateSession. */
const PUBLISH_MARK = 'estate_sso_published';

/** Once-per-page-load guard: watchAuth has several callers, this has one run. */
let ssoStarted = false;

/**
 * Tell the estate this browser is signed in: POST our fresh Firebase ID
 * token to the auth Worker, which verifies it and sets the parent-domain
 * cookie every other estate origin later trades for a session of its own.
 *
 * ⚠️ Marked once per browser tab, deliberately. POST /api/session creates a
 * NEW session row on every call (one row per device is the intent), so
 * calling it per page load would spam D1 with a row per navigation. The
 * marker is kept only on success, so a failed publish retries rather than
 * silently never happening.
 *
 * Never throws.
 */
export async function publishEstateSession(): Promise<boolean> {
  try {
    const user = getAuth(firebaseApp()).currentUser;
    if (!user) return false;
    try {
      if (sessionStorage.getItem(PUBLISH_MARK)) return false;
    } catch {
      /* storage unavailable — publish anyway, at worst an extra row */
    }
    const token = await user.getIdToken();
    const res = await fetch(SESSION_URL, {
      method: 'POST',
      // ⚠️ Required in BOTH directions: without it the browser drops the
      // Set-Cookie on the way back and the mechanism silently no-ops while
      // every status code still reads 200.
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    try {
      sessionStorage.setItem(PUBLISH_MARK, '1');
    } catch {
      /* retry on the next page */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Inherit a sign-in that happened on another estate surface: trade the
 * parent-domain cookie for a short-lived custom token and turn it into a
 * normal local Firebase session.
 *
 * Deliberately does NOT cache its failures — a negative answer goes stale
 * the moment the person signs in on another tab, and one small bodyless
 * fetch per signed-out page load is what makes inheritance feel instant.
 *
 * Never throws.
 */
export async function inheritEstateSession(): Promise<boolean> {
  try {
    const res = await fetch(SESSION_TOKEN_URL, { method: 'POST', credentials: 'include' });
    // 401 no_session (no cookie — the ordinary signed-out case), 403
    // estate_revoked and 503 token_signer_unset (the owner's console step
    // still pending) all land here, and all mean the same thing to this app:
    // stay signed out and render exactly what it renders today.
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: unknown };
    if (typeof body?.token !== 'string') return false;
    await signInWithCustomToken(getAuth(firebaseApp()), body.token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the bootstrap once per page load: publish an existing local session so
 * it can travel, or inherit one from the estate when there is none here.
 *
 * Waits for Firebase to publish its restored session first — that first
 * answer is asynchronous, and treating the initial null as "signed out" is
 * the classic bug this file's own watchAuth docblock warns about.
 */
function startEstateSso(): void {
  if (ssoStarted) return;
  ssoStarted = true;
  void (async () => {
    try {
      const auth = getAuth(firebaseApp());
      const user = await new Promise<User | null>((resolve) => {
        if (auth.currentUser) return resolve(auth.currentUser);
        const unsub = onAuthStateChanged(auth, (u) => {
          unsub();
          resolve(u);
        });
      });
      if (user) {
        await publishEstateSession();
      } else {
        await inheritEstateSession();
      }
    } catch {
      /* silent by design — the app behaves exactly as it does today */
    }
  })();
}

/**
 * The bearer token for the Worker.
 *
 * `forceRefresh` is a parameter rather than always-on because Firebase already
 * refreshes on its own schedule, and forcing it would add a network round trip
 * to every API call. The caller forces it exactly once, on a 401.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = getAuth(firebaseApp()).currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
