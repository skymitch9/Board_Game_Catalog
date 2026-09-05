# Provisioning a new GAMES catalog — `scripts/provision-catalog.mjs`

> **Audience:** the owner first (he is the only person who can run it), Claude
> sessions second.
> **Status:** TRACKED — no secret values here, names only.
> **Last verified: 2026-09-05** — the script was written that day.
>
> **What was MEASURED:**
> - `node --check`; the whole suite **298 pass / 0 fail** (220 before phase 9),
>   of which **74** are this script's; `npm run typecheck` clean.
> - **`--dry` against REAL rows in the live `estate_auth` D1**: **#3**
>   `boardgames` (games, already live) refused as *"already live at
>   https://boardgames.heygabi.ai"* (**exit 2**, host read back out of the row),
>   and **#1** `library` refused as a BOOKS request pointing at the other repo
>   (**exit 2**). So the D1 read path, the column mapping and both refusals are
>   exercised against production data.
> - A `--dry --fixture` run printing all twelve steps, both pauses and a
>   109-line rendered block, exit **0**, leaving `git status` untouched.
> - The **live** Firebase authorised-domain read (13 domains came back;
>   `quarry.heygabi.ai` correctly absent).
> - The sealed-key hook against a real dynamic import of a stub module, one case
>   per `source` (`reader` / `owner` / `none` / module absent / module broken /
>   module throwing).
>
> ⚠️ **NOT verified — and this is the headline:** **no real instance has ever
> been provisioned by this script.** Nothing has run past `--dry`. No D1, no
> bucket, no covers hostname, no secret and no deploy exists because of it.
> Every AUTO step below is therefore *written and unexercised*, and the first
> real run is the test. Also unverified: no envelope has been decrypted (the
> seal library was exercised only through stubs from this side), and nobody has
> signed in anywhere.
>
> Design of record: `catalog-platform/docs/info/request-a-catalog-design.md`
> §7.6 (the games sub-ledger) and §8 — this page is the runbook, that file is
> the reasoning, and neither restates the other.
>
> - The machinery this stands on → [`second-instance.md`](second-instance.md)
> - Why the model looks like this → [`../info/instance-model.md`](../info/instance-model.md)
> - The books twin → `bookbuddy/library_catalog/docs/access/provision-catalog.md`

---

## What it is

A signed-in estate member presses the **"+"** on the Games card of
<https://heygabi.ai>, the owner accepts it in `/admin`, and **nothing is
created** — Accept sets a status and hands over a checklist. This script is that
checklist, executed.

🔴 **It is never web-triggered.** The owner runs it on this machine with his own
wrangler login, from a clean tree. There is no route, no queue consumer and no
cron that reaches it, and there must not be: it creates databases, buckets,
hostnames and secrets.

```
npm run provision:catalog -- --request 7 --dry      # print everything, touch nothing
npm run provision:catalog -- --request 7            # do it, stopping at each manual step
npm run provision:catalog -- --request 7 --resume   # continue after a manual step
```

| Flag | Does |
|---|---|
| `--request <id>` | **required** — the `catalog_request` row in the estate directory D1 (`estate_auth`) |
| `--dry` / `--dry-run` | prints the derivation, every step, every command, the rendered block and the whole manual runbook. **Writes nothing anywhere** |
| `--resume` | continue a half-finished provision: existing artifacts are skipped by name, the manual pauses are **verified** instead of announced |
| `--instance <name>` | override the derived wrangler env name (see the naming rule) |
| `--covers-base-url <url>` | override the derived covers base (only if the domain was attached by hand) |
| `--owner-break-glass` | ALSO put the estate owner on `OWNER_EMAILS`. ⚠️ Access-increasing, so it is a flag he types, never a default |
| `--fixture <file>` | ⚠️ **`--dry` only.** Use a JSON row from a file instead of D1 — how the plan is exercised before a real request exists |

**Exit codes:** `0` done · `1` refused or failed · `2` this row cannot be
provisioned (a books request, a row that is not `accepted`) · `3` **paused** at a
manual step — not a failure, re-run with `--resume` when it is done.

⚠️ **There is no `--enable`.** The books twin has one because that repo carries
route-ENABLING shared secrets. This one does not: `INDEX_PUSH_TOKEN` is
per-instance *and* local-only, so a new games instance ships dark on index push
and the token is set by hand, one at a time.

---

## The names it derives, and the rule behind them

Nothing is asked of a person. From the row:

| Derived | Example | Rule |
|---|---|---|
| hostname | `quarry.heygabi.ai` | **the only identity-bearing name** (design §7.1) |
| wrangler env / Worker | `quarry` / `board-game-catalog-quarry` | the **sanitised subdomain** — a Worker can be renamed, and the operator types this name a dozen times |
| D1 | `board-game-catalog-2nd` | **ordinal** — a D1 can never be renamed |
| R2 bucket | `game-covers-2nd` | **ordinal** — and a rehost is a data migration |
| **covers hostname** | `gamecovers2.heygabi.ai` | 🔴 **ordinal, and this is the one place the games split differs from the books one.** `cover-storage.ts` writes `COVERS_BASE_URL` **into `thumbnail_url` rows**, so renaming it later is a data migration rather than a config edit. ⚠️ `gamecovers.heygabi.ai` is TAKEN — a custom domain belongs to exactly one bucket |
| estate app id | `games2` | **ordinal** — it is a CONTRACT with `catalog-platform` (`CONSUMER_APPS`, `appTokenFor()`, `siteForApp()`, `BILLING_SITES`, a `vis_` column), pinned per catalog, never per person or host |
| estate token NAME | `ESTATE_APP_TOKEN_GAMES2` | the app id selects the secret name |
| visibility column | `vis_games2` | one `ADD COLUMN`, `DEFAULT 0` |
| `RATE_LIMITER` namespace | `1002` | the next id no LIVE binding uses. 🔴 **Never `1001`** — that is main's, and a namespace is scoped per ACCOUNT ([`../info/instance-model.md`](../info/instance-model.md) §3) |

⚠️ **This SPLITS design §7.1's rule rather than following it whole, and it
splits it the SAME WAY the books twin does — on purpose, so the pair agrees.**
The doc makes every permanent name identity-neutral; the split honours the axis
that matters: **what is cheap to rename follows the person, what can never be
renamed stays ordinal.**

☐ **The owner has been asked which he wants — (a) this split, (b) all ordinal,
(c) all follow the person — and has not answered.** It is all decided in ONE
function, `deriveNames()`, so a later flip is one function rather than a
rewrite. `--instance games2` gets the all-ordinal convention back for a single
run, and nothing else about the run changes.

**The sanitiser, as a rule:** lowercase → every run of anything but `[a-z0-9]`
becomes one `-` → leading and trailing `-` trimmed → **refused** if it is empty,
longer than 30, a reserved wrangler word (`default`, `production`, `preview`,
`dev`, `development`, `staging`, `local`, `test`, `none`), or the name of an
`[env.*]` block that already exists. 30 rather than the subdomain's 40 because
the Worker is `board-game-catalog-<env>` and Cloudflare caps that at 63. Every
refusal names `--instance` as the way out.

⚠️ **`games2` is deliberately NOT a reserved word here** (the books twin
reserves `friend` because it is taken). It is the template's own name and the
pre-declared identity slot, so it is a perfectly good env name; the
already-exists check is what stops a second use of it.

---

## The twelve steps

| # | Step | Ledger (§7.6) | Idempotence probe |
|---|---|---|---|
| 1 | D1 create (binding stays `DB`) | AUTO | `wrangler d1 list --json` by name |
| 2 | R2 bucket **+ its own covers hostname** | AUTO | `r2 bucket list`; `r2 bucket domain list` |
| 3 | the `[env.<instance>]` block, **rendered from the template** | AUTO | the block is in `wrangler.toml` |
| 4 | `package.json` script twins | AUTO | the keys are present |
| 5 | commit an explicit allowlist | AUTO | nothing to commit |
| 6 | `db:migrate:<instance>` — **before any deploy** | AUTO | wrangler's own checkbox table |
| 7 | ⏸ **PAUSE #1 — Firebase authorised domain** | 🔴 MANUAL | 🟢 the live `authorizedDomains` list |
| 8 | ⏸ **PAUSE #2 — auth-worker registration** | 🔴 MANUAL | 🟡 the sibling checkout's SOURCE |
| 9 | the paired estate token, both sides | AUTO (stdin) | `secret list --env` by NAME |
| 10 | per-instance secrets + `ANTHROPIC_API_KEY` | AUTO (stdin) | — |
| 11 | ⏸ **the guarded deploy — PRINTED, never run** | 🔴 the owner's command | 🟡 an `env=<i>` line in `docs/deploys.log` |
| 12 | verify `/api/health?cb=` and mark the request `live` | AUTO | the row's `status` |

### The four differences from the books twin, and why

1. 🔴 **It does not deploy.** Step 11 prints
   `DEPLOY_HOLDER=<you> npm run deploy:<instance>` and stops. The deploy carries
   the owner's name into `docs/deploys.log`, takes a lock shared across
   instances, and uploads the **working-tree** `apps/web/dist` — his gesture,
   not a script's. `--resume` sees the `env=<instance>` line `deploy-done.mjs`
   writes and carries on to step 12. (npm runs `predeploy:` and `postdeploy:`
   itself, so that one line is the whole sequence.)
2. **The env block is RENDERED from the commented `[env.<instance>]` template**
   at the foot of `apps/worker/wrangler.toml`, not hand-written. That template
   is already guarded against `[vars]` drift by
   `apps/worker/src/lib/instance-template.test.ts`; hand-writing the block would
   have put that guard behind a copy it does not read. The books twin
   hand-writes its block because it templates from a LIVE `[env.friend]`.
3. 🔴 **The block is inserted ABOVE the template, never at EOF.** The drift
   guard slices from the template banner to end-of-file and requires every line
   there to be commented. A block appended at the end fails it — and the message
   would blame the template rather than the writer.
4. **The covers custom domain is a real CLI step here**
   (`wrangler r2 bucket domain add … --zone-id …`), where the library used the
   console and the rate-limited `r2.dev` tier. ⚠️ `--zone-id` is REQUIRED
   non-interactively — [`covers-r2.md`](covers-r2.md) §1 owns that fact — and
   the attach is asynchronous (`pending` for a few minutes, then `active`).

### What PAUSE #2 needs that the books runbook does not list

⚠️ **Two extra steps, found on 2026-09-05 while lifting `BILLING_SITE`.**
Without them `catalog-platform` **does not compile**, because `siteForApp()` is
exhaustive over `ConsumerApp` — adding an app id without a site arm is a type
error:

- a `case 'games2'` arm in `siteForApp()` (`apps/auth-worker/src/estate.ts:118`);
- `'games2'` in `BILLING_SITES` (`apps/auth-worker/src/billing-registry.ts:38`),
  and then a decision about which `BILLING_FEATURES` list it in their `sites` —
  a feature the site does not name is not resolved for it, and the Spending
  panel would draw an empty matrix with nobody knowing why.

The script prints all of it, with the exact diffs, and re-reads five of the
seven back out of the sibling checkout on `--resume`.

---

## Secrets

| Name | What happens | Why |
|---|---|---|
| `ESTATE_APP_TOKEN_GAMES2` | **minted here**, piped to BOTH the new env and the auth Worker under the SAME name | the estate pairs by NAME on both sides and resolves identity by VALUE |
| `BGG_API_TOKEN`, `GAMEUPC_API_KEY` | pushed, shared | the estate's own registrations |
| `ANTHROPIC_API_KEY` | **special** — the ladder below | design §6.4 |
| `INDEX_PUSH_TOKEN` | **refused** | the index Worker tells its machine callers apart BY THE VALUE, so a second instance is a second source. The instance ships dark on index push |
| every `ESTATE_APP_TOKEN_*` | **refused by prefix** | a consumer nobody has thought of yet is refused by default rather than by memory |

The refusal lists are **imported** from `scripts/push-secrets.mjs`, not restated
— a second copy of a refusal list is a second copy that drifts, and the drifted
one is always the check that mattered. Values go **memory → stdin**, never argv,
never a temp file, never a log. ⚠️ **`.dev.vars.<instance>` does not exist and
must not be created.**

### The `ANTHROPIC_API_KEY` ladder (design §6.4)

1. the requester's **sealed** key, if one was submitted;
2. else the owner's **sealed** key, if he attached one at Accept;
3. else the **owner's own** key — standing decision, 2026-09-05 ~07:03 Phoenix,
   *"Have it fall back to my Claude key for now"* — read from `.dev.vars` in
   code and piped over stdin, with the run logging
   `owner key used — standing decision 2026-09-05` so a later reader can see
   which instances spend his money.

Rows 1 and 2 belong to `catalog-platform/scripts/lib/catalog-seal.mjs`, which
this script dynamic-imports through the `platform-repo.mjs` locator and calls as
`injectSealedKey({ requestId, workerDir, envName, dry })`, acting on the
`source` it resolves. Absent module and `source: 'none'` are the **same outcome**
(row 3) and **different facts**, and are printed differently.

🔴 **A THROWING inject stops the run.** A failed inject is not "there was no
envelope", and falling through would spend the owner's money on a decision
nobody made.

### 🔴 No key means NO AI LOOKUPS AT ALL — and that is NOT the books sentence

§7.6 consequence 2. For a library, "no key from either party" still leaves a
**free donor sweep** healing the new instance against the main library. This repo
has **no `DONOR_URL`, no `PEERS` and no donor route**, so on a games instance no
key means nothing self-heals, ever. The run says that in those words, and it
**refuses to finish a real provision with no key** rather than shipping a
catalog that looks fine and can never fill itself in.

⚠️ The Accept panel on `/admin` must not reuse the books sentence on a games row
for the same reason. The mockup's *"the free donor sweep still runs"* is true
for books and false here.

---

## What ships OFF, and what is deliberately not done

| | |
|---|---|
| `BILLING_POLICY` | `"off"`, like main. Flipped only on its own evidence, never as a side effect |
| `INDEX_PUSH_TOKEN` | unset — the instance is inert at the shared index |
| `ESTATE_CHECK` | `"enforce"`, like main. ⚠️ Until its bearer exists on both sides the gate logs `estate_config_unset` and behaves as OFF — the safe failure, and why code-before-secret cannot lock anyone out |
| the deploy | not run (see above) |
| the auth-worker migration | never applied unattended — the directory DB is a human's step |
| `PEERS` / donor | not a thing in this repo at all; adding them is new product surface, not a provisioning step |

### Follow-ups the run prints and does not take

- **Two names are not RESERVED.** `catalog-platform/apps/auth-worker/src/catalog-names.ts`
  holds the reserved subdomain list, and neither the new instance's subdomain nor
  its `gamecovers<N>` host is on it — so the next person to ask for either is
  told it is free. ⚠️ Add both in the commit that routes them; that module's own
  header says a new estate hostname must be added in the same commit.
- **`apps/worker/src/lib/estate-app.test.ts`'s *"no second instance is declared
  for real yet"*** becomes false the day a block lands. Its own comment says it
  "gets its own env row rather than being deleted". The same-id guard beside it
  is untouched and is the one that matters.
- **[`RECOVERY.md`](RECOVERY.md) §1** says *"one instance, one database, one
  bucket"* — false from the deploy onward.
- **No Cache Rule on the new bucket**, and none is needed: `cover-storage.ts`
  sets `Cache-Control` per object at upload. This is a difference from the
  LIBRARY's setup, not a missing step.

---

## The tests that will catch tomorrow's mistake

`scripts/test/provision-catalog.test.mjs` — **74 tests**, every one either a
pure exported function or the real command under `--dry` with a fixture row.
The five they exist for:

1. provisioning the **wrong kind** (a books row through the games path stands up
   a board-game catalog at the address somebody asked for a library at);
2. a rendered block that **lost a line** (`[env.*]` inherits nothing, so it
   deploys happily);
3. a block written in the **wrong place** (the drift guard would blame the
   template);
4. `namespace_id = "1001"` on a second instance (measured per ACCOUNT — the
   symptom is unexplained 429s on a site nobody was looking at);
5. the sealed key resolving to the **wrong source** (whose money the instance
   spends, recorded on the row forever).

🔴 **Writing them found three defects, all of which would have failed quietly:**
`Number(null)` is `0`, so an absent `--request` read as request #0; `--resume`
threw a refusal about `games3` because it asked for the "next free" id even when
one was pinned; and the secret plan's last-moment guard was unreachable because
it re-used the classifier the loop had already filtered with.

**And one defect in the renderer, found by RUNNING it rather than reading it:** a
key-only substitution for `name` rewrote `name = "RATE_LIMITER"` inside the
unsafe binding to the Worker's name. TOML reuses short keys across tables, so a
key is not an address — every substitution now names its table, and the four
binding names are asserted on the rendered block. Nothing else caught it: it
parsed, the placeholder check passed, and the failure would have been a rate
limiter that silently did not exist.

---

## After a real run

Nothing here has been done, because no real run has happened. When one does:

1. **Verify with the right instrument.** `curl -s -D - -o /dev/null
   "https://<host>/api/health?cb=$(date +%s)"` → 200, and the body's `estate`
   block must read `app:"games2"`, `tokenVar:"ESTATE_APP_TOKEN_GAMES2"`,
   `configured:true`. ⚠️ On this machine `curl -I` and `-o /dev/null` alone
   report `000`/exit 43 — `-D -` is what works. The cache-buster is not
   optional; a custom domain is edge-cached.
2. 🔴 **Then watch a REAL sign-in.** `configured:true` proves both halves EXIST,
   not that the directory accepts the token — a right name over a wrong value is
   a 401 the gate reports as `estate_unreachable`.
   `npm run tail:<instance> --workspace @bgc/worker`, look for `app=games2`.
3. **Commit the `deploys.log` line.** `deploy-done.mjs` writes it and
   deliberately does not commit it.
4. Take the follow-ups above, and update this page's header with what was
   actually measured — replacing the "no real instance has ever been
   provisioned" headline with the date one was.
