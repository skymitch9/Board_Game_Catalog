import { type MeResponse } from '@bgc/core';
import { ApiError } from '../api';
import { SCAN_PAGE_MODES, SCAN_PAGE_NEEDS, usableModes } from '../lib/add-modes';
import { ScanPanel } from '../components/ScanPanel';
import { Link, type ScanMode } from '../router';

/**
 * Checking **one** game: by barcode, by photo, by shelf, or by hand.
 *
 * The one-off screen. It answers "am I already holding something I own?" — the
 * question you have standing in a shop — and lets you add the game when the
 * answer is no. Bulk intake is a different job and lives on `/scan-jobs`, where
 * barcodes and photos both feed a queue and nothing is confirmed at scan time.
 *
 * The two used to be the same screen and should not be: this one stops on the
 * first answer and shows it, which is exactly wrong for working through a
 * stack, and the queue never answers a question, which is exactly wrong when
 * you are standing in front of a till.
 *
 * ## ⚠️ THE SCANNER ITSELF IS NO LONGER HERE — 2026-09-04
 *
 * Everything from the tab strip down is `components/ScanPanel`, because the
 * owner asked for *"all scanning [to] be the same menu"* and the wishlist page
 * keeps a door of its own. This page is now what is genuinely ITS own: the
 * heading, the way back to the collection, and the pointer at the queue for
 * somebody holding a stack. The panel's header argues what each door still
 * owns and why; `lib/add-modes.ts` owns which tabs each one offers.
 *
 * It renders the panel with **no** `pinTarget`, which is what draws the
 * *Adding to · Shelf | Wishlist* switch, and with **no** `onAdded`, which is
 * what keeps this screen's oldest behaviour: a single add opens the game.
 */
export function ScanPage({ me, initialMode }: { me: MeResponse; initialMode?: ScanMode | null }) {
  /*
   * Typing a game in needs write access, and so does the name lookup behind it;
   * offering the tab to a reader would only lead to a 403. Photo and shelf both
   * need `scanPhoto` (moderator+) — a contributor has `editCatalog` and free
   * barcode scanning but not the paid vision rungs, so those tabs are filtered
   * rather than left to 403 on the first shot. The rules are data, in
   * `lib/add-modes.ts`, because the wishlist door filters a different set.
   */
  const modes = usableModes(me.capabilities, SCAN_PAGE_MODES, SCAN_PAGE_NEEDS);

  return (
    <div className="scan-page">
      {/*
        "Check", not "Add", because the first question here is nearly always
        whether you already own the thing — standing in a shop, holding a box you
        half recognise. Answering that is useful on its own, and the barcode path
        answers it instantly from the local table. Adding is what follows when
        the answer turns out to be no.

        That framing was also, for a while, the only place barcode scanning
        lived, which meant the fastest and most accurate way to add a game was
        hidden behind a button that sounded like it only answered a question.
        It is not any more — /scan-jobs scans barcodes continuously onto the
        queue — so the line below points at it rather than leaving anyone with a
        stack of boxes to add them one at a time from here.
      */}
      <header className="scan-header">
        <h1>Check a game</h1>
        <Link to="/">Back to collection</Link>
      </header>
      <p className="muted scan-header__blurb">
        Scan, photograph or type <em>one</em> game to see whether it is already
        in your collection — and add it if it is not. Got a stack?{' '}
        <Link to="/scan-jobs?add=barcode">Scan them onto the queue</Link> instead.
      </p>

      <ScanPanel me={me} modes={modes} initialMode={initialMode} />
    </div>
  );
}

export { ApiError };
