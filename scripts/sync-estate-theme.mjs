/**
 * Materialise the estate THEME asset into apps/web/public/assets/.
 *
 * Third sibling of sync-estate-auth.mjs and sync-estate-search.mjs — read
 * either of those first; this is the same mechanism applied to the theme
 * system, and it runs in the same places (`pretypecheck`, `pretest`,
 * `prebuild`, `predev`/`predev:web`, and inside `predeploy`) so nothing has
 * to remember to run it.
 *
 * WHY IT EXISTS AT ALL — the incident it ends.
 * These two files were a MANUAL verbatim copy from 2026-08-13 to 2026-08-17.
 * In that window canonical gained `classic` (the games copy lagged it until
 * a re-vendor), then `hearts` on 2026-08-16, then --et-hue-6/--et-card-6 on
 * 2026-08-17 — and this site's cog offered four themes the whole time, with
 * nothing anywhere failing. The owner's order (2026-08-17, verbatim: "Add the
 * pink theme as an option for every site, when a theme is added all sites get
 * it some may just default right away") is only true if it is mechanical, so
 * the manual copy becomes a build artifact and the copy leaves git.
 *
 * ⚠️ THE MATERIALISED FILES ARE A BUILD ARTIFACT, NOT A SECOND SOURCE OF
 * TRUTH. apps/web/public/assets/ is gitignored and rewritten wholesale every
 * run. A theme fix or a new theme belongs in catalog-platform
 * (sites/heygabi-home/public/assets/, contract in its
 * docs/info/estate-themes.md); an edit here is lost work at the next build,
 * and worse, it is the fork this script exists to prevent.
 *
 * ⚠️ NO REWRITE, unlike the library's copy of this script. The canonical CSS
 * references its faces at `/assets/fonts/…` and this app serves exactly that
 * path, so the bytes travel verbatim. public/_headers already carves
 * estate-theme.css and theme.js out of the year-long immutable rule on
 * /assets/* (they are not content-hashed), while the fonts keep it — a face
 * never changes bytes without changing name. Do not "tidy" these into
 * /estate/: sync-estate-search.mjs rm -rf's that directory on every run.
 *
 * NOT copied, on purpose: motion.js (reveal / hero recede / apple tilt) is
 * marketing-page choreography for the apex; this app is a catalog and has no
 * hero to recede. estate-search.js and estate-auth belong to the other two
 * scripts.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo (or the asset inside it) is
 * missing — the same ruling the two sibling scripts made. index.html names
 * /assets/estate-theme.css and /assets/theme.js in <head>; without them every
 * visitor gets an unstyled, unswitchable page, and "the site lost its skin"
 * is a much worse place to learn the checkout is absent than a build error
 * that names what to clone.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, platformPaths, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'assets');

/**
 * Named explicitly rather than globbed, so a file appearing or vanishing
 * upstream shows up as a loud diff here instead of a silent one. The licence
 * files travel with the faces — self-hosting under the OFL requires it, and
 * this repo's zero-third-party-requests rule is why they are self-hosted.
 */
const TEXT_FILES = ['estate-theme.css', 'theme.js'];
const FONT_FILES = [
  'rajdhani-400.woff2',
  'rajdhani-600.woff2',
  'rajdhani-700.woff2',
  'share-tech-mono-400.woff2',
  'bangers.woff2',
  'luckiest-guy.woff2',
  'OFL-bangers-luckiestguy.txt',
  'OFL-rajdhani-sharetechmono.txt',
];

function fail(message) {
  console.error(`\nsync-estate-theme: ${message}\n`);
  process.exit(1);
}

let paths;
try {
  const { dir, how } = resolvePlatformRepo();
  paths = platformPaths(dir);
  console.log(`sync-estate-theme: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const SRC_DIR = paths.estateAssets;

/** A `//` banner for JS, a `/* *\/` banner for CSS — same words either way. */
function banner(name, open, close) {
  return (
    `${open} ⚠️ GENERATED COPY — DO NOT EDIT. Source of truth:\n` +
    `${open} catalog-platform/sites/heygabi-home/public/assets/${name}\n` +
    `${open} Rewritten by scripts/sync-estate-theme.mjs on every typecheck/test/build/dev/deploy.\n` +
    `${open} A theme fix or a NEW THEME goes there and reaches every estate site;\n` +
    `${open} a patch here dies at this repo. ${close}\n\n`
  );
}

// Read everything before writing anything: a half-materialised theme
// directory is worse than an untouched one.
const texts = [];
for (const name of TEXT_FILES) {
  const from = join(SRC_DIR, name);
  let body;
  try {
    body = readFileSync(from, 'utf8');
  } catch (err) {
    fail(
      `cannot read ${from}\n` +
        `  ${err.message}\n` +
        `  The estate theme asset shipped 2026-08-13 (catalog-platform\n` +
        `  docs/info/estate-themes.md) — an old checkout predates it. \`git pull\` there.`,
    );
  }
  // The zero-byte-read rule: an empty read is a failed read, not an empty file.
  if (body.trim().length === 0) fail(`${from} is empty — refusing to write an empty ${name}`);
  texts.push([name, body]);
}

const fonts = [];
for (const name of FONT_FILES) {
  const from = join(SRC_DIR, 'fonts', name);
  try {
    fonts.push([name, readFileSync(from)]);
  } catch (err) {
    fail(
      `cannot read fonts/${name}\n` +
        `  ${err.message}\n` +
        `  The self-hosted faces are part of the contract (no Google Fonts, ever), and a\n` +
        `  theme without its faces renders in fallbacks and lies about itself. If the file\n` +
        `  genuinely moved upstream, update FONT_FILES here after reading the new\n` +
        `  @font-face block — do not drop the licence text.`,
    );
  }
}

// Rewritten wholesale, so a file dropped upstream cannot linger here as drift.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, 'fonts'), { recursive: true });

for (const [name, body] of texts) {
  const head = name.endsWith('.css') ? banner(name, '/*', '*/') : banner(name, '//', '');
  writeFileSync(join(OUT_DIR, name), head + body, 'utf8');
}
for (const [name, body] of fonts) {
  writeFileSync(join(OUT_DIR, 'fonts', name), body);
}

console.log(
  `sync-estate-theme: materialised ${texts.length} file(s) + ${fonts.length} font file(s) → ${OUT_DIR} (gitignored build artifact)`,
);
