/**
 * Where to actually buy something on the wishlist.
 *
 * A leaf module: it imports nothing at all, so the database layer, the Worker
 * and the web app can each build on it. See `constants.ts` for why the import
 * order in this package matters — nothing here may reach for `index.ts`.
 *
 * ## Why this exists
 *
 * *"add links to buy each item — starting priority being publisher site, then a
 * few other options such as maybe Amazon or something. Rank them in terms of
 * reliability and if they will ship to Arizona"* — the owner, about reading the
 * wishlist on a phone in a game shop.
 *
 * ## Two rules that decide the whole shape of this file
 *
 * 1. **Resolved at read time, never stored.** The same reasoning as
 *    `inheritCover` in `covers.ts` and `INHERITED_FIELDS` in `details.ts`: a
 *    stored buy link is indistinguishable from a researched fact a month later,
 *    and a shop's URL scheme is not ours to keep in sync. Nothing here writes.
 * 2. **Nothing here costs money or a network call.** The alternative considered
 *    and rejected was a per-item lookup that asks a model where to buy each row.
 *    That is cents per row, goes stale the week it runs, and has to be re-run
 *    for ever. The set of shops worth listing is small and barely moves, so it
 *    is researched once, written down below with the date, and each item's links
 *    are built from its name every time the page loads.
 *
 * ## What a link honestly is
 *
 * Only the publisher link is ever a *product* link, and even then it is usually
 * the publisher's front door rather than the product's page — that is what the
 * catalog stores. Every retailer link is a **search**, and is labelled as one in
 * the UI. A search URL never rots, costs nothing to produce, and does not
 * pretend to be a product page that may not exist.
 *
 * A retailer search that comes back empty is a true answer, not a failure: 18 of
 * the 25 rows on this wishlist are Kickstarter-exclusive Dice Throne playmats
 * that no shop has ever stocked. That is precisely why the publisher ranks
 * first and why a second-hand marketplace is on the list at all.
 */

/** What sort of promise a link is making. */
export type BuyLinkKind =
  /** The publisher's own site — first party, and the only one that can be authoritative. */
  | 'publisher'
  /** A pledge manager that *may* still be selling. Never a plain campaign page. */
  | 'late-pledge'
  /** A shop's own search for this name. Honest about being a search. */
  | 'search';

export interface BuyLink {
  href: string;
  /** What the chip says. */
  label: string;
  kind: BuyLinkKind;
  /** One line saying what this link is and what it is not. Shown on the row. */
  note: string;
  /** Set when the publisher URL was borrowed from an ancestor — see `details.ts`. */
  fromName?: string;
}

/** Everything a row has to offer a buy link, and nothing more. */
export interface BuyLinkSubject {
  name: string;
  publisherUrl?: string | null;
  /** Borrowed from the nearest ancestor with one. A playmat rarely has its own. */
  inheritedPublisherUrl?: { value: string; fromName: string } | null;
  /** The crowdfunding campaign it came from, if any. Usually **not** a buy link. */
  sourceUrl?: string | null;
}

// ---------------------------------------------------------------------------
// The shops, researched once
// ---------------------------------------------------------------------------

/**
 * Where to look, in the order worth looking, for a buyer in **Arizona**.
 *
 * > **Researched and every URL opened in a browser on 2026-08-08.** Re-check the
 * > patterns if a link starts landing on a shop's front page instead of its
 * > results — that is what a platform migration looks like from here, and it
 * > does not announce itself with an error. Miniature Market has already moved
 * > once: its old Magento `/catalogsearch/result/?q=` path now 404s.
 *
 * What each one actually returned, so a future session can tell a broken URL
 * from a shop that genuinely has nothing:
 *
 * | Shop | Searched | Landed on |
 * |---|---|---|
 * | Miniature Market | Ark Nova Marine Worlds | 1 product, the right one, $23.99, out of stock |
 * | Noble Knight | Dice Throne X-Men Playmat Wolverine | 2 products, incl. *Marvel Dice Throne Playmat – Wolverine* (USAOpoly) |
 * | Amazon | the same | 71 results, mostly other playmats — and one of the sellers offered was "Game Nerdz Outlet", which is the marketplace point exactly |
 * | eBay | the same | 0 exact, then near matches, every one "Located in United States" — `LH_PrefLoc=1` works |
 * | GameNerdz | Catan (checked over HTTP, the browser could not reach it) | "79 results". *Ark Nova* returns nothing, which is stock, not a broken URL |
 *
 * **On "will they ship to Arizona".** Arizona is not an unusual destination for
 * board games and no US shop below excludes it, so the ranking cannot turn on
 * that question and pretending otherwise would be inventing a difference. What
 * genuinely differs, and what the ranking is built on:
 *
 * | Question | Why it matters to somebody standing in a shop in Phoenix |
 * |---|---|
 * | Is it domiciled in the US? | An overseas order means customs, duty and weeks of transit, not days |
 * | Is the stock first-party? | A marketplace listing may be a reseller at a markup, with the shop's name on it |
 * | Does it stock hobby titles at all? | A mass-market chain has never carried a crowdfunded playmat |
 *
 * **What is deliberately *not* claimed.** Free-shipping thresholds, delivery
 * estimates and stock levels are all things these shops change without notice;
 * none is asserted here, and none should be added — a number in a comment
 * nobody re-verifies is worse than no number. Nor is any claim made about which
 * shop is cheapest.
 *
 * **Considered and left off:**
 * - **Board Game Bliss** (boardgamebliss.com) — well regarded, but Canadian.
 *   For an Arizona buyer that is customs, duty and a long wait on an order that
 *   a domestic shop fills in days. It would rank last on the only axis the owner
 *   asked about, so it is documented here rather than rendered.
 * - **Target, Walmart** — they stock mass-market games. Nothing on this
 *   wishlist is mass-market, so every search would be empty.
 * - **BoardGameGeek Marketplace** — genuinely useful for out-of-print pieces,
 *   but its search needs a game's numeric BGG id, and the accessories that need
 *   it most are exactly the rows that have no id of their own.
 */
export const RETAILERS: readonly {
  name: string;
  /** Builds the shop's own search URL. `term` arrives already URI-encoded. */
  search: (term: string) => string;
  note: string;
}[] = [
  {
    // St. Louis, Missouri. The largest first-party hobby catalog of the three
    // US shops here, which is why it leads: if a retail edition of a wishlist
    // row exists at all, this is the likeliest one to be holding it.
    name: 'Miniature Market',
    // `?search=`, not `?q=`. `?q=` answers 200 and quietly renders the home
    // page — verified in a browser, which is the only way to catch it.
    search: (term) => `https://www.miniaturemarket.com/search?search=${term}`,
    note: 'US shop (Missouri), first-party stock. Searches their catalog for this name.',
  },
  {
    // Texas. First-party as well. Retailer round-ups single it out for
    // pre-orders, which matters on a list of things that are not out yet —
    // ⚠️ that is reputation, not something checked here, and it is why the
    // note below claims nothing about it.
    name: 'GameNerdz',
    search: (term) => `https://www.gamenerdz.com/search.php?search_query=${term}`,
    note: 'US shop (Texas), first-party stock. Searches their catalog for this name.',
  },
  {
    // Amazon is fast to Arizona and it is where the owner's instinct went, so
    // it is here — but it ranks below the hobby shops on purpose. A search
    // result on Amazon is a mix of Amazon's own stock and marketplace sellers,
    // and for a hobby or crowdfunded title it is usually the latter, at a
    // markup, with no way to tell from the search page which you are looking
    // at. Restricted to the Toys & Games department so the term does not drag
    // in books and costumes.
    name: 'Amazon',
    search: (term) => `https://www.amazon.com/s?k=${term}&i=toys-and-games`,
    note: 'Fast to Arizona, but a marketplace — the seller may be a reseller, not Amazon.',
  },
  {
    // Fitchburg, Wisconsin. Last of the US shops because its new-release
    // catalog is narrower — but it is the only one that deals in used and
    // out-of-print stock, which is what a retired Kickstarter accessory is.
    name: 'Noble Knight',
    // Both halves matter: `/search-results?q=` answers 200 with an empty page,
    // and `/Search?...` redirects to their "Search Tips" article. This is the
    // form their own search box produces.
    search: (term) => `https://www.nobleknight.com/Search-Results?zQuery=${term}`,
    note: 'US shop (Wisconsin). Deals in used and out-of-print copies as well as new.',
  },
  {
    // Last, and honestly labelled. For an exclusive that was never sold at
    // retail this is often the only place a copy actually exists — but every
    // listing is a stranger, condition and price vary wildly, and it is the
    // least reliable thing on the list by a distance.
    name: 'eBay',
    search: (term) => `https://www.ebay.com/sch/i.html?_nkw=${term}&LH_PrefLoc=1`,
    note: 'Second-hand marketplace, US sellers only. Least reliable — check the seller.',
  },
];

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/**
 * What a crowdfunding host is worth as a *buy* link, which is not the same
 * question as what it is worth as a record of where something came from.
 *
 * ⚠️ **A finished Kickstarter is not a shop.** Kickstarter has no post-campaign
 * store: once funding closes the page can only be read, and **9 of the 25 rows**
 * on this wishlist carry one. Offering those under a heading that says "buy" would
 * send somebody to a page that cannot sell them anything — so they are dropped
 * here entirely. The campaign is still linked from the item page, under
 * `campaignLabel`, where it is presented as provenance rather than a shop.
 *
 * BackerKit and Gamefound are different in kind: both host pledge managers and
 * late-pledge stores that routinely keep taking orders after a campaign closes.
 * They are offered, but as `late-pledge` and never as a certainty — plenty of
 * those close too, and this cannot tell which from the URL alone.
 */
const LATE_PLEDGE_HOSTS: readonly { host: string; label: string }[] = [
  { host: 'backerkit.com', label: 'BackerKit' },
  { host: 'gamefound.com', label: 'Gamefound' },
];

/**
 * The host of a URL, lower-cased and without `www.`.
 *
 * By hand rather than through `URL`, because this package compiles without the
 * DOM lib on purpose — see the header of `index.ts`. `ItemPage.tsx` may use
 * `URL` for the same job; it is a browser file and this one is not.
 */
function hostOf(url: string): string | null {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  if (!match?.[1]) return null;
  return match[1]
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();
}

function latePledgeHostOf(url: string): { host: string; label: string } | null {
  const host = hostOf(url);
  if (!host) return null;
  return LATE_PLEDGE_HOSTS.find((h) => host === h.host || host.endsWith(`.${h.host}`)) ?? null;
}

// ---------------------------------------------------------------------------
// Building the links
// ---------------------------------------------------------------------------

/**
 * The words worth typing into a shop's search box.
 *
 * Punctuation is removed rather than encoded. Every shop below runs a keyword
 * engine, and Noble Knight's own search tips say in as many words to avoid
 * punctuation; `Dice Throne X-Men: Playmat - Wolverine` searched literally is a
 * guaranteed miss, while its five words are a fair question to ask.
 *
 * The hyphen inside a word is kept, because `X-Men` is a word. Only a hyphen
 * with space on both sides is a separator.
 */
export function searchTermFor(name: string): string {
  return name
    .replace(/\s+[-–—]\s+/g, ' ')
    .replace(/[:;,./\\()[\]{}"'’“”!?|+*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every way to buy this row, best first.
 *
 * Order is the answer to the owner's question, and it is the same for every
 * row because it depends on the shop rather than the item:
 *
 * 1. **The publisher**, if the catalog knows one — first party, and for a
 *    Kickstarter-exclusive accessory the only place it was ever sold. Borrowed
 *    from the game upstairs when the row has none of its own, exactly as the
 *    item page already borrows a publisher.
 * 2. **A late-pledge store**, if the row came from BackerKit or Gamefound and
 *    might therefore still be open. Never a finished Kickstarter.
 * 3. **The shops**, in `RETAILERS` order — US and first-party before a
 *    marketplace, and a second-hand marketplace last.
 *
 * Returns an empty array only for a row with no publisher anywhere above it and
 * no name to search on, which no row in the catalog is.
 */
export function buyLinksFor(subject: BuyLinkSubject): BuyLink[] {
  const links: BuyLink[] = [];

  const own = subject.publisherUrl?.trim();
  const borrowed = subject.inheritedPublisherUrl;
  if (own) {
    links.push({
      href: own,
      label: 'Publisher',
      kind: 'publisher',
      note: "The publisher's own site. First party, and usually the only place an exclusive was sold.",
    });
  } else if (borrowed?.value) {
    links.push({
      href: borrowed.value,
      label: 'Publisher',
      kind: 'publisher',
      // Named, because a playmat's publisher site is its game's publisher site
      // and somebody about to spend money deserves to know whose page they are
      // being sent to.
      note: `The publisher of ${borrowed.fromName}. This row has no site of its own.`,
      fromName: borrowed.fromName,
    });
  }

  if (subject.sourceUrl) {
    const host = latePledgeHostOf(subject.sourceUrl);
    if (host) {
      links.push({
        href: subject.sourceUrl,
        // "Pledge manager", not "Late pledge" — the second promises you can
        // still pledge, and nothing here knows that. Checked 2026-08-08: the
        // one row on this list with such a URL, the Pangea cup holder, opens on
        // a Gamefound page reading "Pledge manager is closed". The chip is
        // drawn dashed for exactly this reason.
        label: `Pledge manager (${host.label})`,
        kind: 'late-pledge',
        note: 'A pledge manager. It may still take orders or it may be closed — the page says which.',
      });
    }
  }

  const term = encodeURIComponent(searchTermFor(subject.name));
  if (term) {
    for (const shop of RETAILERS) {
      links.push({
        href: shop.search(term),
        label: shop.name,
        kind: 'search',
        note: shop.note,
      });
    }
  }

  return links;
}
