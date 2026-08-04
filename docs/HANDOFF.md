# Handoff

Everything needed to continue or finish this without Claude.
**Last updated:** 2026-08-04, after multi-copy support and exports shipped.

---

## Live

| | |
|---|---|
| URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Deployed version | `323110d9-2042-4ae3-a681-246cbec91e93` |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` · `7dd22702-f0e2-4fc7-b201-d16d60176efa` · WNAM |
| Migrations applied | `0001_init`, `0002_copy_quantity` (local **and** production) |
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` |
| Access policy | **Everyone** — anyone may authenticate; the app decides who gets in |
| Login method | Email one-time PIN (Google SSO not configured) |
| Owner | `nbaslamking@gmail.com` (claimed on first sign-in) |

**Branch:** `phase-1-manual-catalog` — **not merged to main.** `main` is still at
`f80cc3a` (phase 0). The deployed code is this branch.

```bash
git checkout main && git merge phase-1-manual-catalog
```

---

## What works today

**Phase 0 — infrastructure.** Cloudflare Worker + D1 + Access. First person to
sign in against an empty user table becomes `owner`; everyone after lands as
`pending` and sees a holding screen. Decided in one SQL statement so concurrent
first sign-ins can't both win, and self-limiting once an owner exists.

**Phase 1 — the manual catalog.** Add/edit/delete items and copies. Browsing is
rooted on base games with expansions, promos and accessories nested underneath,
however deep. Filters match the *tree*, not the item, so searching an expansion
surfaces its base game too. Search covers names, publishers, designers. Filters:
status, location, type, nothing-recorded-yet, we-own-2+. Per-person ratings shown
side by side rather than averaged.

**People screen.** Owners see everyone who has signed in, with pending accounts
called out and one-tap promote/revoke. This is the guest list — it lives in the
app, not the Cloudflare dashboard.

**Multi-copy.** `copy.quantity` lets one row stand for several identical things;
separate rows still describe copies that differ. Both count toward the same
totals. `×N` flags, a duplicate strip per game, and a filter.

**Quick add.** Game + copy in one submit, focus stays in the name field,
location and status persist between entries. Built for working along a shelf.

**Exports.** `/api/export.json` (full fidelity) and `/api/export.csv` (one row
per copy). Owner-only.

---

## Blocked, waiting on you

### 1. BoardGameGeek token — phase 2

BGG closed its XML API in **July 2025**; registration and a bearer token are now
required. The client is written and token-aware; without the token every lookup
route answers 502 with an explanation and nothing else is affected.

1. <https://boardgamegeek.com/applications> → **Create New Application** →
   choose **non-commercial** (free). Approval is manual — *"it may be a week or
   more"*.
2. Then → **Tokens** → create one.
3. `npx wrangler secret put BGG_API_TOKEN`, and add it to `apps/worker/.dev.vars`.

Requirements already satisfied in code: `Authorization: Bearer <token>`, domain
`boardgamegeek.com` with **no** `www`, server-side requests only, week-long edge
cache.

### 2. Anthropic API key — ✅ in place locally

`ANTHROPIC_API_KEY` is set in `apps/worker/.dev.vars` and **verified working**:
a live call returned `model=claude-opus-5, stop_reason=end_turn`, and the
`web_search_20260209` tool with `allowed_domains` was accepted — that tool is
what enforces the official → crowdfunding → retail tier ordering, so the core
assumption of phase 3 is confirmed rather than assumed.

**Still needed for production:**

```
npx wrangler secret put ANTHROPIC_API_KEY
```

The deployed Worker does not read `.dev.vars`.

> ⚠️ The key was surfaced into a chat transcript by the IDE integration on
> 2026-08-04. Rotate it at <https://platform.claude.com/settings/keys> and paste
> the replacement directly into `.dev.vars`.

---

## Repo layout

```
packages/core/    constants.ts (leaf) → schemas.ts → capabilities.ts → index.ts
packages/db/      users, health, items, copies, ratings, import
packages/bgg/     BGG XML API2 client (throttled, retried, cached)
apps/worker/      Hono routes + Access JWT verification
apps/web/         React SPA, ~30-line router
migrations/       0001_init.sql, 0002_copy_quantity.sql
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
| GET/POST | `/api/bgg/*` | editCatalog — **needs BGG_API_TOKEN** |

`GET /api/items` accepts `q`, `status`, `location`, `kind`, `uncatalogued`,
`duplicates`.

---

## Commands

```bash
npm run dev              # web :5173, worker API :8787
npm run typecheck        # every workspace
npm run build            # build the web app
npm run deploy           # build + deploy the Worker
npm run db:migrate       # migrations → production
npm run db:migrate:local # migrations → local
npm run tail --workspace @bgc/worker

npx wrangler d1 execute board-game-catalog --remote --command "SELECT ..."
```

**Local dev has seeded sample data** so the UI isn't empty. Production is
separate. Reset local:

```bash
rm -rf apps/worker/.wrangler/state/v3/d1 && npm run db:migrate:local
```

---

## Gotchas found the hard way

- **`packages/core` has a load-bearing import order.** `constants.ts` is a leaf,
  `schemas.ts` imports it, `index.ts` re-exports both. **Nothing under `src/` may
  import from `index.ts`.** Breaking this reintroduces a circular import that
  makes `z.enum()` receive `undefined` and every write endpoint return 500 with
  a misleading "Cannot read properties of undefined". Typecheck does not catch it.
- **Migrate production before deploying**, so new code never meets an old schema.
- **`migrations_dir` goes inside `[[d1_databases]]`**, not at the top level of
  `wrangler.toml`. Wrangler silently looks in the wrong place.
- **Cloudflare mints one Access application per Worker URL** — production and
  preview have different AUDs, hence `CF_ACCESS_AUD` being a comma-separated list.
- **SQLite can't add a `CHECK` to an existing table** — `quantity >= 1` is
  enforced by triggers (migration 0002).
- **PowerShell mangles strings containing double quotes** when passing them to
  native executables, and rewriting files through it corrupts UTF-8. Use
  `git commit -F <file>` and edit files directly.
- **`$b` and `$B` are the same variable in PowerShell.** Cost me a confusing
  debugging detour.
- **wrangler on Windows sometimes prints success then exits 255** — a libuv
  teardown quirk. Read the output, not the exit code.
- **The browser extension has no permission for `*.workers.dev`**, so the live
  site can't be screenshotted through automation. Verify with `curl`.

---

## Next session — decided 2026-08-04

Two things to build, in this order. Both are unblocked; neither needs BGG.

### A. Barcode scanning (moved up from phase 5)

Decided approach: **scan → local match → LLM fallback → human confirm.**

1. `BarcodeDetector` where available (Android Chrome), ZXing wasm fallback for
   iOS Safari, which does not support it.
2. Look the UPC up against `edition.barcode` first — free, instant, works with
   no network. This is also how you find a game you already own while standing
   at the shelf.
3. On a miss, ask Claude with web search to identify the barcode, and present
   the answer as a **candidate to confirm**, never an automatic write. Barcode
   → game matching is genuinely unreliable; expect to fall back to typing the
   name a fair fraction of the time.
4. Every confirmed scan writes back to `edition.barcode`, so the collection
   becomes its own barcode database and the LLM is needed less over time.

Rejected: always asking the LLM (costs money for games already owned) and
local-only matching (useless for adding anything new, which is the point).

### B. Phase 3 — the research pipeline

See below. The key is verified and the web-search tool works.

**Note on scheduling:** cloud routines were considered and rejected — they run
in Anthropic's cloud with no access to this machine, so they cannot read the
API key, deploy to Cloudflare, migrate D1, or test on a phone. Work happens in
a local session instead.

---

## Phase 3, when the key is in

The design is `docs/DESIGN.md` §5. The shape that matters:

1. **Three tiers, three separate API calls** — official publisher, then
   crowdfunding, then retail. Separate calls keep provenance clean and let one
   tier be re-run alone.
2. **`allowed_domains` on the web-search tool enforces the ordering.** Tier 1
   sets it to the publisher's domain and nothing else, so the model *cannot*
   cite Amazon during the official pass. That's the difference between a prompt
   that asks nicely and a constraint that holds.
3. **Findings land in `research_finding`, never the catalog.** Each row carries
   source URL, tier and confidence; a human accepts or rejects. The tables and
   indexes already exist from migration 0001.
4. **Cost is the design constraint** — §8. Roughly $0.30–$1.00 per game for a
   full three-tier pass. Research must be an explicit per-item action with a
   tier picker, never automatic, and bulk runs must show an estimate first.
5. Model `claude-opus-5`, adaptive thinking, structured outputs so findings
   arrive already shaped for the staging table, and a cached system prompt
   since it's identical across every game.

Sleeve requirements deserve the cross-check described in §5: publisher, BGG and
sleeve-vendor charts agreeing → auto-accept; disagreeing → flagged with all
three values side by side.

---

## Not built

- Phase 2 UI (search-and-pick, paste-a-list, edition picker) — blocked on token
- Phase 3 research pipeline — blocked on key
- Phase 4 bulk CLI, phase 5 barcode scanning, phase 6 offline PWA
- Editions have a table and are populated by BGG import, but no UI
- `sleeve_requirement` has a table and no UI
- No automated tests — everything so far verified by exercising the running app
