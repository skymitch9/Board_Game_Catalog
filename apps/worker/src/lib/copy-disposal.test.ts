/**
 * The status/disposal pairing rule, and the words a person is shown for it.
 *
 * Three things must hold, and each is a real failure this pins rather than a
 * restatement of the code:
 *
 * 1. ⚠️ **A given-away copy is NEVER shown the word "sold".** It is stored as
 *    `sold` because SQLite cannot widen a CHECK constraint without rebuilding
 *    `copy` (migration 0029's header) — a storage decision the owner should
 *    never see. `copyStateLabel` is the only thing standing between that
 *    decision and a screen that lies about what happened to his game.
 * 2. ⚠️ **Invalid pairs are REJECTED, not corrected.** The tempting shortcut —
 *    nulling the disposal when the status moves off `sold` — silently discards
 *    something the caller sent. Every case below asserts a refusal.
 * 3. **The refusal is a sentence.** Estate rule: a person must never see a bare
 *    status. `disposalConflict` returns the words, not a boolean, so the 400
 *    has something to say.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COPY_STATUSES,
  DISPOSALS,
  DISPOSED_STATUS,
  copyStateLabel,
  createCopySchema,
  disposalConflict,
  isDisposedStatus,
  updateCopySchema,
  type CopyStatus,
} from '@bgc/core';

/** The fields a create needs before zod's defaults fill the rest in. */
const MINIMAL = { quantity: 1, format: 'physical' as const, isSleeved: false, isPunched: false };

describe('disposalConflict — the pairing rule', () => {
  it('a still-ours copy with no reason is fine', () => {
    for (const status of COPY_STATUSES.filter((s) => s !== DISPOSED_STATUS)) {
      assert.equal(disposalConflict(status, null), null, status);
      assert.equal(disposalConflict(status, undefined), null, status);
    }
  });

  it('"no longer ours" with each of the three reasons is fine', () => {
    for (const d of DISPOSALS) {
      assert.equal(disposalConflict(DISPOSED_STATUS, d), null, d);
    }
  });

  it('⚠️ "no longer ours" with NO reason is refused, in words', () => {
    const message = disposalConflict(DISPOSED_STATUS, null);
    assert.ok(message, 'must refuse');
    // "gone, no idea why" is what the design doc calls worse than doing
    // nothing — the message has to ask the actual question.
    assert.match(message, /sold/);
    assert.match(message, /given away/);
    assert.match(message, /lost/);
  });

  it('⚠️ a reason on a copy that is still ours is refused, and NAMES the status', () => {
    for (const status of COPY_STATUSES.filter((s) => s !== DISPOSED_STATUS)) {
      const message = disposalConflict(status, 'given_away');
      assert.ok(message, `${status} + given_away must refuse`);
      assert.match(message, new RegExp(status), 'the message must say which status');
      // Underscores are storage, not English.
      assert.match(message, /given away/);
    }
  });
});

describe('createCopySchema — rejects, never strips', () => {
  it('accepts an ordinary owned copy', () => {
    assert.ok(createCopySchema.safeParse({ ...MINIMAL, status: 'owned' }).success);
  });

  it('accepts a disposal with a reason, and keeps the reason', () => {
    const parsed = createCopySchema.safeParse({
      ...MINIMAL,
      status: DISPOSED_STATUS,
      disposal: 'lost',
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.disposal, 'lost');
  });

  it('⚠️ refuses a disposal with no reason — it does not default one in', () => {
    const parsed = createCopySchema.safeParse({ ...MINIMAL, status: DISPOSED_STATUS });
    assert.equal(parsed.success, false);
  });

  it('⚠️ refuses a reason on an owned copy — it does not silently drop it', () => {
    const parsed = createCopySchema.safeParse({
      ...MINIMAL,
      status: 'owned',
      disposal: 'sold',
    });
    assert.equal(parsed.success, false, 'stripping the field would be the wrong fix');
  });

  it('refuses a reason that is not one of the three', () => {
    const parsed = createCopySchema.safeParse({
      ...MINIMAL,
      status: DISPOSED_STATUS,
      disposal: 'donated',
    });
    assert.equal(parsed.success, false);
  });
});

describe('updateCopySchema — the partial half', () => {
  /*
    ⚠️ This schema deliberately does NOT enforce the pairing rule, and that is
    the point of the route-level check. A PATCH may legitimately carry one half:
    `{ status: 'sold' }` is fine against a row that already has a reason, and
    identical to the body that is not fine against a row that does not. Only the
    merge can tell them apart — see `disposalConflict`'s own comment, and the
    route in apps/worker/src/routes/catalog.ts.
  */
  it('accepts one half on its own — the route decides, not the schema', () => {
    assert.ok(updateCopySchema.safeParse({ status: DISPOSED_STATUS }).success);
    assert.ok(updateCopySchema.safeParse({ disposal: 'given_away' }).success);
  });

  it('⚠️ an explicit null disposal parses — it means "it is ours again"', () => {
    const parsed = updateCopySchema.safeParse({ status: 'owned', disposal: null });
    assert.ok(parsed.success);
    // The key must SURVIVE parsing: `updateCopy` distinguishes an absent key
    // ("leave it alone") from a null one ("clear it") with `in`, and a schema
    // that dropped the null would turn a correction into a no-op.
    assert.ok('disposal' in parsed.data);
    assert.equal(parsed.data.disposal, null);
  });

  it('still refuses an empty body', () => {
    assert.equal(updateCopySchema.safeParse({}).success, false);
  });

  it('carries disposal details through without putting them on the copy', () => {
    const parsed = updateCopySchema.safeParse({
      status: DISPOSED_STATUS,
      disposal: 'sold',
      disposalDetails: { counterpart: 'Dave', priceCents: 2500, note: 'at the meetup' },
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.disposalDetails?.priceCents, 2500);
  });

  it('refuses a negative price', () => {
    assert.equal(
      updateCopySchema.safeParse({ disposalDetails: { priceCents: -1 } }).success,
      false,
    );
  });
});

describe('⚠️ what the owner is shown', () => {
  it('a given-away copy never reads "sold"', () => {
    const label = copyStateLabel(DISPOSED_STATUS, 'given_away');
    assert.equal(label, 'given away');
    assert.equal(/sold/.test(label), false, 'this is the whole cost of the storage decision');
  });

  it('a sold copy reads "sold", and a lost one "lost"', () => {
    assert.equal(copyStateLabel(DISPOSED_STATUS, 'sold'), 'sold');
    assert.equal(copyStateLabel(DISPOSED_STATUS, 'lost'), 'lost');
  });

  it('a disposed copy with no reason reads honestly rather than guessing', () => {
    // The route refuses to create one, but a row written before this shipped
    // could exist, and "no longer ours" is true of all three.
    assert.equal(copyStateLabel(DISPOSED_STATUS, null), 'no longer ours');
  });

  it('every other status reads as itself', () => {
    for (const status of COPY_STATUSES.filter((s) => s !== DISPOSED_STATUS)) {
      assert.equal(copyStateLabel(status, null), status);
    }
  });

  it('every status has a label, and only `sold` differs from its stored value', () => {
    for (const status of COPY_STATUSES) {
      const label = copyStateLabel(status as CopyStatus, null);
      assert.ok(label.length > 0, status);
      assert.equal(label !== status, status === DISPOSED_STATUS, status);
    }
  });

  it('isDisposedStatus names exactly one status', () => {
    assert.deepEqual(COPY_STATUSES.filter(isDisposedStatus), [DISPOSED_STATUS]);
  });
});
