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
 *
 * `same_family` is first because it is the common case in a real collection and
 * the one the others were being stretched to cover. Starfarers does not *work
 * with* Catan — you cannot shuffle them together — and calling it a
 * reimplementation overstates it. It is simply another Catan.
 */
export const RELATION_TYPES = [
  'same_family',
  'works_with',
  'reimplements',
  'integrates_with',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
