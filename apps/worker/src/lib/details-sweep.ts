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
 * Items per tick. Hourly, so this is also the per-hour ceiling: 8 rows is
 * ~11¢/hour at the very worst, and only while a backlog exists — the queue
 * empties and the cost goes to zero on its own.
 *
 * Deliberately a constant rather than an env var: a knob nobody tunes is a
 * knob that hides its value, and the number that matters (what an hour can
 * cost) should be readable here.
 */
export const SWEEP_LIMIT = 8;

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

  // No key, no sweep — and say so once, rather than failing eight times.
  if (!env.ANTHROPIC_API_KEY) {
    result.skipped.push('no ANTHROPIC_API_KEY');
    return result;
  }

  let items;
  try {
    items = await listItemsNeedingDetails(env.DB, limit);
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
