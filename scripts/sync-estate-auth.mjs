/**
 * Materialise the canonical estate-auth module into
 * apps/worker/src/estate-auth/ (gitignored, rewritten every run).
 *
 * Runs as `pretypecheck`, `predev` and inside `predeploy`, so anything that
 * compiles or serves this repo has a current copy and nothing has to remember
 * to run it. The mechanism is the library's sync-universes one, applied to the
 * file the estate least wants copied by hand: estate-auth-design.md §1.1 shows
 * what happened when two repos each kept their own auth.ts (they drifted on the
 * dev-bypass condition — the dangerous way), and §8.1 names this fetch as how a
 * consumer inherits the ONE implementation instead.
 *
 * ⚠️ THE MATERIALISED FILES ARE A BUILD ARTIFACT, NOT A SECOND SOURCE OF
 * TRUTH. The one copy lives in catalog-platform/packages/estate-auth/src/. If
 * you are tempted to edit a file under apps/worker/src/estate-auth/, you want
 * that repo — and note that another agent/owner may hold that tree; module
 * defects found here get REPORTED there, not patched in the copy.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo is missing. Chosen, not
 * incidental: a Worker quietly bundled without its auth module would fail at
 * import time in production, which is a worse place to learn about it.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, platformPaths, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'apps', 'worker', 'src', 'estate-auth');

function fail(message) {
  console.error(`\nsync-estate-auth: ${message}\n`);
  process.exit(1);
}

let paths;
try {
  const { dir, how } = resolvePlatformRepo();
  paths = platformPaths(dir);
  console.log(`sync-estate-auth: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const sources = readdirSync(paths.estateAuthSrc).filter((f) => f.endsWith('.ts'));
if (sources.length === 0) {
  // The zero-row-read rule: an empty read is a failed read, not an empty module.
  fail(`no .ts files found in ${paths.estateAuthSrc} — refusing to write an empty module`);
}

// Rewrite wholesale so a file deleted upstream cannot linger here as drift.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const banner = (name) =>
  `// ⚠️ GENERATED COPY — DO NOT EDIT. Source of truth:\n` +
  `// catalog-platform/packages/estate-auth/src/${name}\n` +
  `// Rewritten by scripts/sync-estate-auth.mjs on every typecheck/dev/deploy.\n` +
  `// Module defects get fixed (or reported) THERE, never patched here.\n\n`;

for (const name of sources) {
  const body = readFileSync(join(paths.estateAuthSrc, name), 'utf8');
  writeFileSync(join(OUT_DIR, name), banner(name) + body, 'utf8');
}

console.log(`sync-estate-auth: materialised ${sources.length} files → ${OUT_DIR}`);
