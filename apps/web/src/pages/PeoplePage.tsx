import { useEffect, useState } from 'react';
import type { MeResponse, Role } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Badge, ErrorBox, Spinner } from '../components/ui';

/**
 * Six rungs since the 2026-08-16 role redesign, `pending` a status rather than
 * a rung — see `ROLE_LADDER` in `packages/core/src/constants.ts`. Kept as the
 * role badge's tooltip — informational, not a control, so it survived the
 * read-only rewrite below.
 */
const ROLE_BLURB: Record<Role, string> = {
  owner: 'Everything an admin can do, plus granting the admin role itself.',
  admin:
    'Everything a moderator can do, plus approving people and changing roles — but never up to admin or owner.',
  moderator:
    'Can add, edit and delete anything in the catalog, including research runs and photo scans. Cannot change anyone’s role.',
  contributor:
    'Can add, edit and delete catalog items and curate the wishlist, and can scan barcodes (free). Cannot photo-scan, run research, or change roles.',
  member: 'Can browse the collection, leave ratings, and suggest things for the wishlist.',
  guest: 'Can browse the collection. Cannot rate it, suggest to the wishlist, or change anything.',
  pending: 'Signed in, but sees nothing until you let them in.',
};

/**
 * The guest list — READ-ONLY. Cloudflare Access lets anyone authenticate;
 * this used to be where somebody decided who actually gets in.
 *
 * ⚠️ **Made read-only 2026-08-16.** Owner: *"remove all people stuff from the
 * individual sites and have it all redirect back to the admin page on
 * heygabi,"* refined to **read-only rather than a hard redirect** — heygabi.ai
 * /admin is itself gated on being an *estate approver*, and an app `admin`
 * (this repo's own delegated `manageUsers` role) is not guaranteed to be one.
 * A redirect would bounce exactly the person `admin` was created to delegate
 * to. Read-only keeps this screen useful for everyone who could always see
 * it, while mutation lives in exactly one place now.
 *
 * Removed entirely: `RoleControls` (every `Make <role>` / `Revoke` button)
 * and `api.setRole`'s only caller. `canGrantRole` and `ROLES` are no longer
 * imported here for the same reason — nothing left derives a button list
 * from them.
 *
 * ⚠️ **The server-side routes are unchanged and still load-bearing.**
 * `GET /api/users` (still called, for the read) and `PATCH /api/users/:id/role`
 * (no longer called from here, but still gated by `requireCapability
 * ('manageUsers')` in `apps/worker/src/routes/users.ts`) are exactly how
 * heygabi.ai/admin's federation edits this app's roles — removing or
 * weakening either would break the estate admin page, not just this one.
 *
 * The cache panel below is unrelated and untouched: it clears lookup caches,
 * never a person, so it was never in scope for this change.
 */
export function PeoplePage({
  me,
  onPendingChange,
}: {
  me: MeResponse;
  onPendingChange?: (n: number) => void;
}) {
  const [users] = useAsync(() => api.users(), []);

  const list = users.state === 'ok' ? users.data.users : null;
  const pendingCount = list?.filter((u) => u.role === 'pending').length ?? null;

  // Tell the nav what this page can see. The badge it draws comes from
  // `/api/me`, which is fetched once at startup and cannot notice an approval
  // made elsewhere (heygabi.ai/admin, now the only place one happens) — this
  // is the one screen with a fresher count, from its own read of the roster.
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

      {/* The one write path left. Prominent on purpose: this used to be a page
          full of buttons, and it is now a page with none — the reason has to
          be right where the buttons used to be, not buried below the list. */}
      <div className="card pending-callout">
        <strong>
          <a href="https://heygabi.ai/admin" target="_blank" rel="noreferrer">
            Manage roles at heygabi.ai/admin →
          </a>
        </strong>
        <span className="muted">
          This page is read-only. Approving people, changing a role, or revoking one all happen
          there now.
        </span>
      </div>

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
              {/* Entry point only, never a control: estate-wide grants live
                  solely on heygabi.ai/admin, which is its own gate. This page
                  is already behind manageUsers (App.tsx), so exactly the
                  people who could act on what they see get the link. */}
              <a
                className="muted small"
                href={`https://heygabi.ai/admin#member=${encodeURIComponent(u.email)}`}
                target="_blank"
                rel="noreferrer"
              >
                Estate admin →
              </a>
            </div>
            {/* `guest` (née `viewer`) gets its own tone rather than falling
                through to the `pending` one — a guest who is in and a guest
                who is waiting are the two states this page exists to tell
                apart.

                `owner`, `admin`, `moderator` and `contributor` share the
                "owned" tone deliberately: all four can touch the catalog
                (`editCatalog` is contributor+), and the finer distinctions
                between them — who can manage users, who can photo-scan — are
                spelled out in `ROLE_BLURB` rather than in a fifth colour. */}
            <span title={ROLE_BLURB[u.role]}>
              <Badge
                tone={
                  u.role === 'owner' ||
                  u.role === 'admin' ||
                  u.role === 'moderator' ||
                  u.role === 'contributor'
                    ? 'owned'
                    : u.role === 'member'
                      ? 'lent'
                      : u.role === 'guest'
                        ? 'preordered'
                        : 'wanted'
                }
              >
                {u.role}
              </Badge>
            </span>
            {u.email === me.email && <span className="muted small">that&apos;s you</span>}
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
