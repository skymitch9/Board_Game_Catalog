# Deploying — the guards, the log, and the escape hatches

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-02** — the three scripts were byte-diffed against
> `library_catalog` on that date and the wiring was exercised by running
> `npm run predeploy` against a dirty tree and a clean one. ⚠️ **NOT verified:**
> the two-concurrent-runs case (one machine, one session — the ancestry refusal
> was exercised with a hand-written log line, not with a genuine second run).

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
3. **`wrangler d1 migrations apply --remote` returns 7403 on this account.**
   Migrations go through `d1 execute --remote` as plain SQL, followed by an
   `INSERT INTO d1_migrations (name) VALUES (…)`. **Migrate before deploy,
   always** — new code must never meet an old schema.
4. **Never kill a deploy mid-flight.** A killed deploy can leave the live Worker
   out of step with the repo, which is the one genuinely expensive state.

## Where this came from

Ported verbatim from `bookbuddy/library_catalog/scripts/` on 2026-09-02 —
**one canonical implementation, not a rewrite.** `check-clean.mjs` was already
byte-identical here; `deploy-guard.mjs` and `deploy-done.mjs` were copied
unchanged (both already resolve `apps/worker/wrangler.toml`, which is the same
path in both repos). The `--instance=` handling they carry for the library's
second Worker is inert here: this repo has one instance, so every line is
written and read as `default`. If a second board-game catalog is ever stood up
([`../info/multi-catalog-strategy.md`](../info/multi-catalog-strategy.md)), the
per-instance ancestry filtering is already there.

Keeping them identical is the point: a fix made in one repo is a `cp` away from
the other, and a diff is the test that they have not drifted.
