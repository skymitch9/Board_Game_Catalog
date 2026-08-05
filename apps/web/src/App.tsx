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
          {/* One way in, and it is the queue. Photographing a shelf and coming
              back to the results beats deciding about each game while stood in
              front of it, so the queue is "Add games" and the live camera is
              the specialist tool behind it, not a competing front door. */}
          <Link to="/scan-jobs">Add games</Link>
          <Link to="/scan">Scan a barcode</Link>
          {me.data.capabilities.includes('manageUsers') && <Link to="/people">People</Link>}
          <span className="who" title={me.data.email}>
            {me.data.displayName || me.data.email}
            {me.data.role !== 'owner' && <span className="role-tag"> {me.data.role}</span>}
          </span>
        </span>
      </nav>
      <Routes me={me.data} />
    </main>
  );
}
