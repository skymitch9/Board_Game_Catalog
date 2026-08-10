import { useState } from 'react';
import { signIn } from './lib/firebase';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/**
 * The front door, and since 2026-08-10 it is a real one.
 *
 * Under Cloudflare Access this screen was nearly dead code: Access intercepted
 * the page load and ran Google before React rendered, so the only way to see it
 * was a cookie expiring with the tab open. Its button did
 * `window.location.assign('/')` — a full navigation, so that Access would catch
 * it — which was the correct action then and does nothing useful now.
 *
 * With the Worker verifying Firebase ID tokens, this page is what an
 * unrecognised visitor actually meets, so the button runs the Google flow
 * itself. Signing in does **not** grant access: it creates a `pending` account
 * and lands on the waiting screen in `App.tsx`. That is the whole point of the
 * change — a stranger can now ask, where before they could not reach the app to
 * be asked about.
 */
export function SignIn({ reason }: { reason: 'unauthenticated' | 'misconfigured' }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (reason === 'misconfigured') {
    return (
      <div className="signin">
        <h1>Almost there</h1>
        <p className="signin-lede">
          The catalog is deployed but doesn&apos;t yet know which Firebase project to trust, so it
          won&apos;t identify anyone.
        </p>
        <p className="note">
          Set <code>FIREBASE_PROJECT_ID</code> in <code>apps/worker/wrangler.toml</code> and
          redeploy — <code>docs/SETUP.md</code> step 7. It must match <code>projectId</code> in{' '}
          <code>apps/web/src/lib/firebase.ts</code>.
        </p>
      </div>
    );
  }

  async function onSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signIn();
      // No navigation here on purpose. watchAuth fires, useAuthUser flips to
      // 'in', and App re-renders — a reload would throw away the session
      // Firebase has only just established.
    } catch (err) {
      // A closed popup is the overwhelmingly common case and is not a failure,
      // so it must not render as a red error box.
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setBusy(false);
        return;
      }
      // ⚠️ The one worth naming. This host has to be listed in Firebase →
      // Authentication → Settings → Authorised domains, and that console is
      // owner-only, so a session cannot fix it from here.
      setError(
        code === 'auth/unauthorized-domain'
          ? `This site (${window.location.hostname}) is not an authorised domain on the Firebase project.`
          : ((err as Error)?.message ?? 'Sign-in failed.'),
      );
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <h1>Board Game Catalog</h1>
      <p className="signin-lede">Private collection. Sign in to continue.</p>
      <button className="google-btn" onClick={() => void onSignIn()} type="button" disabled={busy}>
        <GoogleMark />
        <span>{busy ? 'Signing in…' : 'Sign in with Google'}</span>
      </button>
      {error && <p className="error-text">{error}</p>}
      <p className="note">
        First time here? Signing in doesn&apos;t let you in by itself — it puts you in the queue,
        and an owner approves you.
      </p>
    </div>
  );
}
