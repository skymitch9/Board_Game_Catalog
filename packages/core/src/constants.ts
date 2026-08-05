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
