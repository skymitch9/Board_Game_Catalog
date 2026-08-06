/**
 * Reading a stored timestamp, in the viewer's own timezone.
 *
 * **The bug this exists to stop.** SQLite's `datetime('now')` stores
 * `2026-08-06 05:45:34` — a space instead of the `T`, and no zone marker at all,
 * even though the instant is UTC. JavaScript reads that shape as *local* time,
 * so a UTC instant is taken to be already localised and every rendered clock is
 * out by the viewer's offset. `toLocaleString()` then displays the wrong instant
 * perfectly faithfully, which is why it looked like a formatting choice.
 *
 * So the fix is a parse, not a format: normalise to a real UTC instant first,
 * then hand it to `toLocale*` with **no** explicit `timeZone`, which already
 * uses the browser's.
 *
 * `parseStamp` is deliberately a no-op for anything that already carries a `T`.
 * Some timestamps in this app come from `new Date().toISOString()` rather than
 * SQLite and are already correct; appending a second `Z` to those would move
 * them by the offset in the opposite direction.
 */

/** A stored timestamp as a real instant. Returns null when it will not parse. */
export function parseStamp(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // Only the bare SQLite shape needs repairing. Anything with a `T` came from
  // toISOString() (or a caller that already knew), and is left alone.
  const normalised = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const when = new Date(normalised);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** Date and clock time, in the viewer's zone. Falls back to the raw string. */
export function formatDateTime(iso: string | null | undefined): string {
  const when = parseStamp(iso);
  return when ? when.toLocaleString() : (iso ?? '');
}

/** Just the date — for rows where the clock time is noise. */
export function formatDate(
  iso: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const when = parseStamp(iso);
  return when ? when.toLocaleDateString(undefined, opts) : (iso ?? '');
}
