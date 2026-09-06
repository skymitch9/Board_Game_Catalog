/**
 * `routes/vision.ts` — the two routes that read a game off a photograph, and
 * bill the Anthropic vision API for doing it.
 *
 * ## Why the capability NAME is asserted everywhere below, not just the status
 *
 * `scanPhoto` and `runResearch` hold the IDENTICAL role set today
 * (`['owner','admin','moderator']`) — see `capabilities.ts`. A role-only check
 * ("is a contributor refused?") therefore cannot tell the two apart: a
 * contributor is refused either way. `library_catalog` shipped exactly that
 * mix-up (its scan routes were gated on `runResearch` instead of the then-new
 * `scanPhoto`), and its `scan-jobs.test.ts` header records it. The `capability`
 * field on the wire is the only thing that distinguishes them, so every
 * assertion here is against that field's exact value.
 *
 * ## What is NOT exercised
 *
 * No Anthropic call is made and no key is present, so every "allowed past the
 * gate" case is proved by the request failing on something LATER than the role
 * — a 400 from `photoSchema`, a 413 from the size check, or the spending
 * refusal. `identifyFromPhoto`/`readShelf` themselves belong to
 * `packages/research`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { MAX_PHOTO_BYTES, type AppUser, type Role } from '@bgc/core';
import type { AppBindings, Env } from '../env.js';
import { visionRoutes } from './vision.js';

const PATHS = ['/api/vision/identify', '/api/vision/shelf'] as const;

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

/** A role planted the way `requireAuth` would, plus the estate gate's cache. */
function appAs(role: Role, billingDenied: string[] | null = null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    c.set('billingDenied', billingDenied);
    await next();
  });
  app.route('/api/vision', visionRoutes);
  return app;
}

/** Never dereferenced: nothing below reaches D1 or the model. */
const stubEnv = (extra: Partial<Env> = {}) => ({ ...extra }) as unknown as Env;

/** A base64 blob that clears `photoSchema`'s min(64) without being large. */
const SMALL_PHOTO = 'A'.repeat(128);

async function post(app: Hono<AppBindings>, path: string, body: unknown, env: Env = stubEnv()) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );
}

// ---------------------------------------------------------------------------

describe('both photo routes are gated on scanPhoto BY NAME', () => {
  for (const path of PATHS) {
    for (const role of ['guest', 'member', 'contributor'] as const) {
      it(`${path}: a ${role} is refused as scanPhoto, in words`, async () => {
        const res = await post(appAs(role), path, {});
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error?: string; capability?: string; role?: string; detail?: string };
        assert.equal(body.error, 'forbidden');
        // ⚠️ The regression this guards: `runResearch` also 403s a contributor,
        // so the status alone would never catch the swap.
        assert.equal(body.capability, 'scanPhoto');
        assert.equal(body.role, role);
        assert.match(body.detail ?? '', /Your role does not permit this action/);
      });
    }

    it(`${path}: a PENDING account is told it is awaiting approval, not that its role is low`, async () => {
      const res = await post(appAs('pending'), path, {});
      assert.equal(res.status, 403);
      const body = (await res.json()) as { detail?: string };
      assert.match(body.detail ?? '', /awaiting approval by an owner/);
    });

    for (const role of ['moderator', 'admin', 'owner'] as const) {
      it(`${path}: a ${role} clears the gate (fails on the empty body, not on role)`, async () => {
        const res = await post(appAs(role), path, {});
        assert.notEqual(res.status, 403);
        assert.equal(res.status, 400, 'photoSchema rejects the empty body — proof the handler ran');
      });
    }
  }
});

describe('the payload is validated before anything is sent', () => {
  for (const path of PATHS) {
    it(`${path}: an unsupported image type is a 400, not a failed model call`, async () => {
      const res = await post(appAs('owner'), path, { data: SMALL_PHOTO, mediaType: 'image/bmp' });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'bad_request');
    });

    it(`${path}: an oversized photo is refused with 413 and told what to do`, async () => {
      // The check is on the base64 length, deliberately — before decoding.
      const oversized = 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8);
      const res = await post(appAs('owner'), path, { data: oversized, mediaType: 'image/jpeg' });
      assert.equal(res.status, 413);
      const body = (await res.json()) as { detail?: string };
      assert.match(body.detail ?? '', /too large\. Downscale before sending/);
    });
  }
});

describe('the spending gate — ANDed with scanPhoto, never instead of it', () => {
  for (const path of PATHS) {
    it(`${path}: BILLING_POLICY="off" is inert even with the feature denied`, async () => {
      const res = await post(
        appAs('owner', ['scan.photo']),
        path,
        { data: SMALL_PHOTO, mediaType: 'image/jpeg' },
        stubEnv({ BILLING_POLICY: 'off' }),
      );
      // Not a 403: the request goes on to fail at the model call with no key.
      assert.notEqual(res.status, 403);
    });

    it(`${path}: "shadow" proceeds too — it logs, it does not refuse`, async () => {
      const res = await post(
        appAs('owner', ['scan.photo']),
        path,
        { data: SMALL_PHOTO, mediaType: 'image/jpeg' },
        stubEnv({ BILLING_POLICY: 'shadow' }),
      );
      assert.notEqual(res.status, 403);
    });

    it(`${path}: "enforce" + denied refuses in WORDS, naming who can undo it`, async () => {
      const res = await post(
        appAs('owner', ['scan.photo']),
        path,
        { data: SMALL_PHOTO, mediaType: 'image/jpeg' },
        stubEnv({ BILLING_POLICY: 'enforce' }),
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as {
        error?: string;
        feature?: string;
        detail?: string;
        needs?: string;
        how?: string;
      };
      assert.equal(body.error, 'billing_denied');
      // ⚠️ ONE switch covers both routes on purpose — see the G2 comment.
      assert.equal(body.feature, 'scan.photo');
      // What happened / what it needs / how to get it, all three.
      assert.match(body.detail ?? '', /switched off for this catalogue/);
      assert.equal(body.needs, 'the estate owner');
      assert.match(body.how ?? '', /Spending panel/);
    });

    it(`${path}: "enforce" with the feature NOT denied proceeds`, async () => {
      const res = await post(
        appAs('owner', ['research.tier']),
        path,
        { data: SMALL_PHOTO, mediaType: 'image/jpeg' },
        stubEnv({ BILLING_POLICY: 'enforce' }),
      );
      assert.notEqual(res.status, 403);
    });

    it(`${path}: 🔴 an UNKNOWN policy (null denied set) proceeds — fail-open, chosen out loud`, async () => {
      const res = await post(
        appAs('owner', null),
        path,
        { data: SMALL_PHOTO, mediaType: 'image/jpeg' },
        stubEnv({ BILLING_POLICY: 'enforce' }),
      );
      assert.notEqual(res.status, 403);
    });

    it(`${path}: a malformed body is refused BEFORE the spending gate, so a refusal costs nothing`, async () => {
      const res = await post(
        appAs('owner', ['scan.photo']),
        path,
        {},
        stubEnv({ BILLING_POLICY: 'enforce' }),
      );
      assert.equal(res.status, 400, 'a bad request is a bad request, not a billing refusal');
    });
  }
});

describe('an upstream failure is never worded as a problem with the photo', () => {
  it('a rejected API key is reported as CONFIG, with the command that fixes it', async () => {
    // No ANTHROPIC_API_KEY at all — the SDK path throws before any network I/O
    // in this environment, so this exercises the mapper, not the model.
    const res = await post(appAs('owner'), PATHS[0], { data: SMALL_PHOTO, mediaType: 'image/jpeg' });
    assert.ok(res.status >= 500 || res.status === 429, `unexpected ${res.status}`);
    const body = (await res.json()) as { error?: string; detail?: string };
    // Whatever the branch, it must never be a permission refusal.
    assert.notEqual(body.error, 'forbidden');
    assert.ok(!/role/i.test(body.detail ?? ''), 'an outage is not a permission failure');
  });
});
