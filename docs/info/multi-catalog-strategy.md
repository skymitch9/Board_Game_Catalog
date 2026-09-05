# Multi-Instance Strategy — how `library_catalog` runs two libraries, and what this repo would need to do the same

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — PREP ONLY,
> no code, no new Cloudflare resources, no deploys. Every file/script/env name
> below was read from the live repos on 2026-08-25 and is not invented.
> **Last verified: 2026-08-25.**
>
> ⚠️ **This is not a build doc.** Nothing here should be actioned until the
> owner asks for a second board-game catalog instance by name. It exists so
> that ask, when it comes, starts from a checklist instead of a spelunk.

---

## ⚠️ PARTLY SUPERSEDED — 2026-09-05

**The owner asked, and the build happened** (*"Both."*, 2026-09-05 ~06:50
Phoenix — `catalog-platform/docs/info/request-a-catalog-design.md` §9). Phases
1–3 of §4 below are **DONE** (`fc17ea3`, `30dc045`, `4db2f2e`), so this doc's
description of the repo is a snapshot of 2026-08-25 and no longer describes it.

| Section | Status |
|---|---|
| §0, §2, §3 — *"this repo is currently zero-instance-aware"*, the gap table | 🔴 **STALE.** The estate identity is config, the script twins exist, the deploy guards were already instance-aware, and a template `[env.<instance>]` block exists. Current facts: [`instance-model.md`](instance-model.md) |
| §4 phases 1–3 | ✅ **DONE.** ⚠️ Phase 1 was already stale when written — the guards existed on `main` |
| §4 phases 4–6, §6, §7 | Still open, still correct in shape. The operating runbook is now [`../access/second-instance.md`](../access/second-instance.md), which owns §6's checklist |
| §5 — the open `RATE_LIMITER` question | ✅ **ANSWERED, MEASURED** — per ACCOUNT. [`instance-model.md`](instance-model.md) §3, with the verbatim quote and its URL |
| **§1 — how `library_catalog` does it** | ✅ **Still the best reference in the estate**, and the reason this file is kept rather than archived |

---

## 0. The one-sentence answer

`library_catalog` runs two libraries from one codebase by giving the second
one its own Wrangler `[env.*]` block — separate Worker name, separate D1,
separate R2 bucket, separate hostname, separate secrets — while sharing
everything else (code, migrations, capability model, build). `Board_Game_Catalog`
today has **zero** of that scaffolding: one Worker, one D1, one env block, no
concept of "which instance am I." Standing up a second board-game catalog
means building the `[env.friend]`-shaped machinery this repo currently lacks
entirely, then filling it in per new instance. Nothing about the *data model*
needs to change — `game`, `edition`, `copy` etc. are already instance-agnostic
tables that only need to exist once per D1.

---

## 1. The template: how `library_catalog` does it

Source repo: `bookbuddy/library_catalog`. Two live instances:

| Instance | Hostname | Worker | D1 | R2 bucket |
|---|---|---|---|---|
| Main | `library.heygabi.ai` | `library-catalog` (top-level config) | `library-catalog` | `library-covers` |
| Friend | `padhard.heygabi.ai` | `library-catalog-friend` | `library-catalog-2nd` | `library-2nd-covers` |

Design doc: `catalog-platform/docs/info/friend-ingest-design.md` (why a second
instance rather than multi-tenant rows in one database — see §9 below).
Access reference: `bookbuddy/library_catalog/docs/access/second-instance.md`
is the concrete "how do I operate her instance" doc this strategy doc's own
checklist (§6) is modeled on.

### 1.1 The mechanism: `apps/worker/wrangler.toml`, one `[env.*]` block per instance

Everything instance-specific for the friend lives under `[env.friend]` in the
**same** `wrangler.toml` as the main config. Concretely, for each new
instance you restate:

- `name = "library-catalog-friend"` — pins the Worker name so a Wrangler
  default change can never collide it with the main Worker.
- `[env.friend.assets]` → same `directory = "../web/dist"` — **one built PWA,
  shipped to both Workers**. There is no separate frontend build per
  instance.
- `[[env.friend.d1_databases]]` → `database_name = "library-catalog-2nd"`,
  its own `database_id`, same `migrations_dir = "../../migrations"` (shared
  migration **files**, applied separately per database).
- `[[env.friend.r2_buckets]]` → `bucket_name = "library-2nd-covers"`, bound
  to the same `COVERS` binding name.
- `[env.friend.triggers]` → same cron **string** as main (`"7 * * * *"`) —
  the code dispatches on the string matching a constant
  (`DETAILS_SWEEP_CRON`), so the string must be copied exactly, not
  "roughly the same."
- `[[env.friend.routes]]` → `pattern = "padhard.heygabi.ai"`,
  `custom_domain = true`.
- `[env.friend.vars]` → a full restatement of every var the main instance
  has, because ⚠️ **Wrangler environments do NOT inherit `[vars]`, bindings,
  routes, or triggers from the top level.** An omission under `[env.friend]`
  is a missing config on the friend Worker, never a fallback to main's value.
  This is stated explicitly in the file's own comment and is the single most
  important mechanical fact in this whole pattern.

Two names are called out in the file as **identity-neutral and permanent**
versus **cosmetic and changeable**: the env name (`friend`), the D1 name
(`library-catalog-2nd`), and the bucket name (`library-2nd-covers`) are never
renamed to match whatever the hostname becomes — only the hostname
(`[[routes]].pattern`) is allowed to change. (The hostname itself went
through one rename already — `sam.heygabi.ai` → `padhard.heygabi.ai` — with
zero other files touched.)

### 1.2 Per-instance identity vars, and why each exists

Read directly out of `[env.friend.vars]` in
`bookbuddy/library_catalog/apps/worker/wrangler.toml`:

| Var | Friend's value | Purpose |
|---|---|---|
| `PEER_SELF_ID` | `"padhard"` | This instance's short id in the peer network |
| `PEER_SELF_LABEL` | `"the Padhard Library"` | Human label shown in cross-catalog "Also available in…" badges |
| `SITE_ORIGIN` | `"https://padhard.heygabi.ai"` | Used when this instance announces itself to peers |
| `PEERS` | `[{"id":"sky","label":"Sky's Library","url":"https://library.heygabi.ai"}]` | JSON array of every OTHER instance in the network. ⚠️ Adding a new instance means appending an entry here **and** to every existing instance's `PEERS`, then redeploying all of them |
| `DONOR_URL` | `"https://library.heygabi.ai"` | Which peer this instance asks for free answers before spending its own AI key (see §1.4) |
| `DEFAULT_THEME` | `"hearts"` | Cosmetic identity; resolved client-side from `location.hostname`, never read by the Worker itself |
| `GABI_PANEL` | `"on"`/`"off"` | Feature flag, independently switchable per instance |
| `COVERS_BASE_URL` | instance's own bucket's public URL | "Both, or neither" with the `COVERS` R2 binding |
| `ESTATE_APP` | `"library2"` (main is `"library"`) | This instance's identity at the shared estate-auth directory — see §1.3 |
| `FIREBASE_PROJECT_ID` | same as main (`"audiobook-catalog"`) | ⚠️ **Shared, not per-instance** — this is the mechanism by which one Google account is one person across every catalog in the estate. Never fork this per instance |
| `OWNER_EMAILS` | same as main | The recovery hatch; identical on both because the owner needs into both |

### 1.3 Estate-auth identity: one app id per instance, same secret-naming rule

Each instance is its own **estate consumer** — `ESTATE_APP = "library"` vs
`"library2"` — which the auth Worker's directory tells apart by the **bearer
value presented**, not by hostname. The paired secret name changes with the
app id: `ESTATE_APP_TOKEN_LIBRARY` (main) vs `ESTATE_APP_TOKEN_LIBRARY2`
(friend) — "one value, two holders, same name both sides" (the auth Worker
holds the matching value under the identical name). `library_catalog` hit a
real bug here: until 2026-08-17 the app id was hard-coded `'library'` in
`packages/estate-auth/src/gate.ts`, so the friend instance silently asserted
the MAIN library's identity for months, and `ESTATE_APP_TOKEN_LIBRARY2` sat
on the auth Worker as an orphan nothing ever presented. The fix was making
the app id **per-instance config in `wrangler.toml`**, read at deploy time,
with a test (`packages/estate-auth/test/instance-estate-app.test.ts`) that
fails the build if two instances ever assert the same identity.

### 1.4 Cross-catalog peer features (what a second instance buys beyond "more data")

Two live features exist purely because there are two instances:

- **Peer holdings / "Also available" badges** (migration `0370`): each
  instance pushes its `work_key` set to every URL in its `PEERS` array after
  catalog mutations; the peer stores the snapshot in `peer_holding` and shows
  "In the Padhard Library" badges on gap rungs.
- **Donor-first details sweep**: before an instance's hourly missing-details
  cron spends its own `ANTHROPIC_API_KEY`, it asks `DONOR_URL`'s
  `GET /api/donor/details?title=…&author=…` (guarded by a shared
  `DONOR_TOKEN` secret, present on both instances under the identical name)
  for a free answer first. This is the concrete payoff of running "the same
  app twice" instead of two unrelated apps — the instances make each other
  cheaper to run.

Neither of these exists in `Board_Game_Catalog` today (confirmed by grep —
no `PEER_SELF`, `DONOR_URL`, or `PEERS` anywhere in `apps/worker/src`), and
neither is a prerequisite for standing up a second instance — they are
value-add once two instances exist, built in that order historically (second
instance first, peer features ~1 day later).

### 1.5 Paired scripts: `package.json`

Every operational script that touches deployment or data on the main
instance has a `:friend` twin. From `bookbuddy/library_catalog/package.json`:

| Main | Friend | What differs |
|---|---|---|
| `predeploy` (`check-clean.mjs` + `deploy-guard.mjs` + tests) | `predeploy:friend` (same + `deploy-guard.mjs --instance=friend`) | The guard is instance-aware so main being ahead of friend's `deploys.log` line is normal, not flagged as drift |
| `deploy` (`wrangler deploy`) | `deploy:friend` (`wrangler deploy --env friend`, via the worker workspace's own `deploy:friend` script) | Never called as plain `wrangler deploy --env friend` directly — the npm script is what carries the clean-tree and overlap guards |
| `postdeploy` (`deploy-done.mjs`) | `postdeploy:friend` (`deploy-done.mjs --instance=friend`) | Appends to the same `docs/deploys.log` with an extra `env=friend` field; main's lines keep their pre-instance shape byte-for-byte |
| `secret` (`wrangler secret put`) | `secret:friend` (same + `--env friend`) | — |
| `secret:list` | `secret:list:friend` | — |
| `secrets:push` (bulk, from `.dev.vars`) | `secrets:push:friend` | ⚠️ **Deliberately does NOT exist as a real bulk path.** There is no `.dev.vars.friend`; the script looks for one, finds it missing, and fails with a worded explanation rather than silently doing nothing. Every friend secret is set one at a time via `secret:friend -- NAME`, or through a "drop-box line" in the MAIN `.dev.vars` (paste, pipe, blank the line) — see §5's gotcha list |
| `db:migrate` | `db:migrate:friend` | Same migration **files**, applied to a different D1 |

### 1.6 `scripts/lib/d1.mjs` — the shared-local-DB trap, in the library's own words

This is the sharpest gotcha in the whole pattern, preserved verbatim because
the reasoning matters more than the conclusion:

> `--friend` is REMOTE-ONLY, and refusing the local combination is
> deliberate rather than lazy. There is no local copy of the second
> instance — miniflare keeps one local D1 per **binding name**, and both
> instances bind `DB` — so `--friend` without `--remote` would read the MAIN
> local database and print a confident report about the wrong catalog.

Concretely: `parseFlags()`'s `--friend` flag selects `FRIEND_DB =
'library-catalog-2nd'` only when combined with `--remote`; if `--friend` is
passed without `--remote`, `dbName()` throws rather than silently querying
main's local D1. This was learned the hard way — until this guard existed,
every backfill script (`backfill:covers`, `backfill:series`, etc.) could
*only* ever reach the main catalog, because the constant `DB_NAME` used to be
hard-coded to the main database name. Measured cost of that bug: 47 of 369
friend-instance books needed a cover backfill that no sweep could ever reach,
because nothing pointed a script at the friend D1 until the constant became
a function.

### 1.7 What is SHARED vs PER-INSTANCE — the load-bearing distinction

| Shared (one copy, all instances) | Per-instance (restated under `[env.<name>]`) |
|---|---|
| Codebase — one Worker source, one PWA build | Worker name |
| `migrations/` — the SQL files themselves | D1 database (own id, own data) |
| Capability model / role ladder (`packages/core/src/capabilities.ts`) | R2 bucket (own covers, own data) |
| `FIREBASE_PROJECT_ID` — one Google identity across the whole estate | Hostname / custom domain |
| `packages/db`, all business logic | `ESTATE_APP` identity + its paired secret name |
| CI workflow shape | Every secret VALUE that isn't explicitly shared (each instance's own `ANTHROPIC_API_KEY`, its own estate bearer) |
| The `docs/deploys.log` file (both instances append to it) | `PEER_SELF_ID`/`PEER_SELF_LABEL`/`SITE_ORIGIN`/`PEERS`/`DONOR_URL` |
| `.deploy.lock` (shared **on purpose** — both deploys build into the same `apps/web/dist`, so two concurrent deploys of different instances must not race each other's half-built assets) | Cosmetic vars (`DEFAULT_THEME`) and independently-flippable feature vars (`GABI_PANEL`) |
| Secrets that are explicitly the SAME value on every instance (`DONOR_TOKEN`, `PEER_TOKEN`) — by design, not by accident | `deploy-guard.mjs`'s ancestry check (per-instance — main being "ahead" of friend's log line is expected) |

---

## 2. Current shape of `Board_Game_Catalog`

Single instance, confirmed from the live repo:

| | Value | Source |
|---|---|---|
| Worker name | `board-game-catalog` | `apps/worker/wrangler.toml` |
| Hostname | `boardgames.heygabi.ai`, `custom_domain = true` | same |
| D1 | `board-game-catalog` — `7dd22702-f0e2-4fc7-b201-d16d60176efa`, WNAM | same |
| R2 bucket | `game-covers`, bound as `COVERS`, fronted by `gamecovers.heygabi.ai` (`COVERS_BASE_URL`) | same |
| `[env.*]` blocks | **none** — the entire config is top-level | same |
| Migrations | `migrations/` at repo root, 28 files (`0001_init.sql` … `0028_rating_half_star.sql`) | `migrations/` listing |
| Identity | `FIREBASE_PROJECT_ID = "audiobook-catalog"` (same shared estate identity as the library catalogs) | `wrangler.toml` |
| Estate auth | Estate auth IS wired, but the consumer identity is **hard-coded to `"games"`** — the app token is read as the fixed secret `ESTATE_APP_TOKEN_GAMES` (`env.ts`, `middleware/estate.ts`), and there is **no configurable `ESTATE_APP` var** (unlike `library_catalog`, which lifted its app id into `ESTATE_APP = "library"`/`"library2"` on 2026-08-17). ⚠️ **This is the exact pre-fix state the library was in** — see `library_catalog`'s `estate-auth/visibility.ts` comment: *"a hard-coded `ESTATE_APP_TOKEN_LIBRARY` read … It is `ESTATE_APP` in that repo's `wrangler.toml` now."* A hard-coded app id cannot differ per instance, so a second instance would silently assert the first's `"games"` identity — the precise bug the library already lived through | grep of `apps/worker/src` and `wrangler.toml` |
| Peer/donor features | None — no `PEER_SELF_ID`, `PEERS`, or `DONOR_URL` anywhere | grep, confirmed empty |
| Scripts | `deploy`, `secret`, `secret:list`, `db:migrate`, `db:migrate:local`, `secrets:push` — **no `:friend`-shaped twins of any of them** | `package.json` |
| `scripts/lib/` | `platform-repo.mjs` only — **no `d1.mjs`, no instance-targeting helper of any kind** | `scripts/lib/` listing |
| `scripts/check-clean.mjs` | Present, same shape as the library's (hard-gates a dirty tree, `ALLOW_DIRTY_DEPLOY=1` escape hatch) | read in full |
| `deploy-guard.mjs` / `deploy-done.mjs` | **Not present on `main`.** A branch `feature/deploy-guards-boardgame` exists (unmerged) — this repo does not yet have the ancestry-check / deploys.log-append guards `library_catalog` uses as the model for §1.5's instance-aware guard | `git` refs |
| `RATE_LIMITER` unsafe binding | Present (`namespace_id = "1001"`, 300/60s) — **`library_catalog` has no equivalent binding at all** | `wrangler.toml` grep, confirmed absent on the library side |
| `docs/access/RECOVERY.md` | States explicitly: *"One instance, one database, one bucket — simpler than its library sibling, which has two of each"* | repo's own recovery doc, §0 |

**Headline: this repo is currently zero-instance-aware.** Every mechanism
`library_catalog` uses to run two instances — the `[env.*]` block shape, the
`:friend`-suffixed script pairs, the `d1.mjs` `--friend`/`--remote` guard,
the per-instance estate identity, the deploy-guard ancestry check — is
**absent**, not merely unconfigured. Nothing here would break by adding a
second instance today (no code assumes single-instance in a way that would
actively conflict), but nothing exists to route a command, a secret, or a
deploy at "which instance" either.

One extra wrinkle this repo has that the library doesn't: the `RATE_LIMITER`
`unsafe.bindings` rate-limit namespace. `library_catalog` has never had to
answer whether that namespace is scoped per-Worker or per-account — this
repo would be the first place in the estate to find out, and should verify
it before assuming two instances get independent counters (see §5).

---

## 3. Gap analysis — what to add to mirror the pattern

| Piece | Library's version | Board game catalog needs |
|---|---|---|
| Wrangler env block | `[env.friend]` in `apps/worker/wrangler.toml` | Add `[env.<instance>]` following the exact same restatement rule (assets, d1, r2, triggers, routes, vars — nothing inherited) |
| Second D1 | `wrangler d1 create library-catalog-2nd` | `wrangler d1 create board-game-catalog-2nd` (or whatever identity-neutral name is chosen — see §6 naming note) |
| Second R2 bucket | `library-2nd-covers` | A new `game-covers-2nd`-shaped bucket, own custom domain (`gamecovers2.heygabi.ai` or similar), same "both or neither" rule with `COVERS_BASE_URL` |
| Migration targeting | `d1.mjs`'s `dbName({remote, friend})` + `--friend` flag, remote-only guard | Port the same pattern into `scripts/lib/` (currently only has `platform-repo.mjs`) — this repo has **zero** scripts that read/write D1 directly today besides Wrangler CLI calls, so this is new machinery, not a port of an existing single-instance helper |
| Deploy scripts | `deploy:friend`, `secret:friend`, `secret:list:friend`, `db:migrate:friend` | Same four, at minimum, added to `package.json` |
| Bulk secrets | `secrets:push:friend` (deliberately a stub that refuses and explains) | Port `push-secrets.mjs`'s allowlist pattern the same way — this repo's `push-secrets.mjs` already has a real allowlist (`ANTHROPIC_API_KEY`, `BGG_API_TOKEN`, `GAMEUPC_API_KEY`) plus a documented `LOCAL_ONLY` map; a second instance needs the same "explicit refuse, never silently push a dev value" posture |
| Deploy guards | `check-clean.mjs` + `deploy-guard.mjs --instance=` + `deploy-done.mjs --instance=` | `check-clean.mjs` already exists and needs no change (git-tree-wide, not instance-specific). `deploy-guard.mjs`/`deploy-done.mjs` **do not exist on `main` at all** yet — the unmerged `feature/deploy-guards-boardgame` branch should land (single-instance) BEFORE it is made instance-aware, so instance-awareness is one incremental change to an already-working guard, not two changes at once |
| `docs/deploys.log` shape | 4-field main lines, 5th `env=friend` field for friend lines | Same convention, once the guard exists to write it |
| Estate identity | The `"games"` app id is **hard-coded** (fixed `ESTATE_APP_TOKEN_GAMES` secret read); there is no configurable `ESTATE_APP` var — unlike `library_catalog`, which lifted its id into `[env.*].vars` | **Lift the hard-coded id into a per-instance `ESTATE_APP` var + a per-app `ESTATE_APP_TOKEN_<NAME>` secret**, exactly the refactor `library_catalog` did on 2026-08-17 (with the `instance-estate-app.test.ts` guard that fails the build if two instances assert the same id). This is a **prerequisite gap** — the identity must become config *before* it can differ per instance, or a second instance silently reasserts `"games"` |
| Peer/donor config | `PEER_SELF_ID`/`PEERS`/`DONOR_URL`/`DONOR_TOKEN` | Optional value-add, not required to stand up a second instance — build after, if the owner wants cross-catalog board-game features (e.g. "does the other household already own this expansion") |
| Rate limiter namespace | N/A (library has none) | ⚠️ Needs its own decision: does `namespace_id = "1001"` need to differ per instance so two Workers don't share one counter? Unverified — flag as a question to answer during build, not now (see §5) |
| CF Access deprecated fields | N/A | This repo still carries `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` as deprecated-but-present top-level vars. A new `[env.*]` block should NOT restate these (they're being removed, not extended) — worth a one-line note in the block so nobody copies them by habit |

---

## 4. Phased plan (rough effort, sequencing only — not scheduled)

This mirrors the order `library_catalog` actually happened in, per
`friend-ingest-design.md`'s own "what exists today" framing: the second
instance came first as a bare fork, features came after.

1. **Land the single-instance deploy guards first.** Merge (or rebuild)
   `feature/deploy-guards-boardgame` so `deploy-guard.mjs`/`deploy-done.mjs`
   exist and work for the ONE current instance. Doing this before adding a
   second instance means the instance-aware version is one parameter added
   to working code, not two new pieces of machinery built at once.
   *Rough effort: small — the branch reportedly already exists, likely a
   review-and-merge, not a from-scratch build.*

2. **Lift the hard-coded `"games"` app id into a per-instance `ESTATE_APP`
   var.** The repo already HAS an estate identity — it just reads a fixed
   `ESTATE_APP_TOKEN_GAMES` secret with the app name baked into source
   (`env.ts`, `middleware/estate.ts`), the exact pre-2026-08-17 state
   `library_catalog` was in. The work is the refactor the library already
   did: make the app id `[env.*].vars` config, read the token as
   `ESTATE_APP_TOKEN_<NAME>`, and add the `instance-estate-app.test.ts`-style
   guard that fails the build if two instances assert the same id. Do this
   even before a second instance exists, so the identity is *config* the day
   a fork happens.
   *Rough effort: small-medium — a config-vs-hard-code refactor + one secret
   rename + a build guard, following `library_catalog`'s already-proven shape.*

3. **Stand up the `[env.<instance>]` block + new D1 + new R2 bucket.**
   Mechanical: copy `library_catalog`'s `[env.friend]` shape, substitute
   names. Includes the deploy-guard `--instance=` flag, `docs/deploys.log`'s
   5th field, and the `:friend`-equivalent script pairs in `package.json`.
   *Rough effort: medium — mostly config, but every line needs verifying
   against this repo's actual var names (this repo's var set differs from
   the library's: no `DEFAULT_THEME`, no `GABI_PANEL`, has `BGG_API_TOKEN`/
   `GAMEUPC_API_KEY`/`RATE_LIMITER` that the library doesn't).*

4. **Port `scripts/lib/d1.mjs`'s instance-targeting pattern.** This repo
   has no equivalent file today (only `platform-repo.mjs` in
   `scripts/lib/`), so this is new code, not a copy-paste of an existing
   single-instance helper. Needs the same `--friend`-style flag, the same
   remote-only guard, and the same JSON-array-extraction robustness the
   library's version had to learn the hard way (see its own comments on
   why `--file` vs `--command` matters for reads vs writes).
   *Rough effort: medium — this repo doesn't currently have ANY backfill
   scripts that touch D1 directly (worth confirming — if none exist yet,
   this piece may not be needed until one is written).*

5. **Wire per-instance secrets + Firebase authorised domain + estate
   directory entry.** Owner-only console steps: mint the new estate app
   token pair, add the new hostname to Firebase Authorised domains BEFORE
   anyone signs in on it, seed the estate directory row.
   *Rough effort: small, but owner-gated — cannot be done by an agent.*

6. **(Optional, later) Peer/donor features**, only if a second board-game
   catalog would actually benefit from "does the other household own this
   expansion" — this is new product surface, not part of standing up the
   instance itself, and `library_catalog` built it ~1 day after the second
   instance existed, not simultaneously.
   *Rough effort: medium — a new migration, a new route pair, a cron
   change; scoped identically to `library_catalog`'s migration `0370` +
   `/api/donor/details` route.*

Nothing above should be started without the owner naming a concrete second
instance (a household, a hostname) — this phasing exists so that ask can
skip straight to step 3 once steps 1–2 are done as general hygiene, or all
six if nothing has been prepped yet.

---

## 5. Known gotchas to carry over

- ⚠️ **The shared-local-DB trap (§1.6).** If a `d1.mjs`-equivalent is ever
  written for this repo, its `--<instance>` flag MUST require `--remote` and
  throw otherwise — miniflare keeps one local D1 per **binding name**, and
  every instance here would bind `DB` just like the library's two do.
- ⚠️ **`[env.*]` inherits nothing.** Every var, binding, route, and trigger
  needed by a new instance must be **restated**, never assumed to fall back
  to the top-level config. This bit the library once already (the
  hard-coded `ESTATE_APP` identity bug, §1.3) — via code, not config, but
  the lesson generalizes: anything meant to differ per instance must be
  read from per-env config, never hard-coded in shared source, or one
  instance can silently assert another's identity.
- ⚠️ **Deploy from a clean tree, always, and doubly for a second instance.**
  `deploy:friend`-equivalent commands build `apps/web/dist` from the
  **working tree** and upload it — a concurrent agent's half-finished
  `apps/web/src` change ships to the second instance's live site exactly as
  readily as to the first. `check-clean.mjs` already exists here and refuses
  a dirty tree (with `ALLOW_DIRTY_DEPLOY=1` as the deliberate override) —
  keep relying on it, never bypass it for a "just the second instance"
  deploy.
- ⚠️ **Migrations are applied PER INSTANCE, from shared files.** One
  `migrations/` directory, but `db:migrate` and `db:migrate:<instance>` are
  two separate applies against two separate D1s. A migration is not "done"
  until it has been run against every instance that exists.
- ⚠️ **Secrets are never bulk-pushed to a second instance by default.**
  `library_catalog`'s `secrets:push:friend` is a deliberate stub that
  refuses and explains, specifically to prevent a "cleanup" push from
  overwriting a second instance's own key material (its own
  `ANTHROPIC_API_KEY`, its own estate bearer) with the main instance's
  `.dev.vars` values. If this repo ports `push-secrets.mjs`'s allowlist
  pattern to a second instance, port the refusal, not a working bulk path.
- ⚠️ **The `RATE_LIMITER` namespace question is open and repo-specific.**
  This repo has a rate-limit binding the library never had to think about
  for multi-instance. Confirm — before relying on it — whether
  `namespace_id = "1001"` scopes counters per-Worker or per-account; if the
  latter, two instances sharing that id would throttle each other's traffic
  as if it were one site. Cheapest fix if so: a different `namespace_id`
  per `[env.*]` block, same pattern as everything else in §1.7's
  per-instance column.
- **Deploy-guard ancestry checks are per-instance.** The library's guard
  checks the last `docs/deploys.log` line **of the same instance** — one
  instance being ahead of another's log line is expected, not drift. Port
  this distinction into the guard when it's made instance-aware (§4 step
  3), not treat every log line as one global sequence.
- **The estate directory needs a per-instance app id before a second
  instance can enforce estate auth.** Until the paired secret exists on the
  new instance, its estate check fails inert (logs `estate_config_unset`,
  behaves as off, new sign-ins land `pending`) — this is the SAFE failure
  mode and matches the library's documented "code before secret" deploy
  order. Never treat a missing pairing as a reason to skip deploying the
  code.
- **Naming discipline**: pick an identity-neutral internal name (env,
  D1, bucket) independent of whatever hostname gets chosen, the way the
  library's `friend`/`library-catalog-2nd`/`library-2nd-covers` outlived
  the `sam.heygabi.ai` → `padhard.heygabi.ai` rename. This repo's own
  `catalog-platform/docs/info/HEYGABI_LAYOUT.md` already has a live
  precedent for board-game hostname taste (`boardgame.` vs `games.`,
  §467) — worth reading before naming a second instance's hostname, not
  just its internal identifiers.

---

## 6. Checklist: "to add board-game catalog instance N"

Repeatable steps, in order, once the owner names a concrete instance. Assumes
§4 phases 1–2 (deploy guards, `ESTATE_APP` identity) are already landed for
the single instance.

1. Pick the instance's internal name (env block name, e.g. `friend2` or a
   household-neutral word) — never the hostname. Pick D1 name and R2 bucket
   name from the same identity-neutral rule.
2. `wrangler d1 create <new-db-name>` → record the new `database_id`.
3. Create the R2 bucket (`wrangler r2 bucket create <new-bucket-name>`) and
   attach a custom domain + 1-year Cache Rule (covers are content-hashed, so
   a cached copy can never be stale — same rule the library's covers bucket
   uses).
4. Add `[env.<name>]` to `apps/worker/wrangler.toml`: `name`, `[env.<name>.assets]`,
   `[[env.<name>.d1_databases]]`, `[[env.<name>.r2_buckets]]`,
   `[env.<name>.triggers]` (same cron strings, verbatim), `[[env.<name>.routes]]`
   (new hostname), `[env.<name>.vars]` (full restatement — every var this
   repo's top-level `[vars]` has, per §1.1's inheritance warning).
5. Add the paired estate identity: `ESTATE_APP = "<newname>"` in
   `[env.<name>.vars]`, and mint `ESTATE_APP_TOKEN_<NEWNAME>` on both this
   Worker's new env and the auth Worker, same value, same name both sides.
6. Add `package.json` script twins: `deploy:<name>`, `secret:<name>`,
   `secret:list:<name>`, `db:migrate:<name>`, and the `predeploy:<name>`/
   `postdeploy:<name>` pair wired to the (by-then instance-aware)
   `deploy-guard.mjs --instance=<name>` / `deploy-done.mjs --instance=<name>`.
7. `npm run db:migrate:<name>` — apply every existing migration to the new,
   empty D1. Confirm with the migrations-list command, not silence.
8. Mint and push per-instance secrets one at a time
   (`npm run secret:<name> -- NAME`): `ANTHROPIC_API_KEY` (this instance's
   own key, own cap), `BGG_API_TOKEN`, `GAMEUPC_API_KEY`,
   `ESTATE_APP_TOKEN_<NEWNAME>`. Never bulk-push from `.dev.vars`.
9. **Owner console steps** (cannot be done by an agent): add the new
   hostname to Firebase Authentication → Authorised domains BEFORE anyone
   signs in on it; seed the new instance's estate directory entry /
   approve its first user.
10. `npm run deploy:<name>` from a clean tree (never plain
    `wrangler deploy --env <name>`).
11. Verify: `GET /api/health` on the new hostname (with a cache-busting
    query string — custom domains here may be edge-cached, as documented
    for the library's own `/api/health`), confirm `estate.app` names the
    new identity and `estate.configured` is true. Confirm a real sign-in
    produces `"src":"seen"` in the estate pairing check, not
    `"src":"none"`.
12. Record the new instance in `docs/deploys.log` (its deploy already
    appends there via the instance-aware guard) and in this repo's
    `docs/access/RECOVERY.md` §1 inventory table, which currently says
    "one instance, one database, one bucket" — that line becomes false the
    moment step 10 lands and must be corrected in the same change.
13. (Optional) Wire peer/donor config (§1.4) if the owner wants
    cross-catalog board-game features between this instance and the main
    one — new migration, new route pair, not required for the instance to
    function on its own.

---

## 7. Open questions to raise with the owner before building

Not decisions this doc makes — flagging them so step 1 of a real build isn't
guessing:

- What hostname/identity for the second instance? (`HEYGABI_LAYOUT.md` has
  prior taste on `boardgame.` vs `games.` naming, worth reusing that
  discussion rather than re-deciding from scratch.)
- Does the second instance need its own `ANTHROPIC_API_KEY` with its own
  cap, or reuse the main instance's key as a stopgap (the library's history
  shows this happened in stages — owner's key first, then a dedicated key
  minted the same evening)?
- Default role for a new user on the second instance — same
  `ESTATE_DEFAULT_ROLE` lever the library used, paused there pending an
  owner decision (§ "the paused owner decision" in the library's
  `wrangler.toml`)?
- Is peer/donor cross-catalog behavior wanted for board games at all, or is
  this purely "a second household's separate collection" with no
  cross-visibility?
