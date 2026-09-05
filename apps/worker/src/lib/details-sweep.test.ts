/**
 * The hourly missing-details sweep.
 *
 * These tests exist for the failure modes a scheduled job has that a request
 * does not: nobody is watching, there is no response to go wrong, and
 * (measured 2026-08-13) this Worker's scheduled logs defeated three separate
 * `wrangler tail` attempts. So the properties worth pinning are "it never
 * throws", "it respects the cap", and "it counts honestly" — a sweep that
 * silently did nothing would look exactly like a sweep with nothing to do.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * The module under test imports `@bgc/db` and `./details-run.js`, neither of
 * which can run here. Rather than reach for a mocking framework this repo does
 * not have, the sweep's LOOP is re-expressed against injected functions —
 * the same control flow, the same counting, exercised directly.
 *
 * ⚠️ This is a copy of the logic, which is a real cost: it can drift from
 * details-sweep.ts. Kept deliberately because the alternative (no test at all
 * on a job nobody watches) is worse, and because the shape being pinned —
 * cap, skip-if-running, count-by-outcome, never-throw — is stable even if the
 * surrounding code moves. If the real loop changes, change this with it.
 */
async function sweepLoop(opts: {
  items: { id: number }[];
  claim: (id: number) => Promise<{ runId: number; alreadyRunning: boolean }>;
  lookup: (runId: number, id: number) => Promise<{ status: string; filled: Record<string, unknown> } | null>;
}) {
  const r = { attempted: 0, filled: 0, notFound: 0, errored: 0, skipped: [] as string[] };
  for (const item of opts.items) {
    try {
      const { runId, alreadyRunning } = await opts.claim(item.id);
      if (alreadyRunning) { r.skipped.push(`#${item.id} already running`); continue; }
      r.attempted += 1;
      const done = await opts.lookup(runId, item.id);
      if (!done || done.status === 'error') r.errored += 1;
      else if (Object.keys(done.filled ?? {}).length > 0) r.filled += 1;
      else r.notFound += 1;
    } catch (err) {
      r.errored += 1;
      r.skipped.push(`#${item.id}: ${(err as Error).message}`);
    }
  }
  return r;
}

const claimOk = async (id: number) => ({ runId: id * 10, alreadyRunning: false });

test('counts a filled row, a not-found row and an error separately', async () => {
  const r = await sweepLoop({
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    claim: claimOk,
    lookup: async (_run, id) => {
      if (id === 1) return { status: 'done', filled: { publisher: 'Acme' } };
      if (id === 2) return { status: 'done', filled: {} }; // could not identify
      return { status: 'error', filled: {} };
    },
  });
  assert.equal(r.attempted, 3);
  assert.equal(r.filled, 1);
  // ⚠️ not-found is NOT an error. runDetailsLookup finishes it `done` on
  // purpose, because a retry would cost the same and return the same nothing.
  assert.equal(r.notFound, 1);
  assert.equal(r.errored, 1);
});

test('a row already being looked at by a person is skipped, not fought over', async () => {
  const r = await sweepLoop({
    items: [{ id: 1 }, { id: 2 }],
    claim: async (id) => ({ runId: id, alreadyRunning: id === 1 }),
    lookup: async () => ({ status: 'done', filled: { year: 1999 } }),
  });
  assert.equal(r.attempted, 1, 'only the unclaimed row is attempted');
  assert.deepEqual(r.skipped, ['#1 already running']);
});

test('one throwing row does not end the tick', async () => {
  // The property that matters most: a single bad row must not cost the other
  // seven their turn, and must not escape into waitUntil where nothing sees it.
  const r = await sweepLoop({
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    claim: async (id) => {
      if (id === 2) throw new Error('D1 hiccup');
      return claimOk(id);
    },
    lookup: async () => ({ status: 'done', filled: { publisher: 'X' } }),
  });
  assert.equal(r.filled, 2, 'rows either side of the failure still ran');
  assert.equal(r.errored, 1);
  assert.match(r.skipped[0] ?? '', /#2: D1 hiccup/);
});

test('a null lookup result counts as an error, never as success', async () => {
  // runDetailsLookup returns null only when even finishRun failed — the
  // database is gone. Counting that as "done" would report a healthy sweep
  // while nothing was written.
  const r = await sweepLoop({
    items: [{ id: 1 }],
    claim: claimOk,
    lookup: async () => null,
  });
  assert.equal(r.errored, 1);
  assert.equal(r.filled, 0);
  assert.equal(r.notFound, 0);
});

test('an empty queue does nothing at all', async () => {
  const r = await sweepLoop({ items: [], claim: claimOk, lookup: async () => null });
  assert.deepEqual(r, { attempted: 0, filled: 0, notFound: 0, errored: 0, skipped: [] });
});

test('the cap is the per-hour cost ceiling, and it is small', async () => {
  // Guards the money, not the code: the queue is asked for at most SWEEP_LIMIT
  // rows, so an import of 700 items converges over hours instead of spending
  // ~£8 in one tick. If someone raises this, they should have to change a test
  // that says why it was low.
  const { SWEEP_LIMIT } = await import('./details-sweep.js');
  assert.ok(SWEEP_LIMIT <= 10, `SWEEP_LIMIT is ${SWEEP_LIMIT}; each row costs real money`);
});

test('🔴 one tick FITS IN ONE INVOCATION — the subrequest budget, not a taste', async () => {
  // The 2026-08 audit's finding 1: eight rows at ~11 subrequests each shared
  // ONE scheduled invocation, ~91 against a ceiling of 50. Going over does not
  // throw — it TERMINATES the invocation, so the tail of the sweep died in
  // silence while the rows Claude had already been paid for looked like the
  // whole tick.
  //
  // ⚠️ The assertion is the arithmetic, not the number. `SWEEP_LIMIT <= 10`
  // above was true of the broken value and would not have caught this; a test
  // that only pins a literal moves with whoever edits the literal.
  const { SWEEP_LIMIT, SUBREQUEST_CAP, SUBREQUESTS_PER_ITEM, SUBREQUEST_RESERVE } =
    await import('./details-sweep.js');
  const worstCase = SWEEP_LIMIT * SUBREQUESTS_PER_ITEM + SUBREQUEST_RESERVE;
  assert.ok(
    worstCase <= SUBREQUEST_CAP,
    `a full tick costs ${worstCase} subrequests against a ceiling of ${SUBREQUEST_CAP}; ` +
      'over it the invocation is terminated mid-sweep and nothing is logged',
  );
  assert.ok(SWEEP_LIMIT >= 1, 'a sweep that can never attempt a row is not a sweep');
});

test('⚠️ a caller asking for more rows than the budget allows gets the budget, and is told', async () => {
  // The `limit` parameter is a convenience, not an escape hatch. Silently
  // honouring it would reintroduce finding 1 through the back door — and
  // silently is the operative word: the failure it causes writes nothing
  // anywhere.
  const { runDetailsSweep, SWEEP_LIMIT } = await import('./details-sweep.js');
  // A stub DB, so `listItemsNeedingDetails` throws, the sweep records that and
  // returns — enough to read the cap line without a database anywhere near it.
  const env = { ANTHROPIC_API_KEY: 'not-a-real-key', DB: {} } as never;
  const result = await runDetailsSweep(env, 40);
  assert.ok(
    result.skipped.some((s) => s.includes(`capped to ${SWEEP_LIMIT}`)),
    `expected a cap line, got ${JSON.stringify(result.skipped)}`,
  );
});

test('the cron string the handler dispatches on matches wrangler.toml', async () => {
  // These are two separate files and the match is by string. A rename in one
  // stops the sweep firing and reports nothing at all.
  const { DETAILS_SWEEP_CRON } = await import('./details-sweep.js');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  // fileURLToPath, not a URL object: the Workers TS lib's URL is not the
  // node:url URL, and readFileSync(URL) fails to typecheck across them.
  const toml = readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href), 'utf8');
  assert.ok(
    toml.includes(`"${DETAILS_SWEEP_CRON}"`),
    `wrangler.toml has no cron entry "${DETAILS_SWEEP_CRON}" — the sweep would never fire`,
  );
});
