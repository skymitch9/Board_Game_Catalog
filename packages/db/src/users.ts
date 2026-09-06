import type { AppUser, Role } from '@bgc/core';

interface UserRow {
  id: number;
  email: string;
  display_name: string | null;
  role: string;
  first_seen_at: string;
  approved_at: string | null;
}

function toUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as Role,
    firstSeenAt: row.first_seen_at,
    approvedAt: row.approved_at,
  };
}

export async function findUserByEmail(db: D1Database, email: string): Promise<AppUser | null> {
  const row = await db
    .prepare('SELECT id, email, display_name, role, first_seen_at, approved_at FROM app_user WHERE email = ?')
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

/**
 * Resolve the signed-in identity to a catalog user, creating the row on first
 * sight. Identity always comes from Google via the Access JWT — nothing is
 * configured by hand.
 *
 * Bootstrap rule: if the table is empty, the first person to sign in becomes
 * `owner`. That's you, moments after deploying, because nobody else has the URL
 * yet. Everyone afterwards lands as `pending` and sees a request screen until an
 * owner approves them — including your wife on her first visit, which is one tap
 * for you.
 *
 * The rule is self-limiting: once any owner exists it never applies again, so
 * there is no window where a second person can claim ownership.
 *
 * `ownerEmails` (the optional OWNER_EMAILS var) is a recovery hatch only — for
 * the day you lock yourself out and need to force an account back to owner
 * without hand-editing the database. It is empty in normal operation.
 */
export async function upsertUserOnLogin(
  db: D1Database,
  params: { email: string; displayName?: string | null; ownerEmails?: string[] },
): Promise<AppUser> {
  const email = params.email.toLowerCase();
  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (params.displayName && params.displayName !== existing.displayName) {
      await db
        .prepare('UPDATE app_user SET display_name = ? WHERE id = ?')
        .bind(params.displayName, existing.id)
        .run();
      return { ...existing, displayName: params.displayName };
    }
    return existing;
  }

  const isRecoveryOwner = (params.ownerEmails ?? []).some((e) => e.trim().toLowerCase() === email);

  // The role decision happens inside the INSERT so the "is the table empty?"
  // check and the write are one atomic statement — two simultaneous first
  // sign-ins can't both come out as owner.
  await db
    .prepare(
      `INSERT INTO app_user (email, display_name, role, approved_at)
       SELECT ?, ?,
              CASE WHEN ? = 1 OR (SELECT COUNT(*) FROM app_user) = 0
                   THEN 'owner' ELSE 'pending' END,
              CASE WHEN ? = 1 OR (SELECT COUNT(*) FROM app_user) = 0
                   THEN ? ELSE NULL END
        WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE email = ?)`,
    )
    .bind(
      email,
      params.displayName ?? null,
      isRecoveryOwner ? 1 : 0,
      isRecoveryOwner ? 1 : 0,
      new Date().toISOString(),
      email,
    )
    .run();

  const created = await findUserByEmail(db, email);
  if (!created) throw new Error(`failed to create user record for ${email}`);
  return created;
}

export async function listUsers(db: D1Database): Promise<AppUser[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, display_name, role, first_seen_at, approved_at
         FROM app_user
        ORDER BY CASE role WHEN 'pending' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, email`,
    )
    .all<UserRow>();
  return results.map(toUser);
}

/**
 * What a role write can answer with. `last_owner` is distinguishable from
 * `not_found` on purpose: they are different refusals and the routes turn them
 * into different words and different statuses (400 vs 404). A bare `null`
 * could not tell them apart.
 */
export type SetUserRoleResult =
  | { ok: true; user: AppUser }
  | { ok: false; reason: 'not_found' | 'last_owner' };

/**
 * Change a person's role — the ONE role-write path. Both mounts land here (the
 * People page's `PATCH /api/users/:id/role` and the federated estate surface's
 * `PATCH /api/admin/users/:id/role`), so both inherit the same policy rather
 * than carrying two copies of it.
 *
 * ⚠️ **The last-owner guard lives HERE, keyed on the TARGET's current role**
 * (KI-7, fixed 2026-09-05; `library_catalog` took the same fix in its 2026-08
 * audit). It used to live in the two routes, keyed on `userId === actor.id`, so
 * it fired only on a self-edit: an `admin` — who may grant every rung beneath
 * `admin` — could demote somebody ELSE who was an `owner`, drive
 * `countOwners()` to 0, and after that no role in this app could ever mint an
 * `owner` again (an `admin` may not grant one). The way back was `OWNER_EMAILS`
 * plus a sign-in, or hand-written SQL against live D1.
 *
 * Keying on the target closes it: if the target is currently an `owner`, the
 * new role is not `owner`, and only one owner is left, that target IS the last
 * owner and the write is refused — whoever is asking, from whichever mount. The
 * self-demotion case the old route guard covered is a strict subset of this
 * one (a last owner demoting themselves is a target at `owner`), which is why
 * the route copies were deleted rather than kept beside it.
 *
 * The read-before-write also gives `not_found` an honest answer *before* the
 * UPDATE rather than inferring it from a re-read afterwards.
 */
export async function setUserRole(
  db: D1Database,
  params: { userId: number; role: Role; approvedBy: number },
): Promise<SetUserRoleResult> {
  const before = await db
    .prepare('SELECT id, email, display_name, role, first_seen_at, approved_at FROM app_user WHERE id = ?')
    .bind(params.userId)
    .first<UserRow>();
  if (!before) return { ok: false, reason: 'not_found' };

  if (before.role === 'owner' && params.role !== 'owner') {
    if ((await countOwners(db)) <= 1) return { ok: false, reason: 'last_owner' };
  }

  await db
    .prepare('UPDATE app_user SET role = ?, approved_at = ?, approved_by = ? WHERE id = ?')
    .bind(params.role, new Date().toISOString(), params.approvedBy, params.userId)
    .run();

  const row = await db
    .prepare('SELECT id, email, display_name, role, first_seen_at, approved_at FROM app_user WHERE id = ?')
    .bind(params.userId)
    .first<UserRow>();
  return row ? { ok: true, user: toUser(row) } : { ok: false, reason: 'not_found' };
}

export async function countOwners(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM app_user WHERE role = 'owner'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * People who have signed in and are stuck on the holding screen.
 *
 * Nothing else in the app notices them: Access lets anyone authenticate, they
 * land as `pending`, and the only trace is a row on a page nobody has a reason
 * to open. Counted so the nav can say so.
 */
export async function countPendingUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM app_user WHERE role = 'pending'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
