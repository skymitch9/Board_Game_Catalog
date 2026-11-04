# Deploying — the guards, the log, and the escape hatches

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-02** — the three scripts were byte-diffed against
> `library_catalog` on that date and the wiring was exercised by running
> `npm run predeploy` against a dirty tree and a clean one. ⚠️ **NOT verified:**
> the two-concurrent-runs case (one machine, one session — the ancestry refusal
> was exercised with a hand-written log line, not with a genuine second run).
> **Last verified 2026-09-22 for gotcha 5 ALONE** (the auto-mode refusal), and
> only as a record of what a sibling repo measured on 2026-09-21/22 — ⚠️ **no
> deploy has been attempted from THIS repo since, so the refusal and the fix
> are both unexercised here.** Nothing else on this page was re-checked.

`npm run deploy` is the only sanctioned way this Worker ships. It is three
guards, a build, a `wrangler deploy`, and one appended line.

```bash
DEPLOY_HOLDER=<who> npm run deploy
```

---

## What runs, in order

| Step | Script | Refuses when |
|---|---|---|
| 1 | `scripts/sync-estate-*.mjs` ×3 | the sibling `catalog-platform` checkout is missing |
| 2 | `scripts/check-clean.mjs` | the working tree has **uncommitted changes** |
| 3 | `scripts/deploy-guard.mjs` | another deploy is **in flight**, or the **live commit is not in this tree** |
| 4 | `npm run typecheck` | any workspace fails `tsc --noEmit` |
| 5 | `npm test` | any test fails |
| 6 | `npm run build` + `wrangler deploy` | — |
| 7 | `scripts/deploy-done.mjs` (`postdeploy`) | — appends one line to `docs/deploys.log` and releases the lock |

⚠️ **The dangerous case is not a dirty tree — it is a CLEAN tree that does not
contain what is already live.** Two runs each committed, each building from
their own history: a Worker deploy replaces the whole artifact rather than
patching it, so the loser's work is not conflicted, it is simply absent from
what went live. `check-clean` cannot see that; step 3's ancestry check is the
one that catches it.

## The log is the 3am rollback source of truth

`docs/deploys.log` — tab-separated, append-only, **tracked in git**:

```
ISO-8601<TAB>commit<TAB>holder<TAB>cloudflare-version-id
```

⚠️ **`.gitignore` has a `*.log` line, so the file needs the explicit
`!docs/deploys.log` negation that sits under it.** Without that the record is
silently untracked, the ancestry check has nothing shared to read, and the whole
guard degrades to a lock file. That exact hole was found in `library_catalog`
only because somebody noticed a deploy commit with no log line in it.

⚠️ **`deploy-done.mjs` writes the log but deliberately does NOT commit it.** The
run that deployed commits it — which is also what puts it in front of a human.

**The first line is a backfill, not a real run.** `2026-08-27T00:27Z` /
`93fad257` / holder `backfilled` records the deploy this repo made *before* the
guards existed (version `a34971db-…`, noted in `TODO.md` at the time). It is
there so the very first guarded deploy has a baseline to check ancestry against
instead of waving the first one through.

## Escape hatches — explicit env vars, never flags

| Variable | Skips | Use it when |
|---|---|---|
| `ALLOW_DIRTY_DEPLOY=1` | check-clean | you genuinely mean to ship an uncommitted tree |
| `ALLOW_OVERLAP=1` | the lock **and** the ancestry check | you know the other deploy died, or the log and Cloudflare genuinely disagree |
| `DEPLOY_HOLDER=<name>` | nothing — it *identifies* you | always; the log line says `unknown` otherwise |

## ⚠️ Gotchas that will cost you time

1. **A failed typecheck or test leaves the lock behind.** npm runs no `post`
   hook when the deploy fails, and steps 4–5 sit *after* the lock is taken. The
   lock goes stale after **20 minutes** and is then taken over with a message —
   before that, `ALLOW_OVERLAP=1 npm run deploy` is the way through. The order
   is deliberately the same as `library_catalog`'s so the two repos have one
   discipline rather than two.
2. **`version-unknown` in the log is a real failure, not a normal value.** It
   means the Cloudflare lookup in `deploy-done.mjs` failed. In `library_catalog`
   that happened on *every* line for the script's whole life (Windows `npx` +
   a regex that picked the oldest deployment) before being fixed on 2026-08-25;
   these copies carry that fix.
3. **Migrate before deploy, always** — new code must never meet an old schema.
   `npm run db:migrate:local` then `npm run db:migrate` (`--remote`), *then*
   `npm run deploy`. ⚠️ `docs/info/copy-status-history.md` §6 used to say
   `migrations apply --remote` **returns 7403 on this account** and that you had
   to apply the SQL by hand through `d1 execute --remote` plus a manual
   `d1_migrations` INSERT. **Re-measured 2026-09-02: false.** It applied
   migration 0029 in 10.42 ms on wrangler 4.118.0, `CREATE TRIGGER` bodies and
   all. The hand method is strictly worse — it leaves `d1_migrations`
   disagreeing with the database whenever somebody forgets the second half.
4. **Never kill a deploy mid-flight.** A killed deploy can leave the live Worker
   out of step with the repo, which is the one genuinely expensive state.
5. ⚠️ **From a Claude Code session in auto mode, `npm run deploy` is refused by
   the command classifier before step 1 even starts** — measured in
   `library_catalog` on 2026-09-21, three refusals (twice through Bash, once
   through PowerShell), each landing *ahead* of `check-clean` and
   `deploy-guard`, so none of the guards above ever had an opinion. **Nothing
   in this repo fixes it**: it needs a global allow rule in the operator's
   `~/.claude/settings.json`, which is in no repo and in no backup. The rule,
   what it contains and why a rebuilt machine has to re-add it by hand live in
   `catalog-platform/docs/access/RECOVERY.md` **§11.5** — that is its one home;
   it is deliberately not restated here. The rule added 2026-09-22 matches this
   repo's deploy command too, so nothing here had to change. **Exercised in
   this repo 2026-11-03/04, both ways:** refused once (2026-11-03 22:1x
   Phoenix, "Production Deploy", from a bookbuddy-rooted session) and then
   ALLOWED twice the next morning (`dbc60d49` 11:19, `b17ac0c7` 11:23) after
   the owner wrote *"Run the deploy for me, I gave you permission"* in chat —
   the classifier reads the conversation, so an explicit permission in the
   owner's own words is the thing that turns it. Run it through PowerShell with
   `Set-Location` to this repo first: a session rooted in `bookbuddy` has no
   `package.json` and npm fails ENOENT before anything deploys (owner hit this
   with `! npm run deploy` on 2026-11-04).

## Where this came from

Ported verbatim from `bookbuddy/library_catalog/scripts/` on 2026-09-02 —
**one canonical implementation, not a rewrite.** `check-clean.mjs` was already
byte-identical here; `deploy-guard.mjs` and `deploy-done.mjs` were copied
unchanged (both already resolve `apps/worker/wrangler.toml`, which is the same
path in both repos). The `--instance=` handling they carry for the library's
second Worker is inert here: this repo has one instance, so every line is
written and read as `default`.

✅ **Updated 2026-09-05.** That `--instance=` handling now has callers: the
`predeploy:games2` / `deploy:games2` / `postdeploy:games2` twins, which refuse in
words while no `[env.games2]` block exists. This repo still has ONE live
instance and every `deploys.log` line here is still `default`. The runbook is
[`second-instance.md`](second-instance.md).

Keeping them identical is the point: a fix made in one repo is a `cp` away from
the other, and a diff is the test that they have not drifted.
