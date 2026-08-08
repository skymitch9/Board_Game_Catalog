/**
 * Import the other names BoardGameGeek knows our games by.
 *
 * **The knowledge already exists, upstream, for free.** BGG models a game as a
 * primary name plus a list of alternates, and `/thing` has been returning both
 * all along — the client's `primaryName()` simply dropped everything that was
 * not the title. BGG 13's alternates include *The Settlers of Catan*, which is
 * the exact string that walked into the catalog as a second game on 2026-08-07.
 * Nothing here invents an identity; it copies one down.
 *
 * **One pass, not two.** Unlike `component-backfill.ts`, there is no
 * classification step — a name needs no publisher to be judged official, and
 * whether an alias is *safe to match on* is a question about this catalog rather
 * than about BGG. That question is answered in `buildTitleIndex`, at match time,
 * where both the alias and every real name are visible at once. So this module
 * stores what BGG said, unfiltered, and never decides anything.
 *
 * The arithmetic, measured against production on 2026-08-08: **128 of 802 items
 * carry a `bgg_id`**, so 7 calls at 20 ids each covers the whole catalog. That
 * is the honest ceiling on the import — the other 674 rows have nothing to ask
 * about, and their alternate names have to come from a person typing one.
 */

import { BggError, MAX_THING_IDS, things } from '@bgc/bgg';
import { listItemsNeedingAliases, recordAliasCheck, replaceBggAliases } from '@bgc/db';

/**
 * BoardGameGeek calls one run may make.
 *
 * The same arithmetic `RUN_BGG_CALLS` in `component-backfill.ts` rests on: a
 * Worker gets 50 subrequests, the client retries a `202 Accepted` up to four
 * times, so one logical call can cost five. Eight is a worst case of 40, leaving
 * room for the D1 writes. Raise this and redo that sum.
 */
export const RUN_BGG_CALLS = 8;

export interface AliasBackfillRun {
  /** Items we asked BoardGameGeek about. */
  itemsChecked: number;
  /** Items BGG had no entry for at the id we hold. */
  itemsNotFound: number;
  /** Alternate names stored, across every item in this run. */
  aliasesStored: number;
  bggCalls: number;
  /** Set when BGG failed; whatever was written before it stays written. */
  error: string | null;
}

/**
 * Fill in alternate names for games that have a BoardGameGeek id.
 *
 * Never-asked items come first, and an item whose `bgg_id` has changed since the
 * last check is re-offered — see `listItemsNeedingAliases`. Correcting a wrong
 * id on the edit form therefore re-opens the question by itself, which matters
 * because a wrong id is precisely how a game ends up wearing another game's
 * alternate names.
 *
 * ⚠️ **Partial progress is kept on failure.** A BGG outage half way through
 * leaves the items already written with their aliases and their check rows, and
 * reports the error. The alternative — rolling back — would make a flaky
 * upstream mean the import never finishes, which is the shape that left
 * `game_component` empty for a month.
 */
export async function runAliasBackfill(
  db: D1Database,
  token: string,
  opts: { calls?: number; itemId?: number } = {},
): Promise<AliasBackfillRun> {
  const budget = Math.max(1, Math.min(opts.calls ?? RUN_BGG_CALLS, RUN_BGG_CALLS));

  const run: AliasBackfillRun = {
    itemsChecked: 0,
    itemsNotFound: 0,
    aliasesStored: 0,
    bggCalls: 0,
    error: null,
  };

  const queue = opts.itemId
    ? (await listItemsNeedingAliases(db, 10_000)).filter((i) => i.id === opts.itemId)
    : (await listItemsNeedingAliases(db, budget * MAX_THING_IDS));

  if (queue.length === 0) return run;

  for (let i = 0; i < queue.length && run.bggCalls < budget; i += MAX_THING_IDS) {
    const batch = queue.slice(i, i + MAX_THING_IDS);

    let fetched;
    try {
      // `versions: false` — editions are a different feature with its own
      // backfill, and asking for 136 Catan printings we will not read is the
      // difference between a small response and a very large one.
      fetched = await things(
        token,
        batch.map((b) => b.bggId),
        false,
      );
      run.bggCalls += 1;
    } catch (err) {
      run.error = err instanceof BggError ? err.message : String(err);
      return run;
    }

    const byBggId = new Map(fetched.map((t) => [t.bggId, t]));

    for (const item of batch) {
      const thing = byBggId.get(item.bggId);
      if (!thing) {
        // The id we hold is not a game BGG will answer for. Recorded so it is
        // not re-asked every run, and distinguishable from "asked, none exist".
        await recordAliasCheck(db, item.id, item.bggId, 0, 'not_found');
        run.itemsNotFound += 1;
        run.itemsChecked += 1;
        continue;
      }

      // The primary name is dropped here rather than at match time: it is
      // either what the item is already called, or a disagreement about the
      // item's name that belongs on the edit form, not in a silent alias.
      const alternates = thing.alternateNames.filter(
        (n) => n.trim() !== '' && n.trim() !== thing.name.trim(),
      );

      const stored = await replaceBggAliases(db, item.id, alternates);
      await recordAliasCheck(db, item.id, item.bggId, alternates.length, 'ok');
      run.aliasesStored += stored;
      run.itemsChecked += 1;
    }
  }

  return run;
}
