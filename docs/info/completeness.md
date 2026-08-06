# What am I missing — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-06**.

Accessory and expansion completeness: *seven expansions exist, you have four,
here are the three you do not*. The last clause is a shopping list, and it is
the only reason this exists.

Current state and what was deployed live in [`../HANDOFF.md`](../HANDOFF.md).
This file holds the design facts that will still be true in six months.

---

## The shape

| Piece | Where |
|---|---|
| Tables `game_component`, `component_check` | `migrations/0016_game_components.sql` |
| The two decisions — official? held? | `packages/core/src/completeness.ts` |
| Storage, reads, the split recompute | `packages/db/src/components.ts` |
| BoardGameGeek fetching, budget, cron constant | `apps/worker/src/lib/component-backfill.ts` |
| Backfill / status / reclassify routes | `apps/worker/src/routes/components.ts` |
| `GET /api/items/:id/completeness` | `apps/worker/src/routes/catalog.ts` |
| The UI | `apps/web/src/components/Completeness.tsx` |
| Mounted on the item page | `apps/web/src/pages/ItemPage.tsx` (roots only) |

`packages/core` has a load-bearing import order and `completeness.ts` sits after
`barcode.ts` in it. It imports `isConfidentMatch` and `titleSimilarity` from
there and **nothing from `index.ts`** — see [`../../CLAUDE.md`](../../CLAUDE.md).

---

## Cached, never live

Measured 2026-08-05 against production: **83 rooted games with a `bgg_id` list
1,148 components** between them (680 expansions, 468 accessories, 1,120 distinct
BoardGameGeek ids).

Looking that up on demand would mean a ~1.1s BoardGameGeek call per item-page
view, would go blank whenever BGG did, and — the real point — could never notice
that *something new had been published*. A stored history can. That is the half
of this feature the owner cannot get by remembering.

Nothing in the read path ever fetches. `GET /api/items/:id/completeness` reads
rows and returns.

---

## Two passes, because a link carries only an id and a name

```xml
<link type="boardgameexpansion" id="321259" value="Here to Slay: Warriors &amp; Druids Expansion"/>
```

That is everything a game's own `/thing` response says about its components. No
publisher, no year, no image. So:

1. **The game sweep** — 20 games per `/thing` call, yielding every component
   link plus the game's own publisher list. Cheap, and the only pass that can
   discover something new. 83 games = 5 calls, 5.5 seconds.
2. **The classification sweep** — fetch the components themselves, 20 per call,
   for their publishers. 1,120 distinct ids = ~56 calls, so it rotates.

### ⚠️ Twenty ids is a hard ceiling, not a guideline

Measured: `/thing?id=` with **36 ids answers `400 Bad Request`** — no partial
result, no warning. A caller batching "about twenty" reads that as BGG being
down.

`MAX_THING_IDS` in `packages/bgg/src/client.ts` is the number, and `things()`
now chunks anything larger rather than failing. That fixed a live silent bug:
`hydrateFromBgg` in `packages/barcode/src/resolve.ts` passes however many
candidates a search produced, GameUPC has returned 101 for one search, the call
400'd, and the `catch` treated it as an outage — every candidate went
un-hydrated with no error anywhere.

Callers inside a Worker's subrequest budget should still batch explicitly, so
the arithmetic stays visible.

---

## Official versus third-party

**Compare publisher ids, not names.** BoardGameGeek publishers are linked
entities, so "Rebel Sp. z o.o." is id 7466 wherever it appears. Comparing ids
removes the whole class of bug where a legal suffix or a rebrand turns an
official expansion into a third-party one. Both sides' full lists are stored as
JSON (`game_component.publishers`, `component_check.publishers`).

Any overlap counts as official, because both lists are full of localisation
houses and a component is usually credited to a subset.

### The rule, and the two edge cases that matter

| Component publishers | Game publishers | Verdict |
|---|---|---|
| overlaps the game's | real | **official** |
| no overlap | real | **third-party** |
| only `(Web published)` / `(Self-Published)` / `(Unknown)` | real | **third-party** |
| anything | none real | **null** — unclassified, counted nowhere |

Names in parentheses are how BGG writes "we do not know", not identities. Two
self-published things share that link and nothing else; letting them match would
mark a stranger's insert as official.

**170 of 1,137 local components sit in the third row** — "Alaska (fan expansion
for Ticket to Ride)" among them. Leaving those unclassified parked a seventh of
the data in "we do not know" and made every count look partial. A fan expansion
against a game with a real publisher is confidently not official.

### It matters far more than "inserts and sleeves"

Ark Nova, measured:

- **24 accessories, exactly one official** — Portal Games' wooden tokens. The
  rest are Folded Space, Laserox, e-Raptor, Eurohell, reDrewno, Sloyca…
- **7 "expansions", three of them third-party** — Kekpop Spiele's 3D upgrades
  are typed `boardgameexpansion` by BGG. Anyone assuming the split is an
  accessory-only problem gets Ark Nova wrong by three.

Across the whole local catalog: **665 official** (422 expansions, 243
accessories) against **472 third-party** (203, 269).

### The split is recomputable for free

`POST /api/components/reclassify` re-decides every row from stored publishers
with **no BoardGameGeek call**: 1,137 rows in 0.57s, measured. That is the whole
reason the publisher lists are columns rather than transients — if the rule
changes, or a list is corrected by hand, one request makes everything agree.

---

## Matching what exists against what is owned

**A BoardGameGeek id is the only thing that proves ownership.** Everything else
is a hint.

| Evidence | State | Counts as |
|---|---|---|
| `bgg_id` matches, and a copy is `owned` / `lent` / `preordered` | `held` | held |
| `bgg_id` matches, only `wanted` copies | `uncertain` | missing — "Already on your wishlist" |
| `bgg_id` matches, no copy recorded | `uncertain` | missing |
| name clears `isConfidentMatch`, no id on our row | `uncertain` | missing — "matched on name alone" |
| nothing | `missing` | missing |

A false "you already own this" silently costs a purchase the owner wanted; a
false "missing" is a visible annoyance they can correct in a glance. So
`uncertain` is counted as missing, and shown beside the figure as
*"N possibly already yours"* rather than folded into it — which also points at
the fix: set the id.

`preordered` counts as **held**: it is money already spent on a box in the post,
and putting it back on a shopping list is how a thing gets bought twice.

### ⚠️ Strip the game's name before comparing

Every one of Here to Slay's 36 components begins "Here to Slay", and so does
every row filed under it — three words agree before anything meaningful is
compared.

Measured, matching full strings:

| Component | Hinted at | Score |
|---|---|---|
| Central Play Mat | Warriors & Druids Play Mat Set | 0.71 |
| 6-Class Meeple Set | 6-Class Dice Set | ≥0.7 |
| Dragon Class Meeple Set | 6-Class Dice Set | ≥0.7 |
| Here to Sleigh: A Here to Slay Expansion Pack | KS Exclusive Monster Expansion Pack | ≥0.7 |

**Nine hints, eight of them wrong.** Comparing only what follows the game's name
leaves **one**, and it is the genuine pair — an identically named meeple set.

This is not a second similarity function; `isConfidentMatch` still makes every
decision. It is the same trick `classifyShelfResults` uses on spine text: the
part of a title that says *which* product this is comes after the game's name.

### ⚠️ Best candidate, not first

`owned.find(...)` took the first row that cleared the floor. In a family where
many rows clear it, list order decided the winner — which is how "Dragon Class
Meeple Set" got hinted against "6-Class Dice Set" while an identically named row
sat further down. Ranked by `titleSimilarity` now.

---

## Three states, and they must stay distinguishable

525 of 640 catalog rows are not on BoardGameGeek at all — Kickstarter promos, a
Pangea table's nineteen furniture components, seventy-five D&D Beyond books.
Telling their owner they own everything that exists, on the strength of never
having looked, would make this feature actively misleading.

| `state` | Reads as |
|---|---|
| `not_on_bgg` | "**No data.** Not matched to BoardGameGeek — which is not the same as owning everything." |
| `never_checked` | "**Not checked yet.**" |
| `not_found` | "**No data.** BoardGameGeek returned nothing for id N." |
| `checked` | The figures. |

`component_check` exists precisely so "no components found" and "nobody looked"
are different rows. Without it the distinction would have to be inferred, and
the inference would be wrong.

---

## Nothing is ever deleted

A component that stops appearing on BoardGameGeek is stamped `stale_at` and
stays, shown dimmed and labelled *delisted*, counted in no denominator.

**A row vanishing from the missing list is indistinguishable, from the owner's
side, from their having bought the thing.** That is a claim about their shelf we
would be inventing. A stale row that reappears is un-stamped, so a BGG hiccup
heals itself on the next sweep.

---

## The budget

| Constant | Value | Why |
|---|---|---|
| `MAX_THING_IDS` | 20 | BGG's hard ceiling — 36 answers 400 |
| `RUN_BGG_CALLS` | 8 | 50 subrequests on the free plan; a 202 retries 4× so one call can cost 5. 8 × 5 = 40, leaving room for D1 |
| `GAME_CALLS` | 5 | 100 games — every eligible game today — leaving ≥3 calls (60 ids) for classification. Unused game calls fall through |
| `COMPONENT_REFRESH_DAYS` | 7 | Matches the cron |

Least-recently-checked first, never-checked first of all, exactly as the cover
check walks URLs. Measured: a full-budget run with the sweep already done spends
all 8 calls on classification and clears 160 ids; a run with nothing to do makes
**zero** calls.

### The cron

```toml
crons = ["*/30 * * * *", "41 5 * * 1"]
```

Monday 05:41 UTC. Weekly is as often as "a publisher announced something" can
change and still be worth hearing. Minute 41 keeps it off `:00` and `:30`, where
the cover check lives — two invocations in the same minute would compete for the
same subrequest budget.

**One `scheduled` handler, dispatched on `event.cron`.** Workers offers no
second export. `COMPONENT_REFRESH_CRON` in `component-backfill.ts` must stay
character-identical to the `wrangler.toml` entry; a stray space would silently
route the weekly refresh into the cover check and nothing would say so.
Anything unrecognised falls through to the cover check rather than doing
nothing.

---

## Wishlist from missing

The "+ Wishlist" button is `POST /api/items` followed by
`POST /api/items/:id/copies` with `{status:'wanted'}` — **the two write routes
that already exist, and no third**. Same rule the wishlist and cover picker
follow: a second way to change a copy's status is a second thing to keep
correct.

The loop closes visibly. Once added, the component matches by BoardGameGeek id
on the next read and returns as `uncertain` reading *"Already on your
wishlist"* — still counted as missing, because it still is. Verified end to end.

The button is hidden when `matchedItemId` is set: the catalog already holds a
row, and creating a second would fail on the unique `bgg_id` index.
