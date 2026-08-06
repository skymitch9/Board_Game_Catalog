import { useState } from 'react';
import type { MeResponse } from '@bgc/core';
import { api, type NeedsDetails } from '../api';
import { useAsync } from '../hooks';
import { ErrorBox, Spinner } from '../components/ui';
import { Link } from '../router';

/**
 * Games with blanks, and a way to fill them.
 *
 * A scanned collection arrives almost empty: the free lookups give a name, a
 * BoardGameGeek id and sometimes a year, and nothing else — no publisher at
 * all. That is a gap in its own right, and it also blocks the research
 * pipeline, whose official tier needs a publisher's website before it can
 * search anything.
 *
 * Run one at a time or let it work down the list. It goes one game at a time
 * on purpose: each is a paid call, the running total is visible as it goes,
 * and stopping half way leaves the games it already did filled in.
 */
export function DetailsQueuePage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.needsDetails(), []);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [results, setResults] = useState<Record<number, string>>({});
  const [spentCents, setSpentCents] = useState(0);
  const [error, setError] = useState<unknown>(null);

  const canRun = me.capabilities.includes('runResearch');
  if (!canRun) {
    return <p className="muted">Only owners can look up game details.</p>;
  }
  if (state.state === 'loading') return <Spinner label="Finding games with blanks..." />;
  if (state.state === 'error') {
    return <ErrorBox error={state.error} what="Could not load the list" />;
  }

  const items = state.data.items;
  const cents = state.data.centsEach;
  const outstanding = items.filter((i) => !results[i.id]);

  /** One game. Returns false if the run should stop. */
  async function fillOne(item: NeedsDetails): Promise<boolean> {
    try {
      const res = await api.fillItemDetails(item.id);
      setSpentCents((c) => c + res.usage.estimatedCents);

      const filled = Object.keys(res.filled);
      setResults((r) => ({
        ...r,
        [item.id]:
          filled.length > 0
            ? `Filled ${filled.join(', ')}.`
            : (res.detail ?? 'Nothing new found.'),
      }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults((r) => ({ ...r, [item.id]: msg }));
      // One game failing is not a reason to abandon the rest — a bad name or a
      // flaky search should cost that row, not the run.
      return true;
    }
  }

  async function runAll() {
    setRunning(true);
    setStopping(false);
    setError(null);

    for (const item of items) {
      if (stopping) break;
      if (results[item.id]) continue;
      const keepGoing = await fillOne(item);
      if (!keepGoing) break;
    }

    setRunning(false);
    refresh();
  }

  return (
    <div className="scan-jobs-page">
      <header className="page-head">
        <div>
          <h1>Fill in missing details</h1>
          <p className="subtitle">
            Scanning gives a name and little else. This looks each game up on the web
            and fills only the blanks — anything already recorded is left alone.
          </p>
          {/* Said here rather than left to be inferred from a short list: the
              queue went from 694 rows to 78 when children stopped being asked,
              and a page that quietly dropped 616 games would look broken. */}
          <p className="muted small">
            Only games are listed. An expansion, promo or accessory takes its publisher
            from the game it belongs to, so there is nothing here worth paying to look up.
          </p>
        </div>
        <Link to="/" className="btn btn-quiet">Collection</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Lookup" />}

      <section className="card">
        <div className="shelf-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || outstanding.length === 0}
            onClick={runAll}
          >
            {running
              ? 'Working…'
              : outstanding.length === 0
                ? 'All done'
                : `Fill in ${outstanding.length} game${outstanding.length === 1 ? '' : 's'}`}
          </button>
          {running && (
            <button type="button" className="btn btn-quiet" onClick={() => setStopping(true)}>
              Stop after this one
            </button>
          )}
          <span className="muted small">
            {outstanding.length > 0 && (
              <>
                About {formatCents(outstanding.length * cents.low)}–
                {formatCents(outstanding.length * cents.high)} for the lot.
              </>
            )}
            {spentCents > 0 && <> Spent so far: {formatCents(spentCents)}.</>}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="muted">
            Every game has a publisher, a year, a player count and a description, and
            everything filed under one reads its publisher from the game. Nothing to
            fill in.
          </p>
        ) : (
          <ul className="candidate-list">
            {items.map((item) => {
              const outcome = results[item.id];
              return (
                <li key={item.id} className="candidate">
                  {outcome && (
                    <span className="shelf-outcome" aria-hidden="true">✓</span>
                  )}
                  <div className="candidate__body">
                    <strong>
                      <Link to={`/items/${item.id}`}>{item.name}</Link>
                    </strong>
                    <span className="muted small">missing: {item.missing.join(', ')}</span>
                    {outcome && <span className="muted small">{outcome}</span>}
                  </div>
                  {!outcome && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-xs"
                      disabled={running}
                      onClick={() => void fillOne(item)}
                    >
                      Fill this one
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatCents(cents: number): string {
  return cents < 100 ? `${Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}
