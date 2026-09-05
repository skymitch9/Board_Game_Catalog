/**
 * `/api/export.json`'s allow-list and its email gate — the 2026-08 audit's
 * finding 4, the one finding with present-tense impact.
 *
 * The exposure: the route is `editCatalog` (contributor+), and the ratings
 * query joined `app_user` and selected `u.email`, so any contributor who
 * pressed Export downloaded every household account's address.
 *
 * ⚠️ Two properties are worth a test and one is not obvious. That admins keep
 * their emails is the easy half; the half that matters is that **the query
 * cannot regrow `ui.*`**, because that is how the address arrived in the first
 * place — as a convenience on a join nobody re-read.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ROLES } from '@bgc/core';
import {
  EMAIL_CAPABILITY,
  USER_ITEM_COLUMNS,
  canExportEmails,
  exportOmissions,
  userItemQuery,
} from './export-fields.js';

test('🔴 only admin and owner get the account emails', () => {
  // The whole finding in one assertion. `contributor` and `moderator` hold
  // `editCatalog`, so they reach this route — and must not reach the addresses.
  const allowed = ROLES.filter((r) => canExportEmails(r));
  assert.deepEqual([...allowed].sort(), ['admin', 'owner']);
});

test('⚠️ the gate is NOT the route’s own capability', () => {
  // Reusing `editCatalog` here would leave the exposure exactly where it was,
  // while looking like a fix.
  assert.notEqual(EMAIL_CAPABILITY as string, 'editCatalog');
  assert.equal(EMAIL_CAPABILITY, 'manageUsers');
});

test('🔴 the ratings query is default-deny — it never selects ui.*', () => {
  for (const withEmail of [true, false]) {
    const sql = userItemQuery(withEmail);
    assert.ok(!sql.includes('ui.*'), `ui.* is back in the export (withEmail=${withEmail})`);
    assert.ok(!sql.includes('u.*'), `u.* is in the export (withEmail=${withEmail})`);
    for (const column of USER_ITEM_COLUMNS) {
      assert.ok(sql.includes(`ui.${column}`), `the export lost user_item.${column}`);
    }
  }
});

test('u.email appears in exactly one of the two queries', () => {
  assert.ok(userItemQuery(true).includes('u.email'));
  assert.ok(!userItemQuery(false).includes('u.email'), 'the withheld query still carries the email');
});

test('⚠️ an export that withholds something SAYS SO', () => {
  // A backup that cannot tell you what it is missing is a backup that lies
  // quietly: "no email key" would otherwise read as "the accounts had none".
  assert.deepEqual(exportOmissions(true), []);
  const omitted = exportOmissions(false);
  assert.equal(omitted.length, 1);
  assert.match(omitted[0] ?? '', /email/);
  assert.match(omitted[0] ?? '', /admin/, 'the sentence must say how to get the full export');
});

test('🔴 the allow-list matches the LIVE user_item schema — the drift guard', () => {
  // A default-deny list has one failure mode: a migration adds a column and the
  // backup silently stops carrying it, discovered on restore day. So the list
  // is pinned against `migrations/`, the same trick billing-gate.test.ts plays
  // on wrangler.toml — two files, one fact, checked mechanically.
  const dir = fileURLToPath(new URL('../../../../migrations/', import.meta.url).href);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  // The last CREATE TABLE that defines user_item wins — the table has been
  // rebuilt three times (0023, 0024, 0027 stash-and-restore; 0028 rebuilt it
  // for half-star ratings), and only the newest body describes it today.
  let body: string | null = null;
  const added: string[] = [];
  for (const file of files) {
    const sql = readFileSync(dir + file, 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE (user_item|user_item_new)\s*\(([\s\S]*?)\n\);/g)) {
      body = m[2] ?? null;
      added.length = 0; // a rebuild supersedes every earlier ALTER
    }
    for (const m of sql.matchAll(/ALTER TABLE user_item\s+ADD COLUMN\s+(\w+)/gi)) {
      if (m[1]) added.push(m[1]);
    }
  }
  assert.ok(body, 'no CREATE TABLE user_item found in migrations/ — has the table been renamed?');

  // ⚠️ Split on TOP-LEVEL commas, not on newlines. `rating`'s CHECK is a
  // multi-line expression, and a per-line reading picked its `OR` and `AND`
  // continuations up as column names.
  const defs: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body as string) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      defs.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  defs.push(current);

  const columns = defs
    .map((def) =>
      def
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('--'))
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
    // Table-level constraints are not columns.
    .filter((def) => !/^(UNIQUE|PRIMARY KEY|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(def))
    .map((def) => def.split(/\s+/)[0])
    .filter((name): name is string => typeof name === 'string' && /^\w+$/.test(name));

  const live = [...new Set([...columns, ...added])];
  assert.deepEqual(
    live,
    [...USER_ITEM_COLUMNS],
    'migrations/ and USER_ITEM_COLUMNS disagree — a column would be dropped from every backup',
  );
});
