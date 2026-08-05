# Handoff

Everything needed to continue or finish this without Claude.

Stable reference lives alongside this file and is not duplicated here:
[`access/`](access/README.md) (endpoints, key names, quotas) and
[`info/`](info/README.md) (how and why things work).
**Last updated:** 2026-08-05, after the barcode resolution ladder was built and
verified end to end against live services.

---

## Live

| | |
|---|---|
| URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Deployed version | `b818b57d-b480-47b2-b382-d2b1cea5beb9` — photo caching + index.html no-cache |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` · `7dd22702-f0e2-4fc7-b201-d16d60176efa` · WNAM |
| Migrations applied | `0001_init` … `0006_photo_cache` (local **and** production) |
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
status, type, nothing-recorded-yet, we-own-2+. Per-person ratings shown
side by side rather than averaged.

**People screen.** Owners see everyone who has signed in, with pending accounts
called out and one-tap promote/revoke. This is the guest list — it lives in the
app, not the Cloudflare dashboard.

**Multi-copy.** `copy.quantity` lets one row stand for several identical things;
separate rows still describe copies that differ. Both count toward the same
totals. `×N` flags, a duplicate strip per game, and a filter.

**Quick add.** Game + copy in one submit, focus stays in the name field,
status and quantity persist between entries. Built for working along a shelf.

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

### 1b. GameUPC production key — optional, improves barcode hit rate

Email **`gameupc@grettir.org`** asking for a `/v1` API key, then:

```bash
npm run secret GAMEUPC_API_KEY      # production
# and add GAMEUPC_API_KEY=... to apps/worker/.dev.vars for local
```

**Not blocking.** With no key set, `gameUpcConfig()` falls back to GameUPC's
public `test` stage using their published demo key
(`test_test_test_test_test`), which is what every measurement above was taken
against. The `test` stage's data is *wiped periodically*, so a barcode that
resolved yesterday may miss today — that is the cost of not having the key, and
it is why a miss should never be treated as an outage.

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
packages/core/    constants.ts (leaf) → schemas.ts → barcode.ts → capabilities.ts → index.ts
packages/db/      users, health, items, copies, ratings, import, barcodes
packages/bgg/     BGG XML API2 client (throttled, retried, cached)
packages/barcode/ free barcode resolution: gameupc.ts, upcitemdb.ts, resolve.ts
packages/research/ Claude calls: client.ts, barcode.ts (the paid rung)
apps/worker/      Hono routes + Access JWT verification
apps/web/         React SPA, ~30-line router
migrations/       0001_init.sql, 0002_copy_quantity.sql, 0003_barcode_unique.sql,
                  0004_trim_copy_fields.sql (not yet applied)
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
| GET | `/api/barcode/:code` | read — local + free rungs |
| POST | `/api/barcode/identify` | runResearch — the paid rung, slow |
| POST | `/api/barcode/link` | editCatalog — writes, contributes to GameUPC |
| POST | `/api/vision/identify` | runResearch — one box from a photo, ~3-5s |
| POST | `/api/vision/shelf` | runResearch — many spines, matched locally + GameUPC |

`GET /api/items` accepts `q`, `status`, `kind`, `uncatalogued`, `duplicates`.

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
- **A cached `index.html` pins a phone to a previous deploy.** It names the
  content-hashed bundles, so Safari serving a stale copy kept loading old
  JavaScript while the new assets sat there unused — the symptom is "I deployed
  a fix and the phone still shows the old behaviour". Fixed in two places:
  `apps/web/public/_headers` (`no-cache` on index.html, `immutable` on /assets/*)
  and the Worker's SPA fallback, which now sets `Cache-Control: no-cache` on the
  index.html it hands back. On iOS a pull-to-refresh does **not** clear it —
  close the tab and reopen.
- **The browser extension has no permission for `*.workers.dev`**, so the live
  site can't be screenshotted through automation. Verify with `curl`.
- **The Anthropic API can return a transient `400 "Invalid request data"`.**
  Observed once on a request shape that then passed 15/15 identical retries.
  The SDK does **not** retry 400s, so it surfaces as a hard failure. Don't spend
  an hour bisecting a schema before re-running it — `/api/barcode/identify`
  returns `retryable: true` for exactly this.
- **GameUPC says "no idea" as the literal string `"None"`**, not `null` or an
  absent field. Passing it through puts the word "None" in front of the user.
- **GameUPC returns every BGG version, not the matching one.** Catan came back
  with 136; taking `versions[0]` labelled a US retail scan "Arabic/English
  edition". Only name a printing when there is exactly one.
- **Never strip the publisher name from a retail title.** In this hobby the
  brand often *is* the game — stripping "CATAN Studio" turned
  "Catan 5-6 Player Extension" into "Asmodee Extension". A redundant word costs
  a search nothing; a missing title costs it everything.
- **UPCitemdb's free quota is per IP.** A Worker is one IP for every user, so
  100/day is a whole-app budget, not per-person. It is deliberately only called
  after GameUPC misses.
- **A quoted heredoc (`<<'EOF'`) still ate backslashes** in this Git Bash,
  corrupting regexes in throwaway scripts. Write scratch files with the editor,
  not the shell.

---

## Barcode scanning — backend done and verified end to end

The previous stop point is cleared: everything typechecks, and every rung of the
ladder has been exercised against live services.

**Root cause of the old breakage:** `packages/research` pinned
`@anthropic-ai/sdk` at 0.65.0, which predates `output_config` *and* the current
`web_search_20260209` tool. Upgraded to 0.115.0; all 7 workspaces typecheck.

### The ladder, cheapest rung first

| Rung | Where | Cost | Latency |
|---|---|---|---|
| local `edition.barcode` | `packages/db/src/barcodes.ts` | free | instant, offline |
| **GameUPC** | `packages/barcode/src/gameupc.ts` | free, 100 new UPCs/day | ~1s |
| **UPCitemdb → GameUPC search** | `packages/barcode/src/upcitemdb.ts` | free, 100/day **per IP** | ~2s |
| Claude + web search | `packages/research/src/barcode.ts` | ~$0.009 + search fee | **74–137s** |

`packages/barcode/src/resolve.ts` runs rungs 2–3 and returns a `trace` of what
actually happened. Every rung answers in the one shared shape,
`BarcodeCandidate` in `packages/core/src/barcode.ts`.

**Measured hit rate on four real games** (Catan, Wingspan, Wingspan: European
Expansion, Brass: Birmingham): GameUPC alone got 2/4. Adding the UPCitemdb →
GameUPC-search rung took it to **4/4, entirely free**. The LLM rung is a rare
fallback, not the main path — which matters because it takes over a minute.

### GameUPC is worth understanding

Crowdsourced UPC → BoardGameGeek-ID map, free, and the only board-game-native
barcode database that exists. It answers with a **BGG id**, which is the same
identifier the import path already speaks. `POST {update_url}` contributes a
confirmed match back, so the shared database grows — `/api/barcode/link` does
this automatically, keyed by a **SHA-256 hash of the user's email**, never the
address itself.

### Routes

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/api/barcode/:code` | `read` | Local + all free rungs. `read`, not `editCatalog` — checking whether you already own something is browsing |
| POST | `/api/barcode/identify` | `runResearch` | The paid rung. Separate route so nobody waits 2 minutes by accident |
| POST | `/api/barcode/link` | `editCatalog` | The only route that writes. Contributes back to GameUPC after |

### Verify it

```bash
npm run dev:worker
curl -s localhost:8787/api/barcode/029877030712   # Catan -> verified, BGG id 13
curl -s localhost:8787/api/barcode/635405670338   # Brass -> rescued by rung 3
curl -s localhost:8787/api/barcode/029877030713   # bad check digit -> 400
```

### Not started

- The scanner UI (`BarcodeDetector` + ZXing wasm fallback for iOS Safari)
- Shelf mode / camera vision (discussed, not begun — see "Next session")
- All of phase 3

### Also outstanding

- **No secrets are set in production at all** — `npm run secret:list` returns
  `[]` (checked 2026-08-05, just before the scanner deploy). Consequences on the
  live site right now:

  | Mode | Live? | Why |
  |---|---|---|
  | Barcode scan | ✅ works | Local + GameUPC `test` stage + UPCitemdb are all free and keyless |
  | One box (photo) | ❌ 503 | Needs `ANTHROPIC_API_KEY` |
  | Whole shelf | ❌ 503 | Needs `ANTHROPIC_API_KEY` |
  | BGG hydration | bypassed | Needs `BGG_API_TOKEN`; by design, degrades rather than breaks |

  ```bash
  npm run secret ANTHROPIC_API_KEY   # interactive — a human must run this
  ```

  ⚠️ **Rotate the key first.** It was surfaced into a chat transcript on
  2026-08-04 (see the Anthropic section above). Generate a new one at
  <https://platform.claude.com/settings/keys>, then set it in **both**
  `apps/worker/.dev.vars` and production.
- ✅ **Migration `0003_barcode_unique.sql` is applied to local and production**
  (2026-08-05). Verified in production by reading back `sqlite_master`:
  `CREATE UNIQUE INDEX idx_edition_barcode ON edition(barcode) WHERE barcode IS
  NOT NULL AND barcode != ''`. Production held 0 editions at the time, so there
  was nothing to de-duplicate first.
- Root `package.json` gained `npm run secret` / `npm run secret:list`, which run
  wrangler against `apps/worker/wrangler.toml` — running `wrangler secret put`
  from the repo root fails with "Required Worker name missing".

---

## ⚠️ Decisions waiting on the owner

### Grouping / family model — owner wants to discuss before catalog UI work

Raised 2026-08-05. The requirement:

- **Catan + Catan: Seafarers** → one entry. Seafarers must not appear as a
  separate game.
- **Catan: Starfarers** → its own entry, because it is standalone.
- **But Starfarers still keeps a relational tie back to Catan.**

**The schema cannot express this today.** `item` has exactly one relationship —
`parent_item_id`, with `root_game_id` denormalized. That models *containment*
and nothing else, so an item is either nested (and invisible as its own game) or
a root (and unrelated to anything). There is no third option, which is precisely
what Starfarers needs.

Two relationships are actually in play, and conflating them is the bug:

| Relationship | Example | Behaviour |
|---|---|---|
| **requires** | Seafarers → Catan | Nest. Not a separate entry |
| **related to** | Starfarers → Catan | Own root entry, plus a visible link |

The clean discriminator is **"can you play it without the base game?"** —
checkable, and it maps 1:1 onto nest-vs-link.

Sketch (not built, not agreed):

- Add `item_relation(from_item_id, to_item_id, relation)` where `relation` is
  something like `standalone_expansion_of` / `reimplements` / `integrates_with`.
  Directional, and it survives either item being deleted independently.
- Add a `standalone` flag (or a `standalone_expansion` kind) so import knows
  which branch to take.
- This aligns with how BGG already models it — `boardgameexpansion`,
  `boardgameintegration`, `boardgameimplementation` are separate link types on
  the `/thing` response the client already parses — so BGG import could populate
  it rather than needing hand-entry.

**Ratings — decided 2026-08-05.** Every entry keeps its own rating; Seafarers
might be a 3 while Catan base is a 5, and flattening that loses the most useful
thing the catalog knows. On top of the per-entry scores, show a **family score**.
So three numbers are visible: base game, expansion, family.

Per-person ratings already work this way (`rating` is keyed on item + user), so
the per-entry half needs no schema change — only the family roll-up is new, and
it is derived, not stored.

Still open for that conversation:

- **How is the family score computed?** A plain mean lets one poor accessory drag
  a great game down, which is wrong. Options: weight the base game heavier;
  average only `base` + `expansion` and ignore accessories/promos; or treat it as
  its own rating people give explicitly ("how good is Catan *as a whole*").
  Recommend deriving it with base-weighting first — no schema change, and it can
  become explicit later if it feels wrong.
- Does the `duplicates` filter treat a family as one thing, or per-entry?
- Does search surface the family or the individual entries?

### Shelf mode / camera vision

Approved 2026-08-05, in progress. See "Next session → A2" below.

---

## Next session — decided 2026-08-04, revised 2026-08-05

Two things to build, in this order. Both are unblocked; neither needs BGG.

### A. Barcode scanning — backend ✅ done, UI still to build

The original plan was **scan → local → LLM → confirm**. Research on 2026-08-05
found two free rungs that belong between local and the LLM, so the shipped
design is **local → GameUPC → UPCitemdb → LLM → confirm**. That took the
measured hit rate from 2/4 to 4/4 without spending anything, and demoted the
2-minute LLM call to a rare fallback. Details in the barcode section above.

Still to build: the scanner UI. `BarcodeDetector` where available (Android
Chrome), ZXing wasm fallback for iOS Safari, which does not support it. Present
every result as a **candidate to confirm**, never an automatic write. Confirmed
scans write back to `edition.barcode` *and* to GameUPC.

Rejected: always asking the LLM (costs money and two minutes for games already
owned) and local-only matching (useless for adding anything new, which is the
point).

### A2. Camera / vision — proposed 2026-08-05, awaiting a decision

The insight worth keeping: **barcodes are a weak primitive for board games.**
Half the sample had no usable barcode record anywhere, Kickstarter and
small-publisher editions frequently have none at all, and the barcode is often
on shrink-wrap that is long gone. The title, meanwhile, is printed on the box in
40-point type.

Ideas, ranked:

1. **Shelf mode.** One photo of a row of spines → Claude returns every title it
   can read → tick a checklist. Turns 40 games into ~4 photos. ~$0.005/photo at
   1024px. Barcode is precision for one item; a shelf photo is recall for many.
   Pairs with the existing `uncatalogued` filter as the follow-up worklist.
2. **Photograph the cover, not the barcode.** Degrades gracefully — a partial
   read still yields a name to confirm.
3. **Capture the video frame alongside the barcode**, so a barcode miss already
   has an image for vision fallback with no second interaction.
4. **Batch capture, deferred processing** (IndexedDB queue, one review screen).
   Never block on network — these boxes live in a basement.
5. ~~Store the cover photo on the copy (R2)~~ — **demoted to opt-in only.** See
   the transience requirement below.

**Photos must be self-contained (owner requirement, 2026-08-05).** No captured
photo may land in the iPhone's camera roll — nobody wants a photo library full
of pictures only one app needed. The same logic applies server-side: capture into
memory, send, read, discard. Nothing in D1, nothing in R2 unless the owner
explicitly asks for a cover image on a specific copy.

This makes `getUserMedia` + canvas the *primary* capture path rather than a
fallback, since it provably writes nothing to Photos. Whether
`<input type="file" capture>` also avoids the camera roll on iOS is being
verified — if it does not, that fallback is out entirely.

Known limits, so nobody oversells it: stylized spine typography misreads, you
get a title only (no edition/printing), and base-vs-expansion is unreliable from
a spine. Downscale to ~1024px long edge on-device — 4× cheaper, no accuracy loss
for reading a title.

Rejected: on-device OCR (Tesseract.js). Board game cover typography is stylized
and OCR does badly on it; the vision call is cheap enough that shipping a wasm
blob isn't worth it.

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
