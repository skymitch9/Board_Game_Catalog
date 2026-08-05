import { BggError, things } from '@bgc/bgg';
import {
  addBggEditions,
  countItemsNeedingBggEditions,
  listItemsNeedingBggEditions,
} from '@bgc/db';
import type { EditionBackfillRun } from '@bgc/core';

/**
 * Fill in the printings BoardGameGeek knows about.
 *
 * The `edition` table has existed since migration 0001 and the BGG client has
 * always requested `versions=1`, but the catalog was populated by
 * `POST /api/bgg/match/:id` and direct pledge inserts — neither of which writes
 * editions. The machinery was built and then bypassed, so the table sat empty
 * and the cover picker had nothing to pick between.
 *
 * This is a route rather than a script because it needs re-running: items keep
 * gaining a `bgg_id`, from scans and from manual matching, and each one that
 * does has printings nobody has asked about yet.
 */

/**
 * BGG ids per `/thing` request.
 *
 * `things()` takes a comma-separated list, so ten items cost one request rather
 * than ten — which is the whole reason a run of the entire catalog fits inside a
 * Worker invocation at all. Ten and not fifty because `versions=1` makes each
 * response large, and one oversized response failing would lose ten items'
 * worth of work instead of a few.
 */
export const BACKFILL_BATCH = 10;

/**
 * Items per run.
 *
 * A Worker gets 50 subrequests per invocation on the free plan. Eight batches is
 * eight requests in the happy case; BGG answers `202 Accepted` to mean "queued,
 * ask again" and the client retries up to four times, so the worst case is 40 —
 * inside the ceiling with room for the D1 traffic. Raise this and do the
 * arithmetic again.
 */
export const BACKFILL_LIMIT = 80;

export interface BackfillOptions {
  /** Cap on items considered this run. */
  limit?: number;
  /** Re-fetch items whose printings are already recorded. */
  force?: boolean;
  /** Just this one item — what the per-item "Look up printings" button calls. */
  itemId?: number | null;
}

export async function runEditionBackfill(
  db: D1Database,
  token: string,
  opts: BackfillOptions = {},
): Promise<EditionBackfillRun> {
  const limit = Math.min(opts.limit ?? BACKFILL_LIMIT, BACKFILL_LIMIT);
  const wanted = await listItemsNeedingBggEditions(db, {
    limit,
    force: opts.force ?? false,
    itemId: opts.itemId ?? null,
  });

  const run: EditionBackfillRun = {
    itemsConsidered: wanted.length,
    itemsUpdated: 0,
    editionsAdded: 0,
    bggCalls: 0,
    remaining: 0,
    failures: [],
  };

  for (let i = 0; i < wanted.length; i += BACKFILL_BATCH) {
    const slice = wanted.slice(i, i + BACKFILL_BATCH);

    let found;
    try {
      // The client serialises and spaces its own requests (MIN_GAP_MS), so
      // there is no second throttle here — a second one would only be a second
      // thing to get wrong.
      found = await things(token, slice.map((w) => w.bggId));
      run.bggCalls += 1;
    } catch (err) {
      const detail = err instanceof BggError ? err.message : String(err);
      for (const w of slice) run.failures.push({ itemId: w.id, bggId: w.bggId, detail });
      // A token or rate-limit problem will fail every remaining batch the same
      // way; stopping keeps the report honest instead of burying one cause
      // under eighty identical lines.
      if (err instanceof BggError && (err.status === 502 || err.status === 429)) break;
      continue;
    }

    const byId = new Map(found.map((f) => [f.bggId, f]));

    for (const w of slice) {
      const thing = byId.get(w.bggId);
      if (!thing) {
        run.failures.push({
          itemId: w.id,
          bggId: w.bggId,
          detail: `BoardGameGeek returned nothing for ${w.bggId} — the entry may have been merged or removed.`,
        });
        continue;
      }
      const added = await addBggEditions(db, w.id, thing.editions);
      run.editionsAdded += added;
      if (added > 0) run.itemsUpdated += 1;
    }
  }

  run.remaining = await countItemsNeedingBggEditions(db);
  return run;
}
