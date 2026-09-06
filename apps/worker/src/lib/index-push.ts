/**
 * Pushing this catalog's projection to the shared index Worker.
 *
 * Design: catalog-platform/docs/info/index-worker-design.md §5 and §7 step 2.
 * Full snapshot, PUT /api/push/game, bearer token — the index replaces this
 * source's rows wholesale, so there is no incremental state to fall behind
 * and a failed push simply leaves the previous snapshot standing.
 *
 * Three triggers, and the split is the design's:
 *
 *  1. AFTER MUTATIONS (`indexPushAfterMutation`) — a successful write under a
 *     catalog-shaped route schedules a push via `waitUntil`, so the index is
 *     fresh within seconds of the shelf changing.
 *  2. A DATA-AWARE STALENESS BACKSTOP RIDING REQUEST TRAFFIC
 *     (`indexBackstopOnRequest`) — at most once per BACKSTOP_CHECK_INTERVAL_MS
 *     per isolate, an /api/* request schedules (on `waitUntil`, after
 *     responding) one unauthenticated GET of the index's /api/health, and
 *     re-pushes if EITHER the game source is empty/older than a day OR
 *     `item.updated_at`'s high-water mark has moved past the index's last
 *     `pushed_at` (`pushIndexIfStale`, comparing against
 *     `getLatestSourceUpdateAt` — see index-projection.ts). That second
 *     condition is the 2026-08-15 fix: a clock-only staleness check cannot
 *     tell that a backfill script wrote D1 directly (bypassing every route,
 *     so no mutation push fired) — it just waited out the same 24h either
 *     way. Comparing data against data closes that class: ANY out-of-band
 *     write becomes pushable within one backstop tick of normal traffic,
 *     with no human trick required.
 *
 *     ⚠️ This REPLACES the backstop that rode the half-hourly cron, and the
 *     reason is observability, not cost. On 2026-08-13 the cron-riding
 *     backstop silently failed to push on three consecutive ticks — no
 *     `index backstop` line, no error, nothing — while a manual push with
 *     the SAME token succeeded from outside the Worker; three `wrangler
 *     tail` attempts died before catching a scheduled run in the act. A
 *     backstop nobody can watch fail is not a backstop. The request-riding
 *     shape (ported from the library: bookbuddy/library_catalog
 *     apps/worker/src/lib/index-push.ts, which built it precisely because it
 *     has no cron) is provable in seconds: `wrangler tail` + one request to
 *     /api/health shows the decision, because EVERY pass through the
 *     middleware logs one — throttled, unconfigured, fresh, pushed, or
 *     failed. The cron keeps its other duties (cover check, orphan sweep,
 *     component refresh) untouched.
 *  3. A MANUAL FORCE (`POST /api/admin/index-push`, routes/admin.ts) — gated
 *     exactly like the rest of that surface (`requireCapability('manageUsers')`
 *     + the federated-admin CORS mount), for the case a person wants the push
 *     to happen now rather than on the next backstop tick.
 *
 *     What the request-riding shape trades, stated: an untouched app pushes
 *     nothing — but an untouched app's catalog is not changing either, since
 *     every write path but one is an API route or a script that bumps
 *     `updated_at` (now covered by trigger 2).
 *
 * So a missed trigger costs at most a day of freshness (the design's stated
 * tolerance), and the ordinary path costs nothing measurable.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: the index must never be able to stall
 * this catalog. `INDEX_URL` / `INDEX_PUSH_TOKEN` unset means every trigger
 * logs one line and does nothing. No throw from here ever reaches a route.
 */

import type { MiddlewareHandler } from 'hono';
import { buildIndexProjection, getLatestSourceUpdateAt } from '@bgc/db';
import type { AppBindings, Env } from '../env.js';

/** How stale the backstop tolerates the index being before re-pushing. */
const BACKSTOP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Routes whose successful mutations can change what the projection reads
 * (`item` rows: name/kind/parent/series/year/publisher/thumbnail).
 * `/api/copies` et al are deliberately absent — ownership does not travel to
 * the index. Missing a path here is a ≤24h staleness bug, not a correctness
 * bug: the backstop exists precisely so this list does not have to be
 * perfect forever.
 */
const ITEM_TOUCHING_PREFIXES = ['/api/items', '/api/bgg', '/api/research', '/api/scan-jobs', '/api/editions'];

/**
 * The default source, used when `ESTATE_APP` is unset — the MAIN instance's.
 *
 * ⚠️ It is `game`, singular, while the estate's visibility vocabulary calls
 * this catalog `games`. That difference is real, it is the only one in the
 * estate, and `index-worker/src/search-route.ts:47` `SOURCE_FOR_CATALOG` is
 * the one place that owns it. It pairs with `DEFAULT_ESTATE_APP`'s `games`
 * deliberately: the id this Worker asserts to the directory and the source its
 * rows are filed under are two vocabularies for ONE instance, and they must
 * not be able to drift apart.
 */
const DEFAULT_INDEX_SOURCE = 'game';

/**
 * Which index source THIS instance pushes as, from `ESTATE_APP`.
 *
 * 🔴 THIS WAS A HARD-CODED `game` UNTIL 2026-09-06, AND FOR A SECOND INSTANCE
 * THAT WAS DESTRUCTIVE RATHER THAN MERELY WRONG. The index's write protocol is
 * a SNAPSHOT REPLACE keyed on `entry.source` (`index-worker-design.md` §5): a
 * push under `game` deletes every `game` row and re-inserts the body. So the
 * `[env.games2]` instance — the slot `estate-app.ts` has pre-declared since
 * 2026-09-05, and which `scripts/provision-catalog.mjs` exists to fill — would
 * have DELETED THE MAIN CATALOG'S ENTIRE INDEX SHELF on its first push, and
 * whichever instance pushed last would be the estate's whole board-game
 * collection. §11.1 makes exactly this argument for why `library2` got its own
 * source id instead of sharing `library`'s; the games side had the argument
 * written down and not the code. Ported from the library's `resolveIndexSource`
 * (`bookbuddy/library_catalog/apps/worker/src/lib/index-push.ts`), which closed
 * the same shape on 2026-09-05.
 *
 * ⚠️ NOTHING CHANGES FOR THE MAIN INSTANCE. `ESTATE_APP = "games"` and unset
 * both resolve to `game`, which is the value that was hard-coded — so this
 * ships inert and the second instance is what it is for.
 *
 * Pure, so the decision is unit-testable without a Worker environment — the
 * same shape as `decidePushForStaleness` below, and for the same reason.
 *
 *  - unset/blank → `game`, the main instance's source;
 *  - `games` → `game`, the ONE known vocabulary difference, written as a case
 *    rather than as a plural-stripping RULE: a `games2` must NOT silently
 *    become `game2`, because the index has to be taught the exact word and a
 *    guess would 404 at best and collide at worst;
 *  - any other plain lowercase path segment → itself, so a second instance
 *    federates by setting one var and its own `INDEX_PUSH_TOKEN` with no code
 *    change here — which is what `scripts/provision-catalog.mjs` now prints;
 *  - anything else → `null`, and the caller pushes NOTHING and says why.
 *
 * ⚠️ The `null` branch is not decoration. This value is interpolated into a
 * URL path, so an unvalidated var could push a snapshot at some other route
 * entirely (`../…`), and a typo'd source would create a junk shelf on a surface
 * other households can see. Refusing loudly is the inert direction, which is
 * this module's rule everywhere.
 */
export function resolveIndexSource(rawEstateApp: string | undefined): string | null {
  const v = (rawEstateApp ?? '').trim();
  if (v === '' || v === 'games') return DEFAULT_INDEX_SOURCE;
  return /^[a-z][a-z0-9]{0,31}$/.test(v) ? v : null;
}

export async function pushIndexSnapshot(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  const source = resolveIndexSource(env.ESTATE_APP);
  if (source === null) {
    // ⚠️ The VALUE is named because it is a config typo, not a secret, and the
    // person reading this log line is the person who mistyped it.
    return { skipped: `ESTATE_APP ${JSON.stringify(env.ESTATE_APP)} is not a usable index source — not pushing` };
  }

  const rows = await buildIndexProjection(env.DB);
  // The index 422s an empty snapshot ("zero rows is a failed export, not an
  // empty catalog") — don't even send one.
  if (rows.length === 0) {
    return { skipped: `projection produced zero rows — not pushing an empty snapshot (source ${source})` };
  }

  const res = await fetch(`${env.INDEX_URL}/api/push/${source}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INDEX_PUSH_TOKEN}`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`index push failed: ${res.status} ${await res.text()}`);
  }
  return { pushed: rows.length };
}

/** What `pushIndexIfStale` needs to decide, stripped of D1/fetch so the
 *  decision itself is a pure function — see `decidePushForStaleness`. */
export interface StalenessCheckInput {
  /** Row count the index reports for this source, from /api/health. */
  rows: number | null | undefined;
  /** `pushed_at` the index reports for this source, from /api/health. */
  pushedAtIso: string | null | undefined;
  /** `getLatestSourceUpdateAt(env.DB)` — epoch ms, or null if `item` is empty. */
  latestSourceUpdateMs: number | null;
  nowMs: number;
  maxAgeMs: number;
}

export type StalenessDecision = { push: boolean; reason: string };

/**
 * The gate itself, pulled out of `pushIndexIfStale` so it can be unit tested
 * without a live index or a D1 binding. Four ways to decide "push":
 *
 *  1. the index has no rows for this source (first push / wiped),
 *  2. the index's `pushed_at` is missing or unparseable,
 *  3. the last push is older than `maxAgeMs` (the original clock check), or
 *  4. ⚠️ THE FIX: `item`'s own last-modified fact is newer than the index's
 *     `pushed_at` — i.e. something changed the catalog after the index last
 *     heard from it, regardless of how young that push is. This is what
 *     catches a backfill script that wrote D1 directly ten minutes ago: the
 *     age check alone would call a five-minute-old push "fresh" and skip,
 *     exactly the bug this exists to close.
 *
 * Anything else is genuinely fresh: the index has rows, it heard from us
 * recently, and nothing has moved since.
 */
export function decidePushForStaleness(input: StalenessCheckInput): StalenessDecision {
  const { rows, pushedAtIso, latestSourceUpdateMs, nowMs, maxAgeMs } = input;

  if (!rows || rows <= 0) {
    return { push: true, reason: 'index reports zero rows for this source' };
  }

  const pushedAtMs = pushedAtIso ? Date.parse(pushedAtIso) : Number.NaN;
  if (!Number.isFinite(pushedAtMs)) {
    return { push: true, reason: 'index reported no valid pushed_at' };
  }

  const ageMs = nowMs - pushedAtMs;
  if (ageMs >= maxAgeMs) {
    return { push: true, reason: `last push is ${Math.round(ageMs / 3_600_000)}h old (>${maxAgeMs / 3_600_000}h)` };
  }

  if (latestSourceUpdateMs !== null && latestSourceUpdateMs > pushedAtMs) {
    return {
      push: true,
      reason: `source data changed at ${new Date(latestSourceUpdateMs).toISOString()}, after the last push`,
    };
  }

  return { push: false, reason: `index is fresh (${rows} rows, pushed ${pushedAtIso})` };
}

/**
 * The backstop body: one health GET, one cheap MAX(updated_at) read, push
 * only when `decidePushForStaleness` says to.
 */
export async function pushIndexIfStale(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  // ⚠️ THE BACKSTOP MUST ASK ABOUT ITS OWN SOURCE, not about `game`. Reading
  // the main catalog's row from a second instance would answer "fresh, 838
  // rows" about somebody else's shelf while this one had never pushed at all —
  // a staleness check that is confidently wrong is worse than none, because it
  // is the thing that would otherwise notice.
  const source = resolveIndexSource(env.ESTATE_APP);
  if (source === null) {
    return { skipped: `ESTATE_APP ${JSON.stringify(env.ESTATE_APP)} is not a usable index source — not checking` };
  }

  const res = await fetch(`${env.INDEX_URL}/api/health`);
  if (!res.ok) {
    throw new Error(`index health check failed: ${res.status}`);
  }
  const health = (await res.json()) as {
    sources?: Record<string, { rows?: number; pushed_at?: string | null } | undefined>;
  };
  // ⚠️ An ABSENT source is `undefined`, which `decidePushForStaleness` reads as
  // "zero rows" and answers "push" — the right answer for a source the index
  // has never heard of, and the first push is what teaches it.
  const mine = health.sources?.[source];

  const latestSourceUpdateMs = await getLatestSourceUpdateAt(env.DB);
  const decision = decidePushForStaleness({
    rows: mine?.rows,
    pushedAtIso: mine?.pushed_at,
    latestSourceUpdateMs,
    nowMs: Date.now(),
    maxAgeMs: BACKSTOP_MAX_AGE_MS,
  });

  if (!decision.push) {
    return { skipped: decision.reason };
  }
  return pushIndexSnapshot(env);
}

/**
 * After any successful item-touching mutation, schedule a snapshot push on
 * `waitUntil` — the response never waits for the index, and a push failure
 * lands in the log, not on the person saving a game.
 */
export function indexPushAfterMutation(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (c.res.status >= 400) return;
    if (!ITEM_TOUCHING_PREFIXES.some((p) => c.req.path.startsWith(p))) return;
    if (!c.env.INDEX_URL || !c.env.INDEX_PUSH_TOKEN) return; // unconfigured: stay silent per-request

    c.executionCtx.waitUntil(
      pushIndexSnapshot(c.env).then(
        (r) => console.log('index push (mutation)', JSON.stringify(r)),
        (err) => console.error('index push (mutation) failed', err),
      ),
    );
  };
}

/** Last time THIS isolate ran the backstop check. Module state, reset on
 *  isolate recycle — which costs at worst one extra unauthenticated GET. */
let lastBackstopCheckAt = 0;

/** How often one isolate will even LOOK at the index's health. Only has to be
 *  roughly right: the check is one unauthenticated GET. */
const BACKSTOP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The request-riding staleness backstop — see the module header for why the
 * cron no longer carries this. Runs after the response on `waitUntil`.
 *
 * ⚠️ Every pass logs its decision, deliberately: the cron backstop failed
 * SILENTLY, and the fix for silence is a log line per decision, not hope.
 * One request + `wrangler tail` is the whole proof procedure.
 */
export function indexBackstopOnRequest(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    if (!c.env.INDEX_URL || !c.env.INDEX_PUSH_TOKEN) {
      console.log('index backstop: skipped (INDEX_URL / INDEX_PUSH_TOKEN not configured)');
      return;
    }
    const now = Date.now();
    const sinceMs = now - lastBackstopCheckAt;
    if (sinceMs < BACKSTOP_CHECK_INTERVAL_MS) {
      console.log(
        `index backstop: throttled (checked ${Math.round(sinceMs / 60000)}m ago, next in ${Math.round(
          (BACKSTOP_CHECK_INTERVAL_MS - sinceMs) / 60000,
        )}m)`,
      );
      return;
    }
    lastBackstopCheckAt = now;
    console.log('index backstop: due — checking index health');

    c.executionCtx.waitUntil(
      pushIndexIfStale(c.env).then(
        (r) => console.log('index backstop', JSON.stringify(r)),
        (err) => console.error('index backstop failed', err),
      ),
    );
  };
}
