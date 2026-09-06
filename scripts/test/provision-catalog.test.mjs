/**
 * The GAMES provisioner — its refusals, its naming, the block it renders, and
 * the sealed-key hook.
 *
 * `scripts/provision-catalog.mjs` creates databases, buckets, hostnames and
 * secrets. Nothing here lets it: every test either calls a PURE exported
 * function or spawns the real command with `--dry` and a FIXTURE row, which is
 * the combination the script itself refuses to write anything under.
 *
 * 🔴 THE FIVE THINGS THIS FILE EXISTS TO CATCH, each one a silent failure:
 *
 *   1. **Provisioning the wrong KIND.** A books row run through the games path
 *      stands up a board-game catalog at the address somebody asked for a
 *      library at, and nothing about it looks wrong afterwards.
 *   2. **A rendered block that lost a line.** `[env.*]` inherits NOTHING, so a
 *      substitution that silently missed leaves a Worker with a missing binding
 *      — and it deploys perfectly happily.
 *   3. **A rendered block written in the wrong PLACE.** The drift guard slices
 *      from the template banner to EOF and requires every line there to be
 *      commented; a block appended at the end fails it, and the message would
 *      blame the template rather than the writer.
 *   4. **`namespace_id = "1001"` on a second instance.** MEASURED per ACCOUNT
 *      (`docs/info/instance-model.md` §3): sharing it makes two households
 *      throttle each other, and the symptom is unexplained 429s on a site
 *      nobody was looking at.
 *   5. **The sealed key resolving to the wrong SOURCE.** Reader / owner / none
 *      are three different facts about whose money an instance spends, and the
 *      one the run records is what the request row will say forever.
 *
 * ⚠️ Names only. Nothing here reads, asserts on, prints or writes a secret
 * value, and the seal stubs return a `source` string and nothing else.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DRY_DATABASE_ID,
  MUST_NOT_RESTATE,
  assertProvisionable,
  deploysLogHasInstance,
  deriveNames,
  insertEnvBlock,
  insertScripts,
  liveVarNames,
  manualRunbook,
  missingVars,
  nextEstateApp,
  nextRateLimitNamespace,
  ordinalWord,
  parseEnvNames,
  parseEstateAppAllowlist,
  parseEstateApps,
  registryInsertSql,
  renderEnvBlock,
  rootScriptTwins,
  runbookSection,
  sanitiseInstanceName,
  secretPlan,
  sqlLit,
  templateStart,
  workerScriptTwins,
} from '../provision-catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'provision-catalog.mjs');
const WRANGLER_TOML = readFileSync(join(ROOT, 'apps', 'worker', 'wrangler.toml'), 'utf8');
const ESTATE_APP_TS = readFileSync(
  join(ROOT, 'apps', 'worker', 'src', 'lib', 'estate-app.ts'),
  'utf8',
);
const ALLOWLIST = parseEstateAppAllowlist(ESTATE_APP_TS);
const ACCEPTED_FIXTURE = join(HERE, 'fixtures', 'catalog-request-games-accepted.json');

/** A `catalog_request` row, shaped like the one D1 hands back. */
function row(over = {}) {
  return {
    id: 7,
    kind: 'games',
    requester_email: 'someone@example.com',
    requester_display_name: 'Example Person',
    desired_subdomain: 'quarry',
    display_name: 'The Quarry Game Shelf',
    status: 'accepted',
    provisioned_instance: null,
    provisioned_host: null,
    reader_key_set: 0,
    owner_key_set: 0,
    created_at: '2026-09-05 12:00:00',
    ...over,
  };
}

function names(over = {}) {
  return deriveNames(row(over), {
    envNames: parseEnvNames(WRANGLER_TOML),
    estateApps: parseEstateApps(WRANGLER_TOML),
    allowlist: ALLOWLIST,
  });
}

/** Run the real command. `--dry` is always on; nothing here may write. */
function run(args, env = {}) {
  const out = spawnSync(process.execPath, [SCRIPT, ...args, '--dry'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { text: `${out.stdout ?? ''}${out.stderr ?? ''}`, code: out.status };
}

/** A throwaway fixture file — a fixture only ever feeds a DRY run. */
function fixtureFile(dir, over) {
  const path = join(dir, 'row.json');
  writeFileSync(path, JSON.stringify(row(over)), 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// 1 · Refusals — the wrong kind, the wrong status.
// ---------------------------------------------------------------------------

describe('it refuses anything that is not an ACCEPTED games row', () => {
  it('🔴 REFUSES a books row, and names the repo that CAN do it', () => {
    assert.throws(
      () => assertProvisionable(row({ kind: 'books' })),
      (err) => {
        assert.match(err.message, /This is a BOOKS request/);
        assert.match(err.message, /library_catalog/);
        // ⚠️ The consequence, spelled out: this is the one refusal whose absence
        // would not look like a bug until somebody signed in.
        assert.match(err.message, /BOARD-GAME catalog at the address somebody\s*\n?asked for a library at/);
        assert.equal(err.code, 2);
        return true;
      },
    );
  });

  it('the books twin refuses games in the same shape — the two are a PAIR', () => {
    // Not an assertion about the other repo's file (it may not be checked out);
    // an assertion about OUR half of the pair: the closing sentence is the same
    // sentence with the two words swapped, so whichever a session meets first
    // tells it where the other half lives.
    let message = '';
    try {
      assertProvisionable(row({ kind: 'books' }));
    } catch (err) {
      message = err.message;
    }
    assert.match(message, /Accepting a books request is fine; provisioning one is a run in another repo\./);
  });

  it('REFUSES a kind the schema does not allow — that is corruption, not a request', () => {
    assert.throws(() => assertProvisionable(row({ kind: 'films' })), /not a kind this estate knows/);
  });

  it('REFUSES a live row, and says where it is already live', () => {
    assert.throws(
      () => assertProvisionable(row({ status: 'live', provisioned_host: 'quarry.heygabi.ai' })),
      /already live at https:\/\/quarry\.heygabi\.ai/,
    );
  });

  it('REFUSES a pending row, and says who has to act', () => {
    assert.throws(
      () => assertProvisionable(row({ status: 'pending' })),
      /still waiting on the owner: accept it at https:\/\/heygabi\.ai\/admin\//,
    );
  });

  it('REFUSES declined and cancelled without inviting a re-run', () => {
    for (const status of ['declined', 'cancelled']) {
      assert.throws(() => assertProvisionable(row({ status })), /the requester files a new one/);
    }
  });

  it('REFUSES a missing row with exit code 1, not 2 — a bad id is not a bad request', () => {
    assert.throws(
      () => assertProvisionable(undefined),
      (err) => {
        assert.equal(err.code, 1);
        return true;
      },
    );
  });
});

describe('the real command refuses, end to end', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bgc-provision-'));

  it('a books fixture is refused in words, exit 2', () => {
    const { text, code } = run(['--request', '7', '--fixture', fixtureFile(tmp, { kind: 'books' })]);
    assert.match(text, /This is a BOOKS request/);
    assert.equal(code, 2);
    assert.doesNotMatch(text, /1 · D1 create/, 'it got as far as a step — the refusal has to come first');
  });

  it('a live fixture is refused in words, exit 2', () => {
    const { text, code } = run([
      '--request', '7',
      '--fixture', fixtureFile(tmp, { status: 'live', provisioned_host: 'quarry.heygabi.ai' }),
    ]);
    assert.match(text, /only an ACCEPTED request can be provisioned/);
    assert.equal(code, 2);
  });

  it('a pending fixture is refused in words, exit 2', () => {
    const { text, code } = run(['--request', '7', '--fixture', fixtureFile(tmp, { status: 'pending' })]);
    assert.match(text, /still waiting on the owner/);
    assert.equal(code, 2);
  });

  it('⚠️ --fixture WITHOUT --dry is refused: a fixture can never provision anything', () => {
    const out = spawnSync(process.execPath, [SCRIPT, '--request', '7', '--fixture', fixtureFile(tmp, {})], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.match(`${out.stdout}${out.stderr}`, /--fixture is a DRY-RUN aid only/);
    assert.equal(out.status, 1);
  });

  it('--request is required, and the usage names all three modes', () => {
    const out = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    const text = `${out.stdout}${out.stderr}`;
    assert.match(text, /--request <id> is required/);
    assert.match(text, /--dry/);
    assert.match(text, /--resume/);
    assert.equal(out.status, 1);
  });

  it('cleans up its temp fixtures', () => {
    rmSync(tmp, { recursive: true, force: true });
    assert.equal(existsSync(tmp), false);
  });
});

// ---------------------------------------------------------------------------
// 2 · The naming function — the one place the split lives.
// ---------------------------------------------------------------------------

describe('deriveNames — the ONE naming function', () => {
  it('splits identity-bearing from ordinal exactly as the books twin does', () => {
    const n = names();
    assert.equal(n.host, 'quarry.heygabi.ai', 'the hostname is the only identity-bearing name');
    assert.equal(n.instance, 'quarry', 'the env follows the subdomain — the operator types it');
    assert.equal(n.workerName, 'board-game-catalog-quarry');
    // Ordinal, all four, off ONE number: they cannot be renamed cheaply.
    assert.equal(n.d1Name, 'board-game-catalog-2nd');
    assert.equal(n.bucketName, 'game-covers-2nd');
    assert.equal(n.coversHost, 'gamecovers2.heygabi.ai');
    assert.equal(n.estateApp, 'games2');
    assert.equal(n.tokenName, 'ESTATE_APP_TOKEN_GAMES2');
    assert.equal(n.visColumn, 'vis_games2');
    assert.equal(n.estateAppNumber, 2);
  });

  it('🔴 the covers host is ORDINAL, and never the subdomain', () => {
    // `cover-storage.ts` writes COVERS_BASE_URL INTO thumbnail_url rows, so a
    // rename is a data migration rather than a config edit. This is the one
    // place the games split differs from the books one, and it is deliberate.
    const n = names({ desired_subdomain: 'renamed-tomorrow' });
    assert.equal(n.coversHost, 'gamecovers2.heygabi.ai');
    assert.equal(n.coversBaseUrl, 'https://gamecovers2.heygabi.ai');
  });

  it('⚠️ gamecovers.heygabi.ai is never proposed — it belongs to the MAIN bucket', () => {
    assert.notEqual(names().coversHost, 'gamecovers.heygabi.ai');
  });

  it('the token NAME follows the app id, because the estate pairs by NAME on both sides', () => {
    const n = names();
    assert.equal(n.tokenName, `ESTATE_APP_TOKEN_${n.estateApp.toUpperCase()}`);
  });

  it('--instance overrides the env name and NOTHING else', () => {
    const n = deriveNames(row(), {
      envNames: parseEnvNames(WRANGLER_TOML),
      estateApps: parseEstateApps(WRANGLER_TOML),
      allowlist: ALLOWLIST,
      instance: 'games2',
    });
    assert.equal(n.instance, 'games2');
    assert.equal(n.host, 'quarry.heygabi.ai', 'the hostname still comes from the request');
    assert.equal(n.estateApp, 'games2');
    assert.equal(n.d1Name, 'board-game-catalog-2nd');
  });

  it('OWNER_EMAILS comes from the requester, lowercased — they cannot be locked out of their own shelf', () => {
    assert.equal(names({ requester_email: '  Someone@EXAMPLE.com ' }).requesterEmail, 'someone@example.com');
  });

  it('forceEstateApp pins the id on a --resume rather than advancing it', () => {
    // Without this, a resumed run reads a toml that already contains games2 and
    // mints a bearer under games3 — a name the first half never used.
    const n = deriveNames(row(), {
      envNames: [],
      estateApps: ['games', 'games2'],
      allowlist: ALLOWLIST,
      forceEstateApp: 'games2',
    });
    assert.equal(n.estateApp, 'games2');
    assert.equal(n.d1Name, 'board-game-catalog-2nd');
  });
});

describe('sanitiseInstanceName', () => {
  it('lowercases, collapses, and trims to something a Worker can be called', () => {
    assert.deepEqual(sanitiseInstanceName('Quarry Shelf!'), { name: 'quarry-shelf', changed: true });
    assert.deepEqual(sanitiseInstanceName('quarry'), { name: 'quarry', changed: false });
  });

  it('refuses an empty, a symbols-only and an over-long name, in words', () => {
    assert.throws(() => sanitiseInstanceName(''), /no desired_subdomain/);
    assert.throws(() => sanitiseInstanceName('!!!'), /no letters or digits/);
    assert.throws(() => sanitiseInstanceName('q'.repeat(31)), /capped at 30/);
  });

  it('refuses a wrangler-reserved word — [env.production] would not mean "this catalog"', () => {
    for (const bad of ['production', 'preview', 'dev', 'default']) {
      assert.throws(() => sanitiseInstanceName(bad), /reserved wrangler environment name/);
    }
  });

  it('🔴 refuses a name that already has a block — that is a resume or somebody else', () => {
    assert.throws(
      () => sanitiseInstanceName('quarry', { existingEnvs: ['quarry'] }),
      /already exists in apps\/worker\/wrangler\.toml/,
    );
  });

  it('games2 is NOT reserved — it is the template\'s own name and a fine env', () => {
    assert.deepEqual(sanitiseInstanceName('games2'), { name: 'games2', changed: false });
  });
});

describe('ordinals and the estate app id', () => {
  it('ordinalWord covers the teens, which is where naive versions break', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinalWord),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'],
    );
  });

  it('the next id after `games` is `games2` — instance 1 carries no digit', () => {
    assert.deepEqual(nextEstateApp(['games'], ALLOWLIST), { app: 'games2', n: 2 });
  });

  it('🔴 REFUSES an id this codebase cannot present, and names the three-line change', () => {
    // The allowlist in `estate-app.ts` is what stops one var edit letting this
    // catalog impersonate the library's consumer. A script that invented
    // `games3` would produce a Worker whose estate check is simply OFF.
    assert.throws(
      () => nextEstateApp(['games', 'games2'], ALLOWLIST),
      (err) => {
        assert.match(err.message, /this codebase cannot present it/);
        assert.match(err.message, /ESTATE_APPS \+ APP_TOKEN_VAR/);
        assert.match(err.message, /ESTATE_APP_TOKEN_GAMES3/);
        return true;
      },
    );
  });

  it('the allowlist is READ from estate-app.ts, not restated here', () => {
    assert.deepEqual(ALLOWLIST, ['games', 'games2']);
  });
});

// ---------------------------------------------------------------------------
// 3 · The rate-limit namespace — measured per ACCOUNT.
// ---------------------------------------------------------------------------

describe('nextRateLimitNamespace', () => {
  it('🔴 NEVER returns "1001" — that is the MAIN instance\'s, and changing one resets every counter', () => {
    assert.notEqual(nextRateLimitNamespace(WRANGLER_TOML), '1001');
    assert.notEqual(nextRateLimitNamespace('namespace_id = "1002"\nnamespace_id = "1001"\n'), '1001');
    assert.notEqual(nextRateLimitNamespace(''), '1001');
  });

  it('gives the second instance 1002, which is what the template and the doc say', () => {
    assert.equal(nextRateLimitNamespace(WRANGLER_TOML), '1002');
  });

  it('skips ids already taken by a LIVE binding, and ignores commented ones', () => {
    assert.equal(nextRateLimitNamespace('namespace_id = "1001"\nnamespace_id = "1002"\n'), '1003');
    // The template's own `# namespace_id = "1002"` must not make 1002 look taken
    // before any second instance exists.
    assert.equal(nextRateLimitNamespace('namespace_id = "1001"\n# namespace_id = "1002"\n'), '1002');
  });
});

// ---------------------------------------------------------------------------
// 4 · The rendered block — completeness, placement, and the drift guard.
// ---------------------------------------------------------------------------

describe('renderEnvBlock — rendered from the committed TEMPLATE, not hand-written', () => {
  const n = names();
  const block = renderEnvBlock(WRANGLER_TOML, n, {
    databaseId: DRY_DATABASE_ID,
    coversBaseUrl: n.coversBaseUrl,
    ownerEmails: n.requesterEmail,
    namespaceId: nextRateLimitNamespace(WRANGLER_TOML),
  });

  it('every table a non-inheriting env needs is there, under THIS instance\'s name', () => {
    for (const table of [
      `[env.${n.instance}]`,
      `[env.${n.instance}.assets]`,
      `[[env.${n.instance}.unsafe.bindings]]`,
      `[[env.${n.instance}.d1_databases]]`,
      `[[env.${n.instance}.r2_buckets]]`,
      `[env.${n.instance}.triggers]`,
      `[[env.${n.instance}.routes]]`,
      `[env.${n.instance}.vars]`,
    ]) {
      assert.ok(block.includes(`${table}\n`), `the rendered block is missing ${table}`);
    }
    assert.doesNotMatch(block, /\[\[?env\.games2/, 'a table kept the template\'s env name');
  });

  it('🔴 EVERY live [vars] key is restated — [env.*] inherits NOTHING', () => {
    assert.deepEqual(missingVars(WRANGLER_TOML, block), []);
    assert.ok(liveVarNames(WRANGLER_TOML).length > 5, 'the live [vars] parsed as almost empty');
  });

  it('🔴 the deprecated Access vars are NOT restated — they are being removed, not extended', () => {
    for (const name of MUST_NOT_RESTATE) {
      assert.doesNotMatch(block, new RegExp(`^${name}\\s*=`, 'm'));
    }
  });

  it('🔴 REGRESSION: the binding NAMES survive substitution', () => {
    // Measured 2026-09-05, on the renderer's first run: a key-only rule for
    // `name` rewrote `name = "RATE_LIMITER"` inside the unsafe binding to the
    // Worker's name. TOML reuses short keys across tables, so a key is not an
    // address. Nothing else caught it — the block parsed, the placeholder check
    // passed, and the failure would have been a rate limiter that silently did
    // not exist.
    assert.match(block, /^name = "RATE_LIMITER"$/m);
    assert.match(block, /^name = "board-game-catalog-quarry"$/m);
    assert.match(block, /^binding = "DB"$/m);
    assert.match(block, /^binding = "COVERS"$/m);
    assert.match(block, /^binding = "ASSETS"$/m);
  });

  it('the values that make it THIS instance are substituted, and no placeholder survives', () => {
    assert.match(block, /^database_name = "board-game-catalog-2nd"$/m);
    assert.match(block, new RegExp(`^database_id = "${DRY_DATABASE_ID}"$`, 'm'));
    assert.match(block, /^bucket_name = "game-covers-2nd"$/m);
    assert.match(block, /^pattern = "quarry\.heygabi\.ai"$/m);
    assert.match(block, /^COVERS_BASE_URL = "https:\/\/gamecovers2\.heygabi\.ai"$/m);
    assert.match(block, /^OWNER_EMAILS = "someone@example\.com"$/m);
    assert.match(block, /^namespace_id = "1002"$/m);
    const code = block.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    assert.deepEqual(code.filter((l) => /<[^>]+>/.test(l)), [], 'a template placeholder reached the block');
  });

  it('🔴 it declares its OWN identity, never the main instance\'s — this is F-5', () => {
    assert.match(block, /^ESTATE_APP = "games2"$/m);
    assert.doesNotMatch(block, /^ESTATE_APP = "games"$/m);
  });

  it('the cron STRINGS are carried verbatim — scheduled() dispatches on the expression', () => {
    const live = WRANGLER_TOML.slice(0, templateStart(WRANGLER_TOML)).match(/^crons\s*=\s*(\[.*\])/m)?.[1];
    assert.ok(live, 'no live crons line');
    assert.ok(block.includes(`crons = ${live}`), 'the rendered crons drifted from the live ones');
  });

  it('the shared, never-forked values are carried unchanged', () => {
    assert.match(block, /^FIREBASE_PROJECT_ID = "audiobook-catalog"$/m);
    assert.match(block, /^INDEX_URL = "https:\/\/index\.heygabi\.ai"$/m);
    assert.match(block, /^BILLING_POLICY = "off"$/m);
    assert.match(block, /^ESTATE_CHECK = "enforce"$/m);
  });

  it('the commands quoted in its comments name THIS instance\'s scripts', () => {
    assert.match(block, /npm run db:migrate:quarry/);
    assert.doesNotMatch(block, /db:migrate:games2/);
  });
});

describe('insertEnvBlock — and the drift guard still passing afterwards', () => {
  const n = names();
  const block = renderEnvBlock(WRANGLER_TOML, n, {
    databaseId: DRY_DATABASE_ID,
    coversBaseUrl: n.coversBaseUrl,
    ownerEmails: n.requesterEmail,
    namespaceId: nextRateLimitNamespace(WRANGLER_TOML),
  });
  const after = insertEnvBlock(WRANGLER_TOML, block);

  it('🔴 the block lands ABOVE the template, never at EOF', () => {
    assert.ok(after.indexOf(`[env.${n.instance}]`) < templateStart(after), 'the block landed inside the template');
  });

  it('🔴 the drift guard\'s INERTNESS rule still holds — every template line is commented', () => {
    // ⚠️ Mirrored from `apps/worker/src/lib/instance-template.test.ts` on
    // purpose: that file can only read the REAL wrangler.toml, so it cannot see
    // a hypothetical post-provision one. This is the same rule applied to the
    // file this script would actually write. If they ever disagree, that one is
    // right and this one is the copy to fix.
    const live = after
      .slice(templateStart(after))
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    assert.deepEqual(live, [], 'the provisioner wrote a live line into the template region');
  });

  it('the template survives whole, ready for a THIRD instance', () => {
    assert.ok(after.slice(templateStart(after)).includes('# [env.games2]'));
    assert.ok(after.includes('TEMPLATE — a SECOND games instance'));
  });

  it('the tooling now sees exactly ONE real instance, and it is the new one', () => {
    assert.deepEqual(parseEnvNames(after), ['quarry']);
    assert.deepEqual(parseEnvNames(WRANGLER_TOML), [], 'the committed file has no real env — that is the premise');
  });

  it('🔴 two DISTINCT ids — the same-id guard would pass, which is the F-5 check', () => {
    const apps = parseEstateApps(after);
    assert.deepEqual(apps, ['games', 'games2']);
    assert.equal(new Set(apps).size, apps.length, 'two envs assert the same estate identity');
  });

  it('the live config above it is untouched, byte for byte', () => {
    assert.equal(after.slice(0, WRANGLER_TOML.indexOf('# ═════')), WRANGLER_TOML.slice(0, WRANGLER_TOML.indexOf('# ═════')));
  });
});

// ---------------------------------------------------------------------------
// 5 · Script twins, secrets, and the small pure helpers.
// ---------------------------------------------------------------------------

describe('the script twins', () => {
  it('every twin a PERSON types starts with the instance guard, so an absent env refuses in WORDS', () => {
    // ⚠️ `deploy:` and `postdeploy:` are deliberately NOT on this list, and the
    // shape is copied from the committed `:games2` twins rather than improved
    // on: npm runs `predeploy:<i>` itself before `deploy:<i>`, and that one
    // carries the guard, so the guard is reached either way. Adding it to
    // `deploy:` would run it twice and diverge the twins from the ones already
    // in package.json — two shapes for one thing is how they drift.
    const twins = rootScriptTwins('quarry');
    for (const name of ['predeploy:quarry', 'secret:quarry', 'secret:list:quarry', 'secrets:push:quarry', 'db:migrate:quarry']) {
      assert.match(twins[name], /^node scripts\/instance-guard\.mjs quarry &&/, `${name} skips the instance guard`);
    }
    assert.equal(twins['deploy:quarry'], 'npm run build && npm run deploy:quarry --workspace @bgc/worker');
    assert.match(twins['predeploy:quarry'], /instance-guard/, 'the guard npm reaches before any deploy');
  });

  it('the deploy twin carries the guards, in the order deploys.md documents', () => {
    const pre = rootScriptTwins('quarry')['predeploy:quarry'];
    const order = ['instance-guard', 'sync-estate', 'check-clean', 'deploy-guard.mjs --instance=quarry', 'typecheck', 'npm test'];
    let at = -1;
    for (const step of order) {
      const next = pre.indexOf(step);
      assert.ok(next > at, `${step} is missing or out of order in predeploy`);
      at = next;
    }
  });

  it('⚠️ there is NO db:migrate:local twin — miniflare would read the MAIN local D1', () => {
    const all = { ...rootScriptTwins('quarry'), ...workerScriptTwins('quarry', 'board-game-catalog-2nd') };
    assert.deepEqual(Object.keys(all).filter((k) => k.includes(':local')), []);
  });

  it('the worker twins target the new D1 remotely, under the new env', () => {
    const w = workerScriptTwins('quarry', 'board-game-catalog-2nd');
    assert.equal(w['db:migrate:quarry'], 'wrangler d1 migrations apply board-game-catalog-2nd --remote --env quarry');
    assert.equal(w['deploy:quarry'], 'wrangler deploy --env quarry');
  });

  it('insertScripts adds only what is missing, and groups it after the anchor', () => {
    const { scripts, added } = insertScripts(
      { a: '1', 'postdeploy:games2': '2', z: '3' },
      { 'deploy:quarry': 'x', 'postdeploy:games2': 'CLOBBER' },
      'postdeploy:games2',
    );
    assert.deepEqual(added, ['deploy:quarry']);
    assert.deepEqual(Object.keys(scripts), ['a', 'postdeploy:games2', 'deploy:quarry', 'z']);
    assert.equal(scripts['postdeploy:games2'], '2', 'an existing script was overwritten');
  });
});

describe('the secret plan', () => {
  const plan = secretPlan();

  it('pushes the SHARED games keys and nothing else', () => {
    assert.deepEqual(plan.push.sort(), ['BGG_API_TOKEN', 'GAMEUPC_API_KEY']);
  });

  it('🔴 ANTHROPIC_API_KEY is never in a bulk payload — it is its own step', () => {
    assert.ok(!plan.push.includes('ANTHROPIC_API_KEY'));
    assert.ok(plan.lines.some((l) => l.startsWith('special') && l.includes('ANTHROPIC_API_KEY')));
  });

  it('🔴 no ESTATE_APP_TOKEN_* and no INDEX_PUSH_TOKEN can be bulk-pushed', () => {
    assert.deepEqual(plan.push.filter((n) => n.startsWith('ESTATE_APP_TOKEN_')), []);
    assert.ok(!plan.push.includes('INDEX_PUSH_TOKEN'));
  });

  it('every refusal says WHY, in a sentence a person can act on', () => {
    const refusals = plan.lines.filter((l) => l.startsWith('refuse'));
    assert.ok(refusals.length >= 2);
    for (const r of refusals) {
      const i = plan.lines.indexOf(r);
      assert.match(plan.lines[i + 1], /↳ \S/, `${r} has no reason under it`);
    }
  });

  it('🔴 the last-moment guard fires even when the CLASSIFIER is the thing that broke', () => {
    // The failure this guard exists for is "a list edit, a reordered branch or a
    // future flag put a per-instance key into the payload". Injecting a
    // classifier that says nothing is per-instance IS that mistake, and the
    // guard must not agree with it — it re-checks with the real `isPerInstance`.
    assert.throws(
      () => secretPlan({ production: ['BGG_API_TOKEN', 'INDEX_PUSH_TOKEN'], classify: () => false }),
      /would push per-instance secrets \(INDEX_PUSH_TOKEN\)/,
    );
  });
});

describe('the small helpers that touch data', () => {
  it('sqlLit doubles quotes and refuses a non-finite number', () => {
    assert.equal(sqlLit("O'Brien"), "'O''Brien'");
    assert.equal(sqlLit(null), 'NULL');
    assert.equal(sqlLit(7), '7');
    assert.throws(() => sqlLit(Number.NaN), /refusing to write/);
  });

  it('deploysLogHasInstance reads the 5th field, and main\'s four-field lines are `default`', () => {
    const log = [
      '2026-09-05T14:36:04.804Z\t9c1dba6f\tfable\ta349aee1',
      '2026-09-06T10:00:00.000Z\tdeadbeef\tfable\tv2\tenv=quarry',
    ].join('\n');
    assert.equal(deploysLogHasInstance(log, 'quarry'), true);
    assert.equal(deploysLogHasInstance(log, 'games2'), false);
    assert.equal(deploysLogHasInstance('', 'quarry'), false);
  });

  it('parseEnvNames and parseEstateApps ignore COMMENTED tables and vars', () => {
    // The committed file's whole second-instance template is commented; a parser
    // that counted it would report an instance nothing has ever created.
    assert.deepEqual(parseEnvNames(WRANGLER_TOML), []);
    assert.deepEqual(parseEstateApps(WRANGLER_TOML), ['games']);
  });
});

// ---------------------------------------------------------------------------
// 6 · The sealed-key hook — one stub per `source`.
// ---------------------------------------------------------------------------

/**
 * A throwaway `catalog-platform` checkout: just enough for the real
 * `platform-repo.mjs` locator to accept it, plus a stub `catalog-seal.mjs`.
 *
 * ⚠️ The REAL locator and the REAL dynamic import run against this — the seam
 * under test is "does this script find, call and believe that module", and a
 * hand-injected function would test none of it. The stub returns a `source`
 * string; there is no key material anywhere in this file.
 */
function fakePlatform(sealBody) {
  const dir = mkdtempSync(join(tmpdir(), 'bgc-seal-'));
  mkdirSync(join(dir, 'packages', 'estate-auth', 'src'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'estate-auth', 'src', 'index.ts'), '// stub\n', 'utf8');
  mkdirSync(join(dir, 'apps', 'auth-worker', 'migrations'), { recursive: true });
  if (sealBody !== null) {
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'lib', 'catalog-seal.mjs'), sealBody, 'utf8');
  }
  return dir;
}

const sealStub = (source) =>
  `export async function injectSealedKey({ envName, dry }) {\n` +
  `  console.log('  [stub] injectSealedKey env=' + envName + ' dry=' + dry);\n` +
  `  return { source: ${JSON.stringify(source)} };\n` +
  `}\n`;

describe('the sealed-key hook (design §6.4, phase 5)', () => {
  const cases = [
    ['reader', /the REQUESTER'S own key is set/, /reader_key_set = 1, owner_key_set = 0/],
    ['owner', /the owner's SEALED key is set/, /reader_key_set = 0, owner_key_set = 1/],
    ['none', /owner key used — standing decision 2026-09-05/, /reader_key_set = 0, owner_key_set = 1/],
  ];

  for (const [source, says, sql] of cases) {
    it(`source = "${source}" → the right sentence AND the right booleans on the row`, () => {
      const dir = fakePlatform(sealStub(source));
      try {
        const { text, code } = run(['--request', '7', '--fixture', ACCEPTED_FIXTURE], {
          CATALOG_PLATFORM_DIR: dir,
        });
        assert.equal(code, 0, text.slice(-800));
        assert.match(text, /\[stub\] injectSealedKey env=quarry dry=true/, 'the module was not actually called');
        assert.match(text, new RegExp(`source = ${source}`));
        assert.match(text, says);
        // 🔴 The booleans are the durable half: the request row records whose
        // money this instance spends, forever.
        assert.match(text, sql);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('an ABSENT module falls to row 3, and says it is absent rather than "no envelope"', () => {
    // ⚠️ Two different facts with the same outcome: "that phase has not landed"
    // and "it has, and this request carried none". Printing one as the other is
    // how somebody concludes a requester submitted no key when nothing ever
    // looked.
    const dir = fakePlatform(null);
    try {
      const { text, code } = run(['--request', '7', '--fixture', ACCEPTED_FIXTURE], {
        CATALOG_PLATFORM_DIR: dir,
      });
      assert.equal(code, 0, text.slice(-800));
      assert.match(text, /sealed-key lib\s+ABSENT/);
      assert.match(text, /owner key used — standing decision 2026-09-05/);
      assert.doesNotMatch(text, /source = /, 'it reported a source when nothing resolved one');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a module with no injectSealedKey export is treated as absent, in words', () => {
    const dir = fakePlatform('export const nothingUseful = 1;\n');
    try {
      const { text } = run(['--request', '7', '--fixture', ACCEPTED_FIXTURE], {
        CATALOG_PLATFORM_DIR: dir,
      });
      assert.match(text, /exports no injectSealedKey/);
      assert.match(text, /owner key used — standing decision 2026-09-05/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('🔴 a THROWING inject stops the run — it never falls through to the owner\'s key', () => {
    // A failed inject is not "there was no envelope". Falling through would
    // spend the owner's money on a decision nobody made.
    const dir = fakePlatform(
      'export async function injectSealedKey() { throw new Error("r2 get failed"); }\n',
    );
    try {
      const { text } = run(['--request', '7', '--fixture', ACCEPTED_FIXTURE], {
        CATALOG_PLATFORM_DIR: dir,
      });
      assert.match(text, /the sealed-key step FAILED: r2 get failed/);
      assert.match(text, /falling through to/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 7 · The whole --dry run, end to end.
// ---------------------------------------------------------------------------

describe('--dry against an accepted games fixture prints the WHOLE plan', () => {
  const dir = fakePlatform(sealStub('none'));
  const { text, code } = run(['--request', '7', '--fixture', ACCEPTED_FIXTURE], {
    CATALOG_PLATFORM_DIR: dir,
  });
  rmSync(dir, { recursive: true, force: true });

  it('exits 0 — ⚠️ a successful dry run reporting non-zero is worse than no code at all', () => {
    assert.equal(code, 0, text.slice(-800));
  });

  it('all twelve numbered steps are printed, in order', () => {
    const heads = [
      '1 · D1 create',
      '2 · R2 covers bucket',
      '3 · The [env.quarry] block',
      '4 · package.json script twins',
      '5 · Commit the allowlist',
      '6 · Migrate the new D1',
      '7 · ⏸ PAUSE #1',
      '8 · ⏸ PAUSE #2',
      '9 · The paired estate token',
      '10 · Per-instance secrets',
      '11 · ⏸ The guarded deploy',
      '12 · Verify live',
    ];
    let at = -1;
    for (const h of heads) {
      const next = text.indexOf(h);
      assert.ok(next > at, `step heading missing or out of order: ${h}`);
      at = next;
    }
  });

  it('BOTH manual pauses print their runbook, including the two steps books does not have', () => {
    assert.match(text, /PAUSE #1 — Firebase authorised domain/);
    assert.match(text, /PAUSE #2 — auth-worker consumer registration/);
    assert.match(text, /siteForApp\(\)/);
    assert.match(text, /BILLING_SITES/);
    assert.match(text, /vis_games2/);
  });

  it('🔴 the games "no key" sentence is used, and the books donor one is only ever NEGATED', () => {
    // §7.6 consequence 2. The mockup's "the free donor sweep still runs" is true
    // for books and FALSE here: there is no DONOR_URL, no PEERS, no donor route.
    // The script quotes that sentence in order to CONTRADICT it, so the test
    // cannot simply forbid the words — it checks that every line carrying them
    // also carries the contradiction. (This assertion caught itself: the naive
    // `doesNotMatch` failed against the script's own correction.)
    assert.match(text, /NO AI LOOKUPS AT ALL/);
    const donorLines = text.split('\n').filter((l) => /donor sweep/.test(l));
    assert.ok(donorLines.length > 0, 'the donor difference is not mentioned at all');
    for (const line of donorLines) {
      assert.match(
        text.slice(text.indexOf(line), text.indexOf(line) + 300),
        /false on this side|no donor|nothing self-heals/,
        `"${line.trim()}" states the books outcome without contradicting it`,
      );
    }
  });

  it('it does NOT deploy — step 11 is the owner\'s command, printed', () => {
    assert.match(text, /DEPLOY_HOLDER=<you> npm run deploy:quarry/);
    assert.match(text, /YOUR command, not this script's/);
  });

  it('it says what it did NOT verify, and closes by saying nothing was written', () => {
    assert.match(text, /⚠️ NOT verified by this run/);
    assert.match(text, /Dry run — nothing was created, written, committed, minted or deployed\./);
  });

  it('every review link is a real deep link, per the estate\'s rule for anything visible', () => {
    assert.match(text, /https:\/\/quarry\.heygabi\.ai\//);
    assert.match(text, /https:\/\/quarry\.heygabi\.ai\/api\/health\?cb=/);
    assert.match(text, /https:\/\/heygabi\.ai\/admin\//);
  });

  it('⚠️ no secret VALUE is anywhere in the output — stdin is named, never its contents', () => {
    assert.match(text, /← <stdin>/);
    // The one place a value could leak is the bulk payload; it is printed as a
    // list of NAMES and the printer is handed nothing else.
    assert.match(text, /← <stdin>   BGG_API_TOKEN, GAMEUPC_API_KEY/);
  });

  /* ────────────────────────────────────────────────────────────────────────
   * ⚠️ THE COMPLETENESS TESTS — survey §7, added 2026-09-06.
   *
   * Not "does the string appear" pedantry. §7 measured that a new catalog
   * needs ~28 hand-edits and that the two provisioners named 3, and each
   * MISSING line has a specific known failure behind it: a bare 500, a shelf
   * enumerable by anybody, a page that reads as an outage — and, on the games
   * side only, a push that DELETES the main catalog's index rows. A test per
   * item is what stops one being dropped in a later tidy-up, because a
   * checklist silently losing an entry looks exactly like a shorter one.
   * ──────────────────────────────────────────────────────────────────────── */

  it('🔴 the GAMES vocabulary trap is named before anything else in the index section', () => {
    assert.match(text, /THE VOCABULARY TRAP/);
    assert.match(text, /SNAPSHOT REPLACE/);
    assert.match(text, /delete each/);
    // The resolved source for THIS fixture is the app id, not `game`.
    assert.match(text, /will push 'games2' as/);
    assert.match(text, /Do NOT "fix" it by/);
  });

  it('🔴 the index entry.source MIGRATION is named, with the exact widened CHECK line', () => {
    assert.match(text, /00NN_entry_source_games2\.sql/);
    assert.match(
      text,
      /\+ {2}source TEXT NOT NULL CHECK \(source IN \('game','library','audiobook','library2','games2'\)\),/,
    );
    // ⚠️ The whole trap in one sentence: the command an operator would reach
    // for answers "nothing pending", truthfully.
    assert.match(text, /No migrations/);
    assert.match(text, /is TRUE and it is not the question/);
    assert.match(text, /never drop it/);
    // rows.ts's game-vs-book branch: a second games source folds as a BOOK.
    assert.match(text, /folded as a BOOK/);
  });

  it('🔴 UNSCOPED_LOOKUP_EXCLUDED is named as failing OPEN, not merely as an edit', () => {
    assert.match(text, /read\.ts:69 — UNSCOPED_LOOKUP_EXCLUDED/);
    assert.match(text, /FAILS OPEN/);
    assert.match(text, /can enumerate/);
    assert.match(text, /vis_games2 grant at all/);
    // And MACHINE_VISIBILITY must NOT gain it by reflex.
    assert.match(text, /deliberate DEFAULT-DENY/);
    assert.match(text, /Being an APP is not being a SHELF/);
  });

  it('⚠️ READ_ORIGINS is EMITTED for the owner and never applied — access-increasing', () => {
    assert.match(text, /OWNER, ACCESS-INCREASING/);
    assert.match(text, /wrangler\.toml:65 — READ_ORIGINS/);
    assert.match(text, /READ_ORIGINS = "https:\/\/heygabi\.ai,.*,https:\/\/quarry\.heygabi\.ai"/);
    assert.match(text, /does NOT apply it and must not/);
    // 🔴 Read the LIVE list first — a template would REVOKE a newer origin.
    assert.match(text, /silently REVOKE an/);
  });

  it('the auth Worker items the checklist was missing: visibility ×2 files, CORS, reserved names', () => {
    assert.match(text, /packages\/estate-auth\/src\/visibility\.ts/);
    assert.match(text, /storedVisibility\(\) {2}\+ if \(row\.vis_games2 === 1\)/);
    assert.match(text, /Do NOT hand-edit the GENERATED copies/);
    assert.match(text, /the CORS allowlist gains the new host/);
    assert.match(text, /\+ {2}'https:\/\/quarry\.heygabi\.ai',/);
    assert.match(text, /NETWORK ERROR/);
    // RESERVED_SUBDOMAINS was already an AFTERWARDS note here; it is now also
    // an inline edit at the pause, and it must name BOTH hostnames.
    assert.match(text, /catalog-names\.ts:109 — RESERVED_SUBDOMAINS/);
    assert.match(text, /\+ {2}'quarry',/);
    assert.match(text, /\+ {2}'gamecovers2',/);
  });

  it('✅ it says which §7 rows the REGISTRY now handles, so nobody hand-edits a label', () => {
    assert.match(text, /WHAT THE REGISTRY ROW \(step 12\) ALREADY DOES/);
    assert.match(text, /api\/catalogs/);
    assert.match(text, /10 minutes/);
    assert.match(text, /admin's CATALOGS array stays hand-kept/);
    assert.match(text, /will not GRADE this catalog's index freshness/);
  });

  it('🔴 step 12 prints the estate_catalog INSERT — a live catalog with no NAME is the failure', () => {
    assert.match(text, /INSERT INTO estate_catalog/);
    // push_source is the wire word, id is the estate word — the games repo's
    // whole trap, and the registry must not disagree with the wire.
    assert.match(
      text,
      /VALUES \('games2', 'games2', 'games', 'The Quarry Game Shelf', 'Example Person', 'physical', 0, 'quarry\.heygabi\.ai', 100, 7,/,
    );
    assert.match(text, /ON CONFLICT\(id\) DO NOTHING/);
  });
});

/* --------------------------------------------------------------------------
 * registryInsertSql and runbookSection — the two pure functions step 12 and
 * the pauses stand on. Unit-level, so a failure names the rule rather than a
 * byte offset in a 900-line dry run.
 * ------------------------------------------------------------------------ */

describe('registryInsertSql — the catalog registry row (0020)', () => {
  const n = names();
  const sql = registryInsertSql(n, row(), { now: new Date('2026-09-06T12:00:00.000Z') });

  it('the id is the ESTATE word and push_source is the WIRE word', () => {
    // For a second games instance they happen to be equal; for the MAIN one
    // they are not, and that asymmetry is the thing worth pinning.
    assert.match(sql, /VALUES \('games2', 'games2', 'games',/);
    const main = registryInsertSql({ ...n, estateApp: 'games' }, row(), { now: new Date(0) });
    assert.match(main, /VALUES \('games', 'game', 'games',/);
  });

  it("the OWNER is the requester and the holding is the owner's settled model", () => {
    assert.match(sql, /'Example Person', 'physical', 0,/);
  });

  it('🔴 ON CONFLICT DO NOTHING — a --resume must never rename a live catalog', () => {
    assert.match(sql, /ON CONFLICT\(id\) DO NOTHING$/);
  });

  it('a NULL owner is written as NULL, never as an empty string or a guess', () => {
    const anon = registryInsertSql(n, row({ requester_display_name: null }));
    assert.match(anon, /'The Quarry Game Shelf', NULL, 'physical'/);
  });

  it('a label with a quote in it cannot break the statement', () => {
    assert.match(registryInsertSql(n, row({ display_name: "O'Brien's" })), /'O''Brien''s'/);
  });
});

describe('runbookSection — the pauses are found by HEADING, not by line offset', () => {
  const n = names();
  const first = runbookSection(n, '/repos/catalog-platform', 1);
  const second = runbookSection(n, '/repos/catalog-platform', 2);

  it('🔴 pause #1 stops at pause #2 — the old .slice(0, 12) was a line offset', () => {
    // The bug had not fired yet: one extra line in PAUSE #1 would have printed
    // half of it plus the head of the next, to somebody standing at a
    // checkpoint. The runbook grew ~120 lines the day this was written.
    assert.ok(!first.some((l) => l.includes('PAUSE #2')));
    assert.match(first.join('\n'), /PAUSE #1 — Firebase authorised domain/);
  });

  it("pause #2 carries the other repo's work with it", () => {
    assert.match(second[0], /PAUSE #2/);
    assert.ok(!second.some((l) => l.includes('PAUSE #1')));
    assert.match(second.join('\n'), /THE ESTATE INDEX/);
    assert.match(second.join('\n'), /READ_ORIGINS/);
  });

  it('the two halves reassemble into the whole runbook, losing nothing', () => {
    assert.deepEqual([...first, ...second], manualRunbook(n, { platformDir: '/repos/catalog-platform' }));
  });
});
