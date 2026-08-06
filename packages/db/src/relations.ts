/**
 * Item relations — standalone games that belong together without nesting.
 *
 * Dice Throne characters, Unmatched fighters, standalone expansions that can be
 * played alone but combine with a family. Each item keeps its own top-level
 * entry; the relation is a visible link, not containment.
 */

import type { RelatedItemRef, RelationType } from '@bgc/core';
import { DIRECTIONAL_RELATIONS } from '@bgc/core';

export interface ItemRelation {
  id: number;
  fromItemId: number;
  toItemId: number;
  relation: RelationType;
}

/**
 * All items related to this one, in either direction.
 *
 * `same_family` is treated as transitive, and the others are not. Family is a
 * statement about what a game *is* — link Starfarers to Catan and New Energies
 * to Catan, and all three are Catans, so opening any one of them should show
 * the other two. Making a person link every pair by hand to express that is
 * asking them to maintain a fact the data already implies.
 *
 * The rest stay direct. "Works with" is a claim about two specific boxes, and
 * A-works-with-B plus B-works-with-C does not make A work with C.
 *
 * Members reached through the family rather than by a link of their own carry
 * `relationId: null` — there is no single row to point at, which is exactly why
 * unlinking lives on the edit form and works on the links you actually made.
 */
export async function getRelatedItems(
  db: D1Database,
  itemId: number,
): Promise<RelatedItemRef[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE family(id) AS (
         SELECT ?1
         UNION
         SELECT CASE WHEN r.from_item_id = f.id THEN r.to_item_id ELSE r.from_item_id END
           FROM item_relation r
           JOIN family f ON r.from_item_id = f.id OR r.to_item_id = f.id
          WHERE r.relation = 'same_family'
       ),
       direct AS (
         SELECT r.id AS relation_id,
                CASE WHEN r.from_item_id = ?1 THEN r.to_item_id ELSE r.from_item_id END AS item_id,
                r.relation,
                -- Which end of the stored row we are looking from. Meaningless
                -- for the symmetric relations, and the entire meaning of a
                -- requires: the supplement is the from side.
                CASE WHEN r.from_item_id = ?1 THEN 1 ELSE 0 END AS outgoing
           FROM item_relation r
          WHERE r.from_item_id = ?1 OR r.to_item_id = ?1
       )
       SELECT i.id AS item_id, i.name, i.kind, i.thumbnail_url,
              d.relation_id AS relation_id,
              COALESCE(d.outgoing, 0) AS outgoing,
              COALESCE(d.relation, 'same_family') AS relation
         FROM item i
         LEFT JOIN direct d ON d.item_id = i.id
        WHERE i.id != ?1
          AND (i.id IN (SELECT id FROM family) OR d.item_id IS NOT NULL)
        ORDER BY i.sort_name`,
    )
    .bind(itemId)
    .all<{
      relation_id: number | null;
      item_id: number;
      name: string;
      kind: string;
      thumbnail_url: string | null;
      relation: RelationType;
      outgoing: number;
    }>();

  return results.map((r) => ({
    relationId: r.relation_id,
    itemId: r.item_id,
    name: r.name,
    kind: r.kind,
    thumbnailUrl: r.thumbnail_url,
    relation: r.relation,
    outgoing: r.outgoing === 1,
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

  /*
    Normalise order so the unique constraint catches duplicates regardless of
    direction — but only for the relations where direction carries no meaning.

    A `requires` stored the wrong way round is not a tidy duplicate, it is a
    false statement: sorting the ids would have the Player's Handbook (a low id,
    catalogued early) claiming it cannot be used without Auroboros. Directional
    relations are stored exactly as offered, and their unique index then treats
    A-requires-B and B-requires-A as two different rows, which they are.
  */
  const directional = DIRECTIONAL_RELATIONS.includes(relation);
  const [lo, hi] =
    directional || fromItemId < toItemId ? [fromItemId, toItemId] : [toItemId, fromItemId];

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
/**
 * Every link that exists, as unordered pairs.
 *
 * Used to stop the family suggester offering something already linked. Both
 * directions are returned because a link is bidirectional in meaning even
 * though it is stored once, and the suggester only asks "are these two
 * connected", never "which way round".
 */
export async function listRelationPairs(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT from_item_id, to_item_id FROM item_relation')
    .all<{ from_item_id: number; to_item_id: number }>();

  const pairs = new Set<string>();
  for (const r of results) {
    pairs.add(`${r.from_item_id}:${r.to_item_id}`);
    pairs.add(`${r.to_item_id}:${r.from_item_id}`);
  }
  return pairs;
}

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
