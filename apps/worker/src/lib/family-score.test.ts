/**
 * The family roll-up — the ARITHMETIC half.
 *
 * The owner asked on 2026-08-05 how a family's rating should be computed and
 * answered on 2026-09-05: **(a) the base-weighted mean**. The write-up is in
 * `docs/info/design-decisions.md`; the code is `packages/core/src/family-score.ts`.
 *
 * This file pins the properties that make (a) *the* answer rather than a mean
 * with a decoration, because each is a way the feature could ship looking right
 * and behaving wrong:
 *
 *   - ⚠️ **A poor accessory must not sink a great game.** That sentence is the
 *     whole reason a plain mean was rejected, and it is the one claim in the
 *     design that is checkable as a number. It is checked here against the
 *     plain mean it replaces.
 *   - ⚠️ **A null rating is "no opinion", never a zero.** `user_item.rating` is
 *     nullable on purpose — *"played it, no strong opinion, here's why"* — and
 *     reading one as 0 would be a silent, plausible-looking corruption of every
 *     score.
 *   - ⚠️ **An unrated family scores `null`, not 0.** A 0 would render as an
 *     empty five-star row and read as a verdict.
 *   - ⚠️ **Two people rating one box must not weigh it twice.** The roll-up is
 *     a mean of means for exactly this reason; pooling every `user_item` row is
 *     the obvious implementation and the wrong one.
 *
 * It lives under `apps/worker/src/lib/` rather than beside the code because
 * that glob is the one the deploy gate runs (see `item-view-render.test.ts`).
 * The SQL that decides *which rows are the family* is tested separately, against
 * a real SQLite with the migrations applied, in
 * `packages/db/test/family-score.test.ts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FAMILY_KIND_WEIGHTS,
  FAMILY_SCORE_MIN_RATED,
  FAMILY_UNKNOWN_KIND_WEIGHT,
  computeFamilyScore,
  familyKindWeight,
  isFamilyScoreWorthShowing,
  ITEM_KINDS,
  type FamilyMemberRatings,
} from '@bgc/core';

/** One family row. `ratings` is every person's score; `null` = notes only. */
function member(
  itemId: number,
  kind: string,
  ...ratings: (number | null)[]
): FamilyMemberRatings {
  return { itemId, kind, ratings };
}

/** The plain mean the design rejected — the comparison, not the implementation. */
function plainMean(members: FamilyMemberRatings[]): number {
  const all = members.flatMap((m) => m.ratings).filter((r): r is number => r !== null);
  return all.reduce((a, b) => a + b, 0) / all.length;
}

describe('family score — the weights are the decision, so they are pinned', () => {
  it('every item kind has a weight, and the order is base > expansion > tail', () => {
    for (const kind of ITEM_KINDS) {
      assert.equal(
        typeof FAMILY_KIND_WEIGHTS[kind],
        'number',
        `${kind} must have a weight — a missing one produces NaN for the whole family`,
      );
    }
    assert.ok(FAMILY_KIND_WEIGHTS.base > FAMILY_KIND_WEIGHTS.expansion);
    assert.ok(FAMILY_KIND_WEIGHTS.expansion > FAMILY_KIND_WEIGHTS.accessory);
    assert.equal(FAMILY_KIND_WEIGHTS.base / FAMILY_KIND_WEIGHTS.accessory, 6);
  });

  it('a kind outside the enum falls back to the tail weight, never to zero or NaN', () => {
    assert.equal(familyKindWeight('base'), FAMILY_KIND_WEIGHTS.base);
    assert.equal(familyKindWeight('miniatures-case'), FAMILY_UNKNOWN_KIND_WEIGHT);
    assert.ok(FAMILY_UNKNOWN_KIND_WEIGHT > 0);
    const f = computeFamilyScore([member(1, 'base', 5), member(2, 'sixth-kind', 1)]);
    assert.ok(f.score !== null && Number.isFinite(f.score));
  });
});

describe('family score — base only', () => {
  it('a lone rated base game scores exactly its own rating', () => {
    const f = computeFamilyScore([member(1, 'base', 4.5)]);
    assert.equal(f.score, 4.5);
    assert.equal(f.members, 1);
    assert.equal(f.rated, 1);
    assert.equal(f.hasBase, true);
  });

  it('two people rating the base average with each other, not against it', () => {
    // 5 and 4 → 4.5, and the base is still one voice in the family.
    assert.equal(computeFamilyScore([member(1, 'base', 5, 4)]).score, 4.5);
  });
});

describe('family score — base + expansions', () => {
  it('three 3-star expansions pull a 5-star base to exactly 4.0', () => {
    const family = [
      member(1, 'base', 5),
      member(2, 'expansion', 3),
      member(3, 'expansion', 3),
      member(4, 'expansion', 3),
    ];
    // (5×6 + 3×2 + 3×2 + 3×2) / (6 + 2 + 2 + 2) = 48 / 12
    assert.equal(computeFamilyScore(family).score, 4);
    assert.equal(computeFamilyScore(family).rated, 4);
  });

  it('an expansion outweighs an accessory — content counts for more than tat', () => {
    const withExpansion = computeFamilyScore([member(1, 'base', 5), member(2, 'expansion', 1)]);
    const withAccessory = computeFamilyScore([member(1, 'base', 5), member(2, 'accessory', 1)]);
    assert.ok(
      withExpansion.score! < withAccessory.score!,
      'a bad expansion must cost more than a bad playmat',
    );
  });

  it('⚠️ an item two people rated does not count twice — mean of means', () => {
    const oneVoice = computeFamilyScore([member(1, 'base', 5), member(2, 'expansion', 2)]);
    // Same expansion, same 2-star verdict, but two people said it.
    const twoVoices = computeFamilyScore([member(1, 'base', 5), member(2, 'expansion', 2, 2)]);
    assert.equal(twoVoices.score, oneVoice.score);
    assert.equal(twoVoices.rated, 2, 'still two RATED ITEMS, not three ratings');
  });
});

describe('family score — ⚠️ one poor accessory must not sink a great game', () => {
  // This is the requirement from the write-up, as arithmetic. The plain mean is
  // computed alongside so the test proves the weighting is doing work rather
  // than agreeing with the thing it replaced.
  const family = [member(1, 'base', 5), member(2, 'accessory', 0.5)];

  it('costs a 5-star base less than a whole star (the plain mean costs it 2.25)', () => {
    const f = computeFamilyScore(family);
    assert.equal(f.score, 4.36); // (5×6 + 0.5×1) / 7
    assert.ok(5 - f.score! < 1, 'a single bad accessory may not cost a whole star');
    assert.equal(plainMean(family), 2.75);
    assert.ok(f.score! > plainMean(family) + 1.5, 'the weighting must beat a plain mean, clearly');
  });

  it('but five bad promos DO move it — the tail is quiet, not silent', () => {
    const noisy = computeFamilyScore([
      member(1, 'base', 5),
      ...[2, 3, 4, 5, 6].map((id) => member(id, 'promo', 0.5)),
    ]);
    assert.equal(noisy.score, 2.95); // (30 + 5×0.5) / 11
    assert.ok(noisy.score! < 3.5, 'five bad things in a family is a real signal');
  });
});

describe('family score — missing ratings', () => {
  it('⚠️ a null rating (notes, no score) is not a zero', () => {
    const f = computeFamilyScore([member(1, 'base', 5), member(2, 'expansion', null)]);
    assert.equal(f.score, 5, 'the notes-only expansion must not drag anything');
    assert.equal(f.members, 2);
    assert.equal(f.rated, 1, 'it is a member, and it is not rated');
  });

  it('an unrated item counts as a member and contributes no score', () => {
    const f = computeFamilyScore([member(1, 'base', 4), member(2, 'accessory')]);
    assert.equal(f.score, 4);
    assert.equal(f.members, 2);
    assert.equal(f.rated, 1);
  });

  it('⚠️ a family nobody has rated scores null, NOT zero', () => {
    const f = computeFamilyScore([member(1, 'base'), member(2, 'expansion', null)]);
    assert.equal(f.score, null);
    assert.notEqual(f.score, 0);
    assert.equal(f.members, 2);
    assert.equal(f.rated, 0);
    assert.equal(f.hasBase, true);
  });

  it('an empty family is null too, and reports nothing rather than throwing', () => {
    assert.deepEqual(computeFamilyScore([]), {
      score: null,
      members: 0,
      rated: 0,
      hasBase: false,
    });
  });
});

describe('family score — a family with no base game', () => {
  it('scores over what there is, and says there was no base', () => {
    // An orphan expansion whose base game is not catalogued, plus its playmat.
    const f = computeFamilyScore([member(1, 'expansion', 4), member(2, 'accessory', 2)]);
    assert.equal(f.hasBase, false);
    assert.equal(f.score, 3.33); // (4×2 + 2×1) / 3
    assert.equal(f.rated, 2);
  });

  it('a base with no rating still sets hasBase — the flag is about the ROW', () => {
    const f = computeFamilyScore([member(1, 'base'), member(2, 'expansion', 4)]);
    assert.equal(f.hasBase, true);
    assert.equal(f.score, 4);
  });
});

describe('family score — when a surface may show it', () => {
  it('one rated row is not a roll-up, so it is not shown', () => {
    assert.equal(FAMILY_SCORE_MIN_RATED, 2);
    assert.equal(isFamilyScoreWorthShowing(computeFamilyScore([member(1, 'base', 5)])), false);
  });

  it('two rated rows is the smallest thing worth calling a family score', () => {
    assert.equal(
      isFamilyScoreWorthShowing(computeFamilyScore([member(1, 'base', 5), member(2, 'expansion', 3)])),
      true,
    );
  });

  it('an unrated family is never shown — there is no number to show', () => {
    assert.equal(
      isFamilyScoreWorthShowing(computeFamilyScore([member(1, 'base'), member(2, 'expansion')])),
      false,
    );
  });
});
