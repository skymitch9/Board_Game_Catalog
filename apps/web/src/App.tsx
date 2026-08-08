import type { MeResponse } from '@bgc/core';
import { ApiError, api } from './api';
import { useAsync } from './hooks';
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
import { WishlistPage } from './pages/WishlistPage';
import { CoverHealthBanner } from './components/CoverHealthBanner';
import { EmptyState, ErrorBox, Spinner } from './components/ui';

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
    case 'scanJobReview':
      return <ScanJobReviewPage id={route.id} me={me} />;
    case 'retag':
      return <RetagPage me={me} />;
    case 'detailsQueue':
      return <DetailsQueuePage me={me} />;
    case 'wishlist':
      return <WishlistPage me={me} />;
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

export default function App() {
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
          {me.data.capabilities.includes('manageUsers') && <Link to="/people">People</Link>}
          <span className="who" title={me.data.email}>
            {me.data.displayName || me.data.email}
            {me.data.role !== 'owner' && <span className="role-tag"> {me.data.role}</span>}
          </span>
        </span>
      </nav>
      {/* Above the page rather than inside one: a dead cover is a fact about
          the catalog, not about whichever screen happens to be open. */}
      <CoverHealthBanner me={me.data} />
      <Routes me={me.data} />
    </main>
  );
}
