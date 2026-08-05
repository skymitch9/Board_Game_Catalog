# Handoff

Everything needed to continue or finish this without Claude.

Stable reference lives alongside this file and is not duplicated here:
[`access/`](access/README.md) (endpoints, key names, quotas) and
[`info/`](info/README.md) (how and why things work).
**Last updated:** 2026-08-06. Everything is committed and deployed; the working
tree is clean. Database was cleared and collection restarted fresh on 08-05.

**Newest first:** the [cover picker](#the-cover-picker--built-2026-08-06) —
printings, and choosing which one's artwork represents our copy. Before that,
the [wishlist](#the-wishlist--built-2026-08-06) and
[cover-image health](#cover-image-health--built-2026-08-06). If you read one
thing from those, read why a dead BoardGameGeek image answers **400 and not
404** — the check is a no-op without it.

---

## Working tree — clean

Nothing is in flight. The most recent commits:

| Commit | What |
|---|---|
| `6eb0c8e` | Cover-link health check, cron and banner |
| `ce03a8f` | The wishlist — item-level, not tree-level |
| `227f7d0` | `item.source_url` |
| `0e61948` | The add restructure, item relations and the photo queue — all of it |
| `43bbf39` | Negative lookup results are actually read back from the cache now |
| `d0f2d4c` | The queue polls itself; photos are released as soon as vision is done |

`0e61948` is worth understanding as a process note rather than a code one: that
work was **deployed straight from the working tree before it was committed**,
so for a while production was running code with no commit behind it and no
rollback point. It is committed as one unit because that is what actually went
out. Don't repeat the pattern — commit, then deploy.

**The pipeline is verified end to end — against local dev, not a phone.**
Exercised over curl on 2026-08-05 with `npm run dev:worker` (the `DEV_EMAIL`
bypass in `middleware/auth.ts` means no Access and no tokens are needed; a
Cloudflare *service token* would not work anyway, because `auth.ts` requires an
`email` claim and service-token JWTs carry `common_name`). What was confirmed:

| Checked | Result |
|---|---|
| Upload → vision → enrich → review | Reached `review` in ~8s |
| Vision accuracy | Read all 5 synthetic spines, all `high` confidence |
| Free lookups | Resolved all 5 to correct BGG ids, and normalised the caps |
| Photo released on success | No blob in the local R2 store afterwards |
| Photo released on failure | Forced a vision failure; still no blob |
| Negative lookups cached | A true negative's `created_at` does **not** refresh on a repeat run, so it is read from cache rather than re-resolved — the `43bbf39` fix works |

Production is still untouched: `scan_job` holds 0 rows and `bgc-photos` holds 0
objects. **The phone half remains unverified** — nothing here exercised iOS
Safari, which is where the camera-roll decode failure lives.

### Doubtful lookup matches — fixed, and worth understanding

The free databases match on a *single word*, so a title they do not know comes
back as whatever shared one, complete with a real BGG id, year and cover art.
Five of six invented titles resolved to a confident wrong game, and the review
list pre-selected every one.

Weak matches are now shown but left unticked (`MIN_SPINE_SIMILARITY`), and
ticking one adds **only the title** — id, publisher, year and thumbnail are
dropped, since confirming a game is on your shelf is not confirming it is that
other game. The single-box path rejects outright instead, because the model has
already read the box and a loose match can only make that worse.

**Two thresholds on purpose**, in `packages/core/src/barcode.ts`:

| Constant | Value | For |
|---|---|---|
| `MIN_TITLE_SIMILARITY` | 0.34 | A name a person typed and asked us to look up. Forgiving: "Azul" vs "Azul (Nordic edition)" is 0.5 and should still fill |
| `MIN_SPINE_SIMILARITY` | 0.7 | Unattended matching of text read off a photograph |

**The gotcha that cost the first attempt:** reusing 0.34 for spine matching
catches nothing. A one-word fragment of a two-word title scores
`2*1/(1+2) = 0.67` *every time* — "Quandary" for "Zorblax Quandary", "Rift" for
"Nurdleton Rift" — while genuine reads score 1.00. The two populations sit at
0.67 and 1.00 with nothing between, which is where 0.7 comes from. Do not lower
it without re-measuring; the fix looks correct at 0.34 and does nothing.

### ⚠️ Open question: should the photo go to R2 at all?

**Nothing ever reads it back.** There is no `PHOTOS.get` in the repo. Vision
gets the base64 straight from the request in memory, enrichment works from
`raw_titles`, and the review screen never displays the image. The bucket was
write-only storage whose entire purpose was to be deleted later.

It is now released the moment vision finishes rather than at review, so it
lives for seconds instead of indefinitely — but the honest options are:

1. **Drop R2 from this path entirely.** `photo_key` becomes vestigial, the
   binding goes, and the transience requirement is satisfied by construction
   rather than by remembering to delete. Simplest, and matches what the code
   actually does today.
2. **Keep it, and give it a reader.** Justifiable if review should be able to
   show you the photo a title came from, or if a failed job should be
   re-runnable without walking back to the shelf. Both are real features;
   neither exists.

Do not split the difference by leaving it as-is — write-only storage that must
be cleaned up by hand is the shape that caused the leak in the first place. Also worth a look: four tabs across a narrow screen is tight, so at ≤560px
the blurbs are hidden and the labels drop to 0.78rem ("Whole shelf" sets the
size).

---

## Live

| | |
|---|---|
| URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Deployed version | `45b4d2d2-5f47-4e58-ab48-21ea3ceda87b` — wishlist + cover health (2026-08-06) |
| Cron triggers | `*/30 * * * *` — the cover check. Confirmed registered in the deploy output |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` · `7dd22702-f0e2-4fc7-b201-d16d60176efa` · WNAM |
| R2 bucket | **none** — `bgc-photos` still exists in the account but is unbound and empty |
| Migrations applied | `0001_init` … `0014_edition_source` (local **and** production) |
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` |
| Access policy | **Everyone** — anyone may authenticate; the app decides who gets in |
| Login method | Email one-time PIN (Google SSO not configured) |
| Owner | `nbaslamking@gmail.com` (claimed on first sign-in) |

**Branch:** merged. `main` now holds all 38 phase-1 commits (merge `ab057d9`),
and typechecks. `phase-1-manual-catalog` still exists and is unchanged.

**Pushed.** `origin` is
<https://github.com/skymitch9/Board_Game_Catalog.git> and `origin/main` is up to
date as of 2026-08-06 (`6eb0c8e`). An earlier version of this document said
nothing had ever been published; that stopped being true on 08-06.

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
Now the **Manually** tab of `/scan` rather than a panel on the collection page.

**Scanning — confirmed working on a real iPhone (2026-08-05).** Modes at
`/scan`: **barcode** (wasm decode — `BarcodeDetector` does not work on iOS),
**one box** (vision reads the title off the cover, 3–5s), **whole shelf** (reads
every spine, returns a tick-list marking what you already own). Auto-capture
fires when the phone stops moving. Nothing reaches the camera roll.

Verified end to end on device: scan an unknown barcode → resolves through the
free rungs → add it → re-scan returns "already in your collection" instantly
from the local table. The write-back loop works.

**Exports.** `/api/export.json` (full fidelity) and `/api/export.csv` (one row
per copy). Owner-only.

**Item relations (2026-08-05).** Standalone games that belong together without
nesting — Dice Throne characters, Unmatched fighters, standalone expansions.
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
from camera or gallery). Each photo becomes a job: vision reads titles →
free lookups enrich (GameUPC, collection match, classification) → lands in
"Ready for review" status. Review page shows the same kind/parent UI as the
shelf scan. Jobs tracked in `scan_job` table; photos stored temporarily in R2
(`bgc-photos` bucket) and deleted after review. No photo ever reaches the
camera roll or persists beyond the review step.

**Expansion picker (2026-08-05).** On the "Add to this game" page
(`/items/new?parent=N`), shows known titles from the free lookup services for
that parent game's name. Picking one pre-fills the form. When BGG token arrives,
this will use BGG's expansion links for definitive results.

**Header stats (2026-08-05).** Shows `N games · N expansions · N accessories`
(only non-zero counts), replacing the old `games · items · owned`.

---

## The wishlist — built 2026-08-06

`/wishlist`, linked from the top bar. Lists every copy marked `wanted`, with a
**Mark as bought** button per row that flips that copy to `owned`.

**The one thing to understand before touching it.** Every other listing query
matches whole game *trees*, via `matchingRootsSql` in `packages/db/src/items.ts`,
so that searching for an expansion also surfaces the base game it needs. That is
correct for browsing and exactly wrong for a shopping list: the Ark Nova tree
holds two `wanted` items sitting alongside eight `preordered` 3D upgrades, so
`GET /api/items?status=wanted` answers with **all ten**. Measured, not assumed.

`listWishlist` is therefore a query of its own and `matchingRootsSql` was not
touched. One row per wanted copy, joined to the parent item so "Marine Worlds"
reads as an Ark Nova expansion.

| Piece | Where |
|---|---|
| `WishlistEntry` type | `packages/core/src/schemas.ts` |
| `listWishlist` | `packages/db/src/items.ts` |
| `GET /api/wishlist` | `apps/worker/src/routes/catalog.ts` |
| `api.wishlist()` | `apps/web/src/api.ts` |
| The page | `apps/web/src/pages/WishlistPage.tsx` |

- **`preordered` is excluded on purpose.** Something already bought and waiting
  for the post is a different question from what to buy next. If that turns out
  to be wrong, the fix is one `WHERE` clause — but change the page's wording too,
  because "2 games wanted" would stop being true.
- **There is no wishlist-specific write route.** "Mark as bought" is the ordinary
  `PATCH /api/copies/:id` the item page's copy editor already calls. Resist
  adding one; a second way to change a copy's status is a second one to keep
  correct.
- **The header stat on the collection page counts something else.**
  `collectionStats.wantedCopies` sums `wanted` **+** `preordered`, so it reads
  10 where the wishlist reads 2. That is why the count was deliberately *not*
  linked to `/wishlist` — the numbers would visibly disagree. Splitting the stat
  in two is the honest fix if it ever matters.

---

## Cover-image health — built 2026-08-06

Nothing here hosts a cover. Every `item.thumbnail_url` is a hotlink to
BoardGameGeek (`cf.geekdo-images.com`), Kickstarter or Gamefound
(`ksr-ugc.imgix.net`), none of whom owe us a stable URL. When one stops serving,
the failure is silent — the card renders, the image slot is empty, and nobody
re-opens a game they already catalogued.

A cron probes a slice of the catalog every half hour and writes verdicts down; a
banner appears when something is confirmed dead.

| Piece | Where |
|---|---|
| `cover_check` table | migration `0013_cover_check.sql` |
| Reads/writes | `packages/db/src/covers.ts` |
| The probing | `apps/worker/src/lib/cover-check.ts` |
| Routes | `apps/worker/src/routes/covers.ts` |
| Cron trigger | `[triggers] crons = ["*/30 * * * *"]` in `apps/worker/wrangler.toml` |
| `scheduled` handler | `apps/worker/src/index.ts` — three lines, delegates to the lib |
| The banner | `apps/web/src/components/CoverHealthBanner.tsx`, mounted in `App.tsx` |

**Keyed on the URL, not the item.** Several items share one image, and fetching
per item would multiply requests against the very CDNs we want to stay friendly
with. The item is recovered by joining `item.thumbnail_url = cover_check.url`,
which also means a cover that gets *fixed* simply becomes an unknown URL and is
re-checked, with no invalidation step to forget.

**Rotation, because of the subrequest ceiling.** 20 URLs per invocation
(`COVER_BATCH`), oldest-checked first, never-checked first of all. Every half
hour is ~960 probes a day against ~450 distinct covers — roughly two full passes.
A URL can cost two subrequests when HEAD is refused and the ranged
`GET Range: bytes=0-0` fallback runs, so the worst case is 40, inside the free
plan's 50.

**Two failures before anyone is told** (`DEAD_AFTER`), and five for failures that
never produced a status code at all (`UNREACHABLE_AFTER`) — a timeout says
something about the network, not about the file.

### ⚠️ The gotcha that would have made this useless

**`cf.geekdo-images.com` answers a dead path with `400`, never `404`.**

Verified three ways on 2026-08-06: a nonsense path, a real path with a wrong
picture id, and a real picture id behind a wrong signature all returned **400
Bad Request**. `ksr-ugc.imgix.net` returns **410** for a removed asset, which is
conventional; BGG is not.

So `PERMANENT` in `cover-check.ts` is `{400, 404, 410, 414}` — the codes that
mean *the URL itself* is permanently unacceptable. **Do not "tidy" 400 out of
that set.** The first version of this check treated 400 as transient, ran over
the whole local catalog, and reported zero dead covers while staring straight at
one. Since almost every cover in the collection is a geekdo URL, dropping 400
turns the entire feature into a no-op that looks like it is working.

`401`, `403`, `405` and `429` are deliberately *not* in the set: those are about
the client, and are far more often a CDN objecting to a Worker than a missing
file. The probe also sends a browser-ish `User-Agent` for the same reason.

**Verified end to end against local dev (2026-08-06).** Two known-bad covers were
seeded — a geekdo path returning 400 and an imgix path returning 410 — alongside
67 real BGG covers. First pass: 78 ok, 2 recorded as `dead`, and
`/api/covers/health` reported **`dead: 0`** — the one-failure-is-not-enough rule
holding. Second pass: both surfaced with the right codes and
`consecutiveFailures: 2`, and every real cover passed both times.

> **Local dev still carries those two bad rows on purpose** — item 111
> ("Ark Nova", a fake geekdo path) and item 121 ("Gamefound Pledge Test Game").
> They are why the banner shows locally. Delete both items if you want a quiet
> local app; production is unaffected.

---

## The cover picker — built 2026-08-06

In the edit form, a grid of every cover this game could wear. Click one, Save
changes, done.

**The idea that made it one feature instead of three.** The ask was "let me swap
between the BoardGameGeek image and the Kickstarter one" *and* "for games with
several printings, let me see covers from multiple years". Those are the same
question: an item has several known printings, each printing has a cover, and
one of them looks like the box on our shelf. A crowdfunding edition **is** a
printing — it belongs in the grid beside the 2019 and 2023 retail ones, not
behind a Kickstarter-shaped button of its own.

**Almost none of this was new.** The `edition` table has existed since migration
0001 (`item_id`, `bgg_version_id`, `name`, `year`, `publisher`, `language`,
`image_url` — one row per printing). `packages/bgg/src/client.ts` has always
requested `versions=1` and parsed them. `importItem` has always inserted them.
The table held **0 rows** because the catalog was populated by
`POST /api/bgg/match/:id` and direct pledge inserts, and neither writes
editions. The machinery was built and then bypassed. What was actually missing
was a backfill, a read, and a grid.

| Piece | Where |
|---|---|
| `source` column + idempotency indexes | migration `0014_edition_source.sql` |
| Insert, read, campaign naming | `packages/db/src/editions.ts` |
| The BGG fetching | `apps/worker/src/lib/edition-backfill.ts` |
| Backfill routes | `apps/worker/src/routes/editions.ts` |
| `GET /api/items/:id/covers` | `apps/worker/src/routes/catalog.ts` |
| The grid | `apps/web/src/components/CoverPicker.tsx` |
| Mounted in the edit form | `apps/web/src/components/ItemForm.tsx` (`coverPicker` slot) |

### Two backfills, both re-runnable

```bash
curl -s -X POST localhost:8787/api/editions/backfill            # BGG printings
curl -s -X POST "localhost:8787/api/editions/backfill?itemId=42"  # just one game
curl -s -X POST localhost:8787/api/editions/campaign            # crowdfunding covers
curl -s localhost:8787/api/editions/status                      # what is left
```

**Routes, not a script, because both need re-running.** Items keep gaining a
`bgg_id` from scans and manual matching, and each new one has printings nobody
has asked about. Covers are still being written by other processes, and a
campaign cover only survives a swap if it was recorded first.

Idempotency is in the database, not in the callers: migration 0014 adds a unique
index on `(item_id, bgg_version_id)` for BGG rows and on `(item_id, image_url)`
for campaign rows, which have no version id and are identified by the image
itself. Re-running either backfill is a cheap no-op.

**Ten BGG ids per request.** `things()` takes a comma-separated list, which is
the only reason a whole-catalog run fits in one Worker invocation: 66 local items
cost **7 requests and 7.1 seconds**. The free plan allows 50 subrequests, and
the client retries a `202 Accepted` up to four times, so `BACKFILL_LIMIT = 80`
(8 batches, worst case 40 subrequests). Raise it and redo that arithmetic.

**The one place it can stall.** "Printings not fetched yet" is inferred from the
absence of any `source = 'bgg'` row, so a game BoardGameGeek genuinely lists no
versions for is re-asked every run. That is deliberate — remembering the
negative would mean writing a fake edition row, and a fake printing would show
up in the picker. It costs one slot in a batch of ten, and
`/api/editions/status` makes a stall visible.

### Picking writes through the ordinary item PATCH

The picker sets the **form's** image URL; Save writes it. It does not PATCH on
click, and that is not squeamishness — the form holds `thumbnailUrl` in its own
state, so an immediate write would have been silently reverted by the Save that
followed it. There is no cover-specific write route, for the same reason there
is no wishlist-specific one.

### Coverage is uneven on purpose, so the empty cases say why

- **Several** — the good case, ~44 of 63 local items with any edition image.
- **Exactly one** — says so, rather than offering a pointless grid of one.
- **None** — explains which reason applies: never matched to BoardGameGeek
  (most pledge accessories, and always will be), printings fetched and BGG lists
  none, or nobody has asked yet — in which case a **Look up printings** button
  appears and asks about that one game.
- **A candidate that will not load** — two independent ways to know. `cover_check`
  supplies a verdict before the image is requested, reusing `DEAD_AFTER` /
  `UNREACHABLE_AFTER` so the picker cannot call something dead on weaker grounds
  than the banner; the browser's own `onError` catches everything the checker has
  not reached. Either way the slot reads "Image no longer loads" instead of
  rendering an empty box under a caption.

> **Local dev carries one deliberate broken candidate**: item 36 ("Veiled Fate")
> was given a Gamefound `source_url` and a nonexistent `test-cover.png` while
> testing the campaign naming, so its campaign card shows the failure state.
> Alongside the two bad covers from the health work (items 111 and 121).
> Production is unaffected.

**Verified end to end against local dev, 2026-08-06.** Ticket to Ride (item 42,
BGG 9209) went from 1 candidate to 40 printings in one BGG call, with the cover
already on the item correctly recognised as the 2025 English edition rather than
duplicated as an unattached "Current cover". A full run: 66 items, **687
editions, 7 calls, 7.1s**, and an immediate re-run added nothing. Swapping item
36 from its campaign cover to the BGG one left the campaign printing in the list,
still offerable — which is the whole point of recording it.

---

## Orphan expansions — built 2026-08-05

An expansion can now be catalogued before the game it belongs to. Previously it
could not: `createItem` demanded a parent and `createItemSchema` refused without
one, so both add flows silently saved it as a **base game** — a root in the
tree, counted in the header stats, with no record it was ever an expansion.
Scanning the base game later reconciled nothing.

| Piece | Where |
|---|---|
| `pending_parent_name` column | migration `0010_pending_parent.sql` |
| Orphan allowed, roots itself | `createItem`, `packages/db/src/items.ts` |
| Re-parenting on arrival | `adoptOrphans`, same file |
| Runs after every creation | `POST /api/items` returns `{ item, adopted }` |
| Name kept from the spine | `inferredParentName`, `classifyShelfResults` |
| Shown as unattached | `ItemTree.tsx` badge |

**Why it roots itself.** Every listing query selects `WHERE root_game_id IN
(...)`, so an orphan with a null root would be invisible rather than
unattached. It is its own root until adopted, exactly like a base game.

**Adoption matches on normalised name, not BGG id** — an orphan read off a
spine usually has no id, which is the situation that produced it. The whole
subtree moves, so an accessory filed under a waiting expansion travels with it.

Verified end to end against local dev: orphan created with kind intact,
accessory nested beneath it, both visible as an unattached root, then the base
game created — adopted, re-parented, subtree moved, pending name cleared.

**Still open:** adoption only triggers on *creation*. Renaming an existing game
to match a waiting orphan does not adopt it, and neither does an import. If
that matters, `adoptOrphans` is already the right shape to call from `updateItem`.

---

## Related games — the standalone/nested question, answered per game

`/retag` ("Related games" on the collection) lists every top-level game whose
name contains another game you own, and asks the one question that decides it:
**can you play this without the other box?**

- **Standalone** → writes an `item_relation` and leaves the game where it is.
- **File under** → sets kind and parent, nesting it.

The heuristic finds the pairs and refuses to pick. It cannot: "Scythe: Invaders
from Afar" and "CATAN: Starfarers" are structurally identical, and one is an
expansion while the other is a whole game. Only names containing "expansion" or
"extension" outright are marked confident. This is the Catan / Seafarers /
Starfarers question from the original design discussion, and it needed no new
schema — `item_relation` already existed.

Parent matching takes the **longest** owned prefix, not the first. "Catan:
Starfarers – 5-6 Player Extension" contains both "Catan" and "Catan:
Starfarers"; the first-colon rule filed it under Catan while looking correct.
Separators include the en and em dashes publishers actually use.

## Filling in blanks — `/details`

A queue of every game missing publisher / year / players / playing time /
description, working down the list one at a time with a running cost, stoppable
mid-run. Per-game, the item page offers **Free lookup** (the scanner's sources)
beside **Search the web** (Claude, ~1.4¢, owner-only). Kept separate rather
than chained, because the free one is right often enough that paying for every
blank would be waste.

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

### 1c. Phase 3 is built — and here is what unblocked it

The research pipeline (`packages/research/{tiers,research}.ts`,
`apps/worker/src/routes/research.ts`) is written and typechecks. Three tiers,
three separate calls, `allowed_domains` enforcing the ordering. Findings land
in `research_finding` for review and are **never applied** — that step is
deliberately not built.

**The official tier needs a publisher domain**, taken from the item's
`publisherUrl`, and refuses to run without one rather than quietly searching
the open web. That was a universal blocker: GameUPC carries no publisher at all
(`packages/barcode/src/gameupc.ts:179`), so every scanned game had an empty
field and tier 1 could not run on anything.

`packages/research/src/enrich.ts` fixes that. It asks Claude with the open web
for the dull box-facts — publisher, their site, year, players, playing time,
description — at `effort: low`, ~1.4 cents a game measured. Verified end to
end: a bare "Wingspan" came back Stonemaier Games / stonemaiergames.com / 2019
/ 1–5 players / 90 min, and the research plan for that item then reported
`official RUNNABLE` against `stonemaiergames.com`.

It fills **gaps only** — a second run over the same game changes nothing.

| Route | Does |
|---|---|
| `GET /api/research/needs-details` | The queue: games with blanks, and what filling costs |
| `POST /api/research/:id/details` | Fill one game's gaps from the web |
| `GET /api/research/:id/plan` | Per-tier cost, domains, and whether it can run |
| `POST /api/research/:id/run` | Run one tier, synchronously |
| `GET /api/research/:id/findings` | What has been found, official-tier first |
| `PATCH /api/research/findings/:id` | Accept or reject one finding |

**Not built:** the review UI for findings, and the step that applies an accepted
finding to the catalog.

### 2. Anthropic API key — ✅ DONE, nothing outstanding

Set in `apps/worker/.dev.vars` **and** in production, and **rotated on
2026-08-05** after the original leaked into a chat transcript. Both verified by
live call.

Sync with **`npm run secrets:push`** rather than `wrangler secret put` per key.
The per-key flow is how production once ended up holding a *pre-rotation* key
while `.dev.vars` had the new one — the symptom was photo mode failing with an
unhelpful error. The script reads `.dev.vars`, pushes only allowlisted names,
prints a last-4 fingerprint so you can confirm which value went up, and passes
secrets over stdin so they never touch a command line or shell history.

```bash
npm run secrets:push          # sync .dev.vars -> production
npm run secrets:push -- --dry # names and fingerprints only, sends nothing
```

---

## Repo layout

```
packages/core/    constants.ts (leaf) -> schemas.ts -> barcode.ts -> vision.ts -> index.ts
packages/db/      users, health, items, copies, ratings, import, barcodes, cache,
                  relations, scan-jobs, covers (cover-link health),
                  editions (printings, and the covers you choose between)
packages/bgg/     BGG XML API2 client (throttled, retried, cached)
packages/barcode/ free resolution: gameupc.ts, upcitemdb.ts, resolve.ts
apps/worker/src/lib/ resolve-title.ts — the one cached title→candidate resolver
                  cover-check.ts — probes hotlinked covers; run by the cron
                  edition-backfill.ts — fetches printings from BGG, ten ids a call
packages/research/ Claude calls: client.ts, barcode.ts (paid rung), vision.ts
apps/worker/      Hono routes + Access JWT verification + R2 photo storage
apps/web/         React SPA; lib/camera.ts + lib/scanner.ts hold the iOS work
                  pages/ScanJobsPage.tsx is the photo queue UI
migrations/       0001 … 0014
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
| GET/DELETE | `/api/cache` | manageUsers — cache stats and clearing |
| GET/POST | `/api/items/:id/relations` | read / editCatalog — standalone-but-related links |
| DELETE | `/api/relations/:id` | editCatalog |
| GET | `/api/wishlist` | read — **item-level**, not tree-level. See below |
| GET | `/api/covers/health` | read — dead cover images, for the banner |
| POST | `/api/covers/check` | editCatalog — force a check slice now |
| GET | `/api/items/:id/covers` | read — every printing's cover, selected one first |
| GET | `/api/editions/status` | editCatalog — items still awaiting printings |
| POST | `/api/editions/backfill` | editCatalog — fetch printings from BGG. `?itemId=`, `?limit=`, `?force=` |
| POST | `/api/editions/campaign` | editCatalog — record crowdfunding covers as printings |
| GET/POST | `/api/scan-jobs` | editCatalog — photo queue list and upload |
| GET | `/api/scan-jobs/:id` | editCatalog — single job detail |
| POST | `/api/scan-jobs/:id/enrich` | editCatalog — retry enrichment |
| POST | `/api/scan-jobs/:id/done` | editCatalog — mark reviewed, clean up photo |
| DELETE | `/api/scan-jobs/:id` | editCatalog — delete job and photo |

`GET /api/items` accepts `q`, `status`, `kind`, `uncatalogued`, `duplicates`.

---

## Commands

```bash
npm run dev              # web :5173, worker API :8787
npm run typecheck        # every workspace
npm run build            # build the web app
npm run deploy           # build + deploy the Worker (refuses a dirty tree)
npm run db:migrate       # migrations → production
npm run db:migrate:local # migrations → local
npm run tail --workspace @bgc/worker

npx wrangler d1 execute board-game-catalog --remote --command "SELECT ..."
```

Verifying the two newest features against `npm run dev:worker` (no tokens
needed — the `DEV_EMAIL` bypass):

```bash
curl -s localhost:8787/api/wishlist                      # only `wanted` copies
curl -s "localhost:8787/api/items?status=wanted"         # whole trees — compare
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
  `git commit -F <file>` and edit files directly — see [`CLAUDE.md`](../CLAUDE.md),
  which now states this as a rule because it has bitten twice. The second time,
  `git commit -m "..." && npm run deploy` had its commit rejected for quoting
  while the deploy went ahead anyway, putting live code ahead of the repo.
  `npm run deploy` now runs `scripts/check-clean.mjs` first and refuses a dirty
  working tree; override with `ALLOW_DIRTY_DEPLOY=1` when you mean it.
  **UTF-8 corruption has also already happened once**, to `ScanPage.tsx`: every `—`, `…` and `·` came back as `â€”`, `â€¦`
  and `Â·`, including in text shown to the user while scanning. Nothing catches
  it — it typechecks, builds and deploys clean. Sweep for it with
  `grep -rn 'â€\|Â·\|Ã' --exclude-dir=dist`, and note that PowerShell heredocs
  do not exist either (`<<'EOF'` is a parser error).
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
  after GameUPC misses. **One 55-title shelf photo can exhaust it**, and the
  failures cluster in the back half of the photo — if a bulk scan resolves the
  first thirty games and then stops finding anything, this is why, not the data.
- **A lookup that *failed* is not a lookup that found nothing.** `resolveTitle`
  used to return the same empty result for both, and `cachedResolve` then wrote
  a negative cache entry — so a quota exhaustion or a 5xx got frozen in as "this
  game does not exist" for a week. It caused real damage: a shelf scan produced
  nine games with correct titles and no cover art, several of them household
  names that resolve perfectly on a retry. `resolveTitle` now returns `failed`,
  and a failed lookup is never cached. **Keep that distinction if you touch the
  resolver** — it is invisible in every type signature that does not carry it.
- **Word-overlap similarity scores a fragment far too kindly.** "Deep Rock
  Galactic" against "Deep Rock Galactic: Biome Expansion" scores 0.75 and sails
  past a 0.7 floor, so a base game takes its expansion's identity. `isFragmentOf`
  in `packages/core/src/barcode.ts` rejects strict-subset matches outright, after
  stripping generic words like "expansion" and "edition" — without that strip it
  also rejected "Catan Expansion: Cities & Knights" against "Catan: Cities &
  Knights", which is the same box.
- **A dead image URL does not have to answer 404.** `cf.geekdo-images.com`
  returns **400** for every unresolvable path — measured three ways. A link
  checker that only looks for 404/410 reports a clean bill of health on a
  catalog whose covers are almost entirely geekdo URLs. See the cover-health
  section above; `PERMANENT` in `apps/worker/src/lib/cover-check.ts` is the list
  that matters.
- **`d1_migrations` drifted from the local schema.** On 2026-08-06 the local
  database already had `item.source_url` while `0012_source_url.sql` was not
  recorded as applied, so `npm run db:migrate:local` died with
  `duplicate column name: source_url` and refused to apply anything after it.
  Fixed by inserting the row into `d1_migrations` by hand. If a local migration
  fails on a column that already exists, this is why — check
  `SELECT name FROM d1_migrations` before assuming the migration is wrong.
- **`getCached` cannot tell a stored `null` from a cache miss** — both come back
  as `null`. Caching "nothing found" as `null` and then checking
  `if (cached !== null)` therefore does nothing, silently, forever: the entry is
  written on every pass and read on none. Production had 15 of 69 title entries
  in exactly that state before it was spotted, each one re-running the full free
  ladder every time. **If you cache negatives, use `getCachedEntry`**, which
  returns `{ value } | null` so a hit carrying a null value is still a hit.
  Nothing about this fails loudly — the only symptom is quota quietly draining.
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

- ✅ **`ANTHROPIC_API_KEY` is set in production** — `npm run secret:list`
  returns it and nothing else (re-checked 2026-08-06). An earlier draft of this
  document claimed no secrets were set at all; that was true only before the
  08-05 rotation. Current state:

  | Mode | Live? | Why |
  |---|---|---|
  | Barcode scan | ✅ works | Local + GameUPC `test` stage + UPCitemdb are all free and keyless |
  | One box (photo) | ✅ works | `ANTHROPIC_API_KEY` is set |
  | Whole shelf | ✅ works | `ANTHROPIC_API_KEY` is set |
  | Photo queue | ✅ deployed | Same key; **not yet walked on a phone** |
  | BGG hydration | bypassed | Needs `BGG_API_TOKEN`; by design, degrades rather than breaks |
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
memory, send, read, discard.

**Settled 2026-08-05: nothing is stored at all.** The R2 binding is gone from
`wrangler.toml`. A scan photo goes from the upload request straight into the
vision call and is then unreferenced — vision takes the base64 from the request,
enrichment works from the extracted titles, and the review screen never shows an
image. The bucket had been write-only storage whose entire purpose was to be
deleted later, and one code path forgetting to delete was all it took to keep
photos indefinitely. Not writing them is a guarantee; remembering to delete them
was a habit. `photo_key` now holds the marker `not-stored`.

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
- `sleeve_requirement` has a table and no UI
- No automated tests — everything so far verified by exercising the running app
