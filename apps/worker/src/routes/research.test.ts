/**
 * `routes/research.ts` — the most expensive surface in this Worker (6–40¢ a
 * run) and the one with the most capabilities on it: `read` to look,
 * `runResearch` to spend, `reviewFindings` to accept.
 *
 * ## What this file proves
 *
 * 1. **Looking is free and spending is not**, and the two are separated by a
 *    capability rather than by a route prefix — so the assertions are on the
 *    `capability` name, not on the status. `runResearch` and `scanPhoto` name
 *    the identical role set (moderator+), so a role-only check cannot tell a
 *    research gate from a photo gate.
 * 2. **A refusal that costs money to get wrong is checked BEFORE the run row is
 *    written.** Both the blocked-tier 400 and the spending 403 must leave no
 *    `research_run` behind: a refusal that litters the history makes "this
 *    game's research failed" indistinguishable from "somebody was refused".
 * 3. **The fourth cause stays separate.** No `ANTHROPIC_API_KEY` is a
 *    CONFIGURATION failure — 503, naming the doc — never a 403 that sends
 *    somebody asking for a role that would not help.
 *
 * NOT proved: `runTier`/`runDetailsLookup` themselves (they belong to
 * `packages/research`), and no live D1 or model call happens anywhere here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { researchRoutes } from './research.js';

function userWith(role: Role): AppUser {
  return {
    id: 1,
    email: 'actor@example.test',
    displayName: 'Actor',
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

function appAs(role: Role, billingDenied: string[] | null = null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    c.set('billingDenied', billingDenied);
    await next();
  });
  app.route('/api/research', researchRoutes);
  return app;
}

/**
 * `item` holds one row (id 7) unless `noItem` is set. Everything else answers
 * empty, and every statement is remembered so a test can prove a refusal wrote
 * nothing.
 */
function stubDb(opts: { noItem?: boolean; publisherUrl?: string | null } = {}) {
  const { noItem = false, publisherUrl = null } = opts;
  const sqlSeen: string[] = [];
  const itemRow = {
    id: 7,
    bgg_id: null,
    kind: 'game',
    parent_item_id: null,
    root_game_id: 7,
    pending_parent_name: null,
    name: 'Test Game',
    sort_name: 'test game',
    year_published: 2024,
    publisher: 'Test Publisher',
    publisher_url: publisherUrl,
    source_url: null,
    game_system: null,
    series: null,
    designers: null,
    min_players: 2,
    max_players: 4,
    playtime_min: 60,
    weight: null,
    thumbnail_url: null,
    description: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };

  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM item WHERE id = \?/.test(sql)) return noItem ? null : itemRow;
          return null;
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
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

const envWith = (db: D1Database, extra: Partial<Env> = {}) =>
  ({ DB: db, ...extra }) as unknown as Env;

async function call(
  app: Hono<AppBindings>,
  method: string,
  path: string,
  body?: unknown,
  env: Env = envWith(stubDb()),
) {
  return app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

// ---------------------------------------------------------------------------
// 1. three capabilities, by name
// ---------------------------------------------------------------------------

const READING = [
  '/api/research/7/plan',
  '/api/research/7/findings',
  '/api/research/needs-details',
  '/api/research/details-runs',
] as const;

describe('reading the research surface needs only `read` — but needs it', () => {
  for (const path of READING) {
    it(`GET ${path} refuses a PENDING account, worded as approval`, async () => {
      const db = stubDb();
      const res = await call(appAs('pending'), 'GET', path, undefined, envWith(db));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
      assert.equal(body.capability, 'read');
      assert.equal(body.role, 'pending');
      assert.match(body.detail ?? '', /awaiting approval by an owner/);
      assert.deepEqual(db._sql, [], 'a refused reader never reaches D1');
    });

    it(`GET ${path} lets a GUEST look — reading a price is not spending it`, async () => {
      const res = await call(appAs('guest'), 'GET', path, undefined);
      assert.equal(res.status, 200);
    });
  }
});

describe('spending needs `runResearch`, named on the wire', () => {
  const SPENDING = [
    { method: 'POST', path: '/api/research/7/run', body: { tier: 'retail' } },
    { method: 'POST', path: '/api/research/7/details', body: {} },
  ] as const;

  for (const { method, path, body } of SPENDING) {
    for (const role of ['guest', 'member', 'contributor'] as const) {
      it(`${method} ${path} refuses a ${role} as runResearch — never as scanPhoto`, async () => {
        const db = stubDb();
        const res = await call(appAs(role), method, path, body, envWith(db));
        assert.equal(res.status, 403);
        const parsed = (await res.json()) as { capability?: string };
        // ⚠️ `runResearch` and `scanPhoto` hold the same roles: only this field
        // distinguishes a research gate from a photo gate.
        assert.equal(parsed.capability, 'runResearch');
        assert.deepEqual(db._sql, [], 'a refused caller must not create a run row');
      });
    }
  }

  it('PATCH /findings/:id needs `reviewFindings`, which is a THIRD capability', async () => {
    const res = await call(appAs('contributor'), 'PATCH', '/api/research/findings/3', {
      reviewState: 'accepted',
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string };
    assert.equal(body.capability, 'reviewFindings');
  });

  it('a moderator may review — the same rung that may spend', async () => {
    const res = await call(appAs('moderator'), 'PATCH', '/api/research/findings/3', {
      reviewState: 'accepted',
    });
    // The stub has no such finding, so a 404 is the proof the handler ran.
    assert.equal(res.status, 404);
  });

  it('an invalid review state is a 400, not a silently ignored write', async () => {
    const res = await call(appAs('owner'), 'PATCH', '/api/research/findings/3', {
      reviewState: 'maybe',
    });
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// 2. the reads answer with something usable
// ---------------------------------------------------------------------------

describe('GET /:id/plan — the price, and whether it can run at all', () => {
  it('404s for a game that is not there rather than quoting a price for nothing', async () => {
    const res = await call(appAs('owner'), 'GET', '/api/research/7/plan', undefined, envWith(stubDb({ noItem: true })));
    assert.equal(res.status, 404);
  });

  it('a bad id is a 400 in words, before any read', async () => {
    const db = stubDb();
    const res = await call(appAs('owner'), 'GET', '/api/research/nope/plan', undefined, envWith(db));
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { detail?: string }).detail), /invalid id/);
    assert.deepEqual(db._sql, []);
  });

  it('quotes every tier with a price AND a runnable verdict', async () => {
    const res = await call(appAs('owner'), 'GET', '/api/research/7/plan');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      item?: { id?: number };
      model?: string;
      tiers?: {
        tier: string;
        estimatedCents: { low: number; high: number };
        runnable: boolean;
        blocked: string | null;
      }[];
    };
    assert.equal(body.item?.id, 7);
    assert.ok(body.model, 'the model is named so the price can be checked against it');
    assert.ok((body.tiers?.length ?? 0) >= 3);
    for (const tier of body.tiers ?? []) {
      // ⚠️ A RANGE, not a single number. A price quoted as one figure would be
      // a guess wearing a measurement's clothes — these runs vary 3× in cost.
      assert.equal(typeof tier.estimatedCents?.low, 'number');
      assert.equal(typeof tier.estimatedCents?.high, 'number');
      assert.ok(tier.estimatedCents.high >= tier.estimatedCents.low);
      assert.equal(typeof tier.runnable, 'boolean');
      // 🔴 A blocked tier says WHY. Finding out after a two-minute run would be
      // a needlessly expensive way to learn it.
      if (!tier.runnable) assert.ok(tier.blocked, 'a blocked tier with no reason is a bare refusal');
    }
  });

  it('⚠️ the OFFICIAL tier is blocked, in words, when the game has no publisher URL', async () => {
    const res = await call(appAs('owner'), 'GET', '/api/research/7/plan', undefined, envWith(stubDb({ publisherUrl: null })));
    const body = (await res.json()) as { tiers?: { tier: string; runnable: boolean; blocked: string | null }[] };
    const official = body.tiers?.find((t) => t.tier === 'official');
    assert.ok(official);
    assert.equal(official.runnable, false);
    assert.ok(official.blocked && official.blocked.length > 10, 'the block must be a sentence');
  });
});

describe('GET /needs-details and /details-runs', () => {
  it('needs-details carries the per-game price alongside the list', async () => {
    const res = await call(appAs('guest'), 'GET', '/api/research/needs-details');
    const body = (await res.json()) as { items?: unknown[]; centsEach?: { low: number; high: number } };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.centsEach?.low, 'number');
    assert.equal(typeof body.centsEach?.high, 'number');
  });

  it('details-runs answers an empty list rather than 404 when nothing has run', async () => {
    const res = await call(appAs('guest'), 'GET', '/api/research/details-runs');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { runs?: unknown[] };
    assert.deepEqual(body.runs, []);
  });
});

// ---------------------------------------------------------------------------
// 3. every expensive refusal happens BEFORE the run row
// ---------------------------------------------------------------------------

describe('POST /:id/run — nothing costly is written before the refusals', () => {
  it('a blocked tier is a 400 in words, and writes NO run row', async () => {
    const db = stubDb({ publisherUrl: null });
    const res = await call(appAs('owner'), 'POST', '/api/research/7/run', { tier: 'official' }, envWith(db));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.ok((body.detail ?? '').length > 10, 'a blocked tier must say why');
    assert.ok(
      !db._sql.some((s) => /INSERT INTO research_run/i.test(s)),
      'a tier that cannot run is a bad request, not a failed run — it must not litter the history',
    );
  });

  it('🔴 a spending refusal writes NO run row either, and says who can undo it', async () => {
    const db = stubDb({ publisherUrl: 'https://example.test' });
    const res = await call(
      appAs('owner', ['research.tier']),
      'POST',
      '/api/research/7/run',
      { tier: 'retail' },
      envWith(db, { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; feature?: string; needs?: string; how?: string };
    assert.equal(body.error, 'billing_denied');
    assert.equal(body.feature, 'research.tier');
    assert.equal(body.needs, 'the estate owner');
    assert.match(body.how ?? '', /Spending panel/);
    assert.ok(!db._sql.some((s) => /INSERT INTO research_run/i.test(s)));
  });

  it('an unknown tier is refused by the schema', async () => {
    const res = await call(appAs('owner'), 'POST', '/api/research/7/run', { tier: 'community' });
    assert.equal(res.status, 400);
  });

  it('404 for a game that is not there, before any tier resolution', async () => {
    const res = await call(
      appAs('owner'),
      'POST',
      '/api/research/7/run',
      { tier: 'retail' },
      envWith(stubDb({ noItem: true })),
    );
    assert.equal(res.status, 404);
  });
});

describe('POST /:id/details — the fourth cause is CONFIG, not permission', () => {
  it('no ANTHROPIC_API_KEY is a 503 naming the doc, never a 403', async () => {
    const res = await call(appAs('owner'), 'POST', '/api/research/7/details', {});
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'lookup_failed');
    assert.match(body.detail ?? '', /No Anthropic API key configured/);
    assert.match(body.detail ?? '', /SETUP\.md/);
    // ⚠️ A missing key is not a role problem. Wording it as one sends somebody
    // to ask the owner for access they already have.
    assert.ok(!/role/i.test(body.detail ?? ''));
  });

  it('the spending refusal comes FIRST — a denied feature is not reported as a missing key', async () => {
    const res = await call(
      appAs('owner', ['research.details']),
      'POST',
      '/api/research/7/details',
      {},
      envWith(stubDb(), { BILLING_POLICY: 'enforce' }),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { feature?: string };
    // ⚠️ `research.details`, NOT `research.tier` — the registry gives the
    // missing-details lookup the same id the library's details run has.
    assert.equal(body.feature, 'research.details');
  });

  it('404 for a game that is not there', async () => {
    const res = await call(appAs('owner'), 'POST', '/api/research/7/details', {}, envWith(stubDb({ noItem: true })));
    assert.equal(res.status, 404);
  });
});
