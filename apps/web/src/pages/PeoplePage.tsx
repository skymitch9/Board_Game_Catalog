import { useEffect, useState } from 'react';
import { ROLES, type AppUser, type MeResponse, type Role } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Badge, ErrorBox, Spinner } from '../components/ui';

const ROLE_BLURB: Record<Role, string> = {
  owner: 'Can add, edit and delete anything, and approve other people.',
  rater: 'Can browse the collection and leave ratings, but not change it.',
  viewer: 'Can browse the collection. Cannot rate it or change anything.',
  pending: 'Signed in, but sees nothing until you let them in.',
};

function RoleControls({
  user,
  isMe,
  onChanged,
}: {
  user: AppUser;
  isMe: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function set(role: Role) {
    setBusy(true);
    setError(null);
    try {
      await api.setRole(user.id, role);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="person-actions">
      {error ? <ErrorBox error={error} what="Could not change this role" /> : null}
      {/* Derived from ROLES rather than listed again, so a role added to the
          matrix cannot end up assignable nowhere. The old hardcoded copy of
          this list is exactly how `viewer` would have shipped invisible. */}
      {ROLES.filter((r) => r !== user.role)
        .map((role) => (
          <button
            key={role}
            type="button"
            className={role === 'pending' ? 'btn btn-quiet' : 'btn'}
            disabled={busy}
            onClick={() => set(role)}
            title={ROLE_BLURB[role]}
          >
            {role === 'pending' ? 'Revoke' : `Make ${role}`}
          </button>
        ))}
      {isMe && <span className="muted small">that&apos;s you</span>}
    </div>
  );
}

/**
 * The guest list. Cloudflare Access lets anyone authenticate; this decides who
 * actually gets in, which is why it lives in the app rather than the Cloudflare
 * dashboard.
 */
export function PeoplePage({
  me,
  onPendingChange,
}: {
  me: MeResponse;
  onPendingChange?: (n: number) => void;
}) {
  const [users, refresh] = useAsync(() => api.users(), []);

  const list = users.state === 'ok' ? users.data.users : null;
  const pendingCount = list?.filter((u) => u.role === 'pending').length ?? null;

  // Tell the nav what this page can see. The badge it draws comes from
  // `/api/me`, which is fetched once at startup and cannot notice an approval
  // made here — and this is the one screen where that staleness is visible,
  // because approving someone is what you came to do. Reported from the loaded
  // list rather than from the click, so a change made in another tab and picked
  // up by `refresh` corrects the badge too.
  useEffect(() => {
    if (pendingCount != null) onPendingChange?.(pendingCount);
  }, [pendingCount, onPendingChange]);

  if (users.state === 'loading') return <Spinner />;
  if (users.state === 'error') {
    return <ErrorBox error={users.error} what="Could not load the people list" />;
  }

  const pending = users.data.users.filter((u) => u.role === 'pending');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="subtitle">
            Anyone can sign in, but only people you approve here can see the collection.
          </p>
        </div>
      </header>

      {pending.length > 0 && (
        <div className="card pending-callout">
          <strong>
            {pending.length} {pending.length === 1 ? 'person is' : 'people are'} waiting
          </strong>
          <span className="muted">
            They&apos;ve signed in and are seeing a holding screen until you decide.
          </span>
        </div>
      )}

      <ul className="person-list">
        {users.data.users.map((u) => (
          <li key={u.id} className="card person">
            <div className="person-id">
              <span className="person-email">{u.displayName || u.email}</span>
              {u.displayName && <span className="muted small">{u.email}</span>}
              <span className="muted small">
                first seen {u.firstSeenAt.replace('T', ' ').slice(0, 16)}
              </span>
            </div>
            {/* `viewer` gets its own tone rather than falling through to the
                `pending` one — a guest who is in and a guest who is waiting are
                the two states this page exists to tell apart. */}
            <Badge
              tone={
                u.role === 'owner'
                  ? 'owned'
                  : u.role === 'rater'
                    ? 'lent'
                    : u.role === 'viewer'
                      ? 'preordered'
                      : 'wanted'
              }
            >
              {u.role}
            </Badge>
            <RoleControls user={u} isMe={u.email === me.email} onChanged={refresh} />
          </li>
        ))}
      </ul>

      <CachePanel />
    </>
  );
}

/**
 * Cache maintenance.
 *
 * Lives on the People screen because that is already the owner-only page, and
 * because a cache you cannot see or empty is a debugging trap: when a scan
 * returns something odd, the first question is "is that a fresh answer or a
 * remembered one?" and there was no way to tell or to reset it.
 *
 * Deliberately reassuring about scope. None of this is catalog data — clearing
 * it costs a repeat lookup and nothing else — and the copy says so, because a
 * "Clear" button next to your collection should explain what it will not touch.
 */
function CachePanel() {
  const [stats, refresh] = useAsync(() => api.cache(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function clear(target: 'all' | 'lookups', label: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.clearCache(target);
      setMessage(`Cleared ${res.removed} ${label} ${res.removed === 1 ? 'entry' : 'entries'}.`);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Lookup cache</h2>
      </div>

      <p className="muted">
        What we have already asked GameUPC, UPCitemdb and Claude, so a repeat scan
        does not pay for the same answer twice. <strong>None of this is your
        collection</strong> — clearing it only means the next scan looks things up
        again.
      </p>

      {stats.state === 'loading' && <Spinner label="Reading cache…" />}
      {stats.state === 'error' && <ErrorBox error={stats.error} what="Cache" />}

      {stats.state === 'ok' && (
        <>
          <ul className="cache-stats">
            <li>
              <strong>{stats.data.stats.titles}</strong> titles
            </li>
            <li>
              <strong>{stats.data.stats.barcodes}</strong> barcodes
            </li>
          </ul>
          {stats.data.stats.oldest && (
            <p className="muted">Oldest entry: {stats.data.stats.oldest}</p>
          )}

          <div className="cache-actions">
            <button type="button" disabled={busy} onClick={() => clear('lookups', 'lookup')}>
              Clear lookups
            </button>
            <button type="button" disabled={busy} onClick={() => clear('all', 'cache')}>
              Clear everything
            </button>
          </div>
        </>
      )}

      {message && <p className="muted">{message}</p>}
      {error != null && <ErrorBox error={error} what="Could not clear the cache" />}
    </section>
  );
}
