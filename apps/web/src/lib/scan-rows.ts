/**
 * One row per barcode, whatever happened to it last.
 *
 * The scanned list in `BarcodeQueue` is keyed on the barcode itself
 * (`key={r.code}`), which is the right key — it is the identity of the thing on
 * the row. What was wrong was that a retry did not replace the earlier attempt.
 *
 * A failed lookup flips its row to `error` and *keeps its code*, then releases
 * the code from `acceptedRef` so the same box can be pointed at again. Pointing
 * at it again prepended a second row with the same code, so two `<li>` shared
 * one React key: a duplicated row on screen, and reconciliation deciding which
 * of them owns which DOM node. 2026-08 audit, finding 16.
 *
 * ⚠️ **The success path never cleaned it up either**, which is why this is a
 * defect rather than a flicker: the result handler finds its row by
 * `code === code && state === 'pending'`, so it updates the NEW row and leaves
 * the stale `error` one sitting above it, contradicting it, until the page is
 * left.
 */

/**
 * Put `next` at the top of the list, removing any earlier row for the same
 * barcode.
 *
 * Newest first, because the list is a scanning log and the thing you just did
 * is the thing you are looking at.
 */
export function replaceByCode<T extends { code: string }>(rows: readonly T[], next: T): T[] {
  return [next, ...rows.filter((r) => r.code !== next.code)];
}

/**
 * Are all the codes distinct? The invariant `replaceByCode` maintains, in a
 * form a test can assert directly.
 */
export function codesAreUnique(rows: readonly { code: string }[]): boolean {
  return new Set(rows.map((r) => r.code)).size === rows.length;
}
