import { useState } from 'react';
import type { AppUser, MeResponse, Role } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Badge, ErrorBox, Spinner } from '../components/ui';

const ROLE_BLURB: Record<Role, string> = {
  owner: 'Can add, edit and delete anything, and approve other people.',
  rater: 'Can browse the collection and leave ratings, but not change it.',
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
      {(['owner', 'rater', 'pending'] as Role[])
        .filter((r) => r !== user.role)
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
export function PeoplePage({ me }: { me: MeResponse }) {
  const [users, refresh] = useAsync(() => api.users(), []);

  if (users.state === 'loading') return <Spinner />;
  if (users.state === 'error') {
    return <ErrorBox error={users.error} what="Could not load the people list" />;
  }

  const list = users.data.users;
  const pending = list.filter((u) => u.role === 'pending');

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
        {list.map((u) => (
          <li key={u.id} className="card person">
            <div className="person-id">
              <span className="person-email">{u.displayName || u.email}</span>
              {u.displayName && <span className="muted small">{u.email}</span>}
              <span className="muted small">
                first seen {u.firstSeenAt.replace('T', ' ').slice(0, 16)}
              </span>
            </div>
            <Badge
              tone={u.role === 'owner' ? 'owned' : u.role === 'rater' ? 'lent' : 'wanted'}
            >
              {u.role}
            </Badge>
            <RoleControls user={u} isMe={u.email === me.email} onChanged={refresh} />
          </li>
        ))}
      </ul>
    </>
  );
}
