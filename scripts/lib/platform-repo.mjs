// scripts/lib/platform-repo.mjs
//
// Finding the sibling `catalog-platform` checkout.
//
// ⚠️ catalog-platform is now a CODE DEPENDENCY of this repo, not just a docs
// repo. It owns `packages/estate-auth/` — the canonical estate auth module
// (verifier + membership check) that every heygabi.ai consumer takes from the
// one place, because two copies of an auth file provably drift
// (estate-auth-design.md §1.1: this repo hardened its dev bypass in 0026-era
// work; the library's copy never heard about it until 2026-08-13).
//
// Ported from library_catalog/scripts/lib/platform-repo.mjs — the mechanism the
// design's §8.1 names as how a consumer repo reaches the module. A bare
// relative path would work on this machine and break on any checkout laid out
// differently, so resolution is explicit and its failure is loud.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/** The env var that overrides everything. Named in every failure message. */
export const ENV_VAR = 'CATALOG_PLATFORM_DIR';

/** Relative to this repo's root, in the order they are tried. */
const CANDIDATES = [
  join('..', 'catalog-platform'), // boardbuddy/catalog-platform
  join('..', '..', 'catalog-platform'), // vs-code-repos/catalog-platform  ← the real layout
  join('..', '..', '..', 'catalog-platform'),
];

/** A directory is the platform repo if it holds the module we came for. */
function looksRight(dir) {
  return existsSync(join(dir, 'packages', 'estate-auth', 'src', 'index.ts'));
}

/**
 * @returns {{ dir: string, how: string, tried: string[] }}
 * @throws  {Error} with a message that says what to do about it.
 */
export function resolvePlatformRepo() {
  const tried = [];

  const fromEnv = process.env[ENV_VAR];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    tried.push(`${ENV_VAR}=${dir}`);
    if (looksRight(dir)) return { dir, how: ENV_VAR, tried };
    throw new Error(
      `${ENV_VAR} is set to ${dir}, but there is no packages/estate-auth/src/index.ts there.\n` +
        `Point it at the root of the catalog-platform checkout.`,
    );
  }

  for (const rel of CANDIDATES) {
    const dir = resolve(REPO_ROOT, rel);
    tried.push(dir);
    if (looksRight(dir)) return { dir, how: `sibling lookup (${rel})`, tried };
  }

  throw new Error(
    'Cannot find the catalog-platform checkout.\n\n' +
      'It owns packages/estate-auth — the canonical estate auth module this repo\n' +
      'materialises at build time. It is a code dependency, not documentation —\n' +
      'there is no copy in git on purpose, because two auth copies drift, and an\n' +
      'auth file is the worst file to let drift.\n\n' +
      'Tried:\n' +
      tried.map((t) => `  - ${t}`).join('\n') +
      `\n\nFix: clone catalog-platform next to this repo, or set ${ENV_VAR} to its root:\n` +
      `  PowerShell   $env:${ENV_VAR} = "C:\\path\\to\\catalog-platform"\n` +
      `  bash         export ${ENV_VAR}=/path/to/catalog-platform\n`,
  );
}

/** Paths inside the platform repo, once it is found. */
export function platformPaths(dir) {
  return {
    dir,
    estateAuthSrc: join(dir, 'packages', 'estate-auth', 'src'),
    // The browser-native shared assets the apex both owns and serves. The
    // canonical <estate-search> custom element lives here (docs/TODO.md §0.1);
    // scripts/sync-estate-search.mjs materialises it into apps/web/public/.
    estateAssets: join(dir, 'sites', 'heygabi-home', 'public', 'assets'),
  };
}
