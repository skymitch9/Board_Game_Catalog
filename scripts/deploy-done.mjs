/**
 * Release the deploy lock and record what went live.
 *
 * Runs as `postdeploy`, so it only fires when the deploy succeeded — which is
 * exactly right: a failed deploy did not change what is live, so the log must not
 * claim it did. ⚠️ The cost of that choice is a lock left behind by a crashed
 * deploy, which `deploy-guard.mjs` handles with its staleness timeout rather than
 * by writing an optimistic log entry here.
 *
 * `docs/deploys.log` is **tracked in git**, deliberately. It is the one record
 * both concurrent runs can read, it is what the guard's ancestry check keys on,
 * and committing it means "what is live" is answerable from the repo alone rather
 * than by asking Cloudflare.
 *
 * ⚠️ It writes the log but does NOT commit it — committing from a deploy hook
 * would create commits nobody asked for, in the middle of someone else's work.
 * The run that deployed commits it, which is also what puts it in front of a human.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const LOCK = join(ROOT, '.deploy.lock');
const LOG = join(ROOT, 'docs', 'deploys.log');

const holder = process.env['DEPLOY_HOLDER'] || 'unknown';

/**
 * `--instance=friend` = the second library's wrangler env; nothing = the main
 * instance, whose log line stays exactly the pre-instance four-field shape.
 * A non-default instance appends a fifth field `env=<name>`, which is what
 * deploy-guard.mjs keys its per-instance ancestry filtering on.
 */
const instance =
  process.argv.find((a) => a.startsWith('--instance='))?.slice('--instance='.length) || 'default';

let head = 'unknown';
try {
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout — still worth releasing the lock */
}

/**
 * Ask Cloudflare which version is now live, so the log carries the same id the
 * dashboard shows — the 3am "put it back" reference is only useful if it names
 * something rollable.
 *
 * ⚠️ **This silently recorded `version-unknown` on EVERY line for its whole
 * life** (fixed 2026-08-25 with the review batch), for two independent reasons,
 * both of which failed into the same empty `catch`:
 *
 *  1. **`execFileSync('npx', …)` cannot run npx on Windows.** npx is `npx.cmd`;
 *     without `shell` the call is `ENOENT`, and since Node 22 running a `.cmd`
 *     through `execFile` is `EINVAL` even when named exactly. So the lookup
 *     never ran once on this machine. It is invoked through `process.execPath`
 *     and wrangler's own entry script now — no shell, no `.cmd`, nothing to
 *     quote, and the same call on every platform.
 *  2. **The regex took the first UUID in the output**, which is the OLDEST
 *     deployment's `id` — not a version id at all, and not the one that just
 *     went live. `--json` is parsed instead: the newest deployment by
 *     `created_on`, then the version carrying the largest percentage (100 for an
 *     ordinary deploy; a gradual rollout has two, and the one being rolled OUT
 *     is not what shipped).
 *
 * Still best-effort and still wrapped: it is a network call in a hook, and a
 * slow or failed lookup must not fail a deploy that already succeeded. A blank
 * is recorded as `version-unknown`, which is honest — but it should now be rare
 * enough to be worth investigating rather than expected.
 */
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/** The version id that is live now, or '' when it could not be read. */
function liveVersionId() {
  if (!existsSync(WRANGLER)) return '';
  // The env name reaches a child process argument list; it comes from our own
  // package.json scripts, and this keeps it that way.
  if (instance !== 'default' && !/^[a-z0-9_-]+$/i.test(instance)) return '';
  const out = execFileSync(
    process.execPath,
    [
      WRANGLER,
      'deployments',
      'list',
      '--config',
      join('apps', 'worker', 'wrangler.toml'),
      ...(instance === 'default' ? [] : ['--env', instance]),
      '--json',
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const list = JSON.parse(out);
  if (!Array.isArray(list) || list.length === 0) return '';
  // ⚠️ Sorted, not `at(-1)`: the API happens to answer oldest-first today and
  // "the newest is last" is not a documented promise.
  const newest = list
    .slice()
    .sort((a, b) => String(a?.created_on ?? '').localeCompare(String(b?.created_on ?? '')))
    .at(-1);
  const versions = Array.isArray(newest?.versions) ? newest.versions : [];
  const live = versions
    .slice()
    .sort((a, b) => Number(a?.percentage ?? 0) - Number(b?.percentage ?? 0))
    .at(-1);
  return typeof live?.version_id === 'string' ? live.version_id : '';
}

let version = '';
try {
  version = liveVersionId();
} catch {
  /* leave it blank rather than guess */
}

mkdirSync(dirname(LOG), { recursive: true });
appendFileSync(
  LOG,
  `${new Date().toISOString()}\t${head}\t${holder}\t${version || 'version-unknown'}` +
    `${instance === 'default' ? '' : `\tenv=${instance}`}\n`,
);
if (existsSync(LOCK)) rmSync(LOCK);

console.log(
  `deploy-done: recorded ${head.slice(0, 8)} by "${holder}"` +
    `${version ? ` as ${version.slice(0, 8)}` : ''}` +
    `${instance === 'default' ? '' : ` (instance: ${instance})`} in docs/deploys.log — lock released.`,
);
console.log('deploy-done: ⚠️ commit docs/deploys.log so the other run can see it.');
