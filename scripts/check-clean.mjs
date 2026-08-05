/**
 * Refuse to deploy a working tree that is not committed.
 *
 * Twice now the live site has run code with no commit behind it: once because a
 * session deployed straight from the working tree, and once because a chained
 * `git commit && npm run deploy` had its commit rejected by PowerShell quoting
 * while the deploy went ahead regardless. Both left production ahead of the
 * repo with no rollback point, and neither was noticeable at the time.
 *
 * A commit is cheap and a mystery deployment is not, so this is a hard gate
 * rather than a warning. Override deliberately when you mean it:
 *
 *   ALLOW_DIRTY_DEPLOY=1 npm run deploy
 */
import { execFileSync } from 'node:child_process';

if (process.env['ALLOW_DIRTY_DEPLOY'] === '1') {
  console.log('check-clean: ALLOW_DIRTY_DEPLOY=1 — deploying an uncommitted tree on purpose.');
  process.exit(0);
}

let status;
try {
  status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
} catch {
  // Not a git checkout, or git is unavailable. Not a reason to block a deploy —
  // this guard exists to catch a mistake, not to require a particular setup.
  console.log('check-clean: no git available, skipping.');
  process.exit(0);
}

const dirty = status.split('\n').filter((line) => line.trim() !== '');
if (dirty.length === 0) process.exit(0);

console.error('\ncheck-clean: refusing to deploy — the working tree has uncommitted changes.\n');
for (const line of dirty.slice(0, 20)) console.error(`  ${line}`);
if (dirty.length > 20) console.error(`  ... and ${dirty.length - 20} more`);
console.error(
  [
    '',
    'Deploying now would put code on the live site that is in no commit,',
    'leaving nothing to roll back to. Commit first:',
    '',
    '  git add -A',
    '  git commit -F <message-file>      # -F, not -m: see docs/HANDOFF.md',
    '',
    'Or, if you genuinely mean to deploy an uncommitted tree:',
    '',
    '  ALLOW_DIRTY_DEPLOY=1 npm run deploy',
    '',
  ].join('\n'),
);
process.exit(1);
