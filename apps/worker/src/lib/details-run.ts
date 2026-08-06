/**
 * "Fill in missing details" — one game, one Claude call, one run row.
 *
 * ## Where this work runs, and the mistake that is worth not repeating
 *
 * Three designs, in order:
 *
 * 1. **Awaited inside the request.** Correct, but nothing held the answer: a
 *    connection dropping mid-call paid for the search and lost it.
 * 2. **Handed to `executionCtx.waitUntil`.** This is the one that broke. A
 *    `waitUntil` task is only allowed to run for about thirty seconds *after
 *    the response is returned*, and the route returns in 0.25s — so the whole
 *    lookup was living on that budget. Measured, a lookup takes **17 to 73
 *    seconds**. Roughly half of them were cancelled, and the cancellation is
 *    silent: no exception, nothing reaches the `catch`, and the row stays
 *    `running` for ever. Production said so plainly in `wrangler tail` —
 *
 *      (warn) waitUntil() tasks did not complete within the allowed time
 *      after invocation end and have been cancelled.
 *
 *    — while `research_run` id 3 sat at `running` for eleven hours. Two of the
 *    three trial runs died this way, which is why the bulk fill was never run.
 * 3. **Awaited inside the request *and* registered with `waitUntil`.** What it
 *    does now. Awaiting means the invocation has not ended, so the thirty-second
 *    budget never starts and a 70-second lookup is fine; registering the same
 *    promise with `waitUntil` means that if the caller *does* vanish, the work
 *    still gets that budget to finish and write itself down instead of being
 *    dropped on the floor. The failure of (1) and the failure of (2) are covered
 *    by the same promise.
 *
 * Three things now guarantee a run cannot go quiet, and they are deliberately
 * layered because each catches what the one before it cannot:
 *
 * | Guard | Catches |
 * |---|---|
 * | `ENRICH_TIMEOUT_MS` aborts the Claude call | a lookup that runs away — it throws, so it is recorded |
 * | the `catch` below | anything thrown, from anywhere |
 * | `closeStaleDetailsRuns` on read | the invocation being killed outright, when no code of ours gets to run at all |
 *
 * ## Subrequest arithmetic
 *
 * A Worker gets 50 subrequests per invocation and every D1 call counts
 * alongside every fetch. Exceeding it *terminates* the invocation rather than
 * throwing — which is what killed shelf enrichment and left jobs looking busy
 * for twenty minutes. One details run costs:
 *
 * | Step | Subrequests |
 * |---|---|
 * | read the item | 1 |
 * | the Claude call (one stream; server-side search runs on Anthropic's side) | 1–2 |
 * | `updateItem` — read, write, read back | 3 |
 * | finish the run | 1 |
 * | **total** | **~8** |
 *
 * One item per invocation, so this is comfortably inside the ceiling and there
 * is nothing to chunk. **If a "fill in these ten" path is ever added, it must
 * not share an invocation**: ten of these is ~80, past the cap, and the failure
 * would be silent. The queue page drives the list one game at a time from the
 * browser for that reason — and now that each POST waits for its own answer,
 * that page *is* the bulk mechanism.
 */

import { FILLED_FIELD_LABEL, FILL_FIELDS, detailGaps, type DetailsRun } from '@bgc/core';
import {
  activeDetailsRun,
  closeStaleDetailsRuns,
  createRun,
  detailsRunInputs,
  finishRun,
  getItem,
  updateItem,
  type ResearchRun,
} from '@bgc/db';
import { RESEARCH_MODEL, enrichItem, estimateCents, fieldsToFill } from '@bgc/research';
import type { Env } from '../env.js';

/**
 * The run row as the browser sees it: money and outcome, no plumbing.
 *
 * `estimatedCents` is computed here rather than in the page, because what a
 * model costs is not something a browser should hold an opinion about — and
 * because the queue's running total has to keep meaning the same thing after a
 * reload, when the numbers come from the database rather than from the response
 * that produced them.
 */
export function toDetailsRun(run: ResearchRun): DetailsRun {
  const input = run.inputTokens ?? 0;
  const output = run.outputTokens ?? 0;

  // Deduplicated and in the order the fields are reported, so a run that filled
  // both player counts says "players" once rather than twice, and two runs that
  // filled the same things read identically.
  const filledKeys = Object.keys(run.result?.filled ?? {});
  const labels: string[] = [];
  for (const field of FILL_FIELDS) {
    if (!filledKeys.includes(field)) continue;
    const label = FILLED_FIELD_LABEL[field] ?? field;
    if (!labels.includes(label)) labels.push(label);
  }

  return {
    id: run.id,
    itemId: run.itemId,
    status: run.status,
    errorMessage: run.errorMessage,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    estimatedCents: estimateCents(input, output),
    filled: labels,
    detail: run.result?.detail ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/**
 * Claim this item for a lookup, or report the one already running.
 *
 * The queue page polls, and an unguarded route would let a poll that lands
 * mid-lookup start a second Claude call for the same game — money spent twice
 * for one answer. Anything that has gone quiet is swept to `error` first, so a
 * killed invocation costs one retry rather than blocking the item forever;
 * after that sweep, a run still reported as active really is one.
 */
export async function claimDetailsRun(
  db: D1Database,
  itemId: number,
  triggeredBy: number | null,
): Promise<{ run: ResearchRun; alreadyRunning: boolean }> {
  await closeStaleDetailsRuns(db);

  const existing = await activeDetailsRun(db, itemId);
  if (existing) return { run: existing, alreadyRunning: true };

  // Stamped before the call, not after: the record is of what the lookup had
  // to work from. An item edited while a run was in flight would otherwise be
  // stamped with the new value and never re-asked about it.
  const inputs = await detailsRunInputs(db, itemId);

  const run = await createRun(db, {
    itemId,
    tier: 'details',
    model: RESEARCH_MODEL,
    // Matches the `effort: 'low'` the enrichment call actually asks for. These
    // are dull, well-agreed facts; the money in this app belongs in the tiered
    // research pass, not in filling a year in.
    effort: 'low',
    triggeredBy,
    ...(inputs ? { inputs } : {}),
  });
  return { run, alreadyRunning: false };
}

/**
 * Do the lookup, write the outcome down, and hand back the finished row.
 * Never throws.
 *
 * The same promise is awaited by the route *and* registered with `waitUntil`,
 * so it must survive having no listener: an exception escaping here would leave
 * the run at `running` forever with no error recorded — the exact shape of
 * failure that made a stalled shelf indistinguishable from a working one.
 * Everything is funnelled into `finishRun`, whose row is the return value, so
 * the caller reports what the database says rather than what it hoped.
 *
 * "That game could not be identified" is **not** an error. It is an answer, and
 * a run that reaches it is `done` with a sentence explaining itself; treating it
 * as a failure would offer a retry that is guaranteed to cost the same money and
 * return the same nothing.
 */
export async function runDetailsLookup(
  env: Env,
  runId: number,
  itemId: number,
): Promise<ResearchRun | null> {
  try {
    const item = await getItem(env.DB, itemId);
    if (!item) {
      return await finishRun(env.DB, runId, {
        status: 'error',
        errorMessage: 'That game was deleted while the lookup was running.',
      });
    }

    const { fields, usage } = await enrichItem(env.ANTHROPIC_API_KEY, {
      name: item.name,
      yearPublished: item.yearPublished,
      bggId: item.bggId,
      publisher: item.publisher,
    });

    // What this row was asked for, decided by the one policy that decides it.
    // Recorded so the queue can exclude *these fields* next time rather than
    // the whole item — a run that found a publisher and no playing time must
    // not put the row back to be asked for the publisher it already has.
    const asked = detailGaps(item);

    if (fields.notFound) {
      return await finishRun(env.DB, runId, {
        status: 'done',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        unfilled: asked,
        result: {
          filled: {},
          detail: fields.note ?? 'That game could not be identified confidently.',
        },
      });
    }

    // Gaps only, and only fields this kind of row can have. Anything already
    // recorded is left alone, because a value someone typed is better evidence
    // than one a model found; anything impossible is dropped whatever the model
    // returned, because the model is asked the same six questions about a dice
    // tray as about a game. `fillableFieldsFor` in `packages/core/src/details.ts`
    // is the one place that decides.
    const patch = fieldsToFill(item, fields);
    if (Object.keys(patch).length > 0) await updateItem(env.DB, itemId, patch);

    return await finishRun(env.DB, runId, {
      status: 'done',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      unfilled: asked.filter((field) => !(field in patch)),
      result: {
        filled: patch,
        detail: Object.keys(patch).length > 0 ? null : 'Nothing new found.',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await finishRun(env.DB, runId, { status: 'error', errorMessage: message }).catch(
      () => {
        // The database is the only place left to report to. If that is gone too
        // there is nothing useful to do but stop.
        return null;
      },
    );
  }
}
