import type { Rating, UpsertRatingInput } from '@bgc/core';

/**
 * One rating per person per item. A null rating with notes is legitimate —
 * "played it, no strong opinion, here's why".
 */
export async function upsertRating(
  db: D1Database,
  params: { itemId: number; userId: number; input: UpsertRatingInput },
): Promise<Rating | null> {
  await db
    .prepare(
      `INSERT INTO user_item (item_id, user_id, rating, notes, rated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(item_id, user_id)
       DO UPDATE SET rating = excluded.rating,
                     notes = excluded.notes,
                     rated_at = datetime('now')`,
    )
    .bind(params.itemId, params.userId, params.input.rating, params.input.notes || null)
    .run();

  const row = await db
    .prepare(
      `SELECT ui.user_id, ui.rating, ui.notes, ui.rated_at, u.email, u.display_name
         FROM user_item ui JOIN app_user u ON u.id = ui.user_id
        WHERE ui.item_id = ? AND ui.user_id = ?`,
    )
    .bind(params.itemId, params.userId)
    .first<{
      user_id: number;
      rating: number | null;
      notes: string | null;
      rated_at: string;
      email: string;
      display_name: string | null;
    }>();

  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    rating: row.rating,
    notes: row.notes,
    ratedAt: row.rated_at,
  };
}

export async function deleteRating(
  db: D1Database,
  params: { itemId: number; userId: number },
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM user_item WHERE item_id = ? AND user_id = ?')
    .bind(params.itemId, params.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
