# TODO

Work that is agreed but not built/deployed. Finished work lives in
[`DONE.md`](DONE.md); stable reference lives in [`access/`](access/README.md)
and [`info/`](info/README.md).

**Last updated:** 2026-09-05 — phase 9 landed (the games provisioner + the
`BILLING_SITE` lift) and both items moved WHOLE to [`DONE.md`](DONE.md); one
owner question is left open there (the naming split). Before that:
2026-09-02 — billing phase 3 landed INERT; the soak that
flips it is the item directly below. The two 2026-08-13 **"BUILT, NOT
DEPLOYED"** items left for [`DONE.md`](DONE.md) the same day: both were
verified **already live** in `2e598a9e` (they rode the 2026-09-02 deploys) and
neither needed a deploy of its own. ⚠️ The estate-auth one is at **`enforce`**,
not shadow, and stays there — the reasoning is in its `DONE.md` entry.

---

## ☐ SCAN TARGET: "Adding to · Shelf | Wishlist" on `/scan`, so a scan can land on the wishlist — owner ask 2026-09-04 10:40 Phoenix

Owner, from his phone, verbatim: *"let's add that when you scan something you
can add it to library or wishlist. Do this for both games and the libraries."*

**Read as:** the switch the library catalog shipped this morning on its `/add`
page (`library_catalog/apps/web/src/lib/scan-target.ts` + the *Adding to*
group in its `ScanPage.tsx`) comes to this catalog's `/scan`. The libraries
already have it (both instances, live-verified 10:08); this repo is the open
half. This catalog has ONE instance (`boardgames.heygabi.ai`; no `[env.*]`
in `apps/worker/wrangler.toml`), so "both games" = the games catalog beside
the two library instances, not a second games instance.

**What it is here.** `pages/ScanPage.tsx:231` writes
`api.createCopy(item.id, copyDefaults('owned'))` for every scan, in one
place; `lib/catalog-add.ts`'s `copyDefaults(status)` already takes the status.
The switch chooses `owned` | `wanted` for the sweep, remembered per SESSION
(an errand, not a habit — the library's reasoning, kept verbatim in the new
`lib/scan-target.ts`), default **shelf** (what every scan has written since
the feature existed). Gate: the Wishlist option renders only for
`suggestWishlist` (the same capability `WishlistPage` uses) — without it the
switch is not drawn and the target is pinned to shelf. The row's add-button
and settled-row words follow the target (*Add to wishlist* / *Added to
wishlist*), never "Added" over a want.

**Kept:** the Wishlist page's own door (`WishlistAdd` + `WishlistScan`)
stays the primary way onto the wishlist; this switch is the mixed-basket
case, exactly as on the library.

**Refined ~11:00 Phoenix (⚠️ estimated — the clock was not read between the
10:47 dispatch and a 12:53 read; the owner's two messages fell somewhere in
that gap), owner verbatim:** *"I want to have all scanning be
the same menu and then have the option to add to wishlist or add to catalog.
No need to go to a different route."* Read as: the scanner page is THE scan
menu, and the wishlist-vs-catalog choice lives on it — nobody navigates to
`/wishlist` to scan a want. Consequence for THIS repo: `WishlistScan.tsx` is
a second scan stack (its own camera/file loop, 326 lines) and therefore a
second menu; it should be replaced by the same scanner component `/scan`
uses, pinned to wishlist, the way the library's `AddBookPanel` serves both
doors. Asked whether the wishlist page keeps a door at all; **owner: "Keep
it"** — *+ Add something* stays, as a second entrance to the ONE scanner.

**Part 2, scoped from that answer — ONE SCANNER BEHIND TWO DOORS** (build
after part 1 is deployed; Opus, ~150–250k; the library's `c82eae7` +
`1702768` is the worked precedent):

* Extract the scanner out of `pages/ScanPage.tsx` (~950 lines) into a shared
  component (`components/ScanPanel.tsx`, or whatever this repo's naming
  says): the mode tabs, camera loop, barcode/photo lookups, candidate rows,
  the format and *Adding to* controls, `addCandidate`. Props on the
  library's shape — `{ target, modes, initialMode, onAdded, onFinished,
  onCancel }` — with the target either *switchable* (`/scan`: Shelf |
  Wishlist) or *pinned* (the wishlist door: wishlist, no switch drawn).
* `/scan` renders the panel; that commit must leave the page doing exactly
  what it did (a pure extraction, like `c82eae7`).
* `components/WishlistAdd.tsx` renders the same panel pinned to wishlist in
  place of `WishlistScan.tsx`, which is then deleted — its header records
  the 2026-08 decision reversal; carry that rationale into the panel's
  header, do not lose it. The typed-name path of `WishlistAdd` stays; only
  the scanning part is replaced. ⚠️ The expansions offer after a wishlist
  add (`onAdded(item)` → `WishlistExpansions`) must keep working — it is
  the one behaviour the door has that `/scan` does not.
* One write path: `copyDefaults(copyStatusFor(target))` in exactly one
  place (today: `ScanPage.tsx` `addCandidate` — part 1 — and
  `WishlistScan.tsx:139`, which part 2 removes). `ScanJobsPage.tsx:915`
  (the queue) also creates copies with its own hardcoded status — out of
  this ask's scope, untouched, noted so nobody thinks it was missed.
* Tests: whatever pure logic the extraction exposes, as
  `apps/web/test/*.test.ts`.

☑ part 2 build (`5572fe8` the extraction + `dc62cad` the door) → ☑ tests
(`5572fe8`, `apps/web/test/add-modes.test.ts`, 20 assertions; suite 169 →
189) → ☑ deploy from a clean tree 13:16 Phoenix (`c0b9c340` → version
`3d26cc3f…`, holder fable, 189/189 in predeploy, line in `deploys.log`) →
☑ live proof 13:18 on the owner's signed-in session, bundle
`index-DgSGLDd1.js`: <https://boardgames.heygabi.ai/scan> reads exactly as
before (four tabs, *ADDING TO · Shelf | Wishlist*, same sentence);
<https://boardgames.heygabi.ai/wishlist> — the button is labelled **+ Add**
on this page (not "+ Add something"; the spec line above used the library's
label) → *Add to the wishlist* with **Type it / Barcode / One box**, no
switch (`.scan-target` absent), and the Barcode tab shows "Games you add
here go on your wishlist — a want, not a copy you own." above *Start camera*.
Cancelled without adding. **NOT verified:** any scan resolving or writing a
`wanted` copy (no camera here), the expansions offer after a scanned add
(traced in code only), rendered pixels / the `.wishlist-scan` wrapper's
layout, a `scanBarcode`-less role on the door. → ☐ owner adds one game from
each door on his phone.

### BUILT 2026-09-04 — `5572fe8` (the extraction), `dc62cad` (the door)

**Files.** `apps/web/src/components/ScanPanel.tsx` (new, the shared
scanner) · `apps/web/src/lib/add-modes.ts` (new) ·
`apps/web/test/add-modes.test.ts` (new) ·
`apps/web/src/pages/ScanPage.tsx` (1062 lines → 75) ·
`apps/web/src/components/WishlistAdd.tsx` ·
`apps/web/src/components/WishlistScan.tsx` **deleted** ·
`apps/web/src/lib/scan-target.ts` (one stale cross-reference).

**Shared, and what is not.** `ScanPanel` is the tab strip and everything
under it — camera loop, barcode/photo/shelf lookups, the paid rung, the
*Adding to* switch, the candidate and shelf-review rows, `addCandidate`.
Each door still owns what genuinely differs, and the panel's header carries
the table: the target (`/scan` draws the switch; the door passes
`pinTarget="wishlist"` and gets the sentence with no switch), which tabs
(`lib/add-modes.ts` holds both answers side by side), what happens after an
add, and whether there is a way out.

⚠️ **The two doors gate the barcode tab differently and that was kept, not
tidied:** `/scan` has never gated it (a barcode lookup is `read`), the
wishlist door demands `scanBarcode`. Normalising it would have widened
access on one of the two screens, which is the change that is hard to take
back.

**The one line that writes a copy status**, `ScanPanel`'s `recordCopy`:

```
api.createCopy(itemId, copyDefaults(copyStatusFor(target)))
```

Grepped: `copyDefaults(copyStatusFor(target))` now appears on exactly that
one line in `apps/web/src`. `addCandidate` and the new `wantExisting` both
call it. `ScanJobsPage.tsx:915` (the intake queue) keeps its own
`createCopy` with its own hardcoded status — out of scope, untouched,
named here so nobody thinks it was missed.

**The expansions offer still works.** `WishlistScan` handed back
`(item, message)`; the panel hands back the item and `WishlistAdd` supplies
its own sentence, then sets `added` exactly as before, so
`WishlistExpansions` receives the same `{ id, name }`. Passing an `onAdded`
at all is also what stops the panel navigating to the game it just created.

**Two behaviours restored rather than lost**, both written against the
TARGET, so they also reach `/scan` with the switch on Wishlist: a barcode
resolving to a game already in the catalog offers *Want another* (through
`wantExisting`, which creates no duplicate item) instead of dead-ending;
and the paid ask-Claude rung is not offered over a want.

**The door shows Type it / Barcode / One box.** No *Whole shelf* (a
wishlist is not bulk intake) and no *Manually* (that tab is `QuickAdd`,
whose own copy-status dropdown could contradict the door it stands in — and
the door already has a better typed path). The camera tabs now take their
labels from `add-modes`, so the tab read "Photo" here and "One box" on
`/scan` until today.

⚠️ **NOT VERIFIED.** Nothing was rendered — no browser, no phone, no
camera, no add of any kind, and this app has no jsdom. The expansions offer
is traced through the code, not exercised. What IS evidence: the four moved
helper components diff byte-identical against the old `ScanPage`, the
remaining differences in the extraction are inert with the three new props
absent, `npm test` 189/189, `npm run typecheck` clean across seven
workspaces, `npm run build` green.

**Part 1 (the switch on `/scan`):**

☑ build (`bf98714` + `a955270`) → ☑ tests (`bf98714`,
`apps/web/test/scan-target.test.ts`; the root `test` glob gained
`apps/web/test/*.test.ts` — the first web test in this repo) → ☑ deploy from
a clean tree 12:54 Phoenix (`0ffd112f` → version `8d952922…`, holder fable,
169/169 tests in predeploy, line in `deploys.log`) → ☑ live proof 12:56 on
<https://boardgames.heygabi.ai/scan>, signed in as the owner, bundle
`index-ERLFv-yu.js`: *ADDING TO · Shelf | Wishlist* under the four tabs;
tapping Wishlist changes the sentence to "Scanned games go on your wishlist —
a want, not a copy you own." and writes `sessionStorage.bgc.scanTarget`
= `wishlist`; tapped back to Shelf and left there. **NOT verified:** an actual
scan writing a `wanted` copy (no camera here — the owner's phone scan is that
test), rendered pixels, a non-`suggestWishlist` role seeing no switch. →
☐ owner scans one game to the wishlist.

### BUILT 2026-09-04 — `bf98714` (lib + tests), `a955270` (the screen)

**Files.** `apps/web/src/lib/scan-target.ts` (new) ·
`apps/web/test/scan-target.test.ts` (new) · `package.json` (test glob) ·
`apps/web/src/pages/ScanPage.tsx` · `apps/web/src/styles.css`.

**The one line that changed what a scan means**, in `addCandidate`:

```
- await api.createCopy(item.id, copyDefaults('owned'));
+ await api.createCopy(item.id, copyDefaults(copyStatusFor(target)));
```

Grepped: it is the only place this screen writes a copy status. The other
`owned` hits on the page are a `Badge` tone and the lookup's own "already in
your collection" facts, both untouched.

**Shared, not forked.** `lib/scan-target.ts` is the one place the
target→status mapping and every word live: the row button (*Add* / *Add to
wishlist*), the shelf-photo batch button (*Add 9 games [to wishlist]*), a
settled row (*Added [to wishlist] -- open it*) and the tally. Bulk goes
through the same `addCandidate`, so it inherits the status and the words.
Gate: `suggestWishlist` — the capability `WishlistPage` uses and the one
`routes/catalog.ts:360` demands for a `wanted` copy. Without it the switch is
not drawn AND the effective target is pinned to shelf, so a `wishlist` stored
before a role change cannot write a want.

**Two deliberate differences from the library's copy**, both recorded in the
module's own header: the storage key is `bgc.scanTarget` (this app's
convention, cf. `bgc.coverBannerDismissed`) rather than `lc_scan_target_v1`;
and the switch is NOT drawn on the *Manually* tab, because that tab is
`QuickAdd`, whose form already asks for a copy status outright with a
dropdown that can also say `preordered` or `lent`.

⚠️ **NOT VERIFIED.** Nothing was rendered — no browser, no phone. That the
switch appears, that a tap survives a reload, and that a wishlist scan writes
a `wanted` row end to end are all unproven. `npm test` 169/169, `npm run
typecheck` clean across five workspaces and `npm run build` green are the
whole of the evidence. `ScanJobsPage`'s own `createCopy` (the queue) was left
alone: this ask was `/scan`.

## ☑ SECOND-INSTANCE MACHINERY landed 2026-09-05 — ☐ phase 9: the provisioner's games path

Owner, 2026-09-05 ~06:50 Phoenix, on whether the Games card gets the same "+"
and flow as the Books card: **"Both."** That answer made
`catalog-platform/docs/info/request-a-catalog-design.md` §8 a build section, and
its items 1–3 are this repo's half. They are **done**:

| # | What | Commit |
|---|---|---|
| 1 | `ESTATE_APP` lifted out of source + the same-id build guard | `fc17ea3` |
| 2 | Instance-aware scripts; a bulk secret push that refuses per-instance keys | `30dc045` |
| 3 | A commented `[env.<instance>]` TEMPLATE + its drift guard | `4db2f2e` |

Durable reference (this is where the facts live — do not restate them here):
[`access/second-instance.md`](access/second-instance.md) for how to operate one,
[`info/instance-model.md`](info/instance-model.md) for shared-vs-per-instance and
the measured `RATE_LIMITER` answer.

🔴 **NO SECOND INSTANCE EXISTS**, and nothing here creates one — no D1, no R2
bucket, no hostname, no second deploy. That is phase 9's job.

### ☑ Deployed, and the lifted identity proved live

☑ deploy of the MAIN instance from a clean tree 07:36 Phoenix (`9c1dba6f` →
version `a349aee1…`, holder fable, 220/220 tests in predeploy, line in
[`deploys.log`](deploys.log)). **No migration** — my four commits touch no file
under `migrations/`, checked with `git diff --name-only b4afbee..HEAD --
migrations/` (empty). → ☑ live proof 07:36:
`curl -s -D - -o /dev/null https://boardgames.heygabi.ai/api/health?cb=<ts>`
answered **200**, and the body's new `estate` block reads
`{"mode":"enforce","app":"games","tokenVar":"ESTATE_APP_TOKEN_GAMES","configured":true}`
— the identity resolved from `ESTATE_APP` is the same one the constant used to
assert, and its paired bearer is present. `wrangler deploy` also printed
`env.ESTATE_APP ("games")` in the binding list.

⚠️ **NOT verified, and the owner is the only one who can:** nobody signed in.
`configured:true` says both halves of the config EXIST, not that the directory
accepts the token — only a real `/seen` proves the value. **What to confirm:**
open <https://boardgames.heygabi.ai> signed in as yourself and load one page
(the collection). If a session is watching, `npm run tail --workspace
@bgc/worker` should show `estate enforce: app=games <your email> role=owner …`
— the `app=` field is new. Nothing about who this Worker admits was changed by
this build.

### ✅ Phase 9 — the GAMES path in the provisioner: BUILT 2026-09-05, moved to [`DONE.md`](DONE.md)

`scripts/provision-catalog.mjs` exists, with its runbook at
[`access/provision-catalog.md`](access/provision-catalog.md).
⚠️ **Nothing has run past `--dry` and no second instance exists** — the first
real run is the owner's, and it is the test.

**The one open thing it left, and it is the owner's to answer:** ☐ whether the
naming split should be (a) as built (env/Worker follow the person; D1, bucket,
covers host and app id ordinal), (b) all ordinal, or (c) all follow the person.
Both provisioners are built to (a) so the pair agrees, and all of it lives in
one function (`deriveNames()`), so a flip is one function.

### ☐ One follow-up this build deliberately did not do

(The other, `BILLING_SITE`, was lifted on 2026-09-05 as phase 9's first commit —
the item moved **whole** to [`DONE.md`](DONE.md).)

* **No donor, no peers.** There is no `DONOR_URL`, no `PEERS`, no donor route
  here. For the libraries, "no Claude key on either side" still leaves a free
  donor sweep healing against the main library; for games, **no key means no
  self-healing at all**. ⚠️ The Accept panel must therefore not reuse the books
  sentence on a games row (design §7.6) — that mockup line is true for books and
  false for games.

## ☐ Billing phase 3 is deployed but INERT — the soak, then the flip (2026-09-02)

All seven money paths are gated (`5150269f` live as `2e598a9e`; the build is in
[`DONE.md`](DONE.md)) and **`BILLING_POLICY = "off"`**, so nothing has ever
resolved, logged or refused.

### The one-line change

`apps/worker/wrangler.toml`, in `[vars]`, beside `ESTATE_AUTH_URL`:

```
- BILLING_POLICY = "off"
+ BILLING_POLICY = "shadow"
```

⚠️ **`apps/worker/src/lib/billing-gate.test.ts` reads that file and FAILS
unless it says `"off"`** — deliberately, so a flip cannot ride along on an
unrelated deploy (design §4.2). Update the assertion **and the comment block
above the value** in the same commit; a second test fails if the prose stops
naming the value, which is §6.1 defect 3's tripwire applied to this flag.

🔴 **`BILLING_POLICY` is NOT `ESTATE_CHECK`.** That one is already `enforce`
and answers *"is this person still a member"*. This one answers *"may this
person spend"*. Reading the first as licence to flip the second is the mistake
the test's second assertion exists to prevent.

### Reading the soak

```
npm run tail --workspace @bgc/worker      # then: '"evt":"billing_policy"'
```

⚠️ **These lines are JSON, unlike this repo's prose `estate shadow:` lines** —
a money soak is counted and filtered, not read by eye. Each carries
`would_deny` **and** `proceeded`; the second is the field the estate paid to
learn it needed
(`catalog-platform/docs/info/audiobook-auth-soak-2026-08-16.md`: a soak whose
criterion cannot be falsified is not a soak). The cron's lines carry
`"principal_kind":"system"`, so G7 can be counted separately from the six
request paths.

### Flip shadow → enforce only when BOTH hold over ≥ 7 days (§4.2)

1. **Zero `"would_deny":true`** on any feature the owner did not switch off.
2. ⚠️ **At least one `"would_deny":true`** on a feature he DID switch off.
   Without this half, "zero denials" is indistinguishable from "the instrument
   never ran" — the exact `0 of 0 — unmeasured, not clean` verdict the
   audiobook auth soak reached.

⚠️ **Nothing can be measured until a rule exists.** The `billing_policy` table
has no row for `games` today, so shadow would log a stream of
`would_deny:false`, satisfy criterion 1, and fail criterion 2 forever. Write
the throwaway deny FIRST, from the Spending panel on
<https://heygabi.ai/admin/>. ⚠️ A change takes effect within **10 minutes** —
the same number as the revocation delay, and the same number on purpose.

### The cheapest first test, if you want one

Switch **`sweep.details`** off for `games` with `principal_kind = system`. It
is the only unattended biller here, it fires on the hour so evidence arrives
without anyone clicking anything, and it is the row the design's §7.1 draws
with a clock icon rather than a person icon.

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

## Notes from the 2026-08-09 session

⚠️ **This heading is a CONTAINER, not a work item.** The `###` sections below
were swept in from `HANDOFF.md` on 2026-08-21 and are a record of that day, not
a queue. They used to hang under a heading called *"Superseded note — marking
things sold or given away"*, which was a genuine open item and has now shipped —
it moved whole to [`DONE.md`](DONE.md) on 2026-09-02 together with the
`ON HOLD — disposal & copy history` item above it. Read a body before moving
anything else out of here; the headings are the half that goes stale first.


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
