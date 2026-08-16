/**
 * Materialise the canonical <estate-search> custom element into
 * apps/web/public/estate/ (gitignored, rewritten every run).
 *
 * Runs as `pretypecheck`, `pretest`, `prebuild`, `predev`/`predev:web` and
 * inside `predeploy` — the same "nothing has to remember to run it" rule
 * scripts/sync-estate-auth.mjs established here. This is that script's
 * mechanism applied to a second shared file; read it first, this one is
 * deliberately its twin.
 *
 * WHAT THIS COPIES AND WHY
 * catalog-platform/sites/heygabi-home/public/assets/estate-search.js is the ONE
 * cross-catalog search box (catalog-platform docs/TODO.md item 0). It queries
 * the shared index at index.heygabi.ai across audiobooks, the library and this
 * catalog. It is ADDITIVE here: this app's own collection search
 * (apps/web/src/pages/CollectionPage.tsx, server-side against /api/collection
 * with facets and pagination) is a different job and is untouched.
 *
 * ⚠️ THE MATERIALISED FILE IS A BUILD ARTIFACT, NOT A SECOND SOURCE OF TRUTH.
 * The one copy lives in catalog-platform. If you are tempted to edit
 * apps/web/public/estate/estate-search.js, you want that repo — and note that
 * another agent/owner may hold that tree; component defects found here get
 * REPORTED there, not patched in the copy. A search improvement made THERE is
 * supposed to reach every site; a patch made HERE dies at this repo, which is
 * the exact failure the component was extracted to end.
 *
 * ⚠️ estate-auth.js IS DELIBERATELY NOT COPIED. The component's `auth="authed"`
 * mode falls back to dynamically importing a sibling `estate-auth.js`, and that
 * module calls initializeApp() itself — a SECOND Firebase app on a page that
 * already has one (apps/web/src/lib/firebase.ts). Instead the React wrapper
 * (apps/web/src/components/EstateSearch.tsx) sets `.authAdapter` to this app's
 * own Firebase module before the element is inserted, which is the documented
 * way to skip that import entirely. If the adapter were ever missing the
 * component would 404 on /estate/estate-auth.js and degrade to authless
 * (public audiobook slice) rather than break — a soft failure, on purpose.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo is missing. Chosen, not
 * incidental: a silent skip ships a page whose search box never upgrades from
 * an inert unknown element, and "the box does nothing" is a much worse place to
 * learn the checkout is absent than a build error naming the fix.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, platformPaths, resolvePlatformRepo } from './lib/platform-repo.mjs';

/**
 * Vite copies apps/web/public/ into dist/ verbatim, so this lands at
 * /estate/estate-search.js in dev and in the built bundle alike. Its own
 * directory rather than public/assets/ for the same reason estate-auth gets
 * apps/worker/src/estate-auth/: a generated tree is gitignored wholesale, so
 * "is this file hand-written or copied?" is answered by where it sits. It also
 * keeps it clear of the year-long immutable Cache-Control that public/_headers
 * puts on /assets/* — this file is not content-hashed, so pinning it would
 * freeze one version of the search box in every phone that ever loaded it.
 */
const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'estate');

/** Exactly what this repo consumes. See the estate-auth note in the header. */
const FILES = ['estate-search.js'];

function fail(message) {
  console.error(`\nsync-estate-search: ${message}\n`);
  process.exit(1);
}

let paths;
try {
  const { dir, how } = resolvePlatformRepo();
  paths = platformPaths(dir);
  console.log(`sync-estate-search: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const banner = (name) =>
  `// ⚠️ GENERATED COPY — DO NOT EDIT. Source of truth:\n` +
  `// catalog-platform/sites/heygabi-home/public/assets/${name}\n` +
  `// Rewritten by scripts/sync-estate-search.mjs on every typecheck/test/build/dev/deploy.\n` +
  `// Component defects get fixed (or reported) THERE, never patched here.\n\n`;

const bodies = [];
for (const name of FILES) {
  const from = join(paths.estateAssets, name);
  let body;
  try {
    body = readFileSync(from, 'utf8');
  } catch (err) {
    fail(
      `cannot read ${from}\n` +
        `  ${err.message}\n` +
        `  The shared search component moved or was renamed in catalog-platform.\n` +
        `  Fix the path in FILES/platformPaths() rather than committing a copy here.`,
    );
  }
  // The zero-byte-read rule: an empty read is a failed read, not an empty file.
  if (body.trim().length === 0) fail(`${from} is empty — refusing to write an empty module`);
  bodies.push([name, body]);
}

// Rewrite wholesale so a file dropped upstream cannot linger here as drift.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const [name, body] of bodies) {
  writeFileSync(join(OUT_DIR, name), banner(name) + body, 'utf8');
}

console.log(`sync-estate-search: materialised ${bodies.length} file(s) → ${OUT_DIR}`);
