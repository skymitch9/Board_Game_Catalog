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
 *  2. A STALENESS BACKSTOP riding the PROVEN half-hourly cron
 *     (`pushIndexIfStale`) — asks the index's /api/health and pushes only if
 *     the game source is empty or its snapshot is older than a day. This is
 *     deliberately NOT a third cron expression: `wrangler deploy` has claimed
 *     to register triggers here that Cloudflare never fired, and the rule
 *     this repo came away with is that a cron is not working until something
 *     it writes has rows. The half-hourly slice has that proof; the backstop
 *     inherits it, exactly like the orphan sweep does. Cost when fresh: one
 *     unauthenticated GET, no D1 writes.
 *
 * So a missed trigger costs at most a day of freshness (the design's stated
 * tolerance), and the ordinary path costs nothing measurable.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: the index must never be able to stall
 * this catalog. `INDEX_URL` unset (true in production until the owner deploys
 * the index Worker and answers its read-auth question) means every trigger
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

/** The half-hourly backstop: one health GET; push only when missing or stale. */
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
