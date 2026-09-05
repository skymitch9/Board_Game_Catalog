# A second games instance — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — no secret
> values here, only NAMES and how to obtain them.
> **Last verified: 2026-09-05.**
>
> 🔴 **NO SECOND INSTANCE EXISTS.** This repo has one live catalog,
> `boardgames.heygabi.ai`. Everything below is the machinery that landed
> 2026-09-05 (`fc17ea3`, `30dc045`, `4db2f2e`) plus the runbook for using it —
> **none of it has ever been run against a real second instance.**
>
> ⚠️ **Verified today:** every command name against `package.json` /
> `apps/worker/package.json`; the refusals in §5 by running them; the template
> against `apps/worker/wrangler.toml`; the guards by making them fail.
> ⚠️ **NOT verified:** anything live. No D1 was created, no bucket, no hostname,
> no deploy of a second Worker, no `/seen`, no Cloudflare or Firebase console.
> Steps 2–3, 9 and 11 below have never been executed here — they are carried
> from `library_catalog`'s live pattern.
>
> - Why the model looks like this, and the `RATE_LIMITER` measurement →
>   [`../info/instance-model.md`](../info/instance-model.md)
> - How `library_catalog` runs two libraries →
>   [`../info/multi-catalog-strategy.md`](../info/multi-catalog-strategy.md)
> - The operating twin on the library side (the doc this is modelled on) →
>   `bookbuddy/library_catalog/docs/access/second-instance.md`
> - Why a second games catalog exists at all →
>   `catalog-platform/docs/info/request-a-catalog-design.md` §7.6

---

## 1. Who creates one, and when

A second games catalog is created by the **owner-run provisioner** when a games
request is accepted (request-a-catalog design §7.6, phase 9) — not by hand, and
not by a session that finds this page. Nothing here should be executed until the
owner names a concrete second instance: a household, a hostname.

⚠️ **A games request can be *accepted* before it can be *provisioned*.** The
platform half (this page's machinery) landed 2026-09-05; the provisioner's games
path has not. If those two moments are far apart, someone has been told yes and
is waiting — design §8's closing warning.

---

## 2. The commands

Every `:games2` command **refuses in words** while no `[env.games2]` block exists
(`scripts/instance-guard.mjs`). That is the expected answer today.

| Main | Second instance | Notes |
|---|---|---|
| `npm run predeploy` | `npm run predeploy:games2` | `instance-guard` → syncs → `check-clean` → `deploy-guard --instance=games2` → typecheck → tests |
| `npm run deploy` | `npm run deploy:games2` | ⚠️ Never plain `wrangler deploy --env games2` — the npm script is what carries the clean-tree and overlap guards |
| `npm run postdeploy` | `npm run postdeploy:games2` | Appends to the same `docs/deploys.log` with a 5th field `env=games2`; main's lines keep their four-field shape byte for byte |
| `npm run secret -- NAME` | `npm run secret:games2 -- NAME` | One value at a time. This is how every per-instance secret is set |
| `npm run secret:list` | `npm run secret:list:games2` | Names only |
| `npm run secrets:push` | `npm run secrets:push:games2` | Bulk, and it REFUSES the per-instance keys — see §5 |
| `npm run db:migrate` | `npm run db:migrate:games2` | Same migration FILES, a different D1 |
| `npm run db:migrate:local` | — **deliberately absent** | miniflare keeps one local D1 per BINDING name and both instances bind `DB`, so a local second-instance command would read the MAIN local database and report confidently on the wrong catalog |
| `npm run tail --workspace @bgc/worker` | `npm run tail:games2 --workspace @bgc/worker` | The tail line carries `app=<id>` — this is how you see which instance is speaking |

⚠️ `DEPLOY_HOLDER=<you>` on every deploy, main or second. The lock is **shared
across instances on purpose**: both deploys build into the same `apps/web/dist`,
so two concurrent deploys of *different* instances can still ship each other's
half-built assets.

---

## 3. Secret NAMES, and who holds each

Values live in `wrangler secret` (production) and `apps/worker/.dev.vars`
(local). Never in this file, never in `wrangler.toml`.

| Name | Second instance | Why |
|---|---|---|
| `ESTATE_APP_TOKEN_GAMES2` | **its own value** | The estate directory tells consumers apart BY THE VALUE. One value, two holders, **same name both sides** — this Worker's env and `catalog-platform`'s auth Worker. Set by hand on both in one sitting |
| `ANTHROPIC_API_KEY` | **its own value** | That household's research spend, on their cap. ⚠️ The owner decided v1 provisioning may fall back to HIS key (design §9 Q3) — deliberately, one key at a time, never swept in by a bulk run |
| `INDEX_PUSH_TOKEN` | **its own value** | The index Worker tells its machine callers apart by the value; a second games instance is a second source |
| `BGG_API_TOKEN` | shared | The estate's own BoardGameGeek registration |
| `GAMEUPC_API_KEY` | shared | Ditto. ⚠️ Both are quota-shared by consequence; if that ever matters, they become per-instance |
| `FIREBASE_PROJECT_ID` | 🔴 **shared, never forked** | It is a `[vars]` value, not a secret, and it is the mechanism by which one Google account is one person across the estate |

---

## 4. Standing one up — the checklist

Assumes the phase-8 machinery (this page) is landed, which it is.

1. **Pick an identity-neutral internal name** for the env, D1 and bucket —
   independent of whatever hostname is chosen. `library_catalog`'s
   `friend`/`library-catalog-2nd` survived a `sam.` → `padhard.` rename with zero
   other files touched. `games2` is the id this codebase already knows; another
   name means editing `ESTATE_APPS`, `APP_TOKEN_VAR`, the bearer switch in
   `apps/worker/src/lib/estate-app.ts` and the `Env` field, in one commit.
2. `wrangler d1 create board-game-catalog-2nd` → record the `database_id`.
3. `wrangler r2 bucket create game-covers-2nd`, attach a **new** covers custom
   domain (⚠️ `gamecovers.heygabi.ai` is taken — a custom domain belongs to
   exactly one bucket) with the same 1-year Cache Rule.
4. **Uncomment and fill the template** at the foot of
   `apps/worker/wrangler.toml`. 🔴 `[env.*]` inherits nothing that matters: every
   var, binding, route and trigger is restated, and an omission is a MISSING
   binding, never a fallback. Do not restate `CF_ACCESS_TEAM_DOMAIN` /
   `CF_ACCESS_AUD` (deprecated; being removed). Copy the cron strings character
   for character. Give it its own `RATE_LIMITER` `namespace_id` — see
   [`../info/instance-model.md`](../info/instance-model.md) §3.
5. **The auth Worker side, first** (`catalog-platform`, MANUAL): add `games2` to
   `CONSUMER_APPS`, add its `vis_games2` column, mint the token pair.
   ⚠️ Until the bearer exists on both sides, the new instance's estate check
   logs `estate_config_unset` and behaves as OFF — the SAFE failure, and the
   reason deploying the code before the secret cannot lock anyone out.
6. `npm test` — the same-id build guard (`estate-app.test.ts`) and the template
   drift guard (`instance-template.test.ts`) both read `wrangler.toml`. **Two
   envs declaring the same `ESTATE_APP` fails here**, before a deploy can
   misidentify anyone.
7. `npm run db:migrate:games2` — every existing migration against the new, empty
   D1. Confirm with the migrations list, not with silence. ⚠️ **This account
   cannot run `d1 migrations apply --remote`** (it answers `7403`); see
   [`../TODO.md`](../TODO.md)'s 2026-08-09 note for the `d1 execute --remote`
   workaround, including the bookkeeping `INSERT` into `d1_migrations`.
8. Set its secrets **one at a time**: `npm run secret:games2 -- ESTATE_APP_TOKEN_GAMES2`,
   then `ANTHROPIC_API_KEY`, `INDEX_PUSH_TOKEN`. Never bulk-push them (§5).
9. **Owner console steps — no CLI can do these.** Add the new hostname to
   Firebase Authentication → Authorised domains **BEFORE anyone signs in on it**;
   seed the estate directory row / approve its first user.
10. `DEPLOY_HOLDER=<you> npm run deploy:games2` from a clean tree, then
    `npm run postdeploy:games2`. Commit `docs/deploys.log`.
11. **Verify — and a green deploy is not verification.**
    - `curl -s -D - -o /dev/null "https://<new host>/api/health?cb=$(date +%s)"`
      → 200. ⚠️ The cache-buster is not optional; custom domains here are
      edge-cached. ⚠️ On this machine `curl -I` and `-o /dev/null` alone report
      `000`/exit 43 — `-D -` is what works.
    - The body's `estate` block must read `"app":"games2"`,
      `"tokenVar":"ESTATE_APP_TOKEN_GAMES2"`, `"configured":true`. Anything else
      means it is asserting the wrong identity or is missing a half.
    - `npm run tail:games2 --workspace @bgc/worker` during a **real sign-in**:
      the line must say `app=games2`. 🔴 This is the only proof of the token's
      VALUE. `configured:true` proves both halves EXIST, not that the directory
      accepts them — a right name over a wrong value is a 401 the gate reports as
      `estate_unreachable`.
12. Correct [`RECOVERY.md`](RECOVERY.md) §1, which says *"one instance, one
    database, one bucket"* — false from step 10 onward — in the same change.

---

## 5. 🔴 What a bulk secret push refuses, and why

`npm run secrets:push:games2` reads the ONE `apps/worker/.dev.vars` and sends only
the shared keys. ⚠️ **`.dev.vars.games2` does not exist and must not be created**
— it is not read for any flag; creating one would be a custody change, not a
missing file to fill in.

Refused, always (`PER_INSTANCE_SECRETS` / `PER_INSTANCE_PREFIXES` in
`scripts/push-secrets.mjs`): `ANTHROPIC_API_KEY`, `INDEX_PUSH_TOKEN`, and every
`ESTATE_APP_TOKEN_*` — the last by PREFIX, so a consumer nobody has thought of
yet is refused by default rather than by memory.

Measured 2026-09-05, `--env games2 --dry`:

```
push-secrets: target = instance "games2" (wrangler --env games2)
  skip  ANTHROPIC_API_KEY — REFUSED for instance "games2": each instance holds
        its own value. Set it one at a time with
        `npm run secret:games2 -- ANTHROPIC_API_KEY`.
```

⚠️ **Why this matters more than it looks.** Overwriting either would be silent:
the second instance's estate check would start answering `estate_unreachable`,
and its model spend would land on the owner's key — with nothing going red.
There are three guards, not one: the refusal fires *before* the "is it set
locally" branch (so an absent key still reports as refused rather than as an
accident a later edit fixes); a last-moment check refuses the WHOLE run if a
per-instance key reached the payload by any route; and a startup check fails if
the refusal list names a key no allowlist would ever send, because an inert
refusal is worse than none.

---

## 6. The three ways this goes wrong silently

1. **Two envs asserting the same `ESTATE_APP`.** The second instance wears the
   first's badge; its own bearer is an orphan; nothing goes red. Caught by
   `apps/worker/src/lib/estate-app.test.ts` at build time — the refusal names
   both tables and the F-5 incident.
2. **A var in `[vars]` that the template does not restate.** The new Worker is
   missing a setting and you find out from behaviour. Caught by
   `apps/worker/src/lib/instance-template.test.ts`.
3. **A deploy from a tree that does not contain what is already live.** Caught by
   `scripts/deploy-guard.mjs`, per instance — one instance being ahead of
   another's `deploys.log` line is normal, not drift.
