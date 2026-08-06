import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetailsRun, MeResponse } from '@bgc/core';
import { api, type NeedsDetails } from '../api';
import { useAsync, useInterval } from '../hooks';
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
 * ## The answer lives in the database, not in this tab
 *
 * Each lookup is a Claude call with web search — measured at 17 to 73 seconds —
 * and the POST that starts it now waits for it. **The outcome is written to
 * `research_run` before the response is sent**, which is the property that
 * matters: this page polls that table, so a run whose response never arrived
 * (a phone locking, a tab closing, a flaky connection) still shows up here as a
 * finished run. What is *not* true any more is that a lookup started here
 * survives indefinitely on its own — see `lib/details-run.ts` for the thirty
 * seconds of grace it gets, and why the request is held open instead.
 *
 * A run that dies with no outcome recorded is closed as an error on the next
 * poll rather than sitting at `running` for ever, so the driver below can never
 * be left waiting on something that is not coming back.
 *
 * ## One at a time, still
 *
 * Not a throughput decision — a money one. Each row is a paid call, the running
 * total is visible as it goes, and stopping half way leaves the games it
 * already did filled in. It is also what keeps the server side inside the
 * 50-subrequest ceiling without any batching arithmetic: one item is one
 * invocation, about eight subrequests (see `lib/details-run.ts`).
 */

/** Slow enough not to be a nuisance, quick enough that a run feels live. */
const POLL_MS = 2500;

/** Still working. The two statuses that will change on their own. */
const isActive = (run: DetailsRun | undefined): boolean =>
  run != null && (run.status === 'queued' || run.status === 'running');

export function DetailsQueuePage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.needsDetails(), []);
  const [runs, setRuns] = useState<Record<number, DetailsRun>>({});
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /**
   * Lookups whose POST has not come back yet.
   *
   * Load-bearing, and the reason is easy to miss: the POST now *waits* for its
   * lookup, so for the 20–70 seconds it is in flight there is no `running` row
   * in `runs` to notice. Without this counter the driver below would see
   * "nothing active", start the next game, and keep going — firing the whole
   * queue off in parallel, which is exactly what the one-at-a-time rule exists
   * to prevent and what the 50-subrequest ceiling punishes.
   */
  const [inFlight, setInFlight] = useState<ReadonlySet<number>>(new Set());

  const items: NeedsDetails[] = state.state === 'ok' ? state.data.items : [];
  const anyActive = inFlight.size > 0 || Object.values(runs).some((r) => isActive(r));

  const loadRuns = useCallback(async () => {
    try {
      const { runs: fetched } = await api.detailsRuns();
      const byItem: Record<number, DetailsRun> = {};
      for (const run of fetched) byItem[run.itemId] = run;
      setRuns(byItem);
    } catch {
      // A dropped poll is not worth an error box; the next one is 2.5s away.
    }
  }, []);

  // The outcome of anything that ran before this page was opened — including a
  // run started in a tab that has since been closed. This is what makes
  // navigating away safe rather than merely survivable.
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useInterval(() => void loadRuns(), POLL_MS, anyActive);

  /**
   * Ask for one game, exactly once.
   *
   * `startedRef` is the same guard the scan queue uses for its chunks: a set of
   * things already asked for, consulted before asking. Without it the driver
   * below would re-fire on every poll during the second or two between the POST
   * returning and the run appearing in the polled list, and buy the same answer
   * several times over.
   */
  const startedRef = useRef<Set<number>>(new Set());

  const start = useCallback(
    async (itemId: number) => {
      startedRef.current.add(itemId);
      setInFlight((s) => new Set(s).add(itemId));
      try {
        const { run } = await api.startItemDetails(itemId);
        setRuns((r) => ({ ...r, [itemId]: run }));
      } catch (err) {
        setError(err);
        startedRef.current.delete(itemId);
        // The request failed, but the lookup behind it may not have: the server
        // registers the work with `waitUntil` before answering, so a dropped
        // connection can still end in a finished run. Ask the table rather than
        // assuming, or the next press would buy the same answer twice.
        void loadRuns();
      } finally {
        setInFlight((s) => {
          const next = new Set(s);
          next.delete(itemId);
          return next;
        });
      }
    },
    [loadRuns],
  );

  /**
   * Work down the list, one game at a time.
   *
   * Driven by observed state rather than by a loop: it starts the next game only
   * when nothing is in flight, so a run that outlives a reload is not raced by a
   * second one, and "Stop" takes effect after the current lookup instead of
   * abandoning a call already paid for.
   */
  useEffect(() => {
    if (!running) return;
    if (stopping) {
      if (!anyActive) setRunning(false);
      return;
    }
    if (anyActive) return;

    const next = items.find(
      (i) => !startedRef.current.has(i.id) && runs[i.id] === undefined,
    );
    if (!next) {
      setRunning(false);
      return;
    }
    void start(next.id);
  }, [running, stopping, anyActive, items, runs, start]);

  const retry = useCallback(
    (itemId: number) => {
      startedRef.current.delete(itemId);
      setRuns((r) => {
        const next = { ...r };
        delete next[itemId];
        return next;
      });
      void start(itemId);
    },
    [start],
  );

  const canRun = me.capabilities.includes('runResearch');
  if (!canRun) {
    return <p className="muted">Only owners can look up game details.</p>;
  }
  if (state.state === 'loading') return <Spinner label="Finding games with blanks..." />;
  if (state.state === 'error') {
    return <ErrorBox error={state.error} what="Could not load the list" />;
  }

  const cents = state.data.centsEach;
  const outstanding = items.filter((i) => runs[i.id] === undefined);
  // From the runs themselves, so the figure is the same after a reload as it
  // was before one — it is the database's answer, not this tab's memory.
  const spentCents = items.reduce((sum, i) => sum + (runs[i.id]?.estimatedCents ?? 0), 0);

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
          {/* This paragraph used to promise that closing the tab cost nothing.
              It was not true: the server got about thirty seconds to finish
              after answering, and half of these lookups take longer, so they
              were killed without a word. Saying less, and saying it accurately,
              is worth more than the reassurance was. */}
          <p className="muted small">
            Each lookup takes twenty seconds to a minute and this page waits for it.
            Every outcome is written down as it happens, so a lookup interrupted by a
            closed tab or a locked phone usually still lands — but leaving the page
            open is the sure thing.
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
            onClick={() => {
              setError(null);
              setStopping(false);
              setRunning(true);
            }}
          >
            {running
              ? 'Working…'
              : outstanding.length === 0
                ? items.length === 0
                  ? 'All done'
                  : 'Every one already asked'
                : `Fill in ${outstanding.length} game${outstanding.length === 1 ? '' : 's'}`}
          </button>
          {running && !stopping && (
            <button type="button" className="btn btn-quiet" onClick={() => setStopping(true)}>
              Stop after this one
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={refresh} disabled={running}>
            Refresh list
          </button>
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
          // Still reachable by URL once the nav stops offering the link, so the
          // empty case has to say why it is empty rather than show a bare card.
          <p className="muted">
            Every game has a publisher, a year, a player count and a description, and
            everything filed under one reads its publisher from the game. Nothing to
            fill in.
          </p>
        ) : (
          <ul className="candidate-list">
            {items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                run={runs[item.id]}
                pending={inFlight.has(item.id)}
                busy={running}
                onFill={() => void start(item.id)}
                onRetry={() => retry(item.id)}
              />
            ))}
          </ul>
        )}

        {/* A finished game stays listed until the list is re-fetched, so what a
            lookup found is readable rather than flashing past as the row it
            describes disappears. */}
        {items.some((i) => runs[i.id] != null) && (
          <p className="muted small">
            Filled-in games stay listed until you press Refresh list.
          </p>
        )}
      </section>
    </div>
  );
}

/** One game, and whatever its lookup has to say for itself. */
function QueueRow({
  item,
  run,
  pending,
  busy,
  onFill,
  onRetry,
}: {
  item: NeedsDetails;
  run: DetailsRun | undefined;
  /** This row's POST is still open. There is no run row to show yet. */
  pending: boolean;
  busy: boolean;
  onFill: () => void;
  onRetry: () => void;
}) {
  const active = pending || isActive(run);
  const failed = !pending && run?.status === 'error';

  return (
    <li className="candidate">
      {run && !active && (
        <span className="shelf-outcome" aria-hidden="true">{failed ? '!' : '✓'}</span>
      )}
      <div className="candidate__body">
        <strong>
          <Link to={`/items/${item.id}`}>{item.name}</Link>
        </strong>
        <span className="muted small">missing: {item.missing.join(', ')}</span>

        {active && <span className="muted small">Looking it up on the web…</span>}

        {run?.status === 'done' && (
          <span className="muted small">
            {run.filled.length > 0
              ? `Filled ${run.filled.join(', ')}.`
              : (run.detail ?? 'Nothing new found.')}
          </span>
        )}

        {failed && (
          <span className="muted small">{run?.errorMessage ?? 'The lookup failed.'}</span>
        )}
      </div>

      {active && <Spinner label="" />}

      {!run && !pending && (
        <button
          type="button"
          className="btn btn-quiet btn-xs"
          disabled={busy}
          onClick={onFill}
        >
          Fill this one
        </button>
      )}

      {/* Offered on a finished run too, not only a failed one. A game still on
          this list after a completed run is one the lookup could not fully
          answer — the run is a fact about the past, and it must not silently
          bar the row from ever being asked again. */}
      {run && !active && (
        <button
          type="button"
          className="btn btn-quiet btn-xs"
          disabled={busy}
          onClick={onRetry}
        >
          {failed ? 'Try again' : 'Look again'}
        </button>
      )}
    </li>
  );
}

function formatCents(cents: number): string {
  return cents < 100 ? `${Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}
