/**
 * What `/api/export.json` is allowed to hand out, and to whom.
 *
 * ## The exposure this closes (2026-08 audit, finding 4)
 *
 * The full export is gated on `editCatalog` — **contributor and up** — and its
 * ratings query read `SELECT ui.*, u.email FROM user_item ui JOIN app_user u …`.
 * So every contributor who pressed Export downloaded **every household
 * account's email address**, from a table the export does not otherwise
 * publish at all. Nobody chose that; it arrived as a convenience on a join.
 *
 * ⚠️ This is an access-REDUCING change and needs nobody's permission. If the
 * owner later decides contributors should see emails again, it is one entry in
 * `EMAIL_CAPABILITY` below.
 *
 * ## Default-deny, and why only this table
 *
 * The estate rule is that an export is an explicit allowed-field array, never
 * `SELECT *` minus exclusions. `user_item` is written out column by column here
 * for that reason, **and because it is the one export row that reaches into
 * another table** — a future column on either side would otherwise ship to a
 * contributor silently, which is exactly how `u.email` got there.
 *
 * ⚠️ **`item` / `edition` / `copy` / `copy_event` deliberately stay `SELECT *`,
 * and that is not an oversight.** This file is a BACKUP: "one request,
 * everything, in a format you could rebuild from". For those four tables the
 * silent failure runs the other way — a migration adds a column, an allow-list
 * that nobody remembered to update drops it, and the loss is discovered on
 * restore day. They carry no account identity, so there is nothing to deny.
 * The judgement is written down here rather than left to be re-derived.
 *
 * The drift risk this file DOES take on is guarded mechanically:
 * `export-fields.test.ts` reads `migrations/` and fails if the live `user_item`
 * shape has a column this list does not.
 */
import { can, type Capability, type Role } from '@bgc/core';

/**
 * Every column of `user_item`, named. ⚠️ Order matches the table as migration
 * 0028 rebuilt it; a new column belongs here AND in the test's expectation.
 */
export const USER_ITEM_COLUMNS = [
  'id',
  'item_id',
  'user_id',
  'rating',
  'notes',
  'rated_at',
] as const;

/**
 * Who may see which account each rating belongs to.
 *
 * `manageUsers` (admin and owner) — the same people who already read every
 * address on the People page, so this hands out nothing new. It is deliberately
 * NOT `editCatalog`: that is the gate on the route, and reusing it would leave
 * the exposure exactly where it was.
 */
export const EMAIL_CAPABILITY: Capability = 'manageUsers';

/** May this role's export carry the account emails? */
export function canExportEmails(role: Role): boolean {
  return can(role, EMAIL_CAPABILITY);
}

/**
 * The ratings query, built from the allow-list.
 *
 * `withEmail` adds ONE column from `app_user` and nothing else; the join stays
 * either way so the row order and count do not change with the reader's role —
 * two people exporting the same catalog should get the same rows, differing
 * only in whether the address is on them.
 */
export function userItemQuery(withEmail: boolean): string {
  const columns = USER_ITEM_COLUMNS.map((c) => `ui.${c}`);
  if (withEmail) columns.push('u.email');
  return (
    `SELECT ${columns.join(', ')} FROM user_item ui\n` +
    '           JOIN app_user u ON u.id = ui.user_id ORDER BY ui.id'
  );
}

/**
 * What this download does NOT contain, said out loud in the file itself.
 *
 * ⚠️ Without this a restore reading an export with no `email` key would have to
 * guess between "the accounts had no addresses" and "the person who exported it
 * was not allowed to see them". A backup that cannot tell you what it is
 * missing is a backup that lies quietly.
 */
export function exportOmissions(withEmail: boolean): string[] {
  return withEmail
    ? []
    : [
        'ratings[].email — account addresses are withheld from exports by anyone ' +
          'below admin. Ask an admin or the owner to re-export if a restore needs them.',
      ];
}
