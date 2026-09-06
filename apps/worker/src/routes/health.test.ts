/**
 * `routes/health.ts` — the ONE route in this Worker that is deliberately
 * unauthenticated, and the one the estate status page reads cross-origin.
 *
 * Three things are pinned:
 *
 * 1. **It answers with no bearer at all.** It is the endpoint you curl to prove
 *    a deploy worked before anything else is configured, so a stray
 *    `requireCapability` here would be invisible in the browser and fatal to
 *    the deploy check.
 * 2. **The envelope is ADDITIVE.** `{ ok, service, version, time, detail }` was
 *    added in 2026-08-14 with `detail` holding the pre-envelope shape VERBATIM,
 *    and the old top-level keys kept beside it. `detail` gaining a key would
 *    make it not-that-shape, which is the whole point of freezing it.
 * 3. 🔴 **`estate` carries NAMES AND BOOLEANS ONLY.** `tokenVar` is a secret's
 *    NAME; `configured` says both halves of the config exist, not that the
 *    token is the one the directory expects. This repo is public — a value
 *    leaking here would leak to GitHub.
 *
 * NOT proved: the CORS mount (that lives in `index.ts`), or that a live
 * deployment answers — this is the route function against a stub.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { healthRoutes } from './health.js';

/** `reachable: false` answers a table count of 0; `throws` blows up instead. */
function stubDb(opts: { reachable?: boolean; throws?: boolean } = {}) {
  const { reachable = true, throws = false } = opts;
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (throws) throw new Error('D1_ERROR: database unavailable');
          return { n: reachable ? 1 : 0 };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

async function health(db: D1Database, extra: Partial<Env> = {}) {
  const app = new Hono<AppBindings>().route('/', healthRoutes);
  // ⚠️ No middleware planting a user, and no Authorization header. If this
  // route ever grows a gate, every case in this file fails at once.
  const res = await app.request('/', {}, { DB: db, APP_VERSION: '1.2.3', ...extra } as unknown as Env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------

describe('it answers an unauthenticated curl', () => {
  it('200 and ok:true when the database is reachable', async () => {
    const { status, body } = await health(stubDb());
    assert.equal(status, 200);
    assert.equal(body['ok'], true);
    assert.equal(body['database'], 'up');
    assert.equal(body['service'], 'board-game-catalog');
    assert.equal(body['version'], '1.2.3');
  });

  it('🔴 503 and ok:false when it is not — a status page must be able to go red', async () => {
    const { status, body } = await health(stubDb({ reachable: false }));
    assert.equal(status, 503);
    assert.equal(body['ok'], false);
    assert.equal(body['database'], 'down');
  });

  it('a THROWING database is `down`, not a 500 — an outage is still an answer', async () => {
    const { status, body } = await health(stubDb({ throws: true }));
    assert.equal(status, 503);
    assert.equal(body['database'], 'down');
  });

  it('an unset APP_VERSION reads "unknown" rather than vanishing', async () => {
    const app = new Hono<AppBindings>().route('/', healthRoutes);
    const res = await app.request('/', {}, { DB: stubDb() } as unknown as Env);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['version'], 'unknown');
  });
});

describe('the envelope is additive — nothing that was there before was removed', () => {
  it('carries both the envelope keys and the pre-envelope ones at the top level', async () => {
    const { body } = await health(stubDb());
    for (const key of ['ok', 'version', 'database', 'time', 'service', 'estate', 'detail']) {
      assert.ok(key in body, `${key} is missing from /api/health`);
    }
  });

  it('🔴 `detail` is the pre-envelope shape VERBATIM — exactly four keys', async () => {
    const { body } = await health(stubDb());
    const detail = body['detail'] as Record<string, unknown>;
    assert.deepEqual(Object.keys(detail).sort(), ['database', 'ok', 'time', 'version']);
    // ⚠️ `estate` is deliberately OUTSIDE `detail`: a frozen shape that gains
    // a key is not a frozen shape.
    assert.ok(!('estate' in detail));
    assert.ok(!('service' in detail));
  });

  it('`detail` and the top level agree, so a reader may use either', async () => {
    const { body } = await health(stubDb());
    const detail = body['detail'] as Record<string, unknown>;
    for (const key of ['ok', 'version', 'database']) {
      assert.equal(detail[key], body[key], `${key} disagrees between detail and the top level`);
    }
  });

  it('`time` is an ISO timestamp, not a locale string', async () => {
    const { body } = await health(stubDb());
    assert.match(String(body['time']), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('🔴 `estate` — names and booleans only, on a PUBLIC repo', () => {
  it('names the app and the token VARIABLE, never a token', async () => {
    const { body } = await health(stubDb(), {
      ESTATE_APP: 'games',
      ESTATE_AUTH_URL: 'https://auth.heygabi.ai',
      ESTATE_APP_TOKEN_GAMES: 'a-secret-value-that-must-never-appear',
    });
    const estate = body['estate'] as Record<string, unknown>;
    assert.deepEqual(Object.keys(estate).sort(), ['app', 'configured', 'mode', 'tokenVar']);
    assert.equal(estate['app'], 'games');
    assert.equal(estate['tokenVar'], 'ESTATE_APP_TOKEN_GAMES');
    assert.equal(estate['configured'], true);
    // The whole response, not just the estate block: a value must not leak
    // through any key.
    assert.ok(
      !JSON.stringify(body).includes('a-secret-value-that-must-never-appear'),
      'a secret VALUE reached the public health endpoint',
    );
  });

  it('`configured` is false when either half is missing, and says nothing more', async () => {
    const { body } = await health(stubDb(), { ESTATE_APP: 'games' });
    const estate = body['estate'] as Record<string, unknown>;
    // ⚠️ `configured: false` means "both halves of the config exist" is untrue.
    // It never means the token is wrong — only a real /seen proves that.
    assert.equal(estate['configured'], false);
    assert.equal(estate['app'], 'games');
  });

  it('an unset ESTATE_APP resolves to the main instance', async () => {
    const { body } = await health(stubDb());
    assert.equal((body['estate'] as Record<string, unknown>)['app'], 'games');
  });

  it('🔴 an UNRECOGNISED ESTATE_APP resolves to null — never a fallback to `games`', async () => {
    // Falling back would attribute a second household's identity to the main
    // catalog in the one record anybody would later count.
    const { body } = await health(stubDb(), { ESTATE_APP: 'typo' });
    const estate = body['estate'] as Record<string, unknown>;
    assert.equal(estate['app'], null);
    assert.equal(estate['configured'], false);
  });

  it('the mode is reported, and an unrecognised ESTATE_CHECK falls to `off`', async () => {
    for (const [raw, expected] of [
      [undefined, 'off'],
      ['off', 'off'],
      ['shadow', 'shadow'],
      ['enforce', 'enforce'],
      ['ENFORCE', 'off'],
      ['nonsense', 'off'],
    ] as const) {
      const { body } = await health(stubDb(), raw === undefined ? {} : { ESTATE_CHECK: raw });
      assert.equal(
        (body['estate'] as Record<string, unknown>)['mode'],
        expected,
        `ESTATE_CHECK=${String(raw)} reported the wrong mode`,
      );
    }
  });
});
