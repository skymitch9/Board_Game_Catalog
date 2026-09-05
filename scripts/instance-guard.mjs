#!/usr/bin/env node
/**
 * Refuse an instance-targeted command IN WORDS when that instance does not
 * exist yet.
 *
 * ## Why this exists
 *
 * This repo has ONE live instance (`boardgames.heygabi.ai`) and, as of
 * 2026-09-05, the machinery for a second — the `ESTATE_APP` identity, the
 * `--instance=` deploy guards, the `[env.<instance>]` template. The scripts that
 * TARGET a second instance therefore exist before the instance does, which is
 * the point: the day the provisioner stands one up (request-a-catalog design
 * §7.6), the commands are already there and already guarded.
 *
 * ⚠️ But a script that names an absent wrangler env fails with wrangler's own
 * message, which reads like a broken repo rather than "you have not created it
 * yet". The estate's rule is that a refusal says three things — what happened,
 * what it needs, and how to get it — and that rule does not stop at the edge of
 * a terminal.
 *
 *   node scripts/instance-guard.mjs games2
 *
 * Exits 0 when `apps/worker/wrangler.toml` has a real (uncommented)
 * `[env.<name>]` table, 1 with an explanation otherwise.
 *
 * ⚠️ COMMENTED TABLES DO NOT COUNT. The template at the foot of wrangler.toml
 * is `# [env.<instance>]` and must stay inert — a guard that accepted it would
 * pass for an instance nothing has ever created, which is the failure this file
 * exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'apps', 'worker', 'wrangler.toml');

const name = process.argv[2];

function fail(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  process.exit(1);
}

if (!name) {
  fail(['instance-guard: no instance name given.', '  usage: node scripts/instance-guard.mjs <name>']);
}

// The env name reaches child process argument lists (wrangler --env) from here
// on; keep it to what a wrangler env may be called.
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
  fail([
    `instance-guard: refusing — "${name}" is not a usable wrangler environment name.`,
    '  Letters, digits, hyphen and underscore only.',
  ]);
}

let toml;
try {
  toml = readFileSync(CONFIG, 'utf8');
} catch {
  fail([`instance-guard: cannot read ${CONFIG}. Run this from the repo, not from a worktree without it.`]);
}

/** Uncommented `[env.<name>]` or `[env.<name>.anything]` table headers. */
const declared = new Set();
for (const line of toml.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) continue;
  const hit = trimmed.match(/^\[\[?env\.([^.\]]+)/);
  if (hit) declared.add(hit[1]);
}

if (!declared.has(name)) {
  fail([
    `instance-guard: refusing — this repo has no second instance called "${name}" yet.`,
    '',
    `  what happened : apps/worker/wrangler.toml declares no [env.${name}] block,`,
    `                  so there is no Worker, no D1 and no hostname to target.`,
    declared.size
      ? `  what exists   : the main instance (top-level config) plus [env.${[...declared].join('], [env.')}]`
      : '  what exists   : the main instance only — its config is all top-level.',
    '',
    '  how to get it : a second games instance is created by the owner-run provisioner',
    '                  (request-a-catalog design §7.6), not by a script. The manual',
    '                  steps, the template to copy and what only the owner can do are in',
    '                  docs/access/second-instance.md.',
    '',
    '⚠️ Do not "fix" this by uncommenting the template — the template restates every',
    '   var by hand for a reason ([env.*] inherits NOTHING), and a half-filled block',
    '   deploys a Worker pointed at the MAIN instance\'s database.',
  ]);
}

console.log(`instance-guard: ok — [env.${name}] is declared in apps/worker/wrangler.toml.`);
