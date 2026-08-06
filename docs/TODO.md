# TODO

Work that is agreed but not built. Current state and handoffs live in
[`HANDOFF.md`](HANDOFF.md); stable reference lives in [`access/`](access/README.md)
and [`info/`](info/README.md). This file is only "we decided to do this later".

**Last updated:** 2026-08-06.

---

## Scan history — a record of which photo produced which items

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

---

## Splitting a shelf photograph into pieces

Raised alongside the enrichment stall, and **would not have fixed it** — worth
recording so nobody spends a day on it for the wrong reason.

Vision reads a wide shelf perfectly well: production job 5 produced all 73
titles and stored them. What ran out of budget was the per-title *enrichment*
afterwards, which is now chunked. Splitting the image would have made vision
cost more and changed nothing about the failure.

It may still be worth doing later for **accuracy** on a very wide shelf, where
spines at the edges are small and skewed. That is a different argument and needs
its own evidence — measure the read rate on a wide shelf before building it.

---

## Two thresholds worth re-measuring one day

`matchExistingTitle` decides "you already own this" from a name, and on a local
catalog of 86 items it matched 44 of 73 shelf titles. Nearly all were exact
(`SCALES OF FATE` → `Scales of Fate`), but `BOSS MONSTER` → `Super Boss Monster 2`
is the kind of fragment match that files a genuinely new game under "already
yours", where it is lost rather than merely wrong. It has not been changed
because changing it without measuring is how the similarity floor came to be set
at 0.34 and do nothing — see the two-thresholds section of `HANDOFF.md`.
