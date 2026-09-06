/**
 * `decidePushForStaleness` — the data-aware staleness gate (2026-08-15 fix
 * for the class where backfill scripts write D1 directly, bypassing every
 * mutation route, and a clock-only backstop cannot tell that happened). Pure
 * function, no D1/fetch, so these pin the decision table directly rather than
 * standing up a fake Worker environment. (Library twin of this test:
 * bookbuddy/library_catalog apps/worker/src/lib/index-push.test.ts.)
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decidePushForStaleness, resolveIndexSource, type StalenessCheckInput } from './index-push.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse('2026-08-15T12:00:00.000Z');

function input(overrides: Partial<StalenessCheckInput> = {}): StalenessCheckInput {
  return {
    rows: 800,
    pushedAtIso: new Date(NOW - HOUR_MS).toISOString(), // pushed 1h ago
    latestSourceUpdateMs: NOW - 2 * HOUR_MS, // last data change 2h ago — before the push
    nowMs: NOW,
    maxAgeMs: DAY_MS,
    ...overrides,
  };
}

test('skips when the index is fresh and nothing has changed since the last push', () => {
  const decision = decidePushForStaleness(input());
  assert.equal(decision.push, false);
});

test('pushes when the index reports zero rows', () => {
  const decision = decidePushForStaleness(input({ rows: 0 }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /zero rows/);
});

test('pushes when rows is null/undefined (health shape missing the source)', () => {
  assert.equal(decidePushForStaleness(input({ rows: null })).push, true);
  assert.equal(decidePushForStaleness(input({ rows: undefined })).push, true);
});

test('pushes when pushed_at is missing', () => {
  const decision = decidePushForStaleness(input({ pushedAtIso: null }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /pushed_at/);
});

test('pushes when pushed_at does not parse', () => {
  const decision = decidePushForStaleness(input({ pushedAtIso: 'not-a-date' }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /pushed_at/);
});

test('pushes when the last push is older than maxAgeMs (the original clock check)', () => {
  const decision = decidePushForStaleness(
    input({ pushedAtIso: new Date(NOW - 25 * HOUR_MS).toISOString(), latestSourceUpdateMs: null }),
  );
  assert.equal(decision.push, true);
  assert.match(decision.reason, /old/);
});

test('⚠️ THE FIX: pushes when data moved after the last push, even though the push is young', () => {
  // A push landed 5 minutes ago (well inside the 24h tolerance), but a
  // backfill script touched `item` 1 minute ago — after that push. The old
  // clock-only check would call this fresh and skip; that is exactly the
  // incident (a games universe row stayed stale until someone triggered a
  // mutation by hand). The fix must push here.
  const decision = decidePushForStaleness(
    input({
      pushedAtIso: new Date(NOW - 5 * 60_000).toISOString(),
      latestSourceUpdateMs: NOW - 60_000,
    }),
  );
  assert.equal(decision.push, true);
  assert.match(decision.reason, /source data changed/);
});

test('does not push when data last changed BEFORE the last push', () => {
  const decision = decidePushForStaleness(
    input({
      pushedAtIso: new Date(NOW - 60_000).toISOString(),
      latestSourceUpdateMs: NOW - 5 * 60_000,
    }),
  );
  assert.equal(decision.push, false);
});

test('does not push when data changed exactly at the push instant (not strictly after)', () => {
  const pushedAt = NOW - 60_000;
  const decision = decidePushForStaleness(
    input({ pushedAtIso: new Date(pushedAt).toISOString(), latestSourceUpdateMs: pushedAt }),
  );
  assert.equal(decision.push, false);
});

test('treats a null latestSourceUpdateMs (empty item table) as "nothing to compare" rather than forcing a push', () => {
  const decision = decidePushForStaleness(input({ latestSourceUpdateMs: null }));
  assert.equal(decision.push, false);
});

/* --------------------------------------------------------------------------
 * resolveIndexSource — which shelf THIS instance's rows are filed under
 *
 * 🔴 THE BUG THIS CLOSES IS DESTRUCTIVE, NOT COSMETIC. The index's write
 * protocol is a snapshot replace keyed on `entry.source`: a push under `game`
 * DELETES every `game` row first. Until 2026-09-06 this Worker hard-coded
 * `game`, so the pre-declared `[env.games2]` instance would have wiped the
 * main catalog's entire index shelf on its first push — and whichever
 * instance pushed last would have been the estate's whole board-game
 * collection. `index-worker-design.md` §11.1 makes exactly this argument for
 * `library2`; the games side had the argument and not the code.
 * ------------------------------------------------------------------------ */

test('unset ESTATE_APP is the MAIN instance — `game`, the value that was hard-coded', () => {
  // ⚠️ This is the "ships inert" assertion. If it ever fails, this change
  // stopped being a no-op for the live catalog.
  assert.equal(resolveIndexSource(undefined), 'game');
  assert.equal(resolveIndexSource(''), 'game');
  assert.equal(resolveIndexSource('   '), 'game');
});

test('🔴 `games` → `game` — the ONE vocabulary difference in the estate', () => {
  // The estate's visibility word is `games`; the index's push word is `game`.
  // index-worker/src/search-route.ts SOURCE_FOR_CATALOG owns that fact; this
  // is the same fact on the sending side.
  assert.equal(resolveIndexSource('games'), 'game');
});

test('🔴 a SECOND instance pushes as ITSELF — never as `game`, and never plural-stripped', () => {
  // The whole point: `games2` must not collide with `game`, and must not be
  // silently rewritten to `game2` either — the index has to be taught the
  // exact word, and a guess would 404 at best.
  assert.equal(resolveIndexSource('games2'), 'games2');
  assert.equal(resolveIndexSource('quarry'), 'quarry');
});

test('⚠️ a value that is not a plain path segment pushes NOTHING, rather than somewhere else', () => {
  // The value is interpolated into a URL path. `null` is the inert direction.
  for (const bad of ['../library', 'Games2', 'games 2', 'games/2', 'games-2', 'g'.repeat(33), '2games']) {
    assert.equal(resolveIndexSource(bad), null, `${JSON.stringify(bad)} must not become a source`);
  }
});
