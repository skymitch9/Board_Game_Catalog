/**
 * Leaf module: turning SQLite's timestamps into instants a browser cannot
 * misread.
 *
 * It lives here rather than in `copies.ts` — where it was born and is still
 * re-exported from — so that `copy-events.ts` can use it without importing
 * `copies.ts`, which imports `copy-events.ts` back. The cycle would have been
 * harmless today (both sides are hoisted function declarations), but this
 * package has a written scar about exactly that class of import order:
 * `packages/core/src/constants.ts` exists because a cycle left zod enums
 * undefined at module-init time. A leaf is cheaper than remembering why the
 * cycle was safe.
 */

/**
 * SQLite's `datetime('now')` writes "YYYY-MM-DD HH:MM:SS" in UTC, which is not
 * quite ISO 8601 — and `new Date()` in a browser reads that space-separated
 * form as *local* time, so a copy added at 23:30 UTC could display as the day
 * before. Normalising here means every consumer gets an unambiguous instant.
 */
export function toIso(sqliteDatetime: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sqliteDatetime)
    ? `${sqliteDatetime.replace(' ', 'T')}Z`
    : sqliteDatetime;
}
