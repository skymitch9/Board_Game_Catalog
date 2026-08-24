/**
 * The 0.5–5 half-star rating scale, and the lossless 1–10 → 0.5–5 conversion
 * that carries the existing board-game ratings onto it.
 *
 * Adopted 2026-08-24 so board-game ratings read the same number as audiobook
 * ratings (owner request). Three things must hold, and each is a real failure
 * mode this pins:
 *   - BOUNDS: the write schema accepts 0.5…5 and rejects 0, 5.5, 6, negatives —
 *     the domain the CHECK in migration 0028 also enforces.
 *   - HALF-STEPS: 2.5 is legal, 2.25 and 3.3 are not — the `multipleOf` guard,
 *     which min/max alone would wave a 2.25 straight through.
 *   - CONVERSION: every legacy integer 1–10 maps by ÷2 onto a legal half-step,
 *     1→0.5 and 10→5, with nothing lost, rounded, or two-values-into-one. This
 *     is the exact arithmetic migration 0028 runs in SQL (`rating / 2.0`).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  RATING_STEPS,
  isHalfStarRating,
  legacyRatingToHalfStar,
  upsertRatingSchema,
} from '@bgc/core';

describe('rating scale — bounds', () => {
  it('the scale is 0.5–5 in half-steps', () => {
    assert.equal(RATING_MIN, 0.5);
    assert.equal(RATING_MAX, 5);
    assert.equal(RATING_STEP, 0.5);
    assert.deepEqual([...RATING_STEPS], [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it('the schema accepts every legal step and null', () => {
    for (const v of RATING_STEPS) {
      assert.ok(upsertRatingSchema.safeParse({ rating: v, notes: null }).success, `${v} should pass`);
    }
    // null rating with notes is legitimate — "played it, no strong opinion".
    assert.ok(upsertRatingSchema.safeParse({ rating: null, notes: 'meh' }).success);
  });

  it('the schema rejects out-of-range values', () => {
    for (const v of [0, 0.25, -1, 5.5, 6, 10]) {
      assert.equal(
        upsertRatingSchema.safeParse({ rating: v, notes: null }).success,
        false,
        `${v} should be rejected`,
      );
    }
  });
});

describe('rating scale — half-step increments', () => {
  it('accepts half-steps, rejects finer granularity', () => {
    assert.ok(isHalfStarRating(2.5));
    assert.ok(isHalfStarRating(0.5));
    assert.ok(isHalfStarRating(5));
    assert.equal(isHalfStarRating(2.25), false);
    assert.equal(isHalfStarRating(3.3), false);
    // …and the schema agrees, because a 2.25 that min/max let through would
    // reach the DB and fail the CHECK with a bare constraint error.
    assert.equal(upsertRatingSchema.safeParse({ rating: 2.25, notes: null }).success, false);
    assert.ok(upsertRatingSchema.safeParse({ rating: 2.5, notes: null }).success);
  });
});

describe('rating conversion — legacy 1–10 → 0.5–5, lossless', () => {
  it('1→0.5 and 10→5 exactly (the endpoints)', () => {
    assert.equal(legacyRatingToHalfStar(1), 0.5);
    assert.equal(legacyRatingToHalfStar(10), 5);
  });

  it('every integer 1–10 lands on a legal half-step, and none collide', () => {
    const converted = Array.from({ length: 10 }, (_, i) => legacyRatingToHalfStar(i + 1)!);
    // On-scale: each result is a value the new schema accepts.
    for (const v of converted) {
      assert.ok(isHalfStarRating(v), `${v} must be a legal half-star`);
      assert.ok(upsertRatingSchema.safeParse({ rating: v, notes: null }).success);
    }
    // Lossless: ten distinct inputs → ten distinct outputs (nothing doubled or
    // dropped), and they are exactly the ten steps of the new scale.
    assert.equal(new Set(converted).size, 10);
    assert.deepEqual(converted, [...RATING_STEPS]);
  });

  it('carries a null (rated-with-notes-only) through untouched', () => {
    assert.equal(legacyRatingToHalfStar(null), null);
  });
});
