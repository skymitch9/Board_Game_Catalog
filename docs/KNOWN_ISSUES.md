# Board_Game_Catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-05** — the docs audit re-measured **KI-3, KI-4 and
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
> call. Six live entries now stand.
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

## KI-6 · The 401 leaves this Worker as a bare code with no sentence — `ACCEPTED`

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

## KI-7 · An `admin` can demote the LAST `owner`, leaving the catalog with none — `BLOCKED` (owner/conductor call)

🔴 **This is a live privilege bug, not a cosmetic one.** It is recorded here
rather than fixed because the fix is role-bearing.

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

**What would change it.** The count to watch is **the number of `admin`
accounts in `app_user`**. ⚠️ **That number was NOT measured when this entry was
written** — the session that found the bug had no live-D1 read in its brief, and
filling it with something plausible would be exactly the
assumption-in-a-measurement's-clothes this tree forbids. Read it with
`SELECT COUNT(*) FROM app_user WHERE role = 'admin'` and write it here. At **1
or more** this stops being theoretical and the port becomes the next
role-bearing task. The
port is: move the guard into `setUserRole`, key it on the target's current role,
delete the two route-level copies, flip the two `.todo` tests live and delete the
two "pins the current behaviour" companions.
