/**
 * `lib/cover-check.ts` — does one cover run FIT IN ONE INVOCATION?
 *
 * The 2026-08 audit's finding 5, and the same class of defect as finding 1 in
 * `details-sweep.test.ts`: a budget that counted only its fetches. `probe()`
 * can cost two fetches per URL, and until 2026-09-06 the verdicts were written
 * one D1 statement at a time — so twenty URLs cost 40 + 22 = ~62 against a
 * free-plan ceiling of 50.
 *
 * 🔴 **Why this needs a test rather than a careful comment.** Exceeding the
 * subrequest budget does not throw. The invocation is TERMINATED — no
 * exception, no `catch`, no log line — so the writes at the end of the run
 * simply never happen and the next tick re-probes the same URLs forever. The
 * old code was latent only because `cf.geekdo-images.com` answers HEAD 2xx and
 * the second fetch rarely ran.
 *
 * ⚠️ **The assertions below are the ARITHMETIC and a COUNTED run, never a
 * literal.** `COVER_BATCH === 20` would have been true of the broken value.
 *
 * NOT proved here: that a real Cloudflare invocation counts subrequests the way
 * this file counts them (one per `fetch`, one per D1 call, one per `batch()`
 * whatever its size). That is Cloudflare's documented model, read not measured.
 */

import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  COVER_BATCH,
  SUBREQUEST_CAP,
  SUBREQUESTS_PER_URL,
  SUBREQUEST_RESERVE,
  runCoverCheck,
} from './cover-check.js';

/**
 * A D1 stub that COUNTS, because the number is the point.
 *
 * ⚠️ `batch()` increments by one however many statements it carries — that is
 * the whole reason the fix works, and a stub that counted per statement would
 * quietly assert the opposite.
 */
function countingDb(urls: string[]) {
  const counts = { d1: 0, batches: 0, statementsBatched: 0 };
  const db = {
    prepare(sql: string) {
      const stmt = {
        _sql: sql,
        bind() {
          return stmt;
        },
        async all() {
          counts.d1++;
          return { results: urls.map((url) => ({ url, checked_at: '' })) };
        },
        async first() {
          counts.d1++;
          return { n: 0 };
        },
        async run() {
          counts.d1++;
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      counts.d1++;
      counts.batches++;
      counts.statementsBatched += stmts.length;
      return stmts.map(() => ({ results: [], meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return { db, counts };
}

/** Stand in for the CDNs. `status` decides how many fetches a URL costs. */
function stubFetch(status: number) {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status });
  }) as typeof fetch;
  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = real;
    },
  };
}

let net: ReturnType<typeof stubFetch> | null = null;
afterEach(() => {
  net?.restore();
  net = null;
});

describe('the subrequest budget — finding 5', () => {
  it('🔴 a full run FITS: the arithmetic, not the number', () => {
    const worstCase = COVER_BATCH * SUBREQUESTS_PER_URL + SUBREQUEST_RESERVE;
    assert.ok(
      worstCase <= SUBREQUEST_CAP,
      `a full run costs ${worstCase} subrequests against a ceiling of ${SUBREQUEST_CAP}; ` +
        'over it the invocation is terminated mid-run and nothing is written',
    );
    assert.ok(COVER_BATCH >= 1, 'a run that can never probe a URL is not a run');
  });

  it('🔴 and a run COUNTED end to end fits, in the worst case the code allows', async () => {
    // 403 to a HEAD is the expensive path: `probe()` falls back to a ranged GET,
    // so every URL costs two. This is the case the old code could not pay for.
    const urls = Array.from({ length: COVER_BATCH }, (_, i) => `https://cdn.test/${i}.jpg`);
    const { db, counts } = countingDb(urls);
    net = stubFetch(403);

    const run = await runCoverCheck(db);

    assert.equal(run.checked, COVER_BATCH);
    assert.equal(net.calls, COVER_BATCH * 2, 'every URL took the HEAD-then-GET path');
    const total = net.calls + counts.d1;
    assert.ok(
      total <= SUBREQUEST_CAP,
      `the run spent ${total} subrequests (${net.calls} fetch + ${counts.d1} D1) against ` +
        `a ceiling of ${SUBREQUEST_CAP}`,
    );
  });

  it('⚠️ the verdicts go out as ONE batch, not one statement per URL', async () => {
    // This is the fix itself. A loop here made the "reserve" grow with the batch
    // size, which is exactly what the old `COVER_BATCH = 20` comment missed when
    // it said twenty "leaves headroom for the D1 calls".
    const urls = Array.from({ length: COVER_BATCH }, (_, i) => `https://cdn.test/${i}.jpg`);
    const { db, counts } = countingDb(urls);
    net = stubFetch(200);

    await runCoverCheck(db);

    assert.equal(counts.batches, 1, 'one write call for the whole run');
    assert.equal(counts.statementsBatched, COVER_BATCH, 'and every verdict is in it');
    assert.ok(
      counts.d1 <= SUBREQUEST_RESERVE,
      `the run's D1 cost was ${counts.d1}, budgeted at ${SUBREQUEST_RESERVE}`,
    );
  });

  it('⚠️ a caller asking for more URLs than the budget allows gets the budget, and is TOLD', async () => {
    // Silently honouring it would reintroduce the finding through the back door
    // — and silently is the operative word: the failure it causes writes
    // nothing anywhere, which is why `capped` is in the response rather than in
    // a log nobody reads.
    const urls = Array.from({ length: COVER_BATCH }, (_, i) => `https://cdn.test/${i}.jpg`);
    const { db } = countingDb(urls);
    net = stubFetch(200);

    const run = await runCoverCheck(db, COVER_BATCH * 3);

    assert.match(run.capped ?? '', new RegExp(`capped to ${COVER_BATCH}`));
    assert.equal(run.checked, COVER_BATCH);
  });

  it('a normal run carries no `capped` line — it is a warning, not a field to read', async () => {
    const urls = Array.from({ length: 3 }, (_, i) => `https://cdn.test/${i}.jpg`);
    const { db } = countingDb(urls);
    net = stubFetch(200);

    const run = await runCoverCheck(db, 3);

    assert.equal(run.capped, undefined);
  });

  it('an empty catalog slice writes nothing rather than batching nothing', async () => {
    const { db, counts } = countingDb([]);
    net = stubFetch(200);

    const run = await runCoverCheck(db);

    assert.equal(run.checked, 0);
    assert.equal(counts.batches, 0, 'no probes, no write call');
  });
});
