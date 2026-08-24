/**
 * Leaf module: the closed sets the rest of the package builds on.
 *
 * These live here rather than in index.ts so `schemas.ts` can import them
 * without a cycle — index.ts re-exports schemas.ts, so if schemas.ts imported
 * back from index.ts the constants would still be undefined when zod tried to
 * build enums out of them at module-init time.
 */

/**
 * ⚠️ Mirrored by a CHECK constraint on `app_user.role` — migration 0027 is the
 * current definition. Adding a value here without a migration means the role is
 * assignable in the UI, passes zod, and then fails at the write with a bare
 * SQLITE_CONSTRAINT.
 *
 * ## The ladder (owner-approved 2026-08-16, "Role matrix approved")
 *
 * `guest < member < contributor < moderator < admin < owner` — cumulative: each
 * rung has everything the one below it has, plus more. See `ROLE_LADDER` below
 * for the ordering itself; this array stays in the original most-privileged-
 * first order because `ROLES` is what the federated admin surface
 * (`routes/admin.ts`) hands the People-page dropdown verbatim, and that
 * ordering is a UI convention older than the ladder.
 *
 * Migration 0027 renamed three existing roles and added two new rungs that
 * nobody is migrated into automatically:
 *
 *   `viewer`  -> `guest`        same rung, new name. Reads and nothing else —
 *                                it exists because `member` (nÃ©e `rater`), the
 *                                only other read-capable role, also carries
 *                                `rate`, and the people let in to look at the
 *                                collection were never being asked to score it.
 *   `rater`   -> `member`       same rung, new name. Read + rate + suggest the
 *                                wishlist ("I want this") — still cannot touch
 *                                the catalog.
 *   `manager` -> `moderator`    same rung, new name, same capability set as the
 *                                old `manager` plus the two new cost-gated scan
 *                                capabilities. Verified: old `manager`'s
 *                                CAPABILITY_MATRIX row is a strict subset of the
 *                                new `moderator` row — nobody who could do
 *                                something yesterday lost it today.
 *   (new)     `contributor`     nobody starts here; granted by hand. Can edit
 *                                the catalog and curate the wishlist, and can
 *                                scan barcodes (free) — but not photos (costs
 *                                money) and not `runResearch`.
 *   (new)     `admin`           nobody starts here; granted by hand, and only
 *                                by `owner` (see `canGrantRole` in
 *                                `capabilities.ts`). Everything `moderator` has,
 *                                plus `manageUsers` — but an `admin` may never
 *                                grant `admin` or `owner`, so there is exactly
 *                                one rung from which the guest list can be
 *                                widened at the top. `owner` is otherwise no
 *                                longer the sole `manageUsers` holder, which is
 *                                the one respect in which this supersedes the
 *                                0024 comment calling `manageUsers`
 *                                owner-exclusive — see capabilities.ts.
 *
 * `pending` is a **status**, not a rung — a fresh sign-in with nobody's
 * decision on them yet. It stays out of `ROLE_LADDER` and out of every
 * cumulative comparison; `canGrantRole` refuses it as a grant target for the
 * same reason `updateRoleSchema` is the only place it may still be assigned
 * (approving someone out of it, or revoking them back into it).
 */
export const ROLES = [
  'owner',
  'admin',
  'moderator',
  'contributor',
  'member',
  'guest',
  'pending',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * The ladder itself, ascending, least to most privileged — `pending` excluded
 * on purpose (see the note on `ROLES` above). This is the ordering
 * `canGrantRole` and any other cumulative comparison must use; `ROLES` is a
 * *display* order and must never be pressed into service for rank comparisons
 * — it is owner-first and pending-last, which is not a ladder.
 */
export const ROLE_LADDER = [
  'guest',
  'member',
  'contributor',
  'moderator',
  'admin',
  'owner',
] as const;
export type LadderRole = (typeof ROLE_LADDER)[number];

/**
 * Every catalog row is one of these. A base game is the root of a tree; every
 * other kind hangs off it. See docs/DESIGN.md §6.
 */
export const ITEM_KINDS = ['base', 'expansion', 'accessory', 'promo', 'upgrade'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const COPY_STATUSES = ['owned', 'wanted', 'preordered', 'lent', 'sold'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

/**
 * "Do we have this — should I stop looking for it?"
 *
 * The question completeness asks. `preordered` counts, deliberately: it is
 * money already spent on a box in the post, and putting it back on a shopping
 * list is how a thing gets bought twice. `lent` counts because a game at a
 * friend's house is still yours and is coming back.
 */
export const HELD_STATUSES: readonly CopyStatus[] = ['owned', 'lent', 'preordered'];

/**
 * "How many copies do we actually have?"
 *
 * The question the collection counts ask — owned copies, duplicates, the
 * physical/digital split. **The difference from `HELD_STATUSES` is exactly
 * `preordered`, and it is not an oversight:** a box that has not arrived is a
 * reason not to buy another, but it is not a copy you can count, sleeve or
 * hand across a table. Counting it would inflate "573 owned copies" with things
 * nobody has yet.
 *
 * ⚠️ These two were the *same* rule written out by hand in eight SQL clauses
 * across three files, in two different spellings, with nothing naming the
 * distinction — which is why the difference read as an inconsistency rather
 * than a decision. See `docs/info/copy-status-history.md` §2: adding a status
 * without one definition to change means adding it correctly in eight places,
 * and any miss is silent.
 *
 * ⚠️ There is a third rule, and it is also deliberate: `countOwnedCopies` in
 * `packages/db/src/copies.ts` counts **`owned` alone**. Its caller is a barcode
 * scan asking "do I already have this, and how many?", and a lent copy is not
 * one you can put on the table tonight.
 */
export const OWNED_COPY_STATUSES: readonly CopyStatus[] = ['owned', 'lent'];

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
 * What a `research_run` row can be a run *of*.
 *
 * Three of these name a source tier and one does not. `details` is the cheap
 * open-web pass behind "Fill in missing details" — one search, a handful of
 * facts printed on the box, written straight onto the item rather than staged
 * as findings. It is a different kind of run, not a fourth place to look, which
 * is why it is a separate list from `SOURCE_TIERS` rather than an addition to
 * it: nothing may treat 'details' as somewhere a claim came from.
 *
 * Must match the CHECK constraint in migration 0018.
 */
export const RUN_TIERS = ['official', 'crowdfunding', 'retail', 'details'] as const;
export type RunTier = (typeof RUN_TIERS)[number];

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

// ---------------------------------------------------------------------------
// Ratings — the 0.5–5 half-star scale, shared with the audiobook library
// ---------------------------------------------------------------------------

/**
 * ⚠️ This scale is DELIBERATELY the audiobook catalog's, not an independent
 * choice. The estate's two book sites store reviews in one shared collection on
 * a 0.5–5 half-star scale (audiobook `site/reviews.js` `renderStars` / the
 * `rating < 0.5 || rating > 5 || (rating * 2) % 1 !== 0` write guard; the
 * library's `packages/core` `RATING_MIN/MAX/STEP`). The board game catalog was
 * a lone 1–10 integer scale until 2026-08-24, when the owner asked for the two
 * catalogs to read the same. A "9 out of 10" and a "4.5 out of 5" mean the same
 * feeling but never the same number, so the fix is one scale everywhere, not a
 * translation layer — hence a migration that rescales the stored ratings once
 * (`migrations/0028_rating_half_star.sql`) rather than a display-time convert
 * that would leave two numbers to disagree.
 *
 * ⚠️ Mirrored by a CHECK constraint on `user_item.rating` — migration 0028 is
 * the current definition. Widening this without a migration means a value that
 * passes zod and then fails at the write with a bare SQLITE_CONSTRAINT.
 */
export const RATING_MIN = 0.5;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

/** Every selectable rating, low to high: 0.5, 1, 1.5, … 5. */
export const RATING_STEPS: readonly number[] = Array.from(
  { length: (RATING_MAX - RATING_MIN) / RATING_STEP + 1 },
  (_, i) => RATING_MIN + i * RATING_STEP,
);

/** True when `n` is a legal stored rating: within bounds and on a half-step. */
export function isHalfStarRating(n: number): boolean {
  return Number.isFinite(n) && n >= RATING_MIN && n <= RATING_MAX && (n * 2) % 1 === 0;
}

/**
 * Convert a legacy 1–10 integer board-game rating to the 0.5–5 half-star scale.
 *
 * The map is exact and lossless: `n / 2` sends 1→0.5, 2→1, … 10→5, and every
 * integer in 1–10 lands on a legal half-step, so nothing rounds and no two old
 * values collapse onto one new value. This is the SAME arithmetic the migration
 * runs in SQL (`rating / 2.0`); it lives here too so the mapping is unit-tested
 * (`apps/worker/src/lib/rating-scale.test.ts`) rather than trusted. `null`
 * (rated-with-notes-but-no-score) is carried through untouched.
 */
export function legacyRatingToHalfStar(n: number | null): number | null {
  return n === null ? null : n / 2;
}
