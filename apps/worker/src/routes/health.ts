import { Hono } from 'hono';
import { isDatabaseReachable } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { describeEstateApp } from '../lib/estate-app.js';
import { estateMode } from '../middleware/estate.js';

/**
 * Unauthenticated on purpose: this is the endpoint you curl to prove the
 * deployment works before Access is even configured.
 *
 * ⚠️ Envelope normalization (estate item 5, 2026-08-14): also answers
 * `{ ok, service, version, time, detail }`, `detail` holding this route's
 * pre-existing shape verbatim. `version`/`database`/`time` stay at the top
 * level too — additive only, nothing removed this pass; see
 * catalog-platform's docs/info/health-envelope.md for the transition plan.
 *
 * ## `estate` — which consumer is this Worker? (2026-09-05)
 *
 * Added when `ESTATE_APP` became per-instance config. A second instance would
 * serve the SAME bundle from the SAME commit, so "which estate identity is that
 * Worker asserting?" is otherwise answerable only by a signed-in browser plus
 * `wrangler tail` — and that question going unasked for a day is exactly how
 * `library_catalog`'s F-5 survived. One unauthenticated curl now answers it.
 *
 * 🔴 NAMES AND BOOLEANS ONLY. `tokenVar` is a secret's NAME, never its value,
 * and `configured` says both halves of the config exist — NOT that the token is
 * the one the directory expects. Only a real `/seen` proves that.
 */
export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  const ok = database === 'up';
  // The pre-envelope shape, unchanged — nested under `detail` AND kept at
  // the top level (additive transition, see file header). Spread FIRST so
  // the explicit envelope fields after it are an intentional override, not
  // a silently-shadowed duplicate (tsc flags the reverse order, TS2783).
  const legacy = {
    ok,
    version: c.env.APP_VERSION ?? 'unknown',
    database,
    time: new Date().toISOString(),
  };
  return c.json(
    {
      ...legacy,
      service: 'board-game-catalog',
      // Additive, and deliberately OUTSIDE `detail` — `detail` is the frozen
      // pre-envelope shape and gaining a key would make it not that.
      estate: { mode: estateMode(c.env.ESTATE_CHECK), ...describeEstateApp(c.env) },
      detail: legacy,
    },
    ok ? 200 : 503,
  );
});
