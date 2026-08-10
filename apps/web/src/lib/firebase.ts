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
 * ⚠️ Consequence worth knowing before anyone debugs a mystery sign-out: all
 * three catalogs share one Firebase Auth session on the `audiobook-catalog`
 * project. Loading the audiobook site signs you out of Firebase, and therefore
 * out of this app too, because that site detaches on every page load. That is
 * why `catalog-platform/docs/HEYGABI_LAYOUT.md` §1.3 forbids adding more auth
 * origins, and why the apex landing page has no sign-in at all.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
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
  authDomain: 'audiobook-catalog.firebaseapp.com',
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
}

export async function signOutNow(): Promise<void> {
  await signOut(getAuth(firebaseApp()));
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
