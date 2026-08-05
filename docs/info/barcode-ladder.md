# Barcode Resolution — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-05** — hit rates below are from live calls, not
> estimates. Endpoints and quotas: [`../access/external-apis.md`](../access/external-apis.md).

## The problem

Barcodes are a **weak primitive for board games**, which is not obvious until
you measure it:

- Kickstarter and small-publisher editions frequently have no retail barcode in
  any database at all
- The barcode is often on shrink-wrap that is long gone, or on a distributor
  sticker
- Retail UPCs get reused across printings

Meanwhile the *title* is printed on the box in 40-point type. Keep that in mind
before adding weight to the barcode path.

## Why a ladder

Each rung is strictly more expensive than the one above it, so the design rule
is: never pay for a rung until the cheaper ones have missed.

| Rung | Source | Cost | Latency | Gives you |
|---|---|---|---|---|
| 0 | local `edition.barcode` | free | instant, offline | The exact item you own |
| 1 | GameUPC | free, 100/day | ~1s | A **BGG id** |
| 2 | UPCitemdb → GameUPC `?search=` | free, 100/day per IP | ~2s | A BGG id via a retail title |
| 3 | Claude + web search | ~$0.009 + search fee | **74–137s** | Ranked guesses |

The latency column matters as much as the cost column. Rung 3 taking over a
minute is why it lives behind its own route (`POST /api/barcode/identify`,
capability `runResearch`) rather than running automatically — nobody standing at
a shelf should wait two minutes without having asked for it.

## Measured hit rate

Four real games, 2026-08-05:

| Barcode | Game | Rung 1 | Rung 2 |
|---|---|---|---|
| 029877030712 | Catan 5th ed. | ✅ `verified`, BGG 13 | — |
| 644216627622 | Wingspan: European Expansion | ⚠️ 9 candidates, correct at #1 | — |
| 192165096971 | Wingspan | ❌ | ✅ correct at #1 |
| 635405670338 | Brass: Birmingham | ❌ | ✅ correct at #1 |

**GameUPC alone: 2/4. With rung 2: 4/4, entirely free.** Rung 2 is the highest
-leverage part of the whole design and it costs nothing — it exists purely
because UPCitemdb knows retail titles and GameUPC can search by title.

## Why rung 2 works

UPCitemdb returns a shelf-listing title:

```
Asmodee CATAN Studio CN3071 Catan 5-6 Player Extension Board Game Ages 10+
```

`cleanRetailTitle()` strips the furniture (ages, player counts, playtimes,
distributor SKUs, the word "game") to leave a usable search term, which goes
back to GameUPC's `?search=` parameter. GameUPC then resolves it to BGG
candidates.

**Two rules learned the hard way:**

1. **Never strip the publisher name.** In this hobby the brand often *is* the
   game — CATAN Studio makes Catan, Stonemaier makes Wingspan. Stripping the
   brand turned the title above into "Asmodee Extension". A redundant word costs
   a search nothing; a missing title costs it everything.
2. **The cleaned string and the displayed string are different jobs.** Cleaning
   is aggressive enough to produce unreadable output
   (`"Wingspan - A Bird-Collection, Engine-Building Stonemaier for , +"`). Search
   on the cleaned one, show the user the raw one.

## Design invariants

- **Every rung answers in one shape** — `BarcodeCandidate` in
  `packages/core/src/barcode.ts` — so the route and the confirm screen never
  branch on which rung answered. `source` rides on each candidate so a merged
  list stays honest.
- **Nothing writes without a human.** Every rung produces *candidates*.
  `POST /api/barcode/link` is the only route that writes.
- **A rung failing degrades, never breaks.** A scan in a shop with bad signal
  should return fewer candidates, not an error page. `resolve.ts` catches per
  rung and reports what happened in `trace`.
- **BGG hydration is optional by design.** Without `BGG_API_TOKEN`, candidates
  keep GameUPC's own name and thumbnail; `trace` says `no token — bypassed`.
- **Confirmations flow both ways.** A confirmed scan writes back to
  `edition.barcode` *and* to GameUPC, so the local table and the shared database
  both improve. Contributions are keyed by a **SHA-256 hash of the user's
  email** — a third party has no business learning who is in this household.

## Why `read`, not `editCatalog`, on the lookup route

Looking a barcode up to check whether you already own something is a *browsing*
action, and it is the single most useful thing to do while standing in a shop.
Gating it behind edit permission would make the app useless to a `rater`.
