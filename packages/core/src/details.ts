/**
 * Which facts a catalog row owes, and which it may take from the box it came in.
 *
 * A leaf module, like `constants.ts`: it imports only from there, so `schemas.ts`
 * and the database layer can both build on it without reintroducing the cycle
 * that makes `z.enum()` receive `undefined`.
 *
 * ## Why this exists
 *
 * The details queue asked every row for the same six facts. Against a real
 * collection that is 694 items of which 79 are top-level — the other 615 are
 * expansions, promos, playmats and dice trays, each costing ~1.4¢ of Claude
 * usage to answer questions like *"who publishes the Dice Throne Vanguard dice
 * tray"*. The answer is "whoever publishes Dice Throne Vanguard", and it is
 * already in the database one row up.
 *
 * ## The two decisions, kept separate
 *
 * 1. **What a child may inherit** (`INHERITED_FIELDS`) — resolved at read time
 *    from the nearest ancestor that has a value. Nothing is written to the
 *    child's row: a stored copy would be indistinguishable later from a fact
 *    somebody actually verified, and would go stale the moment the parent was
 *    corrected. Reading it through is reversible and honest.
 * 2. **What a row is asked for at all** (`detailFieldsFor`) — the gap test the
 *    queue runs on. A field that inherits is never a gap on a child, and a field
 *    that is meaningless for a kind is never a gap either.
 *
 * ## The field-by-field reasoning
 *
 * | Field | Inherits | Demanded of |
 * |---|---|---|
 * | `publisher` | **yes** | items with no parent |
 * | `publisherUrl` | **yes** | items with no parent |
 * | `yearPublished` | no | base games |
 * | `minPlayers` | no | base games |
 * | `playtimeMin` | no | base games |
 * | `description` | no | base games |
 *
 * - **publisher / publisherUrl inherit.** The owner's instruction, verbatim:
 *   *"I dont super care if an expansion or accessory has a different
 *   publisher"*. It is also nearly always right — a promo pack is made by the
 *   people who make the game — and `publisherUrl` is what unblocks the official
 *   research tier, so inheriting it makes a child researchable for free.
 * - **yearPublished does not inherit.** An expansion published years after its
 *   base game is the common case, not the exception, and the year renders in the
 *   `<h1>` beside the name. A wrong year there is a visible false statement for
 *   a fact worth very little. Blank is better, so it is simply not asked for.
 * - **Player count and playing time do not inherit**, and this is the one that
 *   looks safe and is not. They describe *a game*: a dice tray has none, and an
 *   expansion mostly shares its base game's — except when it does not, and the
 *   exception is precisely the expansion that exists to change it. This catalog
 *   holds "Catan: Starfarers – 5-6 Player Extension"; inheriting 3–4 players
 *   onto it would be wrong in exactly the case anyone would look.
 * - **description never inherits.** A dice tray is not described by the base
 *   game's description. Copying it would be actively misleading rather than
 *   merely unhelpful.
 *
 * ## Why a child is asked for nothing
 *
 * Not "asked for the inheritable fields and usually satisfied": asked for
 * nothing. A child whose whole ancestry has no publisher is not fixed by
 * researching the child — it is fixed by researching the root, once, which then
 * answers for all fifty-three of its children. Queueing the children too would
 * pay fifty-three times for one answer.
 */

import { ITEM_KINDS, type ItemKind } from './constants.js';

/** The facts the details queue fills in. Ordered as they are reported. */
export const DETAIL_FIELDS = [
  'publisher',
  'publisherUrl',
  'yearPublished',
  'minPlayers',
  'playtimeMin',
  'description',
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** Field names as a person would say them. */
export const DETAIL_FIELD_LABEL: Record<DetailField, string> = {
  publisher: 'publisher',
  publisherUrl: 'publisher site',
  yearPublished: 'year',
  minPlayers: 'players',
  playtimeMin: 'playing time',
  description: 'description',
};

/**
 * The fields a blank child resolves from its nearest ancestor with a value.
 *
 * Deliberately short. Everything else on the list either describes a game being
 * played — which an accessory is not — or is wrong often enough that a blank is
 * the better answer. See the file header.
 */
export const INHERITED_FIELDS = ['publisher', 'publisherUrl'] as const;
export type InheritedField = (typeof INHERITED_FIELDS)[number];

/** Enough of an item to decide what it owes. Structural, so rows fit too. */
export interface DetailSubject {
  kind: ItemKind | string;
  parentItemId: number | null;
  publisher?: string | null;
  publisherUrl?: string | null;
  yearPublished?: number | null;
  minPlayers?: number | null;
  playtimeMin?: number | null;
  description?: string | null;
}

/**
 * The facts this kind of row is asked for.
 *
 * `hasParent` and not `kind === 'base'`, because the thing that makes a fact
 * free is having somewhere to inherit it from. An orphan expansion — one
 * catalogued before its game arrived — has no ancestor, so it is still asked for
 * a publisher; the day its game turns up and `adoptOrphans` re-parents it, it
 * stops being asked, with nothing to clean up.
 */
export function detailFieldsFor(kind: ItemKind | string, hasParent: boolean): DetailField[] {
  if (hasParent) return [];
  return kind === 'base' ? [...DETAIL_FIELDS] : [...INHERITED_FIELDS];
}

/** True for null, undefined, and a string of nothing but spaces. */
export function isBlankDetail(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/** What this row is asked for and does not have. Empty means "not in the queue". */
export function detailGaps(item: DetailSubject): DetailField[] {
  return detailFieldsFor(item.kind, item.parentItemId != null).filter((field) =>
    isBlankDetail(item[field]),
  );
}

/**
 * Every kind that can be asked for something, with what it is asked for.
 *
 * Exported so the SQL that runs this test over 736 rows can be *generated* from
 * the policy rather than restating it. A `WHERE` clause typed out by hand would
 * be a second implementation of the decision, and the two would drift the first
 * time a kind was added.
 */
export function detailGapBranches(): { kind: ItemKind; fields: DetailField[] }[] {
  return ITEM_KINDS.map((kind) => ({ kind, fields: detailFieldsFor(kind, false) })).filter(
    (b) => b.fields.length > 0,
  );
}

/** A value shown on a child that belongs to an ancestor, and where it came from. */
export interface InheritedDetail {
  value: string;
  fromItemId: number;
  fromName: string;
}
