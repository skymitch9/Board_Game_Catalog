/**
 * Fill in missing details on a schedule, instead of waiting to be asked.
 *
 * Owner ask 2026-08-16: *"can we make missing details auto fire the look up
 * every hour if there is missing details, obviously skipping ones it cant
 * finish?"*
 *
 * ## Why this is small, and why that is the point
 *
 * Almost everything this needs already exists and is already careful:
 *
 * - `listItemsNeedingDetails()` is the queue, and it **converges on its own**.
 *   It excludes per FIELD rather than per item, never re-asks unless an input
 *   changed, and skips rows a fact cannot exist for. So an item that has been
 *   asked leaves the queue and stays gone.
 * - A lookup that cannot identify the game finishes `done` with a sentence,
 *   **not** `error` — a deliberate decision recorded in `runDetailsLookup`,
 *   because offering a retry guaranteed to cost the same money and return the
 *   same nothing is worse than useless.
 *
 * Between them, "skip the ones it can't finish" is already true: an unanswerable
 * row is asked once, answered "not found", and never picked up again. This
 * sweep adds the clock and nothing else. If that ever stops being true, the bug
 * is in the queue predicate, not here.
 *
 * ## What this deliberately does NOT do
 *
 * ⚠️ **It does not drain the queue.** Each lookup costs real money
 * (`ENRICH_CENTS_EACH`, ~1.4¢), and an unbounded hourly sweep against a fresh
 * import of several hundred rows would spend the lot before anyone saw a bill.
 * `SWEEP_LIMIT` caps each tick; the queue converges over hours instead of in
 * one go, which for a household catalog is the same outcome without the cliff.
 *
 * ⚠️ **And the cap is NOT only about money — it is the subrequest budget.**
 * See `SUBREQUEST_*` below. The 2026-08 audit's finding 1 was that this loop
 * shared ONE scheduled invocation between eight lookups at ~11 subrequests
 * each, ~88 against a ceiling of 50: the invocation is *terminated* rather than
 * throwing, so the tail of the sweep died in silence while the rows it had
 * already paid Claude for looked like the whole tick. The cap is now derived
 * from that arithmetic instead of chosen, so raising it means changing the
 * arithmetic in front of you.
 *
 * ⚠️ **It does not retry errors.** A run that ends `error` (network, model
 * outage) leaves the item's fields unanswered, so the queue offers it again
 * naturally on a later tick — no retry bookkeeping here, and no tight loop
 * either, because the cap bounds every tick regardless.
 *
 * ⚠️ **It never throws.** It is called from `scheduled()` under `waitUntil`,
 * where an exception is invisible: no user, no response, and — measured on
 * 2026-08-13 — scheduled logs that three separate `wrangler tail` attempts
 * could not read. Everything is caught and summarised into the return value,
 * which is logged as one line.
 */
import { claimDetailsRun, runDetailsLookup } from './details-run.js';
import { listItemsNeedingDetails } from '@bgc/db';
import type { Env } from '../env.js';

/**
 * A Worker gets 50 subrequests per invocation on the free plan, and every D1
 * call counts alongside every fetch. ⚠️ **Exceeding it TERMINATES the
 * invocation rather than throwing** — no exception, no `catch`, no log line —
 * which is why this number is written down rather than assumed.
 */
export const SUBREQUEST_CAP = 50;

/**
 * What one row of this sweep costs, counted call by call (2026-08 audit
 * finding 1, re-counted against the code 2026-09-05):
 *
 * | Step | Subrequests |
 * |---|---|
 * | `claimDetailsRun` — `closeStaleDetailsRuns`, `activeDetailsRun`, `detailsRunInputs`, `createRun` | 4 |
 * | `runDetailsLookup` — `getItem` | 1 |
 * | the Claude call (one stream; server-side search runs on Anthropic's side) | 1–2 |
 * | `updateItem` — read, write, read back | 3 |
 * | `finishRun` | 1 |
 * | **total, worst case** | **11** |
 *
 * ⚠️ None of these is batched. `details-run.ts`'s own header budgets **~8** for
 * one run and it is right about the half it counts — it does not count
 * `claimDetailsRun`, which the *route* pays for separately. This constant is
 * the whole per-row cost as the sweep pays it, which is the number that
 * matters when rows share an invocation.
 */
export const SUBREQUESTS_PER_ITEM = 11;

/**
 * What the tick spends outside the loop: `listItemsNeedingDetails` (1 D1) and
 * `fetchSystemDenied`'s door fetch (1, whenever `BILLING_POLICY` is not `off`).
 * Two are real; the third is slack, because a miscount here is silent.
 */
export const SUBREQUEST_RESERVE = 3;

/**
 * Items per tick — **derived, not chosen**.
 *
 * Hourly, so this is also the per-hour ceiling: 4 rows is ~6¢/hour at the very
 * worst, and only while a backlog exists — the queue empties and the cost goes
 * to zero on its own. It was 8 until 2026-09-05, which was over the subrequest
 * ceiling above (8 × 11 + 3 = 91) and died silently mid-tick once a backlog
 * existed; 4 × 11 + 3 = 47 fits.
 *
 * ⚠️ **Still a constant rather than an env var**, and that is unchanged: *a
 * knob nobody tunes is a knob that hides its value*, and the settled answer to
 * the billing design's §9 Q2 (`docs/DONE.md`) is that this number is a
 * ceiling, not a lever. What changed is that it is now computed from the two
 * facts that bound it, so raising it is a lie you have to write down.
 *
 * ⚠️ **If you want more rows per hour, the fix is not this number** — it is
 * batching the D1 calls in `claimDetailsRun`/`updateItem` so
 * `SUBREQUESTS_PER_ITEM` genuinely falls, or a second cron so the rows do not
 * share an invocation. The queue converging over hours is the design.
 */
export const SWEEP_LIMIT = Math.floor((SUBREQUEST_CAP - SUBREQUEST_RESERVE) / SUBREQUESTS_PER_ITEM);

/**
 * ⚠️ Must match `wrangler.toml`'s `crons` entry EXACTLY — `scheduled()`
 * dispatches on the string. Minute 7 rather than 0 on purpose: every cron in
 * the world fires at :00, and this one has no reason to join the stampede.
 */
export const DETAILS_SWEEP_CRON = '7 * * * *';

export interface SweepResult {
  queued: number;
  attempted: number;
  filled: number;
  notFound: number;
  errored: number;
  skipped: string[];
}

export async function runDetailsSweep(env: Env, limit = SWEEP_LIMIT): Promise<SweepResult> {
  const result: SweepResult = {
    queued: 0, attempted: 0, filled: 0, notFound: 0, errored: 0, skipped: [],
  };

  // ⚠️ The parameter is a convenience for tests and for a smaller tick; it is
  // NOT a way past the subrequest ceiling. A caller asking for more rows than
  // one invocation can pay for gets the ceiling and a line saying so, because
  // the alternative is an invocation terminated mid-row with nothing logged
  // anywhere — the audit's finding 1, which was invisible for months.
  const capped = Math.min(limit, SWEEP_LIMIT);
  if (capped < limit) {
    result.skipped.push(`limit ${limit} capped to ${capped} by the subrequest budget`);
  }

  // No key, no sweep — and say so once, rather than failing eight times.
  if (!env.ANTHROPIC_API_KEY) {
    result.skipped.push('no ANTHROPIC_API_KEY');
    return result;
  }

  let items;
  try {
    items = await listItemsNeedingDetails(env.DB, capped);
  } catch (err) {
    result.skipped.push(`queue read failed: ${(err as Error).message}`);
    return result;
  }
  result.queued = items.length;
  if (!items.length) return result; // The normal, quiet case.

  for (const item of items) {
    try {
      // `triggeredBy: null` — nobody pressed anything. The run row's own
      // `triggered_by` being null is how the history distinguishes a sweep
      // from a person, without inventing a second column for it.
      const { run, alreadyRunning } = await claimDetailsRun(env.DB, item.id, null);
      if (alreadyRunning) {
        // Someone is looking at this row right now. Theirs wins; the sweep
        // simply steps over it and will see it again next hour if it is still
        // unanswered.
        result.skipped.push(`#${item.id} already running`);
        continue;
      }
      result.attempted += 1;
      const finished = await runDetailsLookup(env, run.id, item.id);
      if (!finished) {
        result.errored += 1;
      } else if (finished.status === 'error') {
        result.errored += 1;
      } else if (finished.result && Object.keys(finished.result.filled ?? {}).length > 0) {
        result.filled += 1;
      } else {
        // `done` with nothing filled = "could not identify this game". An
        // answer, not a failure — and the queue will not offer it again.
        result.notFound += 1;
      }
    } catch (err) {
      // One bad row must not end the sweep; the rest of the tick still runs.
      result.errored += 1;
      result.skipped.push(`#${item.id}: ${(err as Error).message}`);
    }
  }

  return result;
}
