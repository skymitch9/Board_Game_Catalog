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
import { decidePushForStaleness, type StalenessCheckInput } from './index-push.js';

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
