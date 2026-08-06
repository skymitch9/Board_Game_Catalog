# The scan queue — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-06**.

What a `scan_job` row stores, what it refuses to store, and why the review
screen no longer argues with itself when two photos share a box.

## One rule: store the decision, compute the fact

`scan_job.enriched` is a JSON array of `ScannedTitle`
(`apps/worker/src/lib/barcode-scan.ts`). Every field on it is one of two things:

| | Examples | Where it lives |
|---|---|---|
| **A decision a person made** | `addedItemId`, `dismissed`, `acceptedMatch`, `relookedUpAs` | stored in the blob, forever |
| **A fact about the catalog** | whether we already own this game | **computed on every read** |

Ownership was the exception until 2026-08-06 and it was a bug. `alreadyOwned`
was written during enrichment and never revisited, so it answered *"was this in
the catalog when the photo was processed"* — and shelves get photographed twice.
Resolve a box on one photo and the other went on offering it as new. The owner:
*"when the game is resolved in 1 its not known to the other item waiting
processing."*

This is the same trade `inheritCover` (`packages/core/src/covers.ts`) and
`resolveInheritedDetails` already make, for the same reason: a copied fact is
indistinguishable from a researched one a month later, and it is wrong the moment
anything else changes.

## How it is resolved

`apps/worker/src/lib/scan-ownership.ts` is the whole of it.

1. **A row with a decision of its own is left alone.** An added row keeps its
   "Added — open it" link; **a dismissed row stays dismissed**, because dismissal
   is a judgement about this photo's reading and the catalog does not get to
   overturn it.
2. **The item the row already claims**, if it still exists (`existingItemId` →
   `byId`). This is what keeps a barcode match exact — rung 0 matched a *code*
   against `edition`, which is a stronger question than any name match.
3. **Otherwise, by name**, through `matchIndexedTitle` — the same rules as
   `matchExistingTitle`, against a catalog folded once per request instead of
   once per title. The names tried are the row's resolved identity (only when
   `acceptedMatch`, or when `isConfidentMatch` accepts it), then the text that
   was read or typed.

⚠️ **Do not write a second similarity function.** `isConfidentMatch`
(`packages/core/src/barcode.ts`) carries the 0.7 spine floor and the fragment
rule; the three wrong-game matches this project has shipped — Brink, Iliad, Moon
— all came from that kind of drift. Measured: a spine read "ZORBLAX QUANDARY"
resolved to *Quandary* is **not** matched against a catalogued *Quandary*.

`ownership` is attached by `withFreshOwnership` **on the way out of a route,
after every write**. It is never stored — verified with
`SELECT instr(enriched,'ownership') FROM scan_job`, which must stay 0.

## What it costs

Two D1 reads per request, whatever the size of the queue:

| Read | Size |
|---|---|
| `listItemNames` | ~41 KB / 760 rows — the shelf scanner's existing read |
| `listAddedItemSources` | two integers per game ever added from a review screen (15 on production) |

No per-title round trip. The provenance read uses `json_each` over
`scan_job.enriched` in SQL rather than parsing fifty 20 KB blobs in the Worker;
**D1 supports the JSON1 functions** (confirmed against production 2026-08-06,
`json_valid` guards the join so one malformed row cannot fail the statement).

## `countOutstanding` is now true by construction

A title is outstanding when it has no decision of its own *and* the catalog does
not hold it. Which means:

- **"3 still to sort" counts what is genuinely unsorted**, including work done on
  a different photo, by barcode, by hand, or in an earlier session.
- **The same title twice on one photo settles itself** the moment one of them is
  added.
- **A job whose last title was settled elsewhere closes itself** on the next read
  of the queue (`shouldAutoClose`, following `closeStaleDetailsRuns`'s precedent
  of sweeping on read). ⚠️ **Barcode jobs are exempt** — one stays open for the
  next scan, and a session of scanning boxes you already own has nothing
  outstanding at every point in it, so closing it would split one session into a
  job per box.
- **A game deleted from the catalog puts its row back on the queue.** That is the
  same rule in the other direction, and it is deliberate.

## What the screen says

"Already yours" is not enough when the reason is that the owner added it from a
different photo two minutes ago — it reads as the app losing their work. The row
stays where it is, ticks itself, and says which: *Added from another photo —
Wingspan*, linked to the item (`ownershipNote` in `ScanJobsPage.tsx`, from
`ownership.via` / `ownership.jobMode`).

It deliberately does **not** vanish into the "already in your collection" list:
review rows are index-addressed against the server's stored array, and a row that
disappears reads as lost work where a row that ticks itself reads as progress.
