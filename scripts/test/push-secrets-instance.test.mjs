/**
 * A bulk push aimed at a SECOND instance must never carry a per-instance key.
 *
 * `scripts/push-secrets.mjs` gained `--env <name>` on 2026-09-05 so a second
 * games catalog can be fed from the one `.dev.vars` (request-a-catalog design §8
 * item 2). The valuable half of that flag is what it REFUSES:
 * `ANTHROPIC_API_KEY` (that household's spend, on their billing) and every
 * `ESTATE_APP_TOKEN_*` (which consumer is speaking to the estate directory — two
 * instances are two consumers). A "cleanup" push that overwrote either would be
 * SILENT: the second instance's estate check would begin answering
 * `estate_unreachable` and its bills would land on the owner, with nothing red.
 *
 * ⚠️ Spawned rather than imported, deliberately. The script is a top-level
 * program — importing it would run it — and the thing worth pinning is the
 * behaviour of the real command an operator types, not a helper extracted for
 * the test's convenience. `--dry` sends nothing.
 *
 * ⚠️ Names only. The script prints a last-4 fingerprint beside each key it would
 * push; nothing here reads, asserts on, or echoes one.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'push-secrets.mjs');
const DEV_VARS = join(ROOT, 'apps', 'worker', '.dev.vars');

/** The names on `push` lines — never the fingerprint that follows them. */
function pushedNames(stdout) {
  return [...stdout.matchAll(/^ {2}push {2}(\S+)/gm)].map((m) => m[1]);
}

function run(args) {
  const out = spawnSync(process.execPath, [SCRIPT, ...args, '--dry'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return `${out.stdout ?? ''}${out.stderr ?? ''}`;
}

describe('push-secrets --env <instance>', () => {
  // `.dev.vars` is gitignored, so a clone or a throwaway worktree has none and
  // the script correctly refuses to run at all. Say so out loud rather than
  // passing vacuously — a guard that silently skips is not a guard.
  const haveDevVars = existsSync(DEV_VARS);

  it('🔴 REFUSES ANTHROPIC_API_KEY for a second instance, and says how to set it', (t) => {
    if (!haveDevVars) return t.skip('no apps/worker/.dev.vars on this machine — nothing to push from');
    const out = run(['--env', 'games2']);
    assert.match(out, /ANTHROPIC_API_KEY — REFUSED for instance "games2"/);
    assert.match(out, /npm run secret:games2 -- ANTHROPIC_API_KEY/);
    assert.ok(
      !pushedNames(out).includes('ANTHROPIC_API_KEY'),
      'ANTHROPIC_API_KEY would be sent to a second instance — that is the owner’s key on the owner’s billing',
    );
  });

  it('🔴 no ESTATE_APP_TOKEN_* is ever in a second instance’s payload', (t) => {
    if (!haveDevVars) return t.skip('no apps/worker/.dev.vars on this machine — nothing to push from');
    const leaked = pushedNames(run(['--env', 'games2'])).filter((n) => n.startsWith('ESTATE_APP_TOKEN_'));
    assert.deepEqual(
      leaked,
      [],
      'an estate bearer would be bulk-pushed — this is how one instance ends up presenting another’s badge',
    );
  });

  it('names the instance it is targeting, so a mis-aimed run is visible before it sends', (t) => {
    if (!haveDevVars) return t.skip('no apps/worker/.dev.vars on this machine — nothing to push from');
    assert.match(run(['--env', 'games2']), /target = instance "games2"/);
    assert.match(run([]), /target = the MAIN instance/);
  });

  it('the MAIN path still pushes the keys it always did', (t) => {
    if (!haveDevVars) return t.skip('no apps/worker/.dev.vars on this machine — nothing to push from');
    // The point of the flag is that the no-flag path is UNCHANGED: whatever the
    // allowlist holds and `.dev.vars` has, main gets — including the key a
    // second instance is refused.
    const main = pushedNames(run([]));
    assert.ok(main.length > 0, 'the main run pushes nothing at all — the allowlist or .dev.vars changed');
    assert.ok(
      main.includes('ANTHROPIC_API_KEY'),
      'ANTHROPIC_API_KEY is no longer pushed to MAIN — the refusal has leaked into the default path',
    );
  });

  it('an unusable instance name is refused before anything is read', () => {
    const out = run(['--env', 'games 2']);
    assert.match(out, /not a usable wrangler environment name/);
  });
});
