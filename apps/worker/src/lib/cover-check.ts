import {
  countUncheckedCovers,
  listCoverUrlsToCheck,
  recordCoverChecks,
  type CoverProbeResult,
} from '@bgc/db';
import type { CoverCheckRun, CoverOutcome } from '@bgc/core';

/**
 * Are the cover images still there?
 *
 * Every `item.thumbnail_url` is a hotlink to somebody else's CDN — BoardGameGeek
 * for the catalogued games, Kickstarter and Gamefound for the pledges. None of
 * them promised to keep serving those files, and when one stops the failure is
 * completely silent: the card renders, the image slot is empty, and nobody
 * revisits a game they already catalogued.
 *
 * This runs on a schedule and writes verdicts down. Checking on page load was
 * never an option — four hundred-odd items means four hundred requests to draw
 * one screen, aimed at exactly the CDNs we depend on staying friendly.
 */

/**
 * A Worker gets 50 subrequests per invocation on the free plan, and **every D1
 * call counts alongside every fetch**. ⚠️ Exceeding it TERMINATES the
 * invocation rather than throwing — no exception, no `catch`, no log line —
 * which is why this number is written down rather than assumed.
 *
 * The same constant, for the same reason, is in `lib/details-sweep.ts`.
 */
export const SUBREQUEST_CAP = 50;

/**
 * What one URL costs: a HEAD, plus a ranged GET when the host refuses HEAD
 * (403/405/501). See `probe()` — the second call is the whole reason this is 2
 * and not 1, and it is not rare: imgix-style resizers do it routinely.
 */
export const SUBREQUESTS_PER_URL = 2;

/**
 * What a run spends **outside** the probe loop, counted call by call
 * (2026-08 audit finding 5, re-counted against the code 2026-09-06):
 *
 * | Step | Subrequests |
 * |---|---|
 * | `listCoverUrlsToCheck` | 1 |
 * | `recordCoverChecks` — one `db.batch()` for the whole run | 1 |
 * | `countUncheckedCovers` | 1 |
 * | slack | 1 |
 * | **total** | **4** |
 *
 * 🔴 **The middle row is the fix.** Until 2026-09-06 the verdicts were written
 * in a loop — one D1 subrequest per URL — so this "reserve" was not a constant
 * at all, it grew with the batch size: 1 + 20 + 1 = 22, and the old comment
 * over `COVER_BATCH` budgeted only the fetches and called it "headroom for the
 * D1 calls". Worst case was 40 + 22 = 62 against a ceiling of 50. Latent only
 * because `cf.geekdo-images.com` answers HEAD 2xx, which kept the real cost
 * near 42.
 *
 * ⚠️ The route's own `coverHealth()` read is deliberately NOT in here: it runs
 * after `runCoverCheck` returns but inside the same invocation, and it is what
 * the slack row is for.
 */
export const SUBREQUEST_RESERVE = 4;

/**
 * URLs probed per invocation — **derived, not chosen**.
 *
 * floor((50 − 4) / 2) = **23**. The catalog is covered by rotation, not by one
 * big run, so this is a per-tick slice rather than a target.
 *
 * ⚠️ **If you want more URLs per tick, this number is not the lever.** It is
 * `SUBREQUESTS_PER_URL` (drop the ranged-GET fallback, and lose the hosts that
 * refuse HEAD) or a second cron so the URLs do not share an invocation.
 * Raising it by hand is a lie you would have to write down here.
 */
export const COVER_BATCH = Math.floor((SUBREQUEST_CAP - SUBREQUEST_RESERVE) / SUBREQUESTS_PER_URL);

/** Long enough for a slow CDN, short enough that a full batch fits in a run. */
const TIMEOUT_MS = 8000;

/** How many probes run at once. Politeness, and it keeps the run under a minute. */
const CONCURRENCY = 5;

/**
 * A plain browser-ish identity.
 *
 * Some CDNs answer an unrecognised agent with 403, which would read here as a
 * broken image when the same file loads perfectly in the app. Asking as a
 * browser asks removes the most common false positive.
 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; BoardGameCatalog/1.0; +https://board-game-catalog.bgc-worker.workers.dev)',
  Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
};

/**
 * Codes that mean the URL itself will never work again.
 *
 * **400 is in this list, and it is the one that matters.**
 * `cf.geekdo-images.com` — where nearly every cover in this catalog lives —
 * answers a path it cannot resolve with **400 Bad Request, never 404**.
 * Measured, not assumed: a nonsense path, a real path with a wrong picture id,
 * and a real picture id behind a wrong signature all came back 400. A checker
 * that looked only for 404 would have run happily for months and flagged
 * nothing, which is a worse failure than not having one.
 *
 * The rule underneath: these are the codes about the *request being
 * permanently unacceptable*. Retrying cannot change any of them. 401, 403, 405
 * and 429 are deliberately absent — those are about the *client*, and are far
 * more often a CDN objecting to a Worker than a file that has gone. Calling
 * them dead would fill the banner with covers that display perfectly in a
 * browser.
 *
 * `ksr-ugc.imgix.net` answers 410 for a removed asset, which this already
 * covers.
 */
const PERMANENT = new Set([400, 404, 410, 414]);

function classify(status: number): CoverOutcome {
  if (status >= 200 && status < 400) return 'ok';
  if (PERMANENT.has(status)) return 'dead';
  return 'error';
}

/**
 * Ask whether one URL still resolves, as cheaply as the host allows.
 *
 * HEAD first: it costs no bandwidth and every well-behaved image host supports
 * it. Some do not — imgix-style resizers and a few WAFs answer 405, 501 or 403
 * to a HEAD they would have served as a GET — so those fall back to a GET
 * asking for a single byte, which proves the file exists without downloading a
 * cover.
 */
async function probe(url: string): Promise<CoverProbeResult> {
  const head = await request(url, { method: 'HEAD' });
  if (head.outcome === 'ok' || head.outcome === 'dead') return { ...head, url };

  const refusedHead =
    head.statusCode === 403 || head.statusCode === 405 || head.statusCode === 501;
  if (!refusedHead) return { ...head, url };

  const ranged = await request(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  return { ...ranged, url };
}

async function request(
  url: string,
  init: { method: string; headers?: Record<string, string> },
): Promise<Omit<CoverProbeResult, 'url'>> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { ...HEADERS, ...init.headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { outcome: classify(res.status), statusCode: res.status, error: null };
  } catch (err) {
    // No status code at all: DNS failure, connection reset, timeout. Deliberately
    // not `dead` — we learned nothing about the file, only about the network.
    return {
      outcome: 'error',
      statusCode: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run `worker` over `items`, at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * One slice of the catalog: probe, record, report.
 *
 * Called by the cron trigger and by the manual route. Both want the same thing,
 * and having one implementation is the reason a forced check proves the
 * scheduled one works.
 */
export async function runCoverCheck(db: D1Database, limit = COVER_BATCH): Promise<CoverCheckRun> {
  // ⚠️ The parameter is a convenience for a smaller slice and for tests; it is
  // NOT a way past the subrequest ceiling. A caller asking for more than one
  // invocation can pay for gets the ceiling and a line saying so, because the
  // alternative is an invocation terminated mid-run with nothing written
  // anywhere — the audit's finding 5, and the reason `capped` exists.
  const capped = Math.min(limit, COVER_BATCH);

  const urls = await listCoverUrlsToCheck(db, capped);
  const results = await pool(urls, CONCURRENCY, probe);

  // Written after all the fetching rather than interleaved, and in ONE `batch`
  // rather than a loop: the loop spent a subrequest per URL, which is what put
  // this run over the ceiling. See `recordCoverChecks`.
  await recordCoverChecks(db, results);

  return {
    checked: results.length,
    ok: results.filter((r) => r.outcome === 'ok').length,
    dead: results.filter((r) => r.outcome === 'dead').length,
    errors: results.filter((r) => r.outcome === 'error').length,
    unchecked: await countUncheckedCovers(db),
    ...(capped < limit
      ? { capped: `limit ${limit} capped to ${capped} by the subrequest budget` }
      : {}),
  };
}
