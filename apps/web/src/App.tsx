import type { MeResponse } from '@bgc/core';
import { ApiError, api } from './api';
import { useAsync } from './hooks';
import { Link, useRoute } from './router';
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
    case 'collection':
      return <CollectionPage me={me} />;
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
      return <ScanPage me={me} />;
    case 'scanJobs':
      return <ScanJobsPage me={me} />;
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
          {/* The wishlist is a place, not an action — what we don't have yet is
              a different view of the collection, not a thing done to it — so it
              belongs in the bar alongside People. */}
          <Link to="/wishlist">Wishlist</Link>
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
