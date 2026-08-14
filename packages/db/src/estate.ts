/**
 * The estate membership cache on app_user (migration 0026) — read, refresh,
 * and the §5.4 default-grant write.
 *
 * Design: catalog-platform/docs/info/estate-auth-design.md §5.2 (the cache
 * lives on the app's own user row), §5.4 (default-grant). The §3.1 verdict
 * logic itself lives in the canonical estate-auth module, NOT here — this file
 * is only the D1 reads/writes that module's protocol needs.
 *
 * Deliberately separate queries rather than widening `upsertUserOnLogin`'s
 * SELECT and the AppUser type: while ESTATE_CHECK is off these columns are
 * never read at all, and keeping them out of the shared user shape means the
 * web app's types don't learn about a cache that is none of its business.
 * Fold into AppUser later if enforce-mode makes the second read annoying.
 */

export interface EstateCacheRow {
  /** 'pending' | 'approved' | 'revoked' — validated by the caller (module). */
  status: string | null;
  checkedAt: string | null;
}

export async function readEstateCache(db: D1Database, userId: number): Promise<EstateCacheRow> {
  const row = await db
    .prepare('SELECT estate_status, estate_checked_at FROM app_user WHERE id = ?')
    .bind(userId)
    .first<{ estate_status: string | null; estate_checked_at: string | null }>();
  return { status: row?.estate_status ?? null, checkedAt: row?.estate_checked_at ?? null };
}

export async function writeEstateCache(
  db: D1Database,
  params: { userId: number; status: string; checkedAt: string },
): Promise<void> {
  await db
    .prepare('UPDATE app_user SET estate_status = ?, estate_checked_at = ? WHERE id = ?')
    .bind(params.status, params.checkedAt, params.userId)
    .run();
}

/**
 * The §5.4 default-grant: estate says `approved`, the local row is `pending`
 * and was NEVER locally decided — assign the configured default role and stamp
 * `approved_at` with `approved_by` left NULL (the recognisable estate-actor
 * convention; this repo has no change_log table, so the Worker's log line is
 * the audit trail).
 *
 * ⚠️ Only ever called in ESTATE_CHECK=enforce. In shadow the would-grant is
 * logged and nothing is written (the whole point of shadow).
 *
 * The WHERE clause re-checks the precondition so a concurrent local decision
 * (an owner tapping the People page mid-request) wins over the auto-grant —
 * §3.1's "a local decision is standing" rule applied at the row level. Returns
 * true only when the grant actually landed.
 */
export async function grantEstateDefaultRole(
  db: D1Database,
  params: { userId: number; role: string },
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE app_user SET role = ?, approved_at = ?, approved_by = NULL
        WHERE id = ? AND role = 'pending' AND approved_at IS NULL`,
    )
    .bind(params.role, new Date().toISOString(), params.userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
