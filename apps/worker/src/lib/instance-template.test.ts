/**
 * The commented `[env.<instance>]` TEMPLATE at the foot of `wrangler.toml` must
 * stay COMPLETE and stay INERT.
 *
 * ## Why a template needs a test at all
 *
 * 🔴 `[env.*]` inherits nothing that matters — vars, D1, R2, routes, triggers
 * and unsafe bindings are all restated per environment, and an omission is a
 * MISSING binding on that Worker, never a fallback to main's value. So the day
 * `[vars]` gains a var and the template does not, the template is quietly wrong:
 * whoever copies it stands up an instance short one setting, and finds out from
 * behaviour rather than from an error.
 *
 * ⚠️ That is the estate's most-repeated failure shape, written down in this
 * repo's own wrangler.toml: *"a flag gets flipped, the sweep updates three
 * places, and the missed copy is ALWAYS a comment or a README, never code."* A
 * template IS a comment. This is the guard that makes it not one.
 *
 * ## And inert
 *
 * Every template line is commented. If one were ever uncommented, wrangler would
 * deploy a real second Worker whose D1 `database_id` is the literal placeholder
 * — or worse, whose omitted binding falls back to nothing while its ESTATE_APP
 * duplicates main's. `estate-app.test.ts` owns the same-id half; this owns
 * "nothing down there is live".
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { declaredEstateApps } from './estate-app.js';

const WRANGLER = readFileSync(
  fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href),
  'utf8',
);

const MARKER = 'TEMPLATE — a SECOND games instance';

/**
 * Where the template starts — the beginning of the LINE the banner sits on, not
 * the banner's own offset. Slicing mid-line would strip that line's `#` and make
 * the inertness check report its own banner as live code.
 */
function templateStart(): number {
  const at = WRANGLER.indexOf(MARKER);
  assert.notEqual(at, -1, `wrangler.toml no longer carries the "${MARKER}" block`);
  return WRANGLER.lastIndexOf('\n', at) + 1;
}

/** Everything from the template banner's line to the end of the file. */
function templateBlock(): string {
  return WRANGLER.slice(templateStart());
}

/** Everything BEFORE it — the live config. */
function liveConfig(): string {
  return WRANGLER.slice(0, templateStart());
}

/** Keys assigned in the live top-level `[vars]` table. */
function liveVarNames(): string[] {
  const lines = liveConfig().split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '[vars]');
  assert.notEqual(start, -1, 'wrangler.toml has no top-level [vars] table');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (/^\[/.test(trimmed)) break;
    const hit = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (hit?.[1]) names.push(hit[1]);
  }
  return names;
}

/**
 * The two vars a new instance must NOT restate.
 *
 * Cloudflare Access stopped authenticating this Worker on 2026-08-10;
 * `middleware/auth.ts` verifies Firebase ID tokens. Both are `@deprecated` in
 * `src/env.ts` and are kept set only until the Access application is deleted —
 * the LAST step of that cutover. Copying them onto a new instance extends
 * something that is being removed, which is why the design doc calls it out
 * (request-a-catalog design §8 item 7, §11.3) and why their absence is asserted
 * rather than merely intended.
 */
const MUST_NOT_RESTATE = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'];

describe('the [env.<instance>] template is complete', () => {
  it('the file and both halves were read — an empty read is a failed read', () => {
    assert.ok(WRANGLER.length > 0, 'wrangler.toml read as empty');
    assert.ok(templateBlock().length > 0);
    assert.ok(liveVarNames().length > 5, 'the live [vars] table parsed as almost empty');
  });

  it('🔴 every live [vars] key is either in the template or on the do-not-restate list', () => {
    const template = templateBlock();
    const missing = liveVarNames().filter(
      (name) => !MUST_NOT_RESTATE.includes(name) && !new RegExp(`^#\\s*${name}\\s*=`, 'm').test(template),
    );
    assert.deepEqual(
      missing,
      [],
      `wrangler.toml's [vars] gained ${missing.join(', ')} and the second-instance template did not. ` +
        '[env.*] inherits NOTHING, so an instance copied from this template would be missing it — ' +
        'add the line to the template, or add it to MUST_NOT_RESTATE and say why in the same commit.',
    );
  });

  it('🔴 the deprecated Access vars are NOT in the template, and it says why', () => {
    const template = templateBlock();
    for (const name of MUST_NOT_RESTATE) {
      assert.doesNotMatch(
        template,
        new RegExp(`^#\\s*${name}\\s*=`, 'm'),
        `${name} is being REMOVED, not extended — a new instance must not restate it`,
      );
      // Named in the prose too, so "why is it missing?" is answerable in place.
      assert.ok(template.includes(name), `the template must NAME ${name} as a thing not to copy`);
    }
    // …and they are still live at the top level, i.e. this test is about the
    // template, not a claim that the cutover finished.
    assert.match(liveConfig(), /^CF_ACCESS_AUD\s*=/m);
  });

  it('every non-inherited binding a second instance needs is in the template', () => {
    const template = templateBlock();
    for (const table of [
      'name =',
      '[env.games2.assets]',
      '[[env.games2.unsafe.bindings]]',
      '[[env.games2.d1_databases]]',
      '[[env.games2.r2_buckets]]',
      '[env.games2.triggers]',
      '[[env.games2.routes]]',
      '[env.games2.vars]',
    ]) {
      assert.ok(
        template.includes(`# ${table}`),
        `the template is missing ${table} — [env.*] inherits nothing, so it would be absent on the new Worker`,
      );
    }
  });

  it('⚠️ the cron strings are copied VERBATIM from the live triggers', () => {
    // `scheduled()` dispatches on the expression matching a constant, so a
    // near-miss is a sweep that silently never fires.
    const live = liveConfig().match(/^crons\s*=\s*(\[.*\])/m)?.[1];
    assert.ok(live, 'no live `crons = [...]` line');
    assert.ok(
      templateBlock().includes(`# crons = ${live}`),
      `the template's cron list has drifted from the live one (${live})`,
    );
  });
});

describe('the template is inert', () => {
  it('🔴 every line of it is commented', () => {
    const live = templateBlock()
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    assert.deepEqual(
      live,
      [],
      'a template line is uncommented — wrangler would deploy a real second Worker from a block ' +
        'whose database_id is a placeholder',
    );
  });

  it('it declares no ESTATE_APP the guard can see, and no [env.*] the tooling can see', () => {
    // ⚠️ Scoped to the TEMPLATE BLOCK, not the whole file, and that scoping is
    // the point rather than a loosening. This test owns one claim — *the
    // template is inert* — and a REAL second instance, the day one exists, is a
    // live `[env.<name>]` block written ABOVE this banner by
    // `scripts/provision-catalog.mjs`. Reading the whole file here would make
    // the drift guard fail on a correct provision, which reads as "the
    // provisioner broke the template" and is the wrong diagnosis entirely.
    // (Whether TWO envs collide on one id is `estate-app.test.ts`'s job, over
    // the whole file, and it is untouched by this.)
    const template = templateBlock();
    assert.deepEqual(declaredEstateApps(template), []);
    // The same rule `scripts/instance-guard.mjs` applies: a commented table is
    // not an instance, so `npm run deploy:games2` still refuses in words.
    const realEnvTables = template
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('#') && /^\[\[?env\./.test(l));
    assert.deepEqual(realEnvTables, []);
  });

  it('🔴 the template is the LAST thing in the file, so a rendered block lands above it', () => {
    // `provision-catalog.mjs`'s `insertEnvBlock()` puts a real block immediately
    // BEFORE this banner, because everything from the banner to EOF must stay
    // commented (the test above). If anything live were ever appended after the
    // template, that test would fail and the message would blame the template.
    // This assertion says the shape out loud so the next reader knows why.
    const after = WRANGLER.slice(templateStart());
    assert.ok(after.includes(`# [env.games2]`), 'the template body is not in the tail of the file');
    assert.equal(
      WRANGLER.indexOf(MARKER, WRANGLER.indexOf(MARKER) + MARKER.length),
      -1,
      'two template banners — one of them is a copy, and a copy is the thing this file exists to prevent',
    );
  });
});
