# System reference

> Extracted from `HANDOFF.md` on 2026-08-21 — deployment state, capabilities,
> repo layout, and commands. This is durable reference, not a work log.
>
> See also: [`../access/`](../access/README.md) for endpoints and access config.

---

## Live

| | |
|---|---|
| URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Deployed version | `3162e8fa-d650-4873-9f18-04420f20648b` â€” scan-job ownership computed on read (2026-08-06), at 100% |
| Previous version | `cfa81473-5fd2-4436-8d5b-664d02fdc02a` â€” the same change without the provenance guard |
| Cron triggers | `*/30 * * * *` the cover check, `41 5 * * 1` the weekly component refresh. Registered in the deploy output and confirmed *firing locally* via `wrangler dev --test-scheduled` â€” but **neither has ever fired in production**, see [the cron section](#-cron-triggers-do-not-fire-in-production--nothing-scheduled-has-ever-run) |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` Â· `7dd22702-f0e2-4fc7-b201-d16d60176efa` Â· WNAM |
| R2 bucket | **none** â€” `bgc-photos` still exists in the account but is unbound and empty |
| Migrations applied | `0001_init` â€¦ `0020_run_inputs` (local **and** production) |
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` |
| Access policy | **Everyone** â€” anyone may authenticate; the app decides who gets in |
| Login method | Email one-time PIN (Google SSO not configured) |
| Owner | `nbaslamking@gmail.com` (claimed on first sign-in) |

**Branch:** merged. `main` now holds all 38 phase-1 commits (merge `ab057d9`),
and typechecks. `phase-1-manual-catalog` still exists and is unchanged.

**Pushed.** `origin` is
<https://github.com/skymitch9/Board_Game_Catalog.git> and `origin/main` is up to
date as of 2026-08-06 (`d47abd8`). An earlier version of this document said
nothing had ever been published; that stopped being true on 08-06.

---

---

## What works today

**Phase 0 â€” infrastructure.** Cloudflare Worker + D1 + Access. First person to
sign in against an empty user table becomes `owner`; everyone after lands as
`pending` and sees a holding screen. Decided in one SQL statement so concurrent
first sign-ins can't both win, and self-limiting once an owner exists.

**Phase 1 â€” the manual catalog.** Add/edit/delete items and copies. Browsing is
rooted on base games with expansions, promos and accessories nested underneath,
however deep. Filters match the *tree*, not the item, so searching an expansion
surfaces its base game too. Search covers names, publishers, designers. Filters:
status, type, nothing-recorded-yet, we-own-2+. Per-person ratings shown
side by side rather than averaged.

**People screen.** Owners see everyone who has signed in, with pending accounts
called out and one-tap promote/revoke. This is the guest list â€” it lives in the
app, not the Cloudflare dashboard.

**Multi-copy.** `copy.quantity` lets one row stand for several identical things;
separate rows still describe copies that differ. Both count toward the same
totals. `Ã—N` flags, a duplicate strip per game, and a filter.

**Quick add.** Game + copy in one submit, focus stays in the name field,
status and quantity persist between entries. Built for working along a shelf.
Now the **Manually** tab of `/scan` rather than a panel on the collection page.

**Scanning â€” confirmed working on a real iPhone (2026-08-05).** Modes at
`/scan`: **barcode** (wasm decode â€” `BarcodeDetector` does not work on iOS),
**one box** (vision reads the title off the cover, 3â€“5s), **whole shelf** (reads
every spine, returns a tick-list marking what you already own). Auto-capture
fires when the phone stops moving. Nothing reaches the camera roll.

Verified end to end on device: scan an unknown barcode â†’ resolves through the
free rungs â†’ add it â†’ re-scan returns "already in your collection" instantly
from the local table. The write-back loop works.

**Exports.** `/api/export.json` (full fidelity) and `/api/export.csv` (one row
per copy). Owner-only.

**Item relations (2026-08-05).** Standalone games that belong together without
nesting â€” Dice Throne characters, Unmatched fighters, standalone expansions.
`item_relation` table with three types: `works_with`, `reimplements`,
`integrates_with`. Bidirectional: linking A to B shows on both pages. UI on the
item page: "Related games" section with "+ Link" button (by item ID).

**Full field editing (2026-08-05).** The edit form exposes every field including
`kind` (no longer locked after creation), `bggId`, and `publisherUrl`. Lets you
fix a scanned game that came in as the wrong type.

**Shelf scan classification (2026-08-05).** After a shelf photo reads titles,
the results go through `classifyShelfResults` which splits titles on `:` / ` - `
and matches the prefix against the collection. Expansions auto-propose their
parent. A review UI shows kind/parent dropdowns per item before adding. Parent
dropdown includes batch siblings (items in the same scan classified as base)
so expansions can reference them before anything is saved.

**Photo queue pipeline (2026-08-05).** Upload photos at `/scan-jobs` (multiple,
from camera or gallery). Each photo becomes a job: vision reads titles â†’
free lookups enrich (GameUPC, collection match, classification) â†’ lands in
"Ready for review" status. Review page shows the same kind/parent UI as the
shelf scan. Jobs tracked in `scan_job` table; photos stored temporarily in R2
(`bgc-photos` bucket) and deleted after review. No photo ever reaches the
camera roll or persists beyond the review step.

**Expansion picker (2026-08-05).** On the "Add to this game" page
(`/items/new?parent=N`), shows known titles from the free lookup services for
that parent game's name. Picking one pre-fills the form. When BGG token arrives,
this will use BGG's expansion links for definitive results.

**Header stats (2026-08-05).** Shows `N games Â· N expansions Â· N accessories`
(only non-zero counts), replacing the old `games Â· items Â· owned`.

---

---

## Repo layout

```
packages/core/    constants.ts (leaf) -> schemas.ts -> barcode.ts -> vision.ts -> index.ts
packages/db/      users, health, items, copies, ratings, import, barcodes, cache,
                  relations, scan-jobs, covers (cover-link health),
                  editions (printings, and the covers you choose between),
                  components (what else exists for a game, and who made it)
packages/bgg/     BGG XML API2 client (throttled, retried, cached)
packages/barcode/ free resolution: gameupc.ts, upcitemdb.ts, resolve.ts
apps/worker/src/lib/ resolve-title.ts â€” the one cached titleâ†’candidate resolver
                  cover-check.ts â€” probes hotlinked covers; run by the cron
                  component-backfill.ts â€” asks BGG what exists; run weekly by cron
                  edition-backfill.ts â€” fetches printings from BGG, ten ids a call
packages/research/ Claude calls: client.ts, barcode.ts (paid rung), vision.ts
apps/worker/      Hono routes + Access JWT verification + R2 photo storage
apps/web/         React SPA; lib/camera.ts + lib/scanner.ts hold the iOS work
                  pages/ScanJobsPage.tsx is the photo queue UI
migrations/       0001 â€¦ 0016
```

Entry points stay thin: `apps/worker/src/index.ts` mounts routes and
`apps/cli` (phase 4) will parse argv. Both delegate to `packages/`, so there is
exactly one implementation of anything that makes a decision.

### API

| Method | Path | Capability |
|---|---|---|
| GET | `/api/health` | none (only unauthenticated route) |
| GET | `/api/me` | any signed-in |
| GET/PATCH | `/api/users`, `/api/users/:id/role` | manageUsers |
| GET | `/api/items`, `/api/items/:id`, `/api/meta` | read |
| POST/PATCH/DELETE | `/api/items`, `/api/items/:id` | editCatalog |
| POST | `/api/items/:id/copies` | editCatalog |
| PATCH/DELETE | `/api/copies/:id` | editCatalog |
| PUT/DELETE | `/api/items/:id/rating` | rate |
| GET | `/api/export.json`, `/api/export.csv` | editCatalog |
| GET/POST | `/api/bgg/*` | editCatalog â€” **needs BGG_API_TOKEN** |
| GET | `/api/barcode/:code` | read â€” local + free rungs |
| POST | `/api/barcode/identify` | runResearch â€” the paid rung, slow |
| POST | `/api/barcode/link` | editCatalog â€” writes, contributes to GameUPC |
| POST | `/api/vision/identify` | runResearch â€” one box from a photo, ~3-5s |
| POST | `/api/vision/shelf` | runResearch â€” many spines, matched locally + GameUPC |
| GET/DELETE | `/api/cache` | manageUsers â€” cache stats and clearing |
| GET/POST | `/api/items/:id/relations` | read / editCatalog â€” standalone-but-related links |
| DELETE | `/api/relations/:id` | editCatalog |
| GET | `/api/wishlist` | read â€” **item-level**, not tree-level. See below |
| GET | `/api/covers/health` | read â€” dead cover images, for the banner |
| POST | `/api/covers/check` | editCatalog â€” force a check slice now |
| GET | `/api/items/:id/covers` | read â€” every printing's cover, selected one first |
| GET | `/api/items/:id/completeness` | read â€” what else exists for this game. Cached; never fetches |
| GET | `/api/components/status` | editCatalog â€” coverage, without a BGG call |
| POST | `/api/components/backfill` | editCatalog â€” sweep + classify. `?itemId=` `?calls=` `?force=` |
| POST | `/api/components/reclassify` | editCatalog â€” re-decide official/third-party from stored publishers, free |
| GET | `/api/editions/status` | editCatalog â€” items still awaiting printings |
| POST | `/api/editions/backfill` | editCatalog â€” fetch printings from BGG. `?itemId=`, `?limit=`, `?force=` |
| POST | `/api/editions/campaign` | editCatalog â€” record crowdfunding covers as printings |
| GET/POST | `/api/scan-jobs` | editCatalog â€” photo queue list and upload |
| GET | `/api/scan-jobs/:id` | editCatalog â€” single job detail |
| POST | `/api/scan-jobs/:id/enrich` | editCatalog â€” retry enrichment |
| POST | `/api/scan-jobs/:id/done` | editCatalog â€” mark reviewed, clean up photo |
| DELETE | `/api/scan-jobs/:id` | editCatalog â€” delete job and photo |

| GET | `/api/item-names` | read â€” every item's id/name/kind. The list `/api/items` **cannot** give you, because that one is paged |

`GET /api/items` accepts `q`, `status`, `kind`, `uncatalogued`, `duplicates`,
`gameSystem` and `page`, and answers with
`{ items, total, page, pageSize, pageCount }` â€” **not** `{ items }`. `total` is
every match, not the page. Page size is fixed at 25 on the server.

`GET /api/meta` answers `{ stats, gameSystems }`.

---

---

## Commands

```bash
npm run dev              # web :5173, worker API :8787
npm run typecheck        # every workspace
npm run build            # build the web app
npm run deploy           # build + deploy the Worker (refuses a dirty tree)
npm run db:migrate       # migrations â†’ production
npm run db:migrate:local # migrations â†’ local
npm run tail --workspace @bgc/worker

npx wrangler d1 execute board-game-catalog --remote --command "SELECT ..."
```

Verifying the two newest features against `npm run dev:worker` (no tokens
needed â€” the `DEV_EMAIL` bypass):

```bash
curl -s localhost:8787/api/wishlist                      # only `wanted` copies
curl -s "localhost:8787/api/items?status=wanted"         # whole trees â€” compare
curl -s -X POST "localhost:8787/api/covers/check?limit=40"   # force a check slice
curl -s localhost:8787/api/covers/health                 # what the banner reads
```

A cover needs to fail **twice** before `/covers/health` reports it, so run the
check twice before concluding it does not work.

**Local dev has seeded sample data** so the UI isn't empty. Production is
separate. Reset local:

```bash
rm -rf apps/worker/.wrangler/state/v3/d1 && npm run db:migrate:local
```

---
