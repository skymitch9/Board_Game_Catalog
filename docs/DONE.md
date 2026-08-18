# DONE — Board Game Catalog (dated archive)

> **Audience:** Claude sessions. **Status:** TRACKED. Created **2026-08-16** to
> complete the estate's four-doc set (`TODO.md` · `DONE.md` · `access/` ·
> `info/`), which this repo was otherwise missing.
>
> ⚠️ **This is an archive, not a living doc. APPEND ONLY.** Nothing here is
> ever edited, re-summarised or tidied. An item arrives exactly once, at
> completion, moved **whole** from [`TODO.md`](TODO.md) — cut and paste, never
> summarised, because the summary always drops the *why*.

## Copy trimmed across the React app — ✅ DONE 2026-08-17

**Estate-wide ask, landed the session it was raised, so it never sat in
`TODO.md`.** The owner, verbatim:

> *"Let's trim text like this all over each of the sites. Only keep what's
> mandatory and keep all the text short and useful"*

Raised after he trimmed heygabi.ai/admin's header himself ("I think what we have
is self explanatory"); `catalog-platform` commit `204fb9d` is the precedent —
prose out, home of record named in a comment beside the cut, string pins updated
in the same commit.

**Trimmed here** (8 blocks, 263 → 171 visible words, −35%):
`DetailsQueuePage` (the scanning-gives-a-name setup, the only-games note),
`ExportPage` (spreadsheet, backup and privacy notes), `ScanHistoryPage` and
`ScanJobsPage` subtitles, `ItemPage`'s linked-games line.

**Deliberately NOT trimmed, and the reason is the rule.** Every empty state;
`SignIn.tsx` in full — both the misconfigured screen (a worded refusal that
names the fix, which the no-bare-status rule requires) and "signing in doesn't
let you in by itself", which is the approval gate; `PeoplePage`'s read-only
notice and its access sentence; `Arrivals`' write-consent lines; `WishlistPage`'s
shop-link legend, because "an empty result is a real answer" is an honesty
marker; the per-lookup cost disclosures on `ScanPage` and `DetailsQueuePage`.

⚠️ **`DetailsQueuePage`'s "each lookup takes twenty seconds to a minute"
paragraph was left ENTIRELY alone, on purpose.** Its own code comment records
that a shorter, more reassuring version of it was *wrong* — it promised closing
the tab cost nothing, when the server had about thirty seconds to finish and
half these lookups take longer, so they were killed without a word. That comment
ends "saying less, and saying it accurately, is worth more than the reassurance
was", which is the exact trap a trim pass walks into. It is the standing example
in this repo of prose that looks like padding and is not.

**Pins:** none. `npm test` covers `apps/worker/src/lib/*.test.ts` only — no web
copy is string-pinned. Every removed string was grepped across `apps/`,
`packages/` and `scripts/` first; no assertion named any of them. 64 tests pass,
typecheck clean, UTF-8 sweep clean.

## Two thresholds worth re-measuring one day

*Landed here 2026-08-17 by the docs hygiene sweep: the measuring this item asked for was done, and the threshold moved. VERIFIED: `docs/info/matcher-thresholds.md` (dated 2026-08-16) plus the harness `scripts/measure-matcher.ts` replayed all 255 real production shelf reads, and commit `1b7763e` raised the containment floor 0.60 → 0.68 on owner approval — every containment match 0.68 rejects was WRONG at 0.60, zero correct answers lost. The item's own BOSS MONSTER example is the reproduction it was measured against: "boss monster" vs "super boss monster 2" is 12/20 = 0.600, exactly on the old gate, and it filed a genuinely new game under its sequel on production job 13. It also corrected this item's framing — the historic 0.34 "floor that did nothing" was never the knob; it gates barcode lookups, not `matchExistingTitle`. The residue was not swept under the rug either: the sequel class survives ANY floor, and got confirm-first UX instead (`5e6a8a7`). Durable reference now lives by topic in [`info/matcher-thresholds.md`](info/matcher-thresholds.md).*


`matchExistingTitle` decides "you already own this" from a name, and on a local
catalog of 86 items it matched 44 of 73 shelf titles. Nearly all were exact
(`SCALES OF FATE` → `Scales of Fate`), but `BOSS MONSTER` → `Super Boss Monster 2`
is the kind of fragment match that files a genuinely new game under "already
yours", where it is lost rather than merely wrong. It has not been changed
because changing it without measuring is how the similarity floor came to be set
at 0.34 and do nothing — see the two-thresholds section of `HANDOFF.md`.

## Scan history — a record of which photo produced which items

*Landed here 2026-08-17 by the docs hygiene sweep — the first entry this archive has ever taken. VERIFIED in the tree before moving: `apps/web/src/pages/ScanHistoryPage.tsx` and its route, from commits `93a8d13` ("db+worker: a paged read over the whole scan_job table — the history query") and `7f8aed0` ("web: the scan-history page — which photo produced which items"), and `apps/worker/src/lib/scan-history.test.ts`. The paging this item predicted ("a real history view will want paging before it wants a cleanup") is what shipped, and the thing it asked to preserve was preserved — finished jobs are still not deleted, and no cleanup was added. `audiobook_catalog/docs/TODO.md` independently recorded it as "built + deployed (`43565416`)" on 2026-08-16.*


**Why it is not built yet:** nothing has needed it until now, and the queue was
the record. That stopped being true on 2026-08-06, when a job that has been
fully dealt with started leaving the active queue on its own.

**What exists already, and is deliberately enough to build on.** A finished job
is marked `done`, **not deleted**. The row keeps:

| Column | What it holds |
|---|---|
| `scan_job.enriched` | every title the photo produced, and per title its `addedItemId` or `dismissed` |
| `scan_job.mode` | `shelf`, `single` or `barcode` |
| `scan_job.created_at` / `processed_at` / `reviewed_at` | when it arrived, was read, was finished |
| `scan_job.error` | why it stopped, when it did |

So "which photo did this game come from?" is answerable today by reading
`enriched`; there is simply no screen for it. `ScanJobsPage` already hides
finished jobs behind a `<details>` — that collapsed list is the seed of the
history view, not a stand-in for it.

**The thing to preserve if anyone revisits this:** do not "tidy up" by deleting
finished jobs. Auto-deleting on completion was considered and rejected for
exactly this reason — with no history view, the row is the only record, and
losing it is not recoverable from anywhere else. `listScanJobs` caps at 50 rows,
so a real history view will want paging before it wants a cleanup.

## It starts empty, and that is correct

> **Superseded 2026-08-17 — it is no longer empty.** The docs hygiene sweep
> moved the two `TODO.md` items that had shipped (scan history; the two
> thresholds) whole into this file; they sit above this note, newest first.
> The paragraph below is kept because its *reasoning* still stands — entries
> arrive by being moved at completion, never by trawling git history.

Nothing has been moved here yet. Unlike its siblings, this repo's
[`TODO.md`](TODO.md) never accumulated finished work — it is 64 lines and says
of itself that it holds *only* "we decided to do this later". So there was no
backlog of completed items to archive, and inventing entries by trawling git
history would produce exactly the summarised, why-less record this file exists
to avoid.

**Where this repo's finished work is actually recorded, until entries arrive
here:**

| Looking for | Read |
|---|---|
| What shipped, and the state it left things in | [`HANDOFF.md`](HANDOFF.md) |
| How and why something works | [`info/`](info/README.md) |
| How to operate or deploy it | [`access/`](access/README.md) |
| Questions still genuinely open | [`open-questions.md`](open-questions.md) |

## How to use it from here

When a `TODO.md` item finishes, move the **whole** section here under a dated
heading, newest first. Do not edit it on the way out, and do not edit it after.
If what finished produced a durable fact — a gotcha, a measured threshold, a
design rationale — that part belongs in [`info/`](info/README.md) or
[`access/`](access/README.md) instead, findable by topic rather than by the day
it happened. Cross-link; never duplicate.

⚠️ This split does **not** reinstate the "competing living docs" problem. An
archive is not a living doc — it does not compete with `TODO.md` or
`HANDOFF.md` for "what is happening now", so do not helpfully re-merge them.
