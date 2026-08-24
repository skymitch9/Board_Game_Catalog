# TODO

Work that is agreed but not built/deployed. Finished work lives in
[`DONE.md`](DONE.md); stable reference lives in [`access/`](access/README.md)
and [`info/`](info/README.md).

**Last updated:** 2026-08-21 — split from `HANDOFF.md` per estate DOCS_STANDARD.

---

## Splitting a shelf photograph into pieces

Raised alongside the enrichment stall, and **would not have fixed it** — worth
recording so nobody spends a day on it for the wrong reason.

Vision reads a wide shelf perfectly well: production job 5 produced all 73
titles and stored them. What ran out of budget was the per-title *enrichment*
afterwards, which is now chunked. Splitting the image would have made vision
cost more and changed nothing about the failure.

It may still be worth doing later for **accuracy** on a very wide shelf, where
spines at the edges are small and skewed. That is a different argument and needs
its own evidence — measure the read rate on a wide shelf before building it.

---

## 🔶 BUILT, NOT DEPLOYED — estate themes adopted + index backstop off the cron, 2026-08-13

Commits `4dcf9b7` (backstop) + `c1880c6` (themes), pushed. Contract additions
landed in canonical `catalog-platform` as `e95a32d`. Deploying is the owner's
step (`npm run deploy`); nothing here is live.

| | |
|---|---|
| Themes | The app styles against the estate `--et-*` contract (guide: `catalog-platform/docs/info/estate-themes.md`). **Retro — this app's own look, extracted verbatim — stays the default** (`data-default-theme="retro"`); apple/cyberpunk selectable in the cog's new Theme group. Storage moved to `hg_theme`/`hg_mode` with a migrate-once from `bgc-theme` in index.html; `bgc-theme` is never written again |
| Vendored assets | `apps/web/public/assets/` — estate-theme.css + theme.js from catalog-platform `cba0397` **plus the games-adoption tokens** (same patch as canonical `e95a32d`); Rajdhani Ã—3 + Share Tech Mono woff2 + OFL join the committed fonts. ⚠ï¸ Re-vendoring from canonical ≥`e95a32d` is safe and also brings the `classic` theme; the games cog offers three themes either way until someone adds it |
| ⚠ï¸ Cache | `_headers` gives estate-theme.css/theme.js `no-cache` — they are NOT content-hashed; without that rule the `/assets/*` immutable line would pin the first theme css a phone ever saw for a year |
| Index backstop | No longer rides the half-hourly cron (it silently failed 3 consecutive ticks 2026-08-13 while a manual push with the same token succeeded; tails died before catching it). Now rides request traffic: at most one health GET per isolate-hour, **every /api/\* request logs its backstop decision** — proof is `wrangler tail` + one unauthenticated `curl /api/health`. After-mutation pushes and the cron's other duties untouched |
| Verified | typecheck all workspaces + vite build (⚠ï¸ no test script in this repo); local `wrangler dev` showed `due → skipped (fresh, 836 rows)` then `throttled (next in 60m)`. **Not verified: an attended look at the three themes** — token plumbing is checked (no undefined `var()` anywhere), pixels are not |

---

## 🔶 BUILT, NOT DEPLOYED — estate auth adopted in shadow mode, 2026-08-13

Commit `0077a7a`, pushed. Design:
`catalog-platform/docs/info/estate-auth-design.md` §3.1/§5/§14.5.

| | |
|---|---|
| What | Estate membership check wired into `requireAuth`, gated by `ESTATE_CHECK` (`off` \| `shadow` \| `enforce`) — **committed as `off`, so deploying this is inert** |
| New build dependency | ⚠ï¸ This repo now materialises the canonical `estate-auth` module from the sibling `catalog-platform` checkout — `scripts/sync-estate-auth.mjs` runs as `predev`/`pretypecheck`/`predeploy` and **fails loudly** if the checkout is missing. The old local verifier in `middleware/auth.ts` was replaced by it (behaviour-identical: the hardened bypass came FROM here) |
| Migration | `0026_estate_cache.sql` — two nullable `app_user` columns, plain ADD COLUMN. **Applied LOCAL only; remote apply is a pending owner/dispatcher step**, before the deploy that carries this code |
| Secret | `npm run secret ESTATE_APP_TOKEN_GAMES` (same value the auth Worker holds under that name) — without it, shadow logs `config unset` per request and skips |
| Reading shadow | `npm run tail --workspace @bgc/worker`, grep `estate shadow:`; the lines that matter carry **`WOULD-DENY`** — expect zero for household members before anyone flips `enforce` |
| Default-grant | `viewer` (the smaller guest role, on purpose — rating stays a local upgrade, preserving 0023/0024). Written only in `enforce`; shadow logs the would-grant |
| Untouched | `OWNER_EMAILS` recovery hatch (runs before the estate check), the rate limiter, every route and capability gate |
| Verified | typecheck (⚠ï¸ no test script in this repo) + 11 `wrangler dev` probes against local D1 with a mock `/seen`: off inert; shadow logs revoked as WOULD-DENY while answering 200, rides a stale cache through an outage, would-grants without writing; enforce grants/403s/503s correctly and serves the standing owner through an outage |

---

## â­ï¸ ON HOLD — disposal & copy history

â¸ï¸ **Do not start this, and do not re-ask the `lent` question, until the weekly
usage limit resets.** The owner's instruction, 2026-08-09: *"keep holding the
lent question until the weekly reset happens."* The plan is finished and
waiting; what it needs is a decision, and the decision needs budget behind it to
act on.

📄 **The plan is written: [`info/copy-status-history.md`](info/copy-status-history.md).**
Read it before touching anything; it is the whole design, measured against
production on 2026-08-09.

*"For sold and lent we can mark them as not owned anymore but we should keep a
history of them items. Map this feature for tomorrow's reset."* — the owner.

The four things that decide the shape, all in that doc:

1. **`lent` and `sold` have existed since 0001 and have never been used** — 0
   rows each in production. The feature is not "add statuses"; find out what
   actually stopped the owner before writing a migration.
2. **One question has to go to the owner first.** They said `lent` should stop
   counting as owned. That makes a game lent to a friend reappear on the
   shopping list — the exact "bought twice" failure `preordered` counts as held
   to avoid. Recommendation and both readings are in §2.
3. **"Held" is defined four times in two different ways** across
   `packages/db` and `packages/core`. Consolidate before adding a value.
4. **History must not cascade.** `copy` cascades from `item`, so the obvious FK
   erases the record that you ever owned the thing — the one fact being kept.

---

---

## â­ï¸ Superseded note — marking things sold or given away

*"We also have no way to mark things sold or given away or any statuses
manually. I gave away item 303 since another item covered it and I have many
other games I want to give away or sell. Can we add a way to edit it and then
change its status tag from owned to lent or sold or something. This can be in a
different thread."* — the owner, 2026-08-09. **Not built. Do not start it
without reading this first.**

⚠ï¸ **Half of it already exists, so this is probably not the feature it sounds
like.** `COPY_STATUSES` in `packages/core/src/constants.ts` is already
`['owned','wanted','preordered','lent','sold']`, migration 0001 has the matching
CHECK, and **`CopyEditor.tsx:102` already renders a `<select>` over all five**.
So a copy *can* be moved from `owned` to `sold` today. Find out why that did not
reach the owner before writing any code — the likely answers are
discoverability (where `CopyEditor` is reachable from) or that neither `sold`
nor `lent` means *given away*.

| Known | |
|---|---|
| Item 303 | `The Binding of Isaac: Four Souls - Gold Box Expansion`, copy 298, still `owned` — the owner says it is gone |
| Missing vocabulary | Nothing distinguishes *sold* from *given away*; `lent` implies it is coming back |
| Likely blast radius | A new status value touches `constants.ts`, a CHECK-constraint migration, every `status IN (...)` query, the completeness "held" rule, and the collection filter |

⚠ï¸ The completeness feature reads `owned/lent/preordered` as **held**. Any new
status has to declare which side of that line it sits on, or a game you gave
away starts counting towards "you own 6 of 7".

### Doomlings settled, and the "I have it" button proved correct in production

The Kickstarter **Gold Box** contains the base game plus **five** expansions —
Dinolings (361645), Mythlings (361646), Techlings (376383), Multicolor (376384,
sold as *"Dual Color"*) and The Meaning of Life (376382) — plus the exclusive
community playmat (376377, already held as item 877). Confirmed from the
publisher's own reveal, not inferred from the 2022 clustering:
<https://doomlings.com/blogs/doomlings/gold-box-revealed>

The owner marked all five through the completeness card. **Verified after:
9 Doomlings rows, 0 missing `bgg_id`, 0 broken parent/root links.** That is the
direct evidence for the claim made earlier in this file — the card's "I have it"
button sets the id and nests the row correctly, and it is why raw `INSERT`s were
refused as an alternative when Access blocked the API.

**Owned:** Overlush (item 876) is correct and should stay. **Not owned, and
correctly still missing:** *Overlush Stretch Goals and Rebalance Pack* (406125),
*Upgrade Pack* (376385) and *Doomsleeves* (376378). The owner bought the box
after the campaign closed, so no stretch-goal content ever shipped to them — the
general rule for this catalog, since stretch goals reach backers only.

### The non-English edition filter, shipped — 2026-08-09

| | |
|---|---|
| Live worker version | **`2f1a26a3-c60c-4292-850e-167d58a3935a`** |
| Roll back to | `5e4538ea-2598-4cdc-b4b3-0c04da1f6f93` |
| Commit | `72b0c63` — **no migration**, computed on read |

`isNonEnglishEdition` in `packages/core/src/completeness.ts`, a `nonEnglish`
group on the report, a fourth `<Aside>`. **45 of 672** chaseable official
components move; Catan's expansions fall **84 → 57**, Codenames 29 → 19.

⚠ï¸ **The false positive the owner predicted was real, and it is `die`** — the
German article and the English singular of *dice*. A first cut flagged
`Veiled Fate: Fate Die` and `Veiled Fate: Renewal Die` as German. The fix is the
strong/weak split now in the code: words absent from English flag alone, words
that are also English need a second. Both rows survive, and the split *gained*
three Polish Codenames entries the naive version missed. **Those two names are
the regression test for any future edit to the word lists.**

**What it does not fix, which is most of what is left.** 27 of Catan's remaining
components are English-named regional one-offs — `Catan Geographies: Mallorca`,
`Austria`, `Corsica`. A `Geographies|Scenario` rule was considered and rejected:
`Catan Scenarios: Oil Springs` is a real, buyable mini-expansion in exactly that
pattern. The owner's ruling, and it applies to Monopoly when it lands:
*"some versions have 1 million sub products and we can't win every battle."*

### The bundled-components bypass, shipped — 2026-08-09

| | |
|---|---|
| Live worker version | **`5e4538ea-2598-4cdc-b4b3-0c04da1f6f93`** |
| Roll back to | `a440debc-1781-499b-a37b-105fd8b16bbd` (columns are nullable; old code ignores them) |
| Migration | **0022 applied to production**, `d1_migrations` row written |
| Commit | `0d57fd3` |

⚠ï¸ **`wrangler d1 migrations apply --remote` does not work on this account.** It
answers `7403 — the given account is not valid or is not authorized to access
this service`, the same error `migrations list --remote` gives. **`d1 execute
--remote` is unaffected**, so migrations have to be applied as plain SQL plus a
bookkeeping insert:

```bash
npx wrangler d1 execute board-game-catalog --remote --config apps/worker/wrangler.toml \
  --command "<the ALTER/CREATE statements>; INSERT INTO d1_migrations (name) VALUES ('00NN_name.sql');"
```

Without that final INSERT, the next successful `migrations apply` would try to
re-run it. Verified after applying: 1,437 component rows intact, latest
migration reads `0022_component_manual.sql`.

**Order matters and was followed:** migrate, verify, *then* deploy. The new
`getGameCompleteness` selects `manual_state, manual_note`; deploying that
against the 0021 schema would have thrown *no such column* on every item page in
the catalog.

✅ **Confirmed live by the owner: "What else exists" loads.** That check had to
come from a signed-in browser — Access intercepts every route at the edge, so a
session can verify the schema, the data and the logic against live rows with
`d1 execute --remote` and still not know whether the deployed Worker serves a
page. **Ask for that one page load; do not infer it from a clean deploy.**

### All 17 Dice Throne sleeve components marked bundled — 2026-08-09

*"Run came bundled on all sleeve stuff for dice throne."* — the owner.

**Uncertain rows 13 → 8, and the 8 left are all correct wishlist entries.** The
name-only group is now **empty catalog-wide** — every remaining `uncertain` is
the report saying something true.

Checked first that none was already proven held by a `bgg_id` match (**0 of 17**
were), so nothing traded machine proof for a hand claim. Six of the seventeen
are third-party and land in that group rather than the headline figure; the rest
count. Santa vs Krampus, Mystic Brawler and Alchemist now read **1 of 1
accessories — complete**.

```sql
-- reversal
UPDATE game_component SET manual_state = NULL, manual_note = NULL, manual_at = NULL
 WHERE id IN (16,17,804,812,815,858,863,909,910,1015,1145,1147,1148,1152,1154,1160,1163);
```

The eleven that were never `uncertain` are the point worth noticing: only **5**
of the 17 had a name close enough to be hinted at. The other twelve were plain
`missing`, and no amount of matcher tuning would have surfaced them — which is
the argument for the bypass existing rather than the floor being lowered.

### Ten more `bgg_id`s, and the owner correcting two of my matches — 2026-08-09

Uncertain rows **20 → 13**. The remaining 13 are 8 correct wishlist entries and
the 5 Dice Throne sleeves, which no id can fix (see the section below).

| Item | → | Component | Note |
|---|---|---|---|
| 192 | 429843 | Twisted Cryptids: Cryptid Culture | ours says "Expansion" on the end |
| 254 | 440472 | Slay the Spire: Character & Deck Playmats | **the matcher had this wrong** |
| 258 | 440473 | Slay the Spire: Table Playmat | ours adds "& Carry Bag" |
| 257 | 420682 | Slay the Spire: Beta Art | |
| 162 | 474545 | Deep Rock Galactic: Dice bag | ours says "KS Exclusive Dice Bag" |
| 236 | 422829 | Deep Rock Galactic: Dice Tray | **a bag and a tray are both owned** |
| 495 | 474551 | Deep Rock Galactic: Hidden cave segments | ours says "Randomizers" |
| 423 | 443289 | Cyberpunk: Female V with Mantis Blades | |
| 424 | 443290 | Cyberpunk: V with Mantis Blades | |
| 425 | 429978 | Cyberpunk: Johnny Silverhand **& NCPD** | ⚠ï¸ **not** 430049 |

```sql
-- reversal
UPDATE item SET bgg_id = NULL
 WHERE id IN (192, 254, 258, 257, 162, 236, 495, 423, 424, 425);
```

⚠ï¸ **Two traps, both caught by the owner rather than by the matcher.**

**Slay the Spire.** BGG's `Character & Deck Playmats` (440472) is a *base game*
product, and we own it as item **254**. The name matcher hinted it against item
**127**, `Downfall - Character Playmats` — a different, unreleased product for a
different expansion, which we hold only as a preorder. Both rows lacked an id
and the matcher took the wrong one. Item 127 stays id-less deliberately: BGG
does not list a Downfall playmat yet.

**Cyberpunk 2077.** BGG lists **two** Johnny Silverhand entries — 430049
`Johnny Silverhand` and 429978 `Johnny Silverhand & NCPD`. Ours is the second.
Anything scripted over this family must not take the first hit.

**On "it's a preorder, should we wait?" — no, and the schema already says so.**
`preordered` counts as **held** in `getGameCompleteness`, deliberately: *"money
already spent on a box in the post, and putting it back on a shopping list is
how a thing gets bought twice."* The `bgg_id` records **which product a row is**;
`copy.status` records **whether it has arrived**. They are independent, so
setting an id early costs nothing and loses nothing. All seven Cyberpunk rows
and six Slay the Spire Downfall rows are `preordered` and already counted.

### Every `uncertain` in the catalog, audited 2026-08-09

Ran the real `buildCompleteness` over all **139 checked games** at once — same
method as the Here to Slay diagnosis, three `--json` pulls and one `tsx` script.
**20 uncertain rows exist catalog-wide**, and they are not one problem:

| Group | Count | What it means |
|---|---|---|
| **A** Already on your wishlist | **8** | Correct. Ark Nova ×3, Fractured Sky ×4, Here to Slay ×1. Leave alone |
| **B** In the catalog, no copy recorded | **0** | Nothing in this state |
| **C** Name matched, no `bgg_id` | **12** | The only fixable group — and only *some* of it |

Group C splits again, which is the finding worth keeping:

**Six are genuine** — set the id and they become `held`: Twisted Cryptids
*Cryptid Culture*, Cyberpunk 2077 *Female V with Mantis Blades* /
*Johnny Silverhand & NCPD* / *V with Mantis Blades*, Deep Rock Galactic
*Hidden cave segments*, and Slay the Spire *Character & Deck Playmats*.

**Five are the matcher being loose, and an id would be wrong.** One row —
*Dice Throne: Minimalist Card Sleeves* — is hinted against **three different
components in three different games** (Outcasts/Raveness, X-Men/Wolverine,
Mystic Brawler). It cannot be all three. Same shape for the two Premium Sleeves
rows: a set hinted against a single-hero sleeve. And *Deep Rock Galactic: Dice
bag* is hinted against *Expansions Dice Tray* — a bag is not a tray.

⚠ï¸ **The Dice Throne sleeves are the interesting failure.** `withoutGamePrefix`
strips the *game's* name, but these components are named for a **hero** the game
name does not contain, so what is compared is "Minimalist Card Sleeves" against
"Card Sleeves - Raveness" — mostly shared words describing a product category
rather than a product. Any tightening should be measured against these five
before it is believed.

**And the buttons are not the cause.** 24 of 25 items created in the last two
days carry a `bgg_id`; the two that do not are from 08-07 and read as hand-typed
(`SCALES OF FATE METAL UPGRADE KIT`, `King of Tokyo Playmat`). The Terraria
promo packs added from the card at 23:19 carry 468161/468163 with clean UTF-8
(`E28093`, a real en dash — verified with `hex()` because the console lied about
it once). The one UI path that legitimately makes an id-less row is *"Use
'<name>' anyway"* in the add panel, and that is correct: nothing is known.

### Landed earlier, now deployed by the above

Promos and collectibles are now split out of the completeness figures — the
owner's *"we're getting bogged down by things like promo cards, or limited 1-off
items, random collectible vinyl figures"*. `isCollectible(name)` in
`packages/core/src/completeness.ts`, a new `collectibles` group on the report
shaped like `thirdParty`, and one shared `Aside` disclosure in
`Completeness.tsx` now serving both groups.

Name-based and deliberately rough; the terms and the ones left out are in
[`info/completeness.md`](info/completeness.md). Measured against the local
catalog: 180 of 660 official components move, Terraforming Mars' expansions fall
76 → 19, Mysterium's 8 → 2. Catan barely moves (82 → 80) and that is known —
its regional scenarios say nothing in their names.

**No migration.** The split is computed on read from `game_component.name`, so
a rollback is a plain revert. Verified locally against the real component rows
through `GET /api/items/:id/completeness` and in the browser on items 49, 59 and
109, then re-measured against production before deploying.

Also verified, because it was the owner's question: adding a collectible with
"I have it" creates a **real catalog row nested under the game**, shows an
`owned` badge in the normal Expansions & accessories tree, comes back `held`
inside the disclosure with both buttons gone, and puts *"· you have N"* on the
header. It does **not** move the "X of Y" figure — out of the numerator and the
denominator alike, which is the same bargain third-party has always had.

### ⚠ï¸ Work in flight at the moment this was written

Two agents were still running and their work is **uncommitted in the tree**.
If the session ended here, this is what you are looking at in `git status`:

| Files | What it is |
|---|---|
| `apps/web/src/components/AddRelated.tsx` (new), `ItemPage.tsx`, `ItemForm.tsx`, `ItemPicker.tsx`, `Completeness.tsx`, `RetagPage.tsx`, `styles.css` | One unified add/link panel replacing four overlapping surfaces, plus an `+ Own` button beside `+ Wishlist` on the completeness report |
| `scratchpad/bgg-audit-2026-08-08.{md,tsv}`, `scratchpad/bgg-audit/` | A **read-only** audit of every `bgg_id` — a map to verify before anything is applied. Nothing written to production |

Neither is deployed and neither needs to be. **If any of it looks
half-written, `git checkout --` the file rather than trying to finish it** —
an interrupted agent leaves plausible-looking partial edits, and this repo has
already had one mid-edit `packages/core` state that typechecked and was still
wrong.

`bcdea97` (orphan adoption) landed cleanly before this and **is** committed.

**Nothing else is in flight and nothing needs running to reach a good state.**

Verify the deploy did what it should:

```bash
# should be 18, was 1 before today
curl -s 'https://board-game-catalog.bgc-worker.workers.dev/api/items?q=D%26D' | jq '.total'
```

…except Access intercepts that at the edge, so it has to come from a
signed-in browser console instead — see the "Verifying anything" section of
`CLAUDE.md`. `await (await fetch('/api/items?q=DnD')).json()` should report 18
matching trees, and `?q=players+handbook` should report 2. Both returned **0**
before today.

### Data changed directly in production today, all live

Every one of these went straight to D1 and is already in effect. Reversal SQL
is recorded in the section for each.

| | |
|---|---|
| Item 852 "Here to Sleigh" | was a `base` root; now an `expansion` under Here to Slay (107) |
| Item 826 "The Settlers of Catan" | **deleted** — a real duplicate of item 54 |
| D&D core books (599, 601, 620, 622) | promoted out of the DMG trees to their own roots |
| Items 854, 855 | Fractured Sky: Awakening / Rift, added `wanted` |
| Items 856, 857 | Fractured Sky Metal Starfall Tokens / Neoprene Game Mat, added `wanted` |
| Item 841 "Hypothetically" | researched by hand and filled in |
| **15 `series` labels** | across ~470 rows — see the family sweep section |
| **`same_family` 65 → 90** | 25 edges from the sweep, plus Slam Throne |
| Items **858, 859** | Here to Slay: Warriors & Druids / Berserkers & Necromancers expansions, added `owned` — implied by accessories already held |
| Item **277 deleted, merged into 833** | *Casting Shadows: Expansion Pack* was the campaign name for what retailed as **The Ice Storm Expansion**. Confirmed from the Kickstarter reward tier ("Kickstarter Exclusive Edition + Expansion" → "Casting Shadows Expansion Pack"), and a copy note from 08-06 had already recorded the same conclusion. The pledge provenance moved onto copy 808; Casting Shadows now has exactly two expansions, both linked |
| **`bgg_id` 197 → 232** | 35 audited matches applied in two batches — 23 exact, then 12 near-matches after the owner checked each against its BoardGameGeek page |

### What still wants a person

| | |
|---|---|
| â³ **`game_component` is filling — finish it** | Was 0 all day; the owner started the backfill 2026-08-08 and it is at **1,217 components / 100 games checked**. Roughly 7 more runs of `await (await fetch('/api/components/backfill',{method:'POST'})).json()` from a signed-in console, or the Sunday 05:41 UTC cron does the rest unattended. **Until it finishes, the completeness page reads "Not checked yet" and the collapsible sections built today are invisible** — they are not broken, they have nothing to show |
| **Accessory implies the game — a sweep worth doing** | Proved on Here to Slay: six accessories (Warriors & Druids ×3, Berserkers & Necromancers ×3) existed with no expansion row behind them, and both expansions were real. Now added as items **858** and **859**. You own **221 accessories against 186 expansions**, so this almost certainly holds on other lines. Banner Quest is the control case — accessory *and* expansion both present |
| ✅ **The BGG audit is CLOSED** | All 806 rows audited and resolved. **`bgg_id` coverage went 197 → 232.** Every remaining row without one has a *recorded reason*, not a gap. The map is `scratchpad/bgg-audit-2026-08-08.tsv`; the decision sheet `scratchpad/bgg-audit-review.md` is **spent** — its "nothing has been applied" line is historical. Both are safe to delete once you trust the result |
| ✅ **All five SUSPECT rows resolved** | 114 Deadpool (id is right; see [`dice-throne-shape.md`](dice-throne-shape.md) — the box owns the id) · 496 Yeti or Not (id is the game, our name says which version) · 801 Go Fish (the `Traditional` marker) · 56 and 68 (publisher-spelling noise). **Do not re-open these** |
| ✅ **`copy.edition_id` stays null — settled, not a gap** | The owner, 2026-08-08: *"that'll probably be null forever, it's a hard thing to find and I don't super care to track it down."* 1,063 edition rows exist with 768 BGG version ids, so the catalog knows which printings **exist** and deliberately does not record which one is on the shelf. **Do not re-flag this as missing data.** Consequences, all fine: the cover picker is unaffected (it sets `thumbnail_url`, not `edition_id`), and it independently kills the "grab the closest edition" half of any BoardGameGeek sync — you cannot match a printing you never recorded. Under 1% of BGG users populate that field either |
| Excursion Tiles (117, 118) | share a `series` but have **no `same_family` edge**, so the group card forms while neither item's page mentions the other. One row: `INSERT INTO item_relation (from_item_id,to_item_id,relation) VALUES (117,118,'same_family');` |
| ⚠ï¸ Three orphaned non-base rows sitting as their own roots | 823 Dark Moon: Shadow Corporation (`expansion`, wants nesting under 790), 842 Tiny Epic Dungeons Adventures: The Phantom Voyage (`expansion`, under 840), 830 Scales of Fate Metal Upgrade Kit (`accessory`, under 91) |
| HELLDIVERS 2: Mystery Expansions (item 414) | rename from the box when the pledge ships; deliberately a placeholder |
| Dice Throne playmats | count them on the shelf — see `scratchpad/dice-throne-playmats.md` |
| ⚠ï¸ Excursion Tiles 1 (117) says **2024** | its campaign actually ran **2025-08-06 to 2025-08-27** (543 backers, $24,488), delivering Oct 2025. 2024 has no evidence behind it. **Left alone deliberately** — the owner has settled both these years by hand; it is a one-line `UPDATE item SET year_published = 2025 WHERE id = 117` if they agree |

### Login is now Google SSO — and the email PIN was deliberately kept

Both Access applications (production and the `*-` preview wildcard) accept
**Google and one-time PIN**, with **Apply instant authentication OFF**. That
is a settled decision, not an unfinished step: Instant Auth only skips the
chooser when an application has exactly one login method, so keeping the PIN
costs one click at the chooser and buys a fallback that is visible on the
login page rather than two clicks deep in a dashboard. The owner weighed it
and chose the click. See [`access/login.md`](access/login.md).

Both accounts (`nbaslamking@`, `asprint200@`) are `owner` and survived the
switch untouched — `upsertUserOnLogin` matches on the lowercased email, and
Google returns the same string the PIN flow did.

### BoardGameGeek has no write API — settled 2026-08-08

Asked and researched properly, so nobody spends a day on it again. XMLAPI2 is
GET-only on every documented endpoint; the July 2025 bearer-token change was
authentication for *reads*, with no scopes. The only route that can write a
collection is driving the logged-in site backend (`api.geekdo.com`), which
BGG's own wiki says the XML terms do "NOT cover" and a staff developer says
not to use "outside of the context of just browsing the website".

It would also sync **142 of 573 owned items (25%)** — base games are 114/131,
expansions 27/184, accessories 1/221. And the edition half is unanswerable
regardless, because `copy.edition_id` is null everywhere. **Do not build
this.**

---

## 🔍 AUDIT 2026-08 — confirmed findings

From the estate-wide code audit (2026-08-23). Full severity-ranked table,
evidence and fix notes: [`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md).

**24 confirmed findings: 0 critical · 0 high · 13 medium · 11 low.** No finding
survived verification at critical or high severity — the two the reviewers
rated **high were both adjusted to medium** in refutation. They are the top of
the ranking and are tracked here; all remaining medium/low findings live in the
findings doc, not as checkboxes.

- ☐ **Details sweep exceeds the 50-subrequest cron cap and terminates
  silently** — `apps/worker/src/lib/details-sweep.ts:58`. `SWEEP_LIMIT=8` runs
  ~80–88 subrequests in one invocation; once a backlog exists the sweep dies
  mid-run and the tail never enriches (Claude calls for the items that *did*
  complete are already paid for). Drop the limit to ~4 or chunk across
  invocations. (Reviewed high → medium.)
- ☐ **Batch parent link silently dropped on Whole-shelf add** —
  `apps/web/src/pages/ScanPage.tsx:713`. `addSelected` reads batch-sibling ids
  from React state that its own async `setBatchIds` never updates in-loop, so a
  base game added earlier is invisible to its expansion; a manually-chosen
  sibling parent is dropped and the expansion is stranded root-less. Mirror the
  canonical local-object pattern in `ScanJobsPage.addSelected`. (Reviewed high →
  medium.)

⚠️ One present-tense exposure worth a look even though it verified **medium**,
not high: `/api/export.json` returns **every account's email** to any
`editCatalog` (contributor+) user (`apps/worker/src/routes/export.ts:31`) — see
finding #4.
