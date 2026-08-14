/**
 * The projection this catalog pushes to the shared index Worker
 * (catalog-platform/apps/index-worker — read its design doc,
 * catalog-platform/docs/info/index-worker-design.md, before widening this).
 *
 * ⚠️ DEFAULT-DENY, BY EXPLICIT ALLOW-LIST — never `SELECT *` minus exclusions.
 * The columns below are the complete list of what leaves this catalog, and
 * every one is display data or a pointer. NEVER exported: prices, vendors,
 * conditions, locations, `lent_to`, completeness notes, per-person ratings,
 * emails, acquisition dates. `export.ts` is the wrong wheel here on purpose —
 * that is a full backup that joins ratings to emails; this is a public-shaped
 * projection and is written fresh.
 *
 * Raw display strings only: the index folds join keys ON ITS SIDE, once, on
 * write. No fold code exists in this repo for the index, and none may be
 * added — one implementation, over there, pinned to the library's by
 * catalog-platform/data/match-fold.fixtures.json.
 *
 * ALL kinds go — base games, expansions, accessories, promos, upgrades —
 * carrying `kind` and `parent_item_id` (as `parent_source_id`), because "do I
 * own this in any format?" at the store is asked about expansions at least as
 * often as about base games. One row per catalogued thing (PLATFORM.md §2.2:
 * pointers, never truth); ownership status deliberately does NOT travel — the
 * index points at /items/:id and THIS catalog answers owned-versus-wanted.
 */

/** Where a lookup hit sends the visitor. The custom domain from wrangler.toml. */
export const SITE_ORIGIN = 'https://boardgames.heygabi.ai';

/** Matches the index's push-row contract (rows.ts there). */
export interface IndexProjectionRow {
  source_id: string;
  title: string;
  series: string | null;
  year: number | null;
  publisher: string | null;
  format: 'boardgame';
  kind: string;
  parent_source_id: string | null;
  cover_url: string | null;
  detail_url: string | null;
}

interface ProjectionSourceRow {
  id: number;
  kind: string;
  parent_item_id: number | null;
  name: string;
  series: string | null;
  year_published: number | null;
  publisher: string | null;
  thumbnail_url: string | null;
}

/**
 * Build the complete snapshot. Always the whole catalog — the index replaces
 * this source's rows wholesale on every push, which is what makes the
 * forgotten-re-run drift class structurally impossible.
 */
export async function buildIndexProjection(db: D1Database): Promise<IndexProjectionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, parent_item_id, name, series, year_published, publisher, thumbnail_url
         FROM item
        ORDER BY id`,
    )
    .all<ProjectionSourceRow>();

  return results.map((row) => ({
    source_id: String(row.id),
    title: row.name,
    series: row.series,
    year: row.year_published,
    publisher: row.publisher,
    // Every row is a physical board-game-shaped object; what KIND of object
    // (base/expansion/accessory/promo/upgrade) travels beside it. A board game
    // is never the same *work* as a book, so the index gives these rows
    // work_fold = NULL forever and they join cross-format only at the
    // universe tier.
    format: 'boardgame' as const,
    kind: row.kind,
    parent_source_id: row.parent_item_id === null ? null : String(row.parent_item_id),
    cover_url: row.thumbnail_url,
    detail_url: `${SITE_ORIGIN}/items/${row.id}`,
  }));
}
