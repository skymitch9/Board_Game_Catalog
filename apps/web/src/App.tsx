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
import { ScanHistoryPage } from './pages/ScanHistoryPage';
import { RetagPage } from './pages/RetagPage';
import { DetailsQueuePage } from './pages/DetailsQueuePage';
import { ExportPage } from './pages/ExportPage';
import { WishlistPage } from './pages/WishlistPage';
import { CoverHealthBanner } from './components/CoverHealthBanner';
import { EstateSearch } from './components/EstateSearch';
import { ThemeToggle } from './components/ThemeToggle';
import { EmptyState, ErrorBox, Spinner } from './components/ui';

// The estate-wide search bar's visibility switch — see the comment at its
// render site. false = hidden on owner order 2026-08-17 ("might want later");
// flip to true to bring it back, nothing else needs touching.
const SHOW_ESTATE_SEARCH = false;

function Routes({ me }: { me: MeResponse }) {
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
    // Keyed by page so moving between pages remounts and refetches — the page
    // seeds its fetch from the URL, the same contract the collection has.
    case 'scanHistory':
      return <ScanHistoryPage key={route.page} me={me} page={route.page} />;
    case 'scanJobReview':
      return <ScanJobReviewPage id={route.id} me={me} />;
    case 'retag':
      return <RetagPage me={me} />;
    case 'detailsQueue':
      return <DetailsQueuePage me={me} />;
    case 'wishlist':
      return <WishlistPage me={me} />;
    // Gated the same way the link is, and for the same reason the People route
    // is: the API behind it requires `editCatalog`, so a member reaching the
    // URL would otherwise get a page whose every button 403s.
    case 'export':
      return me.capabilities.includes('editCatalog') ? <ExportPage /> : <NotFoundPage />;
    case 'people':
      return me.capabilities.includes('manageUsers') ? (
        <PeoplePage me={me} />
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
  // (The People nav badge that used to live here went with the People link on
  // 2026-08-16 — see the note in the nav below for why, and for what would
  // have to come back with it.)

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
          {/* ⚠️ NO "People" LINK HERE — removed from the nav 2026-08-16 at the
              owner's request ("remove /people from the nav on library and
              games; keep the page just hide it from nav"). The route and the
              page are UNTOUCHED: /people still resolves and still renders,
              and `manageUsers` still gates it. This hides the door; it was
              never the lock.

              This link used to carry a filled badge counting people waiting
              to be let in, and the argument for it was that People "cannot
              hide when it happens to be quiet" because it was the only way to
              change a role. That stopped being true — roles are granted on
              heygabi.ai/admin now, which is what made this page read-only.
              With no action left here, an always-drawn link advertising a
              count you cannot act on is worse than no link.

              The badge's whole support structure went with it (see the
              deleted `pendingOverride` state): it existed ONLY to keep this
              number honest while the People page was open, since `chores` is
              fixed at the last full page load and a badge still reading 3
              after you cleared the queue teaches you to ignore badges.
              PeoplePage's `onPendingChange` prop is optional and now simply
              goes uncalled — left in place so the page needs no edit at all.

              ⚠️ Do not "restore the missing link" — its absence is the
              feature, and restoring it means restoring the override plumbing
              too, or the badge silently lies. Needs the owner's word. */}
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
      {/* "Do we own this on ANY shelf?" — the shared <estate-search> element,
          asking the cross-catalog index at index.heygabi.ai (see
          components/EstateSearch.tsx). Chrome, not a page: it is about the
          whole estate rather than about whichever screen is open, which is why
          it sits here beside the nav and not inside the collection.

          ⚠️ It does NOT replace the collection search. CollectionPage's own box
          searches THIS catalog server-side with facets and paging; this one
          reaches the audiobooks and the library, which that box cannot show.
          Folded shut by default for exactly that reason — two search boxes
          side by side is one question too many on a screen whose job is the
          collection.

          ⚠️ HIDDEN on owner order 2026-08-17 ("Cool but not needed currently.
          Don't delete tho just hide it. Might want later"): rendered false
          via the constant below its imports, component + sync script kept
          intact so re-enabling is flipping one constant. Do NOT delete
          EstateSearch.tsx or sync-estate-search.mjs while this is false.

          🔴 CORRECTED 2026-09-06 (2026-08 audit, finding 17). This block used
          to name "the _headers index.heygabi.ai allowances" and "the CSP
          entries" among the things not to delete. THERE ARE NONE, and never
          were: `_headers` holds Cache-Control rules and nothing else, a
          repo-wide grep for CSP directives returns zero, and a live read of
          https://boardgames.heygabi.ai/ the same day found no
          content-security-policy at the edge either (nor x-frame-options, nor
          x-content-type-options). So flipping this constant back to true does
          NOT land on a prepared allow-list — it lands on an app with no CSP at
          all, which is a decision still to be made rather than one already
          made. KNOWN_ISSUES KI-10 holds it. */}
      {SHOW_ESTATE_SEARCH && <EstateSearch />}
      {/* Above the page rather than inside one: a dead cover is a fact about
          the catalog, not about whichever screen happens to be open. */}
      <CoverHealthBanner me={me.data} />
      <Routes me={me.data} />
    </main>
  );
}
