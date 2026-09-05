/**
 * The family score — "how good is Catan *as a whole*", derived, never stored.
 *
 * ## The decision behind this file
 *
 * Asked by the owner 2026-08-05, answered 2026-09-05: **(a) the base-weighted
 * mean.** The write-up and the two rejected options are in
 * `docs/info/design-decisions.md`; the short version is that the three numbers
 * worth seeing are the base game's rating, the expansion's rating, and one
 * number for the family — and a *plain* mean is the wrong third number, because
 * one poor accessory drags a great game down. Option (b) (average `base` +
 * `expansion` and drop the rest) was not chosen: a genuinely bad playmat is a
 * real fact about owning the family, it just is not worth as much as the box.
 * Option (c) (a family rating people type in by hand) needs a schema change and
 * a habit; this needs neither, and can still become explicit later.
 *
 * ⚠️ **Nothing here is persisted.** Ratings are per person per item
 * (`user_item`), the family is per relation (`item_relation`), and this is a
 * roll-up over both, computed on read. There is no migration and no
 * `family_score` column — a stored copy would be indistinguishable from a
 * number somebody chose, and would go stale the moment anyone rated anything.
 *
 * ## The two-stage mean, and why it is two stages
 *
 * 1. **Per item**, the mean of every person's rating of it. Ratings are the one
 *    per-person thing in a jointly-owned collection (`Ratings.tsx`), so an item
 *    two people rated must not count twice as hard as one only the owner rated.
 *    Pooling every `user_item` row into one weighted mean would do exactly
 *    that.
 * 2. **Across the family**, the mean of those item scores weighted by KIND.
 *
 * A `null` rating with notes is legitimate — *"played it, no strong opinion,
 * here's why"* — and must never be read as a zero. It is filtered out, and an
 * item with nothing but null ratings contributes no score while still counting
 * as a member.
 */

import type { ItemKind } from './constants.js';

/**
 * What each kind of row is worth in the family's mean.
 *
 * The ratio that matters is **base : accessory = 6 : 1**. Concretely, with a
 * 5-star base game:
 *
 * | The family | Score | Why it reads right |
 * |---|---|---|
 * | base 5, nothing else rated | **5.0** | one rated thing, no roll-up to do |
 * | base 5 + a 0.5-star playmat | **4.36** | the tat is visible, and costs ⅔ of a star — not two |
 * | base 5 + three 3-star expansions | **4.0** | expansions are content; three of them genuinely move it |
 * | base 5 + five 0.5-star promos | **2.95** | five bad things is a real signal, not noise |
 *
 * The third row is the reason `expansion` is not 1: an expansion is content for
 * the same table, and a family of a great box and three mediocre expansions is
 * a mediocre family. The second row is the requirement from the write-up made
 * arithmetic — *"a plain mean lets one poor accessory drag a great game down,
 * which is wrong"* — and it is pinned as a test: one bad accessory may cost a
 * 5-star base **less than a whole star**. A plain mean scores that family 2.75.
 *
 * `upgrade`, `accessory` and `promo` share a weight deliberately. They are the
 * long tail (the catalog holds 221 accessories against 186 expansions) and
 * splitting them further would be a distinction nobody could predict from the
 * number. If one of them ever needs its own weight, change it here — this table
 * is the only place the ratio exists.
 *
 * Typed as a total `Record<ItemKind, …>`, so adding a sixth kind to
 * `ITEM_KINDS` fails the typecheck here rather than silently defaulting.
 */
export const FAMILY_KIND_WEIGHTS: Record<ItemKind, number> = {
  base: 6,
  expansion: 2,
  upgrade: 1,
  accessory: 1,
  promo: 1,
};

/**
 * What a row whose `kind` is not in `ITEM_KINDS` is worth.
 *
 * ⚠️ Today nothing can be stored outside the enum — `item.kind` carries a CHECK
 * constraint naming the five (migration 0001). This is the belt to that
 * braces: a sixth kind arrives as a migration, and a migration deployed a few
 * minutes ahead of the code that knows about it (which is the mandated order)
 * would otherwise meet a `undefined` weight and produce `NaN` for the whole
 * family. Weighted as the long tail rather than dropped, because scoring an
 * unrecognised row at zero weight would hide it rather than show it.
 */
export const FAMILY_UNKNOWN_KIND_WEIGHT = 1;

/** The weight for a `kind` as stored — tolerant of a value outside the enum. */
export function familyKindWeight(kind: string): number {
  const known = (FAMILY_KIND_WEIGHTS as Record<string, number | undefined>)[kind];
  return known ?? FAMILY_UNKNOWN_KIND_WEIGHT;
}

/** One row of the family, with every person's rating of it. */
export interface FamilyMemberRatings {
  itemId: number;
  /** As stored. Anything outside `ITEM_KINDS` gets `FAMILY_UNKNOWN_KIND_WEIGHT`. */
  kind: string;
  /** Every `user_item.rating` for this item. `null` = rated with notes only. */
  ratings: (number | null)[];
}

/**
 * The family's one number, plus enough context for a surface to explain it.
 *
 * `members` and `rated` are both here because they answer different questions:
 * "how big is this family" and "how much of it has anybody actually rated". A
 * 4.8 over 2 of 19 rows is a different claim from a 4.8 over 19 of 19, and a UI
 * that shows the number without the second figure is overstating it.
 */
export interface FamilyScore {
  /**
   * The base-weighted mean, on the same 0.5–5 scale as a rating, to 2 dp.
   *
   * `null` when nothing in the family carries a rating — which is NOT a zero
   * and must never be rendered as one.
   */
  score: number | null;
  /** Rows in the family, rated or not. Always ≥ 1: an item is its own family. */
  members: number;
  /** Rows that contributed — at least one non-null rating. */
  rated: number;
  /**
   * Whether the family contains a `base` row at all.
   *
   * A family of nothing but expansions is legal (an orphan expansion whose base
   * game is not catalogued) and its score is then a mean of the tail with no
   * anchor. The flag exists so a surface can decline to call that "the family
   * score" without re-deriving it from the members.
   */
  hasBase: boolean;
}

/**
 * Below this many rated rows, the family score is not worth showing.
 *
 * At 1 it is arithmetically identical to the single rating it was computed
 * from, so a surface would print the same number twice under two headings and
 * invite the reader to believe two things had been measured. 2 is the smallest
 * family that is actually a roll-up.
 */
export const FAMILY_SCORE_MIN_RATED = 2;

/**
 * Whether a surface should render this score at all — the ONE place that rule
 * lives, so the page and its test cannot disagree about it.
 */
export function isFamilyScoreWorthShowing(family: FamilyScore): boolean {
  return family.score !== null && family.rated >= FAMILY_SCORE_MIN_RATED;
}

/** The mean of an item's own per-person ratings, or null if nobody scored it. */
function ownScore(ratings: (number | null)[]): number | null {
  const scored = ratings.filter((r): r is number => r !== null);
  if (scored.length === 0) return null;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

/** Two decimal places — enough to distinguish 4.36 from 4.43, and no float dust. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The canonical roll-up. **The only implementation** — the SQL that gathers the
 * family lives in `packages/db/src/family-score.ts` and calls straight into
 * this; nothing else may compute a family score.
 */
export function computeFamilyScore(members: FamilyMemberRatings[]): FamilyScore {
  let weighted = 0;
  let weight = 0;
  let rated = 0;

  for (const member of members) {
    const own = ownScore(member.ratings);
    if (own === null) continue;
    const w = familyKindWeight(member.kind);
    weighted += own * w;
    weight += w;
    rated += 1;
  }

  return {
    score: weight > 0 ? round2(weighted / weight) : null,
    members: members.length,
    rated,
    hasBase: members.some((m) => m.kind === 'base'),
  };
}
