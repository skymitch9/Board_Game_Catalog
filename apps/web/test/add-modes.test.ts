/**
 * The scanner's tab catalogue — what each door offers, and what each tab costs
 * a person in permission.
 *
 * ## ⚠️ THE PROPERTIES WORTH A TEST
 *
 *  1. **`/scan`'s filter still does exactly what `ScanPage` did** before the
 *     2026-09-04 extraction: barcode ungated, photo and shelf behind
 *     `scanPhoto`, Manually behind `editCatalog`, and the order untouched. That
 *     extraction's whole promise was "the page behaves exactly as it did", and
 *     this is the half of it a machine can check.
 *  2. **The wishlist door offers neither *Whole shelf* nor *Manually*.** The
 *     first because a wishlist is not bulk intake; the second because that tab
 *     is `QuickAdd`, whose own copy-status dropdown could contradict the door
 *     it is standing in.
 *  3. **The barcode tab is gated on the door, not on the scanner.** `/scan`
 *     leaves it open (a barcode lookup is a `read`); the wishlist door demands
 *     `scanBarcode`, as it always has. ⚠️ A refactor that "tidied" the two into
 *     one rule would silently widen access on one of the two screens, which is
 *     the change that is hard to take back.
 *  4. **Nobody is ever left with no tab at all** on a door they can open.
 *  5. **Every mode has a spec**, so a tab can never render blank.
 *
 * ⚠️ This is a `node:test` process: it may import NOTHING that reaches
 * `import.meta.env` (`lib/firebase.ts`) or the router at runtime — the trap
 * `test/scan-target.test.ts` records. `lib/add-modes.ts` imports the `ScanMode`
 * and `Capability` TYPES only, which TypeScript erases, so nothing loads.
 *
 * Component behaviour is deliberately NOT tested — this app has no jsdom setup,
 * which is why the decisions above live in a module a `node:test` process can
 * import.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ADD_MODES,
  SCAN_PAGE_MODES,
  SCAN_PAGE_NEEDS,
  WISHLIST_DOOR_MODES,
  WISHLIST_DOOR_NEEDS,
  addModeSpec,
  firstUsableMode,
  usableModes,
  type AddMode,
} from '../src/lib/add-modes.js';

/** The capability lists the four interesting roles actually carry. */
const READER: readonly string[] = ['read'];
const MEMBER: readonly string[] = ['read', 'suggestWishlist'];
const CONTRIBUTOR: readonly string[] = [
  'read',
  'suggestWishlist',
  'manageWishlist',
  'editCatalog',
  'scanBarcode',
];
const MODERATOR: readonly string[] = [...CONTRIBUTOR, 'scanPhoto', 'runResearch'];

const scanTabs = (caps: readonly string[]) => usableModes(caps, SCAN_PAGE_MODES, SCAN_PAGE_NEEDS);
const doorTabs = (caps: readonly string[]) =>
  usableModes(caps, WISHLIST_DOOR_MODES, WISHLIST_DOOR_NEEDS);

describe('the catalogue itself', () => {
  it('has a spec for every mode either door can offer', () => {
    const offered = new Set<AddMode>([...SCAN_PAGE_MODES, ...WISHLIST_DOOR_MODES]);
    for (const id of offered) {
      const spec = addModeSpec(id);
      assert.equal(spec.id, id);
      assert.ok(spec.label.length > 0, `${id} has no label`);
      assert.ok(spec.blurb.length > 0, `${id} has no blurb`);
    }
  });

  it('lists the four tabs in the order /scan has always drawn them', () => {
    assert.deepEqual(
      ADD_MODES.map((m) => m.id),
      ['barcode', 'photo', 'shelf', 'manual'],
    );
    assert.deepEqual([...SCAN_PAGE_MODES], ['barcode', 'photo', 'shelf', 'manual']);
  });

  it('keeps the words the screen has shipped', () => {
    assert.equal(addModeSpec('barcode').label, 'Barcode');
    assert.equal(addModeSpec('photo').label, 'One box');
    assert.equal(addModeSpec('shelf').label, 'Whole shelf');
    assert.equal(addModeSpec('manual').label, 'Manually');
  });
});

describe('/scan offers exactly what ScanPage offered before the extraction', () => {
  it('gives a reader the free barcode tab and nothing else', () => {
    assert.deepEqual(scanTabs(READER), ['barcode']);
  });

  it('adds Manually at editCatalog, still without the paid vision tabs', () => {
    assert.deepEqual(scanTabs(CONTRIBUTOR), ['barcode', 'manual']);
  });

  it('opens both photo tabs at scanPhoto, in the original order', () => {
    assert.deepEqual(scanTabs(MODERATOR), ['barcode', 'photo', 'shelf', 'manual']);
  });

  it('never gates the barcode tab — a barcode lookup is a read', () => {
    assert.equal(SCAN_PAGE_NEEDS.barcode, null);
    assert.ok(scanTabs([]).includes('barcode'));
  });

  it('puts both photo tabs behind the one capability that bills', () => {
    assert.equal(SCAN_PAGE_NEEDS.photo, 'scanPhoto');
    assert.equal(SCAN_PAGE_NEEDS.shelf, 'scanPhoto');
  });
});

describe('the wishlist door', () => {
  it('offers the camera tabs only — no shelf sweep, no Manually', () => {
    assert.deepEqual([...WISHLIST_DOOR_MODES], ['barcode', 'photo']);
    assert.ok(!WISHLIST_DOOR_MODES.includes('shelf'));
    assert.ok(!WISHLIST_DOOR_MODES.includes('manual'));
  });

  it('gates its barcode tab on scanBarcode where /scan does not', () => {
    assert.equal(WISHLIST_DOOR_NEEDS.barcode, 'scanBarcode');
    assert.notEqual(WISHLIST_DOOR_NEEDS.barcode, SCAN_PAGE_NEEDS.barcode);
  });

  it('shows a member no camera at all — typing is that door’s own path', () => {
    assert.deepEqual(doorTabs(MEMBER), []);
  });

  it('shows a contributor the barcode tab and a moderator both', () => {
    assert.deepEqual(doorTabs(CONTRIBUTOR), ['barcode']);
    assert.deepEqual(doorTabs(MODERATOR), ['barcode', 'photo']);
  });

  it('agrees with /scan on every tab except barcode', () => {
    for (const id of ['photo', 'shelf', 'manual'] as const) {
      assert.equal(WISHLIST_DOOR_NEEDS[id], SCAN_PAGE_NEEDS[id]);
    }
  });
});

describe('firstUsableMode', () => {
  it('honours the asked-for tab when it survived the filter', () => {
    assert.equal(firstUsableMode(scanTabs(MODERATOR), 'shelf'), 'shelf');
  });

  it('falls back to the first usable one when it did not', () => {
    assert.equal(firstUsableMode(scanTabs(READER), 'shelf'), 'barcode');
  });

  it('falls back to the first usable one when nothing was asked for', () => {
    assert.equal(firstUsableMode(doorTabs(MODERATOR)), 'barcode');
  });

  it('says null rather than guessing when there is no tab at all', () => {
    assert.equal(firstUsableMode(doorTabs(MEMBER), 'barcode'), null);
  });
});

describe('usableModes', () => {
  it('preserves the offered order rather than the catalogue order', () => {
    assert.deepEqual(
      usableModes(MODERATOR, ['manual', 'barcode'], SCAN_PAGE_NEEDS),
      ['manual', 'barcode'],
    );
  });

  it('returns nothing when nothing was offered', () => {
    assert.deepEqual(usableModes(MODERATOR, [], SCAN_PAGE_NEEDS), []);
  });

  it('leaves at least one way in on every door somebody can open', () => {
    // `/scan` is reachable by anyone approved, so it must never be empty.
    for (const caps of [READER, MEMBER, CONTRIBUTOR, MODERATOR]) {
      assert.ok(scanTabs(caps).length > 0);
    }
    // The wishlist door CAN come back empty, and that is not a hole: the door
    // itself is a typed form, and the panel is only ever mounted once a camera
    // tab has been chosen.
    assert.equal(doorTabs(MEMBER).length, 0);
  });
});
