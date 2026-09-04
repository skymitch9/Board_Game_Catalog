/**
 * The scan-time SHELF/WISHLIST switch — the choice, its persistence, the status
 * it writes, and the words a row says afterwards.
 *
 * The owner's ask, 2026-09-04, from his phone, verbatim: *"let's add that when
 * you scan something you can add it to library or wishlist. Do this for both
 * games and the libraries."*
 *
 * ## ⚠️ THE PROPERTIES WORTH A TEST
 *
 *  1. **`shelf` is the default** — including when storage is empty, absent,
 *     unreadable, or holds a word this build has never offered. That is a
 *     compatibility promise, not a preference: it is what every scan has
 *     written since the barcode path existed, and a wishlist target that leaked
 *     into a later session would silently stop recording games that are
 *     physically in somebody's hands.
 *  2. **`copyStatusFor` yields only `owned` or `wanted`.** A barcode in a shop
 *     is not evidence of a payment (`preordered`), and `lent`/`sold` are things
 *     that happen to a copy you already have. The type says so; this pins the
 *     values.
 *  3. **A stored value is validated on read.** `sessionStorage` is
 *     user-writable and survives a build that offered different options.
 *  4. **Every label follows the target.** "Added" over a want would claim a
 *     game is on the shelf, and the shelf-photo screen's counted button is the
 *     one that adds the most rows at once.
 *
 * ⚠️ This is the first web test in this repo, and it is a `node:test` process:
 * it may import NOTHING that reaches `import.meta.env` (`lib/firebase.ts`) or
 * the router. `lib/scan-target.ts` imports the `CopyStatus` TYPE only, which
 * `verbatimModuleSyntax` erases, so nothing loads at runtime.
 *
 * Component behaviour is deliberately NOT tested — this app has no jsdom setup,
 * which is why every decision above lives in a module a `node:test` process can
 * import.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_SCAN_TARGET,
  SCAN_TARGETS,
  TARGET_LABEL,
  addActionLabel,
  addedLabel,
  bulkAddLabel,
  copyStatusFor,
  isScanTarget,
  loadScanTarget,
  saveScanTarget,
  targetSentence,
} from '../src/lib/scan-target.js';

/**
 * A sessionStorage stand-in. Node has none, and the module is written to
 * survive its absence — so the "no storage at all" case below runs against the
 * REAL absence rather than a mock pretending to throw.
 */
function withStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

/** ⚠️ Pinned: this app's own key convention is `bgc.` + camelCase. */
const KEY = 'bgc.scanTarget';

describe('the target itself', () => {
  it('offers exactly two, and shelf is the default', () => {
    assert.deepEqual([...SCAN_TARGETS], ['shelf', 'wishlist']);
    assert.equal(DEFAULT_SCAN_TARGET, 'shelf');
  });

  it('gives each one a word for the button', () => {
    assert.equal(TARGET_LABEL.shelf, 'Shelf');
    assert.equal(TARGET_LABEL.wishlist, 'Wishlist');
  });

  it('maps to a copy status, and only ever to owned or wanted', () => {
    assert.equal(copyStatusFor('shelf'), 'owned');
    assert.equal(copyStatusFor('wishlist'), 'wanted');
    // ⚠️ The point of the assertion: a barcode in a shop is not evidence that
    // anything was paid for, and the other two statuses describe a copy you
    // already hold.
    for (const t of SCAN_TARGETS) {
      assert.ok(['owned', 'wanted'].includes(copyStatusFor(t)), `${t} escaped the pair`);
    }
  });

  it('recognises only the two words', () => {
    assert.equal(isScanTarget('shelf'), true);
    assert.equal(isScanTarget('wishlist'), true);
    assert.equal(isScanTarget('owned'), false);
    assert.equal(isScanTarget('Shelf'), false);
    assert.equal(isScanTarget(''), false);
    assert.equal(isScanTarget(null), false);
    assert.equal(isScanTarget(undefined), false);
    assert.equal(isScanTarget(7), false);
  });
});

describe('remembering it for the session', () => {
  it('reads back what was written', () => {
    const store = withStorage();
    saveScanTarget('wishlist');
    assert.equal(store.get(KEY), 'wishlist');
    assert.equal(loadScanTarget(), 'wishlist');
  });

  it('falls back to shelf when nothing is stored', () => {
    withStorage();
    assert.equal(loadScanTarget(), 'shelf');
  });

  it('falls back to shelf when the stored value is not a target', () => {
    // ⚠️ storage is user-writable and survives a build that offered other
    // options — an unvalidated read would drive the switch into a state it
    // cannot render and write a status the schema would refuse.
    withStorage({ [KEY]: 'preordered' });
    assert.equal(loadScanTarget(), 'shelf');
  });

  it('falls back to shelf with NO storage at all, and saving does not throw', () => {
    // The real absence, not a mock: `globalThis.sessionStorage` is undefined
    // here, which is what a private-mode browser's throwing accessor amounts
    // to from this module's point of view.
    assert.equal(loadScanTarget(), 'shelf');
    assert.doesNotThrow(() => saveScanTarget('wishlist'));
  });
});

describe('what the screen says', () => {
  it('names the action on the button', () => {
    assert.equal(addActionLabel('shelf'), 'Add');
    assert.equal(addActionLabel('wishlist'), 'Add to wishlist');
  });

  it('counts the games in the shelf-photo button, and says where they go', () => {
    assert.equal(bulkAddLabel('shelf', 1), 'Add 1 game');
    assert.equal(bulkAddLabel('shelf', 9), 'Add 9 games');
    assert.equal(bulkAddLabel('wishlist', 1), 'Add 1 game to wishlist');
    assert.equal(bulkAddLabel('wishlist', 9), 'Add 9 games to wishlist');
  });

  it('says where games will land, in the subject the tab is about', () => {
    assert.equal(targetSentence('shelf'), 'Scanned games go on your shelf.');
    assert.match(targetSentence('wishlist'), /^Scanned games go on your wishlist/);
    assert.match(targetSentence('wishlist', 'Games you add'), /^Games you add go on your wishlist/);
    // A want is not a copy — the sentence says so, because "wishlist" alone
    // does not tell somebody what will NOT be recorded.
    assert.match(targetSentence('wishlist'), /a want, not a copy you own\.$/);
  });
});

describe('what a settled row says it did', () => {
  it('gives a wishlist add its own words', () => {
    assert.equal(addedLabel('wishlist'), 'Added to wishlist');
  });

  it('leaves the shelf wording exactly as it was', () => {
    assert.equal(addedLabel('shelf'), 'Added');
  });

  it('never says plain "Added" over a want', () => {
    // The whole failure this function exists to prevent, stated once.
    assert.notEqual(addedLabel('wishlist'), addedLabel('shelf'));
  });
});
