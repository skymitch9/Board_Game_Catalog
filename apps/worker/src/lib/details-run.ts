/**
 * "Fill in missing details", in the background.
 *
 * ## Why this is not a request any more
 *
 * `POST /api/research/:id/details` used to `await enrichItem` inline. That is a
 * Claude call with web search — tens of seconds — held open inside an HTTP
 * request, and the owner reported it as "taking a while". It was not stuck; it
 * was synchronous. The real cost was worse than the wait: if the connection
 * dropped mid-call, the lookup was still paid for and its answer was thrown
 * away, because nothing but the response held it.
 *
 * So the work moved to `executionCtx.waitUntil` and reports through
 * `research_run` — the table built for exactly this and, until now, never
 * written to. The route answers immediately with a run id; the queue page polls
 * it. Closing the tab costs nothing.
 *
 * ## Subrequest arithmetic
 *
 * A Worker gets 50 subrequests per invocation and every D1 call counts
 * alongside every fetch. Exceeding it *terminates* the invocation rather than
 * throwing, taking `waitUntil` with it — which is what killed shelf enrichment
 * and left jobs looking busy for twenty minutes. One details run costs:
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
 * not share an invocation**: ten of these is ~80, which is past the cap, and
 * the failure would be silent. The queue page drives the list one game at a
 * time from the browser for that reason.
 */

import { FILLED_FIELD_LABEL, FILL_FIELDS, detailGaps, type DetailsRun } from '@bgc/core';
import {
  activeDetailsRun,
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
 * How long a run may sit unfinished before we call it dead.
 *
 * An enrichment call is tens of seconds, not minutes, and the only way one goes
 * quiet without recording anything is its invocation being killed — the
 * subrequest ceiling terminates rather than throws, so the `catch` below never
 * runs. Without this, one such run would block its item from ever being
 * retried, which is precisely the trap the scan queue had to be dug out of.
 */
const STALE_AFTER_MS = 5 * 60_000;

/** Has this run stopped without saying so? */
function isStale(run: ResearchRun): boolean {
  const stamp = run.startedAt ?? run.createdAt;
  // SQLite writes "YYYY-MM-DD HH:MM:SS" with no zone marker and `Date.parse`
  // reads that as local time. On a Worker local *is* UTC, but relying on the
  // runtime's zone for correctness is how this bites the day it runs anywhere
  // else, so the marker is added explicitly.
  const at = Date.parse(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
  return Number.isNaN(at) || Date.now() - at > STALE_AFTER_MS;
}

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
 * for one answer. A run that has gone quiet past `STALE_AFTER_MS` is closed as
 * an error first, so a killed invocation costs one retry rather than blocking
 * the item forever.
 */
export async function claimDetailsRun(
  db: D1Database,
  itemId: number,
  triggeredBy: number | null,
): Promise<{ run: ResearchRun; alreadyRunning: boolean }> {
  const existing = await activeDetailsRun(db, itemId);
  if (existing) {
    if (!isStale(existing)) return { run: existing, alreadyRunning: true };
    await finishRun(db, existing.id, {
      status: 'error',
      errorMessage: 'The lookup stopped before it finished. Asked again.',
    });
  }

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
 * Do the lookup and write the outcome down. Never throws.
 *
 * Handed to `waitUntil`, so nothing is listening: an exception escaping here
 * would leave the run at `running` forever with no error recorded — the exact
 * shape of failure that made a stalled shelf indistinguishable from a working
 * one. Everything is funnelled into `finishRun`.
 *
 * "That game could not be identified" is **not** an error. It is an answer, and
 * a run that reaches it is `done` with a sentence explaining itself; treating it
 * as a failure would offer a retry that is guaranteed to cost the same money and
 * return the same nothing.
 */
export async function runDetailsInBackground(
  env: Env,
  runId: number,
  itemId: number,
): Promise<void> {
  try {
    const item = await getItem(env.DB, itemId);
    if (!item) {
      await finishRun(env.DB, runId, {
        status: 'error',
        errorMessage: 'That game was deleted while the lookup was running.',
      });
      return;
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
      await finishRun(env.DB, runId, {
        status: 'done',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        unfilled: asked,
        result: {
          filled: {},
          detail: fields.note ?? 'That game could not be identified confidently.',
        },
      });
      return;
    }

    // Gaps only, and only fields this kind of row can have. Anything already
    // recorded is left alone, because a value someone typed is better evidence
    // than one a model found; anything impossible is dropped whatever the model
    // returned, because the model is asked the same six questions about a dice
    // tray as about a game. `fillableFieldsFor` in `packages/core/src/details.ts`
    // is the one place that decides.
    const patch = fieldsToFill(item, fields);
    if (Object.keys(patch).length > 0) await updateItem(env.DB, itemId, patch);

    await finishRun(env.DB, runId, {
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
    await finishRun(env.DB, runId, { status: 'error', errorMessage: message }).catch(() => {
      // The database is the only place left to report to. If that is gone too
      // there is nothing useful to do but stop.
    });
  }
}
