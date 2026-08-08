/**
 * The other names one game answers to.
 *
 * *"Settlers of Catan and Catan are the same game — the studio just did a naming
 * thing... maybe we figure out a solution for games that are the same but have
 * alternate names."* — the owner. `migrations/0021_item_alias.sql` carries the
 * design argument, including why matching on `bgg_id` was measured and rejected
 * (the two Catan rows carried 13 and 152959) and why the similarity floor must
 * not be lowered to reach this case.
 *
 * Reading is the hot path: every scan request folds the whole table in memory
 * alongside every item name, exactly as `listItemNames` is already folded. The
 * matching rules — a real name beats an alias, a contested alias belongs to
 * nobody, aliases never take part in containment — all live in `buildTitleIndex`
 * and `matchIndexedTitle` in `packages/core/src/vision.ts`, so there is one
 * implementation and this module only ever moves rows.
 */

import type { ItemAliasRef } from '@bgc/core';

export interface ItemAlias {
  id: number;
  itemId: number;
  alias: string;
  source: 'bgg' | 'manual';
  createdAt: string;
}

/**
 * Every alias in the catalog, for building a matcher index.
 *
 * One read per request, like `listItemNames`. Deliberately not filtered by item
 * — the caller is asking about a whole catalog, and a per-item round trip is the
 * cost `TitleIndex` exists to avoid.
 */
export async function listItemAliases(db: D1Database): Promise<ItemAliasRef[]> {
  const { results } = await db
    .prepare('SELECT item_id, alias FROM item_alias ORDER BY item_id')
    .all<{ item_id: number; alias: string }>();
  return results.map((r) => ({ itemId: r.item_id, alias: r.alias }));
}

/** One game's alternate names, for its own page. */
export async function aliasesForItem(db: D1Database, itemId: number): Promise<ItemAlias[]> {
  const { results } = await db
    .prepare(
      `SELECT id, item_id, alias, source, created_at FROM item_alias
        WHERE item_id = ?1 ORDER BY source, alias`,
    )
    .bind(itemId)
    .all<{ id: number; item_id: number; alias: string; source: 'bgg' | 'manual'; created_at: string }>();
  return results.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    alias: r.alias,
    source: r.source,
    createdAt: r.created_at,
  }));
}

/**
 * Record an alias a person typed.
 *
 * `source` defaults to `manual` in the schema and is passed explicitly here so
 * the one caller that imports cannot get it wrong by omission. A repeat is not
 * an error — somebody adding the name they already added means the same thing
 * the second time.
 */
export async function addItemAlias(
  db: D1Database,
  itemId: number,
  alias: string,
  source: 'bgg' | 'manual' = 'manual',
): Promise<boolean> {
  const trimmed = alias.trim();
  if (!trimmed) return false;
  const res = await db
    .prepare(
      `INSERT INTO item_alias (item_id, alias, source) VALUES (?1, ?2, ?3)
       ON CONFLICT(item_id, alias) DO NOTHING`,
    )
    .bind(itemId, trimmed, source)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteItemAlias(db: D1Database, aliasId: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM item_alias WHERE id = ?1').bind(aliasId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Replace one item's imported aliases with what BoardGameGeek says today.
 *
 * ⚠️ **Only `source = 'bgg'` rows are cleared.** A name a person typed is an
 * answer, and an import that quietly deleted it would take the owner's word out
 * of the system on a schedule — the same mistake as overwriting a researched
 * cover with an inherited one. If BGG later offers a string a person already
 * typed, `ON CONFLICT DO NOTHING` leaves the manual row standing, which is the
 * right winner.
 *
 * Batched into one `db.batch` so a half-applied refresh cannot leave an item
 * with its old names deleted and its new ones missing.
 */
export async function replaceBggAliases(
  db: D1Database,
  itemId: number,
  aliases: readonly string[],
): Promise<number> {
  const clean = [...new Set(aliases.map((a) => a.trim()).filter((a) => a.length > 1))];

  const statements = [
    db.prepare("DELETE FROM item_alias WHERE item_id = ?1 AND source = 'bgg'").bind(itemId),
    ...clean.map((alias) =>
      db
        .prepare(
          `INSERT INTO item_alias (item_id, alias, source) VALUES (?1, ?2, 'bgg')
           ON CONFLICT(item_id, alias) DO NOTHING`,
        )
        .bind(itemId, alias),
    ),
  ];

  await db.batch(statements);
  return clean.length;
}

/**
 * "We asked, and this is what came back" — including *nothing*.
 *
 * Separate from the alias rows for the same reason `component_check` is separate
 * from `game_component`: a game with no alternate names is a real answer, and
 * without this the backfill would re-ask it on every run for ever.
 */
export async function recordAliasCheck(
  db: D1Database,
  itemId: number,
  bggId: number | null,
  offered: number,
  outcome: 'ok' | 'not_found' = 'ok',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO alias_check (item_id, checked_at, bgg_id, offered, outcome)
       VALUES (?1, datetime('now'), ?2, ?3, ?4)
       ON CONFLICT(item_id) DO UPDATE SET
         checked_at = excluded.checked_at,
         bgg_id     = excluded.bgg_id,
         offered    = excluded.offered,
         outcome    = excluded.outcome`,
    )
    .bind(itemId, bggId, offered, outcome)
    .run();
}

/**
 * Games worth asking BoardGameGeek about, never-asked first.
 *
 * Only rows that carry a `bgg_id` — there is nothing to ask about otherwise, and
 * a name search would reintroduce exactly the loose matching this feature exists
 * to avoid. That is the honest ceiling on the import: 128 of 802 rows today, and
 * it grows one row at a time as ids get typed in. Every other game's alternate
 * names have to come from a person, which is what `addItemAlias` is for.
 *
 * An item whose `bgg_id` has *changed* since the last check is re-offered, so
 * correcting a wrong id on the edit form re-opens the question by itself.
 */
export async function listItemsNeedingAliases(
  db: D1Database,
  limit: number,
): Promise<{ id: number; bggId: number; name: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.bgg_id, i.name
         FROM item i
         LEFT JOIN alias_check c ON c.item_id = i.id
        WHERE i.bgg_id IS NOT NULL
          AND (c.item_id IS NULL OR c.bgg_id IS NOT i.bgg_id)
        ORDER BY c.item_id IS NOT NULL, i.id
        LIMIT ?1`,
    )
    .bind(limit)
    .all<{ id: number; bgg_id: number; name: string }>();
  return results.map((r) => ({ id: r.id, bggId: r.bgg_id, name: r.name }));
}

export interface AliasCoverage {
  itemsWithBggId: number;
  itemsChecked: number;
  itemsOutstanding: number;
  aliasesStored: number;
  itemsWithAliases: number;
}

export async function aliasCoverage(db: D1Database): Promise<AliasCoverage> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM item WHERE bgg_id IS NOT NULL) AS with_bgg,
         (SELECT COUNT(*) FROM alias_check c JOIN item i ON i.id = c.item_id
           WHERE c.bgg_id IS i.bgg_id) AS checked,
         (SELECT COUNT(*) FROM item_alias) AS aliases,
         (SELECT COUNT(DISTINCT item_id) FROM item_alias) AS items_with`,
    )
    .first<{ with_bgg: number; checked: number; aliases: number; items_with: number }>();

  const withBgg = row?.with_bgg ?? 0;
  const checked = row?.checked ?? 0;
  return {
    itemsWithBggId: withBgg,
    itemsChecked: checked,
    itemsOutstanding: Math.max(0, withBgg - checked),
    aliasesStored: row?.aliases ?? 0,
    itemsWithAliases: row?.items_with ?? 0,
  };
}
