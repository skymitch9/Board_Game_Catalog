import { useEffect, useState } from 'react';
import type { HealthResponse, MeResponse } from '@bgc/core';
import { ApiError, api } from './api';
import { SignIn } from './SignIn';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; error: unknown };

function useEndpoint<T>(fn: () => Promise<T>): Load<T> {
  const [result, setResult] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    fn()
      .then((data) => live && setResult({ state: 'ok', data }))
      .catch((error) => live && setResult({ state: 'error', error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return result;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn';
}) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={tone ? `row-value tone-${tone}` : 'row-value'}>{value}</span>
    </div>
  );
}

export default function App() {
  const health = useEndpoint<HealthResponse>(api.health);
  const me = useEndpoint<MeResponse>(api.me);

  // No verified identity yet — show the sign-in screen rather than a broken
  // status page.
  if (me.state === 'error' && me.error instanceof ApiError) {
    if (me.error.status === 401) return <SignIn reason="unauthenticated" />;
    if (me.error.status === 500) return <SignIn reason="misconfigured" />;
  }

  return (
    <main>
      <header>
        <h1>Board Game Catalog</h1>
        <p className="subtitle">Phase 0 — infrastructure check</p>
      </header>

      <section className="card">
        <h2>System</h2>
        <Row
          label="Worker"
          value={
            health.state === 'loading'
              ? 'checking…'
              : health.state === 'ok'
                ? 'reachable'
                : 'unreachable'
          }
          tone={health.state === 'ok' ? 'good' : health.state === 'error' ? 'bad' : undefined}
        />
        <Row
          label="Database (D1)"
          value={
            health.state === 'loading'
              ? 'checking…'
              : health.state === 'ok'
                ? health.data.database === 'up'
                  ? 'migrations applied'
                  : 'reachable, migrations missing'
                : 'unknown'
          }
          tone={
            health.state === 'ok'
              ? health.data.database === 'up'
                ? 'good'
                : 'bad'
              : undefined
          }
        />
        {health.state === 'ok' && <Row label="Version" value={health.data.version} />}
      </section>

      <section className="card">
        <h2>Identity</h2>
        {me.state === 'loading' && <Row label="Signed in as" value="checking…" />}
        {me.state === 'error' && <Row label="Signed in as" value="error" tone="bad" />}
        {me.state === 'ok' && (
          <>
            <Row label="Signed in as" value={me.data.email} tone="good" />
            <Row
              label="Role"
              value={me.data.role}
              tone={
                me.data.role === 'owner' ? 'good' : me.data.role === 'rater' ? 'warn' : 'bad'
              }
            />
            {me.data.role === 'pending' ? (
              <p className="note">
                Your account is waiting for an owner to approve it. Nothing in the collection is
                visible until then.
              </p>
            ) : (
              <Row label="Can" value={me.data.capabilities.join(', ')} />
            )}
          </>
        )}
      </section>

      <footer>
        <p>
          All four checks green means phase 0 is done. Next: phase 1, the manual catalog — see{' '}
          <code>docs/DESIGN.md §7</code>.
        </p>
      </footer>
    </main>
  );
}
