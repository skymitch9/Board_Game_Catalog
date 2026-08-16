/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in packages/ so the CLI can use it too.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sweepOrphanAdoptions } from '@bgc/db';
import type { AppBindings, Env } from './env.js';
import { COMPONENT_REFRESH_CRON, runComponentBackfill } from './lib/component-backfill.js';
import { DETAILS_SWEEP_CRON, runDetailsSweep } from './lib/details-sweep.js';
import { runCoverCheck } from './lib/cover-check.js';
import { indexBackstopOnRequest, indexPushAfterMutation } from './lib/index-push.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { adminCors, adminRoutes } from './routes/admin.js';
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

/** The estate status page — apex only, GET-only, no Authorization needed. */
function healthCors() {
  return cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 600,
  });
}

// ⚠️ The order of these three is the whole shape of the gate.
//
// Cloudflare Access used to turn away unauthenticated traffic before any of
// this ran. It no longer does (see middleware/auth.ts), so the rate limit goes
// first — ahead of health, and ahead of the signature check that every /api/*
// request pays for even when it ends in a 401.
app.use('/api/*', rateLimit());

// The shared-index staleness backstop rides request traffic — one logged
// decision per /api/* request, at most one health check per isolate-hour, a
// re-push only when the index's game source is empty or a day stale. Mounted
// BEFORE the health route and the auth gate on purpose: an unauthenticated
// `curl /api/health` + `wrangler tail` is the whole proof that it runs, which
// is the property the cron-riding backstop turned out not to have (it failed
// three consecutive ticks in silence — see lib/index-push.ts).
app.use('/api/*', indexBackstopOnRequest());

// CORS for the estate status page (heygabi.ai/status) — apex only, GET-only.
// The route is already open by design; this only lets a BROWSER read it.
// Mounted before the route, same preflight reasoning as adminCors below.
app.use('/api/health', healthCors());
// Public — no token needed, so a deploy can still be curled to verify it. Rate
// limited by the line above, unlike before.
app.route('/api/health', healthRoutes);

// CORS for the estate's federated admin page (exactly https://heygabi.ai —
// see routes/admin.ts). ⚠️ Before requireAuth on purpose: a preflight OPTIONS
// carries no bearer, so the blanket would 401 it. Only the preflight is
// answered here; the admin routes themselves mount AFTER the blanket below
// and stay behind it — and behind the rate limiter above, like everything.
app.use('/api/admin/*', adminCors());

// Everything else behind identity. Blanket rather than per-route on purpose: a
// route added later should inherit the gate rather than escape it.
app.use('/api/*', requireAuth());

// After any successful item-touching mutation, refresh the shared index (a
// waitUntil snapshot push — the response never waits, failures land in the
// log, and it is a no-op until INDEX_URL/INDEX_PUSH_TOKEN are configured).
// Behind requireAuth on purpose: only an authenticated write can change the
// catalog, so nothing earlier can need it.
app.use('/api/*', indexPushAfterMutation());
// The federated-admin surface (cross-origin twin of the People page's user
// routes — same gate, same write path, CORS-scoped mount).
app.route('/api/admin', adminRoutes);
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
    // Hourly: fill in missing details without being asked (owner ask
    // 2026-08-16). Its own cron so it cannot ride the 30-minute tick — these
    // lookups cost money, and "every 30 minutes" would double the ceiling for
    // no benefit. Returns early: the cover check and orphan sweep below are
    // for the other schedules, and running them four times as often on this
    // one would be a silent side effect of adding a feature.
    if (event.cron === DETAILS_SWEEP_CRON) {
      ctx.waitUntil(
        runDetailsSweep(env).then(
          (run) => console.log('details sweep', JSON.stringify(run)),
          (err) => console.error('details sweep failed', err),
        ),
      );
      return;
    }

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

    // The shared-index staleness backstop no longer rides this cron: it rode
    // here first, and on 2026-08-13 it silently failed to push on three
    // consecutive ticks while a manual push with the same token succeeded —
    // a scheduled run's logs are effectively unwatchable (three tail attempts
    // died trying). It now rides request traffic instead, where one request
    // + `wrangler tail` proves the decision (see lib/index-push.ts and the
    // indexBackstopOnRequest mount above). The cover check, orphan sweep and
    // component refresh stay exactly as they were.
  },
} satisfies ExportedHandler<Env>;
