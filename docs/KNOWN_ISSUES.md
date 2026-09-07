# Board_Game_Catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-06** for KI-8, KI-9 and KI-10 — the three added that
> day, each measured as it was written: **0** unattended `scripts/*.ts`, **0**
> code sites reading the Access vars (and their deletion measured as a
> **three**-file change, not the two the audit said), and a live edge read of
> `https://boardgames.heygabi.ai/` returning **no** `content-security-policy`,
> `x-frame-options` or `x-content-type-options`. ⚠️ **KI-2, KI-3, KI-4 and KI-5
> were NOT re-checked on 2026-09-06** and carry the dates below.
>
> Before that — **2026-09-05** — the docs audit re-measured **KI-3, KI-4 and
> KI-5**: KI-3's "what would change it" (a pre-commit check) has **not**
> happened and `.git/hooks/` holds nothing but samples, but the audit found the
> 2026-08-21 corruption had **survived in `TODO.md` for 15 days** and repaired
> it (see the note added to KI-3); KI-4's number is **still 0** disposed copies,
> re-read from live D1; KI-5's headers are **unchanged**, re-read from the live
> site. ⚠️ **KI-2 was NOT re-checked** and still carries 2026-08-15 — nobody
> listed the `bgc-photos` bucket on this pass.
>
> ⚠️ Nothing here was resolved or removed on 2026-09-05. All four live entries
> stand.
>
> ➕ **Two entries ADDED later on 2026-09-05** by the route-test pass (agent
> W9-BOARD-ROUTES): **KI-6** (the 401 leaves as a bare code) and 🔴 **KI-7**
> (an `admin` can demote the last `owner`). Both were found by writing the
> repo's first route tests, both are pinned by `.todo` cases naming the KI
> number, and neither was fixed — KI-7 is role-bearing and is the conductor's
> call. ~~Six live entries now stand.~~
>
> ✅ **KI-7 is RESOLVED (2026-09-06, agent W9-KI7)** — the conductor called it,
> the guard was ported from `library_catalog` into `setUserRole`, and it is
> deployed (`c0e55a0` as `e4519a77`). Its `.todo` cases are live tests now.
> ~~**Five live entries stand: KI-2, KI-3, KI-4, KI-5, KI-6.** KI-6 is untouched
> and is still the one `.todo` in the suite.~~
>
> ✅ **KI-6 is RESOLVED TOO (2026-09-06, agent W13-PLAT-SMALL)** — and it was
> fixed the way the entry itself demanded, ONCE for the estate rather than once
> per repo. `46212c0`, deployed `c344869a-d215-4773-a67d-91e5914992f0`.
> ~~**Four live entries stand: KI-2, KI-3, KI-4, KI-5.**~~ ⚠️ **The suite now
> has ZERO `.todo` cases** — both KI-numbered placeholders written by
> W9-BOARD-ROUTES are live tests. (The count there was 789; it is **860** as of
> the same evening.)
>
> ➕ **THREE ENTRIES ADDED 2026-09-06 (agent W13-GAMES)**, by the pass that
> triaged all 24 rows of the 2026-08 code audit. They exist because this is
> where a row that is *not* going to be fixed has to go — otherwise closing the
> audit would mean quietly dropping it:
>
> | | Symptom in one line | Status | The number to watch |
> |---|---|---|---|
> | **KI-8** | Nothing in `scripts/` is ever type-checked | `ACCEPTED` | `scripts/*.ts` run UNATTENDED — **0** today |
> | **KI-9** | The dead Cloudflare Access vars are still declared | `BLOCKED` — the owner's `wrangler.toml` | code sites reading either var — **0** since 2026-08-10 |
> | **KI-10** | The app ships no CSP, and its own comment used to claim one | `WATCHING` | `SHOW_ESTATE_SEARCH` turning true |
>
> **Seven live entries stand: KI-2, KI-3, KI-4, KI-5, KI-8, KI-9, KI-10.**
>
> **This file exists to stop the same non-bug being re-reported every month.**
> It holds things that ARE wrong, or look wrong, and are deliberately tolerated.
>
> - Work in flight → [`TODO.md`](TODO.md)
> - Traps you fall INTO while working → [`info/gotchas.md`](info/gotchas.md)
> - Finished work → [`DONE.md`](DONE.md)
>
> ⚠️ **A gotcha is something you *do* wrong. A known issue is something that
> *is* wrong and is tolerated.**
>
> Every entry carries **Symptom · Status · Why tolerated · What would change
> it** — the last one a NUMBER wherever it can be. Format rules:
> `catalog-platform/docs/DOCS_STANDARD.md` §5.

**Status values:** `ACCEPTED` · `WAIVED` · `BLOCKED` · `WATCHING`.

---

## ~~KI-1~~ · RESOLVED 2026-08-21

`HANDOFF.md` was split into `TODO.md` (4 open items) + `DONE.md` (36 finished
sections) + `info/` (gotchas, system reference, design decisions) per estate
DOCS_STANDARD. The original is archived at
`archive/HANDOFF.superseded-2026-08-21.md`.

---

## KI-2 · `bgc-photos` is an unbound bucket holding zero objects — `ACCEPTED`

**Symptom.** A bucket exists, is empty, and is skipped by the backup matrix.

**Why tolerated.** It is genuinely empty (measured 2026-08-15) and unbound to
any Worker, so a zero-object listing is the truth rather than a failed backup.
`scripts/backup-r2.mjs` would otherwise treat 0 objects as a failure — correctly,
which is why the bucket is out of the matrix rather than passed `--allow-empty`.

**What would change it.** The day it holds anything, it joins the matrix.
⚠️ Written as a rule in `backup.yml`'s header beside the matrix it explains —
prose has lost that argument before, which is why `estate-audio` got a
mechanical guard instead.

---

## KI-3 · Text written on this machine can come back double-encoded — `WATCHING`, and it has now happened TWICE

**Symptom.** Every `—`, `…`, `✅`, `⚠️` and `·` in a file turns into `â€"`,
`â€¦`, `âœ…`, `âš ` and `Â·`. ⚠️ **Nothing catches it** — the file typechecks,
builds, deploys and renders; it just reads as garbage.

**Why tolerated.** It is an environment trap (UTF-8 bytes decoded as cp1252 and
re-encoded), not a bug in any one script. This repo's own gotchas file has
recorded it since the `ScanPage.tsx` incident; it recurred on **2026-08-21**
during the `HANDOFF.md` split, corrupting **1,362 lines across six docs**.

**What would change it.** A pre-commit check. Until then, ⚠️ **after any bulk
rewrite of text files on this machine, scan before committing** —
`git diff` will show it, and so will one heading.

🔴 **THREE THINGS THAT MAKE THE REPAIR ITSELF DANGEROUS**, all measured the day
it recurred:

1. ⚠️ **Detect per SEGMENT, not per file or per line.** A whole-file round trip
   reported *zero* corrupt files against a file with 681 corrupt lines: one
   character outside cp1252 anywhere makes the encode raise and the file is
   written off as clean. Per-line has the same flaw one level down.
2. ⚠️ **Prefer git over inference.** Where the pre-corruption bytes exist in a
   commit, restore them — that is exact. The archived `HANDOFF` copy was
   restored that way and verified **byte-identical** (223,407 bytes).
3. 🔴 **NEVER run a repair to convergence.** A document *about* mojibake
   contains mojibake **on purpose** — this repo's gotcha reads *"every `—`,
   `…` and `·` came back as `â€”`, `â€¦` and `Â·`"*. A second pass turns that
   into *"`·` came back as `·`"* and destroys the example. It happened, and the
   line had to be restored verbatim from the original.

🔴 **Measured 2026-09-05 (docs audit): the 2026-08-21 repair was INCOMPLETE, and
nobody noticed for 15 days.** `docs/TODO.md` still carried **9** corrupt
sequences from that day — 8 × `⚠` followed by the cp1252 round-trip of the
variation selector (bytes `c3af c2b8 c28f` where `efb8 8f` belonged), and 1 ×
`⏳` as `c3a2 c28f c2b3`. They are repaired now, byte-for-byte, in the same pass
that wrote this note. **Why they survived:** the corruption ate only the
*invisible half* of an emoji — the rendered text still showed a warning sign, so
every reading of that file since 2026-08-21 looked fine. ⚠️ **This is a fourth
danger to add to the three above: a whole-file eyeball does NOT find this.**
Grep for the byte sequences, not for wrong-looking words. The repair here was
run **once**, against a byte pattern, and deliberately did not touch this file
or `info/gotchas.md`, both of which contain mojibake on purpose (danger 3).

**What would change it, restated with a number:** a pre-commit check. Measured
2026-09-05 — `.git/hooks/` contains **nothing but the stock `.sample` files**,
so no such check exists in this repo and none of the three occurrences was
caught mechanically. Three occurrences, three hand repairs, one of them
incomplete for two weeks, is the argument.

---

## KI-4 · A copy that was GIVEN AWAY is stored as `status = 'sold'` — `ACCEPTED`

**Symptom.** `SELECT status FROM copy` says `sold` for a game the owner gave to
a friend. Nothing in the app shows that word — `copyStateLabel()` renders "given
away", the status dropdown reads "no longer ours", and both exports carry a
`disposal` column beside `status` — but a hand-written query, or anyone reading
the table directly, sees the wrong verb.

**Why tolerated.** SQLite cannot alter a CHECK constraint. Adding `given_away`
to `status IN (…)` requires the full 12-step rebuild of `copy`, which carries a
self-referencing FK, two FKs out, **two triggers from migration 0002 that a
rebuild drops silently**, five indexes and 838 live rows. Migration 0002 already
hit this wall and chose triggers over a CHECK for exactly this reason. Option B
— a nullable `disposal` column — is additive, reversible and was the plan doc's
own recommendation ([`info/copy-status-history.md`](info/copy-status-history.md)
§3). The distinction the owner asked for is a *reason*, not a state: sold, given
away and lost all mean "no longer ours".

**What would change it.** ⚠️ **The number to watch is how many people read the
database directly, not how many copies are disposed.** Today that is one
session at a time through `wrangler d1 execute`, and every rendering path goes
through `copyStateLabel()`. If a second consumer of the raw `copy` table appears
— a report, a sync, another app — that cannot be routed through
`packages/core`, the rebuild becomes worth buying. `DISPOSED_STATUS` in
`packages/core/src/constants.ts` is the one constant that moves when it does.

**Not a candidate for change:** the count of disposed copies. It was **0** on
2026-09-02, and even at 500 the storage shape would be no more wrong than it is
at 1. ✅ **Re-measured 2026-09-05 (docs audit), read-only against live D1: still
0.** `copy` holds **839** rows, **0** with `status = 'sold'`, **0** with a
non-null `disposal`, and `copy_event` holds **0** rows — so three weeks after
migration 0029 shipped, the feature has still never been used on a real copy.
That is the entry standing, not weakening: the number to watch was never this
one.

---

## KI-5 · The theme assets ship `immutable` **and** `no-cache` in the same header — `WATCHING`

**Symptom.** Measured against the live site on **2026-09-02**, and ✅
**re-measured unchanged on 2026-09-05** (docs audit, `curl -s -D -`): all three
rows below still come back exactly as written — `/assets/estate-theme.css` and
`/assets/theme.js` still serve `public, max-age=31536000, immutable, no-cache`,
and `/estate/estate-search.js` still serves a clean `no-cache`. The `WATCHING`
status is unchanged; still nobody has reported a stale skin, and still no
browser has been observed revalidating.

| Path | `Cache-Control` served |
|---|---|
| `/assets/fonts/rajdhani-400.woff2` | `public, max-age=31536000, immutable` |
| `/assets/estate-theme.css` | `public, max-age=31536000, immutable, no-cache` |
| `/assets/theme.js` | `public, max-age=31536000, immutable, no-cache` |
| `/estate/estate-search.js` | `no-cache` |

`apps/web/public/_headers` carves the two un-hashed theme files out of the
`/assets/*` immutable rule and its comment states the mechanism as *"later rules
override earlier ones for the same header"*. **Cloudflare Assets CONCATENATED
them instead**, so `immutable` survives beside the `no-cache` that was meant to
replace it. The `/estate/*` file is the control: it sits outside `/assets/`,
inherits nothing, and comes back clean.

**Why tolerated.** `no-cache` is the stronger directive and forces revalidation,
and `immutable` is defined only for responses that are *fresh* — which
`no-cache` prevents. So the intended behaviour almost certainly still holds, and
the theme did update across the 2026-08-17 re-sync without anyone reporting a
stale skin. ⚠️ **But that is reasoning, not a measurement** — no browser was
observed revalidating this file, and Firefox and Safari are the two engines that
honour `immutable` at all.

**What would change it.** ⚠️ **One report of a phone stuck on an old theme after
a re-sync**, or a measured load in Firefox/Safari that skips revalidation on
`/assets/estate-theme.css` while the ETag has changed. The fix if it happens is
to move the two files out of `/assets/` entirely — the same shape
`sync-estate-search.mjs` already uses for `/estate/`, which is why that path is
the clean one in the table above. Related durable reference:
[`info/estate-theme.md`](info/estate-theme.md).

---

## ~~KI-6~~ · RESOLVED 2026-09-06 — the 401 is a sentence, and the sentence is shared

✅ **Fixed and deployed**, commit `46212c0`, worker version
`c344869a-d215-4773-a67d-91e5914992f0` (roll back to
`a20b7aed-a865-44ff-b77a-2e61d2c50c67`). ⚠️ **It was fixed the way this entry
demanded — ONCE for the estate, not once per repo.** The words come from
`estateSignInRefusal()` in
`catalog-platform/packages/estate-auth/src/refusals.ts`, materialised into
`apps/worker/src/estate-auth/` by the existing `scripts/sync-estate-auth.mjs`;
nothing about the sentence is authored in this repo. The same helper closed
`library_catalog`'s identical line and catalog-platform's index Worker in the
same pass — three Workers, one sentence.

🔢 **The number this entry demanded, and it was met the hard way.** It said the
fix waited on *"ONE non-browser consumer of `/api/*` … Today that number is
**0**."* That number is **still 0** — nothing was found that consumes it. The
fix shipped anyway, because the estate rule is about the RESPONSE rather than
about a client being kind enough to make up for it, and because the shared
helper made the cost three lines instead of a repo-local sentence that would
itself become drift. ⚠️ **Recorded plainly so nobody reads this as the trigger
having fired: it did not. The economics changed, not the evidence.**

**Measured live 2026-09-06** on `https://boardgames.heygabi.ai/api/me` with
`curl -sS -D <file> -o <file>`: **27 bytes → 501 bytes**, carrying `detail`,
`what`, `needs` and `how`. The `error` code is **unchanged** at
`unauthenticated` — `tools/estate-probes` and the apex's
`assets/estate-search.js` both branch on it, so the fix is purely additive.

⚠️ **NOT VERIFIED:** no signed-in request was made (no agent session holds a
Firebase ID token), so the measurement is the unauthenticated edge only, and
**nobody has seen this sentence rendered in a browser.**

**What follows is the entry as it stood, kept because the reasoning is still
the record of why it waited.**

**Symptom.** `middleware/auth.ts:64` answers an unauthenticated request with
`{"error":"unauthenticated"}` and a 401, and nothing else. No `detail`, no
"sign in", no route back. Every other refusal in this Worker carries words:
`requireCapability` names the capability and the role,
`middleware/estate.ts`'s two refusals each carry a `detail` sentence (pinned by
`lib/estate-refusals.test.ts`), and `lib/billing-gate.ts` returns
`detail` + `needs` + `how`. This one does not.

Measured 2026-09-05 by `apps/worker/src/routes/users.test.ts` (the `.todo`
case named KI-6): the body is exactly `{"error":"unauthenticated"}`.

**Why tolerated.** In a browser it is unreachable in practice — `apps/web`
holds a Firebase session and never issues an unauthenticated `/api/*` call, so
no person has seen this body. The estate rule it breaks is about the RESPONSE
rather than about one client being kind enough to make up for it, which is
exactly the argument `lib/estate-refusals.test.ts`'s header already records for
`estate_revoked`; the difference is that this one is a 401 and is therefore
self-describing to a *machine*, where `estate_revoked` was not.

⚠️ **`bookbuddy/library_catalog` has the identical line**
(`apps/worker/src/middleware/auth.ts:157`), so this is an estate-wide shape, not
a board-catalog defect. A fix should land on both Workers in one pass or it
becomes the drift it is trying to remove.

**What would change it.** ⚠️ **One non-browser consumer of `/api/*`** — GABI,
a script, the index Worker, a second surface, anything holding a curl. Today
that number is **0**. The moment there is one, this body is the first thing it
sees when a token expires, and a bare code gives it nothing to print. The fix
is three lines beside the existing `misconfigured` branch and needs no
migration.

---

## ~~KI-7~~ · RESOLVED 2026-09-06 — an `admin` can no longer demote the last `owner`

✅ **Fixed and deployed**, commit `c0e55a0`, worker version
`e4519a77-f6b6-41f6-9c51-37f8e4450242` (roll back to
`62fc5645-7a2e-4866-b38d-5a195b0d5750`). The guard moved into `@bgc/db`'s
`setUserRole` — the one role-write path — keyed on the **target's current
role**, so both mounts inherit it and the actor's identity stops mattering. The
two route-level copies are deleted; the two `.todo` tests named KI-7 are live
and the companion that pinned the 200 is gone. The whole story, the port and
what was NOT verified live in [`DONE.md`](DONE.md).

🔢 **The number this entry was written UNMEASURED to demand, measured
2026-09-05 read-only against production D1** — this is its home, and it is what
took the entry from theoretical to next-in-line:

| Role | Count |
|---|---|
| `owner` | **2** |
| `admin` | **1** |
| `member` | **1** |

⚠️ **Two owners, not one, and the hole was still fully reachable** — the single
`admin` could demote the first owner (allowed: one remains) and then the second
(the bug). "At 1 or more this stops being theoretical" was met.

**What is left below is the entry as it stood**, kept because the *reason* the
fix is shaped this way is in it. Nothing below describes current behaviour.

---

**Symptom.** Both role-write routes — `routes/users.ts:69` (the People page) and
`routes/admin.ts:122` (the federated estate surface) — guard the last owner with

```
if (userId === actor.id && parsed.data.role !== 'owner') { … countOwners() … }
```

so the guard fires **only when the actor is editing themselves**. Neither route
reads the TARGET's current role, and `setUserRole` in `packages/db/src/users.ts`
has no guard at all. `canGrantRole` lets an `admin` grant every rung beneath
`admin` — `member`, `guest`, `pending` included — so an `admin` can demote
somebody who is an `owner`. With one owner in the table, `countOwners()` reaches
**0**, and after that **no role in this app can ever mint an `owner` again**,
because an `admin` may not grant one. The way back is `OWNER_EMAILS` plus a
sign-in, or hand-written SQL against live D1.

Measured 2026-09-05 by the `.todo` cases named KI-7 in
`apps/worker/src/routes/users.test.ts` and `admin.test.ts`: with a target at
`owner` and `countOwners() == 1`, an `admin`'s PATCH answers **200** on both
mounts. A companion live test pins that 200 so the day it becomes a 400 is
visible.

**Why tolerated (for now).** ⚠️ **It is tolerated for one session, not
accepted.** The catalog holds a small, known set of accounts and no `admin` who
is not also trusted; the exposure is an accident or a compromised admin session,
not an open door. The reason it is not fixed in the same pass that found it is
the estate rule that a role-bearing change is the conductor's call — this is the
one class of edit where "obviously right" has already been wrong once.

✅ **`bookbuddy/library_catalog` had this exact bug** (its 2026-08 audit HIGH,
`apps/worker/src/routes/users.ts:90`) **and has already fixed it**: the guard
moved INTO `setUserRole` and is keyed on the target's current role, so any write
that would demote the final owner is refused whoever the actor is, and both
mounts inherit it at once. Its regression test is
`library_catalog/apps/worker/src/routes/users-role-guard.test.ts`. **The fix is
written, reviewed and running in a sibling repo; this repo simply never took
it.**

**What would change it.** ~~The count to watch is **the number of `admin`
accounts in `app_user`**. ⚠️ **That number was NOT measured when this entry was
written** — the session that found the bug had no live-D1 read in its brief, and
filling it with something plausible would be exactly the
assumption-in-a-measurement's-clothes this tree forbids. Read it with
`SELECT COUNT(*) FROM app_user WHERE role = 'admin'` and write it here. At **1
or more** this stops being theoretical and the port becomes the next
role-bearing task.~~ ✅ **Measured 2026-09-05: 1 `admin`** (table at the top of
this entry), and the port shipped the same night. The
port is: move the guard into `setUserRole`, key it on the target's current role,
delete the two route-level copies, flip the two `.todo` tests live and delete the
two "pins the current behaviour" companions. **That is exactly what was done.**

⚠️ **One behaviour genuinely changed beyond the fix**, recorded so nobody reads
it as a regression: an `admin` demoting **themselves** while a single `owner`
existed used to be refused, with a sentence about owners that had nothing to do
with them (the old guard keyed on `userId === actor.id` and never looked at the
actor's role). It is now allowed. Pinned by
`packages/db/test/set-user-role-last-owner.test.ts`.

---

## KI-8 · Nothing in `scripts/` is ever type-checked — `ACCEPTED`

**Symptom.** `scripts/` is not an npm workspace and has no `tsconfig.json`, and
the root `typecheck` is `tsc --noEmit --workspaces --if-present`. So the
`.ts` files in that directory are checked by nobody: `tsx` runs them by
stripping types, which is not the same thing as agreeing with them.

Measured 2026-09-06 (2026-08 audit, finding 22): running
`tsc --noEmit --strict` by hand on `scripts/measure-matcher.ts` reported **2**
errors — `loadCatalog`'s return type omitted `scans` while the body returned it
(TS2353) and `main()` destructured it (TS2339). Both are fixed; what is not
fixed is that nothing would have caught them, and nothing will catch the next
one.

**Why tolerated.** ⚠️ **The consequence is bounded in a way the app's own code
is not.** These are operator tools run by hand, one at a time, by somebody
watching the output — `measure-matcher`, `push-secrets`, the estate syncs, the
provisioner. A type error surfaces as a script that fails in front of the person
who ran it, not as a silent wrong answer in production, and none of them is in
the deploy path except the three `sync-estate-*.mjs` files, which are `.mjs` and
have no types to check. Adding a `scripts/tsconfig.json` is not free either: the
directory mixes `.ts` and `.mjs`, several files import from workspaces by
package name, and a half-configured tsconfig that reports 200 phantom errors is
worse than none, because it teaches everybody to ignore it.

**What would change it.** ⚠️ **The number to watch is how many `scripts/*.ts`
files are run UNATTENDED** — by a cron, a hook, CI, or another script. Measured
2026-09-06: **0**. Every one is a person at a terminal. The day a `.ts` script
joins a scheduled job or the deploy chain, its failure stops being visible to
anyone and this entry stops being tolerable. The other trigger is size: at
**2** `.ts` files in `scripts/` today, a tsconfig is ceremony; the argument
changes well before ten.

---

## KI-9 · The dead Cloudflare Access vars are still declared — `BLOCKED` (owner's file)

**Symptom.** `apps/worker/wrangler.toml:243-244` still sets
`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, and `src/env.ts:54-56` still
declares both fields `@deprecated`. Nothing reads either one — measured
2026-09-06, a repo-wide grep returns the two declarations, one test's
do-not-restate list, and nothing else. 2026-08 audit, finding 14.

🔢 **The precondition their own comment names has been met for four weeks.**
`wrangler.toml:234-237` says they *"stay ONLY until the Access application is
deleted… delete these two lines and the matching fields in src/env.ts
together, once it is gone"* — and line 126 of the same file records that
**Access was deleted 2026-08-10**. The instruction has been live since; nobody
has run it.

**Why tolerated.** ⚠️ **Not a judgement call: `apps/worker/wrangler.toml` is
the owner's file and agents are refused edits to it** — the billing vars live
in the same file and the owner flips those himself. So this is `BLOCKED`, not
`ACCEPTED`: nobody decided the vars should stay, they simply cannot be removed
from here. The runtime cost is zero — two unread strings — and the values are
not secrets (an Access team domain and two public audience ids, already
committed in a public repo).

⚠️ **It is NOT a one-line deletion, which is worth knowing before starting.**
Three files move together: `wrangler.toml` (the two lines), `src/env.ts` (the
two fields — leaving those behind is not a type error, leaving the vars without
the fields is), and `apps/worker/src/lib/instance-template.test.ts:124`, which
asserts `CF_ACCESS_AUD` is **still present** in the live config precisely so
that the second-instance template's "do not copy these" rule cannot quietly
become a claim that the cutover finished. That assertion has to be deleted in
the same commit, along with `MUST_NOT_RESTATE` and the template prose that
names them.

**What would change it.** ⚠️ **One owner commit; the exact shape is the
paragraph above.** The number to watch is **0** — the count of code sites
reading either var. It has been 0 since 2026-08-10, and the day it is not,
deleting them stops being safe rather than merely overdue.

✅ **Finding 6, which used to belong in this entry, is NOT open.** The audit
read a ⚠️ block calling `ESTATE_CHECK` *"deliberately 'off'… inert until the
owner flips it"* three lines above `ESTATE_CHECK = "enforce"`. Re-read
2026-09-06: **corrected on 2026-08-26 by `93fad25`**, three days after the
audit verified the row. The block now opens *"⚠️ ESTATE_CHECK IS 'enforce' —
see the value two lines below"* and describes the live 403/503 behaviour. It is
recorded here rather than nowhere because that is the second finding in this
audit (with 13) whose defect was fixed within days and whose ROW stayed open
for two weeks.

---

## KI-10 · The app ships no CSP, and its own comment says otherwise — `WATCHING`

**Symptom.** `apps/web/public/_headers` sets `Cache-Control` and nothing else.
Measured 2026-09-06, repo-wide: **0** CSP directives anywhere in this
repository. `App.tsx` nonetheless carried a comment instructing a future
editor not to delete *"the CSP entries"* while `SHOW_ESTATE_SEARCH` is false —
entries which have never existed. 2026-08 audit, finding 17.

✅ **The comment half is fixed** (2026-09-06): it now says plainly that there
is no CSP, so nobody re-enables `EstateSearch` trusting an allow-list that is
not there. The missing CSP itself is what this entry holds.

**Why tolerated.** A CSP added blind is the kind of change that white-screens a
site on a Sunday, and this app has no dev lane — `npm run deploy` goes to the
live custom domain. Writing one honestly means enumerating what the page
actually loads: Firebase auth, the estate SSO origin, the materialised
`<estate-search>` component, the estate theme CSS and fonts, `gamecovers.
heygabi.ai`, and every image CDN a hotlinked cover can come from
(`cf.geekdo-images.com`, `ksr-ugc.imgix.net`, Gamefound). ⚠️ **`img-src` is the
hard one**: covers are hotlinks to hosts nobody here controls, and a list that
is wrong shows a page of broken pictures rather than an error anybody can read.

✅ **The edge was CHECKED, 2026-09-06** — the one fact the audit listed as not
verified, and the one that decides how much this matters. `curl -sS -D -
https://boardgames.heygabi.ai/` returned **200** with **no
`content-security-policy` header**, and no `x-frame-options` or
`x-content-type-options` either. So nothing is applied outside the repo: this
entry is about a missing *header*, not merely a missing comment. Full header
set on that read: `Content-Type`, `Cache-Control: no-cache`, `CF-Cache-Status`,
`Nel`, `Report-To`, `Server`, `CF-RAY`, `alt-svc`.

**What would change it.** ⚠️ **The trigger is `SHOW_ESTATE_SEARCH` becoming
true**, or any other cross-origin surface landing in this app — that is the
moment the allow-list the old comment imagined has to be real. Until then the
exposure is bounded by what the app is: one origin, a Firebase session, no user
-supplied HTML anywhere, and `editCatalog` required to write anything at all.
⚠️ **The cheap first step is NOT a CSP** — it is `x-content-type-options:
nosniff` and `x-frame-options: DENY` in `_headers`, which cost two lines, cannot
white-screen the site, and are the two this read found missing. A CSP after
that, `img-src` last.
