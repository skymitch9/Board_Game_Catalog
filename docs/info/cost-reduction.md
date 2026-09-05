# Making Lookups Cheaper — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. The inheritance section is
> **built**; everything below it is still a plan.
> Last verified: **2026-08-08** (inheritance numbers, read-only against
> production D1). The search-API landscape below was last checked **2026-08-05**
> and has not been re-verified. Figures marked *measured* came from live calls
> during this project; pricing came from vendor docs on those dates.

Where money and time actually go, and the one change that would move the needle.

## Done: stop researching what a row can inherit — 695 queued rows → 78

The single largest saving so far, and it cost no API calls at all. The details
queue asked every catalog row for the same six facts; against production that
was **695 of 737 items, only 79 of them top-level**. At ~1.4¢ a row, ~$8.30 of
it was spent establishing that a Dice Throne playmat is published by whoever
publishes Dice Throne.

Anything with a parent now reads `publisher` and `publisherUrl` through from its
nearest ancestor at read time — never written down — and is asked for nothing.
Year, player count, playing time and description are asked only of base games,
and none of them inherit: an expansion's year is usually different, and
"Catan: Starfarers – 5-6 Player Extension" is the standing proof that a base
game's player count is not an expansion's.

The reasoning per field lives in `packages/core/src/details.ts`; the numbers and
what was verified are in
[`../archive/HANDOFF.superseded-2026-08-21.md`](../archive/HANDOFF.superseded-2026-08-21.md#children-inherit-from-their-parent--built-2026-08-08).
⚠️ **Corrected 2026-09-05:** this was an anchor into `../HANDOFF.md`, which has
been a 15-line signpost since the 2026-08-21 split — the anchor had nothing to
land on. The section it names is intact in the archived original, so the link
now goes there rather than being dropped.

**The general lesson, worth applying to the next queue.** The expensive question
was not "what does this row not know" but "what is worth *buying* for this row".
Those are different, and the first one wearing the second's name is what put 616
dice trays in front of a web-search model.

## Measured cost of each path

| Path | Latency | Cost | Notes |
|---|---|---|---|
| Local `edition.barcode` | instant | £0 | Works offline |
| GameUPC | ~1s | £0 | Free tier, 100 new UPCs/day |
| UPCitemdb → GameUPC search | ~2s | £0 | Free, 100/day **per IP** |
| **Barcode → Claude + web search** | **74–137s** *(measured)* | **~$0.009** *(measured)* | The problem |
| Photo → Claude vision | **3–5s** *(measured)* | ~$0.003–0.005 | No web search — answer is in the pixels |
| Title → GameUPC (`/api/lookup`) | ~1s | £0 | Cached a week |

The outlier is stark: **asking Claude about a barcode number is roughly 20×
slower and 2× dearer than showing it the box.** Everything else is already free.

## Why the barcode rung is so slow

`packages/research/src/barcode.ts` gives Claude the `web_search_20260209` tool
and asks it to find the product. That means: the model reasons, issues searches,
waits on each, reads results, reasons again. The searching dominates — the
actual identification is trivial once a page is in front of it.

## The change worth making

**Do the search ourselves, then hand Claude the results.** A dedicated search
API returns in about a second for a fraction of a cent; the model then only has
to read what came back, which is a small, fast, cheap call with no tool loop.

Expected: **~2 minutes → a few seconds**, and cost dominated by a sub-cent search
fee rather than a long tool-using generation.

### Which search API

Verified 2026-08-05 — the landscape is worse than it used to be:

| Service | Status | Price |
|---|---|---|
| **Serper.dev** | ✅ Alive, best value | **2,500 free credits**, then ~$1/1k → $0.30/1k at volume |
| Brave Search API | ✅ Alive | No free plan any more; $5/mo credits, **card required**; $5/1k |
| Bing Web Search | ❌ **Retired 2025-08-11** | Endpoints return 410 |
| Google Custom Search JSON | ❌ **Closed to new customers**, shutting down 2027-01-01 | — |

**Recommend Serper.** The free credits alone cover far more barcodes than this
household will ever scan, and it needs no card.

### Shape of the implementation

1. New `SERPER_API_KEY` secret (optional — without it, fall back to today's
   behaviour rather than breaking).
2. In `packages/research/src/barcode.ts`, replace the `web_search` tool with:
   search the barcode via Serper → take the top few titles and snippets → pass
   them as **text** to a structured-output call with no tools.
3. Keep the existing prompt's honesty rules (ranked candidates, confidence
   reflecting evidence, zero candidates is a valid answer).
4. Feed the resulting title back through `resolveTitle()` so it still lands on a
   BGG id — the same last step every other rung uses.

### Also worth doing, cheaper still

Before any of the above: **try the Serper title against GameUPC's `?search=`
first.** If that resolves, no model call happens at all. Given that the
UPCitemdb→GameUPC chain already took the measured hit rate from 2/4 to 4/4, a
better title source may push the paid rung close to never firing.

## What NOT to do

**Reverse image search.** Investigated 2026-08-05 and ruled out:

- Google Lens has **no public API** — every "Lens API" is a third-party scraper.
- Bing Visual Search died with the rest of the Bing search family.
- TinEye has **no free tier** ($200/5,000) and, more importantly, finds where an
  image *already exists on the web* — a photo you just took never will.
- Google Cloud Vision `WEB_DETECTION` survives at $3.50/1,000 (its priciest
  feature) and its fuzzy half returns web-derived guesses, not catalog ids.

For board games this is solving the wrong problem anyway: the box has a large,
high-contrast title on it, and reading text is both cheaper and more precise than
matching artwork — covers get re-illustrated between printings, titles do not.

The one case where it would genuinely help is identifying a game from components
mid-play with no title visible. Real gap, not worth building for now.
