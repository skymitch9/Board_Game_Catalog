# Handoff

Everything needed to continue or finish this without Claude.

## "262 wanted" over a wishlist of 25 — 2026-08-06

**Shipped.** Commits `88ca86a` and `29c12b5`, production version
**`324cc0e8-a60b-4f77-a080-ba9d043f7ce3`**. No migration, no data touched.

*"why does the site say 262 wanted but the wishlist is like 20 items"* — the
owner, and both numbers were internally correct. `262 = 26 wanted units + 236
preordered units`, while `/wishlist` lists the 25 genuinely `wanted` rows. Two
different sets under one word, and 236 of the 262 were pledges already paid for.

**The fold lived in three places, not one**, which is the part worth carrying
forward — the header was merely where it was noticed:

| Where | What it fed |
|---|---|
| `collectionStats`, `packages/db/src/items.ts` | the collection header |
| `summarizeTree`, `packages/core/src/schemas.ts` | every game card |
| `summariseGroups`, `packages/db/src/items.ts` | every group card |

The Ascension card read **"22 items · 45 wanted"** — forty-three of the
forty-five were pledges. A card claiming to want twice as many things as it
holds is the same error as the header's 262, repeated once per line.

Now: header reads **"25 wanted · 204 on the way"** with the wanted figure
**linking to `/wishlist`**, and cards read "4 wanted · 9 on the way".

### ⚠️ Rows and units differ on purpose — do not "tidy" this

- **Header figures are rows.** `wantedEntries` / `preorderedEntries` are
  `COUNT(*)`, because the header **links to `/wishlist`** and that page counts
  rows — "25 games wanted", with a `×2` on the single entry we want two of.
- **Card figures are units.** `owned` beside them must be units or the
  multi-copy `×N` feature disappears from the card.

The rule that reconciles them: **a number counts what the thing it links to
counts.** Card figures link nowhere. Make the header count units and it says 26
above a list of 25, which is where this started.

`collectionStats` has exactly one caller, `GET /api/meta`. Nothing else consumed
`wantedCopies`.

An earlier agent spotted the disagreement while building the wishlist and
resolved it by *not linking* the header to the page. Right instinct, wrong
resolution — a visibly wrong number is worse than an unlinked one.

## The lookup that died quietly — fixed, and the fill is done — 2026-08-06

**Shipped.** Commit `e355873`, production version
**`e71840f0-d0a0-4bb4-ad57-4a3568e07417`**. No migration. **The details queue is
empty.**

### It was never the CPU ceiling

Every earlier note in this file guessed at the per-invocation CPU limit and at
which Workers plan the account is on. Both were wrong, and neither needed
answering. `wrangler tail` on production, while triggering item 488 from a
signed-in browser, printed the cause in one line:

```
POST /api/research/488/details - Ok
  (warn) waitUntil() tasks did not complete within the allowed time after
  invocation end and have been cancelled.
```

**A `waitUntil` task gets about thirty seconds after the response is returned.**
`POST /:id/details` answered in 0.25s, so the whole Claude call was living on
that budget. Measured with the real `enrichItem` against the real items, one
lookup takes **17 to 73 seconds**:

| Item | 4 searches + 3 fetches | 3 + 1 (shipped) |
|---|---|---|
| 383 Ascension 15th Anniversary | 56.8s | 20.8s |
| 488 Before the Stroke of Midnight | 39.1s | 17.3s |
| 92 Dice Throne: Outcasts | 73.2s | 39.8s |

So roughly half of them were being cancelled. **Item 92 passing and 383 failing
was luck, not size** — 383 has since run in 22s, 21s and 61s on identical input.
Anthropic-side search latency is the variable, and it is wide.

⚠️ **`wrangler tail` is the tool this project kept not reaching for.** Three
separate silent failures — the shelf scan, the crons, this — were each diagnosed
by guessing. Tail prints the invocation outcome and any runtime warning, and it
works on production without Access getting in the way. Reach for it first.

### The shape of the fix

The work is **awaited inside the request** — an invocation that has not ended has
no thirty-second clock — **and still registered with `waitUntil`**, which now
does the job it was originally reached for: if the caller disconnects mid-lookup
the work keeps its thirty seconds and writes down whatever it reaches. The two
failure modes of the two previous designs are covered by the same promise.

Three layers, because each catches what the one before it cannot:

| Guard | Catches | Where |
|---|---|---|
| `AbortSignal.timeout(ENRICH_TIMEOUT_MS)`, 60s | a lookup that runs away — it throws, so it is recorded | `packages/research/src/enrich.ts` |
| the `catch` | anything thrown, from anywhere | `runDetailsLookup`, `apps/worker/src/lib/details-run.ts` |
| `closeStaleDetailsRuns`, on every read | the invocation killed outright, when none of our code runs | `packages/db/src/research.ts` |

The third one is what makes a bulk fill *safe*, and it is worth understanding
why: a row stuck at `running` made `activeDetailsRun` report the item as busy,
so the queue page's driver waited on it for ever. **The fill would have stopped
dead while looking healthy** — the exact failure this project has produced twice.
`error` does not count as "asked" in the three-layer policy, so a swept row is
simply offered again.

`STALE_AFTER_MINUTES` is 3, and the threshold now lives in SQL in one place;
`isStale` in `details-run.ts` is gone.

### ⚠️ The POST is now slow on purpose — do not add a timeout

`api.startItemDetails` takes **20 to 60 seconds** and returns the *finished* run.
Anything that wraps it in a timeout, or a proxy that gives up early, reintroduces
the bug. The queue page also had to grow an in-flight counter (`inFlight` in
`DetailsQueuePage.tsx`): with the POST held open there is no `running` row to
notice, and without the counter the driver fires the whole queue off at once.

**60s is a real ceiling and it will occasionally bite.** Item 383 hit it once and
was recorded as `error` with "The lookup was still searching after 60s and was
stopped. Try again." That is the designed behaviour — visible and retryable —
but if it becomes common, the fix is not a bigger number: Cloudflare's edge gives
up at 100s, so anything longer has to leave the request entirely (a local script
against remote D1, which is how the original 47-game backfill ran for $1.22).

### The fill, run 2026-08-06

**A second agent's free web-research pass did nearly all of it.** The queue went
**80 → 50 → 2** while this fix was being built, without spending anything. Do not
read the small paid numbers below as the feature being cheap; read them as the
free pass being the right thing to do first.

| | |
|---|---|
| Queue before | **2** (`GET /api/research/needs-details`, the only authority) |
| Queue after | **0** |
| Completed | 2 — Divine Dungeon the Game, Go Fish |
| Errored | 0 in the fill itself |
| Filled a field | **0** |
| Paid spend, whole session, production | **~7¢** |

Both rows came back **"Nothing new found."**, and both are believed genuine
rather than a failure of the lookup:

- **Go Fish** (publisher, publisher site, year) is a public-domain folk game.
  There is no publisher and no publication year to find. **Layer 1 should
  probably exclude it** — this row will come back every time the queue is
  rebuilt, and a notification nobody can clear is worse than a blank field. It
  is the clearest candidate for a `kind`/policy exclusion the owner has.
- **Divine Dungeon the Game** (playing time) is a real, small-press game whose
  playing time does not appear to be published anywhere. Genuinely undocumented
  rather than mis-asked.

The three-layer policy records `unfilled` per field, so neither returns to the
queue — the queue is empty and stays empty. That is the policy working.

### Two side findings worth keeping

- **The crons DO fire in production.** `wrangler tail` caught
  `"*/30 * * * *" @ 1:30:23 PM - Ok` with `cover check {"checked":20,"ok":20}`.
  The long section below claiming nothing scheduled has ever run is **out of
  date** — it was written before `npx wrangler triggers deploy` was applied.
- **A read taken during a deploy can be stale.** Two reads right after
  `wrangler deploy` reported a run as still `running` when the database already
  said `error` — the old version was still serving. Not a caching bug: the API
  sends no cache headers, and a re-read a minute later was correct. Wait for the
  rollout before concluding a fix did not work.

## A dice tray is not a dice game — built 2026-08-06

**Shipped.** Commit `a0fa75c`, production version
**`915ce9c4-8901-4838-85ae-57cca17491fd`**. No migration — code only, and no
catalog data was touched.

*"maybe we remove the desc of accessories all together, the name and potential
photo should be enough information for what something is. This is mainly a
catalog of things i own"* — the owner.

**The queue was already innocent. The lookups were not.** `detailFieldsFor` has
never asked an accessory for a description: everything with a parent is asked for
nothing, and the three parentless accessories are asked only for publisher and
publisher site. Measured on production's 760 rows through
`GET /api/research/needs-details`, before **and** after: **80 rows — 78 base, 2
accessory (Excursion Tiles 1, Pangea Gaming Table)**, the same rows with the same
"missing:" lines. Nothing left the queue because nothing accessory-shaped was in
it. Do not expect a number to move; the SQL is generated from `detailGapBranches`
and that function's output is unchanged.

What *was* broken is the other direction, and it was reproduced live against a
copy of production's data. One click of **Free lookup** on
*Dice Throne Vanguard: Accessory Pack - Druid*:

> Filled in year, min players, max players, play time, description and cover
> image from "Dice Throne: Vanguard".

The accessory pack came away **2–4 players, 30 minutes** and the base game's
marketing copy. The identical click on its sibling *Accessory Pack - Duelist*
after the change filled **year and cover image**, and nothing else.

**The new decision is `fillableFieldsFor` in `packages/core/src/details.ts`**:
what a row may *hold*, as opposed to what it is *asked* for. `accessory`, `promo`
and `upgrade` refuse `description`, `minPlayers`, `maxPlayers` and `playtimeMin`;
a row with a `game_system` refuses the three player/time fields and keeps its
description. It gates all three writers:

| Writer | Where |
|---|---|
| The paid details run | `fieldsToFill`, `packages/research/src/enrich.ts` |
| The free by-name lookup on an item page | `fillableFor`, `apps/web/src/pages/ItemPage.tsx` |
| Adding a scanned candidate as an accessory | `addCandidate`, `apps/web/src/pages/ScanPage.tsx` |

- **`expansion` is deliberately not on the list.** *Catan: Starfarers – 5-6
  Player Extension* is an expansion whose entire purpose is to change the number
  this would have refused to record.
- **`promo` and `upgrade` were added on judgement, not instruction.** The owner
  said accessories. A promo card and a set of metal coins are the same shape —
  1 of 48 promos carries a description — but if that is wrong, deleting the two
  strings from `A_THING_NOT_A_GAME` reverses it and nothing else changes.
- **`yearPublished` is still allowed on an accessory.** A playmat really was
  printed in a year; unlike a player count it is not an invention. It is allowed
  in, never asked for.
- **The three existing accessory descriptions were left alone.** This changes
  what gets asked and written, never what is stored.

The collection page also grew a **second pager above the list**, from the same
state and handlers as the bottom one (`Pager` in `apps/web/src/components/ui.tsx`);
neither renders when there is only one page.

## Right now — 2026-08-06 (evening)

**Working tree clean, pushed, migrated and deployed.** Head `b783883`,
production version **`75a32bf6-39c3-450e-8e56-c936dbd5e8bf`**, migrations
through `0020_run_inputs` applied local *and* production.

Two things shipped today, in two commits, deliberately not batched:

| Commit | Version | What |
|---|---|---|
| `fd7b142` | `f0b32c75-45d0-48f1-9733-7a53723affe5` | The collection header down to one button; Related games and Missing details moved to the nav and hidden when empty |
| `b783883` | `75a32bf6-39c3-450e-8e56-c936dbd5e8bf` | "Ask once, re-ask when the world changes" — the three-layer details policy (migration 0020) |

### ✅ The bulk details fill has been run — see the section at the top

This section used to say the fill was withheld because two of three trial runs
stalled, and blamed the subrequest ceiling. **The diagnosis was wrong and the
problem is fixed** — it was `waitUntil`'s post-response budget, not subrequests
and not CPU. The queue is now empty. See
[the lookup that died quietly](#the-lookup-that-died-quietly--fixed-and-the-fill-is-done--2026-08-06).

Opinions the owner should decide on are collected in
[`covers-wanted.md`](covers-wanted.md), including why the Dice Throne player
counts were **not** copied across by hand.

### Queue numbers, measured

| | Queue |
|---|---|
| Before the policy | **92** |
| After the policy deployed | **89** |
| After the fill | not run |

Layer 1 removed exactly three rulebooks (Auroboros, Bergin's Book of Beasts,
Cosmere Mistborn Handbook) and narrowed what fourteen others are asked for.
Layer 2 removed nothing and could not have — `research_run` was empty, so
nothing had ever been asked. It pays from the second pass onward.

**All five tasks are shipped.**
1. ✅ Shelf enrichment fix — chunked, resumable, error recorded, retry/stop
   buttons, sorted jobs leave the queue (`d5f0c4b`)
2. ✅ **The details lookup runs in the background** (`c496fb1`, migration
   0018) — see [the details run](#the-details-lookup-outlives-the-request--built-2026-08-06)
3. ✅ Barcode continuous intake (`bd4ec00`)
4. ✅ Timezone parsing — `apps/web/src/lib/dates.ts`, used by `CopyEditor`,
   `Completeness` and `ScanJobsPage` (`bd4ec00`)
5. ✅ **`series` column, grouping over `series` *and* `game_system`, and linked
   parent labels** (`733367f`, migration 0019) — see
   [folding a line into one entry](#folding-a-line-into-one-entry--built-2026-08-06)

**Migration numbering deviated from the plan, deliberately.** The brief pinned
`series` to 0018, on the assumption that backgrounding the details call needed
no schema change. It did — `research_run.tier` was CHECKed against the three
source tiers and there was nowhere to record what a run filled in — so the
details work took **0018** and `series` took **0019**.

A separate agent is researching Dice Throne playmats.

**Do yourself:** `game_component` is empty and the weekly cron next fires Sun 9
Aug. From a signed-in browser console, ~8 runs covers the catalog:
`await (await fetch('/api/components/backfill',{method:'POST'})).json()`.

Scan jobs 5, 6 and 7 **no longer need retrying — they finished on their own**
the moment the fix went live: 73/73, 74/74 and 36/36, and they now sit at
`review` with 24, 41 and 23 titles still to sort.

**Three discoveries worth keeping:**
- `wrangler deploy` printed "Deployed … triggers" for weeks while Cloudflare's
  Cron Events log showed **no events at all**. Fixed with
  `npx wrangler triggers deploy` plus a full deploy. **A cron is not working
  until something it writes has rows** — `cover_check` now has 40.
- **The subrequest cap was the shelf killer, confirmed.** Workers allow 50 per
  invocation on the free plan and every D1 call counts alongside every fetch;
  one title costs about four, so a 73-title shelf wanted ~290. The invocation is
  *terminated* rather than thrown, which takes `waitUntil` with it — hence an
  empty `error` column and a job that looked busy for twenty minutes. The plan
  was never confirmed from the dashboard, but 73 titles dying is only consistent
  with the 50 ceiling; at 1000 it would have finished. Enrichment is now eight
  titles per invocation, and **do not raise that number** — the pass that
  exceeds the ceiling is not slow, it is silently killed.
- **GameUPC does not answer an unknown barcode with nothing.** It answers with
  fifteen guesses carrying real BGG ids, years and cover art. A textbook's ISBN
  came back as *Labyrinth*; a dog bed's UPC as *Ten in a Bed*. The only thing
  separating those from a real hit is the confidence band, and it separates them
  cleanly: `verified`/`high` is trustworthy, `medium` needs a human, `low` is
  noise. That band is load-bearing in `apps/worker/src/lib/barcode-scan.ts`.

**TODO — linking related games needs a search box, not an id.** The "Related
games" screen asks for the other item's numeric id. Nobody knows an id; the owner
has to go and look it up, which makes linking painful enough to avoid. Replace it
with a type-ahead that searches existing items by name and resolves to the id
behind the scenes. `/api/items` already supports multi-term search, and
`/api/item-names` returns the whole catalog cheaply (41 KB for 640 rows) — it was
added for the shelf scanner and is exactly what a picker needs.

**Open decisions:** Dice Throne shape (`docs/dice-throne-shape.md`, mock at
`claude.ai/code/artifact/38ad3545-2a66-4212-a828-4b6ae702bc37`; owner chose
options 2+3) · ~56 `same_family` relatives on every Dice Throne page · five
BackerKit near-misses staged in `scratchpad/backerkit2-nearmisses.{md,sql}` ·
`createItemSchema` cannot create a standalone accessory · the Deadpool playmat is
wishlisted but unconfirmed to exist.

Stable reference lives alongside this file and is not duplicated here:
[`access/`](access/README.md) (endpoints, key names, quotas) and
[`info/`](info/README.md) (how and why things work).
**Last updated:** 2026-08-06 (series grouping). Everything is committed, pushed
and deployed; the working tree is clean. Database was cleared and collection
restarted fresh on 08-05, and is being written to by a separate data-only
agent — item totals in this document move between 736 and 739 for that reason.

**Newest first:**
[what the screen puts first](#what-the-screen-puts-first--built-2026-08-06) —
ratings above a fifty-five-row family list, one add door instead of three, and
lazy thumbnails. Then
[accepting a guess](#accepting-a-guess--built-2026-08-06) — the review screen
could only ever say no. Then
[folding a line into one entry](#folding-a-line-into-one-entry--built-2026-08-06)
— Dice Throne's eleven cards become one, and the same mechanism reaches the 79
D&D 5e rows scattered across nine trees. Then
[the details lookup outlives the request](#the-details-lookup-outlives-the-request--built-2026-08-06)
— a dropped connection no longer pays for a search and loses the answer. Then
[children inherit from their parent](#children-inherit-from-their-parent--built-2026-08-08)
— the details queue went from **695 rows to 78**, and a playmat now shows its
game's publisher instead of costing 1.4¢ to be told it. Then
["what am I missing"](#what-am-i-missing--built-2026-08-06) —
the shopping list, cached and refreshed weekly. Then
[the collection page at 640 items](#the-collection-page-at-640-items--built-2026-08-07)
— paging, multi-term search, collapsed groups — and
[the four columns that had no UI](#the-four-columns-that-had-no-ui--built-2026-08-07).
Then the [cover picker](#the-cover-picker--built-2026-08-06) —
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
| `34c1ecf` | Ratings above the family list; one add door; lazy thumbnails |
| `027a960` | Record the accept-a-guess deploy |
| `13c5e88` | Let a person say "yes, that is the game" |
| `733367f` | Fold a line of eleven boxes into one entry, without moving a box (migration 0019) |
| `c496fb1` | Stop a lookup dying when the phone locks (migration 0018) |
| `2d50224` | Stop paying to be told a dice tray's publisher — the queue, 695 → 78 |
| `5a35e83` | Stop calling a gaming table an unfinished record |
| `d105209` | Say what else exists for a game, and what we do not have |
| `36cb936` | Show the four things the catalog knew and never said |
| `bfa01bb` | Make the collection page work at 640 items |
| `117d47e` | Make room for roleplaying books (migration 0015) |
| `d47abd8` | Never overwrite a cover without keeping the one it replaced |
| `5bac8d6` | Pick which printing's cover represents our copy |
| `3aaa730` | Handoff refresh |
| `6eb0c8e` | Cover-link health check, cron and banner |
| `ce03a8f` | The wishlist — item-level, not tree-level |
| `227f7d0` | `item.source_url` |
| `0e61948` | The add restructure, item relations and the photo queue — all of it |

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
| Deployed version | `324cc0e8-a60b-4f77-a080-ba9d043f7ce3` — wanted split from preordered everywhere (2026-08-06), at 100% |
| Previous version | `e71840f0-d0a0-4bb4-ad57-4a3568e07417` — the details lookup stops dying quietly (2026-08-06) |
| Cron triggers | `*/30 * * * *` the cover check, `41 5 * * 1` the weekly component refresh. Registered in the deploy output and confirmed *firing locally* via `wrangler dev --test-scheduled` — but **neither has ever fired in production**, see [the cron section](#-cron-triggers-do-not-fire-in-production--nothing-scheduled-has-ever-run) |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` · `7dd22702-f0e2-4fc7-b201-d16d60176efa` · WNAM |
| R2 bucket | **none** — `bgc-photos` still exists in the account but is unbound and empty |
| Migrations applied | `0001_init` … `0020_run_inputs` (local **and** production) |
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` |
| Access policy | **Everyone** — anyone may authenticate; the app decides who gets in |
| Login method | Email one-time PIN (Google SSO not configured) |
| Owner | `nbaslamking@gmail.com` (claimed on first sign-in) |

**Branch:** merged. `main` now holds all 38 phase-1 commits (merge `ab057d9`),
and typechecks. `phase-1-manual-catalog` still exists and is unchanged.

**Pushed.** `origin` is
<https://github.com/skymitch9/Board_Game_Catalog.git> and `origin/main` is up to
date as of 2026-08-06 (`d47abd8`). An earlier version of this document said
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

## 🚨 Cron triggers do not fire in production — nothing scheduled has ever run

**Found 2026-08-06 while trying to bootstrap the component data.** This is not
about the new feature; it invalidates a claim this document has been making
since the cover check shipped.

Evidence, all from production:

| Check | Result |
|---|---|
| `SELECT COUNT(*) FROM cover_check` | **0** — the half-hourly check has never written a row |
| `SELECT COUNT(*) FROM component_check` | **0** |
| Component cron temporarily set to `*/2 * * * *`, deployed, watched 19 minutes | **0 rows, 0 log lines** |
| `wrangler deployments list` | the accelerated version was live at 100% the whole time |
| `npm run secret:list` | `BGG_API_TOKEN` **is** set, so the handler's no-token early return is not the cause |

Both schedules appear in the deploy output — that is registration, not
execution, and this document previously recorded "Confirmed registered in the
deploy output" as if it were evidence. It is exactly the trap the cover-check
work warned about in a different form: **a scheduled job that looks healthy and
has never run.**

What this means today:

- **Cover-link health is a no-op in production.** The banner has nothing to
  show because nothing has ever probed a URL. Locally it works — a forced
  `POST /api/covers/check` returned `{checked:20, ok:20}` — so the code is
  fine and the scheduler is not.
- **The weekly component refresh will not fire either** until this is fixed.
  Everything else about the feature works; the per-item "Check now" button and
  `POST /api/components/backfill` run the same code on demand.

Not diagnosable from the CLI. Next steps for whoever picks this up: check
**Workers → board-game-catalog → Settings → Trigger Events** in the Cloudflare
dashboard to see whether the crons are listed and whether any invocation is
recorded, and check whether the account has cron triggers enabled at all.
Cloudflare's own "Cron Events" view is the only place that reports a *missed*
invocation.

### ⚠️ Production has no component data yet, and this is why

The backfill route is behind Cloudflare Access, and a service token cannot
stand in (`auth.ts` requires an `email` claim; service-token JWTs carry
`common_name`). With the cron dead, there is no unattended way in. **The owner
can do it in seconds from a signed-in browser** — open the site, then in the
console:

```js
// One full run: 8 BoardGameGeek calls, ~10s. Repeat until unclassifiedComponents is 0.
await (await fetch('/api/components/backfill', {method:'POST'})).json();
await (await fetch('/api/components/status')).json();
```

About eight runs covers the catalog: 83 rooted games, ~1,148 components.
Pressing **Check now** on a single game's page does the same for that game and
is enough to see the feature work immediately.

---

## What am I missing — built 2026-08-06

*Seven expansions exist, you have four, here are the three you do not.* The
design facts live in [`info/completeness.md`](info/completeness.md) and are not
repeated here; this is state and numbers.

**Migration 0016** adds `game_component` (one row per known component per game)
and `component_check` (per-game "has anyone ever asked"). Applied local **and**
production.

| Route | Capability |
|---|---|
| `GET /api/items/:id/completeness` | read — cached, never fetches |
| `GET /api/components/status` | editCatalog — coverage, no BGG call |
| `POST /api/components/backfill` | editCatalog — `?itemId=` `?calls=` `?force=` |
| `POST /api/components/reclassify` | editCatalog — re-decide the split, **free** |

### The matcher, on a case with a known answer

Here to Slay (item 107, BGG 299252) — production's real tree, 22 rows, replayed
against local dev. BoardGameGeek lists **13 expansions and 23 accessories, all
official** (TeeTurtle / Unstable Games; third-party count is 0, which is right).

Reported: **1 of 13 expansions, 1 of 23 accessories.** True answer for
expansions is 3. The two it misses are `KS Exclusive Monster Expansion Pack`
(BGG's `Monsters Expansion`) and `KS Exclusive Dragon Sorcerers Expansion Pack`
(BGG's `Dragon Sorcerer Expansion`) — both scored 0.29 and 0.44 after the
game-name strip and were counted missing. **That is the specified failure
direction** and the fix is one field: type the BGG id on the edit screen.

What it got right, and what the whole feature is for:

> Missing: **Warriors & Druids Expansion**, **Berserkers & Necromancers**.

The owner holds the play mats, standees and meeples for both and neither
expansion. The fragment rule in `isConfidentMatch` is what stops
"Warriors & Druids Play Mat Set" being read as the expansion.

Ark Nova (BGG 342942), the third-party case: **4 official expansions**
(3 already on the wishlist, `Promotion Team & Capybara` genuinely missing),
**1 official accessory** (Portal Games' wooden tokens), **26 third-party** —
including Kekpop Spiele's three 3D "expansions", which BoardGameGeek types as
`boardgameexpansion`. Every verdict checked by hand and correct.

### Numbers

| | |
|---|---|
| Production items with a `bgg_id` | 128, of which **83 are rooted games** — the only ones this can answer for |
| Components those 83 list | **1,148** (680 expansions, 468 accessories), 1,120 distinct ids |
| Local catalog after a full pass | 1,137 components: **665 official**, **472 third-party**, 0 unclassified |
| Game sweep | 5 BGG calls, 5.5s |
| Classification sweep | ~56 calls, so it rotates — 8 runs cleared local |
| Reclassify (no BGG call) | 1,137 rows in **0.57s** |

**557 of 640 catalog rows can never have an answer** and say "No data", never
"complete". That is the honest limitation and it is surfaced, not hidden.

### The "not filed yet" badge no longer fires on accessories

`ItemCard` labelled **every** parentless non-base item "not filed yet". The
intent was right for an orphaned expansion — a record waiting for its game —
and wrong for the three items in the catalog that are legitimately standalone:
the **Pangea Gaming Table** (372, nineteen components under it) and
**Excursion Tiles 1 and 2** (117, 118), system-agnostic terrain belonging to no
game. All three read as a broken catalog.

`BELONGS_TO_A_GAME` in `ItemTree.tsx` now limits the badge to `expansion`,
`promo` and `upgrade`. An accessory that *does* carry a `pendingParentName`
still says what it is waiting for, because then it genuinely is. No catalog
data was touched — the table's `kind` is correct.

**Checked for the same premise elsewhere:**

| Place | Carries it? |
|---|---|
| `matchingRootsSql`'s `uncatalogued` filter | **No.** It asks whether anything in the tree has a *copy*, which is a different question |
| `suggestRetags` (`packages/core/src/vision.ts`) | **No** — it only considers `kind === 'base'`, so a standalone accessory is never proposed for filing. Correct as-is |
| `createItem` (`packages/db/src/items.ts`) | **No.** An orphan roots itself, which is exactly right for the table |
| **`createItemSchema`** (`packages/core/src/schemas.ts`) | **⚠️ Yes.** A non-base item must supply a parent *or* a `pendingParentName`, so **the app cannot create a standalone accessory at all** — the Pangea table can only have arrived through the bulk import |

The schema was **deliberately left alone**, because relaxing it is a real
trade-off rather than a tidy-up: exempting `accessory` would also stop a sleeve
pack read off a shelf from erroring, and start silently saving it as a
standalone root. That is the owner's call. Note that the display and the
validation now openly disagree about whether a lone accessory is a complete
record.

### Weekly refresh — verified firing locally; **never fires in production**

`crons = ["*/30 * * * *", "41 5 * * 1"]`. Monday 05:41 UTC; minute 41 stays off
the cover check's `:00`/`:30`. One `scheduled` handler dispatching on
`event.cron`.

Exercised with `wrangler dev --test-scheduled`, both directions — the dispatch
is correct and the handler does real work:

```
GET /__scheduled?cron=41+5+*+*+1   -> component refresh {"gamesChecked":2,...,"bggCalls":1}
GET /__scheduled?cron=*/30+*+*+*+* -> cover check {"checked":20,"ok":20,...}
```

**In production it never runs at all** — see
[the cron section](#-cron-triggers-do-not-fire-in-production--nothing-scheduled-has-ever-run).
The dispatch logic is not the problem; nothing invokes it.

⚠️ **`COMPONENT_REFRESH_CRON` in `apps/worker/src/lib/component-backfill.ts`
must stay character-identical to the `wrangler.toml` entry.** A stray space
routes the weekly refresh silently into the cover check.

### Things that will bite

- **BoardGameGeek's `/thing` takes at most 20 ids.** 36 answers `400`, with no
  partial result. `things()` now chunks — which also fixed a live silent bug in
  `hydrateFromBgg`, where a 101-candidate search 400'd and the `catch` recorded
  it as a BGG outage.
- **Strip the game's name before comparing titles.** Full-string matching
  produced nine hints for Here to Slay, eight of them wrong ("Central Play Mat"
  → "Warriors & Druids Play Mat Set" at 0.71). After the strip: one hint, and it
  is genuine.
- **Take the best candidate, not the first.** `owned.find()` let list order pick
  the winner among rows that all cleared the floor.
- **Nothing is ever deleted.** A component BGG stops listing is stamped
  `stale_at` and shown dimmed. A row disappearing looks exactly like the owner
  having bought it.

> **Local D1 was seeded and cleaned back out** — 86 items, `WAM Seed` rows gone,
> item 111's `bgg_id` returned to NULL. **Two pre-existing `copy` rows on items
> 111/112 were lost** in the cleanup (local shows 8 copies where the earlier
> note said 10); production is untouched, and
> `rm -rf apps/worker/.wrangler/state/v3/d1 && npm run db:migrate:local` resets
> local outright.

---

## What the screen puts first — built 2026-08-06

Three ordering and naming fixes, no data touched (`34c1ecf`).

**Ratings render above "Related games" on an item page.** Family is transitive
and the whole Dice Throne line is one family, so a hero page lists ~55
relatives. Measured in Chrome on *Dice Throne Hero: Black Panther*: the Ratings
heading sat at **3184px**, below a relations list starting at 756px. It now sits
at **749px**, with the relations list at 978px. The owner chose to keep the
relatives — only the order moved, and `RelatedGames`' contents and its
"no relations and cannot edit" guard are unchanged. Verified on a plain game
(Scythe, no relations) too: the empty state still reads, nothing is doubled.

**The collection header collapses from five buttons to four**, one clearly
primary. `Scan a barcode` pointed at `/scan-jobs?add=barcode` — the tab
`+ Add games` already opens on — and `Check a game` (`/scan`) opens the same tab
strip over the same camera panel. Both are gone. The old split (bulk intake vs
the in-shop "am I already holding this?") stopped being true when barcodes moved
onto the queue: `BarcodeQueue` marks a code **"Already yours"** from our own
table, on its own audio pitch. `/scan` is untouched and still reachable —
**"Type a name"** opens it on the Manually tab, the one route the queue has no
equivalent of, and the other three tabs are one tap from there. `?add=barcode`
still works and is still used by the link *inside* `/scan`.

**"Fill in details" → "Missing details."** A place, not an act. The owner pressed
it expecting a lookup to run, landed on a list, and concluded the feature was
broken. The buttons that do run a lookup live on that screen and keep their
verbs ("Fill in N games", "Fill this one", "Look again").

### ⚠️ Lazy thumbnails defer the hero art; they do not shrink it

Every thumbnail rendered *in a list* now carries `loading="lazy"`, following the
precedent `.thumb` already set in `ItemTree.tsx`: the related-games list
(`ItemPage.tsx`), the expansion picker (`ItemForm.tsx`), and the candidate and
suggestion lists on both scan screens. The item's own `.thumb-lg` is
deliberately **not** lazy — it is the picture you opened the page to see.

This landed because 45 Dice Throne hero rows now carry art served from
`dicethrone.com` at **0.6–1.4 MB a PNG**, and `.thumb-sm` has no size rule of
its own, so it falls through to `.thumb` and draws at **44px**. Confirmed in the
browser: 7/7 list thumbnails on a hero page carry the attribute and none is
fetched at first paint.

**But laziness only helps the visit that does not scroll.** A family list read to
the bottom still pulls every PNG at full size to render it at 44px, and a hero's
family list is the thing you scroll. **The real fix is resizing at the data
layer.** Do not swap the URLs for the Jetpack/Photon proxy (`i0.wp.com`) to get
there — the publisher's own origin was chosen on purpose, and this project has
already been bitten by expiring CDN URLs.

---

## Accepting a guess — built 2026-08-06

*"we need an option to accept a guess, in one of the photos it guessed the name
of a dnd board game but wasn't sure. It was correct but I had no way of
confirming with it"* — the owner.

The confidence band stays load-bearing: GameUPC answers an unknown code with
fifteen confident-looking guesses, so `medium` is shown and deliberately not
ticked. What was missing was the other half. When the guess is right, the only
route into the catalog was to retype the name, throwing away the BoardGameGeek
id, publisher, year and cover that came with the match.

| Piece | Where |
|---|---|
| `TitleSuggestion`, `toSuggestions`, `ScannedTitle.candidates` / `.acceptedMatch` | `apps/worker/src/lib/barcode-scan.ts` |
| `cachedResolveAll` — the same lookup, keeping the runners-up | `apps/worker/src/lib/resolve-title.ts` |
| `POST /api/scan-jobs/:id/titles/:index/accept` | `apps/worker/src/routes/scan-jobs.ts` |
| `wantsHumanCall`, `needsRelookupToAccept`, `acceptMatch`, the copy note | `apps/web/src/pages/ScanJobsPage.tsx` |

- **Suggestions are trimmed, and the difference was measured.** Five whole
  `BarcodeCandidate`s made one job's `enriched` blob **23 KB**, almost all
  BoardGameGeek description prose — and that blob is returned for up to fifty
  jobs on a poll firing every 2.5 seconds while anything is working. Trimmed to
  name, year, publisher, cover and band: **2.3 KB**. Do not put the descriptions
  back.
- **Accepting re-classifies against the name chosen.** A runner-up brings its own
  proposed parent — accept "Catan: Seafarers" over a top answer of "Catan" and
  the row must propose Catan as its parent rather than rooting itself beside it —
  and its own `reason`, which otherwise still read "nobody has confirmed this
  code" directly under a line saying somebody had.
- **The copy records that a human decided**: *"Identity confirmed by hand at
  review on 2026-08-06 — the lookup was not confident."* A verified lookup and an
  accepted guess are not the same evidence and nothing else would tell them apart
  later.
- **The lookup cache now stores a list.** Old single-object entries are read as a
  one-element list rather than invalidated, so existing entries stay useful and
  simply offer no alternatives until they expire.
- ⚠️ **Jobs enriched before this carry no suggestions.** The six sitting at
  review in production are in exactly that state; those rows say so and point at
  "Look up again", which re-asks and stores the list.

**Stop** now appears only where it stops something — `uploaded`, `reading`,
`enriching`, and a job parked at `read` with titles still to look up, because
that one *is* working: the queue page asks for its next chunk on its own, and
dropping Stop there would leave a 73-title shelf with no way out between passes.
It used to show on every job that was not `done`, including one at `review`
waiting for you.

Verified in Chrome against production's data: `824968717615` (medium, five
suggestions, top accepted, refused on add as already in the collection — the
duplicate guard) and `9780306406157`, a textbook ISBN with no resolved name at
all, whose **third** suggestion was accepted and became item 786 with BGG 295945,
KOSMOS, 2020, its cover and the note.

---

## Folding a line into one entry — built 2026-08-06

`item.series` (migration 0019), and a collection page that groups on it — and on
`game_system` through the same mechanism. **Nothing was re-parented.** The
reasoning and the rejected alternatives are in
[`dice-throne-shape.md`](dice-throne-shape.md); this is state and numbers.

| | Before | After |
|---|---|---|
| Collection page entries | 114 | **93** |
| Dice Throne | 11 cards | **1** |
| D&D 5e (2014) | 9 cards | **1** |
| Game trees | 114 | 114 — unchanged |

Five groups fold 26 lines into 5 entries: Dice Throne (11), D&D 5e (2014) (9),
Cosmere RPG (2), Dungeon Crawler Carl RPG (2), system-agnostic (2).

**The half that cannot be fixed by re-parenting is the `game_system` half**, and
it is the one the owner asked for. 79 rows need D&D 5e and they sit in **nine
separate trees**: 53 digital books inside D&D under the DM's Guide, and 26
physical third-party products — Auroboros, Bergin's Book of Beasts, Firestar
Falling, three Midnight Tower adventures, Ryoko's Guide, Starlight Arcana — as
their own top-level lines, because they `require` the Player's Handbook rather
than being part of D&D. Filing them inside D&D would misdescribe what the owner
owns. Filtering `D&D 5e (2014)` returns all nine regardless of tree, publisher or
format, and the group card carries **26 physical · 53 digital** on its face —
"paper or D&D Beyond?" is exactly the question a combined 5e list raises.

| Piece | Where |
|---|---|
| `series` column, index, Dice Throne backfill | `migrations/0019_item_series.sql` |
| `Item.series`, `itemQuerySchema.series`/`grouped`, `CollectionGroup`, `CollectionEntry`, `MatchedChild` | `packages/core/src/schemas.ts` |
| `ROOT_GROUP_CTE`, `shouldGroup`, `summariseGroups`, `listGroupOptions` | `packages/db/src/items.ts` |
| `GET /api/meta` → `groups` | `apps/worker/src/routes/catalog.ts` |
| `GroupCard` | `apps/web/src/components/ItemTree.tsx` |
| `ParentLabel` | `apps/web/src/components/ui.tsx` |

### Three decisions that will look arbitrary later

- **A grouping of one line is not a grouping.** `HAVING COUNT(*) > 1` in the CTE
  drops it, for the same reason a group of one child on a game card starts
  expanded: replacing one row with one row and a click is an extra step, not a
  saving. Four production systems qualify — D&D 2024, Cypher System, Lewd Dungeon
  Adventures, the playtest sheet — and each stays the game it already was.
- **A tree's label is the value most of it carries**, not the alphabetically
  first. Production holds exactly one tree with two systems: 20 rows of
  "D&D 2024" and one of "D&D (playtest material)". `MIN()` would have filed the
  whole 2024 line under the playtest sheet.
- **Grouping switches itself off while searching, and inside a group.** Folding
  a hero's hit into a *Dice Throne* card answers neither half of "which box is
  Scarlet Witch in", and folding an opened group back up would make the filter a
  no-op. `shouldGroup` is the one place that decides.

### The parent label, and where it appears

A child that turns up away from its parent now says where it lives, muted, with
the parent's name as a **link**. Searching `scarlet playmat` reads:

> Matched **Marvel Dice Throne: Playmat - Scarlet Witch** — *Dice Throne Hero:
> Scarlet Witch*, **Dice Throne Hero: Scarlet Witch** — *Marvel Dice Throne*

and the wishlist reads **Ark Nova: Marine Worlds** — *Ark Nova*. Both halves are
links; the matched child was not clickable at all before. **Nothing was
renamed** — `attachMatchReasons` already had the parent in hand while walking the
tree, and `listWishlist` already returned `parentItemId` and `parentName`.

### Verified against production's data, in a browser

A local D1 was loaded with a read-only export of production's `item` and `copy`
tables (739 items, 740 copies) in a **separate persist directory**, so the
ordinary local database was never touched:

```bash
npx wrangler d1 export board-game-catalog --config apps/worker/wrangler.toml \
  --remote --table item --table copy --no-schema --output prod.sql
npx wrangler d1 migrations apply board-game-catalog --config apps/worker/wrangler.toml \
  --local --persist-to apps/worker/.wrangler/sandbox
npx wrangler d1 execute board-game-catalog --config apps/worker/wrangler.toml \
  --local --persist-to apps/worker/.wrangler/sandbox --file prod.sql
npx wrangler dev --config apps/worker/wrangler.toml --port 8791 \
  --persist-to "<ABSOLUTE path>/apps/worker/.wrangler/sandbox"
```

⚠️ **`--persist-to` must be an absolute path or a path under the repo.** A
relative path is resolved against the *config file's* directory for
`wrangler dev` but against the cwd for `d1 execute`, so the two silently used
different databases — the first attempt ran `dev` against the ordinary 86-item
local DB while the migrations went to the sandbox. A path in the system temp
directory failed outright with `internal error`.

The cards, the expander, the filter, the search and the wishlist were all
exercised in Chrome against that data, not only over curl.

---

## The details lookup outlives the request — built 2026-08-06

`POST /api/research/:id/details` answers in about **0.28s** with a run id and
does the Claude web search under `executionCtx.waitUntil`. It used to `await`
the call inline: tens of seconds held open, and a dropped connection paid for
the search and lost the answer.

| Piece | Where |
|---|---|
| `research_run` redefined — `details` tier, `result_json` | `migrations/0018_details_runs.sql` |
| `RUN_TIERS` | `packages/core/src/constants.ts` |
| `DetailsRun` | `packages/core/src/schemas.ts` |
| `activeDetailsRun`, `latestDetailsRuns`, `finishRun(result)` | `packages/db/src/research.ts` |
| `claimDetailsRun`, `runDetailsInBackground`, `toDetailsRun` | `apps/worker/src/lib/details-run.ts` |
| `POST /:id/details`, `GET /details-runs` | `apps/worker/src/routes/research.ts` |
| The poller | `apps/web/src/pages/DetailsQueuePage.tsx` |

- **Migration 0018 drops and recreates `research_run`.** SQLite cannot alter a
  CHECK constraint, and `tier` was restricted to the three source tiers. That is
  safe only because the table is empty in every environment — **verified
  immediately before running it**, along with `research_finding`, which
  references it. Check again before replaying this migration anywhere.
- **`details` is not a source tier.** `SOURCE_TIERS` is where a claim came from;
  `RUN_TIERS` is what a run was. Nothing may treat `details` as a source.
- **"Could not identify that game" is `done`, not `error`.** A retry would cost
  the same money and return the same nothing.
- **A second request while one is in flight returns the run already working.**
  The page polls; without the guard, one poll landing mid-lookup would buy the
  same answer twice. A run quiet for more than five minutes is closed as an
  error and re-asked, because the subrequest ceiling *terminates* an invocation
  rather than throwing, and a run stuck at `running` would block its item
  forever.
- **One item is one invocation, about eight subrequests.** The arithmetic is in
  the file header. A "fill in these ten" path must **not** share an invocation:
  ten is ~80, past the 50 cap, and the failure is silent.

Verified against the production-shaped local D1 (see above). Three real runs:

| Item | Result |
|---|---|
| 383 Ascension 15th Anniversary | `done` in 19s, 195/562 tokens, 1.5¢, filled *playing time* → `playtime_min = 30` |
| 463 Auroboros | POST aborted at 1s; still `done` in 29s, "Nothing new found." |
| 488 Before the Stroke of Midnight | started from the browser, **page navigated away and fully reloaded mid-run**, landed `done` at 59s and the row updated itself |

That last one is the whole point: 59 seconds is long enough for a phone to lock.

---

## Children inherit from their parent — built 2026-08-08

*"for the fill in details, can we make child objects inherit from the parent. I
dont super care if an expansion or accessory has a different publisher"* —
the owner, which is the whole specification.

`listItemsNeedingDetails` asked every row for the same six facts. Measured
against production on 2026-08-08: **695 of 737 items in the queue, and only 79
of them top-level.** The other 616 were expansions, promos, playmats and dice
trays, at ~1.4¢ of Claude usage each — about **$8.30 to answer questions like
"who publishes the Dice Throne Vanguard dice tray"**, whose answer is already in
the database one row up.

**695 → 78.**

### Which fields inherit, and which deliberately do not

| Field | Inherits | Asked of |
|---|---|---|
| `publisher` | **yes** | rows with no parent |
| `publisherUrl` | **yes** | rows with no parent |
| `yearPublished` | no | base games |
| `minPlayers` / `playtimeMin` | no | base games |
| `description` | no | base games |

- **publisher / publisherUrl** — the owner's instruction, and nearly always
  right. `publisherUrl` matters twice over: it is what the official research
  tier needs before it can run, so inheriting it makes a child researchable for
  free rather than merely cheap.
- **year does not inherit.** An expansion published years after its base game is
  the common case, and the year renders in the `<h1>` next to the name — a
  visible false statement, for a fact worth very little. It is not inherited
  *and* not asked for on a child, so nothing is fabricated and nothing is
  bought.
- **Player count and playing time do not inherit**, and this is the one that
  looks safe and is not. An expansion mostly shares its base game's — except
  when it does not, and the exception is exactly the expansion that exists to
  change it. **This catalog holds "Catan: Starfarers – 5-6 Player Extension".**
  Inheriting 3–4 players onto that would be wrong in precisely the case anyone
  would look.
- **description never inherits.** A dice tray is not described by the base
  game's description; copying it would be actively misleading rather than
  merely unhelpful.

### Nothing is written to the 616 rows

Resolved on read, in `resolveInheritedDetails`, and never stored. A stored copy
would assert something nobody verified, would be indistinguishable a month later
from a fact somebody checked, and would go stale the moment the parent was
corrected. Reading it through is reversible and honest — the catalog still says
this playmat's publisher is unknown while the page shows the game's and says so.

A recursive CTE up `parent_item_id`, taking **per field** the first ancestor
with a value, so a hero with a URL but no publisher name supplies the URL while
the name comes from the box above it. Depth-capped at 8: a cycle that got in by
some route `updateItem` does not guard would otherwise hang a read.

### Why a child is asked for *nothing*, rather than asked and satisfied

If a whole ancestry has no publisher, the child is still not queued. Researching
the child does not fix it; researching the **root** does, once, and then answers
for all fifty-three of its children. Queueing the children would pay
fifty-three times for one answer.

A parentless non-base row — an orphan expansion waiting for its game, or one of
the three genuinely standalone accessories — is asked only for publisher and
publisher site. The moment `adoptOrphans` re-parents it, it stops being asked,
with nothing to clean up.

### One decision, one implementation

`packages/core/src/details.ts` holds the policy. The SQL `WHERE` clause is
**generated** from it (`detailGapsSql` in `packages/db/src/items.ts`) rather than
restated, so adding a kind or changing what a kind owes moves the queue, the
"missing:" line under each queue row, and the item page's lookup panel together.
A hand-typed clause would be a second implementation of the decision.

| Piece | Where |
|---|---|
| The policy, and the reasoning per field | `packages/core/src/details.ts` |
| `ItemDetail.inherited` | `packages/core/src/schemas.ts` |
| `resolveInheritedDetails`, `detailGapsSql`, `listItemsNeedingDetails` | `packages/db/src/items.ts` |
| `GET /api/research/needs-details` | `apps/worker/src/routes/research.ts` |
| `Subtitle`, `resolvePublisher`, `LookupDetails` | `apps/web/src/pages/ItemPage.tsx` |
| `.inherited-from` | `apps/web/src/styles.css` |

### Surfaced, not smuggled

The item page shows `Root Works` followed by a muted, linked **"from ZZ Inherit
Root"**. The publisher's website link is only borrowed *alongside* the name — an
item with its own publisher and no URL gets nothing, because that link would
name one company and point at another's site.

The lookup panel used to open a playmat's page with **"No year, min players, max
players, play time, description and cover image recorded"**. It now reads
**"Nothing more is expected of this one"**, with the buttons still there: that
panel is the only per-item way in, and an expansion big enough to want a
description of its own should not have to be researched from the queue.

### Verified against local dev, 2026-08-08

A four-deep chain built through `POST /api/items` and read back:

| Row | Own publisher | Resolved |
|---|---|---|
| Root (base) | `Root Works`, `root.example` | `{}` — roots inherit nothing |
| Hero (expansion, own URL only) | — | publisher ← Root |
| Playmat (accessory, under Hero) | — | publisher ← **Root, two levels up**; URL ← Hero, one level up |
| Sleeve (accessory, under Playmat) | — | publisher ← **Root, three levels up** |
| Orphan expansion (no parent) | — | `{}`, and queued for publisher + publisher site |

The per-field split is the part worth keeping: the playmat's publisher skipped
the hero, which had none, while its URL stopped there. `GET
/api/research/needs-details` listed the base game (year, description) and the
orphan, and none of the four children. **Test rows were deleted afterwards —
local is back to 86 items with no `ZZ Inherit%` leftovers.**

> Production was measured with **read-only** `SELECT`s against the live D1; no
> data-modifying SQL was run. Another agent was writing rows throughout, which
> is why the item total moves between 736 and 737 in this section.

---

## The collection page at 640 items — built 2026-08-07

The page was built for 47 games. The catalog now holds **640 items in 107
groups**, and the list endpoint assembled every matching tree with no paging.

**Measured, against a local D1 seeded to production's shape** (641 items, 107
groups, a 53-child group):

| | Bytes | Gzipped |
|---|---|---|
| `GET /api/items`, before | 444,129 | 26,041 |
| `GET /api/items`, page 1 of 5 | 125,850 | 7,973 |
| median page | 78,775 | 5,519 |

The five pages sum to 444,418 — the difference is `total`/`page`/`pageSize`/
`pageCount` repeated per page, which is the arithmetic working.

| Piece | Where |
|---|---|
| `COLLECTION_PAGE_SIZE = 25` | `packages/core/src/constants.ts` |
| `searchTerms`, `ItemPage`, `ItemNode.matchedChildren` | `packages/core/src/schemas.ts` |
| Paging, term EXISTS, `attachMatchReasons` | `packages/db/src/items.ts` |
| `GET /api/items` (returns the page, not `{items}`) | `apps/worker/src/routes/catalog.ts` |
| The pager | `apps/web/src/pages/CollectionPage.tsx` |
| The collapse control | `apps/web/src/components/ItemTree.tsx` |

**Page size is the server's, not the caller's.** A client able to ask for 500
would be handed exactly the payload this exists to prevent. `total` counts every
match so the header reads "107 games" while showing 25, and a page past the end
clamps to the last one rather than answering empty.

**Search is now one EXISTS per word, ANDed over the tree.** "catan seafarers"
finds the Catan group because the two words are satisfied by two different rows
in it — one LIKE over the whole box needs them adjacent in one field, and
pushing the AND onto a single item row needs one row to hold both. Tree-level
matching is unchanged and still deliberate. A result says *why* when the hit was
on a child, naming only the children that explain the terms the base game does
not. Measured: `q=catan knights` went from 0 results to 1.

**Groups start collapsed above two children.** The control is itself a row, so
collapsing one or two replaces two lines with one line and a click. Open state
lives in a module-level `Map` in `ItemTree.tsx` — the card is unmounted and
rebuilt on every re-fetch, so component state would close what you opened the
moment you came back from a game.

### ⚠️ The trap this nearly walked into

Shelf classification called `/api/items` to get the **whole catalog** to match
spine text against. Paged, that would have matched against the first 25 groups
and reported every other game you own as new — silently, with no error. It now
calls **`GET /api/item-names`** (`listItemNames`, three columns, 41 KB against
640 rows). **Anything that needs every item wants that route, not `items()`.**

`preordered` also stopped sharing `wanted`'s amber: they mean opposite things
about your wallet and the catalog holds 145 of one against 5 of the other, so
the common state wore the colour for "you do not have this". New `--transit`
token, cyan, both themes — 4.79:1 light, 6.82:1 dark.

---

## The four columns that had no UI — built 2026-08-07

Migration 0015 and a bulk import left four populated columns invisible.

| Column | Rows | Shown as |
|---|---|---|
| `item.source_url` | 525 | External link named after its host — "Kickstarter", "Gamefound", "BackerKit" — **beside** the publisher link, never instead of it |
| `item.game_system` | 124 | Badge on the item page and card, plus a collection filter built from the distinct values with counts |
| `copy.format` | 75 digital / 564 physical | A small `digital` tag on copy rows, cards and a parent's child list. `physical` is never labelled |
| `requires` relation | 8 | A sentence at the top of the item page |

**`source_url` is not `publisher_url`.** One is the publisher's own site, the
other is where *this pledge* was made, and an item can have both. The edit form
gives them two fields with two hints for that reason.

**A digital tag appears only when *every* copy is digital** — a book owned in
print as well can still be handed across the table, which is the question this
answers.

### The requires relation is directed, and two things make that true

1. `getRelatedItems` returns **`outgoing`** — which end of the stored row you
   are standing at. Without it the Player's Handbook lists eight supplements and
   has no way to say it does not require them.
2. `createRelation` **does not normalise the id order for `requires`**. That
   normalisation (`lo, hi`) exists so the unique index catches a duplicate
   offered either way round — right for a symmetric claim, and it silently
   inverts this one. The Player's Handbook has a low id and eight dependants, so
   sorting would have had it announcing it cannot be used without each of them.
   `DIRECTIONAL_RELATIONS` in `packages/core/src/constants.ts` is the list;
   `reimplements` arguably belongs in it and was left alone.

It renders as **two different sentences** — "Requires: Player's Handbook" from
the supplement, "Needed by …" from the core book, which never uses the word
requires — and is deliberately left out of the "Related games" list, which would
show it again without its direction.

Verified both ends, and verified that a `requires` created through
`POST /api/items/:id/relations` from a higher id to a lower one keeps its
direction. That is precisely the case the old code flipped.

> **Local D1 was seeded to production's shape to measure this and then cleaned
> back out** — 86 items, 77 groups, 10 copies, as before. To redo it, generate
> rows with `publisher = 'Seed Works'` and remove them with one DELETE. Local
> cannot exercise the 640-item case on its own; do not conclude paging works
> from a 66-item copy.

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

### The rule: never overwrite a cover without keeping what was there

`updateItem` records the outgoing `thumbnail_url` as a printing before it
changes it (`preserveDisplacedCover`). This is the guarantee that makes the
whole feature honest — a Kickstarter image, once nothing points at it, is gone,
so without this a swap to a BoardGameGeek printing would be one-way and "keep
the KS image in the picker" would be a promise the data could not keep.

It lives in `updateItem` and not in the campaign backfill on purpose: a backfill
only protects covers that existed the last time somebody remembered to run it.
The insert is conditional, so swapping between two printings that are both
already recorded costs one read and writes nothing, and swapping back and forth
four times still leaves two candidates. Measured, not assumed.

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

**How hard a missing cover is worth chasing is not uniform** (owner, 2026-08-06):
games and expansions matter a lot, miniatures somewhat, accessories and
components barely at all. `CoverCandidates` therefore carries the item's `kind`,
and the no-candidates message differs — a sleeve pack with no picture is told it
is fine and not worth chasing, while a base game is told to fix it and how. Do
not flatten that back into one sentence.

### ⚠️ Three rows shared one Kickstarter collage — one fixed, two refused

The campaign hero for `dice-throne-x-men-marvel-co-op-missions` shows three
boxes together, and all three catalog rows used it as their cover. The owner
wants the BoardGameGeek art selected with the collage kept in the picker.

| Item | Name | Outcome |
|---|---|---|
| 115 | Marvel Dice Throne: Missions | ✅ **Done.** Matched BGG 403495, cover now the 2025 Roxley printing, collage still offered |
| 96 | Dice Throne: X-Men | ❌ **Refused** — `isFragmentOf` rejects it. Verified by hand as **BGG 403494** "Marvel Dice Throne: X-Men" (2025) |
| 114 | Dice Throne: Deadpool Box Deluxe Edition | ❌ **Refused** — BGG's search returns *nothing* for that full string. Verified by hand as **BGG 403511** "Marvel Dice Throne: Deadpool" (2025) |

**Both refusals are the guard working, not a bug.** 96 fails because
"Dice Throne: X-Men" is a strict word-subset of "Marvel Dice Throne: X-Men", and
that subset rule is what stops "Deep Rock Galactic" taking its expansion's
identity. 114 fails earlier still: BGG's own search finds nothing for
"Dice Throne: Deadpool Box Deluxe Edition", though "Dice Throne Deadpool" finds
403511 immediately.

They were **not forced**, because this project has been bitten three times by
exact-name matches to the wrong game (Brink, Iliad, Moon — all scoring a perfect
1.00). Both rows have a blank year *and* a blank publisher, so the disagreement
guard in `/api/bgg/match/:id` had nothing to check against and name similarity
was the only evidence there was.

The evidence for the two ids above is strong and independent of the name: both
BGG entries are 2025, both are Roxley, and the campaign URL on all three rows
literally reads `dice-throne-x-men-marvel-co-op-missions`. **If the owner agrees,
the fix is to type the BGG ID into the edit form** (`bggId` is an editable field),
then press "Look up printings" in the cover picker and choose the retail cover —
no forcing, no new code, and the collage survives either way because
`updateItem` now preserves it.

> **The accessory split — now built**, see
> [what am I missing](#what-am-i-missing--built-2026-08-06). It lives in
> `game_component.official`, decided by comparing BoardGameGeek *publisher ids*.
> Note that `edition.source` is about *where a printing's record came from* and
> is a different axis entirely — it was deliberately not overloaded to mean
> "third-party", and must not be.

> **Local dev carries one deliberate broken candidate**: item 36 ("Veiled Fate")
> was given a Gamefound `source_url` and a nonexistent `test-cover.png` while
> testing the campaign naming, so its campaign card shows the failure state.
> Alongside the two bad covers from the health work (items 111 and 121).
> Production is unaffected.

**Production, after the first run (2026-08-06).** 457 items, 68 of them with a
`bgg_id`. The BGG backfill added **771 printings across 67 items in 7 requests**
with no failures; the campaign backfill has captured **132 covers** across three
runs, the later ones picking up covers written while the work was in flight.
**186 items now have at least one recorded cover and 53 have more than one** —
which is the number that matters, because those 53 are the games where the
picker has an actual choice to offer. Re-run both after any bulk cover work:
`/api/editions/status` says whether the BGG half has anything left to do.

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
                  editions (printings, and the covers you choose between),
                  components (what else exists for a game, and who made it)
packages/bgg/     BGG XML API2 client (throttled, retried, cached)
packages/barcode/ free resolution: gameupc.ts, upcitemdb.ts, resolve.ts
apps/worker/src/lib/ resolve-title.ts — the one cached title→candidate resolver
                  cover-check.ts — probes hotlinked covers; run by the cron
                  component-backfill.ts — asks BGG what exists; run weekly by cron
                  edition-backfill.ts — fetches printings from BGG, ten ids a call
packages/research/ Claude calls: client.ts, barcode.ts (paid rung), vision.ts
apps/worker/      Hono routes + Access JWT verification + R2 photo storage
apps/web/         React SPA; lib/camera.ts + lib/scanner.ts hold the iOS work
                  pages/ScanJobsPage.tsx is the photo queue UI
migrations/       0001 … 0016
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
| GET | `/api/items/:id/completeness` | read — what else exists for this game. Cached; never fetches |
| GET | `/api/components/status` | editCatalog — coverage, without a BGG call |
| POST | `/api/components/backfill` | editCatalog — sweep + classify. `?itemId=` `?calls=` `?force=` |
| POST | `/api/components/reclassify` | editCatalog — re-decide official/third-party from stored publishers, free |
| GET | `/api/editions/status` | editCatalog — items still awaiting printings |
| POST | `/api/editions/backfill` | editCatalog — fetch printings from BGG. `?itemId=`, `?limit=`, `?force=` |
| POST | `/api/editions/campaign` | editCatalog — record crowdfunding covers as printings |
| GET/POST | `/api/scan-jobs` | editCatalog — photo queue list and upload |
| GET | `/api/scan-jobs/:id` | editCatalog — single job detail |
| POST | `/api/scan-jobs/:id/enrich` | editCatalog — retry enrichment |
| POST | `/api/scan-jobs/:id/done` | editCatalog — mark reviewed, clean up photo |
| DELETE | `/api/scan-jobs/:id` | editCatalog — delete job and photo |

| GET | `/api/item-names` | read — every item's id/name/kind. The list `/api/items` **cannot** give you, because that one is paged |

`GET /api/items` accepts `q`, `status`, `kind`, `uncatalogued`, `duplicates`,
`gameSystem` and `page`, and answers with
`{ items, total, page, pageSize, pageCount }` — **not** `{ items }`. `total` is
every match, not the page. Page size is fixed at 25 on the server.

`GET /api/meta` answers `{ stats, gameSystems }`.

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
