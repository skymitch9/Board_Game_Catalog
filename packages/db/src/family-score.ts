/**
 * Gathering the family a score is rolled up over.
 *
 * The arithmetic — the weights, the two-stage mean, the decision behind them —
 * is in `packages/core/src/family-score.ts` and **only** there. This file is
 * the one query that decides *which rows are in the family*, which is the half
 * that needs the database.
 *
 * ## What counts as one family, and why it is two things unioned
 *
 * The catalog expresses "belongs together" in two different ways, and a family
 * score that used only one of them would answer half the question:
 *
 * 1. **Containment** — `parent_item_id` / `root_game_id`. Seafarers is *inside*
 *    Catan; it is not a separate entry. This is where expansions, accessories,
 *    promos and upgrades live, so it is where most of the tail comes from.
 * 2. **`same_family` relations** — `item_relation`, and **transitive**, exactly
 *    as `getRelatedItems` treats it. Starfarers is its own top-level entry and
 *    still a Catan; link Starfarers to Catan and New Energies to Catan and all
 *    three are one family with no row between the outer two.
 *
 * So the closure is walked over **ROOTS, not rows**: start at the root of the
 * item asked about, and for any row in any tree already in the family, follow
 * its `same_family` links and add the root of whatever they reach.
 *
 * ⚠️ **Walking the links row-by-row and folding up to roots afterwards is the
 * near miss, and it is wrong.** A link can be attached to a NESTED row as
 * easily as to the top of a tree — the `/retag` flow writes it against the row
 * in front of you — so a closure seeded with only the clicked row and its root
 * never sees a link that hangs off a sibling expansion, and silently returns
 * half the family. That is a test in `packages/db/test/family-score.test.ts`,
 * and it went red before this query was written this way round.
 *
 * ⚠️ `root_game_id` is nullable, so every comparison is on
 * `COALESCE(root_game_id, id)` — a root row is its own root. Reading the column
 * raw would drop every un-nested game out of its own family.
 *
 * ⚠️ The `requires` / `works_with` / `reimplements` / `integrates_with`
 * relations are deliberately NOT walked. Auroboros requires the Player's
 * Handbook; it is not a D&D book, and averaging its rating into D&D's family
 * would be a false statement about both.
 */

import { computeFamilyScore, type FamilyMemberRatings, type FamilyScore } from '@bgc/core';

/**
 * Every row of the family, with every rating anybody gave it.
 *
 * One query and one LEFT JOIN rather than a query per member: a Dice Throne
 * family runs to about fifty-five rows, and the item page already costs a
 * batch of three.
 */
const FAMILY_RATINGS_SQL = `WITH RECURSIVE
  roots(id) AS (
    SELECT COALESCE(root_game_id, id) FROM item WHERE id = ?1
    UNION
    SELECT COALESCE(j.root_game_id, j.id)
      FROM roots r
      JOIN item i ON COALESCE(i.root_game_id, i.id) = r.id
      JOIN item_relation rel
        ON (rel.from_item_id = i.id OR rel.to_item_id = i.id)
       AND rel.relation = 'same_family'
      JOIN item j
        ON j.id = CASE WHEN rel.from_item_id = i.id THEN rel.to_item_id ELSE rel.from_item_id END
  )
SELECT i.id AS item_id, i.kind AS kind, ui.rating AS rating
  FROM item i
  LEFT JOIN user_item ui ON ui.item_id = i.id
 WHERE COALESCE(i.root_game_id, i.id) IN (SELECT id FROM roots)
 ORDER BY i.id`;

/** The rows of one family, grouped per item. Exported for the SQL's own test. */
export async function getFamilyMembers(
  db: D1Database,
  itemId: number,
): Promise<FamilyMemberRatings[]> {
  const { results } = await db
    .prepare(FAMILY_RATINGS_SQL)
    .bind(itemId)
    .all<{ item_id: number; kind: string; rating: number | null }>();

  // The LEFT JOIN fans one item out across its raters, so the rows are grouped
  // back per item here — the roll-up is a mean of means, and an item two people
  // rated must not weigh twice as much as one only the owner rated.
  const byItem = new Map<number, FamilyMemberRatings>();
  for (const row of results) {
    let member = byItem.get(row.item_id);
    if (!member) {
      member = { itemId: row.item_id, kind: row.kind, ratings: [] };
      byItem.set(row.item_id, member);
    }
    // A LEFT JOIN miss (nobody has ever opened a rating row for this item) is
    // not the same as a stored null rating, but both mean "no score from this
    // person" and `computeFamilyScore` filters nulls either way. What matters
    // is that the item still appears, so `members` counts it.
    if (row.rating !== null) member.ratings.push(row.rating);
  }
  return [...byItem.values()];
}

/**
 * The family score for the item at `itemId` — derived on read, never stored.
 *
 * Always returns a `FamilyScore`; a family nobody has rated scores `null`,
 * which is not a zero. An item that does not exist comes back as an empty
 * family (0 members) rather than throwing — the only caller has already
 * resolved the item.
 */
export async function getFamilyScore(db: D1Database, itemId: number): Promise<FamilyScore> {
  return computeFamilyScore(await getFamilyMembers(db, itemId));
}
