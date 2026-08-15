#!/usr/bin/env node
/**
 * The one-time games cover rehost — catalog-platform/docs/info/
 * covers-consolidation-plan.md §3 step 3. Ported from library_catalog's
 * 2026-08-13 rehost run (docs/cover-rehost-report.md), adapted for games'
 * two source tables (`item.thumbnail_url`, `edition.image_url`) and its lack
 * of a `change_log` table (this script's own log file is the audit trail).
 *
 * Order, enforced by the code shape, never violated: download → verify →
 * hash → upload to R2 → ONLY THEN the guarded UPDATE. A row is never pointed
 * at an object that was never actually written. A failed download NEVER
 * rewrites its row.
 *
 * Idempotent: re-running skips any URL already recorded 'done' in the
 * checkpoint file, and any URL already on gamecovers.heygabi.ai.
 *
 * Usage:
 *   node scripts/rehost-covers.mjs                 # run (resumes from checkpoint)
 *   node scripts/rehost-covers.mjs --retry-failed   # also retries prior failures
 *   node scripts/rehost-covers.mjs --dry-run        # fetch+verify only, no upload/write
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO_ROOT = process.cwd(); // invoked from the repo root
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');

// Resolve wrangler's own entry point and invoke it with `node`, directly —
// no `npx`, no shell. ⚠️ On Windows, `execFileSync(..., { shell: true })`
// re-splits already-quoted arguments through cmd.exe (Node's own
// DEP0190 warning), which silently truncated `--cache-control
// "public, max-age=..., immutable"` at its first space/comma during testing.
// Invoking the resolved .js directly with `process.execPath` sidesteps cmd.exe
// entirely, so arguments reach wrangler exactly as passed.
const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve('wrangler/package.json', { paths: [REPO_ROOT] });
const wranglerPkg = require(wranglerPkgPath);
const WRANGLER_BIN = path.join(path.dirname(wranglerPkgPath), wranglerPkg.bin.wrangler);
const ITEM_SNAPSHOT = path.join(DOCS_DIR, 'covers-migration-2026-08-15-item-snapshot.json');
const EDITION_SNAPSHOT = path.join(DOCS_DIR, 'covers-migration-2026-08-15-edition-snapshot.json');
const PROGRESS_FILE = path.join(DOCS_DIR, 'covers-migration-2026-08-15-progress.json');
const LOG_FILE = path.join(DOCS_DIR, 'covers-migration-2026-08-15-log.jsonl');
const SQL_DIR = path.join(DOCS_DIR, 'covers-migration-2026-08-15-sql');

const BUCKET = 'game-covers';
const BASE_URL = 'https://gamecovers.heygabi.ai';
const MIN_COVER_BYTES = 1000;
const MAX_COVER_BYTES = 6 * 1024 * 1024;
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 3;
const CHECKPOINT_EVERY = 25;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const RETRY_FAILED = args.has('--retry-failed');
const limitArg = [...args].find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

// ---------------------------------------------------------------------------
// Ported from packages/core/src/covers.ts (sniffImageType / coverObjectKey) —
// duplicated rather than imported because this script runs outside the
// TS build pipeline; see that file's header for why porting (not importing)
// is the right call for this small, self-contained utility.
// ---------------------------------------------------------------------------

function hexHead(bytes, length) {
  let out = '';
  for (let i = 0; i < length && i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
function ascii(bytes, from, to) {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}
function sniffImageType(bytes) {
  if (hexHead(bytes, 3) === 'ffd8ff') return 'image/jpeg';
  if (hexHead(bytes, 8) === '89504e470d0a1a0a') return 'image/png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}
function extensionFor(type) {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
}
function coverObjectKey(workKey, digestHex, type) {
  const slug =
    workKey
      .replace(/\|/g, '-')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'cover';
  return `covers/${slug}-${digestHex.slice(0, 16)}.${extensionFor(type)}`;
}

// ---------------------------------------------------------------------------

function log(line) {
  process.stdout.write(line + '\n');
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return {};
  return loadJson(PROGRESS_FILE);
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 0));
}

function appendLog(entry) {
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) board-game-catalog-cover-rehost/1.0 (private household catalog)',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // don't retry a clean 4xx
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, bytes: buf };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
    if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr) };
}

function uploadToR2(key, bytes, contentType) {
  execFileSync(
    process.execPath,
    [
      WRANGLER_BIN,
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--pipe',
      '--remote',
      '--content-type',
      contentType,
      '--cache-control',
      'public, max-age=31536000, immutable',
    ],
    { cwd: WORKER_DIR, input: Buffer.from(bytes), stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

async function pool(items, worker, concurrency) {
  let i = 0;
  const results = new Array(items.length);
  async function runner() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function main() {
  log(`=== games cover rehost — ${new Date().toISOString()} ===`);
  log(`dry_run=${DRY_RUN} retry_failed=${RETRY_FAILED}`);

  const itemSnap = loadJson(ITEM_SNAPSHOT)[0].results; // [{id, thumbnail_url}]
  const editionSnap = loadJson(EDITION_SNAPSHOT)[0].results; // [{id, item_id, image_url}]

  // A representative item name for each URL, for coverObjectKey's slug — cosmetic
  // only, the hash is the real identity. First item row wins; else first edition's
  // own name if it has one is not available here (editions carry item_id, not name),
  // so edition-only URLs fall back to their item_id.
  const nameByUrl = new Map();
  for (const r of itemSnap) {
    if (!nameByUrl.has(r.thumbnail_url)) nameByUrl.set(r.thumbnail_url, `item-${r.id}`);
  }
  for (const r of editionSnap) {
    if (!nameByUrl.has(r.image_url)) nameByUrl.set(r.image_url, `item-${r.item_id}-edition-${r.id}`);
  }

  const distinctUrls = [...nameByUrl.keys()];
  log(`distinct URLs (item ∪ edition): ${distinctUrls.length}`);

  const progress = loadProgress();

  const toProcess = distinctUrls.filter((url) => {
    if (url.startsWith(BASE_URL + '/')) return false; // already hosted
    const p = progress[url];
    if (!p) return true;
    if (p.status === 'done') return false;
    if (p.status === 'failed' && !RETRY_FAILED) return false;
    return true;
  });
  log(`already done (skipped): ${distinctUrls.length - toProcess.length}`);
  const limited = LIMIT ? toProcess.slice(0, LIMIT) : toProcess;
  log(`to process this run: ${limited.length}${LIMIT ? ` (--limit=${LIMIT})` : ''}`);

  let processed = 0;
  const hostCounts = {}; // host -> {ok, failed}

  await pool(
    limited,
    async (url) => {
      const host = hostOf(url);
      hostCounts[host] ??= { ok: 0, failed: 0 };

      const fetched = await fetchWithRetry(url);
      if (!fetched.ok) {
        progress[url] = { status: 'failed', reason: `fetch: ${fetched.error}`, host };
        appendLog({ url, host, outcome: 'failed', reason: `fetch: ${fetched.error}` });
        hostCounts[host].failed++;
        processed++;
        return;
      }

      const bytes = fetched.bytes;
      const type = sniffImageType(bytes);
      if (!type) {
        progress[url] = { status: 'failed', reason: 'not a sniffable image', host, bytes: bytes.length };
        appendLog({ url, host, outcome: 'failed', reason: 'not a sniffable image', bytes: bytes.length });
        hostCounts[host].failed++;
        processed++;
        return;
      }
      if (bytes.length < MIN_COVER_BYTES) {
        progress[url] = { status: 'failed', reason: `${bytes.length} bytes — placeholder floor`, host, bytes: bytes.length };
        appendLog({ url, host, outcome: 'failed', reason: 'below MIN_COVER_BYTES', bytes: bytes.length });
        hostCounts[host].failed++;
        processed++;
        return;
      }
      if (bytes.length > MAX_COVER_BYTES) {
        progress[url] = { status: 'failed', reason: `${bytes.length} bytes — over ceiling`, host, bytes: bytes.length };
        appendLog({ url, host, outcome: 'failed', reason: 'over MAX_COVER_BYTES', bytes: bytes.length });
        hostCounts[host].failed++;
        processed++;
        return;
      }

      const digestHex = createHash('sha256').update(bytes).digest('hex');
      const workKey = nameByUrl.get(url) ?? 'cover';
      const key = coverObjectKey(workKey, digestHex, type);
      const hostedUrl = `${BASE_URL}/${key}`;

      if (!DRY_RUN) {
        try {
          uploadToR2(key, bytes, type);
        } catch (err) {
          const detail = err?.stderr ? err.stderr.toString().slice(0, 500) : String(err?.message ?? err);
          progress[url] = { status: 'failed', reason: `upload: ${detail}`, host, bytes: bytes.length };
          appendLog({ url, host, outcome: 'failed', reason: `upload: ${detail}`, bytes: bytes.length });
          hostCounts[host].failed++;
          processed++;
          return;
        }
      }

      progress[url] = { status: DRY_RUN ? 'verified' : 'done', hostedUrl, key, host, bytes: bytes.length, contentType: type };
      appendLog({ url, host, outcome: DRY_RUN ? 'verified' : 'done', hostedUrl, key, bytes: bytes.length, contentType: type });
      hostCounts[host].ok++;
      processed++;

      if (processed % CHECKPOINT_EVERY === 0) {
        saveProgress(progress);
        log(`checkpoint: ${processed}/${limited.length} processed`);
      }
    },
    CONCURRENCY,
  );

  saveProgress(progress);

  log('\n=== per-host summary (this run) ===');
  for (const [host, c] of Object.entries(hostCounts).sort((a, b) => b[1].ok + b[1].failed - (a[1].ok + a[1].failed))) {
    log(`${host}: ok=${c.ok} failed=${c.failed}`);
  }

  if (DRY_RUN) {
    log('\nDRY RUN — no uploads, no DB writes.');
    return;
  }

  // ------------------------------------------------------------------------
  // Guarded UPDATEs, batched into SQL files and executed via wrangler d1
  // execute --file. Every UPDATE is guarded on the row still holding the old
  // URL, per the plan's optimistic-concurrency rule.
  // ------------------------------------------------------------------------
  const esc = (s) => s.replace(/'/g, "''");

  const itemStatements = [];
  for (const r of itemSnap) {
    const p = progress[r.thumbnail_url];
    if (p?.status === 'done' && p.hostedUrl) {
      itemStatements.push(
        `UPDATE item SET thumbnail_url = '${esc(p.hostedUrl)}' WHERE id = ${r.id} AND thumbnail_url = '${esc(r.thumbnail_url)}';`,
      );
    }
  }
  const editionStatements = [];
  for (const r of editionSnap) {
    const p = progress[r.image_url];
    if (p?.status === 'done' && p.hostedUrl) {
      editionStatements.push(
        `UPDATE edition SET image_url = '${esc(p.hostedUrl)}' WHERE id = ${r.id} AND image_url = '${esc(r.image_url)}';`,
      );
    }
  }

  log(`\nitem UPDATE statements ready: ${itemStatements.length}`);
  log(`edition UPDATE statements ready: ${editionStatements.length}`);

  if (!existsSync(SQL_DIR)) mkdirSync(SQL_DIR, { recursive: true });

  const CHUNK = 150;

  // ⚠️ `wrangler d1 execute --file` with several statements in one file
  // returns ONE meta block for the whole batch, not one per statement — its
  // `changes`/`rows_written` cannot be summed per-statement (measured: 3
  // UPDATEs in one file reported `changes: 1`, while all 3 rows had in fact
  // written correctly). So this does not trust that field at all; it applies
  // the chunk, then verifies by reading the rows back afterward.
  function runChunks(statements, label) {
    for (let i = 0; i < statements.length; i += CHUNK) {
      const chunk = statements.slice(i, i + CHUNK);
      const file = path.join(SQL_DIR, `${label}-${i}.sql`);
      writeFileSync(file, chunk.join('\n'));
      execFileSync(process.execPath, [WRANGLER_BIN, 'd1', 'execute', 'board-game-catalog', '--remote', '--file', file], {
        cwd: WORKER_DIR,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 50,
      });
      log(`${label}: applied chunk ${i}-${i + chunk.length} (${chunk.length} statements)`);
    }
  }

  if (itemStatements.length > 0) runChunks(itemStatements, 'item');
  if (editionStatements.length > 0) runChunks(editionStatements, 'edition');

  // ---- verification: read the rows back, don't trust wrangler's own counts ----
  const THIRD_PARTY_HOSTS = [
    'cf.geekdo-images.com',
    'imgcdn.gamefound.com',
    'www.dndbeyond.com',
    'cdn.shopify.com',
    'dicethrone.com',
    'd1wgd08o7gfznj.cloudfront.net',
    'images.squarespace-cdn.com',
    'i.kickstarter.com',
    'img.itch.zone',
    'loottavern.com',
    'cdn11.bigcommerce.com',
    'cdn.backerkit.com',
    'files.d20.io',
  ];
  const likeClause = (col) => THIRD_PARTY_HOSTS.map((h) => `${col} LIKE '%${h}%'`).join(' OR ');

  function d1Query(sql) {
    const out = execFileSync(
      process.execPath,
      [WRANGLER_BIN, 'd1', 'execute', 'board-game-catalog', '--remote', '--json', '--command', sql],
      { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 },
    );
    // `--command` (unlike `--file`) is clean JSON on stdout — no preamble to strip.
    return JSON.parse(out)[0].results;
  }

  const itemHosted = d1Query(`SELECT COUNT(*) AS n FROM item WHERE thumbnail_url LIKE '${BASE_URL}/%'`)[0].n;
  const itemThirdParty = d1Query(`SELECT COUNT(*) AS n FROM item WHERE ${likeClause('thumbnail_url')}`)[0].n;
  const editionHosted = d1Query(`SELECT COUNT(*) AS n FROM edition WHERE image_url LIKE '${BASE_URL}/%'`)[0].n;
  const editionThirdParty = d1Query(`SELECT COUNT(*) AS n FROM edition WHERE ${likeClause('image_url')}`)[0].n;

  log(`\n=== verification (read back from production D1) ===`);
  log(`item.thumbnail_url on ${BASE_URL}: ${itemHosted}`);
  log(`item.thumbnail_url still on a third-party host: ${itemThirdParty}`);
  log(`edition.image_url on ${BASE_URL}: ${editionHosted}`);
  log(`edition.image_url still on a third-party host: ${editionThirdParty}`);
  log(`\nitem UPDATE statements attempted: ${itemStatements.length}`);
  log(`edition UPDATE statements attempted: ${editionStatements.length}`);

  log('\n=== DONE ===');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
