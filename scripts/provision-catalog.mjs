#!/usr/bin/env node
/**
 * Stand up a SECOND (third, fourth…) games instance from an accepted
 * `catalog_request` row — the GAMES half of the owner-run provisioner,
 * `catalog-platform/docs/info/request-a-catalog-design.md` §7.6, phase 9 of §10.
 *
 * ## 🔴 It is NEVER web-triggered
 *
 * The owner runs it on his own machine, with his own wrangler login, from a
 * clean tree. Accepting a request in `/admin` sets a status and nothing else
 * (design §1: *"Accept never deploys"*); this script is the thing a person runs
 * afterwards. There is no route, no queue consumer and no cron that reaches it,
 * and there must not be: it creates databases, buckets, hostnames and secrets.
 *
 *   npm run provision:catalog -- --request 7 --dry      # print everything, touch nothing
 *   npm run provision:catalog -- --request 7            # do it, stopping at each manual step
 *   npm run provision:catalog -- --request 7 --resume   # continue after a manual step
 *
 * ## 🔴 THIS IS A DELIBERATE NEAR-DUPLICATE OF `library_catalog`'s PROVISIONER
 *
 * `bookbuddy/library_catalog/scripts/provision-catalog.mjs` is its twin, and the
 * two are **NOT interchangeable**. They share a shape — twelve numbered
 * idempotent steps, the same flags, the same two PAUSEs, the same stdin-only
 * secret transport — and nothing else, because everything they touch differs:
 *
 * | | books | games |
 * |---|---|---|
 * | Repo, wrangler.toml, Worker | `library_catalog` | this one |
 * | Env block source | copied from a LIVE `[env.friend]` | the COMMENTED template at the foot of `apps/worker/wrangler.toml` |
 * | Estate app ids | `library`, `library2`, … | `games`, `games2` (an allowlist in `src/lib/estate-app.ts`) |
 * | Secret set | Google Books, `DONOR_TOKEN`, `PEER_TOKEN` | `BGG_API_TOKEN`, `GAMEUPC_API_KEY` |
 * | Donor / peers | a free donor sweep heals a keyless instance | 🔴 **none exists** — see the key section below |
 * | `RATE_LIMITER` | no such binding | one per instance, its own `namespace_id` |
 * | Covers domain | console step, `r2.dev` launch tier | `wrangler r2 bucket domain add` — a real CLI step here |
 *
 * ⚠️ **Do not "fix" this by extracting a shared core across the two repos
 * today.** They are separate checkouts with separate `node_modules`, separate
 * wrangler configs and separate release cadences; a shared module would be a
 * fourth cross-repo code dependency (`packages/estate-auth` is the one that
 * exists, and it is auth code, which is the case that earns it). The estate's
 * rule for this is *near-duplicates that exist on purpose must be documented as
 * NOT-interchangeable* — this block is that documentation. The thing that MUST
 * NOT be duplicated is a decision, and none is: the refusal lists come from
 * `push-secrets.mjs` by import, the env block comes from the template by
 * rendering, and the identity allowlist is read out of `estate-app.ts`.
 *
 * ## What it does, in the order §7.2 fixes and §7.6 amends
 *
 * | # | Step | §7.6 ledger |
 * |---|---|---|
 * | 1 | D1 create (binding stays `DB`) | AUTO |
 * | 2 | R2 covers bucket **+ its own covers hostname** | AUTO (⚠️ `gamecovers.heygabi.ai` is taken) |
 * | 3 | The `[env.<instance>]` block, rendered from the commented TEMPLATE | AUTO |
 * | 4 | The `package.json` script twins | AUTO |
 * | 5 | Commit the allowlist (never `git add -A`) | AUTO |
 * | 6 | `db:migrate:<instance>` — **migrate BEFORE deploy** | AUTO |
 * | 7 | ⏸ **PAUSE #1 — Firebase authorised domain** | 🔴 MANUAL |
 * | 8 | ⏸ **PAUSE #2 — auth-worker `CONSUMER_APPS` + `vis_` + billing site + migration + deploy** | 🔴 MANUAL |
 * | 9 | Mint the paired estate token, set it on BOTH sides | AUTO (stdin) |
 * | 10 | Per-instance secrets, incl. `ANTHROPIC_API_KEY` | AUTO (stdin) |
 * | 11 | ⏸ **The guarded deploy — PRINTED, never run by this script** | 🔴 the owner's command |
 * | 12 | Verify `/api/health?cb=` and mark the request `live` | AUTO |
 *
 * ⚠️ **Step 11 is where this diverges from the books twin, deliberately.** That
 * one calls `npm run deploy:<instance>`; this one prints the command and stops.
 * The deploy carries `DEPLOY_HOLDER`, takes a lock shared across instances, and
 * uploads the WORKING-TREE `apps/web/dist` — it is the owner's gesture, with his
 * name on the `deploys.log` line, not a script's. `--resume` sees the deploy in
 * `docs/deploys.log` (the `env=<instance>` field `deploy-done.mjs` writes) and
 * carries on to step 12.
 *
 * ## ⚠️ The naming rule — the SAME SPLIT the books twin uses
 *
 * Design §7.1 makes every permanent resource identity-neutral so that only the
 * HOSTNAME carries identity. The books provisioner splits that rule on which
 * name is expensive to change, and this one splits it identically **so the pair
 * agrees**:
 *
 * | Name | Source | Why |
 * |---|---|---|
 * | wrangler env / Worker name | **the sanitised subdomain** | a Worker CAN be renamed, and the operator types this name a dozen times |
 * | D1 name, R2 bucket, **covers hostname** | **ordinal** (`board-game-catalog-2nd`, `game-covers-2nd`, `gamecovers2.heygabi.ai`) | none can be renamed cheaply — and ⚠️ the covers host is ORDINAL here, unlike anything on the books side, because `cover-storage.ts` writes `COVERS_BASE_URL` INTO `thumbnail_url` rows: renaming it later is a data migration, not a config edit |
 * | estate app id, its token NAME, its `vis_` column | **ordinal** (`games2`) | it is a CONTRACT with another repo (`CONSUMER_APPS`, `appTokenFor()`, `siteForApp()`, a migration), pinned per catalog, never per person or host |
 * | hostname | `<desired_subdomain>.heygabi.ai` | design §7.1 — the only identity-bearing name |
 *
 * ✅ **DECIDED by the owner, 2026-09-05 08:35 Phoenix: (a), this split** — over
 * (b) all-ordinal and (c) all-follow-the-person. The rule and the reasons are
 * recorded once, in the design doc §7.1 (`catalog-platform/docs/info/
 * request-a-catalog-design.md`). Everything above is decided in ONE function —
 * `deriveNames()` — so a later change would be one function, not a rewrite.
 * `--instance <name>` overrides the env name for a single run.
 *
 * ### The sanitiser, stated as a rule
 *
 * `desired_subdomain` is already `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` at the
 * route (design §3.3), but this script must not trust a value it did not
 * validate. So: lowercase → every run of anything but `[a-z0-9]` becomes one
 * `-` → leading/trailing `-` trimmed → refused if empty, longer than 30, a
 * wrangler-reserved word, or the name of an `[env.*]` block that already exists.
 *
 * ## ⚠️ `ANTHROPIC_API_KEY` — the sealed key first, then the OWNER'S
 *
 * Precedence is design §6.4, resolved at PROVISIONING time:
 *
 *   1. the requester's sealed key, if one was submitted;
 *   2. else the owner's sealed key, if he attached one at Accept;
 *   3. else the OWNER'S OWN key — standing decision, 2026-09-05 ~07:03 Phoenix,
 *      *"Have it fall back to my Claude key for now"* — read from this repo's
 *      `.dev.vars` in code and piped over stdin, with the run LOGGING
 *      `owner key used — standing decision 2026-09-05` so a later reader can see
 *      which instances spend his money.
 *
 * Rows 1 and 2 are the sealed-envelope flow, and they belong to
 * `catalog-platform/scripts/lib/catalog-seal.mjs` (phase 5). This script
 * dynamic-imports that module through the `platform-repo.mjs` locator and calls
 * `injectSealedKey({ requestId, workerDir, envName, dry })`, acting on the
 * `source` it resolves. **If the module is absent, or answers `'none'`, row 3
 * applies exactly as it does on the books side.** No plaintext is ever read by
 * a person, printed, logged or written to disk.
 *
 * 🔴 **AND THE GAMES CONSEQUENCE, WHICH IS NOT THE BOOKS ONE (§7.6, item 2).**
 * For a library, "no key from either party" still leaves a **free donor sweep**
 * healing the new instance against the main library. **This repo has no
 * `DONOR_URL`, no `PEERS` and no donor route at all**, so on a games instance
 * *no key means NO AI LOOKUPS AT ALL — nothing self-heals, ever.* The run says
 * that in those words rather than reusing the books sentence, and it refuses to
 * finish a real provision with no key rather than shipping a catalog that looks
 * fine and can never fill itself in.
 *
 * ⚠️ **`push-secrets.mjs`'s refusal lists are IMPORTED, not re-stated.**
 * `PER_INSTANCE_SECRETS` and `PER_INSTANCE_PREFIXES` are the mechanical guard
 * design §6.4 says must not be weakened, so a new instance gets the shared keys
 * and nothing else: `ANTHROPIC_API_KEY` is special-cased above, `INDEX_PUSH_TOKEN`
 * is per-instance AND local-only (the instance ships dark on index push), and
 * every `ESTATE_APP_TOKEN_*` is refused by prefix.
 *
 * ## `--dry` vs `--resume`, and why a plain run is neither
 *
 * - **`--dry`** prints the derivation, every step, every command it WOULD run
 *   (a piped secret shows as `<stdin>`), and the whole manual runbook. It reads
 *   D1 and reads the Firebase domain list; it writes nothing anywhere.
 * - **a plain run STOPS** when it finds an artifact that already exists. A D1
 *   named `board-game-catalog-2nd` that this run did not create is either a
 *   half-finished provision or somebody else's database, and quietly adopting it
 *   is how a new catalog ends up bound to the wrong data.
 * - **`--resume`** is the word that says *"yes, that was me"*: existing
 *   artifacts are skipped with a line naming each, and the manual pauses are
 *   VERIFIED rather than announced (§7.4: *"any script that mints into a custody
 *   store and then does something fallible needs a resume path"*).
 *
 * ### What `--resume` can actually MEASURE, and what it can only assert
 *
 * | Pause | Checked by | Strength |
 * |---|---|---|
 * | #1 Firebase authorised domain | `GET identitytoolkit.googleapis.com/v1/projects?key=<the public web key>` → `authorizedDomains[]` | 🟢 **a real measurement** — the console's own list, read live |
 * | #2 auth-worker registration | the app id in `CONSUMER_APPS`, a `case '<app>'` in `appTokenFor()`, a `case` in `siteForApp()`, the id in `BILLING_SITES`, a `vis_<app>` migration — all read out of the sibling `catalog-platform` checkout | 🟡 **source, not production** — it proves the code is written, NOT that the auth Worker was migrated and deployed |
 * | #2 (deployed half) | nothing | 🔴 **unmeasurable from here.** Only a real sign-in tailed with `"src":"seen"` proves the pairing |
 * | #11 the deploy | a `deploys.log` line whose 5th field is `env=<instance>` | 🟡 it proves a guarded deploy RAN, not that it succeeded — step 12's `/api/health` is the measurement |
 *
 * A check that cannot be made is SAID rather than assumed — the run prints what
 * it could not verify before it continues.
 *
 * ## Where the request row lives, and why wrangler reaches it from another repo
 *
 * The row is in the ESTATE directory D1 — `estate_auth`, binding `DB`, in
 * `catalog-platform/apps/auth-worker/wrangler.toml` — because the request exists
 * *before any catalog exists* (design §3.1). This script spawns wrangler with
 * `cwd` set to that Worker's directory, exactly as an operator would, so the
 * config it picks up is that repo's and no path of ours can leak into it. The
 * checkout is found by `scripts/lib/platform-repo.mjs`.
 *
 * ⚠️ **`wrangler d1 execute --command` takes no bound parameters**, so the
 * request id is interpolated — and is therefore forced through
 * `Number.isSafeInteger` first. Nothing else from the row is ever interpolated
 * into SQL except through `sqlLit()`.
 *
 * ## What this script deliberately does NOT do
 *
 * - **`kind = 'books'`** — refused, exit 2, pointing at the twin that CAN do it.
 * - **It does not deploy.** Step 11 prints the owner's command (see above).
 * - **No auth-worker migration is applied.** The directory database is never
 *   migrated unattended (§7.4 point 5).
 * - **No `.dev.vars.<instance>` is created, ever** (`push-secrets.mjs`'s rule).
 * - **It does not add a third estate app id.** `games3` needs a three-line code
 *   change in `src/lib/estate-app.ts` first, and the run says so.
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePlatformRepo } from './lib/platform-repo.mjs';
import {
  PRODUCTION_SECRETS,
  isPerInstance,
  parseDevVars,
  perInstanceReason,
} from './push-secrets.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = join(ROOT, 'apps', 'worker');
const WRANGLER_TOML = join(WORKER_DIR, 'wrangler.toml');
const ESTATE_APP_TS = join(WORKER_DIR, 'src', 'lib', 'estate-app.ts');
const ROOT_PKG = join(ROOT, 'package.json');
const WORKER_PKG = join(WORKER_DIR, 'package.json');
const DEPLOYS_LOG = join(ROOT, 'docs', 'deploys.log');
const WRANGLER_BIN = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
/** Same override, same reason, as `push-secrets.mjs` — a git worktree has no `.dev.vars`. */
const DEV_VARS = process.env.SECRETS_DEV_VARS || join(WORKER_DIR, '.dev.vars');

/** The estate directory database (design §3.1). */
export const ESTATE_DB = 'estate_auth';
export const APEX = 'heygabi.ai';
/** Shared by every catalog — one Google account is one person estate-wide (§7.2 step 4). */
export const FIREBASE_PROJECT = 'audiobook-catalog';
/**
 * The Firebase WEB api key. Public by design (it identifies a project, it does
 * not authorise anything) and already a build constant in the shipped bundle —
 * `apps/web/src/lib/firebase.ts:73`. It is here so PAUSE #1 can be MEASURED
 * rather than asserted; `VITE_FIREBASE_API_KEY` overrides it, as it does there.
 */
const FIREBASE_WEB_KEY =
  process.env.VITE_FIREBASE_API_KEY || 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y';

/**
 * The `heygabi.ai` zone, needed by `wrangler r2 bucket domain add`.
 *
 * ⚠️ `--zone-id` is REQUIRED non-interactively: without it wrangler prompts for
 * the zone, and an automatic "yes" answers the first prompt only, never a zone
 * CHOICE. Measured and written down when `gamecovers.heygabi.ai` was attached —
 * `docs/access/covers-r2.md` §1 owns this fact.
 */
const HEYGABI_ZONE_ID = 'a3a39d7ae25918fe4851092b6c561974';

/** What a `--dry` run shows where a real `database_id` would go. See step 1. */
export const DRY_DATABASE_ID = '00000000-0000-0000-0000-000000000000';

/** The env name the commented template at the foot of `wrangler.toml` is written for. */
export const TEMPLATE_ENV = 'games2';
/** The line that marks the start of that template. Shared with `instance-template.test.ts`. */
export const TEMPLATE_MARKER = 'TEMPLATE — a SECOND games instance';

// ---------------------------------------------------------------------------
// Pure helpers — everything down to `main()` is testable with no wrangler, no
// network and no filesystem beyond what a caller hands it.
// ---------------------------------------------------------------------------

/**
 * Wrangler env names that would collide with something else's meaning.
 * ⚠️ `games2` is NOT on this list: it is the name the template and the
 * pre-declared identity slot already use, so it is a perfectly good env name —
 * the existing-`[env.*]` check is what stops a second use of it.
 */
export const RESERVED_INSTANCE_NAMES = [
  'default',
  'production',
  'preview',
  'dev',
  'development',
  'staging',
  'local',
  'test',
  'none',
];

/** The Worker is `board-game-catalog-<env>` (20 chars) and Cloudflare caps a name at 63. */
export const INSTANCE_MAX = 30;

/**
 * A wrangler env name from a requested subdomain. See the header's rule table.
 *
 * @returns {{ name: string, changed: boolean }}
 * @throws  {Error} worded for a person: what happened, what it needs, how to fix.
 */
export function sanitiseInstanceName(subdomain, { existingEnvs = [] } = {}) {
  if (typeof subdomain !== 'string' || !subdomain.trim()) {
    throw new Error(
      'The request has no desired_subdomain, so there is no name to derive an ' +
        'instance from. Fix the row, or pass --instance <name>.',
    );
  }
  const name = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!name) {
    throw new Error(
      `"${subdomain}" has no letters or digits in it, so it cannot name a wrangler ` +
        'environment. Pass --instance <name> with something a Worker can be called.',
    );
  }
  if (name.length > INSTANCE_MAX) {
    throw new Error(
      `"${name}" is ${name.length} characters; an instance name is capped at ${INSTANCE_MAX} ` +
        'because the Worker is called board-game-catalog-<instance> and Cloudflare stops at 63. ' +
        'Pass a shorter --instance <name>.',
    );
  }
  if (RESERVED_INSTANCE_NAMES.includes(name)) {
    throw new Error(
      `"${name}" is a reserved wrangler environment name, so a block called [env.${name}] ` +
        'would mean something other than "this catalog". Pass --instance <name>.',
    );
  }
  if (existingEnvs.includes(name)) {
    throw new Error(
      `[env.${name}] already exists in apps/worker/wrangler.toml. That is either a ` +
        'half-finished provision — re-run with --resume — or a different catalog. ' +
        'Pass --instance <name> for a new one.',
    );
  }
  return { name, changed: name !== subdomain };
}

/** `2` → `2nd`. Used for the names that can never be renamed cheaply. */
export function ordinalWord(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

/**
 * Every UNCOMMENTED `[env.<name>]` / `[[env.<name>.x]]` in a wrangler.toml.
 *
 * ⚠️ Commented tables do not count, and that is load-bearing rather than tidy:
 * this file's foot carries a commented `[env.games2]` TEMPLATE, and a parser
 * that counted it would report an instance nothing has ever created — the same
 * rule `scripts/instance-guard.mjs` applies for the same reason.
 */
export function parseEnvNames(toml) {
  const found = new Set();
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const hit = trimmed.match(/^\[\[?env\.([^.\]]+)/);
    if (hit) found.add(hit[1]);
  }
  return [...found].sort();
}

/** Every UNCOMMENTED `ESTATE_APP = "…"` value already claimed in this repo's config. */
export function parseEstateApps(toml) {
  const found = new Set();
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const hit = trimmed.match(/^ESTATE_APP\s*=\s*"([^"]*)"/);
    if (hit) found.add(hit[1]);
  }
  return [...found].sort();
}

/**
 * The identities this codebase may present, read out of
 * `apps/worker/src/lib/estate-app.ts` rather than restated here.
 *
 * 🔴 One fact, one home. That allowlist is what stops one var edit letting this
 * catalog impersonate the library's consumer at the directory; a copy of it in a
 * script is a copy that can disagree with the Worker, and the script's copy
 * would be the one nobody notices is wrong.
 */
export function parseEstateAppAllowlist(source) {
  const m = source.match(/ESTATE_APPS\s*=\s*Object\.freeze\(\[([^\]]*)\]/s);
  if (!m) {
    throw new Error(
      'Could not read ESTATE_APPS out of apps/worker/src/lib/estate-app.ts. That file is the ' +
        'one home of the identities this Worker may present, so this script refuses to guess ' +
        'at one rather than derive an id the Worker would reject.',
    );
  }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * The next free `games<N>` estate app id, and the N behind it.
 *
 * ⚠️ N is ALSO the ordinal for the D1, the bucket and the covers hostname,
 * deliberately: one number per catalog means the names that must never be
 * renamed cannot drift apart, and `games2` / `board-game-catalog-2nd` /
 * `game-covers-2nd` / `gamecovers2.` read as one thing on a console page listing
 * all of them.
 */
export function nextEstateApp(estateApps, allowlist) {
  const taken = new Set(estateApps);
  // `games` is instance 1 and carries no digit — the estate's own convention.
  for (let n = 2; n < 100; n++) {
    const app = `games${n}`;
    if (taken.has(app)) continue;
    if (!allowlist.includes(app)) {
      throw new Error(
        `The next free estate app id is "${app}", and this codebase cannot present it.\n\n` +
          `  what happened : apps/worker/src/lib/estate-app.ts allows ${allowlist.join(', ')} only,\n` +
          `                  so a Worker declaring ESTATE_APP = "${app}" would resolve to NO\n` +
          '                  identity at all and its estate check would be OFF (loudly).\n\n' +
          '  what it needs : the three-line code change that file documents — an entry in\n' +
          `                  ESTATE_APPS + APP_TOKEN_VAR, a case arm in estateAppToken(), and an\n` +
          `                  ESTATE_APP_TOKEN_${app.toUpperCase()} field on Env — plus the auth Worker's own\n` +
          '                  registration (PAUSE #2). It is a commit and a deploy, not a flag.\n\n' +
          '  how to get it : make that change, run npm test, then re-run this with --resume.',
      );
    }
    return { app, n };
  }
  throw new Error('No free games<N> estate app id below 100 — that is a design problem, not a bug.');
}

/**
 * The next `RATE_LIMITER` `namespace_id`.
 *
 * 🔴 MEASURED 2026-09-05 (`docs/info/instance-model.md` §3): a namespace is
 * scoped **per ACCOUNT**, so two instances sharing one share their counters —
 * two households throttling each other whenever they share an egress IP. Each
 * instance therefore declares its own.
 *
 * ⚠️ It can never return `"1001"`. That is the MAIN instance's, and changing a
 * namespace silently resets every counter behind it.
 */
export function nextRateLimitNamespace(toml) {
  const taken = new Set();
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const hit = trimmed.match(/^namespace_id\s*=\s*"(\d+)"/);
    if (hit) taken.add(hit[1]);
  }
  let n = 1002;
  while (taken.has(String(n))) n += 1;
  const id = String(n);
  if (id === '1001') {
    // Unreachable by the loop above, and asserted anyway: the cost of being
    // wrong is every counter on the live catalog silently resetting.
    throw new Error('refusing to hand a second instance the MAIN instance\'s namespace_id "1001"');
  }
  return id;
}

/**
 * ⚠️ Refuse anything that is not a GAMES request the owner has accepted.
 *
 * The books twin refuses `kind = 'games'` in the same shape, on purpose: the two
 * refusals are a PAIR and should read like one, so whichever a session runs
 * first tells it where the other half is.
 */
export function assertProvisionable(row) {
  if (!row || typeof row !== 'object') {
    throw Object.assign(new Error('No request row was found for that --request id.'), { code: 1 });
  }
  if (row.kind === 'books') {
    throw Object.assign(
      new Error(
        'This is a BOOKS request, and the books provisioning path is not in this repo.\n\n' +
          'A library instance is a wrangler env in bookbuddy/library_catalog: its own\n' +
          '[env.<name>] block, its own D1 and covers bucket, its own DONOR_URL and PEERS, and\n' +
          'the Google Books / donor / peer secret set — none of which exists here. Running the\n' +
          'games path against it would stand up a BOARD-GAME catalog at the address somebody\n' +
          'asked for a library at.\n\n' +
          'What to run instead, from that repo:\n' +
          `  npm run provision:catalog -- --request ${row.id ?? '<id>'} --dry\n\n` +
          'Accepting a books request is fine; provisioning one is a run in another repo.',
      ),
      { code: 2 },
    );
  }
  if (row.kind !== 'games') {
    throw Object.assign(
      new Error(
        `kind = "${row.kind}" is not a kind this estate knows. The schema's CHECK allows ` +
          "'books' and 'games' only — a row outside that is data corruption, not a request.",
      ),
      { code: 2 },
    );
  }
  if (row.status !== 'accepted') {
    throw Object.assign(
      new Error(
        `Request ${row.id} is "${row.status}", and only an ACCEPTED request can be provisioned.\n` +
          (row.status === 'pending'
            ? '  It is still waiting on the owner: accept it at https://heygabi.ai/admin/ first.\n'
            : row.status === 'live'
              ? '  It is already live' +
                (row.provisioned_host ? ` at https://${row.provisioned_host}` : '') +
                '. Nothing to do.\n'
              : '  A declined or cancelled request is not re-provisioned; the requester files a new one.\n'),
      ),
      { code: 2 },
    );
  }
  return row;
}

/**
 * Everything derived from the row. Nothing here is ever asked of a person.
 *
 * 🔴 THIS IS THE ONE NAMING FUNCTION. The split described in the header lives
 * here and nowhere else, so the owner's unanswered (a)/(b)/(c) question is a
 * one-function edit whenever he answers it.
 *
 * ⚠️ `forceEstateApp` is what makes `--resume` safe. A resumed run reads a
 * wrangler.toml that ALREADY contains this instance's `ESTATE_APP = "games2"`,
 * so `nextEstateApp` would hand back `games3` and the second half of the run
 * would mint a bearer under a name the first half never used. On a resume the
 * caller reads the id back out of the existing block and pins it here.
 */
export function deriveNames(
  row,
  { envNames = [], estateApps = [], allowlist = [], instance = null, forceEstateApp = null } = {},
) {
  const subdomain = String(row.desired_subdomain || '').trim();
  const inst = instance
    ? sanitiseInstanceName(instance, { existingEnvs: envNames })
    : sanitiseInstanceName(subdomain, { existingEnvs: envNames });
  // ⚠️ `nextEstateApp` is only ASKED when nothing is pinned. On a `--resume`
  // this instance's id is already in the toml, so the "next free" id is the one
  // AFTER it — which is usually outside the allowlist and would throw a refusal
  // about an instance nobody is provisioning. Measured by the resume test.
  const next = forceEstateApp ? null : nextEstateApp(estateApps, allowlist);
  const estateApp = forceEstateApp || next.app;
  const n = forceEstateApp ? Number(String(forceEstateApp).replace(/^\D+/, '')) || 2 : next.n;
  const ord = ordinalWord(n);
  return {
    requestId: row.id,
    kind: row.kind,
    instance: inst.name,
    instanceWasSanitised: inst.changed,
    workerName: `board-game-catalog-${inst.name}`,
    host: `${subdomain}.${APEX}`,
    siteOrigin: `https://${subdomain}.${APEX}`,
    displayName: String(row.display_name || subdomain),
    requesterEmail: String(row.requester_email || '').trim().toLowerCase(),
    d1Name: `board-game-catalog-${ord}`,
    bucketName: `game-covers-${ord}`,
    // ⚠️ ORDINAL, not the subdomain: `cover-storage.ts` writes this base URL
    // into `thumbnail_url` rows, so a rename is a data migration. And
    // `gamecovers.heygabi.ai` is TAKEN — a custom domain belongs to exactly one
    // bucket.
    coversHost: `gamecovers${n}.${APEX}`,
    coversBaseUrl: `https://gamecovers${n}.${APEX}`,
    estateApp,
    estateAppNumber: n,
    tokenName: `ESTATE_APP_TOKEN_${estateApp.toUpperCase()}`,
    visColumn: `vis_${estateApp}`,
  };
}

/** A TOML basic-string body: only `"` and `\` need escaping for our values. */
export function tomlString(value) {
  return `"${String(value).split('\\').join('\\\\').split('"').join('\\"')}"`;
}

/**
 * Where the commented TEMPLATE begins — the first character of its banner line.
 *
 * Used both to READ the template and to decide where a real block goes, which is
 * the same offset for a reason: see `insertEnvBlock`.
 */
export function templateStart(toml) {
  const at = toml.indexOf(TEMPLATE_MARKER);
  if (at === -1) return -1;
  const markerLine = toml.lastIndexOf('\n', at) + 1;
  // The banner is a `# ═══…` rule immediately above the marker line. Include it,
  // so an inserted block lands above the whole banner rather than inside it.
  const prevEnd = markerLine - 1;
  if (prevEnd <= 0) return markerLine;
  const prevStart = toml.lastIndexOf('\n', prevEnd - 1) + 1;
  return /^#\s*═+\s*$/.test(toml.slice(prevStart, prevEnd)) ? prevStart : markerLine;
}

/**
 * The `[env.<instance>]` block, rendered by UNCOMMENTING the template at the
 * foot of `apps/worker/wrangler.toml` and substituting the derived names.
 *
 * 🔴 **The template is the source of truth, and this renders it — it does not
 * re-implement it.** `apps/worker/src/lib/instance-template.test.ts` already
 * fails the build when `[vars]` gains a var the template does not carry
 * (`[env.*]` inherits NOTHING, so an omission is a missing binding on the new
 * Worker). Hand-writing the block here would have put that guard behind a copy
 * it does not read — which is exactly the failure the guard exists to catch, one
 * level up. The books twin hand-writes its block because it templates from a
 * LIVE `[env.friend]`; this repo has a commented template instead, which is
 * strictly better to render from.
 *
 * ⚠️ Substitution is KEY-DRIVEN, never a blind replace of the string `games2`.
 * The template uses that word for two different things — the env NAME and the
 * estate APP id — and under the naming split those diverge the moment a
 * subdomain is not `games2`.
 */
export function renderEnvBlock(toml, names, { databaseId, coversBaseUrl, ownerEmails, namespaceId }) {
  const start = templateStart(toml);
  if (start === -1) {
    throw new Error(
      `apps/worker/wrangler.toml no longer carries the "${TEMPLATE_MARKER}" block, which is what ` +
        'this script renders a new instance from. Restore it (git history has it) rather than ' +
        'hand-writing a block: the template is the thing the drift guard checks.',
    );
  }
  const region = toml.slice(start);
  const bodyAt = region.search(new RegExp(`^#\\s*\\[env\\.${TEMPLATE_ENV}\\]\\s*$`, 'm'));
  if (bodyAt === -1) {
    throw new Error(
      `the template block carries no "# [env.${TEMPLATE_ENV}]" line, so there is nothing to render.`,
    );
  }

  const i = names.instance;
  /**
   * 🔴 EVERY SUBSTITUTION NAMES ITS TABLE, and that is not belt-and-braces.
   *
   * Measured while writing this, on the first run: a key-only rule for `name`
   * rewrote `name = "RATE_LIMITER"` inside `[[env.<i>.unsafe.bindings]]` to the
   * Worker's name — a rate-limit binding called `board-game-catalog-quarry`,
   * which the Worker would then look for under `RATE_LIMITER` and never find.
   * TOML reuses short keys across tables (`name`, `pattern`, `binding`), so a
   * key on its own is not an address. Nothing else caught it: the block parsed,
   * the placeholder check passed, and the failure would have been a rate limiter
   * that silently did not exist.
   */
  const values = {
    name: { table: `[env.${i}]`, value: tomlString(names.workerName) },
    namespace_id: { table: `[[env.${i}.unsafe.bindings]]`, value: tomlString(namespaceId) },
    database_name: { table: `[[env.${i}.d1_databases]]`, value: tomlString(names.d1Name) },
    database_id: { table: `[[env.${i}.d1_databases]]`, value: tomlString(databaseId) },
    bucket_name: { table: `[[env.${i}.r2_buckets]]`, value: tomlString(names.bucketName) },
    pattern: { table: `[[env.${i}.routes]]`, value: tomlString(names.host) },
    COVERS_BASE_URL: { table: `[env.${i}.vars]`, value: tomlString(coversBaseUrl) },
    OWNER_EMAILS: { table: `[env.${i}.vars]`, value: tomlString(ownerEmails) },
    ESTATE_APP: { table: `[env.${i}.vars]`, value: tomlString(names.estateApp) },
  };

  let table = '';
  const lines = region
    .slice(bodyAt)
    .split(/\r?\n/)
    // Uncomment. A bare `#` is a blank line; `# x` loses exactly one space.
    .map((l) => (l.startsWith('# ') ? l.slice(2) : l === '#' ? '' : l.startsWith('#') ? l.slice(1) : l))
    .map((line) => {
      // Table headers: `[env.games2…]` / `[[env.games2…]]` → this instance's name.
      let out = line.replace(/(\[\[?env\.)games2\b/g, `$1${i}`);
      // Command names quoted in the comments, so the block a reader lands on
      // names the commands that actually exist for THIS instance.
      out = out.replace(
        /\b(predeploy|deploy|postdeploy|db:migrate|secret|secret:list|secrets:push|tail):games2\b/g,
        `$1:${i}`,
      );
      if (out.trim().startsWith('#')) return out;
      const header = out.trim().match(/^\[\[?[^\]]+\]\]?$/);
      if (header) {
        table = out.trim();
        return out;
      }
      const hit = out.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)/);
      const rule = hit ? values[hit[2]] : undefined;
      if (rule && rule.table === table) return `${hit[1]}${hit[2]}${hit[3]}${rule.value}`;
      return out;
    });

  const block = [
    '',
    '# ═════════════════════════════════════════════════════════════════════════════',
    `# SECOND GAMES INSTANCE — ${names.displayName} · https://${names.host}`,
    '#',
    `# Rendered from the template at the foot of this file by`,
    `# scripts/provision-catalog.mjs, from catalog_request #${names.requestId} in the`,
    `# estate directory D1 \`${ESTATE_DB}\`. Runbook: docs/access/provision-catalog.md.`,
    '#',
    `# ⚠️ NAMING: the HOSTNAME (${names.host}) is the only identity-bearing name.`,
    `# The D1 \`${names.d1Name}\`, the bucket \`${names.bucketName}\` and the covers host`,
    `# \`${names.coversHost}\` are ORDINAL and are not cheaply renameable; the env name`,
    `# \`${names.instance}\` is the operator-facing one and follows the subdomain.`,
    '#',
    '# ⚠️ Wrangler environments inherit NOTHING. Every var below is restated on',
    '# purpose — a missing line here is a missing value on the Worker, not a',
    '# fallback to the top-level [vars].',
    '#',
    `# Deploy with \`DEPLOY_HOLDER=<you> npm run deploy:${names.instance}\` (never a bare`,
    `# \`wrangler deploy --env ${names.instance}\` — the npm script carries instance-guard,`,
    '# check-clean, deploy-guard and deploy-done).',
    '# ═════════════════════════════════════════════════════════════════════════════',
    ...lines,
  ].join('\n');

  assertRendered(block, names, databaseId);
  return `${block.replace(/\n*$/, '')}\n`;
}

/**
 * The rendered block is checked before it is written, because a substitution
 * that silently did nothing produces a block that LOOKS right and deploys a
 * Worker pointed at a placeholder.
 */
export function assertRendered(block, names, databaseId) {
  const codeLines = block.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const leftovers = codeLines.filter((l) => /<[^>]+>/.test(l));
  if (leftovers.length) {
    throw new Error(
      `the rendered [env.${names.instance}] block still carries template placeholders:\n` +
        leftovers.map((l) => `    ${l.trim()}`).join('\n') +
        '\nA placeholder that reaches wrangler.toml is a Worker bound to nothing.',
    );
  }
  const must = [
    [new RegExp(`^\\[env\\.${names.instance}\\]$`, 'm'), `[env.${names.instance}]`],
    [new RegExp(`^ESTATE_APP = "${names.estateApp}"$`, 'm'), `ESTATE_APP = "${names.estateApp}"`],
    [new RegExp(`^database_id = "${databaseId}"$`, 'm'), 'the real database_id'],
    [new RegExp(`^pattern = "${names.host}"$`, 'm'), `pattern = "${names.host}"`],
    // 🔴 The binding NAMES the Worker's code looks its bindings up by. Each was
    // a `name =` / `binding =` line a key-only substitution could reach, and the
    // first one actually did (see `renderEnvBlock`'s substitution table).
    [/^name = "RATE_LIMITER"$/m, 'the RATE_LIMITER binding name'],
    [/^binding = "DB"$/m, 'the DB binding'],
    [/^binding = "COVERS"$/m, 'the COVERS binding'],
    [/^binding = "ASSETS"$/m, 'the ASSETS binding'],
  ];
  for (const [re, what] of must) {
    if (!re.test(block)) throw new Error(`the rendered block is missing ${what}`);
  }
  // 🔴 The template must never hand a second instance the main one's identity.
  if (new RegExp('^ESTATE_APP = "games"$', 'm').test(block)) {
    throw new Error(
      'the rendered block declares ESTATE_APP = "games" — the MAIN instance\'s identity. That is ' +
        'estate credentials catalog F-5 and `estate-app.test.ts` would refuse the build.',
    );
  }
}

/**
 * Every live top-level `[vars]` key, so the rendered block can be checked
 * against the same rule the template is. Mirrors `instance-template.test.ts`.
 */
export function liveVarNames(toml) {
  const lines = toml.slice(0, templateStart(toml) === -1 ? toml.length : templateStart(toml)).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '[vars]');
  if (start === -1) return [];
  const names = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (/^\[/.test(trimmed)) break;
    const hit = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (hit?.[1]) names.push(hit[1]);
  }
  return names;
}

/** The two deprecated Access vars a new instance must NOT restate (design §8 item 7). */
export const MUST_NOT_RESTATE = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'];

/** @returns {string[]} live `[vars]` keys the rendered block failed to restate. */
export function missingVars(toml, block) {
  return liveVarNames(toml).filter(
    (name) => !MUST_NOT_RESTATE.includes(name) && !new RegExp(`^${name}\\s*=`, 'm').test(block),
  );
}

/**
 * Put a real `[env.*]` block ABOVE the commented template.
 *
 * 🔴 NOT at the end of the file, and this is a measured trap rather than a
 * preference: `instance-template.test.ts` slices from the template banner to EOF
 * and asserts **every line of that region is commented**. A block appended at
 * EOF lands inside that region and fails the drift guard — which would read as
 * "the provisioner broke the template" when what actually happened is that it
 * wrote in the wrong place. (The books twin appends at EOF because its file has
 * no template after which to land.)
 */
export function insertEnvBlock(toml, block) {
  const at = templateStart(toml);
  const body = toml.replace(/\n*$/, '\n');
  if (at === -1) return `${body}${block}`;
  const head = toml.slice(0, at).replace(/\n*$/, '\n');
  return `${head}${block}\n${toml.slice(at)}`;
}

/**
 * The root twins, mirroring the `:games2` group verbatim.
 *
 * ⚠️ Every one is prefixed with `instance-guard.mjs`, exactly as the `:games2`
 * ones are: a command that names an absent env must refuse in WORDS, not with
 * wrangler's own message.
 */
export function rootScriptTwins(instance) {
  const sync =
    'node scripts/sync-estate-auth.mjs && node scripts/sync-estate-search.mjs && node scripts/sync-estate-theme.mjs';
  return {
    [`predeploy:${instance}`]: `node scripts/instance-guard.mjs ${instance} && ${sync} && node scripts/check-clean.mjs && node scripts/deploy-guard.mjs --instance=${instance} && npm run typecheck && npm test`,
    [`deploy:${instance}`]: `npm run build && npm run deploy:${instance} --workspace @bgc/worker`,
    [`postdeploy:${instance}`]: `node scripts/deploy-done.mjs --instance=${instance}`,
    [`secret:${instance}`]: `node scripts/instance-guard.mjs ${instance} && wrangler secret put --config apps/worker/wrangler.toml --env ${instance}`,
    [`secret:list:${instance}`]: `node scripts/instance-guard.mjs ${instance} && wrangler secret list --config apps/worker/wrangler.toml --env ${instance}`,
    [`secrets:push:${instance}`]: `node scripts/instance-guard.mjs ${instance} && node scripts/push-secrets.mjs --env ${instance}`,
    [`db:migrate:${instance}`]: `node scripts/instance-guard.mjs ${instance} && npm run db:migrate:${instance} --workspace @bgc/worker`,
  };
}

/**
 * The worker twins. `db:migrate:<i>` is what makes migrate-before-deploy
 * runnable at all.
 *
 * ⚠️ There is deliberately NO `db:migrate:local:<i>`. miniflare keeps one local
 * D1 per BINDING name and every instance binds `DB`, so such a command would
 * read the MAIN local database and report confidently on the wrong catalog.
 */
export function workerScriptTwins(instance, d1Name) {
  return {
    [`deploy:${instance}`]: `wrangler deploy --env ${instance}`,
    [`db:migrate:${instance}`]: `wrangler d1 migrations apply ${d1Name} --remote --env ${instance}`,
    [`tail:${instance}`]: `wrangler tail --env ${instance}`,
  };
}

/**
 * Insert new script keys immediately after an anchor key, so the twins read as a
 * group instead of landing at the bottom of the object.
 * @returns {{ scripts: object, added: string[] }}
 */
export function insertScripts(scripts, additions, afterKey) {
  const added = Object.keys(additions).filter((k) => !(k in scripts));
  if (!added.length) return { scripts, added };
  const out = {};
  let done = false;
  for (const [k, v] of Object.entries(scripts)) {
    out[k] = v;
    if (k === afterKey) {
      for (const name of added) out[name] = additions[name];
      done = true;
    }
  }
  if (!done) for (const name of added) out[name] = additions[name];
  return { scripts: out, added };
}

/** A SQL string literal — doubling the quote is the whole of SQLite's escaping. */
export function sqlLit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`refusing to write ${value} as a number`);
    return String(value);
  }
  return `'${String(value).split("'").join("''")}'`;
}

/**
 * Pull the JSON array out of wrangler `--json` output.
 *
 * ⚠️ Its two lessons, learned in `library_catalog/scripts/lib/d1.mjs` and
 * carried here rather than re-learned: slice to the true matching bracket (a
 * trailing deprecation notice breaks a naive parse), and try the next `[` when
 * one does not parse (a warning containing a bracket wins otherwise).
 */
export function extractJsonArray(out) {
  for (let i = out.indexOf('['); i >= 0; i = out.indexOf('[', i + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < out.length; j++) {
      const ch = out[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(out.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(`could not find a JSON array in wrangler output. First 500 chars:\n${out.slice(0, 500)}`);
}

/** Has a guarded deploy of this instance ever appended a line to `docs/deploys.log`? */
export function deploysLogHasInstance(log, instance) {
  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => (line.split('\t')[4] ?? '').trim() === `env=${instance}`);
}

/** The numbered manual runbook — printed by `--dry`, and at each pause. */
export function manualRunbook(names, { platformDir = '<catalog-platform>' } = {}) {
  // Forward slashes throughout, so a path is copy-pasteable into either shell on
  // this machine — Git Bash chokes on a backslash, PowerShell accepts both.
  const dir = String(platformDir).replace(/\\/g, '/');
  const authSrc = `${dir}/apps/auth-worker/src`;
  return [
    `⏸  PAUSE #1 — Firebase authorised domain  (🔴 MANUAL, checkpoint #1)`,
    ``,
    `    Nothing can script this: the authorised-domain list is Identity Platform`,
    `    admin config and firebase-tools has no command for it.`,
    ``,
    `      1. https://console.firebase.google.com/project/${FIREBASE_PROJECT}/authentication/settings`,
    `      2. Authorised domains → Add domain → ${names.host}`,
    `      3. ⚠️ Do NOT create a second Firebase project. One project is the whole`,
    `         mechanism by which one Google account is one person estate-wide.`,
    ``,
    `    Verified on --resume by reading the list back live, so this one is a`,
    `    measurement rather than a promise.`,
    ``,
    `⏸  PAUSE #2 — auth-worker consumer registration  (🔴 MANUAL, checkpoint #2)`,
    ``,
    `    It touches CONSUMER_APPS, which is a security surface, and it migrates the`,
    `    estate directory database. Neither is done unattended.`,
    ``,
    `    a) ${authSrc}/env.ts:4 — add the app id`,
    ``,
    `         -export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2'] as const;`,
    `         +export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2', '${names.estateApp}'] as const;`,
    ``,
    `    b) ${authSrc}/env.ts — declare the bearer in Env (the block at :107–184)`,
    ``,
    `         +  /** ${names.displayName}'s /seen bearer. Same NAME on both sides. */`,
    `         +  ${names.tokenName}?: string;`,
    ``,
    `    c) ${authSrc}/env.ts:478–491 — a case arm in appTokenFor()`,
    ``,
    `         +    case '${names.estateApp}':`,
    `         +      return env.${names.tokenName};`,
    ``,
    `    ⚠️ d) and e) are NOT on the books runbook, and this repo needs BOTH — they`,
    `       were found while lifting BILLING_SITE on 2026-09-05. Without them that`,
    `       repo does not COMPILE, because siteForApp() is exhaustive over`,
    `       ConsumerApp: adding an app id without a site arm is a type error.`,
    ``,
    `    d) ${authSrc}/estate.ts:118 — a case arm in siteForApp()`,
    ``,
    `         +    case '${names.estateApp}':`,
    `         +      return '${names.estateApp}';`,
    ``,
    `    e) ${authSrc}/billing-registry.ts:38 — the new billing site`,
    ``,
    `         -export const BILLING_SITES = ['library', 'library2', 'games', 'audiobook', 'estate'] as const;`,
    `         +export const BILLING_SITES = ['library', 'library2', 'games', 'audiobook', 'estate', '${names.estateApp}'] as const;`,
    ``,
    `       ⚠️ Then decide which BILLING_FEATURES list \`${names.estateApp}\` in their`,
    `       \`sites\`. A feature the site does not name is not resolved for it — the`,
    `       Spending panel would draw an empty matrix and nobody would know why.`,
    ``,
    `    f) ${authSrc}/env.ts:349 — add the column to EstateUserRow, beside vis_library2 (:390)`,
    ``,
    `         +  ${names.visColumn}: number;`,
    ``,
    `    g) a new migration, following 0007_vis_library2.sql — ⚠️ DEFAULT 0, the`,
    `       deliberate opposite of 0002's DEFAULT 1, because it is another`,
    `       household's shelf and is granted by hand:`,
    ``,
    `         ${dir}/apps/auth-worker/migrations/00NN_${names.visColumn}.sql`,
    `         ALTER TABLE estate_user ADD COLUMN ${names.visColumn} INTEGER NOT NULL DEFAULT 0;`,
    ``,
    `       ⚠️ Check the directory for the next free number first — 0018 was taken`,
    `       by catalog_request, and number drift is what 0017's own header records.`,
    ``,
    `    h) migrate the directory D1, THEN deploy the auth Worker (in that order):`,
    ``,
    `         cd ${dir}/apps/auth-worker`,
    `         npx wrangler d1 migrations apply ${ESTATE_DB} --remote`,
    `         npx wrangler deploy`,
    ``,
    `    On --resume this script reads (a), (c), (d), (e) and (g) out of the source`,
    `    and says so. ⚠️ It CANNOT see whether the Worker was migrated and deployed`,
    `    — only a real sign-in tailed with "src":"seen" proves the pairing.`,
    ``,
    `📋 AFTERWARDS — follow-ups this script deliberately does not take`,
    ``,
    `      • TWO TESTS in this repo record "no second instance exists" and become`,
    `        false the moment the block above is committed:`,
    `          apps/worker/src/lib/estate-app.test.ts — "no second instance is`,
    `          declared for real yet". Its own comment says it "gets its own env row`,
    `          rather than being deleted": add ${names.instance} → ${names.estateApp}.`,
    `        The same file's same-id guard keeps working untouched, and that is the`,
    `        one that matters.`,
    `      • RESERVE THE NAMES. catalog-platform/apps/auth-worker/src/catalog-names.ts`,
    `        holds the reserved subdomain list, and neither ${names.instance} nor`,
    `        ${names.coversHost.split('.')[0]} is on it — so the next person to ask for either is`,
    `        told it is free. Add both in the commit that routes them.`,
    `      • docs/access/RECOVERY.md §1 says "one instance, one database, one`,
    `        bucket". That is false from the deploy onward; correct it in the same`,
    `        change (second-instance.md's checklist, step 12).`,
    `      • The covers bucket has NO Cache Rule. The main bucket does not need one`,
    `        either (cover-storage.ts sets Cache-Control per object at upload), so`,
    `        this is a difference from the LIBRARY's setup, not a missing step.`,
    `      • BILLING_POLICY is "off" on the new instance, like main, and the sweep`,
    `        crons tick hourly. Whichever key ended up on it is what they spend.`,
  ];
}

/**
 * What a new instance gets, and what it is refused — the `push-secrets.mjs`
 * classification, imported rather than restated so a change there reaches here.
 */
export function secretPlan({ production = PRODUCTION_SECRETS, classify = isPerInstance } = {}) {
  const push = [];
  const lines = [];
  for (const name of production) {
    if (name === 'ANTHROPIC_API_KEY') continue; // handled by its own step
    if (classify(name)) {
      lines.push(`refuse (per-instance)    ${name}`);
      lines.push(`                           ↳ ${perInstanceReason(name)}`);
      continue;
    }
    push.push(name);
    lines.push(`push (shared)            ${name}`);
  }
  for (const name of ['INDEX_PUSH_TOKEN', 'ESTATE_APP_TOKEN_GAMES']) {
    lines.push(`refuse (per-instance)    ${name}`);
    lines.push(`                           ↳ ${perInstanceReason(name)}`);
  }
  lines.push('special                  ANTHROPIC_API_KEY');
  lines.push('                           ↳ the sealed key if there is one, else the OWNER\'S');
  lines.push('                             (design §6.4, standing decision 2026-09-05). Read in');
  lines.push('                             code, piped over stdin, never printed.');
  // 🔴 THE LAST-MOMENT GUARD, and it deliberately uses the REAL `isPerInstance`
  // rather than the injected `classify`. The failure it exists for is "a list
  // edit, a reordered branch or a future flag put a per-instance key into the
  // payload" — a guard that trusted the same classifier the loop trusted would
  // agree with the mistake. (`classify` is injectable so a test can BE that
  // mistake; see `scripts/test/provision-catalog.test.mjs`.)
  const leak = push.filter((n) => isPerInstance(n));
  if (leak.length) {
    throw new Error(
      `provision-catalog would push per-instance secrets (${leak.join(', ')}). ` +
        'That is the guard push-secrets.mjs exists to hold — fix the lists, do not weaken it.',
    );
  }
  return { push, lines };
}

// ---------------------------------------------------------------------------
// Impure: process spawning, the filesystem, the network.
// ---------------------------------------------------------------------------

/**
 * One thing this run would do to the outside world.
 * `stdinSecret` is a NAME, never a value — the printer can never leak what it
 * cannot see, which is the point of keeping the two apart in the type.
 */
function cmd(label, { bin = WRANGLER_BIN, args, cwd = ROOT, stdinSecret = null }) {
  return { label, bin, args, cwd, stdinSecret };
}

function printCmd(c, prefix = '    ') {
  const head = c.bin === WRANGLER_BIN ? 'npx wrangler' : `node ${c.bin}`;
  const shown = [head, ...c.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ');
  console.log(`${prefix}$ ${shown}`);
  if (c.cwd !== ROOT) console.log(`${prefix}    (cwd: ${c.cwd})`);
  if (c.stdinSecret) {
    console.log(`${prefix}    ← <stdin>   ${c.stdinSecret} — the value is never printed, logged or written to disk`);
  }
}

/** Run wrangler and return stdout. Values, when there are any, go over stdin. */
function runWrangler({ bin = WRANGLER_BIN, args, cwd = ROOT }) {
  try {
    return execFileSync(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // ⚠️ wrangler on Windows prints its result and then sometimes exits non-zero
    // on a libuv teardown quirk. So a non-zero exit with usable stdout is not a
    // failure; a real one has nothing parseable.
    const out = err?.stdout ?? '';
    if (typeof out === 'string' && out.trim()) return out;
    throw new Error(`wrangler failed: ${String(err?.stderr || err?.message || err).trim()}`);
  }
}

/** Pipe ONE value into `wrangler secret put`. Never argv, never a temp file. */
function putSecret(name, value, { env = null, cwd = ROOT, bin = WRANGLER_BIN, config = null }) {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [bin, 'secret', 'put', name, ...(config ? ['--config', config] : []), ...(env ? ['--env', env] : [])],
      { cwd, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.stdin.end(value);
    child.on('exit', (code) => done(code));
  });
}

/** `wrangler secret bulk` over stdin — the push-secrets idiom, for the shared set. */
function bulkSecrets(payload, env) {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [WRANGLER_BIN, 'secret', 'bulk', '--config', WRANGLER_TOML, ...(env ? ['--env', env] : [])],
      { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.stdin.end(JSON.stringify(payload));
    child.on('exit', (code) => done(code));
  });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function npmRun(script) {
  // Not `npm` directly: on Windows that is npm.cmd and Node refuses to spawn a
  // .cmd through execFile (the trap deploy-done.mjs records). The script name is
  // derived from a name this file sanitised, never from a raw row value.
  execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', shell: true });
}

// ---------------------------------------------------------------------------
// The estate directory D1 — reads and the one write, from the auth-worker dir.
// ---------------------------------------------------------------------------

const REQUEST_COLUMNS = [
  'id',
  'kind',
  'requester_email',
  'requester_display_name',
  'desired_subdomain',
  'display_name',
  'status',
  'provisioned_instance',
  'provisioned_host',
  'reader_key_set',
  'owner_key_set',
  'created_at',
].join(', ');

function estateSql(sql, { authWorkerDir, platformWrangler }) {
  const out = runWrangler({
    bin: platformWrangler,
    cwd: authWorkerDir,
    args: ['d1', 'execute', ESTATE_DB, '--remote', '--json', '--command', sql.replace(/\s+/g, ' ').trim()],
  });
  return extractJsonArray(out)[0]?.results ?? [];
}

function readRequest(id, ctx) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`--request ${id}: an id is a positive whole number.`);
  }
  return estateSql(`SELECT ${REQUEST_COLUMNS} FROM catalog_request WHERE id = ${id}`, ctx)[0];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) await main();

function flagValue(argv, name) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return null;
  const v = argv[i].includes('=') ? argv[i].slice(`--${name}=`.length) : (argv[i + 1] ?? null);
  if (!v || v.startsWith('--')) {
    console.error(`--${name} needs a value.`);
    process.exit(1);
  }
  return v;
}

function heading(text) {
  console.log(`\n${text}`);
  console.log('─'.repeat(Math.min(text.length, 78)));
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry') || argv.includes('--dry-run');
  const resumeMode = argv.includes('--resume');
  // ⚠️ `Number(null)` is 0, not NaN — so an ABSENT --request read as request #0
  // and the usage below never printed. Measured by the test that asserts it does.
  const requestRaw = flagValue(argv, 'request');
  const requestId = requestRaw === null ? Number.NaN : Number(requestRaw);
  const fixture = flagValue(argv, 'fixture');
  const instanceOverride = flagValue(argv, 'instance');
  const coversFlag = flagValue(argv, 'covers-base-url');
  const ownerBreakGlass = argv.includes('--owner-break-glass');

  if (!Number.isFinite(requestId)) {
    console.error('provision-catalog: --request <id> is required.');
    console.error('');
    console.error('  npm run provision:catalog -- --request 7 --dry');
    console.error('  npm run provision:catalog -- --request 7');
    console.error('  npm run provision:catalog -- --request 7 --resume');
    console.error('');
    console.error('The id is a catalog_request row in the estate directory D1.');
    process.exit(1);
  }

  const platform = resolvePlatformRepo();
  const ctx = {
    authWorkerDir: join(platform.dir, 'apps', 'auth-worker'),
    platformWrangler: join(platform.dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  };
  if (!existsSync(ctx.platformWrangler)) ctx.platformWrangler = WRANGLER_BIN;

  console.log(`provision-catalog (GAMES) — request #${requestId}${dry ? '   [DRY RUN — nothing is written]' : ''}`);
  console.log(`  estate directory : ${ESTATE_DB} (${ctx.authWorkerDir})`);
  console.log(`  this repo        : ${ROOT}`);
  if (resumeMode) console.log('  mode             : --resume — existing artifacts are skipped, pauses are verified');

  /* ── the row ───────────────────────────────────────────────────────────── */

  let row;
  if (fixture) {
    // ⚠️ A fixture is for a DRY run only. It is how the twelve steps and the
    // runbook are exercised without a real accepted row — never a way to
    // provision against a row nobody accepted.
    if (!dry) {
      console.error('--fixture is a DRY-RUN aid only: a real provision reads the accepted row from D1.');
      process.exit(1);
    }
    row = JSON.parse(readFileSync(fixture, 'utf8'));
    console.log(`  request row      : ${fixture}  ⚠️ FIXTURE, not the live directory`);
  } else {
    try {
      row = readRequest(requestId, ctx);
    } catch (err) {
      console.error(`\nCould not read catalog_request #${requestId} from ${ESTATE_DB}.`);
      console.error(String(err.message).split('\n').slice(0, 6).join('\n'));
      console.error('');
      console.error('If the message says "no such table", migration 0018 has not been applied to');
      console.error('the remote directory yet — that is phase 1\'s step, not this script\'s.');
      process.exit(1);
    }
  }

  try {
    assertProvisionable(row);
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(err.code ?? 1);
  }

  /* ── derivation ────────────────────────────────────────────────────────── */

  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const envNames = parseEnvNames(toml);
  const estateApps = parseEstateApps(toml);
  const allowlist = parseEstateAppAllowlist(readFileSync(ESTATE_APP_TS, 'utf8'));
  const ownName = sanitiseSafe(row, instanceOverride);
  const resumingOwnBlock = resumeMode && ownName && envNames.includes(ownName);
  let names;
  try {
    names = deriveNames(row, {
      envNames: resumingOwnBlock ? envNames.filter((e) => e !== ownName) : envNames,
      estateApps,
      allowlist,
      instance: instanceOverride,
      forceEstateApp: resumingOwnBlock ? existingVar(toml, ownName, 'ESTATE_APP') : null,
    });
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
  const ownerEmails = ownerBreakGlass
    ? `${names.requesterEmail},nbaslamking@gmail.com`
    : names.requesterEmail;
  const namespaceId = nextRateLimitNamespace(toml);

  heading('Derived — nothing here is asked of a person');
  for (const [k, v] of [
    ['requester', `${row.requester_display_name || '—'} <${names.requesterEmail}>`],
    ['catalog name', names.displayName],
    ['hostname', `${names.host}   ← the only identity-bearing name`],
    ['wrangler env', `${names.instance}${names.instanceWasSanitised ? '   (sanitised from the subdomain)' : ''}`],
    ['Worker', names.workerName],
    ['D1', `${names.d1Name}   (binding DB, shared migrations_dir)`],
    ['R2 bucket', `${names.bucketName}   (binding COVERS)`],
    ['covers host', `${names.coversHost}   ⚠️ ordinal — it is written into rows`],
    ['estate app id', names.estateApp],
    ['estate token', names.tokenName],
    ['visibility col', `${names.visColumn}   (auth-worker migration, DEFAULT 0)`],
    ['rate-limit ns', `${namespaceId}   (never "1001" — that is main's, per ACCOUNT)`],
    ['OWNER_EMAILS', ownerEmails],
  ]) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }

  if (!names.requesterEmail) {
    console.error('\nThe request row has no requester_email, so OWNER_EMAILS would be empty and');
    console.error('the requester could not sign into their own catalog. Fix the row first.');
    process.exit(1);
  }

  /* ── the steps ─────────────────────────────────────────────────────────── */

  const state = { databaseId: null, coversBaseUrl: coversFlag || null };
  const skipped = [];
  const notVerified = [];
  const keyFlags = { reader_key_set: 0, owner_key_set: 0 };

  // Step 1 — D1
  heading('1 · D1 create + migrate   (§7.6: AUTO)');
  const existingD1 = dry && fixture ? null : findD1(names.d1Name);
  if (existingD1) {
    state.databaseId = existingD1;
    if (!resumeMode && !dry) {
      stop(
        `A D1 called ${names.d1Name} already exists (${existingD1}).`,
        'That is either a half-finished provision — re-run with --resume — or another',
        "catalog's database. Adopting it silently is how a new catalog ends up bound to",
        'the wrong data, so this run stops instead.',
      );
    }
    console.log(`  exists already   ${names.d1Name}  ${existingD1}${resumeMode ? '  — skipped (--resume)' : ''}`);
    skipped.push(`D1 ${names.d1Name}`);
  } else {
    printCmd(cmd('create', { args: ['d1', 'create', names.d1Name] }));
    if (!dry) {
      const out = runWrangler({ args: ['d1', 'create', names.d1Name] });
      state.databaseId = parseDatabaseId(out);
      if (!state.databaseId) {
        stop(
          `wrangler created ${names.d1Name} but no database_id could be read from its output.`,
          'Run `npx wrangler d1 list --json`, find the id, and re-run with --resume.',
        );
      }
      console.log(`  created          ${names.d1Name}  ${state.databaseId}`);
    } else {
      // ⚠️ A zero UUID rather than a `<placeholder>` string, deliberately: the
      // rendered block is checked for leftover `<…>` placeholders, and that
      // check is worth MORE in a dry run than anywhere else — it is the only
      // place anybody looks at the block before it is real. A stand-in that
      // trips the guard would force the guard to be skipped in dry mode, which
      // is exactly when it should be running.
      state.databaseId = DRY_DATABASE_ID;
      console.log(`  (dry run: ${DRY_DATABASE_ID} stands in for the id wrangler would return)`);
    }
  }
  console.log('  ⚠️ The binding stays DB, and migrations_dir is the shared ../../migrations.');

  // Step 2 — R2 + its own covers hostname
  heading('2 · R2 covers bucket + its OWN covers hostname   (§7.6: AUTO)');
  console.log(`  ⚠️ gamecovers.heygabi.ai is TAKEN — a custom domain belongs to exactly ONE`);
  console.log(`     bucket — so this instance gets ${names.coversHost}.`);
  const bucketExists = dry && fixture ? false : hasBucket(names.bucketName);
  if (bucketExists) {
    console.log(`  exists already   ${names.bucketName}${resumeMode ? '  — skipped (--resume)' : ''}`);
    if (!resumeMode && !dry) {
      stop(
        `An R2 bucket called ${names.bucketName} already exists.`,
        'Re-run with --resume if that was this provision; otherwise pick a free ordinal.',
      );
    }
    skipped.push(`R2 ${names.bucketName}`);
  } else {
    printCmd(cmd('create', { args: ['r2', 'bucket', 'create', names.bucketName] }));
    if (!dry) {
      runWrangler({ args: ['r2', 'bucket', 'create', names.bucketName] });
      console.log(`  created          ${names.bucketName}`);
    }
  }
  printCmd(
    cmd('domain', {
      args: ['r2', 'bucket', 'domain', 'add', names.bucketName, '--domain', names.coversHost, '--zone-id', HEYGABI_ZONE_ID],
    }),
  );
  console.log('  ⚠️ --zone-id is REQUIRED non-interactively: without it wrangler prompts for the');
  console.log('     zone, and an automatic "yes" answers the first prompt, never a zone CHOICE.');
  console.log('  ⚠️ Attach is not instant — ownership/ssl read `pending` for a few minutes, then');
  console.log(`     active. Check: npx wrangler r2 bucket domain list ${names.bucketName}`);
  if (!dry && !state.coversBaseUrl) {
    if (!resumeMode || !hasCoversDomain(names.bucketName, names.coversHost)) {
      runWrangler({
        args: ['r2', 'bucket', 'domain', 'add', names.bucketName, '--domain', names.coversHost, '--zone-id', HEYGABI_ZONE_ID],
      });
    } else {
      console.log(`  exists already   ${names.coversHost} is attached — skipped (--resume)`);
      skipped.push(`covers domain ${names.coversHost}`);
    }
  }
  if (!state.coversBaseUrl) {
    const fromToml = existingVar(toml, names.instance, 'COVERS_BASE_URL');
    state.coversBaseUrl = fromToml || names.coversBaseUrl;
  }
  console.log(`  COVERS_BASE_URL  ${state.coversBaseUrl}`);
  console.log('  ⚠️ BOTH the COVERS binding AND COVERS_BASE_URL, or neither — the cover route');
  console.log('     refuses to write with only one of them.');

  // Step 3 — the toml block
  heading(`3 · The [env.${names.instance}] block, RENDERED from the commented template   (§7.6: AUTO)`);
  const blockPresent = envNames.includes(names.instance);
  let block = '';
  try {
    block = renderEnvBlock(toml, names, {
      databaseId: state.databaseId,
      coversBaseUrl: state.coversBaseUrl,
      ownerEmails,
      namespaceId,
    });
  } catch (err) {
    stop(err.message);
  }
  const missing = missingVars(toml, block);
  if (missing.length) {
    stop(
      `the rendered block does not restate ${missing.join(', ')}, which the live [vars] carries.`,
      '[env.*] inherits NOTHING, so that is a MISSING value on the new Worker, not a fallback.',
      'Fix the template at the foot of apps/worker/wrangler.toml — instance-template.test.ts',
      'is the guard that should have caught this first.',
    );
  }
  console.log(`  ✅ checked       every live [vars] key is restated (${liveVarNames(toml).length} keys,`);
  console.log(`                   minus ${MUST_NOT_RESTATE.join(' / ')}, which are being REMOVED)`);
  if (blockPresent) {
    console.log(`  exists already   [env.${names.instance}] is in apps/worker/wrangler.toml — skipped`);
    skipped.push(`[env.${names.instance}]`);
  } else if (dry) {
    console.log(`  would insert ${block.split('\n').length} lines into apps/worker/wrangler.toml,`);
    console.log('  ⚠️ ABOVE the commented template, never at EOF — the drift guard slices from the');
    console.log('     template banner to end-of-file and requires every line there to be commented.');
    console.log('');
    for (const line of block.split('\n')) console.log(`    │ ${line}`);
  } else {
    writeFileSync(WRANGLER_TOML, insertEnvBlock(readFileSync(WRANGLER_TOML, 'utf8'), block), 'utf8');
    console.log(`  inserted         [env.${names.instance}] → apps/worker/wrangler.toml (above the template)`);
  }

  // Step 4 — package.json twins
  heading('4 · package.json script twins   (§7.6: AUTO)');
  const rootAdd = rootScriptTwins(names.instance);
  const workerAdd = workerScriptTwins(names.instance, names.d1Name);
  let addedAnyScript = false;
  for (const [file, additions, anchor] of [
    [ROOT_PKG, rootAdd, 'postdeploy:games2'],
    [WORKER_PKG, workerAdd, 'db:migrate:games2'],
  ]) {
    const where = file.replace(ROOT, '.').split('\\').join('/');
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const { scripts, added } = insertScripts(pkg.scripts, additions, anchor);
    if (!added.length) {
      console.log(`  exists already   ${where} — every twin is present`);
      continue;
    }
    addedAnyScript = true;
    // ⚠️ The file is named on every line: `deploy:<instance>` legitimately exists
    // in BOTH package.json files with DIFFERENT bodies (the root one builds and
    // delegates; the worker one is the bare wrangler call), and two identical
    // lines with different meanings is how a reader concludes the run repeated
    // itself.
    for (const name of added) {
      console.log(`  ${(dry ? 'would add' : 'added').padEnd(9)}  ${where}  ${name}`);
      console.log(`             ↳ ${additions[name]}`);
    }
    if (!dry) {
      pkg.scripts = scripts;
      writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    }
  }
  console.log('  ⚠️ deploy-guard.mjs and deploy-done.mjs already take --instance=<name>, and every');
  console.log('     twin starts with instance-guard.mjs so a mistyped env refuses in words.');

  // Step 5 — commit
  heading('5 · Commit the allowlist   (§7.4 point 3 — never `git add -A`)');
  const allowlist_files = ['apps/worker/wrangler.toml', 'package.json', 'apps/worker/package.json'];
  console.log(`  staged by name   ${allowlist_files.join('  ')}`);
  if (dry) {
    console.log(`    $ git add ${allowlist_files.join(' ')}`);
    console.log('    $ git commit -F <message file>');
  } else if (blockPresent && !addedAnyScript) {
    console.log('  nothing to commit — the config was already in place');
  } else {
    const msg = join(ROOT, '.provision-commit.msg');
    writeFileSync(
      msg,
      `provision: [env.${names.instance}] — ${names.displayName} at ${names.host}\n\n` +
        `catalog_request #${names.requestId}, estate app ${names.estateApp}, D1 ${names.d1Name},\n` +
        `bucket ${names.bucketName}, covers ${names.coversHost}, rate-limit namespace ${namespaceId}.\n` +
        'Generated by scripts/provision-catalog.mjs.\n',
      'utf8',
    );
    try {
      git(['add', ...allowlist_files]);
      git(['commit', '-F', msg]);
      console.log(`  committed        ${git(['rev-parse', '--short', 'HEAD'])}`);
    } finally {
      rmSync(msg, { force: true });
    }
  }

  // Step 6 — migrate
  heading('6 · Migrate the new D1 — BEFORE any deploy   (§7.6: AUTO)');
  console.log(`    $ npm run db:migrate:${names.instance}`);
  console.log('  ⚠️ Silence from migrate is a FAILED migration — expect the checkbox table.');
  console.log('  ⚠️ Do NOT use the hand-applied `d1 execute --remote` + manual d1_migrations');
  console.log('     INSERT method. `migrations apply --remote` was re-measured working on this');
  console.log('     account on 2026-09-02 (docs/access/deploys.md gotcha 3).');
  if (!dry) npmRun(`db:migrate:${names.instance}`);

  // Step 7 — PAUSE #1
  heading('7 · ⏸ PAUSE #1 — Firebase authorised domain   (🔴 MANUAL)');
  const domains = await firebaseAuthorisedDomains();
  if (domains === null) {
    notVerified.push('the Firebase authorised-domain list (the read failed — not that the domain is absent)');
    console.log('  ⚠️ Could not read the authorised-domain list. That is a failed READ, not a');
    console.log('     verdict about the domain — treat it as unknown.');
  } else if (domains.includes(names.host)) {
    console.log(`  ✅ measured      ${names.host} is on the ${FIREBASE_PROJECT} authorised list`);
  } else {
    console.log(`  ❌ measured      ${names.host} is NOT on the ${FIREBASE_PROJECT} authorised list`);
    console.log(`     the list holds: ${domains.join(', ')}`);
    for (const line of manualRunbook(names, { platformDir: platform.dir }).slice(0, 12)) {
      console.log(`  ${line}`);
    }
    if (!dry) {
      console.log('');
      console.log(`  Do it, then: npm run provision:catalog -- --request ${requestId} --resume`);
      await closeHttpPool();
      process.exit(3);
    }
  }

  // Step 8 — PAUSE #2
  heading('8 · ⏸ PAUSE #2 — auth-worker consumer registration   (🔴 MANUAL, reviewed code)');
  const reg = checkAuthWorkerRegistration(names, ctx.authWorkerDir);
  for (const [ok, what] of reg.checks) console.log(`  ${ok ? '✅' : '❌'} ${what}`);
  console.log('  ⚠️ Those read the SOURCE. Nothing here proves the auth Worker was migrated and');
  console.log('     deployed — only a real sign-in tailed with "src":"seen" does.');
  notVerified.push('that the auth Worker was migrated and deployed (source is not production)');
  if (!reg.ok) {
    console.log('');
    for (const line of manualRunbook(names, { platformDir: platform.dir }).slice(13)) console.log(`  ${line}`);
    if (!dry) {
      console.log('');
      console.log(`  Do it, then: npm run provision:catalog -- --request ${requestId} --resume`);
      await closeHttpPool();
      process.exit(3);
    }
  }

  // Step 9 — the paired estate token
  heading('9 · The paired estate token — one value, two holders, the same NAME   (§7.6: AUTO)');
  console.log('  ⚠️ PIPE FIRST, DEPLOY SECOND — there is no inert window that way round.');
  console.log('  ⚠️ Minted with node crypto, hex, no trailing newline and no BOM: an invisible');
  console.log('     BOM makes a bearer fail while looking perfect everywhere a human can check.');
  printCmd(cmd('put', { args: ['secret', 'put', names.tokenName, '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: names.tokenName }));
  printCmd(cmd('put', { bin: ctx.platformWrangler, cwd: ctx.authWorkerDir, args: ['secret', 'put', names.tokenName], stdinSecret: names.tokenName }));
  if (!dry) {
    const already = secretNames(names.instance).includes(names.tokenName);
    if (already && resumeMode) {
      console.log(`  exists already   ${names.tokenName} on env ${names.instance} — skipped (--resume)`);
      skipped.push(names.tokenName);
      notVerified.push(`that the existing ${names.tokenName} matches the auth Worker's copy (a value cannot be read back)`);
    } else {
      const token = randomBytes(32).toString('hex');
      const a = await putSecret(names.tokenName, token, { env: names.instance, config: WRANGLER_TOML });
      const b = await putSecret(names.tokenName, token, {
        cwd: ctx.authWorkerDir,
        bin: ctx.platformWrangler,
      });
      if (a !== 0 || b !== 0) {
        stop(
          `Setting ${names.tokenName} exited ${a} on the instance and ${b} on the auth Worker.`,
          'Read the wrangler output above. If only ONE side landed, set the other by hand',
          'with the same value or mint a fresh pair — a half-set bearer is a 401 the gate',
          'reports as estate_unreachable.',
        );
      }
      console.log(`  set on both      ${names.tokenName}`);
    }
  }

  // Step 10 — the rest of the secrets, and the key
  heading('10 · Per-instance secrets   (§7.6: AUTO · ANTHROPIC_API_KEY is SPECIAL)');
  const plan = secretPlan();
  for (const line of plan.lines) console.log(`  ${line}`);
  printCmd(cmd('bulk', { args: ['secret', 'bulk', '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: plan.push.join(', ') || '(none)' }));
  if (!dry) {
    const vars = readDevVars();
    const payload = {};
    for (const name of plan.push) if (vars[name]) payload[name] = vars[name];
    for (const n of plan.push.filter((n) => !vars[n])) console.log(`  skip (not set locally)   ${n}`);
    if (Object.keys(payload).length) {
      const code = await bulkSecrets(payload, names.instance);
      console.log(
        code === 0
          ? `  pushed ${Object.keys(payload).length} shared secret(s)`
          : `  ⚠️ wrangler exited ${code} — read the output above before assuming it failed.`,
      );
    }
  }

  // ── the key (design §6.4) ────────────────────────────────────────────────
  console.log('');
  console.log('  ANTHROPIC_API_KEY — precedence resolved HERE, at provisioning time (§6.4):');
  console.log('    1 the requester\'s sealed key · 2 the owner\'s sealed key · 3 the owner\'s own');
  const seal = await loadSealLib(platform.dir);
  let source = 'none';
  if (seal) {
    console.log(`  sealed-key lib   ${seal.where}`);
    printCmd(cmd('put', { args: ['secret', 'put', 'ANTHROPIC_API_KEY', '--env', names.instance], cwd: WORKER_DIR, stdinSecret: 'ANTHROPIC_API_KEY (sealed)' }));
    try {
      const out = await seal.injectSealedKey({
        requestId: names.requestId,
        workerDir: WORKER_DIR,
        envName: names.instance,
        dry,
      });
      source = out?.source ?? 'none';
    } catch (err) {
      console.log(`  ⚠️ the sealed-key step FAILED: ${String(err.message).split('\n')[0]}`);
      console.log('     That is a failed inject, not "there was no envelope" — falling through to');
      console.log('     row 3 would spend the owner\'s money on a decision nobody made, so this stops.');
      if (!dry) {
        await closeHttpPool();
        process.exit(1);
      }
    }
    console.log(`  sealed key       source = ${source}`);
  } else {
    console.log('  sealed-key lib   ABSENT — catalog-platform/scripts/lib/catalog-seal.mjs does not');
    console.log('                   exist yet (design phase 5). Row 3 applies, exactly as it does');
    console.log('                   on the books side.');
  }

  if (source === 'reader') {
    keyFlags.reader_key_set = 1;
    console.log('  ✅ the REQUESTER\'S own key is set. This instance spends THEIR money, on their cap.');
  } else if (source === 'owner') {
    keyFlags.owner_key_set = 1;
    console.log('  ✅ the owner\'s SEALED key is set (attached at Accept).');
  } else {
    // Row 3 — the standing decision.
    printCmd(cmd('put', { args: ['secret', 'put', 'ANTHROPIC_API_KEY', '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: 'ANTHROPIC_API_KEY (owner)' }));
    console.log('  owner key used — standing decision 2026-09-05 (design §6.4 row 3)');
    console.log('  ⚠️ This instance spends the OWNER\'S Anthropic key, hourly, on its details sweep.');
    keyFlags.owner_key_set = 1;
    if (!dry) {
      const vars = readDevVars();
      if (!vars.ANTHROPIC_API_KEY) {
        stop(
          `ANTHROPIC_API_KEY is not set in ${DEV_VARS}, and no sealed key was found, so there is`,
          'no key to pipe at all.',
          '',
          '🔴 A GAMES instance with no key has NO AI LOOKUPS AT ALL — nothing self-heals, ever.',
          'This is NOT the books situation: a keyless library still gets a free donor sweep from',
          'the main library, and this repo has no DONOR_URL, no PEERS and no donor route. The new',
          'catalog would look finished and could never fill itself in.',
          '',
          'Set the key locally (or attach a sealed one at Accept) and re-run with --resume.',
        );
      }
      const code = await putSecret('ANTHROPIC_API_KEY', vars.ANTHROPIC_API_KEY, {
        env: names.instance,
        config: WRANGLER_TOML,
      });
      if (code !== 0) console.log(`  ⚠️ wrangler exited ${code} setting ANTHROPIC_API_KEY — read the output above.`);
      else console.log('  set              ANTHROPIC_API_KEY   (owner key used — standing decision 2026-09-05)');
    } else {
      console.log('  🔴 If NEITHER a sealed key NOR the owner\'s key is available, this run STOPS:');
      console.log('     a games instance with no key has NO AI LOOKUPS AT ALL — nothing self-heals,');
      console.log('     ever. There is no donor and there are no peers here, so the books sentence');
      console.log('     ("the free donor sweep still runs") is false on this side.');
    }
  }

  // Step 11 — the deploy, printed
  heading('11 · ⏸ The guarded deploy — YOUR command, not this script\'s   (§7.6: AUTO, owner-run)');
  console.log(`    $ DEPLOY_HOLDER=<you> npm run deploy:${names.instance}`);
  console.log('');
  console.log('  npm runs the pre/post hooks itself, so that one line is the whole sequence:');
  console.log(`    predeploy:${names.instance}   instance-guard → estate syncs → check-clean →`);
  console.log(`                       deploy-guard --instance=${names.instance} → typecheck → tests`);
  console.log(`    deploy:${names.instance}      build the PWA, then wrangler deploy --env ${names.instance}`);
  console.log(`    postdeploy:${names.instance}  appends the docs/deploys.log line (env=${names.instance})`);
  console.log('');
  console.log('  ⚠️ Then COMMIT that log line — deploy-done.mjs writes it and deliberately does');
  console.log('     not commit it, which is also what puts it in front of a human.');
  console.log('  ⚠️ The deploy uploads the WORKING-TREE apps/web/dist, so it runs from a clean');
  console.log('     tree — or a `git worktree add <tmp> HEAD` checkout when agents share this one.');
  console.log('  ⚠️ The .deploy.lock is shared across instances ON PURPOSE: both deploys build');
  console.log('     into the same apps/web/dist.');
  const deployed = existsSync(DEPLOYS_LOG)
    ? deploysLogHasInstance(readFileSync(DEPLOYS_LOG, 'utf8'), names.instance)
    : false;
  if (deployed) {
    console.log(`  ✅ measured      docs/deploys.log carries an env=${names.instance} line — a guarded`);
    console.log('                   deploy has run. ⚠️ That it RAN, not that it succeeded; step 12 is');
    console.log('                   the measurement.');
  } else if (!dry) {
    console.log('');
    console.log(`  No env=${names.instance} line in docs/deploys.log yet. Run the deploy above, then:`);
    console.log(`    npm run provision:catalog -- --request ${requestId} --resume`);
    await closeHttpPool();
    process.exit(3);
  }

  // Step 12 — verify, then mark live
  heading('12 · Verify live, then mark the request live   (§7.6: AUTO)');
  const healthUrl = `https://${names.host}/api/health?cb=${randomBytes(6).toString('hex')}`;
  console.log(`    GET ${healthUrl}`);
  console.log('  ⚠️ The cache-buster is not decoration: /api/health is EDGE-CACHED on a custom');
  console.log('     domain, and a plain fetch right after a deploy returns the PREVIOUS body.');
  console.log(`  ⚠️ The body's estate block must read app:"${names.estateApp}",`);
  console.log(`     tokenVar:"${names.tokenName}", configured:true. Anything else means it is`);
  console.log('     asserting the wrong identity or is missing a half.');
  const update =
    `UPDATE catalog_request SET status = 'live', ` +
    `provisioned_instance = ${sqlLit(names.instance)}, ` +
    `provisioned_host = ${sqlLit(names.host)}, ` +
    `reader_key_set = ${keyFlags.reader_key_set}, ` +
    `owner_key_set = ${keyFlags.owner_key_set} ` +
    `WHERE id = ${names.requestId} AND status = 'accepted'`;
  printCmd(cmd('update', {
    bin: ctx.platformWrangler,
    cwd: ctx.authWorkerDir,
    args: ['d1', 'execute', ESTATE_DB, '--remote', '--json', '--command', update],
  }));
  if (!dry) {
    const health = await healthJson(healthUrl);
    if (!health.ok) {
      stop(
        `${names.host} did not answer 200 on /api/health, so the request is NOT marked live.`,
        '⚠️ This LAN negative-caches a new subdomain for ~30 minutes; try the workers.dev',
        `host (${names.workerName}.<account>.workers.dev), which is not fronted by the cache,`,
        'and re-run with --resume once the name resolves.',
      );
    }
    const app = health.body?.estate?.app ?? null;
    if (app !== names.estateApp) {
      stop(
        `${names.host} answers 200 but its estate block says app=${JSON.stringify(app)},`,
        `not "${names.estateApp}". That is the wrong identity at the directory — F-5 — and the`,
        'request is NOT marked live. Check ESTATE_APP in the new block and redeploy.',
      );
    }
    console.log(`  ✅ 200 from /api/health, estate.app = ${app}, configured = ${health.body?.estate?.configured}`);
    estateSql(update, ctx);
    const after = readRequest(names.requestId, ctx);
    console.log(`  row now          status=${after?.status} instance=${after?.provisioned_instance} host=${after?.provisioned_host} reader_key_set=${after?.reader_key_set} owner_key_set=${after?.owner_key_set}`);
  }

  /* ── the tail ──────────────────────────────────────────────────────────── */

  heading('The manual runbook, in full');
  for (const line of manualRunbook(names, { platformDir: platform.dir })) console.log(`  ${line}`);

  heading('Review it');
  console.log(`  https://${names.host}/`);
  console.log(`  https://${names.host}/api/health?cb=1   (estate.app should read ${names.estateApp})`);
  console.log(`  https://heygabi.ai/admin/               (the request row, now live)`);
  console.log('');
  console.log('  Then, ONCE, watch a real sign-in — the only proof the bearer is right:');
  console.log(`    npm run tail:${names.instance} --workspace @bgc/worker`);
  console.log(`    look for app=${names.estateApp} on the estate line  (a wrong VALUE reads as estate_unreachable)`);

  if (skipped.length) {
    heading('Skipped because it already existed');
    for (const s of skipped) console.log(`  • ${s}`);
  }
  heading('⚠️ NOT verified by this run');
  for (const n of notVerified) console.log(`  • ${n}`);
  console.log('  • that the requester can actually sign in (needs a real browser and their account)');
  console.log(`  • that ${names.coversHost} serves an object (the domain attach is asynchronous)`);

  if (dry) {
    console.log('\nDry run — nothing was created, written, committed, minted or deployed.');
  }
  // ⚠️ NOT `process.exit(0)`. Measured on the books twin, 2026-09-05: a
  // successful --dry run exited **127** with `Assertion failed: !(handle->flags
  // & UV_HANDLE_CLOSING)` — node tearing itself down while an undici keep-alive
  // socket from the Firebase read was still closing. A success that reports 127
  // is worse than no exit code at all, because anything scripting this reads it
  // as a failure. Closing the pool and letting node exit on its own is the fix;
  // every FAILURE path above still exits explicitly and non-zero.
  await closeHttpPool();
  process.exitCode = 0;
}

/** Let undici's keep-alive sockets go, so the process can exit cleanly. */
async function closeHttpPool() {
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (dispatcher && typeof dispatcher.close === 'function') await dispatcher.close();
  } catch {
    /* best effort — an unclosed pool is a slow exit, never a wrong answer */
  }
}

/** Only used to let `--resume` re-derive a name whose env block already exists. */
function sanitiseSafe(row, override) {
  try {
    return sanitiseInstanceName(override || row.desired_subdomain || '', { existingEnvs: [] }).name;
  } catch {
    return null;
  }
}

function stop(...lines) {
  console.error('');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

/** The database_id out of `wrangler d1 create`'s copy-paste snippet. */
export function parseDatabaseId(out) {
  const m = out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) || out.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i);
  return m ? m[1] : null;
}

function findD1(name) {
  try {
    const list = extractJsonArray(runWrangler({ args: ['d1', 'list', '--json'] }));
    const hit = list.find((d) => d?.name === name);
    return hit?.uuid || hit?.database_id || null;
  } catch {
    return null;
  }
}

function hasBucket(name) {
  try {
    const out = runWrangler({ args: ['r2', 'bucket', 'list'] });
    return new RegExp(`(^|[\\s:"])${name}([\\s"]|$)`, 'm').test(out);
  } catch {
    return false;
  }
}

function hasCoversDomain(bucket, host) {
  try {
    return runWrangler({ args: ['r2', 'bucket', 'domain', 'list', bucket] }).includes(host);
  } catch {
    return false;
  }
}

/**
 * One var already written into this instance's `[env.<i>.vars]` block, for
 * `--resume` — the block IS the record of what the first half of the run chose.
 */
export function existingVar(toml, instance, key) {
  // ⚠️ Line-anchored, NOT indexOf: `[env.games2.vars]` is MENTIONED in comments
  // elsewhere in this file, and an indexOf lands there and reads a comment as a
  // table. (The books twin records the same trap, measured.)
  const start = toml.search(new RegExp(`^\\[env\\.${instance}\\.vars\\]\\s*$`, 'm'));
  if (start === -1) return null;
  const section = toml.slice(start);
  const m = section.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return m ? m[1] : null;
}

/** wrangler `secret list --env <i>` → the NAMES it holds. Never a value; there is none to read. */
function secretNames(instance) {
  try {
    const out = runWrangler({ args: ['secret', 'list', '--config', WRANGLER_TOML, '--env', instance] });
    return [...out.matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** Reads `.dev.vars` IN CODE. No value ever reaches a console, a log or a file. */
function readDevVars() {
  let raw;
  try {
    raw = readFileSync(DEV_VARS, 'utf8');
  } catch {
    stop(
      `No .dev.vars at ${DEV_VARS}, so there are no values to send.`,
      "It is this repo's documented single source of truth for key material.",
      'Restore it and re-run with --resume.',
    );
  }
  return parseDevVars(raw);
}

/**
 * The sealed-key library from the sibling `catalog-platform` checkout, if it
 * exists yet (design phase 5, built by another agent).
 *
 * ⚠️ ABSENT and `source: 'none'` are the same outcome for us — row 3 — but they
 * are DIFFERENT FACTS and are printed differently: one is "that phase has not
 * landed", the other is "it has, and this request carried no envelope".
 */
async function loadSealLib(platformDir) {
  const path = join(platformDir, 'scripts', 'lib', 'catalog-seal.mjs');
  if (!existsSync(path)) return null;
  try {
    const mod = await import(`file://${path.split('\\').join('/')}`);
    if (typeof mod.injectSealedKey !== 'function') {
      console.log('  ⚠️ catalog-seal.mjs exists but exports no injectSealedKey — treating it as absent.');
      return null;
    }
    return { injectSealedKey: mod.injectSealedKey, where: path };
  } catch (err) {
    console.log(`  ⚠️ catalog-seal.mjs could not be imported (${String(err.message).split('\n')[0]}) — treating it as absent.`);
    return null;
  }
}

/**
 * The authorised-domain list, read LIVE from Identity Platform with the public
 * web api key. Returns null when the READ failed — which is not the same fact as
 * "the domain is absent", and the caller says so.
 */
async function firebaseAuthorisedDomains() {
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(FIREBASE_WEB_KEY)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!r.ok) return null;
    const body = await r.json();
    return Array.isArray(body?.authorizedDomains) ? body.authorizedDomains : null;
  } catch {
    return null;
  }
}

/** Whatever of PAUSE #2 can be read out of the sibling checkout's source. */
export function checkAuthWorkerRegistration(names, authWorkerDir, { read = readIfExists, list = listIfExists } = {}) {
  const envTs = read(join(authWorkerDir, 'src', 'env.ts'));
  const estateTs = read(join(authWorkerDir, 'src', 'estate.ts'));
  const registryTs = read(join(authWorkerDir, 'src', 'billing-registry.ts'));
  const migrations = list(join(authWorkerDir, 'migrations'));
  const checks = [
    [new RegExp(`CONSUMER_APPS[^;]*'${names.estateApp}'`, 's').test(envTs), `CONSUMER_APPS contains '${names.estateApp}'  (src/env.ts:4)`],
    [new RegExp(`${names.tokenName}\\??\\s*:`).test(envTs), `Env declares ${names.tokenName}`],
    [new RegExp(`case '${names.estateApp}'`).test(envTs), `appTokenFor() has a case '${names.estateApp}' arm`],
    [new RegExp(`case '${names.estateApp}'`).test(estateTs), `siteForApp() has a case '${names.estateApp}' arm  (src/estate.ts:118)`],
    [new RegExp(`BILLING_SITES[^;]*'${names.estateApp}'`, 's').test(registryTs), `BILLING_SITES contains '${names.estateApp}'  (src/billing-registry.ts:38)`],
    [migrations.some((f) => f.includes(names.visColumn)), `a migration adding ${names.visColumn} exists`],
  ];
  return { ok: checks.every(([ok]) => ok), checks };
}

function readIfExists(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function listIfExists(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 200 + the parsed body, so the estate identity can be MEASURED, not assumed. */
async function healthJson(url) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.status !== 200) return { ok: false, body: null };
    return { ok: true, body: await r.json() };
  } catch {
    return { ok: false, body: null };
  }
}
