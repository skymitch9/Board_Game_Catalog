# DONE — Board Game Catalog (dated archive)

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last updated: **2026-09-05** — phase 9 arrived: the games provisioner and the
> `BILLING_SITE` lift. Split from `HANDOFF.md` per estate DOCS_STANDARD on
> 2026-08-21.
>
> ⚠️ **This is an archive, not a living doc. APPEND ONLY.** Nothing here is
> ever edited, re-summarised or tidied. An item arrives exactly once, at
> completion, moved **whole** from [`TODO.md`](TODO.md) — cut and paste, never
> summarised, because the summary always drops the *why*.
>
> - Active/open work → [`TODO.md`](TODO.md)
> - Durable reference → [`info/`](info/README.md)
> - Known issues → [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)

---

## ✅ ANSWERED + BUILT + DEPLOYED 2026-09-05 (agent W5-FAMILY) — the family score

**The owner's answer, 2026-09-05 16:14 Phoenix: (a) — the base-weighted mean.**
Built the same evening, `aef62e8`; docs `8c5557a`; **deployed 2026-09-05T23:36Z
as version `62fc5645-7a2e-4866-b38d-5a195b0d5750`** (roll back to
`7fb197b3-cd74-4b5f-894c-c0e35df4a0d5`). **No migration**, exactly as the
section below predicted: the roll-up is derived on read over relations and
ratings that already existed — so the rollback is a plain version revert with
nothing to undo underneath it.

✅ **Proved live with the right instrument, not a 200.** `/items/96` answers
`HTTP/1.1 200` and `/api/health` reads `database: up`, but neither says the new
code is there. The served bundle does: `/assets/index-CUmNIs2F.js` — the exact
filename this build produced — **contains the string `This family`**, and the
served `/assets/index-CAYYfxGn.css` **contains `.rating-family`**. A hashed
bundle name plus the new string inside it is what makes this a measurement.

**What (a) turned into, in code.** The weights are `FAMILY_KIND_WEIGHTS` in
[`packages/core/src/family-score.ts`](../packages/core/src/family-score.ts) —
**base 6 : expansion 2 : upgrade/accessory/promo 1** — and that file is the only
place the ratio exists. The mean is two-stage: each item averages its own raters
first, then the family averages the *items* by kind weight, so a box two people
rated does not count twice as hard as one only the owner rated. Which rows *are*
the family is the other half, and it lives in
[`packages/db/src/family-score.ts`](../packages/db/src/family-score.ts): the
`same_family` closure walked over **roots**, then every row of every tree in it —
containment (`root_game_id`) and relations unioned, because the catalog says
"belongs together" in both of those ways and using one would answer half the
question.

**The write-up's requirement, as arithmetic.** *"A plain mean lets one poor
accessory drag a great game down, which is wrong."* A 0.5-star playmat costs a
5-star base **0.64 of a star** (4.36) where a plain mean costs it **2.25**
(2.75). Five bad promos still take it to 2.95 — the tail is quiet, not silent.
Both numbers are assertions in the test file, not prose.

⚠️ **The one thing that went red for real, and would have shipped silently.**
The first version of the query walked the `same_family` links row-by-row from
the item you clicked and folded up to roots afterwards. That returns **half the
family** whenever a link hangs off a nested expansion rather than off the base
game — which `/retag` writes routinely, because it asks about the row in front
of you. It looks like a working number, on a page, with fewer members in it.
Caught by `packages/db/test/family-score.test.ts` running the real SQL against a
real SQLite with every migration applied; the case is now a named test.

**Tests 319 → 348** (+29, 47 → 59 suites), typecheck clean across seven
workspaces. The arithmetic half sits in `apps/worker/src/lib/` so it is inside
the deploy gate, and was **proven RED**: setting `base: 1` fails four of them.

✅ **The query was run against PRODUCTION D1** (read-only, 2026-09-05): the
shipped CTE returns **12 trees / 148 rows** for the Dice Throne family from item
96. The collection page's *Dice Throne* series group counts 11 lines / 147 rows,
and the one-tree difference is the point — a `same_family` link reaching outside
the series name is a family member that a name-based grouping cannot see.

🔴 **And the feature is invisible today, measured the same way: `user_item`
holds ZERO rows.** Nobody has ever rated anything in this catalog (838 items, 92
`same_family` links, 0 ratings), so every page returns `score: null, rated: 0`
and correctly prints nothing. The code is live; the data to show it does not
exist yet. ⚠️ This is worth knowing before anyone reports the line as missing.

⚠️ **NOT verified: anything rendered.** No browser and no signed-in session —
`/api/items/:id` needs a Firebase ID token. The live check was `curl -s -D -` on
the item page, which proves the app serves and the deploy landed, and proves
nothing about what the Ratings card looks like. **The owner review is the
verification**, and it is a TODO row, not a DONE one.

**Two riders the owner did not rule on — DEFAULTS TAKEN, both reversible**, and
both recorded as `❓ default taken` lines in [`TODO.md`](TODO.md) where he can
still flip them: the **duplicates filter stays per-entry** (a duplicate is a
physical copy, not a family) and **search surfaces individual entries** carrying
their family score rather than a family row. ⚠️ The second half of that second
default — a family badge **on a search row** — is **NOT BUILT**; the score is on
the item page only. That gap is a `☐` in `TODO.md`.

**The section as it stood in `TODO.md`, moved whole and unedited:**

### ❓ OWNER DECISION — how should a game family's rating be computed?

**Options, from the write-up.** (a) **base-weighted mean** — the base game
counts for more than its expansions, the write-up's own recommendation, derived
not stored, no schema change; (b) **`base` + `expansion` only**, ignoring
accessories and promos; (c) **an explicit family rating** people give by hand
("how good is Catan *as a whole*"). Two smaller questions ride with it: does the
**duplicates filter** treat a family as one thing or per-entry, and does
**search** surface the family or the individual entries?

⚠️ **Surfaced here 2026-09-05 (docs audit); it is not new.** It was raised by
the owner on **2026-08-05** and has sat in
[`info/design-decisions.md`](info/design-decisions.md) — *outside* the work log
— ever since, which is why no `TODO.md` has ever carried it. **The full write-up
stays there and is not repeated here** (one fact, one home): the requirement,
the per-entry-ratings decision that was already settled on 2026-08-05, and the
argument against a plain mean.

🔬 **What changed while nobody was looking, measured 2026-09-05.** That section
described one undecided design; **half of it has since been built**, and the
page did not know. `item_relation` carries `same_family` / `works_with` /
`reimplements` / `integrates_with` (`packages/core/src/constants.ts:264–284`),
family is traversed **transitively** (`packages/db/src/relations.ts:22–63`), and
`/retag` asks the nest-vs-link question per game. **Only the SCORE is left** —
grepped, there is no `familyScore` or `family_score` anywhere in `packages/`,
`apps/worker/src` or `apps/web/src`.

**Blocked on:** the owner's answer. Nothing else. Once (a), (b) or (c) is
chosen, the build is a derived roll-up over relations that already exist and
ratings that are already per-item — no migration.

---

## ☑ CODE LANDED 2026-09-05 (agent W2-GAMES, `1aa3871`) — the three tracked findings of the 2026-08 audit — 🔴 ☐ NOT DEPLOYED

**Commits:** `751980b` (the details sweep's subrequest budget) · `7f75804`
(the batch-parent link + one shared decoder) · `6394cca` (the `/api/export.json`
email exposure) · `1aa3871` (these docs).

🔴 **NOT DEPLOYED — none of the three is live.** The deploy was **refused by
the permission system**, once, and not retried:

```bash
DEPLOY_HOLDER=<you> npm run deploy      # from a clean tree, in this repo
```

**No migration** — `git diff --name-only df0f9c7..1aa3871 -- migrations/` is
empty. `npm run predeploy` (check-clean, deploy-guard, typecheck, 319 tests)
was green when the deploy was attempted, and the tree was clean. The last
`deploys.log` line is still 2026-09-05T14:36Z / `9c1dba6f` / `a349aee1…`, which
does NOT contain any of the three fixes.

⚠️ **Until that command runs, the live Worker still runs an 8-row sweep that
dies mid-tick, still drops batch-parent links, and still hands every
contributor every account's email.** The email one is the reason not to leave
this sitting for long.

⚠️ **Corrected minutes after it was written (same session, before anybody read
it):** this heading said `✅ … all fixed` and this paragraph claimed the work was
*"Deployed in the same sitting as the billing shadow flip"*. Neither the deploy
nor the flip was permitted. Left visible rather than silently rewritten,
because a DONE entry that quietly changed its mind about being deployed is the
single most expensive kind of wrong this file can be.

**Tests 298 → 319**, all green, `npm run typecheck` clean across seven
workspaces. Every one of the three has a test that would have caught the
original defect: the sweep's asserts the *arithmetic* rather than a literal (the
old `SWEEP_LIMIT <= 10` was true of the broken value), the batch-parent one
plays the same batch twice and pins the difference between a synchronous map and
a React-state one, and the export one reads `migrations/` so a new `user_item`
column cannot be silently dropped from the backup.

⚠️ **NOT verified: anything rendered or signed in.** No browser, no phone, no
camera, no export downloaded. This app has no jsdom and every `/api/*` route
needs a Firebase ID token a session does not have. The batch-parent fix in
particular is pinned by pure tests and traced through the code, not exercised
end to end — 🔗 the owner review is one shelf photo on
<https://boardgames.heygabi.ai/scan> (Whole shelf) with a base game and one of
its expansions in the same picture: the expansion should land nested under the
base game rather than as its own root.

**One thing deliberately NOT done, named so nobody thinks it was missed.** The
other 21 findings (11 medium, 11 low) were never `TODO.md` checkboxes — the
section below says so itself — and remain in
[`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md), which now
carries a dated ✅ FIXED line on rows 1, 2 and 4. Finding 5 (`COVER_BATCH = 20`
over the same 50-subrequest ceiling) is the *same class of defect* as finding 1
and is still open; it was left alone because it is not this item.

**Moved whole from `TODO.md`, where it read:**

> ## 🔍 AUDIT 2026-08 — confirmed findings
>
> From the estate-wide code audit (2026-08-23). Full severity-ranked table,
> evidence and fix notes: [`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md).
>
> **24 confirmed findings: 0 critical · 0 high · 13 medium · 11 low.** No finding
> survived verification at critical or high severity — the two the reviewers
> rated **high were both adjusted to medium** in refutation. They are the top of
> the ranking and are tracked here; all remaining medium/low findings live in the
> findings doc, not as checkboxes.
>
> - ☐ **Details sweep exceeds the 50-subrequest cron cap and terminates
>   silently** — `apps/worker/src/lib/details-sweep.ts:58`. `SWEEP_LIMIT=8` runs
>   ~80–88 subrequests in one invocation; once a backlog exists the sweep dies
>   mid-run and the tail never enriches (Claude calls for the items that *did*
>   complete are already paid for). Drop the limit to ~4 or chunk across
>   invocations. (Reviewed high → medium.) ✅ **Re-verified 2026-09-05 (docs
>   audit): still exactly true** — `apps/worker/src/lib/details-sweep.ts:58`
>   still reads `export const SWEEP_LIMIT = 8;`, and the only test guarding it
>   (`details-sweep.test.ts:120`) asserts `SWEEP_LIMIT <= 10`, so it would not
>   notice. **Genuinely unbuilt.**
> - ☐ **Batch parent link silently dropped on Whole-shelf add** —
>   ⚠️ **Corrected 2026-09-05 (docs audit): the file:line moved and this entry
>   would have sent the fixer to a page that no longer contains the code.** It
>   read `apps/web/src/pages/ScanPage.tsx:713`; that file is **75 lines** since
>   the 2026-09-04 extraction (`5572fe8`). The defect is intact and now lives at
>   **`apps/web/src/components/ScanPanel.tsx:1029`** (`addSelected`), read today:
>   `const [batchIds, setBatchIds] = useState(...)` at :1011, the loop reads
>   `batchIds[batchIdx]` at :1051 and `batchIds[parentIdx]` at :1056–1057, and
>   writes `setBatchIds(...)` at :1074 — React state, so nothing it writes is
>   visible to a later iteration of the same loop. A base game added earlier is
>   invisible to its expansion; a manually-chosen sibling parent is dropped and
>   the expansion is stranded root-less. Mirror the canonical local-object
>   pattern in `ScanJobsPage.addSelected` — still there and still correct, a
>   plain `const batchIds: Record<number, number> = {}` at
>   `apps/web/src/pages/ScanJobsPage.tsx:866` written at :960. **The extraction
>   moved the bug into a component BOTH doors now render**, which widens it from
>   `/scan` to `/wishlist` as well. (Reviewed high → medium.)
>
> ⚠️ One present-tense exposure worth a look even though it verified **medium**,
> not high: `/api/export.json` returns **every account's email** to any
> `editCatalog` (contributor+) user — see finding #4. ⚠️ **Corrected 2026-09-05:**
> the line reference read `apps/worker/src/routes/export.ts:31`; the
> `SELECT ui.*, u.email FROM user_item ui JOIN app_user u …` is at **:36** today,
> and the `requireCapability('editCatalog')` that gates the whole router is at
> **:14**. Both were re-read, and the exposure is unchanged.

**What was built, one line each.**

* **Finding 1** — `SWEEP_LIMIT` is now *derived*, not chosen:
  `floor((SUBREQUEST_CAP 50 − SUBREQUEST_RESERVE 3) / SUBREQUESTS_PER_ITEM 11)`
  = **4**, so a full tick costs 47 against a ceiling of 50. It stays a constant
  and not an env var — that is the settled answer to the billing design's §9 Q2
  and is unchanged. The `limit` parameter is clamped to the same ceiling and
  says so in `skipped`, because a caller going round it silently is the whole
  problem. ⚠️ The G7 billing log line's `est_cents` moved `~11/hr` → `~6/hr`
  with it: four rows an hour, not eight, and the soak is read by counting.
* **Finding 2** — `ScanPanel.addSelected` mutates a **local** map inside its
  loop (seeded from state, so a second press of Add sees the first press's ids)
  and keeps the state map for rendering the parent dropdown. The two screens
  encoded "a parent inside this batch" differently — a negative pseudo-id in the
  panel, `batch:<n>` in the jobs page — which is exactly how one copy drifts
  into a bug the other does not have; both are now decoded once in
  `apps/web/src/lib/batch-parents.ts` and both screens resolve through it.
  `ScanJobsPage`'s behaviour is unchanged: it was already correct, and was the
  canonical pattern the fix copies. Two further bugs surfaced while extracting —
  `-(ref + 1)` yields `-0` for `-1`, and `Number('')` is `0` so a bare `batch:`
  resolved to the **first** row of the batch. Both fixed and pinned.
  ⚠️ **Why this survived so long:** the auto-classified half was masked by the
  server's `pendingParentName` reunion, so the screen looked right most of the
  time; the manual-select subcase, which has no name to be rescued by, was the
  real loss.
* **Finding 4** — emails are `manageUsers` (admin and owner) only, the same
  people who already read every address on the People page, so nothing new is
  handed out. ⚠️ **Access-REDUCING, so it needed nobody's permission — and if
  the owner wants contributors to see addresses again it is ONE LINE**:
  `EMAIL_CAPABILITY` in `apps/worker/src/lib/export-fields.ts`. `user_item` is
  now an explicit allow-list, never `ui.*`. ⚠️ `item` / `edition` / `copy` /
  `copy_event` deliberately keep `SELECT *`: this file is a BACKUP, and for
  those four the silent failure runs the *other* way — a migration adds a
  column, a stale allow-list drops it, and the loss is found on restore day.
  The payload gained `omitted: []`, because "no email key" would otherwise read
  as "the accounts had no addresses".

## ✅ The GAMES provisioner — `scripts/provision-catalog.mjs` (2026-09-05, phase 9)

**Moved whole from `TODO.md`, where it read:**

> ### ☐ Phase 9 — the GAMES path in the provisioner
>
> The provisioner (`scripts/provision-catalog.mjs`) is being built in
> `library_catalog` for the BOOKS path (design §10 phase 7). The games path comes
> after it and after this phase, and lands **in this repo**. What it must do is the
> 12-step checklist in [`access/second-instance.md`](access/second-instance.md) §4,
> of which steps 5 (auth-Worker `CONSUMER_APPS` + `vis_games2`) and 9 (Firebase
> Authorised domains, the estate directory row) are 🔴 **MANUAL, owner-only** —
> no CLI reaches them.
>
> ⚠️ **The warning worth carrying, from design §8's close:** a games request can be
> *filed and accepted* the day the shared half ships and cannot be *provisioned*
> until this lands. If those moments are far apart, someone has been told yes and
> is waiting.

**Commits:** `7b6b049` (the `BILLING_SITE` lift below), `b11a373` (the script),
`ad2258c` (74 tests). Runbook:
[`access/provision-catalog.md`](access/provision-catalog.md).

**As built.** Twelve idempotent numbered steps, `--request/--dry/--resume/
--fixture/--instance`, the two PAUSEs, estate-D1 reads run from
`catalog-platform/apps/auth-worker` — the same shape as the books twin, which
is a **deliberate near-duplicate and NOT interchangeable** (different repos,
ledgers, secret sets, and this one has no donor). The script's header carries
that argument in full. Nothing SHARED is a decision: the refusal lists are
imported from `push-secrets.mjs`, the env block is rendered from the committed
template, the identity allowlist is read out of `estate-app.ts`.

**Four things it does differently from the books twin, each for a stated reason.**
🔴 It does **not** deploy — step 11 prints `DEPLOY_HOLDER=<you> npm run
deploy:<i>` and stops, because the deploy carries the owner's name into
`deploys.log` and uploads the working-tree dist; `--resume` sees the
`env=<i>` line and carries on. The env block is **rendered from the commented
template** rather than hand-written, so the drift guard that already protects
that template protects the provisioner too. 🔴 The block is inserted **above**
the template, never at EOF — the guard slices from the banner to end-of-file and
requires every line there to be commented, so an appended block would fail it
and the message would blame the template. And the covers custom domain is a real
CLI step here (`r2 bucket domain add --zone-id`, required non-interactively),
with an **ordinal** hostname (`gamecovers2.`) because `cover-storage.ts` writes
`COVERS_BASE_URL` into `thumbnail_url` rows — renaming it later is a data
migration.

**The key ladder** is design §6.4: sealed reader key → sealed owner key → the
owner's own (standing decision 2026-09-05, logged). The sealed half is a
dynamic import of `catalog-platform/scripts/lib/catalog-seal.mjs` through the
`platform-repo.mjs` locator; absent and `source:'none'` are the same outcome and
different facts, printed differently, and a THROWING inject stops the run rather
than falling through to the owner's money. 🔴 **"No key" on a games instance
means NO AI LOOKUPS AT ALL** — there is no `DONOR_URL`, no `PEERS`, no donor
route — so the run says that instead of the books sentence, and refuses to
finish a real provision with no key.

**Two steps for PAUSE #2 that the books runbook does not have**, found while
lifting `BILLING_SITE`: a `siteForApp()` arm and a `BILLING_SITES` entry in the
auth Worker. Without them that repo does not compile.

**Measured.** Suite **298 pass / 0 fail** (220 before phase 9; 74 of the new
ones are this script's), typecheck clean. `--dry` against the LIVE `estate_auth`
D1: row **#3** `boardgames` refused as already live at
`https://boardgames.heygabi.ai`, row **#1** `library` refused as a BOOKS request
pointing at the other repo — **exit 2** both, so the D1 read path, the column
mapping and both refusals are exercised against production data. A
`--dry --fixture` run printed all twelve steps, both pauses and a 109-line block
at **exit 0**, with the Firebase authorised-domain list read live (13 domains).

🔴 **FOUR DEFECTS FOUND BY RUNNING IT, not by reading it**, each of which would
have failed quietly: a key-only TOML substitution rewrote
`name = "RATE_LIMITER"` inside the unsafe binding to the Worker's name (TOML
reuses short keys across tables, so a key is not an address — every substitution
now names its table); `Number(null)` is `0`, so an absent `--request` read as
request #0; `--resume` threw a refusal about `games3` because it asked for the
"next free" id even when one was pinned; and the secret plan's last-moment guard
was unreachable because it re-used the classifier the loop had already filtered
with.

⚠️ **NOT verified, and it is the headline:** **no real instance has ever been
provisioned.** Nothing has run past `--dry`. No D1, no bucket, no covers
hostname, no secret, no deploy. Every AUTO step is written and unexercised, no
envelope has been decrypted from this side (the seal library was exercised
through stubs), and nobody has signed in anywhere.

**Left open for the owner:** ☐ the naming split — (a) as built, (b) all ordinal,
(c) all follow the person. Both provisioners are built to (a) so the pair agrees,
and it is all one function.

---

## ✅ `BILLING_SITE` lifted out of source — the last hard-coded identity (2026-09-05, phase 9)

**Moved whole from `TODO.md`, where it read:**

> * **`BILLING_SITE` is still the constant `'games'`**
>   (`apps/worker/src/lib/billing-gate.ts`, and it now says so in its own comment).
>   A second instance would identify correctly at the estate directory and still
>   report and be billed as the `games` site. Inert today — `BILLING_POLICY =
>   "off"`, nothing has ever resolved — but it must be lifted the way `ESTATE_APP`
>   was **before a second instance bills**.

**As built.** `export const BILLING_SITE = 'games'` became
`export function billingSite(env): EstateApp | null`, resolving through the same
`resolveEstateApp()` the estate gate uses. Two call sites moved with it
(`billing-gate.ts`'s `person` line, `index.ts`'s `system` line for the hourly
sweep) and both now pass `env`.

**Why it follows `ESTATE_APP` rather than getting a var of its own.** The site
id and the app id are ONE identity, and the other side proves it: the auth
Worker's `siteForApp()` (`catalog-platform/apps/auth-worker/src/estate.ts:118`)
maps `games → games`, `library2 → library2`, and the system door answers
`{site, system_denied}` for the consumer whose bearer was presented — the bearer
`ESTATE_APP` selects. A second var could disagree with the token actually sent,
which is F-5 one level down: spending under one name and reporting under
another, with nothing going red.

⚠️ **A consequence for the OTHER repo, found while doing this and not written
down anywhere before:** adding `games2` to `CONSUMER_APPS` also needs a `games2`
arm in `siteForApp()` and a `games2` entry in `BILLING_SITES`
(`catalog-platform/apps/auth-worker/src/billing-registry.ts:38`), or that repo
does not compile — `siteForApp` is exhaustive over `ConsumerApp`.
`scripts/provision-catalog.mjs` prints both in its PAUSE #2 runbook.

🔴 **The failure direction is deliberately `estate-app.ts`'s, not
`billingPosture`'s.** An unrecognised `ESTATE_APP` gives `null` and does NOT
fall back to `games`: falling back would file a second household's spend under
the main catalog's site in the one record anybody would later count, and the
estate gate is already OFF for the same typo — the log line and the behaviour
must agree.

**Measured:** `npm run typecheck` clean in every workspace; `npm test`
**223 pass / 0 fail** (220 before — one assertion replaced by four). The main
instance's value is pinned by reading the live `wrangler.toml`, so an edit to
`[vars] ESTATE_APP` fails the suite rather than silently moving the `site` field
of every billing log line.

⚠️ **NOT deployed, and it did not need to be** — stated rather than assumed.
`BILLING_POLICY = "off"` on main, so `decideBilling` answers `log: false` and
`sweepIfPolicyAllows` returns before its log block: neither call site executes.
And if one did, `ESTATE_APP = "games"` makes the function return the identical
string the constant did. A provable no-op for the live Worker, so no deploy and
no `deploys.log` line.

---

## ✅ DEPLOYED — estate themes + the index backstop off the cron (`c1880c6` + `4dcf9b7`, live in `2e598a9e`, verified 2026-09-02)

🔴 **Nothing was deployed to land this. It went live as a passenger** on the two
guarded deploys of 2026-09-02 (`ca6e5ad7` → `57a3d118`, then `5150269f` →
`2e598a9e`); both commits are ancestors of both. The heading below said "BUILT,
NOT DEPLOYED" for twenty days after it was already live — which is the whole
argument for reading a body before trusting a title.

**Review link:** <https://boardgames.heygabi.ai/> — the cog, **Theme** group.
Retro is still the default (`<html data-default-theme="retro">` is in the served
HTML, checked 2026-09-02).

### Verified live 2026-09-02, by measurement

| Claim from 2026-08-13 | Verdict today |
|---|---|
| Retro stays the default | ✅ `data-default-theme="retro"` in the served index.html |
| `/assets/estate-theme.css` + `theme.js` are served | ✅ both **200**, 50,947 and 12,728 bytes |
| The cog offers **three** themes | ⚠️ **stale — it offers five.** `THEMES = ['classic','apple','cyberpunk','retro','hearts']` in the live `theme.js`. The manual vendoring this row describes was replaced on 2026-08-17 by `scripts/sync-estate-theme.mjs` (`0c84d6b`/`c56fabf`), which is exactly the drift that script exists to end |
| Vendored assets are committed in `apps/web/public/assets/` | ⚠️ **stale — that directory is gitignored build output now.** Same 2026-08-17 change |
| Index backstop rides request traffic, one health GET per isolate-hour, every `/api/*` logs its decision | ✅ **proved in production**, not inferred — see below |

**The backstop, read off `wrangler tail` against the live Worker while six
unauthenticated `GET /api/health` calls went in (2026-09-02 22:45Z):**

```
index backstop: due — checking index health
index backstop {"skipped":"index is fresh (837 rows, pushed 2026-09-02T17:18:52.609Z)"}
index backstop: throttled (checked 0m ago, next in 60m)
index backstop: throttled (checked 3m ago, next in 57m)
```

That is the exact ladder the entry below promised from `wrangler dev` —
due → fresh → throttled — now measured on the deployed artifact. The
half-hourly cron no longer carries it (`apps/worker/src/index.ts:68` mounts
`indexBackstopOnRequest()` on `/api/*`; the `scheduled()` handler says so at
line 298).

⚠️ **NOT verified, and still the owner's step:** an attended look at the themes.
Token plumbing and delivery are measured; **pixels are not**, and the set grew
from three to five since anybody looked.

⚠️ **One live header does not match what `_headers` intends** — recorded as
[KI-5](KNOWN_ISSUES.md).

### The 2026-08-13 entry, moved whole from `TODO.md`

*Byte-identical to what stood in `TODO.md` — mojibake and all, see
[KI-3](KNOWN_ISSUES.md). Only the heading level changed (`##` → `####`) so it
nests under the verdict above.*

#### 🔶 BUILT, NOT DEPLOYED — estate themes adopted + index backstop off the cron, 2026-08-13

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

## ✅ DEPLOYED AND ENFORCING — estate auth (`0077a7a`, flipped to `enforce` 2026-08-14, live in `2e598a9e`, verified 2026-09-02)

🔴 **This did not land in shadow, and it must not be put back into shadow.**
`catalog-platform/docs/info/estate-auth-design.md`'s own status header records
*"games flipped to **enforce** and deployed 2026-08-14T05:07Z"* — **one day
after** the entry below was written. `wrangler.toml` has read
`ESTATE_CHECK = "enforce"` ever since; the comment beside it lied about that
until `93fad25` (2026-08-26) fixed it and `apps/worker/src/lib/estate-refusals.test.ts`
pinned the fix.

⚠️ **Rolling `enforce` → `shadow` would be an access-INCREASING change** — a
revoked member would stop being refused — against a posture the owner already
chose. The estate's shadow-first rule governs `off → shadow → enforce`; it has
never been an instruction to walk one back. **Any future move of this flag is
the owner's, on measured evidence, in its own commit.**

**Review link:** <https://boardgames.heygabi.ai/> — signed in as a household
member, everything behaves normally; that is what `enforce` looks like when the
directory says yes. The membership side is <https://heygabi.ai/admin/>.

### Verified live 2026-09-02, by measurement

| Claim from 2026-08-13 | Verdict today |
|---|---|
| Committed as `off`, so deploying is inert | ⚠️ **false, and already corrected in the body below on 2026-08-26.** The committed and live value is `enforce` |
| Migration `0026_estate_cache.sql` applied **local only**; remote apply pending | ✅ **applied remote.** `d1_migrations` holds 30 rows and `0026_estate_cache.sql` is among them |
| Secret `ESTATE_APP_TOKEN_GAMES` needed, or shadow logs `config unset` | ✅ **set.** `wrangler secret list` names it (names only — no value was read) |
| Deploying is the owner's step; nothing is live | ⚠️ **stale.** `0077a7a` is an ancestor of both 2026-09-02 deploys and is in the live artifact `2e598a9e` |
| The check runs | ✅ **proved against live D1**: `app_user` carries **2 `approved`** rows whose newest `estate_checked_at` was **2026-09-02T22:44:36Z** — a minute before the read — and **2 `pending`** rows last answered 2026-08-16. The 10-minute TTL cache is being written in production |

**Superseding one entry lower in this file:** *"✅ FIXED, NOT DEPLOYED — two
refusal defects … 2026-08-26"* (`93fad25`) **is deployed** — an ancestor of both
2026-09-02 deploys, in the live artifact `2e598a9e`. The archive is append-only,
so that heading stays as it was written; this is the correction.

⚠️ **NOT verified:** no shadow soak exists for this app and none can now be run
without walking the flag back — so there is **no measured "zero WOULD-DENY"
record** here, unlike the library's. What exists instead is nineteen days of
`enforce` with two approved members and no reported refusal, which is weaker
evidence of a different kind. Also not verified: what a *revoked* member
actually sees (nobody is revoked), and the `estate_unreachable` 503 path
against a real outage.

### The 2026-08-13 entry, moved whole from `TODO.md`

*Byte-identical to what stood in `TODO.md`, including the 2026-08-26 correction
already embedded in its first row. Only the heading level changed
(`##` → `####`).*

#### 🔶 BUILT, NOT DEPLOYED — estate auth adopted in shadow mode, 2026-08-13

Commit `0077a7a`, pushed. Design:
`catalog-platform/docs/info/estate-auth-design.md` §3.1/§5/§14.5.

| | |
|---|---|
| What | Estate membership check wired into `requireAuth`, gated by `ESTATE_CHECK` (`off` \| `shadow` \| `enforce`). ⚠️ **This row said "committed as `off`, so deploying this is inert" — corrected 2026-08-26. The committed value is `enforce`**, and `wrangler.toml`'s comment carried the same stale claim (fixed in the same commit, now pinned by `apps/worker/src/lib/estate-refusals.test.ts`). ⚠️ **This section's heading — "BUILT, NOT DEPLOYED … in shadow mode" — is therefore stale too, and is deliberately NOT swept here:** the heading is the half that goes stale first, so somebody has to read the whole body and move it whole rather than trust the title |
| New build dependency | ⚠ï¸ This repo now materialises the canonical `estate-auth` module from the sibling `catalog-platform` checkout — `scripts/sync-estate-auth.mjs` runs as `predev`/`pretypecheck`/`predeploy` and **fails loudly** if the checkout is missing. The old local verifier in `middleware/auth.ts` was replaced by it (behaviour-identical: the hardened bypass came FROM here) |
| Migration | `0026_estate_cache.sql` — two nullable `app_user` columns, plain ADD COLUMN. **Applied LOCAL only; remote apply is a pending owner/dispatcher step**, before the deploy that carries this code |
| Secret | `npm run secret ESTATE_APP_TOKEN_GAMES` (same value the auth Worker holds under that name) — without it, shadow logs `config unset` per request and skips |
| Reading shadow | `npm run tail --workspace @bgc/worker`, grep `estate shadow:`; the lines that matter carry **`WOULD-DENY`** — expect zero for household members before anyone flips `enforce` |
| Default-grant | `viewer` (the smaller guest role, on purpose — rating stays a local upgrade, preserving 0023/0024). Written only in `enforce`; shadow logs the would-grant |
| Untouched | `OWNER_EMAILS` recovery hatch (runs before the estate check), the rate limiter, every route and capability gate |
| Verified | typecheck (⚠ï¸ no test script in this repo) + 11 `wrangler dev` probes against local D1 with a mock `/seen`: off inert; shadow logs revoked as WOULD-DENY while answering 200, rides a stale cache through an outage, would-grants without writing; enforce grants/403s/503s correctly and serves the standing owner through an outage |

---

## ✅ DEPLOYED — billing phase 3: all seven money paths switchable from `/admin`, and every one ships INERT (`5150269f` live as `2e598a9e`, 2026-09-02 21:14Z)

Design: `catalog-platform/docs/info/llm-billing-control-design.md`, phase 3 —
*"library, library2 and games read `billing_denied` off /seen"*. The library's
half landed the same day in its own repo.

**Review link:** nothing renders differently here, and that is the point of
shipping at `off`. The switch that drives it is <https://heygabi.ai/admin/> →
the **"Spending — what may bill the model, and where"** panel, whose `games`
column now reaches real code.

### The seven paths, and what each is ANDed with

⚠️ **Nothing was replaced.** The existing gate decides first; policy can only
add a NO on top of it (design §3.3). Deny-only is structural rather than a
convention — the gate returns a refusal or `null`, so no policy row can open
anything (§9 Q1).

| # | Path | Feature id | Still gated by, unchanged |
|---|---|---|---|
| G1 | `POST /api/vision/identify` | `scan.photo` | `scanPhoto` |
| G2 | `POST /api/vision/shelf` | `scan.photo` | `scanPhoto` |
| G3 | `POST /api/scan-jobs` | `scan.photo` | `scanPhoto` + key presence |
| G4 | `POST /api/barcode/identify` | `barcode.paid` | `runResearch` |
| G5 | `POST /api/research/:id/run` | `research.tier` | `runResearch` + the blocked-tier check |
| G6 | `POST /api/research/:id/details` | `research.details` | `runResearch` + key presence + the in-flight dedupe |
| G7 | the hourly cron sweep | `sweep.details` | cron match + key presence + `SWEEP_LIMIT = 8` |

**G1/G2/G3 share one id on purpose.** `scan.photo` is the registry's single
switch for every photo read, because they are the same spend on the same model
and a second id would be a switch the owner has to remember to press twice.

**G4 has its own id, and that mirrors the capability split this repo already
made.** The vision routes are `scanPhoto` and read a PHOTO; the paid barcode
rung is `runResearch` and buys a web search on a NUMBER. Two costs, two
switches.

**G3 and G5 are both checked BEFORE anything is written.** G3's vision call
happens in `waitUntil`, so a job row created and then refused would sit in the
queue looking like work in progress nobody is doing; G5's run row is the
history, and a refusal must not litter it with a run that never ran.

**G7 is the one that matters.** 🔴 It is the only unattended biller in this
repo — ~11¢/hour while a backlog exists, with no user anywhere in it — so a
per-person rule structurally cannot reach it. It resolves through the estate's
fourth principal, `system`, and its own door
(`GET /api/estate/billing/policy` on `ESTATE_APP_TOKEN_GAMES`), because a cron
has no email to send to `/seen`. **Switching `sweep.details` off for `games` is
the only way to stop it that is not a deploy.**

### ⚠️ `SWEEP_LIMIT` was NOT touched, and that settles §9 Q2 here

`lib/details-sweep.ts` deliberately refuses to make `SWEEP_LIMIT` an env var —
*"a knob nobody tunes is a knob that hides its value"* — and a central spending
switch reaches into exactly that sweep. Both stand, because they are different
things: a **knob** is a number somebody must choose well, and the argument
against exposing it is sound; a **switch** has no value to hide and one obvious
meaning. This build adds only the switch. ⚠️ No numeric budget and no
per-person spend cap shipped, per the same answer: a cap needs a spend ledger
to enforce against, and a cap that silently mis-counts is worse than no cap.

### What was built

| Piece | File |
|---|---|
| The cache column | `migrations/0030_billing_cache.sql` — applied to the remote D1 before the deploy |
| The read/write | `packages/db/src/estate.ts` |
| The wiring | `apps/worker/src/middleware/estate.ts` — parses the cached column in, persists the refresh, sets `billingDenied` on the context, and sends `local_role` |
| The gate + the system door | `apps/worker/src/lib/billing-gate.ts` |
| The pins | `apps/worker/src/lib/billing-gate.test.ts` — 26 tests |
| The posture | `apps/worker/wrangler.toml` — `BILLING_POLICY = "off"` |

`local_role` is a **claim** by this app about its own user's rung, and that is
the right trust level: the app is the authority on its own ladder, it already
holds an app token, and the value is used only to pick a DENY row. Policy
cannot grant, so a wrong claim can close something and never open it.

### The two things this build got right on purpose, either of which fails silently

1. 🔴 **`null` is UNKNOWN; `[]` is "the directory denied nothing".** They never
   collapse — not on the wire, not in the D1 column (nullable, **no**
   `DEFAULT '[]'`), not in the parser, not on the system door. An auth Worker
   mid-deploy running pre-0016 code answers silence, and silence read as `[]`
   would un-switch every policy the owner had set for the length of that
   deploy, with nothing anywhere going red. Unknown **proceeds** (§3.5 row 3),
   because denying every paid feature during an auth outage turns it into a
   household-wide *"everything is broken"*. The wallet is bounded by
   `SWEEP_LIMIT` and the timeouts — *a policy that can only deny cannot be
   depended on to fail closed.*
2. ⚠️ **`BILLING_POLICY` is not `ESTATE_CHECK`.** One answers *"is this person
   still a member"* and is already at `enforce`; the other answers *"may this
   person spend"* and has never run. A test asserts **both** values, so nobody
   can read the first as licence to flip the second.

### Mechanical guards, not prose

- A **literal pin** on every feature id this Worker checks. A Worker checking
  `research.cover` (singular) against a registry holding `research.covers`
  fails **silently open, forever**, and nothing else in the estate would
  notice.
- A test that **reads `wrangler.toml`** and fails unless `BILLING_POLICY` is
  `"off"`, so a flip cannot ride along on an unrelated deploy (§4.2).
- A test that fails unless the **comment block beside the value names the
  value** — §6.1 defect 3 was exactly that drift on `ESTATE_CHECK`, and the
  same tripwire now covers the new flag.
- Every refusal is asserted to carry a `detail`. ⚠️ That is the line
  `estate-refusals.test.ts` already holds for `estateGate`, and it exists
  because `estate_revoked` shipped as a bare `{error}` for weeks — surviving
  only because `apps/web/src/lib/errors.ts` happened to translate the code, so
  no browser ever showed it. The rule is about the RESPONSE.

### Verified

Tests **129 → 155** (+26), all green; `npm run typecheck` clean; the migration
applied remotely **before** the deploy; the guarded `npm run deploy`
(sync + check-clean + deploy-guard + typecheck + full suite) ran to completion;
`/api/health` answered 200 afterwards; the deploy banner shows
`env.BILLING_POLICY ("off")` on the live Worker.

### ⚠️ NOT verified

- **No rule has ever been written for `games`**, so `billing_denied` has never
  been observed non-empty on a real `/seen` answer here, and **the gate has
  never fired.** Every truth-table assertion is a unit test.
- **No `wrangler tail` was read.** `BILLING_POLICY` is `off`, so no
  `billing_policy` line has ever been emitted in production.
- **The system door was never called live.** Its client is pinned against a
  stubbed fetch; nobody has watched the cron present `ESTATE_APP_TOKEN_GAMES`
  to `auth.heygabi.ai`, and if that secret were unset the door would log
  `not configured` and answer unknown — which sweeps.
- **The `local_role` claim was not observed server-side.** It is sent; nothing
  here proves the directory used it.
- **No refusal was provoked live**, so nobody has seen a `billing_denied` body
  come off this Worker.

---

## ✅ DEPLOYED — `ca6e5ad7` live as version `57a3d118`, 2026-09-02 17:18Z

Both entries below are now on `boardgames.heygabi.ai`, shipped **through the new
guards** — the first real exercise of them, and the first line
`deploy-done.mjs` has ever appended to `deploys.log`:

```
2026-09-02T17:18:38.268Z  ca6e5ad7978ae1dbc48da56b23227a52f4f1cb07  opus-disposal  57a3d118-e6ad-40c1-a1c6-763f2412326b
```

✅ **The Cloudflare version lookup WORKED** — `57a3d118` matches the
`Current Version ID` wrangler printed. Worth stating, because the same script
recorded `version-unknown` on every line for its whole life in `library_catalog`
before the 2026-08-25 fix; this is the first evidence that fix holds here.

**Order kept:** migration remote → commit → guards → deploy. The schema was in
place before the code that reads it.

| Live check | Result |
|---|---|
| `GET /api/health` | `200` · `{"ok":true,"database":"up","version":"0.1.0"}` |
| `GET /api/items/303/history` unauthenticated | `401 {"error":"unauthenticated"}` |

⚠️ **That 401 is NOT evidence the new route exists.** A deliberately bogus path,
`/api/items/303/definitely-not-a-route`, returns the identical `401` — auth runs
ahead of routing, so every unauthenticated probe looks the same. The history
endpoint's live behaviour is **unverified** and needs one signed-in request.

---

## ✅ SHIPPED — disposal reasons + append-only copy history, migration 0029, 2026-09-02

**The two items as they stood in `TODO.md`, moved whole** (their mojibake is
carried across verbatim rather than repaired — KI-3 §3: never run a repair to
convergence, and a cut-and-paste move must not become a rewrite):

> ### â­ï¸ ON HOLD — disposal & copy history
>
> â¸ï¸ **Do not start this, and do not re-ask the `lent` question, until the weekly
> usage limit resets.** The owner's instruction, 2026-08-09: *"keep holding the
> lent question until the weekly reset happens."* The plan is finished and
> waiting; what it needs is a decision, and the decision needs budget behind it to
> act on.
>
> 📄 **The plan is written: [`info/copy-status-history.md`](info/copy-status-history.md).**
> Read it before touching anything; it is the whole design, measured against
> production on 2026-08-09.
>
> *"For sold and lent we can mark them as not owned anymore but we should keep a
> history of them items. Map this feature for tomorrow's reset."* — the owner.
>
> The four things that decide the shape, all in that doc:
>
> 1. **`lent` and `sold` have existed since 0001 and have never been used** — 0
>    rows each in production. The feature is not "add statuses"; find out what
>    actually stopped the owner before writing a migration.
> 2. **One question has to go to the owner first.** They said `lent` should stop
>    counting as owned. That makes a game lent to a friend reappear on the
>    shopping list — the exact "bought twice" failure `preordered` counts as held
>    to avoid. Recommendation and both readings are in §2.
> 3. **"Held" is defined four times in two different ways** across
>    `packages/db` and `packages/core`. Consolidate before adding a value.
> 4. **History must not cascade.** `copy` cascades from `item`, so the obvious FK
>    erases the record that you ever owned the thing — the one fact being kept.
>
> ---
>
> ### â­ï¸ Superseded note — marking things sold or given away
>
> *"We also have no way to mark things sold or given away or any statuses
> manually. I gave away item 303 since another item covered it and I have many
> other games I want to give away or sell. Can we add a way to edit it and then
> change its status tag from owned to lent or sold or something. This can be in a
> different thread."* — the owner, 2026-08-09. **Not built. Do not start it
> without reading this first.**
>
> ⚠ï¸ **Half of it already exists, so this is probably not the feature it sounds
> like.** `COPY_STATUSES` in `packages/core/src/constants.ts` is already
> `['owned','wanted','preordered','lent','sold']`, migration 0001 has the matching
> CHECK, and **`CopyEditor.tsx:102` already renders a `<select>` over all five**.
> So a copy *can* be moved from `owned` to `sold` today. Find out why that did not
> reach the owner before writing any code — the likely answers are
> discoverability (where `CopyEditor` is reachable from) or that neither `sold`
> nor `lent` means *given away*.
>
> | Known | |
> |---|---|
> | Item 303 | `The Binding of Isaac: Four Souls - Gold Box Expansion`, copy 298, still `owned` — the owner says it is gone |
> | Missing vocabulary | Nothing distinguishes *sold* from *given away*; `lent` implies it is coming back |
> | Likely blast radius | A new status value touches `constants.ts`, a CHECK-constraint migration, every `status IN (...)` query, the completeness "held" rule, and the collection filter |
>
> ⚠ï¸ The completeness feature reads `owned/lent/preordered` as **held**. Any new
> status has to declare which side of that line it sits on, or a game you gave
> away starts counting towards "you own 6 of 7".
---

### What shipped

The plan doc is [`info/copy-status-history.md`](info/copy-status-history.md),
now marked BUILT. Its §5 build order was followed; where it posed a question,
its own recorded recommendation was taken, and each of those is **vetoable** —
listed below with what a veto would cost.

| Step (§5) | Outcome |
|---|---|
| 1 · Reproduce the problem | Confirmed by reading the code rather than by clicking: `CopyEditor` already offered all five statuses, so nothing *stopped* the owner mechanically. The blocker was **vocabulary and reach**, exactly as §1 predicted |
| 2 · The `lent` question | Already answered by the owner on 2026-08-09 and already implemented — `lent` is in `HELD_STATUSES`, so a lent game never reappears on the shopping list |
| 3 · Consolidate "held" | **Already complete before this session.** `HELD_STATUSES` / `OWNED_COPY_STATUSES` live in `packages/core/src/constants.ts` and reach SQL through `statusList()`. Verified rather than assumed: every `status IN (…)` in `packages/db` goes through one of them |
| 4 · Migration | `0029_copy_disposal_history.sql` — one `ALTER TABLE copy ADD COLUMN disposal`, the `copy_event` table, two indexes, two triggers. **No rebuild of `copy`** |
| 5 · Route | Events are written from **one place**, `updateCopy` in `packages/db/src/copies.ts`, in the same `db.batch` as the UPDATE they describe |
| 6 · UI | A **"No longer ours"** button on every copy row, a "What happened to it" fieldset asking which / who / how much, and a **History** card under the shelf |
| 7 · Collection | Partially, deliberately — see decision 3 below |

### ⚠️ The four decisions taken, all vetoable

1. **Option B over option A (§3): `disposal` is a COLUMN, not a sixth status.**
   SQLite cannot widen a CHECK; `given_away` as a status needs the 12-step
   rebuild of `copy`, which silently drops migration 0002's two quantity
   triggers. **The cost, stated plainly: a copy the owner gave away is STORED
   with `status = 'sold'`.** No screen shows that word — `copyStateLabel()`
   folds status and disposal into "given away", the status dropdown reads "no
   longer ours", and the CSV export carries a `disposal` column beside `status`
   for exactly this reason. A hand-written SQL query will still see `sold`.
   **To veto:** option A is still open and costs one careful rebuild migration.
2. **No event is written when a copy is CREATED.** `created_at` already records
   the arrival and the first status change records what it arrived as in its
   `from_status`, so the timeline is reconstructible either way. What a birth
   event would cost is atomicity: the copy's id does not exist until the INSERT
   has run, so the pair cannot share a `db.batch`, and a second statement
   afterwards can fail alone and leave a history silently one row short.
   **To veto:** accept a non-atomic second write, or move the insert into the
   batch behind `last_insert_rowid()`.
3. **§5 step 7 is implemented at the COPY surface, not in the collection query.**
   Disposed copies are folded behind a `<details>` on the item page — collapsed,
   with the count always visible — and the collection's status dropdown offers
   "no longer ours" as the filter half. The collection's paging SQL is
   **untouched**, so a game whose every copy has gone is still listed there.
   That was deliberate: hiding whole trees is a different decision (the catalog
   row is not the copy), and there are **zero disposed copies in production** to
   calibrate it against. **To veto:** port `library_catalog`'s `NOT_ONLY_SOLD`
   predicate into `matchingRootsSql`.
4. **Append-only is enforced by TRIGGERS, not by a comment.** §7 says history is
   append-only; a rule that matters gets promoted from prose to a mechanical
   guard. ⚠️ The UPDATE trigger could not be a blanket abort: `ON DELETE SET
   NULL` *is* an UPDATE, and SQLite fires triggers for foreign-key actions when
   `recursive_triggers` is on — which is a pragma, not something we can promise
   on D1. It permits exactly the shape a SET NULL makes and refuses everything
   else, including re-pointing an event at a different game.

### Also changed, and its absence would have been a hole

**`copy_event` and `copy.disposal` joined `/export.json` and `/export.csv`.**
The export is this app's answer to *"D1 is the only copy of your data"*. A
backup that omitted the history would leave a gap shaped exactly like the
feature's purpose: the one class of fact designed to outlive its row would not
survive a restore. `schemaVersion` moved `0001_init` → `0029_copy_disposal_history`.

### Verification — measured, not asserted

| | |
|---|---|
| Tests | **129 pass, 0 fail** (95 before this change: **+14** in `packages/db/test/copy-event-no-cascade.test.ts`, **+20** in `apps/worker/src/lib/copy-disposal.test.ts`). The test glob was widened to include `packages/db/test/*.test.ts`, matching `library_catalog` |
| ⚠️ The no-cascade test | Applies **every migration file in order** to a real in-memory SQLite with `PRAGMA foreign_keys = ON`, then deletes the copy, then deletes the *game*, and asserts the event is still standing with `item_name` intact — **including with `recursive_triggers = ON`**, the case the UPDATE trigger's shape exists for. Without that pragma every one of those deletions would have "passed" by doing nothing at all |
| Migration, local | `npm run db:migrate:local` — 7 commands |
| Migration, remote | `npm run db:migrate`, run **before** the deploy. Verified live in `sqlite_master`: `copy_event`, `copy_event_append_only_delete`, `copy_event_append_only_update`, `idx_copy_event_item`, `idx_copy_event_copy` |
| Production copy counts, read live 2026-09-02 | `owned` 636 copies / 710 units · `preordered` 172 / 204 · `wanted` 30 / 31 · **`lent` and `sold` still 0**, `disposal` non-null on 0 rows. (The doc's 2026-08-09 reading was 587 / 204 / 30 — the collection has moved, the premise has not) |
| Typecheck + build | All seven workspaces clean; `vite build` clean |

### ⚠️ Corrected a stale gotcha while doing it

The plan doc's §6 said *"`wrangler d1 migrations apply --remote` returns 7403 on
this account"* and told the reader to apply migrations by hand through
`d1 execute --remote` plus a manual `d1_migrations` INSERT. **Measured
2026-09-02: it works.** `npm run db:migrate` applied 0029 remotely in 10.42 ms
on wrangler 4.118.0. Retired in the plan doc and in
[`access/deploys.md`](access/deploys.md).

### ⚠️ What was NOT verified

- **No pixels.** Nothing was opened in a browser. The History card, the "What
  happened to it" fieldset, the collapsed gone-copies section and their CSS are
  typechecked and built, not looked at.
- **No live write.** No copy has been marked as gone in production, so the
  `updateCopy` → `db.batch` → `copy_event` path has never run against D1. The
  SQL it emits is exercised against SQLite; **`db.batch`'s transactional
  behaviour is a D1 promise this took on trust.**
- **Item 303** — `The Binding of Isaac: Four Souls - Gold Box Expansion`, the
  game the owner actually gave away — is **still `owned`**. That is his to do,
  and it is the one-click test of the whole feature.
- The two export routes were not called.

---

## ✅ SHIPPED — deploy guards + `deploys.log` ported from `library_catalog`, 2026-09-02

**The item as it stood in `TODO.md`, moved whole:**

> ### ☐ Deploys here have NO guard and NO log (measured 2026-08-26 17:27 Phoenix)
>
> `npm run deploy` is `build` + bare `wrangler deploy` — no check-clean, no
> deploy-guard, no `deploys.log` line (the session deployed `93fad25` as version
> `a34971db-98bc-4b2f-8446-5117cf62b255` and had nowhere to record it). The global
> rule says every deploy appends one line (timestamp / commit / holder / version)
> and refuses a dirty tree. Port `library_catalog/scripts/{check-clean,deploy-guard,deploy-done}.mjs`
> as-is (one canonical implementation, not a rewrite) and wire them into the
> deploy script. Until then, the 3am rollback source of truth for this Worker is
> `wrangler deployments list`, nothing in the repo.

**What was done.** `check-clean.mjs` turned out to be **already present and
byte-identical** to the library's — it was simply running *last* in `predeploy`,
after typecheck and tests. The two that were missing, `deploy-guard.mjs` and
`deploy-done.mjs`, were copied **verbatim** (`diff` clean against
`library_catalog/scripts/`) — one canonical implementation, as the item asked.
Neither needed adapting: both already resolve `apps/worker/wrangler.toml`, the
same path in this repo, and the `--instance=` handling they carry for the
library's second Worker is inert with one instance.

`predeploy` is now `syncs → check-clean → deploy-guard → typecheck → test`, and
a new `postdeploy` runs `deploy-done.mjs`. The guards run before the slow steps,
the same order the library uses, so the two repos have one discipline rather
than two.

⚠️ **The `.gitignore` hole that would have silently defeated it.** This repo has
a bare `*.log` line, which swallows `docs/deploys.log` — the file deploy-guard's
ancestry check *reads*. Without the explicit `!docs/deploys.log` negation the
record is never committed, the guard degrades to a lock file, and nothing looks
wrong. Added, along with `.deploy.lock` (local by design; the log is the shared
state). The same hole existed in `library_catalog` and was caught there only
because somebody noticed a deploy commit with no log line in it.

**The log is seeded with one backfilled line** — `93fad257` /
`a34971db-…` / holder `backfilled` — the deploy the repo had already made and
had nowhere to record. It exists so the first guarded deploy has a baseline to
check ancestry against instead of being waved through.

**Verified by running them, not by reading them** (2026-09-02):

| Guard | Exercised against | Result |
|---|---|---|
| `check-clean` | the dirty tree of this very change | refused, exit 1, listed all 7 paths |
| `deploy-guard` lock | clean HEAD `008bfafe` | took the lock, wrote `.deploy.lock` |
| `deploy-guard` ancestry | a log line naming a commit not in the tree | **refused, exit 1, and took no lock** |

⚠️ **NOT verified:** two genuinely concurrent runs (one machine, one session —
the ancestry refusal was driven by a hand-written log line, not a real second
deploy), and `deploy-done.mjs`'s Cloudflare version lookup, which only runs on a
real successful deploy.

Documented in [`access/deploys.md`](access/deploys.md), indexed from
[`access/README.md`](access/README.md).

---

## ✅ FIXED, NOT DEPLOYED — two refusal defects: a bare `estate_revoked`, and a comment that lied about the flag, 2026-08-26

Defects **1 and 3** of the three in
`catalog-platform/docs/info/llm-billing-control-design.md` §6.1, found while
reading for the billing-control design.

### 1. `estate_revoked` answered a bare `{ error }`

`apps/worker/src/middleware/estate.ts` returned `{ error: 'estate_revoked' }`
and nothing else, while its sibling one case down — `estate_unreachable` —
carried a worded `detail`. Now:

```
detail: 'this account no longer has access to the estate; ask an owner to restore it'
```

Quiet and non-accusatory, matching the web app's own rule for this case (never
explain the enforcement to the person it just applied to) while still doing the
three things a refusal must: what happened, what it needs, how to get it.

⚠️ **"The web app translates the code" is not a defence, and it is why this
survived.** `apps/web/src/lib/errors.ts` maps `estate_revoked` to a sentence,
so a browser never showed the code — but **the rule is about the RESPONSE**,
not about one client being kind enough to make up for it. curl, GABI, a second
surface or any future app got a machine code and no way to act on it.

### 2. The `ESTATE_CHECK` comment said `off`; the value said `enforce`

`apps/worker/wrangler.toml`'s comment claimed the flag was *"deliberately 'off'
in the committed file … must be inert until the owner flips it"* — **three
lines above `ESTATE_CHECK = "enforce"`.** Anyone reasoning about who this
Worker refuses got the answer backwards. `docs/TODO.md`'s estate section
carried the same stale claim and is corrected in place.

🔴 **This is the sixth instance of a shape the estate audit already named:** a
flag is flipped, the sweep updates three places, and **the missed copy is
always a comment or a README, never code.** So the fix is not just new prose —
`apps/worker/src/lib/estate-refusals.test.ts` now requires the comment block to
contain the literal `⚠️ ESTATE_CHECK IS "<value>"` matching the value actually
set, so the next flip cannot skip the sentence beside it.

The rollout order (`off` → `shadow` → `enforce`) is kept in the comment, not
deleted: it is how the next surface adopts this and how this one rolls back.

### Verification

6 new tests in `estate-refusals.test.ts`; **95 pass, 0 fail** (was 89);
typecheck clean on `@bgc/web` and `@bgc/worker`. The refusal tests parse
`c.json(...)` by counting parentheses rather than by regex — a refusal body
spans several lines and a lazy match stops at the first inner bracket — and
each test asserts it actually FOUND what it parses before asserting anything
about it.

⚠️ **NOT deployed, and NOT verified live.** No `wrangler deploy` was run, so
the live Worker still answers the bare `estate_revoked` body until someone
ships it. Nobody has provoked a real revoked 403 against either version. The
comment fix is inert by nature — it changes no behaviour at all.

⚠️ **The TODO section this touched is still stale at its heading** ("BUILT, NOT
DEPLOYED … in shadow mode") and was deliberately left for someone to read whole
rather than swept on the strength of its title.

---

## ✅ SHIPPED — the estate theme becomes a build artifact, and `hearts` arrives, 2026-08-17

Owner order, verbatim: *"Add the pink theme as an option for every site, when a
theme is added all sites get it some may just default right away."* Commit
`0c84d6b`, deployed (Worker version `783aad0e`).

| | |
|---|---|
| The bug | `hearts` shipped into catalog-platform on 2026-08-16 and this cog kept offering four themes, with nothing failing. There were THREE places to remember here: the hand-copied `apps/web/public/assets/`, `ESTATE_THEMES` in `src/lib/theme.ts`, and `THEME_LABELS` in `ThemeToggle.tsx`. All three are gone |
| Sync | `scripts/sync-estate-theme.mjs` — twin of the two existing estate syncs, on `pretypecheck`/`pretest`/`prebuild`/`predev`/`predev:web`/`predeploy`. Fails the build when the sibling checkout is missing, rather than shipping an unstyled page |
| Gitignore | `apps/web/public/assets/` left git entirely — the whole directory is that script's output. ⚠ï¸ `apps/web/public/fonts/` is a different, still hand-written directory |
| Cog | renders `estateThemes()` / `estateThemeLabel()`, both reading `window.estateTheme` at render time. `FALLBACK_THEMES` is only for a DOM with no switcher, and says so. `EstateTheme` is now `string` — a union over a local array is what made "offer whatever the switcher offers" untypeable |
| Deleted | the two inline scripts in `index.html` (the `bgc-theme` migrate-once and the `theme-color` sync). Canonical `theme.js` does both for every estate site now; the migration is safe centrally because localStorage is origin-scoped. The static `theme-color` meta stays as the pre-script value |
| Also | `fonts/OFL-rajdhani-sharetechmono.txt` was missing from CANONICAL (this repo had it), so every estate site had been serving Rajdhani and Share Tech Mono with no licence text. Pushed upstream, `ac36bbd` |
| Tests | `npm run typecheck` clean; `npm test` 64/64 |
| Verified | Live, in a browser, hard-reloaded: the cog offers Classic/Apple/Cyberpunk/Retro/**Hearts**, the default is still `retro`, and `theme-color` still tracks `--et-bg` — which is the proof that deleting the inline script was safe. Review link: <https://boardgames.heygabi.ai/> (cog in the top bar, signed in) |
| ⚠ï¸ NOT verified | The `hearts` LOOK on a signed-in games page. It was exercised on this app's own signed-out shell (white card, blush ground, 8-bit texture, legible light and dark) but the collection list itself was not viewed wearing it — no theme was applied to the owner's live session on purpose |
| Reference | [`info/estate-theme.md`](info/estate-theme.md); the contract and "how to add theme #6" are `catalog-platform/docs/info/estate-themes.md` §3a |

---

## 📌 2026-08-16 — two things went live (Opus → Fable handoff)

Deployed `bcf265c9`. 42 tests, typecheck clean across 7 workspaces.

1. **Hourly missing-details sweep** — cron `7 * * * *`, its own schedule rather
   than riding the existing 30-minute tick (these lookups cost ~1.4¢ each and
   sharing would have doubled the ceiling for nothing). Cap **8 rows/tick** ≈
   11¢/hour worst case, and only while a backlog exists.
   ⚠ï¸ **It shipped broken and was fixed the same day.** The first version used
   `ctx.waitUntil()` alone and returned immediately — but this repo had ALREADY
   written down, about the request path (`routes/research.ts`), that "a
   waitUntil task gets about thirty seconds after the response is returned",
   while one enrichment takes **20–70 seconds**. It would have completed roughly
   ONE of eight and been killed mid-flight, leaving a run stuck at `running`.
   `scheduled()` now RETURNS the promise. **The lesson had been learned on the
   request path and did not travel to the scheduled path — any new background
   work here inherits the same trap.**
   Why it converges on its own: `listItemsNeedingDetails()` excludes per FIELD,
   never re-asks unless an input changed, and a lookup that cannot identify a
   game finishes `done` with a sentence rather than `error`.

2. **`<estate-search>`** — an additive "search the whole estate" fold under the
   top bar, shut by default. `CollectionPage.tsx` is untouched.
   ⚠ï¸ `estate-auth.js` is deliberately NOT synced: it calls `initializeApp()`
   itself, which would stand up a **second Firebase app** on a page that already
   has one. An `authAdapter` over the app's existing `firebase.ts` is supplied
   instead.
   ⚠ï¸ The element is built with `createElement` and NOT as JSX, so the adapter
   is attached before `connectedCallback`. Do not "simplify" it.
   It was CORS-blocked until `READ_ORIGINS` was set on the index Worker
   (catalog-platform, `befcce25`).

**Not verified:** nobody has typed in the search box on the deployed site.

**Still open here:** the scan-history view, shelf-photo splitting (correctly
gated on measuring first), and two thresholds worth re-measuring — all in
[`TODO.md`](TODO.md), which remains short and accurate.

---

## ✅ SHIPPED — role ladder redesign (six rungs, wishlist/scan splits, admin escalation limit), 2026-08-16

Owner-approved role matrix implemented verbatim ("Role matrix approved").
Commits `4220703` (constants+capabilities), `e5a57bc` (migration 0027),
`0e77d9d` (routes/frontend/tests), pushed to `main`.

| | |
|---|---|
| Ladder | `guest < member < contributor < moderator < admin < owner` (`ROLE_LADDER`, `packages/core/src/constants.ts`). `pending` stays a status, excluded from the ladder |
| Renames | `viewer`->`guest`, `rater`->`member`, `manager`->`moderator` — same rungs, new names. Verified in `apps/worker/src/lib/capabilities.test.ts` that `moderator`'s capability set is a superset of the old `manager`'s: nobody in production lost anything |
| New roles | `contributor` (editCatalog + manageWishlist + scanBarcode, nobody migrates in automatically) and `admin` (+manageUsers, grantable only by `owner`) |
| Wishlist split | `suggestWishlist` (member+, "I want this") vs `manageWishlist` (contributor+, curate/remove). Wired into `catalog.ts`'s copy routes by the copy's `status`, not just the route — see the file's own comment |
| Scan split | `scanBarcode` (free, contributor+) vs `scanPhoto` (bills the Anthropic vision API, moderator+). `scan-jobs.ts`'s old blanket `editCatalog` gate is now per-route; `vision.ts`'s two routes moved from `runResearch` to `scanPhoto` |
| Admin escalation limit | New pure helper `canGrantRole` (`packages/core/src/capabilities.ts`) — an `admin` may grant any role strictly beneath itself on the ladder, never `admin` or `owner`; only `owner` is unrestricted. Enforced in both `routes/users.ts` and `routes/admin.ts` (the federated surface), and mirrored client-side in `PeoplePage.tsx` so an `admin` is never offered a button that would 403 |
| ⚠ï¸ Stored role string outside the DB | `apps/worker/src/middleware/estate.ts`'s `AUTH_POSTURE.defaultRole` was `'viewer'` — the estate default-grant role, written when `ESTATE_CHECK=enforce` (which production runs). Renamed to `'guest'`; missing this would have made every estate default-grant fail the new CHECK constraint |
| Migration | `0027_role_ladder.sql` — same `app_user` rebuild shape as 0023/0024, now also carrying the 0026 estate columns. Applied local and remote. **Remote role counts, before -> after:** `manager=1, owner=2, rater=1` (4 total) -> `moderator=1, owner=2, member=1` (4 total). Row count preserved; CHECK constraint and `approved_by` self-references confirmed live via `sqlite_master` |
| Tests | `apps/worker/src/lib/role-grant.test.ts` (the three required escalation cases + owner sanity checks) and `capabilities.test.ts` (new roles, both splits, the manager-subset-of-moderator invariant). `npm test`: **32/32** (baseline 10 unaffected) |
| Verified | `npm run typecheck` clean all workspaces. Deployed — `boardgames.heygabi.ai/api/health` 200. **Live-viewed `/people`** (authenticated as owner in an existing browser session): all four real users show the new vocabulary (`owner` ×2, `moderator`, `member`) and the grant-button list per row matches `canGrantRole` exactly for an `owner` granter (every other role offered, current role excluded) |
| ⚠ï¸ NOT verified | `GET /api/admin/users` (the CORS-gated, `heygabi.ai`-only cross-origin surface) directly with a bearer token — extracting the token from the authenticated browser session to call it from `curl` was blocked by the coding agent's own safety classifier, and the block was respected rather than worked around. Same data source and same `ROLES` vocabulary as `/api/users` (verified live above), so it is very likely correct, but "very likely" is not "verified" — worth a manual check from `heygabi.ai/admin` when convenient |

---

## ✅ SHIPPED — index-push staleness made data-aware, 2026-08-16

Closes the class behind the 2026-08-15 incident: a backfill script writes
`item` directly via `wrangler d1 execute`, bypassing every mutation route —
`indexPushAfterMutation` never fires, and the request-riding backstop
(2026-08-13 entry below) only asked "is the last push >24h old?", which
cannot see a bypassed write at all. Bit the games universe rows that day,
fixed by hand with an unrelated mutation. Full context:
`catalog-platform/docs/TODO.md`'s "Index-push staleness — the real fix" note
(queued there, closed here and in the library catalog — the two
`index-push.ts` files stay deliberately mirrored).

| | |
|---|---|
| Design | `pushIndexIfStale` now ALSO compares `MAX(item.updated_at)` (new `getLatestSourceUpdateAt` in `packages/db/src/index-projection.ts`, UTC-safe parsed — same fix as `scan-jobs.ts`'s `toIso`) against the index's own `pushed_at`. A pure `decidePushForStaleness` gate in `apps/worker/src/lib/index-push.ts` makes the call: push if the index is empty, `pushed_at` is missing/unparseable, the push is >24h old, OR the data moved after the last push — that last branch is the fix, and it fires regardless of how young the push is |
| Manual force | `POST /api/admin/index-push` (`routes/admin.ts`), gated exactly like the rest of that surface — `requireCapability('manageUsers')` |
| Backfill fix | `scripts/rehost-covers.mjs` was writing `item.thumbnail_url` without bumping `updated_at` — invisible to the new check by construction; fixed |
| ⚠ï¸ Test script | **This repo now HAS one** — `tsx --test apps/worker/src/lib/*.test.ts` (`npm test`), mirroring library_catalog. Supersedes the "no test script in this repo" parentheticals in the entries below; those were accurate when written |
| Verified | `npm test` 10/10 new, `npm run typecheck` clean (all workspaces). Deployed — `boardgames.heygabi.ai/api/health` 200. **Live-captured via `wrangler tail`**: the deployed backstop ran the new `getLatestSourceUpdateAt` + `decidePushForStaleness` path against real traffic and logged `index backstop {"skipped":"index is fresh (837 rows, pushed 2026-08-16T03:53:53.256Z)"}` — the exact reason string only the new code produces, proving the new D1 query + comparison executes clean in production. Did **not** live-trigger the data-moved-since-push branch itself (would need an out-of-band write against production) — that branch is unit-test-verified only |

---

## ✅ SHIPPED — the `viewer` role and the waiting badge, 2026-08-10

| | |
|---|---|
| Live worker version | **`e9d844ed-ce07-46ed-8bb6-f030cc4e0b59`**, deployed 17:27 UTC |
| Roll back to | `04a13312-57b4-43d9-beee-959c05bdf576` — the public-hostname deploy, before any of this |
| Commits | `0c3f4ef` (role + migration), `a623064` (waiting badge), `63efc3d` (this doc) |
| Migration | **`0023_viewer_role.sql` applied to production and recorded.** None pending |
| Pushed | **yes** — `origin/main` level at `63efc3d` |

**Migration verified against production, before and after.** Every count
identical across the rebuild, which is the whole point of how 0023 is written:

| | Before | After |
|---|---|---|
| `app_user` | 2 | **2** — ids 1 and 2, both still `owner` |
| `research_run.triggered_by` | 54 | **54** ← the one that mattered |
| `app_user.approved_by` | 1 | **1** — user 2 → 1, self-reference intact |
| `user_item` (ratings) | 0 | **0** |
| stash / `app_user_new` leftovers | — | **0** |

Live schema now reads `CHECK (role IN ('owner', 'rater', 'viewer', 'pending'))`,
read back from `sqlite_master` rather than assumed. `d1_migrations` latest is
`0023_viewer_role.sql`.

⚠ï¸ **`run_links` was 54, not the 46 recorded elsewhere in this file** — it had
grown since. That is the argument for capturing before-counts rather than
trusting a documented number: the check is *before == after*, not *== 46*.

⚠ï¸ **`d1 execute --remote` threw 7403 once and a straight retry worked.** Same
transient noted in the 08-08 section. Do not conclude the account has lost
access on a single failure.

🚨 **Rollback is not just the worker.** The version above restores the code, but
0023 has already run. It is safe to leave applied — old code never writes
`viewer` and the widened CHECK accepts everything the old one did — so roll the
worker back alone. Only if the *data* were wrong would you need
`npx wrangler d1 time-travel restore board-game-catalog --timestamp <before>`,
and the table above says it is not.

### ✅ Confirmed by the owner: `/people` renders and **Make viewer** is there

*"i see make viewer it all looks good"* — 2026-08-10, on
<https://boardgames.heygabi.ai/people>. That is the deploy verified end to end:
the page loads, the new role shipped, and the role list now derives from `ROLES`
rather than the hardcoded copy that would have made `viewer` assignable nowhere.

**Why it had to come from a person.** Access intercepts every route at the edge,
and this session had no outbound network at all — `curl` returned `000` for
`/api/health` on both hostnames, which is a connection failure and **not** a
302, so it proved nothing either way. A clean deploy plus a confirmed schema
still does not tell you the Worker serves a page. Same gap the 08-09 restyle
had, closed the same way: ask for one signed-in page load.

â³ **The badge itself is still unseen, and correctly so** — production has **0**
pending users, and it is drawn only when somebody is actually waiting. Its
absence is not a failure. It verifies itself the first time a real person signs
in and lands as `pending`, which is exactly what the next invite produces. To
force it early, sign in from any other Google account in a private window.

### Why the migration looks so paranoid — do not "simplify" it

`app_user` is not empty and five columns in four tables point at it, so the
implicit `DELETE` that `DROP TABLE` performs fires FK actions: `user_item.user_id`
is **ON DELETE CASCADE** and takes *every rating row*, and `research_run.triggered_by`
(46 prod rows), `play.logged_by_user_id`, `research_finding.reviewed_by` and
`app_user.approved_by` are all nulled. **Migration 0018's `DROP`-and-recreate is
not a precedent** — that table was empty in every environment, and its header
says so.

Measured on the local D1 with throwaway tables, not reasoned about. Both dodges
lost the data: `PRAGMA defer_foreign_keys = ON` left **0 of 3** child links, and
`PRAGMA legacy_alter_table = ON` left **0 of 3** links and **0 of 2** cascade
rows (D1 does not honour it, so the RENAME repointed the children and the DROP
cascaded through them). D1 does not support `foreign_keys = OFF` either. Hence
stash-before, restore-after, which depends on no pragma and is checkable by
counting both sides.

The subtle one: `app_user_new.approved_by` references `app_user` **by name**,
still the old table when `DROP` runs — so the new table's own column is nulled
too, before the rename makes it self-referential.

### What the two commits contain

**`viewer`** reads and nothing else — `rater` was the only other read-capable
role and it also carries `rate`. Verified through a real worker: `/api/me`
returns `capabilities: ["read"]` alone, reads answer 200, and rating, item
create/patch/delete, export, users, vision, scan-jobs, bgg import and cache
clear all **403**.

**The waiting badge** on the People link. Nothing previously told the owner that
someone was stuck on the holding screen — no email, no push, and the link looked
identical whether nobody or six people were waiting. Counted in `chores`, gated
on `editCatalog` **or** `manageUsers`.

⚠ï¸ **`PeoplePage` no longer hardcodes its role list** — it derives from `ROLES`.
The old hardcoded copy is exactly how `viewer` would have shipped assignable
nowhere. A new role now needs `ROLES`, `CAPABILITY_MATRIX`, `ROLE_BLURB`, a
badge tone, **and a CHECK migration**.

### Still open

- **Nobody is a `viewer` in production yet**, and nothing is pre-provisioned.
- ⚠ï¸ **The audiobook catalog cannot be migrated in — it stores no email addresses.**
  Read live 2026-08-10: **8 profiles, 3 passphrase users, 0 email-like fields on
  any of them.** `ensureProfile()` writes only `displayName`/`photoURL`, and the
  Google email lives in `localStorage` as `ab_identity_email`, never in
  Firestore. This app keys `app_user` on the Access JWT's email claim, so there
  is no join key and name-matching would be a guess. The roster, for reference:
  Amber Mitchell, Jamie Jeremiah Lievertz, Remy, Ronnie, Samantha Hardman,
  Skylar, Sparkling Ember, *Tim Connell* (the owner asked to exclude Tim).
  **The working route is the existing one:** they sign in, land as `pending`,
  and the owner presses *Make viewer* — the badge now says when they are waiting.
- ⚠ï¸ **Port 8787 is squatted by another project's dev server** (its `/api/me`
  answers with `trackReading`, `scan`, `reviewName`). `apps/web/vite.config.ts`
  proxies there, so `npm run dev` can silently talk to the wrong app's API.
  Check before trusting a local web session.

---

## ✅ SHIPPED — public hostname, 2026-08-10

| | |
|---|---|
| Live at | **<https://boardgames.heygabi.ai>** — behind Cloudflare Access, owner-only, as intended |
| Worker version | `04a13312-57b4-43d9-beee-959c05bdf576` |
| Commit | `a9b8e58` — `apps/worker/wrangler.toml` only, an 18-line `[[routes]]` block |
| Migrations | **none** |
| Pushed | **yes** |

`custom_domain = true` means the **deploy** created the hostname and its DNS
record — a config line, not a dashboard click, is what put the site online. The
`workers.dev` URL is deliberately kept as the fallback.

⚠ï¸ **`CF_ACCESS_AUD` was deliberately NOT changed, and that is correct.** The
hostname was added as a *second destination* on the existing Access application
rather than as a new application, so it inherits that app's audience and its
Production policy (Cloudflare allows five destinations per app). Verified live:
an unauthenticated request 302s to the Access login, and a signed-in load renders
real D1 data. Full reasoning: [`access/login.md`](access/login.md) §"Where the
app lives".

⚠ï¸ **If it looks unreachable from the house, it is almost certainly the router**
caching NXDOMAIN — `ipconfig /flushdns` does not clear it. Check with
`Resolve-DnsName <host> -Server 1.1.1.1`. This cost a full false diagnosis.

Access is untouched and still enforcing. Nothing about the app, its data or its
policies changed — only where it answers.

---

## ✅ SHIPPED — the vintage pop-art restyle, 2026-08-09

| | |
|---|---|
| Live worker version | **`6ca9be76-701c-4d1f-8866-e9e16cd39139`** |
| Roll back to | `4d303298-2636-450f-acfc-a0ce5edcf224` — everything except the restyle |
| Commits | `154a9d3`, `99f60b4`, `987ef5c` |
| Migrations | **none** — CSS, two font files and one `index.html` meta change |
| Pushed | **yes** — `origin/main` is level for the first time this session |

✅ **Confirmed by the owner: the deployed pages render.** That closes the
verification gap on *everything* shipped today — the arrivals checklist, the
wishlist camera and its expansion picker, and the Export page — none of which a
session can check for itself, because Access intercepts every route at the edge
including static assets. `curl` on `/fonts/bangers.woff2` from a terminal
returns nothing at all.

⚠ï¸ **The one thing still worth a glance is the font path**, because it fails
*silently and legibly*: if `/fonts/*.woff2` did not survive the asset pipeline,
headings simply fall back to Trebuchet and the site looks like a slightly odd
sans-serif rather than broken. Verified in `dist/` locally and in the built CSS,
never against production. **Headings should be comic caps** — if they are not,
that is the cause.

### What it is

A token swap plus two thin layers, not a rewrite: every colour already came from
~18 custom properties. Aged paper and cream panels, charcoal ink, mustard/dusty
blue/brick/coral, all desaturated. Panels get a 2px ink border and a hard 3px
offset shadow; buttons press into their own shadow; fields take the same border
with an *inset* shadow, because a field is a hole in the paper rather than an
object on it.

Bangers and Luckiest Guy are **self-hosted** — see
[`apps/web/public/fonts/README.md`](../apps/web/public/fonts/README.md). 40 KB
for the pair, and it keeps the app's zero-third-party-request property.

The full reasoning — why there is no hero, why exactly one starburst and one
speech bubble, why `.card` is deliberately *not* rotated, and why the viewfinder
stays black — is in the commit messages and in the comments at the top of
`styles.css`, which is where somebody editing it will actually be.

### Still not done

- **Nobody has seen it on a real phone.** Measured at a 390px content width in
  desktop Chrome, which is not iOS Safari. `background-attachment: fixed` on the
  halftone is the most likely thing to behave differently.
- **Light mode is the unseen half here.** The owner reviewed in dark mode; the
  cream paper version has only been seen in screenshots.

---

## Shipped 2026-08-09, later session

| | |
|---|---|
| Live worker version | **`7066047c-ee0d-4c72-ba95-0eacb6671d2b`** |
| Roll back to | `bf029d3e-3b5d-470c-aaef-740fdcaa6ce1` (arrivals, before any of this) |
| Commits | `2509082` (export), `cadce4c` (wishlist camera + the mobile fix) |
| Migrations | **none** — nothing in this batch touches the schema |

### One Export in the top bar

The JSON and CSV downloads used to hang off the end of the collection page's
result count, beside *"806 entries · 171 games · page 1 of 5"*. They are now a
single **Export** entry in the top bar next to Wishlist and People, opening
`/export` — a page that names both formats and says what each is for.

A place rather than an action, which is what the bar is for. Two formats that
are not interchangeable, so something has to offer the choice; a lone button
that silently downloaded one of them would have to pick. Two taps either way.
The page also says what the CSV **is not** — a flattened one-row-per-copy view
with no ratings, editions or tree shape — which matters if you reach for the
wrong file before doing something drastic.

Gated on `editCatalog` in both the link and the route, because the API behind it
is; a rater reaching the URL gets NotFound rather than a page whose every button
403s.

### ⚠ï¸ The expansions dropdown was unreadable on a phone — fixed

*"we need the expansion/accessory drop dowwn to work on mobile. right now it
just says expansion and we need to be able to see the title and click on it like
the webpage."* — the owner. **This was live and had been for some time.**

`.child-status` asks for `flex-basis: 100%` under 560px so the status gets a
line of its own — but `.child-row` did not wrap, so the request was met by
squeezing the only shrinkable thing on the row instead. `.child-name` is
`flex: 1 1 0` with `overflow: hidden`, so it went to **zero width**, and every
expanded game on a phone listed its contents as "EXPANSION", "ACCESSORY",
"EXPANSION" — no titles and nothing to aim a thumb at.

Fix is `flex-wrap: wrap` on `.child-row`, plus `white-space: normal` on the name
so a long title takes a second line rather than ellipsising.

**Proved rather than assumed**, by reverting only `flex-wrap` in the live page
and re-measuring: name width **0px before, 267px after**, same rows, same
viewport. The item page's own child list (`.child-link`) was never affected —
names measured 179px and rows 39px tall throughout.

⚠ï¸ **This is the third time one flex row has silently eaten its own name**, after
`.arrival label` and `.arrival-meta`. The rule, now written in the stylesheet:
*any row in this file that gives a child `flex-basis: 100%` has to be a wrapping
row.*

### The wishlist can scan, and offers a game's expansions once it lands

*"for wishlist add, utilize our existing technology for scanning barcodes and
individual photos to add games to it. Also if a game is added, grab the
expansions so we can quick add those… add a see expansions expansion area where
we can check them to add them to wishlist too."* — the owner.

| | |
|---|---|
| New | `WishlistScan.tsx`, `WishlistExpansions.tsx`, `lib/catalog-add.ts` |
| Changed | `WishlistAdd.tsx` (three tabs, and it no longer closes on add), `Completeness.tsx` and `ScanPage.tsx` (onto the shared module) |

**Three tabs — Type it, Barcode, Photo.** Typing stays the default: it is the
only one that works with no light, no barcode and no camera permission, and it
is the screen this page has always had. The camera rungs are the *same modules*
`/scan` uses — `startScanLoop`, `captureFrame`, `CameraStage`, `api.barcode`,
`api.identifyPhoto`. The slow paid rung (Claude on a barcode number, 1–2
minutes) is deliberately **not** offered: it exists for a box you own and cannot
identify, and it is far too much to spend on deciding whether to want something.

⚠ï¸ **This reverses a decision recorded on `WishlistPage`** — that sending
somebody to the scanner for something they do not have was "always the wrong
direction". The observation was right and the conclusion was half of one:
standing in a shop holding a box you have not bought is exactly a box in your
hand. What was wrong was sending them to `/scan`, which adds things as **owned**
and navigates away.

**Adding no longer closes the form.** What was added is handed to
`WishlistExpansions`, which asks BoardGameGeek what else exists and offers it as
a checklist behind *"See expansions (N)"*.

⚠ï¸ **Nothing is ticked to start with — the opposite of `Arrivals`, deliberately.**
A preorder arriving already happened and the tick confirms it. Wanting an
expansion has not happened, and wanting all sixteen is a claim nobody made.

⚠ï¸ **A component just added comes straight back in the list, and that was a
double-add bug.** `outstanding` is everything not proven `held`, and a `wanted`
copy is not held — so the two rows added in testing reappeared with
`matchedItemId` set and the note "Already on your wishlist", tickable again, and
the second attempt would fail on the unique `bgg_id` index. Filtered on
`matchedItemId == null`, which is the same test `AddComponent` already applies
for the same reason. Verified: **16 offered → add 2 → 14 offered.**

**One BoardGameGeek call, fired once.** A game added a minute ago has never been
swept, so `completeness` returns `never_checked` and there is nothing to show;
the panel does one `POST /api/components/backfill?itemId=` and re-reads. Only
here, on a row this session just created — never on the report, which has a
button already.

### `lib/catalog-add.ts` — the policy that was in three places

`fillableFieldsFor` decides what a row of a given kind may hold at all, and
forgetting it produces a dice tray for 2–6 players with a description of a dice
game. The scanner, the completeness report and now the wishlist all create items
out of lookup results, and all three carried their own copy of that gate. It now
lives once, in `createItemFromCandidate` / `createItemFromComponent` /
`addComponent`, with `copyDefaults` beside it.

### Measured, `npm run dev:worker` against local D1

| Checked | Result |
|---|---|
| Type-it add, then expansions | ✅ Ticket to Ride → "See expansions (16)", all unticked |
| Tick 2, add | ✅ *"2 expansions of Ticket to Ride are on the wishlist too."*, and both land as `wanted` |
| Double-add guard | ✅ 16 → 14 after the filter; before it, the two stayed tickable |
| Barcode / Photo tabs | ✅ camera stage and hints render; Photo also offers "Choose a photo instead" |
| The write path a scan runs | ✅ exercised directly — item with `bggId` + `wanted` copy, appears on `/api/wishlist` |
| Export page and both files | ✅ 200 with `Content-Disposition` on `.csv` and `.json`; old links gone from the collection page |

⚠ï¸ **`ItemPicker` suggestions fire on `onMouseDown`, not `onClick`** — deliberate,
so the input's blur cannot close the list first. A test driving it with
`.click()` silently selects nothing and the Add button stays disabled. It cost
three rounds here; dispatch a real `mousedown`.

### Not verified

- **No camera was available**, so a real barcode read and a real box photo have
  not been through the wishlist path end to end. The modules are the ones `/scan`
  already uses and the write path was exercised directly, but the capture itself
  is untested here.
- **Phone width is measured at a 390px content width in desktop Chrome**, not on
  iOS Safari. `resize_window` does nothing to a maximised window — see the note
  in the arrivals section for the technique that does work.

---

## ✅ "It arrived" — a preorder lands in one pass, 2026-08-09

*"we need a 1 button click to change a pre order game from preordered to owned
and to have it update all the expansion too. It should prompt you and say what
has arrived so you can exclude things that didn't arrive with the preorder."*
— the owner.

| | |
|---|---|
| Migration | **none** — no schema change, nothing stored |
| New endpoint | `GET /api/items/:id/arrivals` — **read-only** |
| New component | `apps/web/src/components/Arrivals.tsx` |
| Touched | `packages/core/src/schemas.ts`, `packages/db/src/items.ts`, `apps/worker/src/routes/catalog.ts`, `apps/web/src/api.ts`, `ItemPage.tsx`, `styles.css` |
| Live worker version | **`bf029d3e-3b5d-470c-aaef-740fdcaa6ce1`** — the phone layout, 2026-08-09 |
| Previous version | `124ca437-5976-4af2-a4ea-92afee8a232b` — the feature without the phone layout |
| Roll back to | `2f1a26a3-c60c-4292-850e-167d58a3935a` to remove the feature entirely |
| Commits | `35fd354` (the feature), `0cc2030` (the phone layout) |

**197 preordered rows across 34 games** in production, so this had live data to
bite on the moment it deployed. The big ones: Dungeon Crawler Carl **23**,
Ascension 15th Anniversary **22** (45 units), Cult of the Lamb **13**, Altera 10.

A card appears above everything else on any item page with a preordered copy
anywhere under it: *"On preorder 13"* and one **It arrived** button. Pressing it
opens the checklist with every row **already ticked**; the work is unticking
what did not turn up, and unticked rows are left exactly as they were.

### The three decisions worth not re-litigating

⚠ï¸ **It walks the subtree, not `root_game_id`.** The cheaper join is wrong: a
game can hold two pledges at once — a base game bought years ago and an
expansion wave still in the post — and confirming one must not offer up the
other. Asking from an expansion's page therefore lists that expansion's branch
and nothing from the base game beside it. Verified locally: asking from item 112
returned 3 rows, asking from item 111 returned 13.

⚠ï¸ **There is no bulk write endpoint, deliberately.** Each ticked row is an
ordinary `PATCH /api/copies/:id` with `{ status: 'owned' }` — the same call the
wishlist's "bought it" and the copy editor's dropdown make. This is the rule
already written on `/wishlist` and `/retag`: *a second way to change a copy's
status is a second thing to keep honest.* The endpoint added here decides **what
to offer** and never what to do with it. The consequence is the good one: a
partial failure leaves whatever did not save still `preordered` and still on the
list, so it is reported (`"8 of 11 saved…"`) and retried rather than rolled back.

**Indentation is conditional, and that is not cosmetic.** A row is indented only
when its parent is *also on the list*. An accessory whose expansion arrived
months ago sits two levels down with nothing above it to belong to, so it is
rendered flush and names its parent instead — otherwise the shape of the list
lies about the shape of the tree.

### Measured, `npm run dev:worker` against the local D1

A fixture seeded the shapes the 8 real Ark Nova preorders do not cover: depth 0,
depth 2 under a preordered parent, depth 2 under an **owned** parent, depth 3,
quantity 2, digital, and notes. **It has been deleted again** — the local D1 is
back to its 88 items / 10 copies / 8 preordered.

| Checked | Result |
|---|---|
| 13 rows, depths 0–3, ordered by depth then sort name | ✅ |
| Ticked 11 of 13, pressed once | ✅ 12 owned / 2 preordered in D1 — **exactly the two unticked rows survived** |
| The two left behind | ✅ still `preordered`, still on the list, banner re-read "On preorder 2" |
| One-row list | ✅ *"Mat Carry Tube" has arrived and is now owned.*, card then disappears |
| Item with no preorders (35) | ✅ `{"arrivals":[]}`, **renders nothing at all** |
| No such item / bad id | ✅ 404 / 400 |
| `EXPLAIN QUERY PLAN` | `idx_item_parent` (covering) for the walk, `idx_copy_status` for the copies — no table scan |

⚠ï¸ **The bug the browser caught and the API could not.** `.arrival-note` takes a
full flex basis, and without `flex-wrap` on the row it collapsed the *name* —
the only shrinkable thing there — to zero width, leaving rows reading
"EXPANSION · wave 2" about no identifiable object. Two of the thirteen rows were
nameless on screen while the JSON behind them was perfect. **Anything added to
that row must be checked in a browser, not in curl.**

### The phone layout, and the note problem the real data exposed

The first cut was designed against an 8-row fixture and fell over on the real
22-row Ascension pledge. **Every one of those 22 rows carries the same
150-character note** — it describes the *pledge*, not the thing — and the first
layout gave each note a line of its own. Twenty-two identical lines.

| Fix | |
|---|---|
| `commonNote` | The note two or more rows share is hoisted above the list and said once |
| `noteResidual` | A row that *extends* the shared note shows only what it adds |
| Row stacks under 560px | Name on line one, `kind · ×N · digital · note` on line two, aligned past the checkbox |
| `.arrivals .form-actions` is `position: sticky; bottom: 0` | 22 rows is three screens; the confirm button was at the bottom of all of them |

⚠ï¸ **A first version demanded that all notes be *equal*, and it never fired on
the data it was written for.** Twenty rows match exactly; the base game appends
a sentence about playtime research and one expansion appends one about having no
BoardGameGeek entry. So it is a shared *prefix*, and the two odd rows now show
only their extra sentence rather than 150 characters of something already on
screen. **`commonNote` requires two rows to agree and refuses to break a tie** —
with nothing to choose between two notes, hoisting either makes the other read
as the exception.

### Three CSS traps, all found by measuring rather than looking

1. **`flex-wrap` on the row is load-bearing.** The note takes a full basis;
   with nowhere to wrap it collapsed the *name* — the only shrinkable thing —
   to zero width. Two of thirteen rows rendered nameless while the JSON behind
   them was perfect.
2. **`.arrival-meta` needs `max-width: 45%` on desktop.** A `nowrap` note has an
   enormous natural basis and flexbox shrinks in proportion to basis, so the
   metadata kept most of the row and squeezed the base game's name into a
   three-line column.
3. **The phone rule must be `flex: 1 1 0`, not `1 1 auto`.** With an auto basis a
   long name is wider than what is left beside the checkbox, so the whole span
   wrapped to the next flex line and **stranded the checkbox on a line of its
   own** — a column of tick boxes with holes in it.

⚠ï¸ **`resize_window` silently does nothing to a maximised Chrome window** —
`innerWidth` stayed 2498 and reported success. The phone layout was verified by
extracting the real `max-width: 560px` rules out of `document.styleSheets`,
applying them unconditionally, and squeezing `body` to 390px. Measured, not
eyeballed: 0 stranded checkboxes, 0 rows overflowing right, metadata below the
name on every row, 9 names wrapping to two lines, and the sticky bar yielding to
the last row at the end of the scroll.

### Still to do

- **Only the item page has it.** A collection-page group card already says
  "N on the way" in its footer and could carry the same button. Not built —
  the owner asked for the game page.
- **Partial arrival of one row is out of scope.** A copy with `quantity: 3` is
  ticked or not; if one of the three turned up, untick it and edit the copy by
  hand. Ascension Sleeves is the live case — **quantity 24**.
- **Nobody has run it on a real phone.** The layout is measured at a 390px
  content width in desktop Chrome, which is not the same as iOS Safari.

---

## State at 2026-08-08, end of session

**Everything is shipped. Working tree clean, `main` pushed through `086ac07`,
worker deployed, alias rows applied.** `main` is 13 commits ahead of where the
day started (`29f2c67`).

| | |
|---|---|
| Live worker version | **`7cfae0a7-0cfe-4dae-a58b-ea5b94d45e33`**, deployed 16:38 UTC |
| Previous version | `fcdd868d-6478-4fe4-a0ba-53f60928008b`, 14:58 UTC — roll back to this if the search changes misbehave |
| Migrations | `0021_item_alias` applied local **and** production. **None pending.** |
| Catalog | **806 items**, 806 copies, 573 owned, 29 wanted |
| `item_alias` | **72 rows across 18 items** — the D&D spellings, all `source = 'manual'` |

### Deployed 2026-08-08, late session

| | |
|---|---|
| Live worker version | **`a440debc-1781-499b-a37b-105fd8b16bbd`** |
| Roll back to | `7cfae0a7-0cfe-4dae-a58b-ea5b94d45e33` |
| Commits | `37de4b1`, `c50979e`, pushed to `origin/main` |
| Migrations | **None** — the promo split is computed on read |

**`game_component` needed nothing.** Checked before assuming: 139 eligible
games, all 139 checked, 1,437 components, 0 unclassified, 0 due, 0 stale. The
filter had live data to bite on the moment it deployed — **282 of 954** official
components move. Unstable Unicorns' accessories go 17 → 1 and Happy Little
Dinosaurs' expansions 17 → 4; neither game is in the local catalog, so neither
was part of the calibration.

⚠ï¸ **`wrangler d1 execute --remote` can read production even though Access blocks
every HTTP route.** That is the way to answer "what does production actually
hold" without a signed-in browser. `d1 list` working while `migrations list
--remote` answered `7403` was a transient; a straight retry of `execute` worked.

### Here to Slay: five `bgg_id`s set in production, 2026-08-09

*"Here to slay has uncertain results but I'm certain we own them all. Except for
the wishlist item."* — the owner. They were right, and the report agreed once it
had ids to agree with.

**Diagnosed by running the real `buildCompleteness` over production rows**, not
by reading names: pull `game_component` and the owned tree with
`wrangler d1 execute --remote --json`, then `npx tsx` a script importing
`packages/core/src/completeness.ts`. That is the only way to tell `uncertain`
from `missing` without a signed-in browser, and the distinction was the whole
answer — the expansions were `uncertain` (a name matched), the accessories were
`missing` (nothing matched at all).

| Item | Was | Now | BGG component |
|---|---|---|---|
| 858 | NULL | **321259** | Here to Slay: Warriors & Druids Expansion — name character-identical |
| 859 | NULL | **349286** | Here to Slay: Berserkers & Necromancers |
| 507 | NULL | **369125** | Warrior & Druids Meeples — *BGG's own typo*, "Warrior" singular |
| 510 | NULL | **369244** | Berserkers & Necromancers Meeples |
| 297 | NULL | **369040** | Central Play Mat — ours carries a "KS Exclusive" prefix |
| 301 | NULL | **369501** | Acrylic Standees — run by the owner 00:48 UTC |

```sql
-- reversal
UPDATE item SET bgg_id = NULL WHERE id IN (858, 859, 507, 510, 297, 301);
```

Result: expansions **4 of 7 → 6 of 7**, accessories **2 of 14 → 6 of 14**, and
the single remaining `uncertain` is *"Already on your wishlist"* against
Sorcerers & Squires — which is correct and should stay.

**301 and not 302/506/509.** BGG lists one `Acrylic Standees` (369501, 2020)
against four standee rows of ours. 301 is the only one whose name contains the
phrase, plural, and it is the base-game Kickstarter set BGG's row describes;
506 and 509 are expansion standee sets and 302 is a single Dragon standee. The
other three stay id-less on purpose — one-to-many, and a wrong id is harder to
notice later than a missing one.

Still not mapped, and probably genuinely not owned: `Bigger Box` and
`Sorcerers & Squires Meeple Set` are 2027 products, and `10/6 Play Mat Bundle`
and `Here to Sleigh: Play Mat` are retail bundles against our Kickstarter mats.

**Where the missing ids came from — and it is not the "I have it" button.**
An earlier version of this section blamed the completeness card and was wrong.
`AddComponent` in `Completeness.tsx` passes `bggId: component.bggId` straight
through to `api.createItem` (line 443), `createItemSchema` accepts it, and a
round-trip through the local worker confirmed it is stored. **Anything added
from the card comes back `held` on the next read, not `uncertain`.**

858 and 859 came from the *accessory-implies-the-game* sweep further down this
file: six Here to Slay accessories existed with no expansion row behind them, so
the two expansions were inferred and inserted by hand. That sweep reasoned from
our own shelf, never had a `game_component` row in hand, and so had no id to
copy. 507, 510 and 297 predate the component feature entirely.

The lesson is about the sweep, not the button: **an item created by inference
about our own catalog starts with no BoardGameGeek identity, and this feature
treats no-identity as not-owned.** Any future sweep of that kind should end by
matching what it created against `game_component` and setting the ids.

**Left alone deliberately:** BGG's single `Acrylic Standees` (369501) against
our three standee sets, and `Play Mat` / `Expansion Play Mat 2-pack` against our
three play-mat sets — one-to-many, so any pick is a guess, and a wrong id is
harder to notice later than a missing one. `Bigger Box` and `Sorcerers & Squires
Meeple Set` are 2027 products; `10/6 Play Mat Bundle` and `Here to Sleigh: Play
Mat` are retail bundles against our Kickstarter mats. Those four are almost
certainly genuinely not owned.

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
| Hero (expansion, own URL only) | — | publisher ← Root |
| Playmat (accessory, under Hero) | — | publisher ← **Root, two levels up**; URL ← Hero, one level up |
| Sleeve (accessory, under Playmat) | — | publisher ← **Root, three levels up** |
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

---

## A curly apostrophe is not a different word — 2026-08-08

> **COMMITTED as `086ac07`; not pushed and NOT DEPLOYED.** (This block said
> UNCOMMITTED; it was committed later the same day.) Touches
> `packages/core/src/schemas.ts` and `packages/db/src/items.ts`. **No migration,
> nothing written to production.** `npm run typecheck` passes; the mojibake sweep
> is clean.

*"Should we do a search type where we clear all marks and do a character compare
only? player's handbook / players handbook etc return the same?"* — the owner.

Narrower than "clear all marks", because two of the marks are load-bearing.
`foldSearchText` in `packages/core/src/schemas.ts` drops **seven characters** on
both sides of every comparison: three apostrophes (U+2019, U+0027, U+2018), the
backtick, and three dashes (hyphen, en dash, em dash). `&` and `:` are
deliberately kept — `D&D` would fold to `dd`, and typing `D D` would then be two
one-character terms matching most of the catalog.

Measured on the catalog, which is what settled it: **15 rows carry `’` and 47
carry `'`**, so neither spelling is the odd one out; 189 hyphens against 12 en
dashes. **Dashes fold to nothing, not to a space.** Terms are split on
whitespace, so no term ever spans a ` - ` separator (145 of them) and the two
options are indistinguishable there. Inside a word (56 of them) removal is a
strict superset: `X-Men` → `xmen` answers to "x-men", "x men" *and* "xmen".

### The fold had to be paid for, and the payment was a shape change

Query-time, no stored column — but naively it was a **4× regression**. Wrapping
four columns in seven `replace()` calls inside the existing *correlated* `EXISTS`
cost **16–27 ms against a 4–5 ms baseline**, because that EXISTS re-folds rows
once per candidate row.

Hoisting the text clause to an **uncorrelated `IN`** — the same rewrite the alias
probe already carried, for the same reason — folds the catalog once per term and
probes through `idx_item_root`: **1.7–7.1 ms**, at or under the baseline it
replaced. `EXPLAIN QUERY PLAN` now says `MULTI-INDEX OR` over two `LIST
SUBQUERY`s. Checked answer-for-answer against the old EXISTS over **1,212 query
pairs** with zero differences. End to end through a real worker the endpoint is
unmoved: 44.0 → 44.5 ms for a two-result search, 48.2 → 48.6 for `dice throne`,
and `zorblax` got *faster* (23.9 → 19.1).

⚠ï¸ **The one part that does not stay free is the alias fold**, because
`item_alias` is the only folded column whose table is unbounded. At 72 rows it
costs nothing; at a full BGG backfill (22,852 rows) it is 64–125 ms against
10–24 ms unfolded. The fix at that point is a stored folded column on
`item_alias` — measured at 11–23 ms, back to baseline. The numbers and the
trigger are in the comment on `aliasTermClause`. Not done now: production holds
**0** alias rows.

### Measured through a real worker, local D1 loaded from production

| Search box | Before | After |
|---|---|---|
| `players handbook` | **0** | **2** |
| `player's handbook` | **0** | **2** |
| `Player’s Handbook` | 2 | 2 |
| `dungeon masters guide` | **1** | **2** |
| `dungeon master's guide` | **0** | **2** |
| `aeons end` | **0** | **2** |
| `xmen` | **0** | **1** |
| `56 player` | **0** | **3** |
| `season two - battle chest` | **0** | **1** |
| `dice throne` | 12 | 12 |
| `D&D` / `DnD` / `Dungeons and Dragons` | 18 | 18 |
| `boss monster` | 5 | 5 |
| `unstable unicorns` | 4 | 4 |
| `zorblax` / `qqq` | 0 | 0 |
| *(empty)* | 171 / 171 roots, 114 grouped entries | identical |

⚠ï¸ The earlier section below records the empty search as "140 entries / 171
roots". Measured on the same 806-item local D1 today it is **114 grouped entries
/ 171 roots**, before *and* after — the 140 is stale, not a regression. An empty
search builds no term clause at all, so this change cannot reach it.

`aeons end`, `xmen`, `56 player` and the hyphen-for-en-dash row were not in the
brief — they are the same bug wearing other punctuation, found by counting
characters in the catalog rather than by guessing.

⚠ï¸ **`itemMatchesTerm` had to fold too.** It backs the "why did this match" line,
and the term reaches it already folded — left alone it would have returned
*Betrayal at House on the Hill* for "widows walk" and then refused to say which
child explained it. Verified: it names *Widow's Walk*.

### Scanner behaviour is unchanged, and it was checked rather than assumed

`vision.ts`, `barcode.ts` and `routes/aliases.ts` are not in the diff, and no
scanner module imports `foldSearchText` or `searchTerms`. Running the real
`buildTitleIndex`/`matchIndexedTitle` over `GET /api/item-names` with the 72
alias rows present still gives **`aliasKeys` = 0**, still matches `CATAN` → #54,
and still refuses `D&D`, `DnD` and `ZORBLAX QUANDARY`. `normaliseTitle` still
folds `Player’s` to `player s` **with a space** — the two folds are deliberately
different and remain so.

---

## Search learns the line's name, and its spellings — 2026-08-08

> ⚠ï¸ **COMMITTED as `0e3e169`, not pushed and NOT DEPLOYED.** (This block said
> UNCOMMITTED; it was committed later the same day.) `scratchpad/dnd-aliases.sql`
> is still untracked. **Nothing was written to production** — the alias rows are
> applied to a local D1 only.

*"We might also need to add aliases to the parents so DnD, Dungeons and Dragons,
D&D etc all return in the search for this one."* — the owner.

Two changes, because the two mechanisms that would answer this were both
invisible to the search box: `termClause` looked only at `name`, `publisher` and
`designers`, and `item_alias` (migration 0021) was read only by the scanner.

| | |
|---|---|
| Change 1 | `termClause` also matches **`series`** — free, no new data |
| Change 2 | a new `aliasTermClause` also matches **`item_alias`**, per search term |
| Change 3 | `scratchpad/dnd-aliases.sql` — **72 rows, 4 spellings on 18 roots** |

### Measured, local D1 loaded with production's 806 items and 806 copies

Result counts are **matching game trees**, which is what the page shows.

| Search box | Before | + `series` | + aliases |
|---|---|---|---|
| `D&D` | **1** | 14 | **18** |
| `DnD` | **0** | 0 | **18** |
| `Dungeons and Dragons` | **0** | 0 | **18** |
| `Dungeons & Dragons` | 4 | 4 | **18** |
| `dice throne` | 12 | 12 | 12 |
| `zorblax` | 0 | 0 | 0 |
| *(empty)* | 140 entries / 171 roots | — | unchanged |

`D&D` returning **1** before is the whole bug in one number: 109 rows across 14
trees are the D&D line, and only the 2024 Dungeon Master's Guide came back,
because somebody happened to type "D&D" into a child row's name.

### ⚠ï¸ The alias clause must stay an uncorrelated `IN`

`item_alias` is empty in production today, so the cost is nothing *today*. It
will not stay empty — a full BGG backfill is ~116 alternate names per game.
Measured against a synthetic 22,908-row table:

| Alias clause | Cost of the collection count |
|---|---|
| correlated `EXISTS (… WHERE ta.root_game_id = i2.root_game_id …)` | **22–27 ms** |
| uncorrelated `i2.root_game_id IN (SELECT …)` | **6–10 ms** |
| unchanged code, for comparison | 3–5 ms |

A leading-wildcard `LIKE` can use no index, so the table gets scanned either
way; the `IN` form scans it **once per search term** instead of once per
candidate row. `EXPLAIN QUERY PLAN` must say `LIST SUBQUERY`, not `CORRELATED`.
End to end the endpoint is **35–40 ms** for a search either way, on 806 items.

### Why looser matching is right here and wrong in the scanner

The comment at the top of `routes/aliases.ts` and the three rules in
`buildTitleIndex` keep aliases out of loose matching **because a scanner match
is an unattended decision** — it marks a game already-owned and the box
disappears from the review list with nobody watching. A search box inverts every
term of that: it is already `LIKE '%term%'`, a person reads the list and picks,
and nothing is written. The failure that actually costs the owner something is
typing "DnD" and being told they own nothing.

**They share no code.** The scanner reads aliases through `listItemAliases` →
`buildTitleIndex`/`matchIndexedTitle` in `packages/core`; search reads them in
SQL in `matchingRootsSql`. `MIN_SPINE_SIMILARITY`, `isConfidentMatch` and the
three index rules are untouched. The asymmetry is deliberate in both directions:
a **contested alias belongs to nobody in the scanner and to everybody here** —
showing both games that answer to a name is right for a human and wrong for an
unattended matcher.

### Which rows got the aliases, and the free safety property

**18 roots, not 109 rows.** Search matches whole *trees*, so one alias on a root
surfaces its whole tree; tagging all 109 returns the identical page for six times
the rows. 14 roots come from `series = 'D&D'` (the core books were promoted to
roots today); the other 4 are the D&D-branded board games — Castle Ravenloft,
Legend of Drizzt, Wrath of Ashardalon, Tomb of Annihilation — which carry no
`series`, were already returned by "Dungeons & Dragons" and were *not* returned
by "D&D". Without them the four spellings disagree with each other.

⚠ï¸ **Spreading a string across the line is what makes it inert in the scanner.**
`normaliseTitle` folds the four spellings to three keys (`d and d`, `dnd`,
`dungeons and dragons`), each claimed by all 18 roots, so rule 2 drops all
three — verified by running the real `buildTitleIndex` logic over
`GET /api/item-names`: **`aliasKeys` comes back empty.** Putting one of these on
a *single* root is what would change scanner behaviour.

### Left for the owner

- **Apply `scratchpad/dnd-aliases.sql` to production**, deliberately not done
  here. Before-state and reversal are in the file's header; production
  `item_alias` was **0 rows** when read on 2026-08-08. It is idempotent.
- **There is still no web UI for typing an alias.** These rows go in by SQL or by
  `POST /api/aliases/items/:id`. Every other line — Dice Throne, Boss Monster —
  has the same spelling problem waiting.
- **A series-level alias would be the honest model.** These 72 rows say
  "*Ryoko's Guide to the Yokai Realms* also answers to DnD", which is true of the
  line, not of the book. An `item_alias` row is the mechanism that exists today.
- ⚠ï¸ **Unrelated find: `Player’s Handbook` uses a curly apostrophe (U+2019).**
  Searching `players handbook` returns **0**; `dnd handbook` returns 2. Nothing
  to do with this change, and it will bite somebody.

---

## A game with two names is one game — 2026-08-08

> ⚠ï¸ **UNCOMMITTED, UNDEPLOYED, and living in a worktree**, not in `main`:
> `.claude/worktrees/agent-adb38407889808798`. Migration **0021 is applied
> locally only**. The owner reviews and ships. The production *data* fix below
> is already done and is the one exception.

*"Settlers of Catan and Catan are the same game — the studio just did a naming
thing... maybe we figure out a solution for games that are the same but have
alternate names."* — the owner.

### Part 1 — it was a real duplicate row, and it is gone

Not a queue artefact. **Item 826 "The Settlers of Catan"** existed in production,
added 2026-08-07 from scan job 12. Job 13 then matched *its own* second reading
against 826, so the two photos agreed with each other and both disagreed with
item 54.

Deleted from production, cascading to two child rows. Three rows, `changes: 3`,
verified gone; item count 803 → 802. **There is no undo on `--remote`**, so the
exact reversal is written down here rather than only in a chat log:

```sql
-- Put back exactly what was deleted on 2026-08-08. Run in this order.
INSERT INTO item (id, bgg_id, kind, parent_item_id, root_game_id, name, sort_name,
                  year_published, publisher, publisher_url, designers, min_players,
                  max_players, playtime_min, weight, thumbnail_url, description,
                  created_at, updated_at, pending_parent_name, source_url,
                  game_system, series)
VALUES (826, 152959, 'base', NULL, 826, 'The Settlers of Catan', 'settlers of catan',
        2008, 'Mayfair Games', NULL, NULL, 3, 4, 90, NULL,
        'https://cf.geekdo-images.com/_1_jHYKYe93u3sCG-2gonA__small/img/Z_tnIgHi13kzToOM1qsFooSn4U4=/fit-in/200x150/filters:strip_icc()/pic747314.jpg',
        'A trading and building game in which players settle the island of Catan, placing settlements, cities and roads on a modular hex board. Resources are produced by dice rolls on adjacent terrain hexes and traded between players, with the first to reach ten victory points winning.',
        '2026-08-07 02:42:36', '2026-08-08 13:54:57', NULL, NULL, NULL, NULL);

INSERT INTO copy (id, item_id, edition_id, applies_to_copy_id, status, is_sleeved,
                  is_punched, completeness_notes, lent_to, notes, created_at,
                  updated_at, quantity, format)
VALUES (801, 826, NULL, NULL, 'owned', 0, 0, NULL, NULL, NULL,
        '2026-08-07 02:42:36', '2026-08-07 02:42:36', 1, 'physical');

INSERT INTO research_run (id, item_id, tier, model, effort, status, error_message,
                          input_tokens, output_tokens, result_json, triggered_by,
                          started_at, finished_at, created_at, input_owned,
                          input_bgg_id, input_name, input_year, unfilled)
VALUES (40, 826, 'details', 'claude-opus-5', 'low', 'done', NULL, 196, 1474,
        '{"filled":{"publisher":"Mayfair Games","minPlayers":3,"maxPlayers":4,"playtimeMin":90,"description":"A trading and building game in which players settle the island of Catan, placing settlements, cities and roads on a modular hex board. Resources are produced by dice rolls on adjacent terrain hexes and traded between players, with the first to reach ten victory points winning."},"detail":null}',
        1, '2026-08-08 13:54:10', '2026-08-08 13:54:57', '2026-08-08 13:54:10',
        1, 152959, 'The Settlers of Catan', 2008, ',publisherUrl,');
```

| Attached to 826 | |
|---|---|
| `copy` | **1** — id 801, `owned`, quantity 1, no notes, `created_at` identical to the item's. The add flow's default copy, not a recorded pledge |
| `research_run` | 1 (details, done) |
| ratings, relations, editions, barcodes, children, components, plays | **none** |

Item 54 "Catan" keeps its own `copy` id 55, **`owned` × 2**, untouched.

⚠ï¸ **Job 12's blob still carries `addedItemId: 826`**, now dangling — that job is
`done` with 0 outstanding, so it is a dead "Added — open it" link on a closed
job and nothing else. Repointing it at 54 is a one-line JSON edit nobody needs.

### Part 2 — `item_alias`, and why nothing cheaper works

⚠ï¸ **`bgg_id` matching was the obvious free answer and it is wrong here.**
Measured, not assumed: item 54 carries **13**, item 826 carried **152959**.
152959 is a genuinely separate BGG entry (Mayfair, 2008) whose *own primary name*
is "The Settlers of Catan", and the free lookup rung resolved the spine to it
correctly. An id comparison would have said "different games" and added the row
anyway. It also only ever works for the 128 of 802 rows that have an id.

What is true is that **BGG 13 lists "The Settlers of Catan" among its 64
`<name type="alternate">` nodes** — and `packages/bgg/src/client.ts` was parsing
those and throwing them away in `primaryName()`. The identity already existed
upstream.

⚠ï¸ **The similarity floor was not touched and must not be.** "Catan" vs "The
Settlers of Catan" is the *same shape* as "Quandary" vs "Zorblax Quandary" — the
case `isConfidentMatch` exists to reject. `MIN_SPINE_SIMILARITY` is still 0.7. An
alias is an **exact** match on a specific string, asserted by BGG or a person; it
earns no similarity credit and never enters the containment pass.

| Rejected | Why |
|---|---|
| `bgg_id` match | measured false on this very case, and covers 16% of rows |
| `alt_names` text column | cannot record a source, cannot delete one row, worse to query |
| Resolve at read time from BGG | the repo's instinct, and it does not apply — `inheritCover` resolves from data already in D1; alternate names are behind a network call the scan path's subrequest budget cannot afford per title |

**Three rules in `buildTitleIndex` stop an alias becoming a wrong-game bug**, and
all three *drop* the alias rather than guess. Each is measured below.

1. **A real name always wins.** BGG's alternates are not curated against this
   catalog; BGG 13 alone offers the bare "The Settlers".
2. **A contested alias belongs to nobody.** BGG 13 and 152959 both list "Los
   Colonos de Catán".
3. **Aliases are exact-only.** Containment would let "The Settlers of Catan"
   swallow "…: Seafarers", which is a different box.

### Measured, `wrangler dev` against a seeded local D1

Same code both columns; the "before" column is the alias table emptied, which is
exactly the pre-fix state.

| Spine read | Before | After |
|---|---|---|
| **The Settlers of Catan** | **NEW GAME** ← the production bug, reproduced | **OWNED → 54 "Catan"** |
| ZORBLAX QUANDARY → *Quandary* | NEW GAME | **NEW GAME** — guard holds |
| The Settlers of Catan: Seafarers | NEW, parent *"The Settlers of Catan"* (the phantom root) | NEW, **parent "Catan"** |
| Settlers of the Deep | OWNED → 91 | OWNED → 91 |

Collision rules, with the traps deliberately planted:

| | |
|---|---|
| "Settlers of the Deep" while Catan *also* claims it as an alias | → **item 91**, its real owner |
| "Die Siedler von Catan" claimed by two items | → **NEW GAME** — refuses to pick |
| "Katan", one uncontested alias | → item 54 |

Then the whole thing again against **BGG's real list, imported live**:
`POST /api/aliases/backfill` → **1 BGG call, 2 items, 116 aliases**, and every
verdict above still correct — plus a German box reading *Die Siedler von Catan*
now matching, which nothing asked for and is free.

`SELECT instr(enriched,'ownership')` is still **0** on every job: this is
resolved on read and never written, same as `inheritCover`.

### Where it is wired

| | |
|---|---|
| Migration | **0021_item_alias.sql** — `item_alias` + `alias_check`. Local only |
| The decision | `buildTitleIndex` / `matchIndexedTitle`, `packages/core/src/vision.ts` — one implementation |
| Scan paths | `scan-ownership.ts`, `scan-classify.ts`, `scan-jobs.ts`, `barcode-scan.ts`, `routes/vision.ts` |
| Import | `lib/alias-backfill.ts`, `routes/aliases.ts` (`POST /api/aliases/backfill`) |
| Read | **`GET /api/item-names` now returns `aliases` alongside `items`** — deliberately one call, because the "real name beats alias" rule cannot be applied to either list alone |

⚠ï¸ **A re-import never deletes a name a person typed** — `replaceBggAliases`
clears `source = 'bgg'` only. The manual door (`POST /api/aliases/items/:id`) is
not a fallback: 674 of 802 rows have no `bgg_id` and never will.

**No web UI for typing an alias yet.** The API is there; the item page has no
field. That is the obvious next piece.

### ⚠ï¸ Two local-dev traps, both new, both cost time here

- **The worktree path is too long for local D1.** Every `wrangler d1 --local`
  command in `.claude/worktrees/<agent>/apps/worker` fails with a bare
  `internal error; reference = …` — even `SELECT 1`. The sqlite file lands at
  ~255 characters and Windows gives up at 260. **Fix: `--persist-to
  C:/Users/nbasl/AppData/Local/Temp/bgcd1`** on every `d1` and `dev` command. It
  does not present as a path error in any way.
- **Two processes were already listening on 8787-8799.** Port 8799 answered
  `/api/health` happily while serving *another agent's* worker and *another*
  database — the handoff's existing warning, one port over and with a new
  symptom: not a dead worker, a live wrong one. `/api/aliases/status` returning
  404 was what gave it away. Check `netstat -ano | grep LISTENING` first and
  pick something odd; 8942 was free.

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

### ⚠ï¸ The trap this nearly walked into

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

---

## Two photos of one shelf stop arguing — 2026-08-06

*"if items are in a queue and scanned and another photo is in the queue and
scanned and they share games, when the game is resolved in 1 its not known to the
other item waiting processing"* — the owner. Overlapping shelf photos are normal;
resolving a box on one job left the other still offering it as new.

**The job now stores the reading and the decision; ownership is computed.**
`alreadyOwned` was a snapshot taken during enrichment and nothing revisited it.
`addedItemId` and `dismissed` are still stored — they are things a person did —
but *is this game in the catalog* is a fact about the catalog, and is answered
when the job is read. Same trade as `inheritCover` and `resolveInheritedDetails`,
which is why it took no new mechanism.

Design and the gotchas live in [`info/scan-queue.md`](info/scan-queue.md) and are
not repeated here. The state:

| | |
|---|---|
| New file | `apps/worker/src/lib/scan-ownership.ts` — the entire decision |
| Reused, not rewritten | `matchExistingTitle` (now index-backed) and `isConfidentMatch`, both in `packages/core` |
| Cost | **two D1 reads per request**, no per-title round trip |
| Migration | **none** — nothing about this is stored |
| Deployed | `3162e8fa-d650-4873-9f18-04420f20648b` (commits `50c4b14`, `d0aa235`) |

### The proposals were the same bug, one field over — fixed the same day

`proposedKind`, `proposedParentId`, `proposedParentName`, `inferredParentName`
and `reason` were **also** decided at enrichment and frozen, so an expansion
whose base game you added from the *other* photo still said *"Wingspan is not in
your collection — if this is an expansion, it will wait for it"* and offered no
parent. `withFreshOwnership` is now **`withFreshView`** and resolves both, in
that order — an owned row takes no part in classification, and a row whose base
game arrived elsewhere must be classified against a catalog that now holds it.

New `apps/worker/src/lib/scan-classify.ts` is the **only** classifier; the
enrichment pass calls it too, differing only in how ownership is known at that
point. Deployed **`9d3da413-5a84-4654-8ef0-bfb84e0cad86`**, commit `7bcfa7b`, no
migration.

⚠ï¸ **A second defect, found while testing, that silently undid the first.** The
classifier used `resolvedName` where the Add button used `effectiveName`. A spine
reading *"Qwixomo: Tidal Reach"* resolves to *Reach* — a doubtful one-word hit —
so the classifier saw a name with no colon, proposed no parent, and the row was
saved as "Qwixomo: Tidal Reach" regardless. Both now call **`scanRowName`** in
`packages/core/src/barcode.ts`; the web app's own rule moved to where both
callers reach it, with no change to the review screen's behaviour.

Measured on a seeded local two-job shelf: job B's Oceania row went from
*base / no parent* to *expansion / parent 9423 Wingspan / "already in your
collection"* with job B never touched, while the stored blob kept its stale text
and `instr(enriched,'ownership')` stayed 0 everywhere.

**Verified locally against two seeded jobs sharing a title** (`npm run dev:worker`,
no Access). Adding *Wingspan* from job A made job B's row read *"Added from
another photo — Wingspan"* on its next read, with no reload trick and no polling
change; job A's second *Everdell* line settled itself in the same response that
recorded the first; a dismissed *Scythe* stayed dismissed with *Scythe* sitting in
the catalog; a spine read *ZORBLAX QUANDARY* resolved to *Quandary* was **not**
matched against a catalogued *Quandary*, because `isConfidentMatch` rejects the
fragment; and `SELECT instr(enriched,'ownership')` stayed **0** — nothing is
persisted. Screens checked in Chrome.

⚠ï¸ **The six jobs this was written for are gone.** Production now holds **one**
scan job (id 7, `done`, 36 titles, 0 outstanding), so nothing visible changes
today — this pays from the next multi-photo session onward.

⚠ï¸ **Orphaned `wrangler dev` processes were holding ports 8787 and 5173-5176**,
from sessions on 08-05 and 08-06. `npm run dev:worker` silently moved to 8791 and
Vite to 5177, and Vite's proxy still points at 8787 — so the UI talked to a dead
worker reporting `database: down`. Kill the *node* parent, not the `workerd`
child; workerd respawns.

---

## Everything has a picture now — 2026-08-06

*"for 161 just use the base game photo, maybe we should use that as a default
fallback so no matter what everything has an image"* — the owner.

**323 → 1.** Measured over all 760 rows through `GET /api/items`, walking every
tree: **437 have a cover of their own, 322 borrow one, and exactly one is still
blank** — Excursion Tiles 1, a standalone accessory with no parent to borrow
from. The same three numbers come out of SQL directly, so the API and the table
agree.

### It works the way inherited publishers already work

`inheritCover` in **`packages/core/src/covers.ts`** is the whole decision:
nearest ancestor with art, resolved at read time, **never written**. A Dice
Throne hero's playmat takes the hero's picture, not the box's.

| Read path | How the ancestors are found |
|---|---|
| Collection trees (`buildTrees`) | the tree is already in memory — no query at all |
| Item page (`resolveInheritedDetails`) | the recursive CTE it already ran for the publisher, now selecting `thumbnail_url` too |
| Wishlist (`ancestorCoversFor`) | one extra read, and only for the rows that are blank |

⚠ï¸ **Do not "optimise" this into a stored column.** A copied URL would be
indistinguishable from a researched cover a month later, and the cover-health
cron would probe the same dead link 323 times instead of once.

### Where a borrowed cover actually shows, and where it does not

- **Item page** — yes, with a muted, linked *"Cover from Deep Rock Galactic: The
  Board Game"* under the name, the same treatment the borrowed publisher gets.
  Somebody looking at one row deserves to know the art is not that product's.
- **Wishlist** — yes. **20 of the 25 wanted rows had no cover**; a thing nobody
  has bought yet rarely does. No badge: the linked parent name is already beside
  the picture and says whose it is.
- **Collection page** — **no change, and this is expected.** The cards on that
  page are game *trees*, one per root, and a root has no ancestor to borrow
  from. Its children are rendered as a text list with no thumbnails at all, so
  there is nowhere for a borrowed cover to appear. Adding pictures to that list
  is a separate change nobody has asked for.
- **Group cards** now use the first member **that has art**, not `members[0]`
  blindly — a one-line fix that stopped a group wearing a dashed box while its
  second line had a picture.

### The dashed box is now on `.thumb`, not only `.thumb-blank`

An image that fails or has not arrived yet used to leave a hole in the row.
`.thumb` now carries the same dashed outline as a deliberate blank, and
`object-fit: cover` hides it completely once the picture paints. This matters
more than it sounds: several covers are served from `dicethrone.com` at ~780 KB
each, so **rows sit in the not-yet-loaded state for seconds** — verified in
Chrome, where all 16 requests returned 200 and simply took their time.

### What was dropped, and why

The earlier plan was a placeholder image plus a marker distinguishing "looked
for, nothing exists" from "not looked yet". **Both are unnecessary now.** With
322 of the 323 blanks answered by an ancestor, a column to describe the
remaining one would be a schema change carrying a single row. The `preordered`
case needs nothing either — an undelivered item shows its game's art like
anything else.

---

## The queue empties by design, not by having been asked — 2026-08-06

*"exclude the impossible fields so the queue can empty"* — the owner. The queue
already read **0**, but only because layer 2 remembered asking two rows and
finding nothing. Rebuild the run history and it came back.

### What the research found, and it was mostly good news

The list of "impossible" cases was checked against production's 760 rows before
any code was written. **Layer 1 already excluded every class on it.** Measured
with the run history deleted, so layer 2 could not help:

| Claimed impossible | Already excluded? | By what |
|---|---|---|
| Playing time on 19 RPG books | **yes** | `game_system` is set on all 19 |
| Player count on 6 reference books | **yes** | the same rule — it covers `minPlayers`/`maxPlayers`/`playtimeMin` together |
| Excursion Tiles 1 & 2, Pangea Gaming Table | **yes**, and they were never in the queue | `kind = 'accessory'`, and all three already carry a publisher and a publisher site |

So the 19 playtime gaps and the 6 player-count gaps are **real blanks in the
table that the queue correctly never asks about** — they show as blanks on the
item page and cost nothing. Nothing needed adding for them.

**With the run history cleared, layer 1 left exactly two rows**: Go Fish
(publisher, publisher site, year) and Divine Dungeon the Game (playing time).

### The one rule added: a game nobody published

`publisher = 'Traditional'` (or `Public Domain`, or BGG's `(Public Domain)`) now
means *there is no publisher*, and layer 1 refuses **publisher, publisher site
and year** on such a row. `NO_PUBLISHER_EXISTS` in `packages/core/src/details.ts`,
mirrored as `TRADITIONAL_SQL` in `packages/db/src/items.ts` the same way
`blankSql` mirrors `isBlankDetail`.

- **It is a marker the owner types, not a heuristic.** `publisher IS NULL AND
  year IS NULL` describes an unresearched row exactly as well as a folk game, so
  no rule computed from the other columns can tell them apart. Somebody has to
  know. The Publisher field on the edit form now carries the hint
  *"Nobody published it? Type "Traditional""* — that hint is the only place the
  convention is discoverable, so do not delete it.
- **No migration and no new column.** The value goes in the ordinary publisher
  box and reads correctly on the item page: *Publisher: Traditional*.
- **An exact, closed set of spellings, not `LIKE '%public domain%'`.** A modern
  game *released into* the public domain has a website and a year, and a fuzzy
  match would refuse both.
- **Production data changed by one row**: `UPDATE item SET publisher =
  'Traditional' WHERE id = 801` (Go Fish). Reverse it by clearing the field.

### Divine Dungeon the Game stays in layer 2, on purpose

Its playing time is published nowhere, including Mountaindale Press's own store.
That is **one item, not a class** — there is no column that makes it a class
without inventing one for a single row, and it is exactly what "asked once,
found nothing" is for. If the publisher ever prints a number, changing the row's
name or BGG id re-opens it; nothing else has to.

**So the honest target was 1, not 0**, and that is what the proof below shows.

### Queue, measured through `GET /api/research/needs-details`

Against a local D1 loaded with a read-only copy of production (760 items, 761
copies, 11 research runs) in `apps/worker/.wrangler/qsandbox`:

| | With run history | Run history deleted |
|---|---|---|
| Before | **0** | **2** — Go Fish, Divine Dungeon |
| After, marker not yet set | — | **2** — the rule is inert until someone opts a row in |
| **After** | **0** | **1** — Divine Dungeon only |

The middle row is the one worth keeping: the new rule changed nothing until the
marker was typed, so it cannot have quietly dropped a row that was merely
unresearched.

### ⚠ï¸ Loading a production snapshot into a local D1 needs three tricks

The recipe in [folding a line into one entry](#folding-a-line-into-one-entry--built-2026-08-06)
no longer works as written. All three failures present as the same unhelpful
line — *"Durable Object was reset and rolled back … FOREIGN KEY constraint
failed"* — with the whole import silently rolled back to zero rows:

1. **Split the dump one table per file and load `item` first.** `copy` inserted
   before `item` fails.
2. **Re-add `PRAGMA defer_foreign_keys=TRUE;` to the top of *each* file.**
   wrangler batches the statements, and the pragma does not survive the batch it
   was issued in — `item` alone fails without it, because a child row can precede
   its parent.
3. **Insert an `app_user` row before `research_run`.** `research_run.triggered_by`
   references it, and the export does not include the users table.

---

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

### ⚠ï¸ Rows and units differ on purpose — do not "tidy" this

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

---

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

⚠ï¸ **`wrangler tail` is the tool this project kept not reaching for.** Three
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

### ⚠ï¸ The POST is now slow on purpose — do not add a timeout

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

---

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

---

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

~~**Do yourself:** `game_component` is empty and the weekly cron next fires Sun 9
Aug. From a signed-in browser console, ~8 runs covers the catalog:
`await (await fetch('/api/components/backfill',{method:'POST'})).json()`.~~
**Done — verified against production 2026-08-08 23:5x UTC: 1,437 components
across 139 games, 139 checked, 0 due, 0 unclassified, 0 stale, last sweep 21:55
UTC. Nothing left to run.** Kept struck through rather than deleted because two
code comments were still asserting the table was empty and were wrong for days.

Scan jobs 5, 6 and 7 **no longer need retrying — they finished on their own**
the moment the fix went live: 73/73, 74/74 and 36/36, and they now sit at
`review` with 24, 41 and 23 titles still to sort.

**Three discoveries worth keeping:**
- `wrangler deploy` printed "Deployed … triggers" for weeks while Cloudflare's
  Cron Events log showed **no events at all**. Fixed with
  `npx wrangler triggers deploy` plus a full deploy. **A cron is not working
  until something it writes has rows.** *Resolved and confirmed twice over:*
  `cover_check` passed 433 rows, and a later `wrangler tail` capture caught
  `"*/30 * * * *" - Ok` with `cover check {"checked":20,"ok":20,"dead":0}` firing
  on schedule. Both crons run normally now; treat any earlier text claiming
  otherwise as historical.
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

---

## Cron triggers — were silently unregistered, FIXED and now firing

> **RESOLVED 2026-08-06.** Everything below describes the outage as found; it is
> kept because the diagnosis is the lesson. **Both crons run normally now** —
> `cover_check` has passed **437 rows**, growing 20 per run, and a `wrangler
> tail` capture caught `"*/30 * * * *" - Ok` with
> `cover check {"checked":20,"ok":20,"dead":0}` firing on schedule.
>
> The cause was that `wrangler deploy` reported registering the triggers while
> Cloudflare never scheduled them. Fixed with `npx wrangler triggers deploy`
> followed by a full deploy.
>
> **The rule it produced: a cron is not working until something it writes has
> rows.** Never treat deploy output as proof. The weekly component sweep
> (`41 5 * * 1`, which Cloudflare reads as **Sunday**) has still not had a
> scheduled run, so `game_component` stays empty until it fires or someone calls
> `POST /api/components/backfill`.

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

### ⚠ï¸ Production has no component data yet, and this is why

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
| **`createItemSchema`** (`packages/core/src/schemas.ts`) | **⚠ï¸ Yes.** A non-base item must supply a parent *or* a `pendingParentName`, so **the app cannot create a standalone accessory at all** — the Pangea table can only have arrived through the bulk import |

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

⚠ï¸ **`COMPONENT_REFRESH_CRON` in `apps/worker/src/lib/component-backfill.ts`
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

### ⚠ï¸ Lazy thumbnails defer the hero art; they do not shrink it

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
- ⚠ï¸ **Jobs enriched before this carry no suggestions.** The six sitting at
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

⚠ï¸ **`--persist-to` must be an absolute path or a path under the repo.** A
relative path is resolved against the *config file's* directory for
`wrangler dev` but against the cwd for `d1 execute`, so the two silently used
different databases — the first attempt ran `dev` against the ordinary 86-item
local DB while the migrations went to the sandbox. A path in the system temp
directory failed outright with `internal error`.

The cards, the expander, the filter, the search and the wishlist were all
exercised in Chrome against that data, not only over curl.

---

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

### ⚠ï¸ The gotcha that would have made this useless

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

### ⚠ï¸ Three rows shared one Kickstarter collage — one fixed, two refused

The campaign hero for `dice-throne-x-men-marvel-co-op-missions` shows three
boxes together, and all three catalog rows used it as their cover. The owner
wants the BoardGameGeek art selected with the collage kept in the picker.

| Item | Name | Outcome |
|---|---|---|
| 115 | Marvel Dice Throne: Missions | ✅ **Done.** Matched BGG 403495, cover now the 2025 Roxley printing, collage still offered |
| 96 | Dice Throne: X-Men | âŒ **Refused** — `isFragmentOf` rejects it. Verified by hand as **BGG 403494** "Marvel Dice Throne: X-Men" (2025) |
| 114 | Dice Throne: Deadpool Box Deluxe Edition | âŒ **Refused** — BGG's search returns *nothing* for that full string. Verified by hand as **BGG 403511** "Marvel Dice Throne: Deadpool" (2025) |

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

### ⚠ï¸ Open question: should the photo go to R2 at all?

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

---

## â­ï¸ NEXT — the vintage pop-art restyle (superseded, see above)

📄 **[`claude-vintage-pop-art-board-game-prompt.md`](claude-vintage-pop-art-board-game-prompt.md)**,
supplied by the owner 2026-08-09: *"make a new thread and consider this… We will
be doing this next but lets finish the inflight work first."*

**Nothing has been started.** It is a whole-site visual direction — aged-paper
background, halftone dots, comic panels, Bangers/Luckiest Guy headlines — so it
lands almost entirely in `apps/web/src/styles.css`, which is ~1,250 lines of
heavily-reasoned CSS. Read the comments before replacing anything: several rules
that look decorative are load-bearing, and the file now records three separate
occasions where a flex row silently collapsed the one element that mattered.

⚠ï¸ **The two fonts are a problem this repo has not had before.** Everything is
served from the Worker's own assets and there is no external font loading
anywhere today. A restyle that adds Google Fonts introduces a third-party
request on every page load — decide that deliberately, and check it against the
`connect-src`/`font-src` reality of the deployed site rather than assuming.

---
