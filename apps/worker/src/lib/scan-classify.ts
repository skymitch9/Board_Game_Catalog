/**
 * What a queued title *is* — asked now, not remembered.
 *
 * **The same bug as `scan-ownership.ts`, one field over.** `proposedKind`,
 * `proposedParentId`, `proposedParentName`, `inferredParentName` and `reason`
 * were decided during enrichment and frozen into `scan_job.enriched`. Every one
 * of them is a statement about the catalog, so every one of them goes stale the
 * moment the catalog moves:
 *
 * > Photograph two shelves. Wingspan is on the first, *Wingspan: Oceania* on the
 * > second. Add Wingspan from photo one and photo two still says **"Wingspan is
 * > not in your collection — if this is an expansion, it will wait for it"**,
 * > and still offers no parent to file Oceania under.
 *
 * `classifyShelfResults` is pure and makes no subrequests, which is why
 * enrichment already re-runs it on every chunk. Running it again on the way out
 * of a read costs nothing extra either: the catalog's names are the read
 * `scan-ownership.ts` already does.
 *
 * ⚠️ Same rule as ownership: **the result of this must never reach a write.**
 * It is applied to the copy of a job that goes out in a response, after the last
 * write, and never to the blob that goes back into D1.
 *
 * This module exists so there is one classifier rather than two. Enrichment
 * (which knows ownership only as the `alreadyOwned` it just computed) and the
 * read path (which resolves ownership against the catalog) differ in *that one
 * question* and nothing else, so that question is the parameter.
 */

import {
  classifyShelfResults,
  scanRowName,
  type ItemAliasRef,
  type NameableScanRow,
} from '@bgc/core';

/** The fields a classifiable row must have. Structural, so both paths fit. */
export interface ClassifiableTitle extends NameableScanRow {
  bggId: number | null;
  thumbnailUrl: string | null;
  proposedKind: string | null;
  proposedParentId: number | null;
  proposedParentName: string | null;
  inferredParentName: string | null;
  reason: string | null;
}

/**
 * Decide kind and parent across every row that is still a candidate.
 *
 * `isOwned` decides which rows take part. Owned rows are excluded and have their
 * proposals cleared, for two reasons: nothing is going to be created for them,
 * so a proposed parent is an answer to a question nobody asked; and leaving them
 * in the batch would let a row you already have act as a parent candidate for a
 * row you do not, which is a proposal the add flow cannot honour — it would have
 * to resolve to a real item id, and the batch path deliberately has none.
 *
 * The index into `classified` advances only for participating rows, which is why
 * this is a counter rather than a lookup by position. Getting that wrong shifts
 * every proposal one row down the list — silently, and plausibly.
 */
export function classifyTitles<T extends ClassifiableTitle>(
  rows: T[],
  existing: readonly { id: number; name: string; kind: string }[],
  isOwned: (row: T, index: number) => boolean,
  /**
   * Alternate names, so a *prefix* may be one too. "The Settlers of Catan:
   * Seafarers" is an expansion of the box filed as "Catan", and without this the
   * classifier would propose no parent for it while the ownership pass one step
   * earlier had no trouble recognising the same string.
   */
  aliases: readonly ItemAliasRef[] = [],
): T[] {
  const participates = rows.map((r, i) => !isOwned(r, i));

  const classified = classifyShelfResults(
    rows
      .filter((_, i) => participates[i])
      .map((r) => ({
        // The name this row would actually be saved under, not `resolvedName`.
        // A doubtful lookup is discarded here for the same reason the add flow
        // discards it — see `scanRowName`, which is that function.
        name: scanRowName(r),
        bggId: r.bggId,
        thumbnailUrl: r.thumbnailUrl,
      })),
    existing,
    aliases,
  );

  let idx = 0;
  return rows.map((r, i) => {
    if (!participates[i]) {
      return {
        ...r,
        proposedKind: null,
        proposedParentId: null,
        proposedParentName: null,
        inferredParentName: null,
        reason: null,
      };
    }
    const cls = classified[idx++];
    return {
      ...r,
      proposedKind: cls?.proposedKind ?? 'base',
      proposedParentId: cls?.proposedParentId ?? null,
      proposedParentName: cls?.proposedParentName ?? null,
      inferredParentName: cls?.inferredParentName ?? null,
      reason: cls?.reason ?? null,
    };
  });
}
