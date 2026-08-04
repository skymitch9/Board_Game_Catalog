/**
 * Cheapest query that proves the binding is live and migrations have run.
 * Returns false rather than throwing so /api/health can report rather than 500.
 */
export async function isDatabaseReachable(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'app_user'`)
      .first<{ n: number }>();
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
