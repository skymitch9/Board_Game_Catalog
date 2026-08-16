/**
 * The scan-history query — the paged read behind "which photo produced this?".
 *
 * What is worth pinning here is the *paging*, because it is the part that can
 * be wrong invisibly: a mis-clamped page shows an empty screen over a full
 * table, a missing tiebreak lets one row appear on two pages, and an unbounded
 * read is exactly the 50-row cap problem this query exists to replace. The
 * arithmetic is pure and tested directly; the query is exercised against a
 * recording stand-in for D1, which is enough to pin what SQL is asked for and
 * how its answers are mapped, though not SQLite's own execution of it.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  historyPagePosition,
  listScanJobHistory,
  SCAN_HISTORY_PAGE_SIZE,
} from '@bgc/db';

type Db = Parameters<typeof listScanJobHistory>[0];

/** A D1 that answers from fixtures and writes down every question asked. */
function fakeDb(opts: { total: number; rows?: Record<string, unknown>[] }) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, binds: [] as unknown[] };
      calls.push(call);
      const stmt = {
        bind(...args: unknown[]) {
          call.binds = args;
          return stmt;
        },
        async first() {
          return { total: opts.total };
        },
        async all() {
          return { results: opts.rows ?? [] };
        },
      };
      return stmt;
    },
  };
  return { calls, db: db as unknown as Db };
}

/** A plausible row exactly as D1 returns it — snake_case, the lot. */
const row = (id: number): Record<string, unknown> => ({
  id,
  status: 'done',
  mode: 'shelf',
  photo_key: 'not-stored',
  raw_titles: '[]',
  enriched: '[{"title":"Catan","addedItemId":7}]',
  error: null,
  created_at: '2026-08-10 12:00:00',
  processed_at: '2026-08-10 12:00:05',
  reviewed_at: '2026-08-10 12:01:00',
});

test('page arithmetic: nonsense and out-of-range pages land somewhere real', () => {
  // No page asked for, or garbage, is page 1.
  assert.deepEqual(historyPagePosition(undefined, 100, 20), {
    page: 1,
    pageCount: 5,
    offset: 0,
  });
  assert.equal(historyPagePosition(0, 100, 20).page, 1);
  assert.equal(historyPagePosition(-3, 100, 20).page, 1);
  // Page 9 of 5 is page 5, not an empty screen — a stale link should land on
  // the last page, the same forgiveness the collection pager gives.
  assert.deepEqual(historyPagePosition(9, 100, 20), {
    page: 5,
    pageCount: 5,
    offset: 80,
  });
});

test('page arithmetic: an empty table still has one (empty) page', () => {
  // pageCount is never 0: "page 1 of 1" with nothing on it is a sentence the
  // pager can render, "page 1 of 0" is not.
  assert.deepEqual(historyPagePosition(1, 0, 20), { page: 1, pageCount: 1, offset: 0 });
  assert.deepEqual(historyPagePosition(50, 0, 20), { page: 1, pageCount: 1, offset: 0 });
});

test('page arithmetic: a partial last page still counts as a page', () => {
  const { pageCount, offset } = historyPagePosition(2, 21, 20);
  assert.equal(pageCount, 2, '21 rows at 20 a page is two pages, not one');
  assert.equal(offset, 20, 'the second page starts after the first, full one');
});

test('an empty table answers without running the row query at all', async () => {
  const { calls, db } = fakeDb({ total: 0 });
  const result = await listScanJobHistory(db);
  assert.deepEqual(result, {
    jobs: [],
    total: 0,
    page: 1,
    pageSize: SCAN_HISTORY_PAGE_SIZE,
    pageCount: 1,
  });
  assert.equal(calls.length, 1, 'only the COUNT ran; there was nothing to page');
  assert.match(calls[0]!.sql, /COUNT\(\*\)/);
});

test('a requested page turns into the right LIMIT/OFFSET binds', async () => {
  const { calls, db } = fakeDb({ total: 45, rows: [row(5)] });
  const result = await listScanJobHistory(db, { page: 2 });

  const rowQuery = calls[1];
  assert.ok(rowQuery, 'the row query ran after the count');
  assert.deepEqual(
    rowQuery.binds,
    [SCAN_HISTORY_PAGE_SIZE, SCAN_HISTORY_PAGE_SIZE],
    'page 2 is LIMIT pageSize OFFSET pageSize',
  );
  // The tiebreak is load-bearing, not style: created_at is second-resolution
  // and a multi-photo upload creates several jobs inside one second. Without
  // `id DESC` their relative order is undefined per query, so a row could show
  // on two pages — or neither — as the reader pages through.
  assert.match(rowQuery.sql, /ORDER BY created_at DESC, id DESC/);
  assert.equal(result.page, 2);
  assert.equal(result.pageCount, 3, '45 rows at 20 a page');
});

test('a page past the end is clamped before the query, not after', async () => {
  const { calls, db } = fakeDb({ total: 25, rows: [row(1)] });
  const result = await listScanJobHistory(db, { page: 99 });
  assert.equal(result.page, 2, 'page 99 of 2 lands on 2');
  assert.deepEqual(
    calls[1]!.binds,
    [SCAN_HISTORY_PAGE_SIZE, SCAN_HISTORY_PAGE_SIZE],
    'the OFFSET asked of the database is the clamped one',
  );
});

test('rows come back camelCased, with nothing dropped on the floor', async () => {
  const { db } = fakeDb({ total: 1, rows: [row(9)] });
  const { jobs } = await listScanJobHistory(db);
  assert.deepEqual(jobs, [
    {
      id: 9,
      status: 'done',
      mode: 'shelf',
      photoKey: 'not-stored',
      rawTitles: '[]',
      // Kept verbatim: the per-title addedItemId/dismissed record IS the
      // history, and the page parses it client-side.
      enriched: '[{"title":"Catan","addedItemId":7}]',
      error: null,
      createdAt: '2026-08-10 12:00:00',
      processedAt: '2026-08-10 12:00:05',
      reviewedAt: '2026-08-10 12:01:00',
    },
  ]);
});
