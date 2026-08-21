# Board_Game_Catalog — docs map

> **Audience:** Claude/Kiro sessions first, the owner second.
> **Status:** ⚠️ **MIXED** — check `git check-ignore` before assuming a file is tracked.
> Last verified: **2026-08-21** (the tree below was measured that day).
>
> 📐 **The rules for this tree — filing, formatting, when to move things — live
> in `catalog-platform/docs/DOCS_STANDARD.md`, and ONLY there.** All four repos
> follow the same shape. Read it once; it is not restated here.
> ⚠️ It lives in that repo because `catalog-platform/docs/` is the only one of
> the four trees kept in git, so it survives a clone when this one does not.

**What this project is:** the board-game catalogue at `boardgames.heygabi.ai` — the scan queue and barcode ladder, cover art in R2, copy-status history, and the matcher thresholds.

---

## The tree

```mermaid
graph TD
    R["docs/"] --> RM["README.md<br/><i>you are here — the map</i>"]
    R --> T["TODO.md<br/><i>ACTIVE work only</i>"]
    R --> D["DONE.md<br/><i>dated archive · append-only</i>"]
    R --> K["KNOWN_ISSUES.md<br/><i>accepted defects & waivers</i>"]
    R --> A["access/<br/><i>how to operate it</i>"]
    R --> I["info/<br/><i>how & why it works</i>"]
    R --> AR["archive/<br/><i>superseded docs & data dumps</i>"]
    A --> AI["access/README.md — index"]
    I --> II["info/README.md — index"]
    T -.->|"finished work moves WHOLE"| D
    T -.->|"durable facts move by topic"| A
    T -.->|" "| I
    style T fill:#d9a441,color:#000
    style K fill:#b3453a,color:#fff
```

---

## Start here

| If you want to know… | Read |
|---|---|
| **What is active right now** | [`TODO.md`](TODO.md) |
| **Is this a bug or deliberate?** | [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) |
| **⚠️ Current state and handoffs** | [`HANDOFF.md`](HANDOFF.md) — **but see the note below** |
| **How do I set it up / sign in / reach the APIs** | [`access/SETUP.md`](access/SETUP.md) · [`access/login.md`](access/login.md) · [`access/external-apis.md`](access/external-apis.md) |
| **🔴 Rebuild from nothing** | [`access/RECOVERY.md`](access/RECOVERY.md) |
| **The design, scan queue, thresholds** | [`info/README.md`](info/README.md) · [`info/DESIGN.md`](info/DESIGN.md) |
| **Was this already solved** | [`DONE.md`](DONE.md) |

⚠️ **`HANDOFF.md` is a 223 KB competing living doc and `TODO.md` is 27 lines** —
the opposite of the shape the standard describes. Its finished sections belong
in `DONE.md` and its live ones in `TODO.md`. Filed as a Kiro item; until that
sweep runs, HANDOFF.md is where the real state is.

## Where the rest of the estate is

| Repo | Covers |
|---|---|
| `catalog-platform/docs/` | 📐 **The docs standard**, estate SSO, GABI, `/status`, backups — and the only tree in git |
| `bookbuddy/audiobook_catalog/docs/` | The audiobook pipeline, the shelf server, ebooks |
| `bookbuddy/library_catalog/docs/` | The physical/print catalogue |

⚠️ **This tree is not in git** (wholly or partly), so it exists on the owner's
machine and nowhere else. All four are backed up to R2 by
`catalog-platform/scripts/backup-docs.mjs`; the restore was drilled 2026-08-21.
Runbook: `catalog-platform/docs/access/backup-restore.md` §6b.
