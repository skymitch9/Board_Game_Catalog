# Making Lookups Cheaper — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Not built — this is a plan.
> Last verified: **2026-08-05**. Figures marked *measured* came from live calls
> during this project; pricing came from vendor docs on this date.

Where money and time actually go, and the one change that would move the needle.

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
