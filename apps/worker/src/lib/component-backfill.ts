import { BggError, MAX_THING_IDS, things } from '@bgc/bgg';
import {
  classifyComponents,
  componentCoverage,
  listGamesNeedingComponents,
  listUnclassifiedComponentIds,
  markComponentsUnclassifiable,
  recordGameComponents,
  recordGameNotFound,
  type ComponentLink,
} from '@bgc/db';
import type { ComponentBackfillRun } from '@bgc/core';

/**
 * Fill in what BoardGameGeek says exists for the games we own.
 *
 * Two passes, because BGG's `<link type="boardgameexpansion">` carries only an
 * id and a name:
 *
 *   1. **The game sweep.** One `/thing` call covers twenty games and yields
 *      every expansion and accessory each one links, plus the game's own
 *      publisher list. Cheap, and the only pass that can discover something
 *      new.
 *   2. **The classification sweep.** Fetch the components themselves, twenty at
 *      a time, for their publishers — the one fact that decides official versus
 *      third-party. Measured on Ark Nova: twenty-three of its twenty-four
 *      accessories are Folded Space, Laserox, e-Raptor and the like, and three
 *      of its seven "expansions" are a third party's 3D upgrades. Without this
 *      pass the completeness figure is wrong by more than it is right.
 *
 * Measured against the real collection on 2026-08-05: 83 rooted games with a
 * `bgg_id`, listing 1,148 components between them (1,120 distinct ids). Pass 1
 * is 5 calls and 5.5 seconds. Pass 2 is 56 calls if run in one go, which is why
 * it rotates.
 */

/**
 * The weekly schedule, as `wrangler.toml` writes it.
 *
 * Cloudflare hands the `scheduled` handler the cron expression verbatim, so
 * this string is what tells the two jobs apart. It lives beside the job it
 * triggers rather than in the entry point, and **must stay character-identical
 * to the entry in `[triggers] crons`** — a stray space would silently route the
 * weekly refresh into the cover check and nothing would ever say so.
 *
 * Monday 05:41 UTC. Weekly because that is the rate at which "a publisher
 * announced something for a game you own" can change and still be worth
 * hearing. Minute 41 because the cover check fires on :00 and :30 and two cron
 * invocations in the same minute would compete for the same subrequest budget.
 * Monday so the answer is waiting at the start of the week rather than going
 * stale over one.
 */
export const COMPONENT_REFRESH_CRON = '41 5 * * 1';

/**
 * BoardGameGeek ids per `/thing` request.
 *
 * Not a tuning choice — 20 is BGG's hard ceiling. A request for 36 ids answers
 * `400 Bad Request` with no partial result, which a caller would read as an
 * outage. `MAX_THING_IDS` in the client is the same number and the client
 * chunks anything larger; batching explicitly here keeps the subrequest
 * arithmetic below visible rather than hidden inside a helper.
 */
const BATCH = MAX_THING_IDS;

/**
 * BoardGameGeek calls one run may make.
 *
 * A Worker gets 50 subrequests per invocation on the free plan. The client
 * retries a `202 Accepted` up to four times, so one logical call can cost five
 * subrequests: eight calls is a worst case of 40, leaving room for D1. The same
 * arithmetic `BACKFILL_LIMIT` in `edition-backfill.ts` rests on — raise this
 * and redo it.
 */
export const RUN_BGG_CALLS = 8;

/**
 * Calls reserved for the game sweep before the rest go to classification.
 *
 * Five covers 100 games, which is every eligible game in the catalog today and
 * leaves three calls — 60 components — for classification. The split matters
 * because the two passes want opposite things: the sweep is what makes a newly
 * published expansion appear at all, so it goes first; classification is a
 * backlog that rotates and can afford to.
 *
 * Unused game calls fall through to classification, so once the weekly sweep
 * has nothing due, the whole budget goes to the backlog.
 */
const GAME_CALLS = 5;

export interface ComponentBackfillOptions {
  /** BoardGameGeek calls this run may make. Capped at `RUN_BGG_CALLS`. */
  calls?: number;
  /** Re-sweep games already checked inside the refresh window. */
  force?: boolean;
  /** One game only — what the item page's "Check now" button calls. */
  itemId?: number | null;
  /** Skip the classification pass. Used by nothing; here for a targeted re-run. */
  gamesOnly?: boolean;
}

export async function runComponentBackfill(
  db: D1Database,
  token: string,
  opts: ComponentBackfillOptions = {},
): Promise<ComponentBackfillRun> {
  const budget = Math.min(opts.calls ?? RUN_BGG_CALLS, RUN_BGG_CALLS);

  const run: ComponentBackfillRun = {
    gamesChecked: 0,
    componentsAdded: 0,
    componentsSeen: 0,
    componentsMarkedStale: 0,
    componentsClassified: 0,
    bggCalls: 0,
    gamesRemaining: 0,
    unclassifiedRemaining: 0,
    failures: [],
  };

  // ---- pass 1: what does BoardGameGeek list for these games? ---------------

  const gameCalls = opts.itemId != null ? 1 : Math.min(GAME_CALLS, budget);
  const games = await listGamesNeedingComponents(db, {
    limit: gameCalls * BATCH,
    force: opts.force ?? false,
    itemId: opts.itemId ?? null,
  });

  let fatal = false;
  for (let i = 0; i < games.length && run.bggCalls < budget; i += BATCH) {
    const slice = games.slice(i, i + BATCH);

    let found;
    try {
      // `versions=1` is what makes the edition backfill's responses large; the
      // component lists do not need it, and omitting it keeps a batch of twenty
      // games well inside a sane response size.
      found = await things(
        token,
        slice.map((g) => g.bggId),
        false,
      );
      run.bggCalls += 1;
    } catch (err) {
      const detail = err instanceof BggError ? err.message : String(err);
      run.failures.push({ detail: `game sweep: ${detail}` });
      // A token or rate-limit problem fails every remaining batch identically.
      // Stopping keeps the report readable instead of burying one cause under
      // eighty copies of itself.
      if (err instanceof BggError && (err.status === 502 || err.status === 429)) {
        fatal = true;
        break;
      }
      continue;
    }

    const byId = new Map(found.map((f) => [f.bggId, f]));

    for (const game of slice) {
      const thing = byId.get(game.bggId);
      if (!thing) {
        // Recorded, not skipped: BGG merges and removes entries, and a game
        // whose id no longer resolves must say so rather than sit forever in
        // "never checked".
        await recordGameNotFound(db, game.id);
        run.gamesChecked += 1;
        run.failures.push({
          detail: `BoardGameGeek returned nothing for ${game.bggId} — the entry may have been merged or removed.`,
        });
        continue;
      }

      const links: ComponentLink[] = thing.related.map((r) => ({
        bggId: r.bggId,
        name: r.name,
        kind: r.type,
      }));
      const result = await recordGameComponents(db, game.id, thing.publisherLinks, links);
      run.gamesChecked += 1;
      run.componentsAdded += result.added;
      run.componentsSeen += result.seen;
      run.componentsMarkedStale += result.markedStale;
    }
  }

  // ---- pass 2: who published each component? ------------------------------

  if (!fatal && !opts.gamesOnly) {
    const remainingCalls = budget - run.bggCalls;
    if (remainingCalls > 0) {
      const ids = await listUnclassifiedComponentIds(db, remainingCalls * BATCH);

      for (let i = 0; i < ids.length && run.bggCalls < budget; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        let found;
        try {
          found = await things(token, slice, false);
          run.bggCalls += 1;
        } catch (err) {
          const detail = err instanceof BggError ? err.message : String(err);
          run.failures.push({ detail: `classification: ${detail}` });
          if (err instanceof BggError && (err.status === 502 || err.status === 429)) break;
          continue;
        }

        run.componentsClassified += await classifyComponents(
          db,
          found.map((t) => ({
            bggId: t.bggId,
            publishers: t.publisherLinks,
            yearPublished: t.yearPublished,
            thumbnailUrl: t.thumbnailUrl,
          })),
        );

        // An id BoardGameGeek answered nothing for must be taken off the
        // backlog, or it takes a slot from an id that *can* be answered on
        // every run from now until someone notices. Stamped as asked-about with
        // no verdict, which leaves it counted as unclassified — honest, and
        // visible in `/api/components/status`.
        const missing = slice.filter((id) => !found.some((t) => t.bggId === id));
        if (missing.length > 0) {
          await markComponentsUnclassifiable(db, missing);
          run.failures.push({
            detail: `BoardGameGeek returned nothing for component ids ${missing.join(', ')}`,
          });
        }
      }
    }
  }

  const coverage = await componentCoverage(db);
  run.gamesRemaining = coverage.dueGames;
  run.unclassifiedRemaining = coverage.unclassifiedComponents;
  return run;
}
