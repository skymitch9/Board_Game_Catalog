#!/usr/bin/env node
/**
 * Push secrets from apps/worker/.dev.vars to the deployed Worker.
 *
 * `wrangler secret put` prompts for one value at a time, which is why rotating a
 * key took three commands and got the ordering wrong once already — production
 * ended up holding the pre-rotation key while `.dev.vars` held the new one.
 *
 * This makes `.dev.vars` the single source of truth: edit it, run this, done.
 * Values go to wrangler over stdin, never through a temp file and never through
 * the shell, so nothing lands on disk or in shell history.
 *
 *   npm run secrets:push          # push every allowlisted key present
 *   npm run secrets:push -- --dry # show what would be pushed, names only
 *
 * Usage note: this only ever *sets* secrets. Removing one from `.dev.vars` does
 * not delete it in production — use `wrangler secret delete` for that, so a
 * typo here can never quietly strip a live credential.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = join(root, 'apps', 'worker', '.dev.vars');
const CONFIG = join(root, 'apps', 'worker', 'wrangler.toml');

/**
 * An allowlist, not a denylist, and deliberately so: a new local-only variable
 * added to .dev.vars should never reach production just because nobody
 * remembered to exclude it.
 */
const PRODUCTION_SECRETS = ['ANTHROPIC_API_KEY', 'BGG_API_TOKEN', 'GAMEUPC_API_KEY'];

/**
 * Local-only by design. Listed so the script can say *why* it skipped them.
 *
 * ⚠️ The last five entries were added 2026-08-17 for the estate credentials
 * catalog's **F-4**, and they are the reason to read this list before touching
 * the one above it. F-4 observed that `ESTATE_APP_TOKEN_GAMES` and
 * `INDEX_PUSH_TOKEN` are live production secrets, sit in `.dev.vars`, and
 * appear in NEITHER list — so `secrets:push` reports them "not in the
 * allowlist" and skips them, and a session rotating them here would believe it
 * had rotated production. All true. But the obvious repair — moving them into
 * `PRODUCTION_SECRETS` — is **wrong and destructive**, which is why they are
 * here instead.
 *
 * Measured 2026-08-17, before deciding: this repo's `.dev.vars` holds the
 * **LOCAL DEV** values for both, not the production ones. `INDEX_URL` there is
 * `http://127.0.0.1:8788`, `ESTATE_AUTH_URL` is `http://127.0.0.1:8798` and
 * `ESTATE_CHECK` is `off` — a local mock block — and the local
 * `INDEX_PUSH_TOKEN` was confirmed **byte-equal** to the index Worker's own
 * `.dev.vars` `INDEX_PUSH_TOKEN_GAME` (compared as a boolean; no value read,
 * none printed). Allowlisting them would push a **localhost dev token over the
 * live credential** on the next unrelated rotation: the games catalog's estate
 * check would begin answering `estate_unreachable` and its index push would
 * begin 401ing — both silent, both caused by a "cleanup".
 *
 * So the correction is the opposite of the obvious one. The script now KNOWS
 * about these names and says out loud that `.dev.vars` is not their source of
 * truth: `wrangler secret put` is, on both sides, in one sitting.
 */
const LOCAL_ONLY = {
  ENVIRONMENT: 'set in wrangler.toml for production',
  DEV_EMAIL: 'local auth bypass — must never exist in production',
  GAMEUPC_STAGE: 'defaults correctly from whether a key is set',
  // ⚠️ PAIRED in production with catalog-platform's auth Worker, SAME NAME on
  // both sides. Rotate here AND there in one sitting; a one-sided rotation is
  // a 403 that reads exactly like a code bug.
  ESTATE_APP_TOKEN_GAMES:
    'LOCAL DEV value (the 127.0.0.1:8798 mock). Production is set BY HAND — `npx wrangler secret put ESTATE_APP_TOKEN_GAMES`, and the SAME value on catalog-platform auth-worker. Editing it here rotates nothing, and pushing it would overwrite production with a dev token',
  // ⚠️ PAIRED with the index Worker under a DIFFERENT NAME there:
  // `INDEX_PUSH_TOKEN_GAME` (singular _GAME). The value here is that Worker's
  // LOCAL value — verified equal 2026-08-17.
  INDEX_PUSH_TOKEN:
    'LOCAL DEV value (equals index-worker .dev.vars INDEX_PUSH_TOKEN_GAME, for 127.0.0.1:8788). Production is set BY HAND — `npx wrangler secret put INDEX_PUSH_TOKEN`, matching the index Worker’s INDEX_PUSH_TOKEN_GAME. Same warning: pushing this would overwrite production with a dev token',
  INDEX_URL: 'set in wrangler.toml for production; the value here points at local dev',
  ESTATE_AUTH_URL: 'set in wrangler.toml for production; the value here points at a local mock',
  ESTATE_CHECK: 'set in wrangler.toml for production (`off` locally keeps dev quiet)',
};

function parseDevVars(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

let raw;
try {
  raw = readFileSync(DEV_VARS, 'utf8');
} catch {
  console.error(`No .dev.vars at ${DEV_VARS}. Nothing to push.`);
  process.exit(1);
}

const vars = parseDevVars(raw);
const payload = {};
const skipped = [];

for (const key of PRODUCTION_SECRETS) {
  if (vars[key]) payload[key] = vars[key];
  else skipped.push(`${key} — not set locally`);
}
for (const [key, why] of Object.entries(LOCAL_ONLY)) {
  if (vars[key]) skipped.push(`${key} — ${why}`);
}
for (const key of Object.keys(vars)) {
  if (!PRODUCTION_SECRETS.includes(key) && !(key in LOCAL_ONLY)) {
    skipped.push(`${key} — not in the allowlist, add it to PRODUCTION_SECRETS if it belongs`);
  }
}

const names = Object.keys(payload);
// Show a last-4 fingerprint so you can confirm *which* value went up without
// ever printing the secret.
for (const name of names) {
  console.log(`  push  ${name}  (…${payload[name].slice(-4)})`);
}
for (const note of skipped) console.log(`  skip  ${note}`);

if (names.length === 0) {
  console.error('\nNothing to push.');
  process.exit(1);
}

if (process.argv.includes('--dry')) {
  console.log('\nDry run — nothing sent.');
  process.exit(0);
}

// Run wrangler's JS entrypoint under this same node binary rather than the
// `npx` shim. On Windows, Node 20+ refuses to spawn a .cmd directly (EINVAL),
// and the `shell: true` workaround is deprecated for arg-injection reasons —
// this sidesteps both. Secrets go over stdin, never argv, so they never reach a
// command line, a process listing, or shell history.
const WRANGLER = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const child = spawn(process.execPath, [WRANGLER, 'secret', 'bulk', '--config', CONFIG], {
  stdio: ['pipe', 'inherit', 'inherit'],
});

child.stdin.end(JSON.stringify(payload));
child.on('exit', (code) => {
  // wrangler on Windows sometimes prints success then exits non-zero (a libuv
  // teardown quirk), so report rather than trusting the code blindly.
  console.log(
    code === 0
      ? `\nPushed ${names.length} secret${names.length === 1 ? '' : 's'}.`
      : `\nwrangler exited ${code} — read the output above before assuming it failed.`,
  );
  process.exit(0);
});
