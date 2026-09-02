/**
 * Stop two concurrent runs from deploying over each other.
 *
 * ## The failure this exists to prevent
 *
 * Two sessions working the same repo at once — on 2026-08-13 an Opus session and
 * Fable subagents, both allowed to deploy — can each build from their own tree
 * and ship. The loser's changes are not merged or conflicted; they are simply
 * **absent from the bundle that went live**, because a Worker deploy is a whole
 * artifact replacement rather than a patch. Production silently regresses to
 * whichever tree deployed last, and `check-clean.mjs` cannot see it: both trees
 * were perfectly committed.
 *
 * ⚠️ So the dangerous case is not a dirty tree. It is **a clean tree that does
 * not contain what is already live.**
 *
 * ## Two guards, because they catch different halves
 *
 * 1. **A lock** — refuses while another deploy is genuinely in flight. Covers the
 *    narrow window where both are running `wrangler deploy` at once.
 * 2. **An ancestry check** — refuses when the commit that is *already live* is not
 *    an ancestor of `HEAD`. This is the one that matters: it catches the case
 *    where the other run finished cleanly minutes ago and this tree never picked
 *    its work up. A lock alone would let that through.
 *
 * The live commit is read from `docs/deploys.log`, which is **tracked in git** on
 * purpose — it is the shared record both runs can see, and it survives a machine
 * restart in a way a lock file does not.
 *
 * ## Usage
 *
 *   DEPLOY_HOLDER=fable npm run deploy     # identify yourself; anything short
 *   ALLOW_OVERLAP=1 npm run deploy         # override, deliberately
 *
 * Released by `deploy-done.mjs` in `postdeploy`. ⚠️ npm does **not** run a post
 * hook when the deploy fails, so a crashed deploy leaves the lock behind — hence
 * `STALE_MINUTES`, after which the lock is reported and taken over rather than
 * blocking forever.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const LOCK = join(ROOT, '.deploy.lock');
const LOG = join(ROOT, 'docs', 'deploys.log');
/** Long enough for a real deploy (build + upload ran ~60s on 2026-08-13), short
 *  enough that a crash does not block the night. */
const STALE_MINUTES = 20;

const holder = process.env['DEPLOY_HOLDER'] || 'unknown';
const override = process.env['ALLOW_OVERLAP'] === '1';

/**
 * Which instance this deploy targets: `--instance=friend` for the second
 * library (wrangler `[env.friend]`), nothing for the main one. The ancestry
 * check below compares against the last deploy OF THE SAME INSTANCE — the two
 * Workers are separate artifacts, so the friend Worker being behind main's
 * log line (or vice versa) is normal, not a regression.
 *
 * ⚠️ The LOCK stays shared across instances on purpose: both deploys build
 * into the same `apps/web/dist`, so two concurrent deploys — even of
 * different instances — can still ship each other's half-built assets.
 */
const instance =
  process.argv.find((a) => a.startsWith('--instance='))?.slice('--instance='.length) || 'default';

/** The instance a deploys.log line belongs to (5th field `env=<name>`, absent = default). */
function lineInstance(line) {
  const fifth = line.split('\t')[4];
  return fifth?.startsWith('env=') ? fifth.slice(4) : 'default';
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  process.exit(1);
}

let head;
try {
  head = git(['rev-parse', 'HEAD']);
} catch {
  console.log('deploy-guard: no git available, skipping.');
  process.exit(0);
}

/* -- guard 1: is another deploy in flight? --------------------------------- */

if (existsSync(LOCK)) {
  let lock = null;
  try {
    lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    // A corrupt lock is not a reason to block; treat it as absent but say so.
    console.log('deploy-guard: lock file unreadable, ignoring it.');
  }
  if (lock) {
    const ageMin = (Date.now() - new Date(lock.startedAt).getTime()) / 60000;
    if (ageMin < STALE_MINUTES && !override) {
      fail([
        `deploy-guard: refusing — "${lock.holder}" started a deploy ${ageMin.toFixed(1)} min ago.`,
        `  its commit: ${lock.head}`,
        '',
        'Wait for it to finish, then deploy again — you may also need to pull its',
        'commit first, or the ancestry check below will stop you.',
        '',
        'Override only if you know that deploy died: ALLOW_OVERLAP=1 npm run deploy',
      ]);
    }
    console.log(
      `deploy-guard: taking over a ${ageMin.toFixed(0)} min old lock from "${lock.holder}" ` +
        `(stale after ${STALE_MINUTES} min).`,
    );
  }
}

/* -- guard 2: does this tree contain what is already live? ----------------- */

if (existsSync(LOG)) {
  const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  // Only lines for THIS instance — see lineInstance above. For the default
  // instance this is every line the log ever had before instances existed,
  // so pre-instance behaviour is unchanged byte for byte. A first-ever deploy
  // of a new instance has no lines and skips the ancestry check.
  const last = lines.filter((l) => lineInstance(l) === instance).at(-1);
  // Format is written by deploy-done.mjs: ISO<TAB>commit<TAB>holder<TAB>note[<TAB>env=<instance>]
  const liveCommit = last?.split('\t')[1];
  if (liveCommit && /^[0-9a-f]{7,40}$/.test(liveCommit)) {
    let contains = false;
    try {
      // merge-base --is-ancestor exits 0 when the first commit is an ancestor of
      // the second. A commit is its own ancestor, so redeploying the same tree
      // passes, which is what we want.
      execFileSync('git', ['merge-base', '--is-ancestor', liveCommit, head], { cwd: ROOT });
      contains = true;
    } catch {
      contains = false;
    }
    if (!contains && !override) {
      fail([
        'deploy-guard: refusing — what is LIVE is not in this tree.',
        '',
        `  live commit : ${liveCommit}  (per docs/deploys.log)`,
        `  your HEAD   : ${head}`,
        '',
        '⚠️ Deploying now would ship a bundle that does not contain the live code,',
        '   silently reverting whatever the other run shipped.',
        '',
        'Fix it by picking their work up first:',
        '    git pull --rebase        (or: git fetch && git rebase origin/main)',
        '',
        'If that commit is genuinely unknown to this repo, the log and the live',
        'Worker disagree — check `npx wrangler deployments list` before overriding.',
      ]);
    }
  }
}

/* -- take the lock --------------------------------------------------------- */

mkdirSync(dirname(LOCK), { recursive: true });
writeFileSync(
  LOCK,
  `${JSON.stringify({ holder, instance, pid: process.pid, head, startedAt: new Date().toISOString() }, null, 2)}\n`,
);
console.log(
  `deploy-guard: ok — lock taken by "${holder}" at ${head.slice(0, 8)}` +
    `${instance === 'default' ? '' : ` (instance: ${instance})`}.`,
);
