/**
 * The rules that exist ONCE — and the two places that had quietly written a
 * second copy out by hand.
 *
 * Both are 2026-08 audit findings of the same shape: a constant in
 * `constants.ts` is the single definition of a rule, and a function elsewhere
 * restated it as a literal. Nothing breaks *today*; what breaks is the day
 * somebody edits the constant, because the literal does not move with it and
 * nothing fails.
 *
 * - **Finding 9** — `ownedCount` hardcoded `status === 'owned' || 'lent'`
 *   instead of `OWNED_COPY_STATUSES`. Every SQL consumer counts through the
 *   constant, so a new held-like status would have been counted by the database
 *   and not by the collapsed base-game card: two numbers on one screen,
 *   disagreeing, with nothing red.
 * - **Finding 10** — `tierRank` rebuilt the `SOURCE_TIERS` ordering as an inline
 *   array literal cast to `readonly string[]`. The cast is what makes it
 *   dangerous: it strips the type safety that would otherwise have caught a
 *   rename, so reordering the constant would have left `outranks()` resolving
 *   research conflicts by the old priority, silently.
 *
 * ⚠️ **These assertions are written AGAINST THE CONSTANTS, never against
 * literals.** A test that says `ownedCount` counts `owned` and `lent` is a
 * third copy of the rule, and would pass on the broken code. Each case below
 * derives its expectation from the constant, so it moves when the constant
 * moves — which is the property the finding is about.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  COPY_STATUSES,
  OWNED_COPY_STATUSES,
  SOURCE_TIERS,
  type CopyStatus,
} from '../src/constants.js';
import { ownedCount } from '../src/schemas.js';
import { outranks, tierRank } from '../src/index.js';

/** One copy of `status`, with a quantity worth noticing. */
function copy(status: CopyStatus, quantity = 3) {
  return { id: 1, itemId: 1, status, quantity } as never;
}

describe('finding 9 — "held" has ONE definition, and ownedCount uses it', () => {
  it('counts every status in OWNED_COPY_STATUSES, whatever they are', () => {
    for (const status of OWNED_COPY_STATUSES) {
      assert.equal(
        ownedCount([copy(status)]),
        3,
        `${status} is in OWNED_COPY_STATUSES but ownedCount does not count it`,
      );
    }
  });

  it('counts NOTHING that is outside it, whatever they are', () => {
    const notHeld = COPY_STATUSES.filter((s) => !OWNED_COPY_STATUSES.includes(s));
    assert.ok(notHeld.length > 0, 'the catalog would be a strange place otherwise');
    for (const status of notHeld) {
      assert.equal(
        ownedCount([copy(status)]),
        0,
        `${status} is not in OWNED_COPY_STATUSES but ownedCount counts it`,
      );
    }
  });

  it('sums quantities across a mixed set, held only', () => {
    const held = OWNED_COPY_STATUSES.map((s) => copy(s, 2));
    const loose = COPY_STATUSES.filter((s) => !OWNED_COPY_STATUSES.includes(s)).map((s) =>
      copy(s, 5),
    );
    assert.equal(ownedCount([...held, ...loose]), OWNED_COPY_STATUSES.length * 2);
  });

  it('a missing quantity counts as one, not as nothing', () => {
    const [first] = OWNED_COPY_STATUSES;
    assert.equal(ownedCount([{ status: first, quantity: 0 } as never]), 1);
  });
});

/**
 * ⚠️ **Honest about what these three can and cannot catch.** Now that
 * `tierRank` reads `SOURCE_TIERS`, the first two are true by construction and
 * would not fail if the fix were reverted *today* — the literal happened to
 * match. What they pin is the RELATIONSHIP, so they fail the day the two
 * disagree, which is the defect: a reorder that leaves `outranks()` on the old
 * priority. The third is not a tautology at all — "lower index wins" is a real
 * claim about `outranks`, and reversing it would fail here.
 */
describe('finding 10 — the research priority order has ONE definition', () => {
  it('tierRank is SOURCE_TIERS\' own index, position by position', () => {
    SOURCE_TIERS.forEach((tier, i) => {
      assert.equal(tierRank(tier), i, `${tier} ranks ${tierRank(tier)}, but sits at ${i}`);
    });
  });

  it('every tier is known — none falls through to -1', () => {
    // The inline literal was cast to `readonly string[]`, so a renamed tier
    // would have type-checked and then ranked -1, which `outranks` reads as
    // "beats everything". A silent inversion, not an error.
    for (const tier of SOURCE_TIERS) {
      assert.ok(tierRank(tier) >= 0, `${tier} is not in the ranking at all`);
    }
  });

  it('outranks follows the constant end to end, pair by pair', () => {
    for (let i = 0; i < SOURCE_TIERS.length; i++) {
      for (let j = 0; j < SOURCE_TIERS.length; j++) {
        const a = SOURCE_TIERS[i]!;
        const b = SOURCE_TIERS[j]!;
        assert.equal(
          outranks(a, b),
          i < j,
          `${a} vs ${b}: outranks disagrees with the order in SOURCE_TIERS`,
        );
      }
    }
  });
});
