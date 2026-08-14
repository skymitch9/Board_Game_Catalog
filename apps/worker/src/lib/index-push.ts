/**
 * Pushing this catalog's projection to the shared index Worker.
 *
 * Design: catalog-platform/docs/info/index-worker-design.md §5 and §7 step 2.
 * Full snapshot, PUT /api/push/game, bearer token — the index replaces this
 * source's rows wholesale, so there is no incremental state to fall behind
 * and a failed push simply leaves the previous snapshot standing.
 *
 * Two triggers, and the split is the design's:
 *
 *  1. AFTER MUTATIONS (`indexPushAfterMutation`) — a successful write under a
 *     catalog-shaped route schedules a push via `waitUntil`, so the index is
 *     fresh within seconds of the shelf changing.
 *  2. A STALENESS BACKSTOP RIDING REQUEST TRAFFIC (`indexBackstopOnRequest`)
 *     — at most once per BACKSTOP_CHECK_INTERVAL_MS per isolate, an /api/*
 *     request schedules (on `waitUntil`, after responding) one
 *     unauthenticated GET of the index's /api/health, and re-pushes only if
 *     the game source is empty or its snapshot is older than a day.
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
 *
 *     What the shape trades, stated: an untouched app pushes nothing — but
 *     an untouched app's catalog is not changing either, since every write
 *     path is an API route. The residual gap is a backfill script writing D1
 *     directly; that heals within the design's ≤24h tolerance the next time
 *     anyone opens the app.
 *
 * So a missed trigger costs at most a day of freshness (the design's stated
 * tolerance), and the ordinary path costs nothing measurable.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: the index must never be able to stall
 * this catalog. `INDEX_URL` / `INDEX_PUSH_TOKEN` unset means every trigger
 * logs one line and does nothing. No throw from here ever reaches a route.
 */

import type { MiddlewareHandler } from 'hono';
import { buildIndexProjection } from '@bgc/db';
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

export async function pushIndexSnapshot(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  const rows = await buildIndexProjection(env.DB);
  // The index 422s an empty snapshot ("zero rows is a failed export, not an
  // empty catalog") — don't even send one.
  if (rows.length === 0) {
    return { skipped: 'projection produced zero rows — not pushing an empty snapshot' };
  }

  const res = await fetch(`${env.INDEX_URL}/api/push/game`, {
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

/** The backstop body: one health GET; push only when missing or stale. */
export async function pushIndexIfStale(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  const res = await fetch(`${env.INDEX_URL}/api/health`);
  if (!res.ok) {
    throw new Error(`index health check failed: ${res.status}`);
  }
  const health = (await res.json()) as {
    sources?: { game?: { rows?: number; pushed_at?: string | null } };
  };

  const game = health.sources?.game;
  const pushedAt = game?.pushed_at ? Date.parse(game.pushed_at) : Number.NaN;
  const fresh = (game?.rows ?? 0) > 0 && Number.isFinite(pushedAt) && Date.now() - pushedAt < BACKSTOP_MAX_AGE_MS;
  if (fresh) {
    return { skipped: `index is fresh (${game?.rows} rows, pushed ${game?.pushed_at})` };
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
