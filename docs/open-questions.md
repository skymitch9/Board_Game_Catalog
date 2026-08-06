# Open questions — for review

> Written 2026-08-06 at the end of a long session. Everything here is either a
> decision only you can make or a task only you can do. Nothing is blocked on me.
> Delete this file once it is worked through.

## Where the catalog stands

| | |
|---|---|
| items | **760** |
| copies | 532 owned · 204 preordered · 25 wanted |
| with a cover | **425** |
| boxed items still blank | **18** (base + expansion) |
| scan jobs waiting to be sorted | **6** |
| cover-health probes recorded | 120, cron running every 30 min |

---

## 1. Cover exceptions — needs your approval, item by item

**See [`covers-wanted.md`](covers-wanted.md)** (being written by an agent as this
is filed; if it is missing, the agent had nothing to propose).

You asked that the two image rules stay as rules, and that any deviation be an
exception you approve rather than a new policy. So the defaults are unchanged:

- durable sources only — BoardGameGeek, Shopify, publisher origin
- the image must be **of that exact product**

Two kinds of candidate need your yes:

- **Kickstarter-hosted images.** They carry a signed, expiring URL and will 404
  eventually. The cover-health cron would flag it when it happens.
- **Borrowed art** — e.g. a retail printing's cover standing in for the
  Kickstarter-exclusive one. Your Binding of Isaac suggestion. If approved, no
  `bgg_id` is attached (borrowing a picture is not an identity claim) and the
  copy note records that the art is a stand-in.

14 of the 18 blanks are Kickstarter-exclusive expansions with no retail listing
and no BGG entry, so most will need one exception or the other.

Known dead ends, listed so you know they were tried: **HELLDIVERS 2: Mystery
Expansions** (no such product exists in the campaign — a placeholder for
unrevealed content), **Starlight Arcana: Quickstart Box** (publisher's Wix store
403s on hotlink), **D&D Beyond Basic Rules** and **Unearthed Arcana** (D&D Beyond
publishes no cover for either).

---

## 2. Things only you can do

**Sort the six scan jobs.** Your shelf photos are at `review`. The three that
stalled finished on their own with 73, 74 and 36 titles.

**Count the Dice Throne playmats.** The only evidence that can settle whether you
own the 2020 webstore hero mats. **11** means the Season 1/2 recollection was
mistaken; meaningfully more means those mats explain it and the checklist should
be rebuilt from the physical count. Full working in
`scratchpad/dice-throne-playmats.md`. Confirmed so far: 11 bought, 21 provably
not bought, 22 genuinely unknown.

**Fill the component data**, or leave it — the weekly cron fires Sunday. From a
signed-in browser console, about 8 runs covers the catalog:

```js
await (await fetch('/api/components/backfill', {method:'POST'})).json()
```

`game_component` is empty until then, so "what am I missing" has no data.

---

## 3. Decisions still open

**Dice Throne heroes: keep thumbnails in the related-games list?** They draw at
44px in a list of 55 relatives. An agent is swapping them to WordPress's own
smaller derivatives, which should settle it — but if the list still feels heavy,
dropping thumbnails from that one list solves it completely.

**The Scadrial Pack.** Set to quantity 1 as you asked. If it turns out to
duplicate the four Mistborn books, raise them to 2. Contents were unrecoverable —
the store has closed.

---

## 4. Done overnight — no action needed

- **Deep Rock Galactic: Rival Incursion and Horrors of Hoxxes split into two
  rows**, both with MOOD's own product renders.
- **Mythic Mischief** — 551 renamed to *Volume I*, and Appendix A now links to
  Volume II as well as Volume I, because BGG lists it against both.
- **All five BackerKit near-misses resolved.** Sleeves and meeples were the same
  products under different names; Veiled Fate: Metal Edition became the catalog's
  first `upgrade` row; the ita bag stayed out.
- **Every Dice Throne hero and box has art** — 46 heroes, 11 boxes, 0 blank.
- **The background details lookup is verified in production** — 21 seconds,
  1.5¢, filled Dice Throne: Outcasts' playtime. It was the last unverified piece.
- **Vanguard marked as arrived**, all 17 rows owned.
- Ratings now sit above the relations list; the home page lost two duplicate
  camera buttons; thumbnails lazy-load.

---

## 5. A note on my own errors this session

Recorded because two of them are still worth checking behind.

- I read a pledge tier name as a packing list twice, splitting **Moonrakers**
  into two rows and inventing a second **Deep Rock Galactic** token set. Both
  corrected. **A tier name is a marketing description, not a manifest.**
- I created **20 wanted playmat rows** from a conversational aside rather than
  evidence. The research since suggests the X-Men and Marvel ones are right, but
  they began as my assumption, not your record.
- I characterised your recollection as unreliable on the basis of those two
  errors, which were mine. The playmat research later moved *toward* your
  version, not away from it.
