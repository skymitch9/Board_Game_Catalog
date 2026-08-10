import { useState } from 'react';
import type { MeResponse } from '@bgc/core';
import { ApiError, api } from './api';
import { useAsync, useAuthUser } from './hooks';
import { signOutNow } from './lib/firebase';
import { Link, collectionPath, useRoute } from './router';
import { SignIn } from './SignIn';
import { NewItemPage } from './components/ItemForm';
import { CollectionPage } from './pages/CollectionPage';
import { ItemPage, NotFoundPage } from './pages/ItemPage';
import { PeoplePage } from './pages/PeoplePage';
import { ScanPage } from './pages/ScanPage';
import { ScanJobsPage, ScanJobReviewPage } from './pages/ScanJobsPage';
import { RetagPage } from './pages/RetagPage';
import { DetailsQueuePage } from './pages/DetailsQueuePage';
import { ExportPage } from './pages/ExportPage';
import { WishlistPage } from './pages/WishlistPage';
import { CoverHealthBanner } from './components/CoverHealthBanner';
import { ThemeToggle } from './components/ThemeToggle';
import { EmptyState, ErrorBox, Spinner } from './components/ui';

function Routes({
  me,
  onPendingChange,
}: {
  me: MeResponse;
  onPendingChange: (n: number) => void;
}) {
  const route = useRoute();

  switch (route.name) {
    // Keyed by the filters for the same reason ItemPage is keyed by id below:
    // the page seeds its state from the URL once, so arriving at a *different*
    // set of filters — pressing Back, or "Cancel" landing you on a bare "/" —
    // has to be a new page rather than the old one holding the old search.
    // Typing in the search box does not come through here at all; the page
    // rewrites the URL with `replaceUrl`, which fires no popstate.
    case 'collection':
      return <CollectionPage key={collectionPath(route.filters)} me={me} filters={route.filters} />;
    // Keyed by id: without it React reuses one ItemPage across every game you
    // open, and page state — a half-open copy form, a report of what a lookup
    // just filled in — follows you to the next one.
    case 'item':
      return <ItemPage key={route.id} id={route.id} me={me} />;
    case 'editItem':
      return <ItemPage key={route.id} id={route.id} me={me} editing />;
    case 'newItem':
      return <NewItemPage parentId={route.parentId} />;
    case 'scan':
      return <ScanPage me={me} initialMode={route.mode} />;
    case 'scanJobs':
      return <ScanJobsPage me={me} add={route.add} />;
    case 'scanJobReview':
      return <ScanJobReviewPage id={route.id} me={me} />;
    case 'retag':
      return <RetagPage me={me} />;
    case 'detailsQueue':
      return <DetailsQueuePage me={me} />;
    case 'wishlist':
      return <WishlistPage me={me} />;
    // Gated the same way the link is, and for the same reason the People route
    // is: the API behind it requires `editCatalog`, so a rater reaching the URL
    // would otherwise get a page whose every button 403s.
    case 'export':
      return me.capabilities.includes('editCatalog') ? <ExportPage /> : <NotFoundPage />;
    case 'people':
      return me.capabilities.includes('manageUsers') ? (
        <PeoplePage me={me} onPendingChange={onPendingChange} />
      ) : (
        <NotFoundPage />
      );
    default:
      return <NotFoundPage />;
  }
}

/**
 * The auth gate. Everything below it can assume Firebase has a session.
 *
 * ⚠️ This wrapper exists because of an ordering trap, not for tidiness.
 * `onAuthStateChanged` does not answer synchronously: on a cold load Firebase
 * has to restore a persisted session first, and until it does, `currentUser` is
 * `null`. Calling `/api/me` in that window sends no token, gets a 401, and
 * shows the sign-in screen to somebody who is already signed in — on every
 * single page load. So the token has to exist before the first request, not
 * merely before the second.
 *
 * Access made this a non-problem: its cookie was on the very first request the
 * browser made. Nothing is, now.
 *
 * It is a separate component rather than an early return so that `SignedInApp`
 * still calls its hooks unconditionally.
 */
export default function App() {
  const auth = useAuthUser();

  if (auth.state === 'resolving') return <Spinner label="Restoring your session…" />;
  if (auth.state === 'out') return <SignIn reason="unauthenticated" />;
  return <SignedInApp />;
}

function SignedInApp() {
  const [me] = useAsync(() => api.me(), []);
  // Set by the People page while it is open; null means "nobody has told me
  // anything better than the count that arrived with /api/me".
  const [pendingOverride, setPendingOverride] = useState<number | null>(null);

  if (me.state === 'loading') return <Spinner label="Signing in…" />;

  if (me.state === 'error') {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <SignIn reason="unauthenticated" />;
    }
    if (me.error instanceof ApiError && me.error.status === 500) {
      return <SignIn reason="misconfigured" />;
    }
    return (
      <main>
        <ErrorBox error={me.error} what="Could not verify who you are" />
      </main>
    );
  }

  // Approved roles only. A pending account sees a waiting screen, never data.
  if (!me.data.capabilities.includes('read')) {
    return (
      <main>
        <EmptyState title="Waiting for approval">
          <p className="muted">
            You&apos;re signed in as <strong>{me.data.email}</strong>, but an owner needs to let you
            in before you can see the collection.
          </p>
          {/* This screen is now reachable by strangers, which it never was
              under Cloudflare Access — Access turned away anyone not already on
              its allowlist, so nobody could get far enough to wait. Somebody
              who lands here having signed in with the wrong Google account
              needs a way back out that isn't clearing site data. */}
          <p className="muted">
            <button className="linklike" onClick={() => void signOutNow()} type="button">
              Sign out
            </button>{' '}
            to try a different account.
          </p>
        </EmptyState>
      </main>
    );
  }

  const canEdit = me.data.capabilities.includes('editCatalog');
  // Absent (an older bundle against a newer worker, or the other way round) and
  // null (a reader, or a count that failed) both mean "not known", and an
  // unknown count shows the link. A link to an empty screen is a nuisance; a
  // link that is not drawn is invisible, and the owner cannot press what they
  // cannot see.
  const chores = me.data.chores;
  const showRetag = canEdit && (chores == null || chores.relatedGames > 0);
  const showDetails = canEdit && (chores == null || chores.missingDetails > 0);
  // The reverse of the rule above, deliberately. An unknown count hides the
  // badge instead of showing it: those links guard against a screen you cannot
  // reach, whereas this decorates a link that is always there, and a badge
  // invented from `undefined` would claim somebody is waiting when nobody is.
  // `?? 0` therefore covers both a failed count and an older worker.
  //
  // The override is what keeps it honest while you work. `chores` is fixed at
  // the last full page load — fine for the two maintenance links, wrong here,
  // because approving someone is done on the very page the badge points at, and
  // a badge still saying 3 after you cleared the queue teaches you to ignore it.
  // Re-fetching /api/me is not the fix: `useAsync` drops back to `loading`, so
  // the whole app would blink through "Signing in…" on every role change. The
  // People page already counts them for its own callout, so it just says so.
  const waiting = pendingOverride ?? chores?.pendingUsers ?? 0;

  return (
    <main>
      <nav className="topbar">
        <Link to="/" className="brand">
          Board Game Catalog
        </Link>
        <span className="topbar-right">
          {/* Adding lives on the collection page, next to the thing being added
              to. Hoisting it up here as well made the top bar a second, competing
              menu for the same job — and the bar is for moving between places,
              not for actions. */}
          {/* Places, not actions. The wishlist is a different view of the
              collection; Related games and Missing details are two lists you
              visit to work through and then leave. None of them is a thing you
              *do* to the collection, which is why they sit here and not in the
              collection header — that header now holds one button, "+ Add
              games", because adding is the one thing you do on that screen.

              Both maintenance links appear only while they have something
              outstanding, with the count on the face so a tap can be judged
              before it is spent. A screen with nothing on it does not earn a
              permanent slot, and this is a better answer to a 360px-wide phone
              than shrinking the type until five links fit. The pages stay
              reachable by URL either way — this hides the link, not the
              screen. */}
          <Link to="/wishlist">Wishlist</Link>
          {showRetag && (
            <Link to="/retag">
              Related games{chores ? ` (${chores.relatedGames})` : ''}
            </Link>
          )}
          {showDetails && (
            <Link to="/details">
              Missing details{chores ? ` (${chores.missingDetails})` : ''}
            </Link>
          )}
          {/* Unlike the two maintenance links above, People is always drawn —
              it is the only way to change anyone's role, so it cannot hide when
              it happens to be quiet. The badge is the opposite case to those
              counts: a waiting person is the one piece of outstanding work
              nothing else in the app mentions, so it is a filled badge rather
              than "(N)" in the link text. Zero draws nothing. */}
          {me.data.capabilities.includes('manageUsers') && (
            <Link to="/people">
              People
              {waiting > 0 && (
                <span
                  className="nav-badge"
                  title={`${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting to be let in`}
                >
                  {waiting}
                </span>
              )}
            </Link>
          )}
          {/* Taking the collection away with you is a place, not an action —
              two formats that are not interchangeable, so something has to
              offer the choice. It used to be two bare links in the collection
              page's result count, where the one thing on screen that protects
              against losing everything sat beside the paging text.

              Unconditional, unlike the maintenance links above: those hide
              when they have nothing outstanding, and there is no such thing as
              having nothing to back up. The page itself says so when the
              catalog is empty. */}
          {canEdit && <Link to="/export">Export</Link>}
          {/* Last before the signed-in name, and shown to everyone including
              readers — how the app looks is not a permission. */}
          <ThemeToggle />
          <span className="who" title={me.data.email}>
            {me.data.displayName || me.data.email}
            {me.data.role !== 'owner' && <span className="role-tag"> {me.data.role}</span>}
          </span>
          {/* New with Firebase sign-in. Under Cloudflare Access there was
              nothing useful to put here — signing out meant clearing an Access
              cookie this app did not own — so the name was the end of the bar.
              Now the session belongs to the app, and a session you cannot end
              is a bug on a shared or borrowed device. */}
          <button className="linklike" onClick={() => void signOutNow()} type="button">
            Sign out
          </button>
        </span>
      </nav>
      {/* Above the page rather than inside one: a dead cover is a fact about
          the catalog, not about whichever screen happens to be open. */}
      <CoverHealthBanner me={me.data} />
      <Routes me={me.data} onPendingChange={setPendingOverride} />
    </main>
  );
}
