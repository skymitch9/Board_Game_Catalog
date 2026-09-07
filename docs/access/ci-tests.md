# CI — the test lane, and why it is not the deploy lane

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (this repo is
> public — names only, no values).
> Last verified: **2026-09-07** — written the day `.github/workflows/tests.yml`
> was added, and every number here measured that day. `gh repo view
> skymitch9/catalog-platform --json visibility` → **`PUBLIC`**. `gh run list`
> showed the previous most recent run of any kind was `32071175391`,
> **2026-08-17**. The first run of this workflow, **`34157231459`** (push,
> `31c77db`), was **green in 1m53s** with all twelve steps `success` — including
> `Checkout catalog-platform` with **no token**, which is the measurement behind
> §2. On the runner: **922 tests / 918 pass / 0 fail / 4 skipped**, suite
> `duration_ms` 11690 (§4.1 for the four).
> ⚠️ **NOT verified:** the `pull_request` trigger (no PR has been opened — only
> the `push` lane has executed), the `workflow_call` trigger (nothing calls it),
> and the failure path when `catalog-platform` is unreachable (reasoned from
> `platform-repo.mjs`, not exercised).

Two workflows, and the difference between them is the whole point.

| Workflow | Trigger | What it does | Secrets |
|---|---|---|---|
| [`tests.yml`](../../.github/workflows/tests.yml) | `push` + `pull_request` on `main`, `workflow_call` | typecheck + the full suite | **none** |
| [`deploy.yml`](../../.github/workflows/deploy.yml) | `workflow_dispatch` only | migrate, then `npm run deploy` to the **live custom domain** | `CLOUDFLARE_API_TOKEN`, `CATALOG_PLATFORM_TOKEN` |

⚠️ **`deploy.yml` stays manual, by the owner's decision.** There is no dev lane:
a deploy goes straight to `boardgames.heygabi.ai`, so the trigger is a
deliberate human button-press. Do not add a push trigger or a schedule there.
`tests.yml` exists precisely so that decision does not also cost you CI.

---

## 1. Why `tests.yml` was added (2026-09-07)

The estate testing audit
(`catalog-platform/docs/archive/2026-09-07-testing-audit.md` §4.3) measured that
this repo's **last CI run of any kind was 2026-08-17** — three weeks in which
every green tick came from a developer's own machine, because the only workflow
was the manual deploy. Both sibling repos already had a test lane
(`catalog-platform`'s `tests.yml` since 2026-09-05; `audiobook_catalog`'s
`tests` / `js-tests` / `lint`), which is what made this a gap rather than a
policy.

## 2. 🔴 The sibling checkout is NOT optional — and needs no secret

`tests.yml` checks out **two** repos side by side and points
`CATALOG_PLATFORM_DIR` at the second, exactly as `deploy.yml` does.

It has to, for two independent reasons:

1. `pretest` (and `pretypecheck`) run `scripts/sync-estate-auth.mjs`, which
   **fails the build** when the platform checkout is missing. That is chosen,
   not incidental — see the script's header.
2. Even if it did not, the suite would fail anyway:
   `apps/worker/src/middleware/auth.ts` and `middleware/estate.ts` import
   `../estate-auth/index.js`, which is **gitignored** (`.gitignore:7`) because
   two copies of an auth file provably drift
   (`catalog-platform/docs/info/estate-auth-design.md` §1.1). Without the sync
   there is no module to import and the route and gate-wiring tests cannot load.

⚠️ **This is the difference from `catalog-platform`'s own `tests.yml`**, whose
sibling dependency skips loudly with exit 0 in CI. Here there is nothing to
skip.

🔑 **And it still needs no secret**, because **`skymitch9/catalog-platform` is
PUBLIC** — measured 2026-09-07. The default `GITHUB_TOKEN` reads a public repo,
so `actions/checkout` carries no `token:` in `tests.yml`.

⚠️ **`deploy.yml`'s header and its `CATALOG_PLATFORM_TOKEN` guard still say that
repo is PRIVATE (verified 2026-08-14).** That was true when written and is now
stale. The PAT is therefore doing nothing except failing the deploy early if it
is ever removed. Left alone deliberately — changing `deploy.yml`'s secrets was
out of scope on 2026-09-07 — but it is a one-line cleanup for whoever next
touches that file, and until then the two workflows disagree about a fact.

## 3. Why `deploy.yml` does not `needs:` the test job

It looks like a free gate, and it was considered and declined on 2026-09-07 for
two reasons:

- **It is not a one-line change.** `deploy.yml` has a single `deploy` job. Gating
  it means adding a whole `tests: uses: ./.github/workflows/tests.yml` job *and*
  a `needs:` line — a structural edit to the file that ships to production.
- **The gate already runs inside the deploy.** `predeploy` is
  `sync-estate-* → check-clean → deploy-guard → npm run typecheck && npm test`,
  and `deploy.yml` runs `npm run deploy`, so a red suite already stops a deploy
  — before `wrangler deploy`, and with the same commands. A `needs:` job would
  run the suite **twice** per deploy for a gate that is already there.

`tests.yml` carries `workflow_call:` anyway, so the wiring is one line away the
day someone wants pre-flight feedback rather than in-flight.

## 4. What runs, in order

| Step | Command | Notes |
|---|---|---|
| 1 | `actions/checkout` ×2 | this repo → `Board_Game_Catalog/`, platform → `catalog-platform/` |
| 2 | `actions/setup-node@v4` | Node 22 (engines says `>=20`), npm cache keyed on this repo's lockfile |
| 3 | `npm ci` | |
| 4 | `npm run typecheck` | `pretypecheck` syncs estate-auth/search/theme first |
| 5 | `npm test` | `pretest` syncs the same three, then `tsx --test` over `packages/**`, `apps/**`, `scripts/**` |

⚠️ **The WHOLE suite, never a per-target subset.** `packages/` is shared by the
Worker and the web app; a subset gate is exactly how a shared change ships
untested.

⚠️ **KI-8 still holds on the runner:** nothing under `scripts/` is type-checked
(`../KNOWN_ISSUES.md` — `ACCEPTED`). Its `scripts/test/*.test.mjs` cases *do*
run.

### 4.1 ⚠️ Four cases run locally and SKIP on the runner

Local `npm test` reports **922 / 922 pass**. Run `34157231459` reported **922 /
918 pass / 4 skipped** — the same suite, four fewer executions. All four are in
`scripts/test/push-secrets-instance.test.mjs`, and they say why:

```
# SKIP no apps/worker/.dev.vars on this machine — nothing to push from
```

That file is gitignored (it holds secret VALUES), so it cannot exist on a
runner. The skip is loud and correct — but it means the four cases that pin
`push-secrets.mjs`'s refusals (including 🔴 *"REFUSES ANTHROPIC_API_KEY for a
second instance"* and 🔴 *"no `ESTATE_APP_TOKEN_*` is ever in a second
instance's payload"*) are gated **only** by a developer running the suite
locally. Filed as `KI-12` in `../KNOWN_ISSUES.md` so the gap is written down
rather than inferred from a count.

## 5. Reading a run

```bash
gh run list --workflow=tests.yml --limit 5
gh run view <id> --log-failed
# the four skips, and anything else the counts hide:
gh run view <id> --log | grep -E "# (tests|pass|fail|skipped)|# SKIP"
```

⚠️ **Read `skipped`, not just `fail`.** A run is green with `fail 0` while cases
quietly do not execute — §4.1 is the live instance of exactly that.

A failing `Checkout catalog-platform` step means that repo moved or went
private; the fix is a read-only PAT in a `token:` line, and the failure is loud
rather than silent, which is the right way round.
