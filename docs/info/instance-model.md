# The instance model — what is shared, what is per-instance, and the one thing that had to be measured

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> **Last verified: 2026-09-06** — ⚠️ **for §4's new `index-push` row ONLY**,
> which was measured that day (suite 762 → 781 across the two commits — +4 here, +15 in the
> provisioner's sibling commit — 0 fail;
> `typecheck` clean; deploy `a20b7aed`; the backstop's decision read live out of
> `wrangler tail`). ⚠️ **Nothing else on this page was re-measured on that date**
> — §1–§3 and the rest of §4 still carry 2026-09-05.
>
> **Previously verified: 2026-09-05.**
>
> ⚠️ **Updated 2026-09-05 (phase 9):** §4's `BILLING_SITE` row is CLOSED — the
> constant became `billingSite(env)`, measured by `npm test` (223 pass / 0 fail,
> up from 220) and `npm run typecheck` clean. ⚠️ **Not deployed and it did not
> need to be:** `BILLING_POLICY = "off"` on main means the only two call sites
> never run, and with `ESTATE_APP = "games"` the function returns the same
> string the constant did — a provable no-op for the live Worker.
>
> ⚠️ **What was measured today:** the `RATE_LIMITER` `namespace_id` question (§3)
> — read from Cloudflare's own docs, quoted verbatim with its URL — and every
> row of §2, read out of this repo's `apps/worker/wrangler.toml`,
> `package.json` and `apps/worker/src/` after the phase-8 build landed
> (`fc17ea3`, `30dc045`, `4db2f2e`).
>
> ⚠️ **What was NOT measured:** anything live. No second instance exists. No
> Cloudflare console, no `wrangler secret list`, no `/seen` call, no second
> Worker, no D1, no bucket, no hostname. Every claim about how a second instance
> would BEHAVE is inference from config and from `library_catalog`'s two live
> instances, not from a running one here.
>
> - How to OPERATE a second instance (commands, manual steps, verification) →
>   [`../access/second-instance.md`](../access/second-instance.md)
> - How `library_catalog` does it, and the original gap analysis →
>   [`multi-catalog-strategy.md`](multi-catalog-strategy.md) ⚠️ **partly
>   superseded** — see its banner
> - Why any of this exists →
>   `catalog-platform/docs/info/request-a-catalog-design.md` §7.6, §8

---

## 1. Where this repo stands

**One live instance** — `boardgames.heygabi.ai`. There is no second Worker, D1,
bucket or hostname, and this repo does not create one: a second games catalog is
stood up by the owner-run provisioner when a games request is accepted
(request-a-catalog design §7.6, phase 9).

What landed on 2026-09-05 is the **capability**, not an instance:

| Piece | Where |
|---|---|
| The estate identity as config, with a same-id build guard | `apps/worker/src/lib/estate-app.ts` + `.test.ts` |
| `ESTATE_APP = "games"` | `apps/worker/wrangler.toml` `[vars]` |
| A commented `[env.<instance>]` TEMPLATE + its drift guard | `apps/worker/wrangler.toml` (foot) + `apps/worker/src/lib/instance-template.test.ts` |
| `:games2` script twins, and a worded refusal while the instance does not exist | `package.json`, `scripts/instance-guard.mjs` |
| A bulk secret push that refuses per-instance keys | `scripts/push-secrets.mjs` |
| Instance-aware deploy guards (already present before this) | `scripts/deploy-guard.mjs`, `scripts/deploy-done.mjs` |

---

## 2. Shared vs per-instance, for THIS repo

🔴 **The load-bearing mechanical fact: `[env.*]` inherits nothing that matters.**
Vars, D1, R2, routes, triggers and unsafe bindings are all restated per
environment. An omission is a **missing binding on that Worker**, never a
fallback to main's value. (`main`, `compatibility_date` and
`compatibility_flags` are the exceptions wrangler does inherit.)

| Shared — one copy, every instance | Per-instance — restated under `[env.<name>]` |
|---|---|
| The codebase; **one built PWA** (`apps/web/dist`) shipped to both Workers | The Worker `name`, pinned so a wrangler default cannot collide it |
| `migrations/` — the SQL FILES | The D1 database (own id, own data; same files applied separately) |
| The role ladder and capability model | The R2 covers bucket **and its own covers hostname** — ⚠️ `gamecovers.heygabi.ai` is taken; a custom domain belongs to exactly one bucket |
| `FIREBASE_PROJECT_ID = "audiobook-catalog"` — 🔴 **never forked.** One Google account is one person across the estate; a second project makes the same human two people | The hostname / custom domain |
| `INDEX_URL` (the same index Worker) | `ESTATE_APP` + its paired `ESTATE_APP_TOKEN_<UPPER>` secret |
| `ESTATE_AUTH_URL`, and the cron STRINGS (copied character for character) | `INDEX_PUSH_TOKEN` — the index tells its machine callers apart BY THE VALUE |
| `docs/deploys.log` — every instance appends to it, with a 5th `env=<name>` field | `ANTHROPIC_API_KEY` — that household's spend, their cap |
| `.deploy.lock` — 🔴 shared **on purpose**: both deploys build into the same `apps/web/dist`, so two concurrent deploys of *different* instances still race each other's half-built assets | `RATE_LIMITER` `namespace_id` — see §3 |
| `OWNER_EMAILS` — the estate owner's break-glass belongs on every instance | The deploy guard's ancestry check (one instance being ahead of another's log line is normal) |

⚠️ **Two vars a new instance must NOT restate:** `CF_ACCESS_TEAM_DOMAIN` and
`CF_ACCESS_AUD`. Cloudflare Access stopped authenticating this Worker on
2026-08-10 (`middleware/auth.ts` verifies Firebase ID tokens); both are
`@deprecated` in `src/env.ts` and kept only until the Access application is
deleted. Restating them extends something being removed. Their absence from the
template is asserted by `instance-template.test.ts`, not merely intended.

### 2.1 Why the identity had to become config first

The estate directory tells its consumers apart **by the bearer's VALUE**, and the
secret's NAME follows the app id. Until 2026-09-05 the id was declared in source
(`middleware/estate.ts`'s posture, plus a fixed `ESTATE_APP_TOKEN_GAMES` read in
two files), so a second instance would have presented the FIRST one's badge.

🔴 **This is not hypothetical.** `library_catalog` shipped exactly it and ran
with it for months (estate credentials catalog F-5): its second instance knocked
on the directory as the main library, the `ESTATE_APP_TOKEN_LIBRARY2` secret the
auth Worker held was an orphan nothing ever presented, and the `vis_library2`
column written to gate that household gated nothing. **Nothing failed** — no
test, no log line, no 500. A hard-coded identity is indistinguishable from a
correct one until you ask which instance is speaking, which is why
`/api/health` now answers that question without a sign-in.

---

## 3. 🔴 `RATE_LIMITER` `namespace_id` — MEASURED 2026-09-05

**The question** (request-a-catalog design §8 item 3, and this repo's own
`multi-catalog-strategy.md` §5, both of which recorded it as genuinely unknown):
does `namespace_id = "1001"` scope counters per Worker or per account — i.e. would
two games instances sharing it throttle each other?

**Source:** <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>,
read 2026-09-05. Quoted verbatim:

> Two rate limiting bindings that share the same `namespace_id` — even across
> different Workers on the same account — share the same rate limit counters for
> a given key. This is intentional and allows you to enforce a single rate limit
> across multiple Workers. If you do not want to share rate limit state between
> bindings, use a unique `namespace_id` for each binding.

> A string containing a positive integer that uniquely defines this rate limiting
> namespace within your Cloudflare account (for example, "1001").

> For each unique key you pass to your rate limiting binding, there is a unique
> limit per Cloudflare location.

**The answer, in three lines:**

1. **Per ACCOUNT, not per Worker.** Two Workers — or two wrangler environments of
   one Worker — sharing a `namespace_id` share one set of counters.
2. **So a second games instance declares its OWN `namespace_id`** (the template
   uses `"1002"`). This Worker's key is the client IP
   (`middleware/rate-limit.ts`), and it is one Cloudflare account, so a shared id
   makes two households spend one 300-per-60s budget whenever they share an
   egress IP — a NAT, a household router, a phone on the same carrier CGNAT.
   ⚠️ It is not a hypothetical for the *main* instance either: the existing
   comment already notes both household members can share one IP.
3. ⚠️ **Never change the MAIN instance's `"1001"`.** Changing a namespace silently
   resets every counter — already recorded beside the binding, and unaffected by
   this finding.

**One thing worth knowing that the question did not ask.** `"1001"` is
**Cloudflare's own documentation example value**. Nothing in this estate collides
with it today — grepped 2026-09-05 across `Board_Game_Catalog`, `bookbuddy` and
`catalog-platform`: this is the **only** rate-limit binding anywhere, and
`library_catalog` has none. But any future Worker on this account that copies the
docs' example would silently join this catalog's counter, and the failure would
look like unexplained 429s on an unrelated site.

**Counters are also per Cloudflare location**, so a limit is never a single global
number — relevant if anyone ever tries to reason about the 300/60s figure from
observed traffic.

**What was NOT measured:** nothing was exercised. No second binding was created
and no counter was observed being shared. This is the vendor's documented
behaviour, quoted, not a reproduction.

---

## 4. Known gaps a second instance would inherit

Recorded here rather than in `KNOWN_ISSUES.md` because none of them is *wrong*
today — they are consequences of there being one instance, and each becomes real
the day there are two.

✅ **One gap listed here on 2026-09-05 was CLOSED the same day** — the
`BILLING_SITE` constant. It is now `billingSite(env)`
(`apps/worker/src/lib/billing-gate.ts`), resolved from `ESTATE_APP` through the
same `resolveEstateApp()` the gate uses, because the site id and the app id are
one identity: the auth Worker's `siteForApp()` maps `games → games` and the
system door answers for the consumer whose bearer was presented. An
unrecognised `ESTATE_APP` gives `null`, not `games` — the failure direction of
`estate-app.ts`, not of `billingPosture`. Main's value is unchanged and pinned
against `wrangler.toml` by `billing-gate.test.ts`.
⚠️ **Consequence for the auth Worker:** adding `games2` to `CONSUMER_APPS` also
needs a `games2` arm in `siteForApp()` and a `games2` entry in `BILLING_SITES`
there, or that repo does not compile. The provisioner prints both.

🔴 **A SECOND gap was closed on 2026-09-06, and this one was DESTRUCTIVE rather
than merely wrong.** `apps/worker/src/lib/index-push.ts` hard-coded
`PUT /api/push/game`. The index Worker's write protocol is a **snapshot replace
keyed on `entry.source`** (`catalog-platform/docs/info/index-worker-design.md`
§5): a push under `game` deletes every `game` row and re-inserts the body. So a
`games2` instance would have **wiped the main catalog's entire index shelf on
its first push**, and from then on whichever instance pushed last would have
been the estate's whole board-game collection — the exact argument §11.1 of
that document makes for why `library2` got its own source id instead of sharing
`library`'s. This repo had the argument written down and not the code.

`resolveIndexSource(env.ESTATE_APP)` now decides it, ported from the library's
twin (which closed the same shape on 2026-09-05):

| `ESTATE_APP` | pushes as | why |
|---|---|---|
| unset / `games` | `game` | the estate's ONE vocabulary difference; `search-route.ts` `SOURCE_FOR_CATALOG` owns it. Identical to the hard-coded value, so this shipped INERT — and a test asserts that, because "it ships inert" is exactly the claim worth pinning |
| `games2`, `quarry`, … | itself | ⚠️ NOT plural-stripped to `game2`: the index has to be taught the exact word (a CHECK migration, a `SOURCES` entry, a token arm), and a guess would 404 at best and collide at worst |
| anything else | **nothing is pushed**, with the value named in the log | the value is interpolated into a URL path, so refusing is the inert direction |

⚠️ **The staleness backstop asks about its OWN source too.** It read
`health.sources.game` by name; from a second instance that would have reported
"fresh, 838 rows" about somebody else's shelf while this one had never pushed —
a check that is confidently wrong is worse than none, because it is the thing
that would otherwise notice. Exercised live in a tail on the deploy
(`a20b7aed`): `index backstop: due` → `index is fresh (838 rows, pushed
2026-09-05T23:36:27.441Z)`, matching `GET https://index.heygabi.ai/api/health`
exactly, with `"exceptions": []` on all six requests.

| Gap | Consequence | What it needs |
|---|---|---|
| Adding an id is a **three-line code change** (`ESTATE_APPS` + `APP_TOKEN_VAR`, the bearer switch, the `Env` field) | The provisioner cannot stand up an arbitrarily-named instance from config alone | Deliberate: the `Env` field is unavoidable in TypeScript, and the allowlist is what stops one var edit letting this catalog impersonate the library's consumer. `games2` is pre-declared so the common case needs no code edit |
| 🔴 **No donor, no peers.** There is no `DONOR_URL`, no `PEERS`, no donor route | For the libraries, "no Claude key on either side" still leaves a **free donor sweep** healing against the main library. For games, **no key means no self-healing at all** | New product surface (a migration, a route pair, a cron change) — not a prerequisite for an instance to work. ⚠️ The Accept panel must not reuse the books sentence on a games row (design §7.6) |
| No `db:migrate:local:<instance>` | Cannot inspect a second instance's data locally | Deliberate. miniflare keeps one local D1 per **binding name** and every instance binds `DB`, so such a command would read the MAIN local database and report confidently on the wrong catalog. `library_catalog` paid for that: 47 of 369 books on its second instance needed a backfill no sweep could reach |
| `docs/access/RECOVERY.md` §1 says *"one instance, one database, one bucket"* | It becomes false the moment a second instance deploys | Correct it in the same change as that deploy — it is step 12 of the checklist in [`../access/second-instance.md`](../access/second-instance.md) |
