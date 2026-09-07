import type { EnrichedTitle } from '../api';

/**
 * Read a scan job's `enriched` blob without letting a bad one take a page down.
 *
 * `job.enriched` is a JSON string the server wrote and the client never
 * validated. Four places parse it, and until 2026-09-06 three of them wrapped
 * the parse in a try/catch and the fourth — the review page's own render — did
 * not. A non-null malformed blob therefore threw *during render*, and with no
 * error boundary anywhere in `apps/web/src` that is a white screen: not a
 * broken list, the whole page, with nothing on it to read and no way back.
 * 2026-08 audit, finding 12.
 *
 * So this is the one implementation, and every caller uses it.
 *
 * ⚠️ **`null` means "cannot be read", and it is NOT the same as `[]`.** An
 * empty list is a job that found no titles, which is an ordinary outcome worth
 * saying plainly; null is a job whose record is damaged, which is worth saying
 * differently. Collapsing the two would report a data problem as an empty
 * shelf — the same silent-failure shape the rest of this repo keeps refusing.
 *
 * The array check matters as much as the try/catch: `JSON.parse('"hello"')`
 * and `JSON.parse('null')` both succeed, and both would reach `.filter` and
 * throw exactly where the unguarded parse used to.
 */
export function parseEnriched(raw: string | null | undefined): EnrichedTitle[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EnrichedTitle[]) : null;
  } catch {
    return null;
  }
}

/**
 * The same, for the blob of raw titles the reader produced.
 *
 * Only its length is ever wanted, and only to show progress — so an unreadable
 * one is null and the caller shows no progress rather than a wrong number.
 */
export function parseRawTitles(raw: string | null | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
