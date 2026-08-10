/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in packages/ so the CLI can use it too.
 */

import { Hono } from 'hono';
import { sweepOrphanAdoptions } from '@bgc/db';
import type { AppBindings, Env } from './env.js';
import { COMPONENT_REFRESH_CRON, runComponentBackfill } from './lib/component-backfill.js';
import { runCoverCheck } from './lib/cover-check.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { aliasRoutes } from './routes/aliases.js';
import { barcodeRoutes } from './routes/barcode.js';
import { bggRoutes } from './routes/bgg.js';
import { cacheRoutes } from './routes/cache.js';
import { catalogRoutes } from './routes/catalog.js';
import { componentRoutes } from './routes/components.js';
import { coverRoutes } from './routes/covers.js';
import { editionRoutes } from './routes/editions.js';
import { exportRoutes } from './routes/export.js';
import { healthRoutes } from './routes/health.js';
import { lookupRoutes } from './routes/lookup.js';
import { researchRoutes } from './routes/research.js';
import { scanJobRoutes } from './routes/scan-jobs.js';
import { userRoutes } from './routes/users.js';
import { visionRoutes } from './routes/vision.js';

const app = new Hono<AppBindings>();

// ⚠️ The order of these three is the whole shape of the gate.
//
// Cloudflare Access used to turn away unauthenticated traffic before any of
// this ran. It no longer does (see middleware/auth.ts), so the rate limit goes
// first — ahead of health, and ahead of the signature check that every /api/*
// request pays for even when it ends in a 401.
app.use('/api/*', rateLimit());

// Public — no token needed, so a deploy can still be curled to verify it. Rate
// limited by the line above, unlike before.
app.route('/api/health', healthRoutes);

// Everything else behind identity. Blanket rather than per-route on purpose: a
// route added later should inherit the gate rather than escape it.
app.use('/api/*', requireAuth());
app.route('/api', userRoutes);
app.route('/api', catalogRoutes);
app.route('/api/aliases', aliasRoutes);
app.route('/api/bgg', bggRoutes);
app.route('/api/barcode', barcodeRoutes);
app.route('/api/vision', visionRoutes);
app.route('/api/cache', cacheRoutes);
app.route('/api/components', componentRoutes);
app.route('/api/covers', coverRoutes);
app.route('/api/editions', editionRoutes);
app.route('/api/lookup', lookupRoutes);
app.route('/api/scan-jobs', scanJobRoutes);
app.route('/api/research', researchRoutes);
app.route('/api', exportRoutes);

app.notFound(async (c) => {
  // Unmatched /api/* is a genuine 404; anything else is an SPA route, so hand
  // back index.html and let the client router deal with it.
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found', path: c.req.path }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  const res = await c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));

  // index.html names the content-hashed bundles, so a cached copy pins a browser
  // to a previous deploy's JavaScript. Safari did exactly that: new assets were
  // live, but the phone kept loading the old ones because the file naming them
  // was still in cache. The bundles themselves are hashed and cached hard by
  // public/_headers; this one file must always be revalidated.
  const html = new Response(res.body, res);
  html.headers.set('Cache-Control', 'no-cache');
  return html;
});

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: err.message }, 500);
});

export default {
  fetch: app.fetch,

  /**
   * The cron triggers (see wrangler.toml).
   *
   * Two schedules, one handler, dispatched on `event.cron` — a second
   * `scheduled` export is not a thing Workers offers, and branching here keeps
   * both jobs' wiring in the one place anybody would look for it. Still just
   * wiring: every decision lives in lib/.
   *
   * Every half hour — a slice of the cover check, **and** the orphan sweep.
   * `41 5 * * 1`  — the weekly "what's new for a game you own" sweep.
   *
   * Anything unrecognised runs the cover check, because that is the schedule
   * that existed first and an unmatched cron doing nothing at all is the kind
   * of silent stall this codebase has been bitten by before.
   *
   * ⚠️ **The orphan sweep rides on the half-hourly trigger rather than getting
   * one of its own, and that is the whole point.** `wrangler deploy` reported
   * registering triggers for weeks while Cloudflare's Cron Events log showed no
   * events at all — the rule this project came away with is that *a cron is not
   * working until something it writes has rows*. The half-hourly expression is
   * the one here with that proof: 437+ rows in `cover_check`, and a
   * `wrangler tail` capture of it reporting `- Ok`. Hanging the sweep off it
   * inherits the proof instead of betting on a fresh registration, and half-hourly
   * beats the hourly that was asked for anyway.
   *
   * (The expression itself is not written out in this comment: it contains the
   * two characters that end a block comment, which is a compile error, not a
   * typo. It lives in `wrangler.toml`.)
   *
   * Two `waitUntil`s rather than one chain, so a failing sweep cannot take the
   * cover check down with it.
   */
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === COMPONENT_REFRESH_CRON) {
      const token = env.BGG_API_TOKEN ?? '';
      if (!token) {
        console.warn('component refresh skipped: no BGG_API_TOKEN');
        return;
      }
      ctx.waitUntil(
        runComponentBackfill(env.DB, token).then(
          (run) => console.log('component refresh', JSON.stringify(run)),
          (err) => console.error('component refresh failed', err),
        ),
      );
      return;
    }

    ctx.waitUntil(
      runCoverCheck(env.DB).then(
        (run) => console.log('cover check', JSON.stringify(run)),
        (err) => console.error('cover check failed', err),
      ),
    );

    ctx.waitUntil(
      sweepOrphanAdoptions(env.DB).then(
        (run) => console.log('orphan sweep', JSON.stringify(run)),
        (err) => console.error('orphan sweep failed', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
