/**
 * The tabs on the scanner, as data — the label, the blurb, and what each one
 * costs a person in permission.
 *
 * ## ⚠️ WHY THIS IS A MODULE AND NOT A CONST IN `ScanPanel`
 *
 * Two doors now render one scanner (`ScanPanel`): `/scan`, and the wishlist
 * page's *+ Add something*. **Which tabs each door offers is the door's
 * decision, not the scanner's** — the same division the library catalog's
 * `add-modes.ts` draws, and for the same reason: a component that decides its
 * own tabs from a capability list cannot be reused by a screen that wants a
 * different subset without growing a flag per screen.
 *
 * So the catalogue lives here as data, the two doors pick from it, and
 * `ScanPanel` renders exactly the list it is handed.
 *
 * ## ⚠️ THE TWO DOORS GATE THE BARCODE TAB DIFFERENTLY, ON PURPOSE
 *
 * | | `/scan` | the wishlist door |
 * |---|---|---|
 * | Barcode | **ungated** | `scanBarcode` (contributor+) |
 * | One box / Whole shelf | `scanPhoto` | `scanPhoto` |
 * | Manually | `editCatalog` | not offered at all — see below |
 *
 * That difference is inherited, measured off the two screens as they stood on
 * 2026-09-04, and deliberately **not** normalised by this extraction:
 *
 *  - `/scan` has never gated its barcode tab. Reading a barcode to ask *"do I
 *    already own this?"* is `GET /api/barcode/:code`, which
 *    `capabilities.ts` gates on plain `read` — "a browsing action available to
 *    every approved role", in its own words.
 *  - The wishlist door has gated its barcode tab on `scanBarcode` since it
 *    grew one. Un-gating it here would hand a plain `member` a tab whose add
 *    button calls `createItem` — `editCatalog`, one rung above them — and the
 *    403 would land after the scan, which is the shape this repo's rules call
 *    the worst way to refuse somebody.
 *
 * ⚠️ Widening access is the change that is hard to take back, so the narrower
 * gate stays until somebody asks for the wider one.
 *
 * ## ⚠️ THE WISHLIST DOOR OFFERS NEITHER *Whole shelf* NOR *Manually*
 *
 *  - **Whole shelf** — a wishlist is not bulk intake. Photographing a shelf
 *    means *"record every one of these"*, a sentence about boxes you already
 *    have. (The library catalog's door leaves its shelf tab out for the same
 *    reason, in the same words.)
 *  - **Manually** — that tab is `QuickAdd`, whose form carries its own copy
 *    **status dropdown** defaulting to `owned`. Offering it inside a door
 *    pinned to the wishlist would be a control that can quietly contradict the
 *    door it is standing in. The door already has a typed path of its own
 *    (`WishlistAdd`'s `ItemPicker`), which is the better one here: it matches
 *    an existing catalog row first, asks how many and why, and hands what it
 *    creates to the expansions offer.
 *
 * ## ⚠️ TYPE-ONLY IMPORTS, BECAUSE A `node:test` PROCESS LOADS THIS
 *
 * `test/add-modes.test.ts` imports this module directly. It must therefore
 * reach neither `import.meta.env` (`lib/firebase.ts`) nor the router at
 * runtime — the trap `test/scan-target.test.ts` records. `ScanMode` and
 * `Capability` are imported as TYPES only, which TypeScript erases, so nothing
 * is loaded.
 */

import type { Capability } from '@bgc/core';
import type { ScanMode } from '../router';

/** A tab on the scanner. The router already owns this union — `?mode=` parses it. */
export type AddMode = ScanMode;

export interface AddModeSpec {
  id: AddMode;
  /** The word on the tab. */
  label: string;
  /** The line under it: what this tab costs and what it is good at. */
  blurb: string;
}

/**
 * The four tabs, in the order `/scan` has always drawn them.
 *
 * ⚠️ The ordering is not alphabetical and is not arbitrary — it is what each
 * rung actually costs, which `ScanPanel`'s header argues at length: a barcode
 * is exact, free and about a second; a photo is three to five; typing costs a
 * person's time, which is why it is last.
 */
export const ADD_MODES: readonly AddModeSpec[] = [
  { id: 'barcode', label: 'Barcode', blurb: 'Fastest when the box has one. Free.' },
  { id: 'photo', label: 'One box', blurb: 'Reads the title off the cover. A few seconds.' },
  { id: 'shelf', label: 'Whole shelf', blurb: 'Reads every spine at once. Best for bulk.' },
  { id: 'manual', label: 'Manually', blurb: 'Type the name. Looks the rest up as you go.' },
];

const BY_ID: Record<AddMode, AddModeSpec> = Object.fromEntries(
  ADD_MODES.map((m) => [m.id, m]),
) as Record<AddMode, AddModeSpec>;

/** The tab's label and blurb. Total — every `ScanMode` has a spec. */
export function addModeSpec(id: AddMode): AddModeSpec {
  return BY_ID[id];
}

/** What `/scan` offers, and in which order. All four. */
export const SCAN_PAGE_MODES: readonly AddMode[] = ['barcode', 'photo', 'shelf', 'manual'];

/** What the wishlist page's door offers. See the header for the two omissions. */
export const WISHLIST_DOOR_MODES: readonly AddMode[] = ['barcode', 'photo'];

/**
 * The capability each tab needs on `/scan`. `null` is "free, no gate".
 *
 * ⚠️ Measured off `ScanPage` as it stood on 2026-09-04, not designed here: the
 * extraction that created this file was required to leave `/scan` behaving
 * exactly as it did.
 */
export const SCAN_PAGE_NEEDS: Record<AddMode, Capability | null> = {
  barcode: null,
  photo: 'scanPhoto',
  shelf: 'scanPhoto',
  manual: 'editCatalog',
};

/**
 * The capability each tab needs on the wishlist door.
 *
 * ⚠️ Differs from `SCAN_PAGE_NEEDS` in exactly one entry — `barcode` — and the
 * header says why that difference is kept rather than smoothed away.
 */
export const WISHLIST_DOOR_NEEDS: Record<AddMode, Capability | null> = {
  barcode: 'scanBarcode',
  photo: 'scanPhoto',
  shelf: 'scanPhoto',
  manual: 'editCatalog',
};

/**
 * The offered tabs this person can actually use, in the order offered.
 *
 * ⚠️ Both doors **hide** a tab they cannot use rather than disabling it — which
 * is where this repo differs from the library catalog, whose wishlist door
 * disables with a sentence. The difference is deliberate: over there a missing
 * tab is an access question worth explaining, while here every tab that is ever
 * hidden has a usable sibling left standing (barcode is free on `/scan`; typing
 * is free on the wishlist door, and is that door's default), so nobody is ever
 * left looking at a screen with no way in and no explanation.
 */
export function usableModes(
  capabilities: readonly string[],
  offered: readonly AddMode[],
  needs: Record<AddMode, Capability | null>,
): AddMode[] {
  return offered.filter((id) => {
    const need = needs[id];
    return need == null || capabilities.includes(need);
  });
}

/**
 * Which tab to open on: the one asked for if it survived the filter, else the
 * first that did, else `null`.
 *
 * ⚠️ `/scan` does NOT use this today and must not start to — `?mode=photo`
 * without `scanPhoto` currently opens the photo tab with no tab highlighted,
 * and changing that was out of scope for the extraction. It exists for the
 * wishlist door, which chooses its own opening tab from a list it just
 * filtered, and for whoever fixes `/scan`'s case later.
 */
export function firstUsableMode(
  usable: readonly AddMode[],
  preferred?: AddMode | null,
): AddMode | null {
  if (preferred && usable.includes(preferred)) return preferred;
  return usable[0] ?? null;
}
