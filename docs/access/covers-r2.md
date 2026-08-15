# Game covers in Cloudflare R2 — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-15** — bucket created, domain attached and serving,
> migration run against production the same day. See
> `catalog-platform/docs/info/covers-consolidation-plan.md` for the full plan
> this executed, and `docs/covers-migration-2026-08-15-log.jsonl` /
> `-progress.json` / `-*-snapshot.json` for the run's own audit trail (this
> repo has no `change_log` table, so those files ARE the rollback material).

## 0. What exists

| | |
|---|---|
| Bucket | **`game-covers`**, Cloudflare account `113be82b840c956b8378a187047ab3ea` (same account as `library-covers`, `audiobook-covers`, `bgc-photos`) |
| Public URL | **`https://gamecovers.heygabi.ai`** — R2 custom domain, attached and active (not the rate-limited `r2.dev` interim) |
| Binding | `COVERS` (R2Bucket) + `COVERS_BASE_URL` var, both in `apps/worker/wrangler.toml` |
| Object key | `covers/{slug}-{sha256[0:16]}.{ext}` — content-addressed, so a cache is never stale. `coverObjectKey()` in `packages/core/src/covers.ts` |
| Cache-Control | `public, max-age=31536000, immutable`, set per object at upload |
| Verify/hash/key code | `packages/core/src/covers.ts` (`sniffImageType`, `MIN_COVER_BYTES`/`MAX_COVER_BYTES`, `coverObjectKey`) — ported from `library_catalog/packages/core/src/covers.ts`, not imported (see that file's own header for why) |
| One-time migration script | `scripts/rehost-covers.mjs` — resumable via `docs/covers-migration-2026-08-15-progress.json`, idempotent, never rewrites a row without a successful upload first |
| Future-cover intake hook | `apps/worker/src/lib/cover-storage.ts` (`makeCoverHoster`), wired into `updateItem()`/`createItem()` (`packages/db/src/items.ts`) via the routes in `routes/catalog.ts` and `routes/bgg.ts`. Fails soft — a hosting hiccup keeps the original hotlink rather than blocking the save |
| Health endpoint | `GET /api/covers/storage` → `{"enabled": true, "maxBytes": ...}` |

## 1. Provisioning (already done — recipe for a rebuild)

```bash
# From apps/worker.
npx wrangler r2 bucket create game-covers
npx wrangler r2 bucket domain add game-covers --domain gamecovers.heygabi.ai \
  --zone-id a3a39d7ae25918fe4851092b6c561974
```

Then in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "COVERS"
bucket_name = "game-covers"

[vars]
COVERS_BASE_URL = "https://gamecovers.heygabi.ai"
```

⚠️ **`--zone-id` is required non-interactively** — `wrangler r2 bucket domain add`
without it prompts for the zone, and the automatic "yes" fallback in a
non-interactive session picks the FIRST prompt only, not the zone choice.
`a3a39d7ae25918fe4851092b6c561974` is the `heygabi.ai` zone, the same one
`covers.heygabi.ai` and `bookcovers.heygabi.ai` are attached to.

⚠️ **Domain attach is not instant.** `ownership_status`/`ssl_status` read
`pending` for a few minutes after `domain add`, then flip to `active`.
`npx wrangler r2 bucket domain list game-covers` shows current state.

## 2. Running the migration script (or a re-run / retry)

```bash
# From the repo root.
node scripts/rehost-covers.mjs                 # resumes from checkpoint
node scripts/rehost-covers.mjs --retry-failed   # also retries prior failures
node scripts/rehost-covers.mjs --dry-run        # fetch+verify only
node scripts/rehost-covers.mjs --limit=5        # test on a handful first
```

Requires the two snapshot files it reads from (`docs/covers-migration-
2026-08-15-{item,edition}-snapshot.json`) — re-run the `wrangler d1 execute
--remote --json` queries in the migration plan §3 step 0 to regenerate them
against current production if they are missing or stale.

### ⚠️ Gotchas, all cost real time on this run

| | |
|---|---|
| **`execFileSync(..., { shell: true })` on Windows silently truncates an argument at its first space or comma** | `--cache-control "public, max-age=..., immutable"` came out as `Unknown arguments: max-age=31536000,, immutable` — cmd.exe re-splits an already-quoted argument array. Fix: resolve wrangler's own entry (`require.resolve('wrangler/package.json')` → `pkg.bin.wrangler`) and invoke it with `process.execPath`, no shell, ever |
| **`wrangler d1 execute --file` prints a preamble ("├ Checking if file needs uploading") before the JSON** on stdout | Unlike `--command`, which is clean JSON. If parsing `--file` output, strip to the first `[` — or, simpler, don't parse it: see the next row |
| **`wrangler d1 execute --file`'s `meta.changes` does NOT sum across the statements in that file** | Measured: 3 UPDATEs in one file reported `changes: 1` in the returned meta while all 3 rows had in fact written correctly (verified by reading them back). Do not trust that field for a multi-statement file's affected-row count — verify by reading the rows back instead |
| **A 10-minute background-task cap can outlive a full run** | 1,124 URLs at the measured real-world rate (~0.7-1/sec, fetch-then-upload, not the ~3/sec library measured for already-local files) took over 20 minutes. The script checkpoints every 25 URLs specifically so a kill mid-run costs nothing — just re-run the same command |

## 3. `isBggImageUrl` / `NOT_BGG_IMAGE` — the detection this migration broke, and the fix

`packages/db/src/editions.ts` used to answer "is this item's cover a
BoardGameGeek image" by checking whether the URL's host was
`geekdo-images.com`. After this migration, **every** cover — BGG, Kickstarter,
Gamefound, everything — sits on `gamecovers.heygabi.ai`, so that host check
can never again distinguish them, silently: `recordCampaignCovers` would have
started treating every item's current (rehosted) BGG cover as a
crowdfunding-only artifact worth recording as a `'campaign'` edition, and
`preserveDisplacedCover` would have mis-tagged every displaced BGG cover the
same way.

Fixed by joining to `edition.source = 'bgg'` instead of sniffing the URL
string: `addBggEditions` already writes a `source='bgg'` edition row carrying
that printing's `image_url`, and because the rehost maps one source URL to one
hosted URL, a BGG-sourced edition row and the `item.thumbnail_url` chosen from
it land on the *identical* hosted URL after migration — so "does a
`source='bgg'` edition of this item carry this exact URL" is `isBggSourcedCover`
in `editions.ts`, and it is correct whether the URL in question is still a raw
hotlink or already rehosted. The plain host check stays too (ORed), for BGG
images with no matching edition row at all.

## 4. Related

- `catalog-platform/docs/info/covers-consolidation-plan.md` — the plan.
- `bookbuddy/library_catalog/docs/access/cloudflare.md` §7.1 — the R2 bucket
  recipe this ported.
- `bookbuddy/library_catalog/docs/cover-rehost-report.md` — the sibling
  migration this ported, one day before this one ran.
- `bookbuddy/audiobook_catalog/docs/info/covers-r2.md` — the third sibling's
  R2 setup (a different shape: Python + a committed manifest, not a D1
  migration, because that catalog is CSV-driven).
- `sites/heygabi-home/public/_headers` (catalog-platform) — the apex CSP this
  plan prunes once migration verifies zero third-party rows remain.
