/**
 * Leaf module: the closed sets the rest of the package builds on.
 *
 * These live here rather than in index.ts so `schemas.ts` can import them
 * without a cycle — index.ts re-exports schemas.ts, so if schemas.ts imported
 * back from index.ts the constants would still be undefined when zod tried to
 * build enums out of them at module-init time.
 */

export const ROLES = ['owner', 'rater', 'pending'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every catalog row is one of these. A base game is the root of a tree; every
 * other kind hangs off it. See docs/DESIGN.md §6.
 */
export const ITEM_KINDS = ['base', 'expansion', 'accessory', 'promo', 'upgrade'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const COPY_STATUSES = ['owned', 'wanted', 'preordered', 'lent', 'sold'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

/**
 * Whether a copy is a thing or a licence.
 *
 * Every D&D Beyond book is the second: owning the Monster Manual digitally
 * answers "do we have it" and not "can it be handed across the table". Added by
 * migration 0015; `physical` is the default and covers all 564 board-game rows.
 */
export const COPY_FORMATS = ['physical', 'digital'] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

/**
 * How many game trees one page of the collection holds.
 *
 * Fixed on the server rather than sent by the client: the cost being paged is
 * assembling whole trees, and one group can be a base game with fifty-three
 * books under it. Letting a caller ask for 500 would hand it the exact payload
 * this exists to prevent.
 *
 * 25 because a group is a card, not a row — at a phone's width a card runs two
 * to three lines even collapsed, so 25 is already a long scroll, and 107 groups
 * lands in five pages rather than a paging exercise of its own.
 */
export const COLLECTION_PAGE_SIZE = 25;

/**
 * Research source priority: official publisher first, then crowdfunding, then
 * retail. `community` covers BGG itself. Lower index wins on conflict.
 */
export const SOURCE_TIERS = ['official', 'crowdfunding', 'retail', 'community'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

/**
 * How two standalone items relate to each other without nesting.
 * - same_family: the same game reworked — a different setting or ruleset built
 *   on the same bones, by the same publisher. Catan: New Energies and CATAN:
 *   Starfarers are Catan games you can play without owning Catan.
 * - works_with: standalone games that combine (Dice Throne characters, Unmatched fighters)
 * - reimplements: a newer standalone version of an older game
 * - integrates_with: can be combined with another standalone game
 * - requires: you cannot use this without owning that. A 5e supplement and the
 *   Player's Handbook. `works_with` is the near miss and is wrong — it implies
 *   optional compatibility — and nesting is wrong too, because Auroboros is not
 *   *part of* D&D, it is a separate product with a hard dependency.
 *
 * `same_family` is first because it is the common case in a real collection and
 * the one the others were being stretched to cover. Starfarers does not *work
 * with* Catan — you cannot shuffle them together — and calling it a
 * reimplementation overstates it. It is simply another Catan.
 *
 * `requires` is the only directional one — see DIRECTIONAL_RELATIONS below.
 */
export const RELATION_TYPES = [
  'same_family',
  'works_with',
  'reimplements',
  'integrates_with',
  'requires',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/**
 * Relations where which item is `from` and which is `to` carries meaning.
 *
 * Everything else here is a claim about a pair and reads the same from either
 * end, so `createRelation` normalises the two ids into a stable order to make
 * the unique index catch duplicates whichever way round they are offered. That
 * normalisation would destroy a `requires`: the supplement requires the core
 * book, never the reverse, and a stored link that had been silently flipped
 * would have the Player's Handbook announcing it cannot be used without one of
 * its own supplements.
 *
 * `reimplements` arguably belongs here too — a newer game reimplements an older
 * one, not both ways — but no code reads its direction today and flipping the
 * existing rows is not this change's job.
 */
export const DIRECTIONAL_RELATIONS: readonly RelationType[] = ['requires'];
