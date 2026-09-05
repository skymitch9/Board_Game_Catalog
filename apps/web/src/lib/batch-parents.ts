/**
 * Where an expansion added in the same batch as its base game gets its parent.
 *
 * ## The bug this module exists to kill (2026-08 audit, finding 2)
 *
 * Both bulk-add screens add rows in one `for` loop, base games first, so an
 * expansion can point at a base game the same loop created moments earlier.
 * That only works if the id map is written **synchronously**.
 *
 * `ScanJobsPage.addSelected` always did that — a plain local object, mutated in
 * the loop. `ScanPanel.addSelected` (née `ScanPage`) instead kept the map in
 * React state and wrote it with `setBatchIds(...)`, which does not change the
 * object the running closure is reading. Every id it wrote was invisible for
 * the rest of the tick, so:
 *
 * - a base game added earlier in the batch was invisible to its expansion, and
 * - a **manually chosen** sibling parent was silently dropped, stranding the
 *   expansion as a root-less row.
 *
 * ⚠️ **The auto-classified half of that was hidden by a rescue elsewhere** —
 * the server reunites an orphan with its parent by `pendingParentName` — which
 * is why the defect survived: it looked correct on the screen most of the time,
 * and the manual-select subcase (no name to reunite on) was the real loss.
 *
 * ## Why the two screens now share this file
 *
 * They encoded "a parent inside this batch" differently — `ScanPanel` with a
 * negative pseudo-id (`-(index + 1)`), `ScanJobsPage` with the string
 * `batch:<index>` — which is exactly how one of two copies drifts into a bug
 * the other does not have. Both encodings are decoded here, once, and both
 * screens resolve through `resolveBatchParent`. Nothing about the two
 * encodings changed; only where they are understood.
 *
 * ⚠️ Pure on purpose. This app has no jsdom, so anything worth a test lives in
 * a module a `node:test` process can import — the same reason `lib/add-modes.ts`
 * and `lib/scan-target.ts` exist.
 */

/** A row as this module needs to see it — the two screens' shapes overlap here. */
export interface BatchSibling {
  /** `'base'` marks a row that can be somebody's parent. */
  proposedKind: string;
  name: string;
}

/**
 * Decode a parent reference that points INSIDE the batch, in either encoding.
 *
 * Returns the batch index, or `null` when the reference is not a batch
 * reference at all (a real item id, an empty choice, or a malformed string).
 */
export function batchRefIndex(ref: number | string | null | undefined): number | null {
  if (typeof ref === 'string') {
    if (!ref.startsWith('batch:')) return null;
    const digits = ref.slice('batch:'.length);
    // ⚠️ The emptiness check is not belt and braces: `Number('')` is 0, and
    // without it a bare `batch:` would resolve to the FIRST row of the batch.
    if (!digits) return null;
    const index = Number(digits);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }
  // ⚠️ `-(index + 1)`, so -1 is index 0. Written `-ref - 1` rather than
  // `-(ref + 1)` because the latter yields `-0` for -1: harmless as an object
  // key, and a trap the moment anybody compares it.
  //
  // Zero is NOT a batch reference: it is not a valid item id either, and
  // reading it as index -1 was never intended.
  if (typeof ref === 'number' && ref < 0) return -ref - 1;
  return null;
}

/**
 * The parent id to save for one row of a bulk add.
 *
 * @param batchIds ⚠️ **must be the caller's synchronously-mutated map**, never
 * React state read from the enclosing closure. That is the whole defect above:
 * a state object read inside the loop that created the ids is always the
 * version from before the loop started.
 */
export function resolveBatchParent(opts: {
  /** Anything but `'base'` can have a parent; a base game never does. */
  kind: string;
  /** What the row (or the person) chose: an item id, a batch reference, or nothing. */
  parentRef: number | string | null;
  /** The base game read out of this row's own title, when the classifier found one. */
  proposedParentName?: string | null;
  /** The other rows in this batch, in index order. Empty is fine. */
  siblings?: readonly BatchSibling[];
  /** batch index → the item id it was saved as, so far this tick. */
  batchIds: Readonly<Record<number, number>>;
}): number | null {
  const { kind, parentRef, proposedParentName, siblings, batchIds } = opts;
  if (kind === 'base') return null;

  const refIndex = batchRefIndex(parentRef);
  if (refIndex !== null) return batchIds[refIndex] ?? null;

  // A real, already-saved item id.
  if (typeof parentRef === 'number') return parentRef;

  // Nothing chosen, but the classifier read a base game out of this title that
  // is also in this batch — match it by name among the rows proposed as bases.
  if (parentRef == null && proposedParentName && siblings?.length) {
    const parentIdx = siblings.findIndex(
      (s) => s.proposedKind === 'base' && s.name === proposedParentName,
    );
    if (parentIdx >= 0) return batchIds[parentIdx] ?? null;
  }

  return null;
}
