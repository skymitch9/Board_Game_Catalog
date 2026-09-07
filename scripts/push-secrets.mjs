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
 *
 * ## `--env <name>` — a SECOND instance (2026-09-05)
 *
 *   npm run secrets:push -- --env games2 --dry
 *
 * ⚠️ There is no second instance today. This is the machinery landing before it
 * (request-a-catalog design §8 item 2), and the important half is what it
 * REFUSES, not what it sends.
 *
 * The library learned this the expensive way and its `push-secrets.mjs` header
 * records the reasoning: the risk of a bulk push to another instance is not the
 * FILE it reads, it is pushing the keys that are THEIRS. So the answer is two
 * explicit lists rather than a second `.dev.vars`:
 *
 * | List | Meaning | A `--env <name>` run |
 * |---|---|---|
 * | `PRODUCTION_SECRETS` minus the two below | one value, every instance | pushed |
 * | `PER_INSTANCE_SECRETS` | each instance has its OWN value | **refused, always** |
 * | `PER_INSTANCE_PREFIXES` | ditto, matched by prefix | **refused, always** |
 * | anything else | not classified | skipped with a sentence, as today |
 *
 * 🔴 `ANTHROPIC_API_KEY` and every `ESTATE_APP_TOKEN_*` are on the refusal side
 * and can never be reached by a bulk run at another instance. The key is that
 * household's spend on their own billing; the bearer is *which consumer is
 * speaking to the estate directory*, and two instances are two consumers. A
 * "cleanup" push that overwrote either would be silent: the second instance's
 * estate check would start answering `estate_unreachable` and its bills would
 * land on the owner, with nothing going red.
 *
 * ⚠️ **`.dev.vars.<instance>` does not exist and must not be created.** It is
 * not read here for any flag. Creating one would be a custody change, not a
 * missing file to fill in.
 *
 * ⚠️ The no-flag path is UNCHANGED, deliberately and byte-for-byte: it pushes
 * the main instance exactly as it did before this flag existed.
 *
 * ## Importable since 2026-09-05 (phase 9) — the lists have ONE home
 *
 * `scripts/provision-catalog.mjs` classifies a new instance's secrets and must
 * make exactly the decisions this file makes. So the lists, the classifier and
 * the `.dev.vars` parser are EXPORTED and imported there rather than restated:
 * a second copy of a refusal list is a second copy that drifts, and the drifted
 * one is always the check that mattered. `library_catalog`'s provisioner imports
 * its own repo's lists for the same reason.
 *
 * ⚠️ The program half therefore runs only when this file IS the entrypoint. The
 * behaviour of `node scripts/push-secrets.mjs …` is unchanged; importing it no
 * longer runs it.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { classifyWranglerExit } from './lib/wrangler-exit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = join(root, 'apps', 'worker', '.dev.vars');
const CONFIG = join(root, 'apps', 'worker', 'wrangler.toml');

/**
 * An allowlist, not a denylist, and deliberately so: a new local-only variable
 * added to .dev.vars should never reach production just because nobody
 * remembered to exclude it.
 */
export const PRODUCTION_SECRETS = ['ANTHROPIC_API_KEY', 'BGG_API_TOKEN', 'GAMEUPC_API_KEY'];

/**
 * Keys each instance must hold its OWN value of. A `--env <name>` run refuses
 * these outright; the no-flag (main) run is untouched by them.
 *
 * - `ANTHROPIC_API_KEY` — a second household's research spend is on THEIR
 *   billing with THEIR cap. ⚠️ The one documented exception is a provisioning
 *   decision the owner made on the record for v1 (request-a-catalog design §9
 *   Q3: *"Have it fall back to my Claude key for now"*), and even then it is set
 *   deliberately, one key at a time, by the provisioner — never swept in by a
 *   bulk run that was aimed at something else.
 * - `INDEX_PUSH_TOKEN` — per-SOURCE on the index Worker: it tells its machine
 *   callers apart BY THE VALUE, so a second games instance is a second source.
 */
export const PER_INSTANCE_SECRETS = ['ANTHROPIC_API_KEY', 'INDEX_PUSH_TOKEN'];

/**
 * Prefix rule, so a consumer nobody has thought of yet is refused by DEFAULT
 * rather than by memory. `ESTATE_APP_TOKEN_*` asserts *which consumer is
 * speaking to the estate directory* (see `apps/worker/src/lib/estate-app.ts`),
 * and no two instances may ever present the same one.
 */
export const PER_INSTANCE_PREFIXES = ['ESTATE_APP_TOKEN_'];

/** True for a key each instance must hold its own copy of. */
export function isPerInstance(name) {
  return PER_INSTANCE_SECRETS.includes(name) || PER_INSTANCE_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * WHY a key is per-instance, in one sentence, for a caller that has to explain
 * itself to a person (`provision-catalog.mjs` prints these beside its plan).
 *
 * ⚠️ Reasons, never rules: `isPerInstance()` above is the decision. A name with
 * no sentence here gets the generic one rather than slipping through.
 */
export function perInstanceReason(name) {
  if (name === 'ANTHROPIC_API_KEY') {
    return "that household's research spend, on their own billing and their own cap — the one documented exception is the owner's standing v1 decision, set deliberately, one key at a time, by the provisioner";
  }
  if (name === 'INDEX_PUSH_TOKEN') {
    return 'the index Worker tells its machine callers apart BY THE VALUE, so a second games instance is a second source';
  }
  if (name.startsWith('ESTATE_APP_TOKEN_')) {
    return 'it asserts WHICH consumer is speaking to the estate directory, and two instances are two consumers';
  }
  return 'each instance holds its own value';
}

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
export const LOCAL_ONLY = {
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
  ESTATE_APP:
    'set in wrangler.toml per env — the instance identity is config of record, not a secret (apps/worker/src/lib/estate-app.ts)',
  // The SECOND instance's estate bearer, named here so a bulk run says WHY it
  // skipped it rather than reporting an unclassified key. It is ALSO per-
  // instance by the ESTATE_APP_TOKEN_ prefix rule, so a `--env` run refuses it
  // twice over. No instance holds a value for it today.
  ESTATE_APP_TOKEN_GAMES2:
    'the SECOND instance’s estate bearer — set with `npm run secret:games2 -- ESTATE_APP_TOKEN_GAMES2`, never pushed from here',
};

/**
 * ⚠️ A refusal list that names nothing is not a refusal list.
 *
 * `PER_INSTANCE_SECRETS` only bites on keys a run could otherwise send, so a key
 * renamed in `PRODUCTION_SECRETS` (or dropped from `LOCAL_ONLY`) without being
 * renamed here leaves the refusal silently inert — the exact silent-failure
 * shape the whole design exists to prevent. Fails at startup, before anything
 * can be pushed, rather than at the moment it would have mattered.
 */
export function assertRefusalListIsLive() {
  const known = new Set([...PRODUCTION_SECRETS, ...Object.keys(LOCAL_ONLY)]);
  const orphans = PER_INSTANCE_SECRETS.filter((name) => !known.has(name));
  if (orphans.length) {
    throw new Error(
      `push-secrets: PER_INSTANCE_SECRETS names ${orphans.join(', ')}, which appear in neither ` +
        'PRODUCTION_SECRETS nor LOCAL_ONLY. A refusal for a key nothing would send is inert — ' +
        'either the key was renamed and this list was not, or it no longer belongs here.',
    );
  }
}

/**
 * Is this file the program being run, or a module somebody imported?
 *
 * ⚠️ Everything below the guard is the PROGRAM and must not run on import —
 * `provision-catalog.mjs` imports the lists above and would otherwise push
 * secrets by the act of loading them.
 */
const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

// Still at load, still before anything can be pushed — but a THROW rather than
// an exit, so an importer sees the failure instead of the process vanishing.
try {
  assertRefusalListIsLive();
} catch (err) {
  if (!isEntrypoint) throw err;
  console.error(err.message);
  process.exit(1);
}

/**
 * `--env <name>` / `--instance <name>`: target a second instance. Absent = the
 * main instance, and that path must stay exactly what it was.
 */
function parseInstance(argv) {
  for (const flag of ['--env', '--instance']) {
    const i = argv.indexOf(flag);
    if (i === -1) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('-')) {
      console.error(`push-secrets: ${flag} needs an instance name, e.g. \`${flag} games2\`.`);
      process.exit(1);
    }
    // This reaches a child process argument list; keep it to a wrangler env name.
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      console.error(`push-secrets: "${value}" is not a usable wrangler environment name.`);
      process.exit(1);
    }
    return value;
  }
  return null;
}

/**
 * `.dev.vars` → `{ NAME: value }`. Exported because `provision-catalog.mjs`
 * reads the same file for the same reason and must parse it identically; a
 * second parser is a second set of quoting bugs.
 *
 * ⚠️ A caller holds VALUES after this. Nothing may print, log or write one.
 */
export function parseDevVars(text) {
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

// ─── the PROGRAM ────────────────────────────────────────────────────────────
// Everything from here down runs only when this file is the entrypoint.

if (isEntrypoint) main();

function main() {
const instance = parseInstance(process.argv);

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
  // 🔴 The refusal, and it comes BEFORE "is it set locally" on purpose: a key
  // that happens to be absent from .dev.vars today must still report as refused,
  // or the reason it was not sent looks like an accident that a later edit fixes.
  if (instance && isPerInstance(key)) {
    skipped.push(
      `${key} — REFUSED for instance "${instance}": each instance holds its own value. ` +
        `Set it one at a time with \`npm run secret:${instance} -- ${key}\`.`,
    );
    continue;
  }
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

// 🔴 THE GUARD THAT DOES NOT DEPEND ON THE LOOPS ABOVE BEING RIGHT. A list edit,
// a reordered branch or a future flag could all put a per-instance key back into
// the payload; this refuses the WHOLE run at the last moment before anything is
// sent, naming the key and never the value.
if (instance) {
  const leaked = names.filter(isPerInstance);
  if (leaked.length) {
    console.error(
      `\npush-secrets: refusing the whole run — ${leaked.join(', ')} would have been sent to ` +
        `instance "${instance}", and each instance must hold its own value. This is a bug in ` +
        'the lists above, not something to work around: fix PER_INSTANCE_SECRETS / ' +
        'PER_INSTANCE_PREFIXES, or set the key one at a time with ' +
        `\`npm run secret:${instance} -- <NAME>\`.`,
    );
    process.exit(1);
  }
}

console.log(
  instance
    ? `push-secrets: target = instance "${instance}" (wrangler --env ${instance})`
    : 'push-secrets: target = the MAIN instance',
);
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

// ⚠️ PIPED, not inherited, so this process can READ what wrangler said — which
// is the gotcha's own advice ("read the output, not the exit code") and what
// `classifyWranglerExit` needs. Every chunk is written straight through, so a
// person watching sees exactly what they saw before; the buffer is a copy.
// ⚠️ Secrets still never appear here: they go up over stdin, and wrangler's
// output names keys, not values.
const child = spawn(
  process.execPath,
  [WRANGLER, 'secret', 'bulk', '--config', CONFIG, ...(instance ? ['--env', instance] : [])],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);

let transcript = '';
for (const [stream, out] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on('data', (chunk) => {
    transcript += chunk.toString();
    out.write(chunk);
  });
}

child.stdin.end(JSON.stringify(payload));
child.on('exit', (code) => {
  /*
    🔴 This used to be `process.exit(0)` unconditionally — including in the
    branch that had just printed "wrangler exited N".

    The exit(0) was a deliberate mitigation for the Windows quirk where wrangler
    prints a clean success and then exits non-zero on a libuv teardown. But it
    forgave EVERY non-zero exit, so a genuine failure — bad credentials, a
    Worker that does not exist, a rejected payload — was reported to any `&&`
    chain or CI as a successful secret push. Silently, and in the direction that
    costs a day: you believe production has been rotated. 2026-08 audit,
    finding 21.

    `classifyWranglerExit` keeps the two apart by reading the OUTPUT, which is
    what the gotcha said to do all along.
  */
  const verdict = classifyWranglerExit({ code, output: transcript });
  console.log(
    verdict.ok
      ? `\nPushed ${names.length} secret${names.length === 1 ? '' : 's'}. (${verdict.reason})`
      : `\nPUSH FAILED — ${verdict.reason}`,
  );
  process.exit(verdict.exitCode);
});
}
