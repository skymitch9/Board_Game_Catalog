# Handoff

Everything needed to continue or finish this without Claude.

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
| `research_run.triggered_by` | 54 | **54** ← the one that mattered |
| `app_user.approved_by` | 1 | **1** — user 2 → 1, self-reference intact |
| `user_item` (ratings) | 0 | **0** |
| stash / `app_user_new` leftovers | — | **0** |

Live schema now reads `CHECK (role IN ('owner', 'rater', 'viewer', 'pending'))`,
read back from `sqlite_master` rather than assumed. `d1_migrations` latest is
`0023_viewer_role.sql`.

⚠️ **`run_links` was 54, not the 46 recorded elsewhere in this file** — it had
grown since. That is the argument for capturing before-counts rather than
trusting a documented number: the check is *before == after*, not *== 46*.

⚠️ **`d1 execute --remote` threw 7403 once and a straight retry worked.** Same
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

⏳ **The badge itself is still unseen, and correctly so** — production has **0**
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

⚠️ **`PeoplePage` no longer hardcodes its role list** — it derives from `ROLES`.
The old hardcoded copy is exactly how `viewer` would have shipped assignable
nowhere. A new role now needs `ROLES`, `CAPABILITY_MATRIX`, `ROLE_BLURB`, a
badge tone, **and a CHECK migration**.

### Still open

- **Nobody is a `viewer` in production yet**, and nothing is pre-provisioned.
- ⚠️ **The audiobook catalog cannot be migrated in — it stores no email addresses.**
  Read live 2026-08-10: **8 profiles, 3 passphrase users, 0 email-like fields on
  any of them.** `ensureProfile()` writes only `displayName`/`photoURL`, and the
  Google email lives in `localStorage` as `ab_identity_email`, never in
  Firestore. This app keys `app_user` on the Access JWT's email claim, so there
  is no join key and name-matching would be a guess. The roster, for reference:
  Amber Mitchell, Jamie Jeremiah Lievertz, Remy, Ronnie, Samantha Hardman,
  Skylar, Sparkling Ember, *Tim Connell* (the owner asked to exclude Tim).
  **The working route is the existing one:** they sign in, land as `pending`,
  and the owner presses *Make viewer* — the badge now says when they are waiting.
- ⚠️ **Port 8787 is squatted by another project's dev server** (its `/api/me`
  answers with `trackReading`, `scan`, `reviewName`). `apps/web/vite.config.ts`
  proxies there, so `npm run dev` can silently talk to the wrong app's API.
  Check before trusting a local web session.

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

⚠️ **`CF_ACCESS_AUD` was deliberately NOT changed, and that is correct.** The
hostname was added as a *second destination* on the existing Access application
rather than as a new application, so it inherits that app's audience and its
Production policy (Cloudflare allows five destinations per app). Verified live:
an unauthenticated request 302s to the Access login, and a signed-in load renders
real D1 data. Full reasoning: [`access/login.md`](access/login.md) §"Where the
app lives".

⚠️ **If it looks unreachable from the house, it is almost certainly the router**
caching NXDOMAIN — `ipconfig /flushdns` does not clear it. Check with
`Resolve-DnsName <host> -Server 1.1.1.1`. This cost a full false diagnosis.

Access is untouched and still enforcing. Nothing about the app, its data or its
policies changed — only where it answers.

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

⚠️ **The one thing still worth a glance is the font path**, because it fails
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

## ⏭️ NEXT — the vintage pop-art restyle (superseded, see above)

📄 **[`claude-vintage-pop-art-board-game-prompt.md`](claude-vintage-pop-art-board-game-prompt.md)**,
supplied by the owner 2026-08-09: *"make a new thread and consider this… We will
be doing this next but lets finish the inflight work first."*

**Nothing has been started.** It is a whole-site visual direction — aged-paper
background, halftone dots, comic panels, Bangers/Luckiest Guy headlines — so it
lands almost entirely in `apps/web/src/styles.css`, which is ~1,250 lines of
heavily-reasoned CSS. Read the comments before replacing anything: several rules
that look decorative are load-bearing, and the file now records three separate
occasions where a flex row silently collapsed the one element that mattered.

⚠️ **The two fonts are a problem this repo has not had before.** Everything is
served from the Worker's own assets and there is no external font loading
anywhere today. A restyle that adds Google Fonts introduces a third-party
request on every page load — decide that deliberately, and check it against the
`connect-src`/`font-src` reality of the deployed site rather than assuming.

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

### ⚠️ The expansions dropdown was unreadable on a phone — fixed

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

⚠️ **This is the third time one flex row has silently eaten its own name**, after
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

⚠️ **This reverses a decision recorded on `WishlistPage`** — that sending
somebody to the scanner for something they do not have was "always the wrong
direction". The observation was right and the conclusion was half of one:
standing in a shop holding a box you have not bought is exactly a box in your
hand. What was wrong was sending them to `/scan`, which adds things as **owned**
and navigates away.

**Adding no longer closes the form.** What was added is handed to
`WishlistExpansions`, which asks BoardGameGeek what else exists and offers it as
a checklist behind *"See expansions (N)"*.

⚠️ **Nothing is ticked to start with — the opposite of `Arrivals`, deliberately.**
A preorder arriving already happened and the tick confirms it. Wanting an
expansion has not happened, and wanting all sixteen is a claim nobody made.

⚠️ **A component just added comes straight back in the list, and that was a
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

⚠️ **`ItemPicker` suggestions fire on `onMouseDown`, not `onClick`** — deliberate,
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

⚠️ **It walks the subtree, not `root_game_id`.** The cheaper join is wrong: a
game can hold two pledges at once — a base game bought years ago and an
expansion wave still in the post — and confirming one must not offer up the
other. Asking from an expansion's page therefore lists that expansion's branch
and nothing from the base game beside it. Verified locally: asking from item 112
returned 3 rows, asking from item 111 returned 13.

⚠️ **There is no bulk write endpoint, deliberately.** Each ticked row is an
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

⚠️ **The bug the browser caught and the API could not.** `.arrival-note` takes a
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

⚠️ **A first version demanded that all notes be *equal*, and it never fired on
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

⚠️ **`resize_window` silently does nothing to a maximised Chrome window** —
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

⚠️ **`wrangler d1 execute --remote` can read production even though Access blocks
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

## ⏭️ ON HOLD — disposal & copy history

⏸️ **Do not start this, and do not re-ask the `lent` question, until the weekly
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

## ⏭️ Superseded note — marking things sold or given away

*"We also have no way to mark things sold or given away or any statuses
manually. I gave away item 303 since another item covered it and I have many
other games I want to give away or sell. Can we add a way to edit it and then
change its status tag from owned to lent or sold or something. This can be in a
different thread."* — the owner, 2026-08-09. **Not built. Do not start it
without reading this first.**

⚠️ **Half of it already exists, so this is probably not the feature it sounds
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

⚠️ The completeness feature reads `owned/lent/preordered` as **held**. Any new
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

⚠️ **The false positive the owner predicted was real, and it is `die`** — the
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

⚠️ **`wrangler d1 migrations apply --remote` does not work on this account.** It
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
| 425 | 429978 | Cyberpunk: Johnny Silverhand **& NCPD** | ⚠️ **not** 430049 |

```sql
-- reversal
UPDATE item SET bgg_id = NULL
 WHERE id IN (192, 254, 258, 257, 162, 236, 495, 423, 424, 425);
```

⚠️ **Two traps, both caught by the owner rather than by the matcher.**

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

⚠️ **The Dice Throne sleeves are the interesting failure.** `withoutGamePrefix`
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

### ⚠️ Work in flight at the moment this was written

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
| ⏳ **`game_component` is filling — finish it** | Was 0 all day; the owner started the backfill 2026-08-08 and it is at **1,217 components / 100 games checked**. Roughly 7 more runs of `await (await fetch('/api/components/backfill',{method:'POST'})).json()` from a signed-in console, or the Sunday 05:41 UTC cron does the rest unattended. **Until it finishes, the completeness page reads "Not checked yet" and the collapsible sections built today are invisible** — they are not broken, they have nothing to show |
| **Accessory implies the game — a sweep worth doing** | Proved on Here to Slay: six accessories (Warriors & Druids ×3, Berserkers & Necromancers ×3) existed with no expansion row behind them, and both expansions were real. Now added as items **858** and **859**. You own **221 accessories against 186 expansions**, so this almost certainly holds on other lines. Banner Quest is the control case — accessory *and* expansion both present |
| ✅ **The BGG audit is CLOSED** | All 806 rows audited and resolved. **`bgg_id` coverage went 197 → 232.** Every remaining row without one has a *recorded reason*, not a gap. The map is `scratchpad/bgg-audit-2026-08-08.tsv`; the decision sheet `scratchpad/bgg-audit-review.md` is **spent** — its "nothing has been applied" line is historical. Both are safe to delete once you trust the result |
| ✅ **All five SUSPECT rows resolved** | 114 Deadpool (id is right; see [`dice-throne-shape.md`](dice-throne-shape.md) — the box owns the id) · 496 Yeti or Not (id is the game, our name says which version) · 801 Go Fish (the `Traditional` marker) · 56 and 68 (publisher-spelling noise). **Do not re-open these** |
| ✅ **`copy.edition_id` stays null — settled, not a gap** | The owner, 2026-08-08: *"that'll probably be null forever, it's a hard thing to find and I don't super care to track it down."* 1,063 edition rows exist with 768 BGG version ids, so the catalog knows which printings **exist** and deliberately does not record which one is on the shelf. **Do not re-flag this as missing data.** Consequences, all fine: the cover picker is unaffected (it sets `thumbnail_url`, not `edition_id`), and it independently kills the "grab the closest edition" half of any BoardGameGeek sync — you cannot match a printing you never recorded. Under 1% of BGG users populate that field either |
| Excursion Tiles (117, 118) | share a `series` but have **no `same_family` edge**, so the group card forms while neither item's page mentions the other. One row: `INSERT INTO item_relation (from_item_id,to_item_id,relation) VALUES (117,118,'same_family');` |
| ⚠️ Three orphaned non-base rows sitting as their own roots | 823 Dark Moon: Shadow Corporation (`expansion`, wants nesting under 790), 842 Tiny Epic Dungeons Adventures: The Phantom Voyage (`expansion`, under 840), 830 Scales of Fate Metal Upgrade Kit (`accessory`, under 91) |
| HELLDIVERS 2: Mystery Expansions (item 414) | rename from the box when the pledge ships; deliberately a placeholder |
| Dice Throne playmats | count them on the shelf — see `scratchpad/dice-throne-playmats.md` |
| ⚠️ Excursion Tiles 1 (117) says **2024** | its campaign actually ran **2025-08-06 to 2025-08-27** (543 backers, $24,488), delivering Oct 2025. 2024 has no evidence behind it. **Left alone deliberately** — the owner has settled both these years by hand; it is a one-line `UPDATE item SET year_published = 2025 WHERE id = 117` if they agree |

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

⚠️ **The one part that does not stay free is the alias fold**, because
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

⚠️ The earlier section below records the empty search as "140 entries / 171
roots". Measured on the same 806-item local D1 today it is **114 grouped entries
/ 171 roots**, before *and* after — the 140 is stale, not a regression. An empty
search builds no term clause at all, so this change cannot reach it.

`aeons end`, `xmen`, `56 player` and the hyphen-for-en-dash row were not in the
brief — they are the same bug wearing other punctuation, found by counting
characters in the catalog rather than by guessing.

⚠️ **`itemMatchesTerm` had to fold too.** It backs the "why did this match" line,
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

## Search learns the line's name, and its spellings — 2026-08-08

> ⚠️ **COMMITTED as `0e3e169`, not pushed and NOT DEPLOYED.** (This block said
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

### ⚠️ The alias clause must stay an uncorrelated `IN`

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

⚠️ **Spreading a string across the line is what makes it inert in the scanner.**
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
- ⚠️ **Unrelated find: `Player’s Handbook` uses a curly apostrophe (U+2019).**
  Searching `players handbook` returns **0**; `dnd handbook` returns 2. Nothing
  to do with this change, and it will bite somebody.

## A game with two names is one game — 2026-08-08

> ⚠️ **UNCOMMITTED, UNDEPLOYED, and living in a worktree**, not in `main`:
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

⚠️ **Job 12's blob still carries `addedItemId: 826`**, now dangling — that job is
`done` with 0 outstanding, so it is a dead "Added — open it" link on a closed
job and nothing else. Repointing it at 54 is a one-line JSON edit nobody needs.

### Part 2 — `item_alias`, and why nothing cheaper works

⚠️ **`bgg_id` matching was the obvious free answer and it is wrong here.**
Measured, not assumed: item 54 carries **13**, item 826 carried **152959**.
152959 is a genuinely separate BGG entry (Mayfair, 2008) whose *own primary name*
is "The Settlers of Catan", and the free lookup rung resolved the spine to it
correctly. An id comparison would have said "different games" and added the row
anyway. It also only ever works for the 128 of 802 rows that have an id.

What is true is that **BGG 13 lists "The Settlers of Catan" among its 64
`<name type="alternate">` nodes** — and `packages/bgg/src/client.ts` was parsing
those and throwing them away in `primaryName()`. The identity already existed
upstream.

⚠️ **The similarity floor was not touched and must not be.** "Catan" vs "The
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
| **The Settlers of Catan** | **NEW GAME** ← the production bug, reproduced | **OWNED → 54 "Catan"** |
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

⚠️ **A re-import never deletes a name a person typed** — `replaceBggAliases`
clears `source = 'bgg'` only. The manual door (`POST /api/aliases/items/:id`) is
not a fallback: 674 of 802 rows have no `bgg_id` and never will.

**No web UI for typing an alias yet.** The API is there; the item page has no
field. That is the obvious next piece.

### ⚠️ Two local-dev traps, both new, both cost time here

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

⚠️ **A second defect, found while testing, that silently undid the first.** The
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

⚠️ **The six jobs this was written for are gone.** Production now holds **one**
scan job (id 7, `done`, 36 titles, 0 outstanding), so nothing visible changes
today — this pays from the next multi-photo session onward.

⚠️ **Orphaned `wrangler dev` processes were holding ports 8787 and 5173-5176**,
from sessions on 08-05 and 08-06. `npm run dev:worker` silently moved to 8791 and
Vite to 5177, and Vite's proxy still points at 8787 — so the UI talked to a dead
worker reporting `database: down`. Kill the *node* parent, not the `workerd`
child; workerd respawns.

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

⚠️ **Do not "optimise" this into a stored column.** A copied URL would be
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

### ⚠️ Loading a production snapshot into a local D1 needs three tricks

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
| Deployed version | `3162e8fa-d650-4873-9f18-04420f20648b` — scan-job ownership computed on read (2026-08-06), at 100% |
| Previous version | `cfa81473-5fd2-4436-8d5b-664d02fdc02a` — the same change without the provenance guard |
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

> **Current list of what actually needs a person lives in
> [`open-questions.md`](open-questions.md).** This section is the older
> setup-level backlog; item 1 below is done.

### 1. BoardGameGeek token — ✅ DONE

**The token is set** in both `wrangler secret` and `apps/worker/.dev.vars`, and
has been in use all session — 153 items carry a `bgg_id` and 1,060 printings have
been imported through it. The rest of this entry is kept only as the recipe, in
case it ever needs reissuing.

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
