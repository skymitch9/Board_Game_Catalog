# External APIs — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values, only
> names, endpoints and quotas.
> Last verified: **2026-08-05** by live calls to every service marked ✅ below.

Every third-party service this project talks to. Verified by fetching real docs
and making real calls on the date above — not from memory.

---

## GameUPC ✅

The only board-game-native barcode database. Crowdsourced UPC → BoardGameGeek id.

| | |
|---|---|
| Base | `https://api.gameupc.com/{stage}/upc/{barcode}` |
| Stages | `test` (demo key works, **data wiped periodically**), `dev` (unstable), `v1` (production) |
| Auth | `x-api-key` header. No key → **403** |
| Demo key | `test_test_test_test_test` — `test` stage only |
| Prod key | Email **`gameupc@grettir.org`**. Free; no paid tier exists |
| Quota | 100 new UPCs/day → **429** |
| Query params | `?search=<terms>` overrides the inferred name; `?search_mode=speed\|quality` |
| Write-back | `POST {update_url}` with `{"user_id": "<8+ chars>"}`; `DELETE` undoes |
| Spec | `https://gameupc.com/gameupc-oas.yaml` |

Response: `{upc, name, searched_for, bgg_info_status, bgg_info[], stage, status}`.
`bgg_info[]` entries carry `id` (BGG id), `name`, `published`, `confidence`,
`page_url`, `thumbnail_url`, `update_url`, `versions[]`.

`bgg_info_status` is `verified` (human-confirmed) or
`choose_from_bgg_info_or_search` (show a picker).

**Gotchas that cost real time:**
- "No idea" is the **literal string `"None"`**, not `null` or an absent field.
- `published` is a **string** (`"1995"`), not a number.
- `versions[]` is *every* BGG version, not the matching one — Catan returns 136.
  Taking `versions[0]` labels a US retail scan "Arabic/English edition".
- `confidence` is a number on an undocumented scale. Observed 16 (weak name
  guess) to 87 (confirmed). Band it; don't imply precision.

---

## UPCitemdb (trial tier) ✅

General retail barcode database. Doesn't know what a board game is, but has the
broadest coverage and gives you a product **title**.

| | |
|---|---|
| Endpoint | `https://api.upcitemdb.com/prod/trial/lookup?upc=<code>` |
| Auth | **None — no key, no signup** |
| Quota | 100 requests/day, 6/min burst, **per IP** |
| Errors | Arrive as **HTTP 200** with a `code` in the body (`EXCEED_LIMIT`, etc.) |

⚠️ **Per-IP quota means a Worker is one IP for every user** — 100/day is a
whole-app budget, not per-person. Only call it after GameUPC misses.

---

## BoardGameGeek XML API2

| | |
|---|---|
| Base | `https://boardgamegeek.com/xmlapi2` — **no `www.`**, auth breaks with it |
| Auth | `Authorization: Bearer <uuid>` since **July 2025**. Returns 401 without |
| Register | <https://boardgamegeek.com/applications> → non-commercial (free). Approval **"may be a week or more"** |
| Rate limit | ~1 request/sec; server-side only; client-side calls risk suspension |
| Quirk | Answers **202 Accepted** to mean "queued, ask again shortly" |

**Cannot be searched by barcode.** `/search` takes `query` and `type` only.
`productcode` on version records is a publisher SKU, not a GTIN — across Catan's
120 versions, 47 were non-empty and exactly 1 looked like a UPC. BGG is a
*hydration* step, never a *resolution* step.

---

## Anthropic API

| | |
|---|---|
| Model | `claude-opus-5` |
| SDK | `@anthropic-ai/sdk` — **must be ≥ 0.115.0**; 0.65.0 predates `output_config` and `web_search_20260209` |
| Key | `ANTHROPIC_API_KEY` |
| Measured | Barcode identify: **74–137s**, ~$0.0087 tokens + 1 web-search fee |

⚠️ Can return a **transient `400 "Invalid request data"`** on a request shape
that then passes repeatedly. The SDK does not retry 400s. Re-run before
bisecting the schema.

---

## Ruled out (verified 2026-08-05, do not revisit)

| Service | Why not |
|---|---|
| **Bing Web Search API** | **Retired 2025-08-11.** Endpoints return HTTP 410 |
| **Google Custom Search JSON API** | **Closed to new customers** — cannot sign up. Full shutdown 2027-01-01 |
| **Open Products Facts** | 0/4 named hits on board games. It's a food/cosmetics database |
| **Go-UPC** | No free tier; $74.95/mo floor |
| **Barcode Lookup** | $99/mo floor (unverified — site behind Cloudflare challenge) |
