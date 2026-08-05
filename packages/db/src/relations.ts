/**
 * Item relations — standalone games that belong together without nesting.
 *
 * Dice Throne characters, Unmatched fighters, standalone expansions that can be
 * played alone but combine with a family. Each item keeps its own top-level
 * entry; the relation is a visible link, not containment.
 */

import type { RelatedItemRef, RelationType } from '@bgc/core';

export interface ItemRelation {
  id: number;
  fromItemId: number;
  toItemId: number;
  relation: RelationType;
}

/**
 * All items related to this one, in either direction.
 * If A works_with B, querying either A or B returns the other.
 */
export async function getRelatedItems(
  db: D1Database,
  itemId: number,
): Promise<RelatedItemRef[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id AS relation_id, i.id AS item_id, i.name, i.kind, i.thumbnail_url, r.relation
       FROM item_relation r
       JOIN item i ON i.id = CASE WHEN r.from_item_id = ?1 THEN r.to_item_id ELSE r.from_item_id END
       WHERE r.from_item_id = ?1 OR r.to_item_id = ?1
       ORDER BY i.name`,
    )
    .bind(itemId)
    .all<{
      relation_id: number;
      item_id: number;
      name: string;
      kind: string;
      thumbnail_url: string | null;
      relation: RelationType;
    }>();

  return results.map((r) => ({
    relationId: r.relation_id,
    itemId: r.item_id,
    name: r.name,
    kind: r.kind,
    thumbnailUrl: r.thumbnail_url,
    relation: r.relation,
  }));
}

/** Create a relation between two items. */
export async function createRelation(
  db: D1Database,
  fromItemId: number,
  toItemId: number,
  relation: RelationType,
): Promise<ItemRelation> {
  if (fromItemId === toItemId) {
    throw new RelationError('An item cannot relate to itself', 400);
  }

  // Normalise order so the unique constraint catches duplicates regardless of direction.
  const [lo, hi] = fromItemId < toItemId ? [fromItemId, toItemId] : [toItemId, fromItemId];

  const row = await db
    .prepare(
      `INSERT INTO item_relation (from_item_id, to_item_id, relation)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(from_item_id, to_item_id, relation) DO NOTHING
       RETURNING id, from_item_id, to_item_id, relation`,
    )
    .bind(lo, hi, relation)
    .first<{ id: number; from_item_id: number; to_item_id: number; relation: RelationType }>();

  if (!row) {
    // Already existed — fetch it.
    const existing = await db
      .prepare(
        `SELECT id, from_item_id, to_item_id, relation FROM item_relation
         WHERE from_item_id = ?1 AND to_item_id = ?2 AND relation = ?3`,
      )
      .bind(lo, hi, relation)
      .first<{ id: number; from_item_id: number; to_item_id: number; relation: RelationType }>();
    if (!existing) throw new RelationError('Could not create relation', 500);
    return {
      id: existing.id,
      fromItemId: existing.from_item_id,
      toItemId: existing.to_item_id,
      relation: existing.relation,
    };
  }

  return {
    id: row.id,
    fromItemId: row.from_item_id,
    toItemId: row.to_item_id,
    relation: row.relation,
  };
}

/** Remove a relation by its id. */
export async function deleteRelation(db: D1Database, relationId: number): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM item_relation WHERE id = ?1`)
    .bind(relationId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export class RelationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
