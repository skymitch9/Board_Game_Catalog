# Board_Game_Catalog — Rebuild From Nothing

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — ⚠️ this
> repo is **PUBLIC** (`gh repo view skymitch9/Board_Game_Catalog` → `PUBLIC`,
> verified 2026-08-18), so secret **NAMES ONLY**, never a value, never a
> member email.
> **Last verified: 2026-08-18.**
>
> **The question this file answers:** *from nothing but a git clone and the
> blob backups, how do I rebuild this app?* It is the per-repo half of the
> estate rebuild rule, and it does **not** duplicate restore mechanics —
> [`catalog-platform/docs/access/RECOVERY.md`](../../../../catalog-platform/docs/access/RECOVERY.md)
> is the single source of truth for *how* to replay a D1 dump or a bucket
> tarball. This file says *what this repo needs, and in what order*.
>
> ⚠️ **THE WHOLE SEQUENCE BELOW IS INFERENCE.** No rebuild of this app has ever
> been performed. §5 labels every capability drilled-or-not, honestly.

---

## 0. The 60-second version

1. **One instance, one database, one bucket** — simpler than its library
   sibling, which has two of each.
2. ⚠️ **This app's D1 dump does NOT replay raw.** It dies at `no such table:
   main.app_user` after 2 of 18 tables, leaving a half-populated database *that
   looks like it imported*. **Reorder first** — `catalog-platform` RECOVERY.md
   §3b — it is a mandatory step, not a tidy-up.
3. **Rebuild `catalog-platform` first.** It owns the backup system, the restore
   scripts, and the auth Worker this app calls.
4. ⚠️ **A new D1 ID comes out of a rebuild** and must be pasted into
   `apps/worker/wrangler.toml`. Deploying with the old ID "succeeds" and points
   at an account you no longer own.
5. **This app was measured to have NO DRIFT** between the 2026-08-16 backup and
   live on 2026-08-18 (§1c of that file) — the catalog is finished and largely
   static. That makes a backup here unusually close to current, and it makes a
   *stale* backup unusually easy to mistake for a good one.

---

## 1. Full inventory

### 1a. Code

| | |
|---|---|
| Repo | `skymitch9/Board_Game_Catalog` — ⚠️ **PUBLIC** |
| Worker source | `apps/worker/` (Hono, TS) |
| Web app | `apps/web/` → built to `apps/web/dist`, served by the Worker's `[assets]` |
| Shared | `packages/` |
| Migrations | `migrations/` at the repo root — **27 files** |
| CI | `.github/workflows/deploy.yml` |

### 1b. Deployed shape

| | |
|---|---|
| Worker name | `board-game-catalog` |
| Hostname | `boardgames.heygabi.ai` (`custom_domain = true` — the deploy creates the DNS record) |
| D1 | `board-game-catalog` — `7dd22702-f0e2-4fc7-b201-d16d60176efa` (region WNAM) |
| R2 | `game-covers` |
| Crons | `*/30 * * * *`, `41 5 * * 1`, `7 * * * *` |
| Rate limiter | `[[unsafe.bindings]]` `RATE_LIMITER`, 300 per 60 s, `namespace_id = "1001"` |

⚠️ **`namespace_id` is arbitrary but changing it silently resets every
counter**, and `period` accepts only 10 or 60. Neither is a rebuild blocker;
both are ways to quietly change behaviour while the deploy still succeeds.

⚠️ **Cloudflare Access is NOT in front of this any more.** The hostname was
added as a second *destination* on the existing Access application rather than
as a new application, so it inherits that app's audience. A rebuild that
recreates Access as a **new** application mints a new AUD and must append it to
`CF_ACCESS_AUD`.

### 1c. Durable state, and where a copy lives

| Store | Backed up? | Where the copy is | Rebuildable another way? |
|---|---|---|---|
| D1 `board-game-catalog` | ✅ daily 09:12 UTC | `estate-backups/d1/board-game-catalog/<STAMP>.sql` + the mirror | ❌ **No. User-entered, no other copy** (`backup-restore.md` §1 rates it High) |
| R2 `game-covers` | ✅ daily | `estate-backups/r2/game-covers/<STAMP>.tar.gz` + the mirror | ⚠️ **Assume no.** Whether a reproducible master exists depends on how the covers-consolidation migration sourced its images; **treated as precious until proven otherwise** |
| R2 `bgc-photos` | ❌ not in the matrix | — | **0 objects**, feature not live. Joins the matrix the day it holds real uploads |
| Rows pushed to `index_catalog` | n/a | — | ✅ **Yes — re-push, never restore** |
| Firestore (reviews, site roles, …) | ✅ daily | shared with the estate | Owned by the `audiobook-catalog` Firebase project, not by this repo |

⚠️ **`game-covers` measured 178.9 MB / 1,125 objects on 2026-08-18 — 57% of the
way to the 300 MiB uploader ceiling** that already forced `audiobook-covers` to
be split into parts. When it crosses ~250 MiB its dump becomes multi-part, and
**a dump missing any part cannot be untarred at all** (`catalog-platform`
RECOVERY.md §5). Nothing to do today; know it before a restore surprises you.

### 1d. Machine state

**None.** This app keeps no local master of anything — everything it owns is in
D1 or R2.

---

## 2. The rebuild, in order

```bash
# 0. PREREQUISITE: rebuild catalog-platform first.

git clone https://github.com/skymitch9/Board_Game_Catalog && cd Board_Game_Catalog
npm install && npm run build          # apps/web/dist must exist before deploy

# 1. create the database
npx wrangler d1 create board-game-catalog

# 2. ⚠️ PASTE THE NEW database_id into apps/worker/wrangler.toml (line ~55).

# 3. ⚠️ REORDER, then import — this dump does NOT replay raw
node ../catalog-platform/scripts/reorder-d1-dump.mjs ./board-game-catalog.sql ./board-game-catalog.ordered.sql
npx wrangler d1 execute board-game-catalog --remote --file=./board-game-catalog.ordered.sql -y

# 4. catch the schema up
npx wrangler d1 migrations apply board-game-catalog --remote    # NB: rejects -y

# 5. bucket + covers — catalog-platform RECOVERY.md §5
npx wrangler r2 bucket create game-covers

# 6. secrets — §3 below
# 7. deploy (this is also what creates boardgames.heygabi.ai)
npx wrangler deploy --config apps/worker/wrangler.toml

# 8. re-push the index rather than restoring it
curl -s https://boardgames.heygabi.ai/api/health >/dev/null
```

**Verification the drill actually measured**, so it is the right thing to check
after step 3 — the reordered dump imported with these exact counts:

| Table | Rows |
|---|---|
| `item` | 837 |
| `edition` | 1,067 |
| `copy` | 838 |
| `game_component` | 1,454 |
| `cover_check` | 1,012 |
| `app_user` | 4 |
| migrations | 27 |

…and `PRAGMA foreign_key_check` returned **zero rows**. ⚠️ Those were live
counts on 2026-08-18 as well — **this database had no drift** — so a rebuild
landing on different numbers means either the backup is old or the import
stopped early. Check, do not assume.

---

## 3. Secrets, by name — custody and where to re-mint

⚠️ **NO VALUES HERE, EVER — this repo is PUBLIC.**
⚠️ **Cloudflare Worker secrets are WRITE-ONLY.** A rebuild re-mints all of them.

| Name | Holder | Custody today | Re-mint at |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions (`deploy.yml`) | GH repo secret | dash.cloudflare.com → API Tokens ("Edit Cloudflare Workers") |
| `CATALOG_PLATFORM_TOKEN` | GitHub Actions | GH repo secret | github.com → Settings → Developer settings → PAT |
| `BGG_API_TOKEN` | Worker | Worker secret (+ `apps/worker/.dev.vars` locally) | boardgamegeek.com account |
| `ANTHROPIC_API_KEY` | Worker | Worker secret | console.anthropic.com |
| `ESTATE_APP_TOKEN_GAMES` | ⚠️ **PAIRED** — this Worker **and** `estate-auth` | Worker secret, both sides | self-generated; ⚠️ **both sides together or it fails as a silent 401** |
| `INDEX_PUSH_TOKEN` | ⚠️ **PAIRED** — this Worker **and** `catalog-index` | Worker secret, both sides | self-generated |

**Not secrets, but they decide who is an owner** — `OWNER_EMAILS`,
`ESTATE_CHECK`, `ESTATE_AUTH_URL`, `FIREBASE_PROJECT_ID` (all `[vars]`, tracked
in git, so they return with the clone).

📖 **The complete cross-repo credential map is
`audiobook_catalog/docs/access/CREDENTIALS.md`.** ⚠️ **Gitignored on purpose**
— it exists only on the owner's machine, and a machine-loss rebuild does not
have it. `npx wrangler secret list --config apps/worker/wrangler.toml` is what
remains.

---

## 4. What a rebuild CANNOT recover

- **Any catalog edit made after the newest backup** — bounded at ~1 day by the
  daily cron. ⚠️ Historically **zero** for this app (no drift measured over two
  days), which is a property of how finished the catalog is, not a guarantee.
- **Worker secret values** — re-minted, never recovered.
- **Any cover added since the newest bucket dump.**
- **The rate limiter's counters** — reset by a rebuild; harmless.
- ⚠️ **`CREDENTIALS.md`**, if the owner's machine is the casualty.

---

## 5. Drilled vs inference

**"Drilled" = executed and measured on the date shown. "Inference" = an
identical mechanism was drilled elsewhere — a real reason to expect it works,
and not a measurement.**

| Capability | Status | Evidence |
|---|---|---|
| `board-game-catalog` dump is complete and faithful | ✅ **Drilled** 2026-08-17 | catalog-platform RECOVERY.md §1a |
| Its dump does **not** replay raw; reorder fixes it | ✅ **Drilled** 2026-08-17 + regression test | §3b there — died at `no such table: main.app_user` after 2 of 18 tables |
| Local import + row counts match production exactly | ✅ **Drilled** 2026-08-17 | the table in §2 above |
| Remote D1 import works at all | ✅ **Drilled** 2026-08-18 | §3c-drill there — ⚠️ on `estate_auth`, **not** on this repo's dump |
| **Remote import of THIS repo's reordered dump** | ⚠️ **Inference** | same statement stream, never run remotely |
| `migrations apply --remote` | ⚠️ **Inference** | local only |
| `game-covers` dump matches live bytes | ✅ **Drilled** 2026-08-17 | 1,124 objects / 179.6 MB, sha256 spot-check |
| Restoring a cover (`r2 object put`) | ❌ **NOT verified** | production write |
| Recreating the hostname / Access audience | ❌ **NOT verified** | never torn down |
| **This whole rebuild sequence** | ❌ **NOT verified** | never performed |

---

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task below names a
> model, honor that name; the naming exists so AUTO stays cheap and safe.
> Labels (verified against Kiro pricing: Auto = 1.0x credits, pinned Sonnet =
> 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" = STAY ON AUTO, do not pin
> (standard build). "Kiro Claude Opus 4.8" = actually pin Opus - the 2.2x is
> worth it (design judgment or trust-critical). "Codex (GPT-5.3-Codex)" = tell
> the owner; he runs Codex himself.

| Task on this document | Model |
|---|---|
| Keeping this file current — new migration, new binding, re-dating | **Kiro Claude Sonnet 5** |
| Rehearsing a restore in a sandbox / a throwaway database | **Kiro Claude Sonnet 5** |
| ⚠️ **Executing a real restore** — any `--remote` import, any `r2 object put`, any Time Travel restore, editing a live `database_id` | **Kiro Claude Opus 4.8** |

⚠️ A real restore is Opus-pinned because it is irreversible and because this
app's D1 rows exist nowhere else. Doc upkeep is not.
