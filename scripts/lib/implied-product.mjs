/**
 * "This accessory implies a game I do not have a row for."
 *
 * The inference `docs/TODO.md` records as **proved on Here to Slay**: six
 * accessories — *Warriors & Druids* Play Mat Set / Standee Set / Meeples Set,
 * and the same three for *Berserkers & Necromancers* — sat in the collection
 * with **no expansion row behind them**, and both expansions turned out to be
 * real products the owner held. They are now items 858 and 859.
 *
 * 🔴 **The literal question "is the implied BASE GAME missing" finds nothing on
 * that case, and it is worth saying why before reading any of this.** All six
 * rows already hung off item 107, *Here to Slay*, which has always been in the
 * collection. What was missing was the product NAMED IN THE MIDDLE of the
 * accessory's own title — the thing between the base game and the sleeve. So
 * this module answers two questions per row, not one:
 *
 *   1. **The implied BASE GAME** — from the repo's own `root_game_id` /
 *      `parent_item_id` links. Cheap, and it is a link-integrity check more
 *      than a shopping list.
 *   2. **The implied PRODUCT** — read out of the row's NAME. This is the
 *      question that found Here to Slay, and the one worth reading.
 *
 * ⚠️ **This module is pure and knows nothing about D1.** It is handed rows and
 * returns findings, so `scripts/test/implied-product.test.mjs` can reach it
 * without a network — the same reason `lib/wrangler-exit.mjs` lives here.
 *
 * ---
 *
 * ## The rule, in full
 *
 * **Step 1 — the shared prefix.** Compare the row's name with its root game's
 * name word by word and drop the common leading run. Word-wise, not
 * string-wise, because the roots carry suffixes the children do not:
 * `Deep Rock Galactic: The Board Game` vs
 * `Deep Rock Galactic: KS Exclusive Dice Bag` share three words and nothing
 * more, and a `startsWith` test on the full root name matches neither.
 *
 * **Step 2 — strip the packaging.** From both ends of what is left, remove a
 * run of words drawn from `PACKAGING` below — product nouns (`playmat`,
 * `sleeves`, `tray`), materials (`neoprene`, `acrylic`, `walnut`), and
 * marketing (`ks`, `exclusive`, `deluxe`, `holofoil`). Both ends, because the
 * decoration sits on both: *KS Exclusive **Dragon** Play Mat Set*.
 *
 * **Step 3 — what survives is the SUBJECT.** For
 * *Here to Slay: Warriors & Druids Play Mat Set* it is `warriors & druids`.
 * For *Here to Slay: KS Exclusive Central Play Mat* it is empty — nothing but
 * packaging — and an empty subject means the row implies its base game and
 * nothing more.
 *
 * **Step 4 — is that product in the collection?** Look for any row under the
 * same root (or under a root joined to it by a `same_family` edge) whose name
 * contains the subject as a consecutive word run. `PRESENT` if one does,
 * `MISSING` if none does, `AMBIGUOUS` if the subject matches rows under more
 * than one root — a subject that means two things has not been resolved, and
 * saying so is better than picking.
 *
 * **Step 5 — how much to trust it.** `subjectRows` counts how many rows under
 * the same root share the subject. ⚠️ **This is the confidence column and the
 * report is sorted by it.** *Warriors & Druids* appears on three accessories,
 * which is the shape of a product name; `town` — extracted from
 * *Icy-themed Neoprene Town Mat* because "town" is not in `PACKAGING` — appears
 * on two and is a false positive. A subject seen once is usually description.
 *
 * **Step 6 — has a person already settled it?** A subject in
 * `VERIFIED_NOT_MISSING` reports `SETTLED` instead of `MISSING`, carrying the
 * verdict and the date. ⚠️ **Measured 2026-09-07: all six of the shortlist the
 * first run produced — every subject named by two or more accessories — turned
 * out to be a false positive**, four naming no product at all and two naming a
 * product already held under a different name. That is the whole reason this
 * step exists: without it the same six come back every run, and the report
 * teaches its reader to ignore it.
 *
 * ⚠️ **The precision of step 2 is a VOCABULARY, so it is wrong at the edges by
 * construction, and the report says so rather than pretending otherwise.** A
 * word nobody has written down yet survives into the subject and produces a
 * spurious `MISSING`. That is the safe direction — this report proposes rows
 * for a person to look at and writes nothing — but it means a `MISSING` count
 * is an upper bound on real gaps, never a measurement of them.
 */

/**
 * Words that describe the PACKAGING rather than the product.
 *
 * ⚠️ **Read this as a measured list, not a designed one.** It was built by
 * running the tail of every non-base row in the live collection through a word
 * frequency count (838 items, 2026-09-07) and taking the words that turned out
 * to name a *format* rather than a *thing*. It will be incomplete the day a new
 * kind of merchandise arrives, and the failure mode is one spurious `MISSING`
 * row, not a wrong write.
 */
export const PACKAGING = new Set([
  // product formats
  'playmat', 'playmats', 'play', 'mat', 'mats', 'board', 'boards',
  'sleeve', 'sleeves', 'card', 'cards', 'deck', 'decks',
  'dice', 'die', 'tray', 'trays', 'tower', 'towers',
  'bag', 'bags', 'box', 'boxes', 'case', 'cases', 'carry',
  'set', 'sets', 'pack', 'packs', 'bundle', 'kit', 'kits',
  'insert', 'inserts', 'organizer', 'organiser', 'divider', 'dividers',
  'token', 'tokens', 'coin', 'coins', 'cube', 'cubes', 'disc', 'discs',
  'tile', 'tiles', 'pedestal', 'holder', 'holders', 'stand', 'stands',
  'standee', 'standees', 'figure', 'figures', 'figurine', 'figurines',
  'miniature', 'miniatures', 'mini', 'minis', 'sculpt', 'sculpts',
  'meeple', 'meeples', 'pin', 'pins', 'coaster', 'coasters',
  'print', 'prints', 'art', 'poster', 'posters', 'screen', 'screens',
  'book', 'books', 'sheet', 'sheets', 'marker', 'markers', 'sticker', 'stickers',
  'upgrade', 'upgrades', 'accessory', 'accessories', 'component', 'components',
  'bits', 'tote', 'mouse', 'pad', 'expansion', 'expansions', 'stretch', 'goal', 'goals',
  // materials and finishes
  'acrylic', 'neoprene', 'metal', 'metallic', 'plastic', 'vinyl', 'wood', 'wooden',
  'walnut', 'resin', 'fabric', 'cloth', 'embroidered', 'enamel', 'foam', 'eva',
  'canvas', 'leather', 'glass', 'stone', 'magnetic', 'holographic', 'holofoil',
  'painted', 'pre', 'prepainted', 'washed', 'contrast', 'themed', 'scratch',
  'double', 'sided', 'single', 'oversized', 'large', 'small', 'jumbo', 'slim',
  // marketing and edition words
  'ks', 'kickstarter', 'exclusive', 'exclusives', 'deluxe', 'premium', 'luxury',
  'collector', "collector's", 'collectors', 'ultimate', 'special', 'limited',
  'commemorative', 'custom', 'bonus', 'extra', 'alt', 'alternate', 'alternative',
  'first', 'edition', 'editions', 'version', 'promo', 'promotional', 'gift',
  'all', 'in', 'allin', 'complete', 'full',
  // generic role words that describe who/where, never what product
  'player', 'players', 'individual', 'central', 'centre', 'center', 'table',
  'game', 'games', 'hero', 'heroes', 'boss', 'bosses', 'character', 'characters',
  'leader', 'leaders', 'main', 'base', 'core', 'starter', 'party', 'parties',
  // colours (a colour never names a product in this collection)
  'black', 'white', 'red', 'blue', 'green', 'gold', 'golden', 'silver', 'sky',
  'purple', 'orange', 'yellow', 'pink', 'grey', 'gray', 'clear',
  // connectives and stray punctuation left by tokenisation
  'the', 'a', 'an', 'of', 'for', 'and', '&', 'with', 'to', 'in', 'on', 'from',
  '-', '|', '+',
]);

/**
 * Split a name into comparable words.
 *
 * `&`, `-` and `|` survive as their own tokens because they separate real
 * subjects (`Warriors & Druids`, `Molten | Overgrown`) and because dropping
 * them would silently join two different products into one string. A hyphen
 * INSIDE a word is split the same way, so `Icy-themed` offers `themed` to the
 * packaging vocabulary instead of hiding it inside a token nothing matches.
 */
export function words(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9&|'\- ]+/g, ' ')
    .replace(/([&|\-])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
}

/** How many leading words two names share. */
export function sharedPrefixLength(nameWords, rootWords) {
  let i = 0;
  while (i < nameWords.length && i < rootWords.length && nameWords[i] === rootWords[i]) i++;
  return i;
}

/**
 * The SUBJECT of a row's name: what is left after the root game's name and the
 * packaging vocabulary are both removed.
 *
 * @returns {{ subject: string[], sharedPrefix: number, tail: string[] }}
 *   `subject` is empty when the row names nothing but its base game and a
 *   format — which is the common and correct case, not a failure.
 */
export function subjectOf(name, rootName) {
  const nameWords = words(name);
  const rootWords = words(rootName);
  const sharedPrefix = sharedPrefixLength(nameWords, rootWords);
  const tail = nameWords.slice(sharedPrefix);

  let lo = 0;
  let hi = tail.length;
  while (lo < hi && PACKAGING.has(tail[lo])) lo++;
  while (hi > lo && PACKAGING.has(tail[hi - 1])) hi--;

  return { subject: tail.slice(lo, hi), sharedPrefix, tail };
}

/** Does `haystack` contain `needle` as a consecutive run of words? */
export function containsRun(haystack, needle) {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * The kinds whose NAME can imply some other product.
 *
 * ⚠️ `expansion` is deliberately absent. An expansion IS the product; asking
 * what it implies is circular and answers `MISSING` for every one of them.
 * Expansions still get the base-game half of the sweep.
 */
export const NAMES_A_PRODUCT = new Set(['accessory', 'promo', 'upgrade']);

export const PRESENT = 'PRESENT';
export const MISSING = 'MISSING';
export const AMBIGUOUS = 'AMBIGUOUS';
export const SETTLED = 'SETTLED';

/**
 * Subjects that a PERSON has already looked up and settled — the answer to
 * "this reported MISSING, and it was checked, and it is not a gap."
 *
 * 🔴 **This is the only mechanism in the sweep that suppresses a row, so it
 * carries the evidence rather than just the verdict.** Each entry says what was
 * checked and on what date, because the alternative — quietly adding the words
 * to `PACKAGING` — silences the row and destroys the reason at the same time.
 * A stripped word is invisible; a `SETTLED` row still appears in the CSV with
 * its explanation, and can be re-argued.
 *
 * ⚠️ **`SETTLED` is not `PRESENT`.** Two of these six ARE held under another
 * name and four name no product at all; collapsing that into "present" would
 * claim a match the collection does not contain. They are their own status so
 * the report can say *"checked, and not a gap"* without lying about which.
 *
 * The key is `<rootId>::<subject>` — the same key `subjectCount` uses. Root id
 * rather than root name, because a rename must not silently un-settle a row
 * somebody spent an evening verifying.
 *
 * ⚠️ **Never add an entry from reasoning.** Every one below was checked against
 * a source outside this repo (a publisher's store, a Kickstarter add-on list,
 * BGG's own component rows in `game_component`) and names it.
 */
export const VERIFIED_NOT_MISSING = new Map([
  ['105::rivals', {
    root: 'Deep Rock Galactic: The Board Game',
    verifiedOn: '2026-09-07',
    verdict: 'HELD as Rival Incursion (item 90) — "Rivals" is the campaign wave, '
      + 'and MOOD Publishing\'s own store spells the expansion "Rivals Incursion"',
    evidence: 'MOOD Publishing store (26 products) and the Kickstarter '
      + '"Rival Incursion and Horrors of Hoxxes" (38 add-ons) both list NO product '
      + 'called Rivals; BGG lists only Rival Incursion (450336). Both of the wave\'s '
      + 'expansions are held: 90 and 809.',
  }],
  ['511::yokai dawn', {
    root: "Ryoko's Guide to the Yokai Realms",
    verifiedOn: '2026-09-07',
    verdict: 'NOT A PRODUCT — "Yokai Dawn" is a dice colourway, not a book or expansion',
    evidence: 'loottavern.com/product/yokai-dawn-resin-dice — SKU LTP-RG1-DiceBlueOrng, '
      + 'categories Dice / Physical / Ryoko´s Guide, described as "an opalescent '
      + 'sunrise". No Yokai Dawn title exists in the publisher\'s catalogue.',
  }],
  ['107::dragon class', {
    root: 'Here to Slay',
    verifiedOn: '2026-09-07',
    verdict: 'HELD as item 295, KS Exclusive Dragon Sorcerers Expansion Pack (bgg 308525) — '
      + '"Dragon Class" is the class that expansion adds, not a separate product',
    evidence: 'BGG lists Dragon Class Meeple Set (369124, 2020) beside Dragon Sorcerer '
      + 'Expansion (308525, 2020); the publisher\'s copy says the meeples "represent the '
      + 'Sorcerer class". Same shape as the 6-Class Meeple Set (369123) for the base game. '
      + '⚠ this read "items 863 and 295" until 2026-09-07: 863 was a DUPLICATE of 295 and '
      + 'was dropped that day, and 295 took its bgg_id. One product, one row.',
  }],
  ['428::3dition', {
    root: 'Ark Nova',
    verifiedOn: '2026-09-07',
    verdict: 'NOT AN EXPANSION — 3Dition is a third-party 3D upgrade line, and the eight '
      + 'rows 405-412 ARE that line; there is no ninth box to own',
    evidence: 'game_component holds Ark Nova: 3Dition (450126) typed expansion by BGG but '
      + 'classified official=0 by this repo\'s publisher-id rule. docs/info/completeness.md '
      + 'names the case: "Kekpop Spiele\'s 3D upgrades are typed boardgameexpansion by BGG".',
  }],
  ['53::magic', {
    root: 'Fractured Sky',
    verifiedOn: '2026-09-07',
    verdict: 'NOT A PRODUCT — Black Magic Craft is an insert maker, not an expansion',
    evidence: 'game_component for item 53 (checked ok 2026-08-30) holds nothing named '
      + 'Black Magic, and a component-wide search for %Black Magic% returns 0 rows. '
      + '⚠ the subject is `magic`, not `black magic`: `black` is a colour in PACKAGING.',
  }],
  ['92::minimalist flaming', {
    root: 'Dice Throne: Outcasts',
    verifiedOn: '2026-09-07',
    verdict: 'NOT A PRODUCT — "Minimalist (Flaming Die)" is a sleeve art style, one of the '
      + 'nineteen per-hero sleeve arts in this collection',
    evidence: 'game_component holds Dice Throne: Minimalist Premium Sleeves (476488) linked '
      + 'from nine Dice Throne items. Our catalogue holds 19 Dice Throne sleeve rows, one per '
      + 'art (- Wolverine, - Storm, - Pale Lady...).',
  }],
]);

/**
 * The whole sweep.
 *
 * @param {object} input
 * @param {Array} input.items      every `item` row: id, kind, name,
 *                                 parent_item_id, root_game_id, series, bgg_id,
 *                                 held, wanted
 * @param {Array} input.relations  `item_relation` rows: from_item_id,
 *                                 to_item_id, relation
 * @returns {{ findings: Array, counts: object }}
 */
export function sweep({ items, relations = [] }) {
  const byId = new Map(items.map((r) => [r.id, r]));
  const nameWordsOf = new Map(items.map((r) => [r.id, words(r.name)]));

  // Roots joined by a `same_family` edge answer for each other: Catan and
  // Catan: Starfarers are two roots and one family, and an accessory naming a
  // product held under the sibling root is PRESENT, not missing.
  const family = new Map();
  const link = (a, b) => {
    if (!family.has(a)) family.set(a, new Set([a]));
    family.get(a).add(b);
  };
  for (const rel of relations) {
    if (rel.relation !== 'same_family') continue;
    const from = byId.get(rel.from_item_id);
    const to = byId.get(rel.to_item_id);
    if (!from || !to) continue;
    link(from.root_game_id, to.root_game_id);
    link(to.root_game_id, from.root_game_id);
  }

  // Every row that could answer a subject, indexed by the root it sits under.
  const rowsByRoot = new Map();
  for (const r of items) {
    if (!rowsByRoot.has(r.root_game_id)) rowsByRoot.set(r.root_game_id, []);
    rowsByRoot.get(r.root_game_id).push(r);
  }

  const candidates = items.filter((r) => r.kind !== 'base');
  const findings = [];

  // Pass 1: the subject of every candidate, so pass 2 can count repeats.
  const parsed = new Map();
  for (const r of candidates) {
    const root = byId.get(r.root_game_id);
    parsed.set(r.id, subjectOf(r.name, root ? root.name : ''));
  }
  const subjectCount = new Map(); // `${rootId}::${subject}` -> n
  for (const r of candidates) {
    if (!NAMES_A_PRODUCT.has(r.kind)) continue;
    const s = parsed.get(r.id).subject;
    if (s.length === 0) continue;
    const key = `${r.root_game_id}::${s.join(' ')}`;
    subjectCount.set(key, (subjectCount.get(key) ?? 0) + 1);
  }

  for (const r of candidates) {
    const root = byId.get(r.root_game_id);
    const parent = r.parent_item_id == null ? null : byId.get(r.parent_item_id);
    const { subject: rawSubject, sharedPrefix } = parsed.get(r.id);

    // ---- question 1: the implied BASE GAME ----
    //
    // ⚠️ This asks only whether a base game is REACHABLE, and nothing about
    // whether the link is a good one. An earlier cut also failed a row whose
    // name shared no word with its root — which called 77 correct rows
    // AMBIGUOUS (every D&D sourcebook under `Dungeon Master's Guide (2024)`,
    // for one). Presence and corroboration are two facts; the second is the
    // `name_matches_base` column below, so a reader can see both.
    let baseStatus;
    let baseNote = '';
    if (!root) {
      baseStatus = MISSING;
      baseNote = r.root_game_id == null
        ? 'no root_game_id on the row'
        : `root_game_id ${r.root_game_id} names no row`;
    } else if (root.kind !== 'base') {
      // The tree's root is itself an expansion or an accessory, so the row does
      // not reach a base game by the repo's own links. Not a missing purchase —
      // a link this sweep cannot resolve.
      baseStatus = AMBIGUOUS;
      baseNote = root.id === r.id
        ? `self-rooted: this ${r.kind} is its own root, so no base game is implied`
        : `root is kind='${root.kind}', not a base game`;
    } else {
      baseStatus = PRESENT;
      if (parent == null) baseNote = 'no parent_item_id (nests directly under the root)';
    }
    // Corroboration, not presence: does the row's own name begin with its root
    // game's name? `no` is normal for a themed line (Ravenloft under the DMG)
    // and is also what a wrong parent link looks like.
    const nameMatchesBase = root && root.name ? (sharedPrefix > 0 ? 'yes' : 'no') : '';

    // ⚠️ A row that is not ASKED question 2 carries no answer to it. An
    // expansion (or a row that reaches no base game) with a `subject` filled in
    // reads like a verdict on that row, and there is none.
    const askable = baseStatus === PRESENT && NAMES_A_PRODUCT.has(r.kind);
    const subject = askable ? rawSubject : [];

    // ---- question 2: the implied PRODUCT named in the row ----
    let impliedStatus;
    let impliedName;
    let matchedIn = '';
    let subjectRows = 0;

    if (baseStatus !== PRESENT) {
      // ⚠️ The name rule reads a row's title AGAINST ITS ROOT GAME'S TITLE. If
      // the row reaches no base game there is nothing to read it against, and
      // the subject is whatever is left of the whole name — which is not an
      // implied product, it is noise. Measured 2026-09-07: the eighteen Pangea
      // gaming-table parts (furniture, rooted under the table itself) each
      // produced a MISSING row for a product like "cup" or "legs standard 26".
      // They are AMBIGUOUS for question 1 already; that is the honest answer to
      // question 2 as well.
      impliedStatus = baseStatus;
      impliedName = root ? root.name : '';
    } else if (!NAMES_A_PRODUCT.has(r.kind)) {
      // 🔴 An EXPANSION is itself the product an accessory would imply, so
      // asking whether it implies one is circular: every expansion would report
      // MISSING because nothing else in the collection is named after it.
      // Measured 2026-09-07 — leaving expansions in this half of the sweep
      // produced 444 MISSING rows, of which 257 were expansions announcing
      // their own existence. They answer question 1 and stop there.
      impliedStatus = baseStatus;
      impliedName = root ? root.name : '';
      matchedIn = baseStatus === PRESENT ? String(r.root_game_id) : '';
    } else if (subject.length === 0) {
      // Nothing but packaging: the row implies its base game and no more, and
      // question 1 has already answered for it.
      impliedStatus = baseStatus;
      impliedName = root ? root.name : '';
      matchedIn = baseStatus === PRESENT ? String(r.root_game_id) : '';
    } else {
      subjectRows = subjectCount.get(`${r.root_game_id}::${subject.join(' ')}`) ?? 0;
      const roots = family.get(r.root_game_id) ?? new Set([r.root_game_id]);
      const matches = [];
      for (const rootId of roots) {
        for (const other of rowsByRoot.get(rootId) ?? []) {
          if (other.id === r.id) continue;
          // An accessory naming the same subject is not evidence the PRODUCT
          // exists — three sleeves for a missing expansion is the Here to Slay
          // case exactly. Only a base game or an expansion answers.
          if (other.kind !== 'base' && other.kind !== 'expansion') continue;
          if (containsRun(nameWordsOf.get(other.id), subject)) matches.push(other);
        }
      }
      impliedName = `${root ? root.name : '?'} — ${subject.join(' ')}`;
      const matchedRoots = new Set(matches.map((m) => m.root_game_id));
      if (matches.length === 0) {
        // ⚠️ Settled BEFORE MISSING, and only where nothing matched: an entry in
        // the registry is an answer to "this row reported MISSING and was then
        // checked", so it can never mask a live PRESENT or AMBIGUOUS verdict.
        const settled = VERIFIED_NOT_MISSING.get(`${r.root_game_id}::${subject.join(' ')}`);
        if (settled) {
          impliedStatus = SETTLED;
          matchedIn = `${settled.verdict} [verified ${settled.verifiedOn}]`;
        } else {
          impliedStatus = MISSING;
        }
      } else if (matchedRoots.size > 1) {
        impliedStatus = AMBIGUOUS;
        matchedIn = matches.map((m) => m.name).join(' / ');
      } else {
        impliedStatus = PRESENT;
        matchedIn = matches.map((m) => m.name).join(' / ');
      }
    }

    findings.push({
      id: r.id,
      name: r.name,
      kind: r.kind,
      series: r.series ?? '',
      bgg_id: r.bgg_id ?? '',
      held: r.held ?? 0,
      wanted: r.wanted ?? 0,
      root_id: r.root_game_id ?? '',
      base_game: root ? root.name : '',
      base_status: baseStatus,
      name_matches_base: nameMatchesBase,
      base_note: baseNote,
      subject: subject.join(' '),
      subject_rows: subjectRows,
      implied_product: impliedName,
      implied_status: impliedStatus,
      matched_by: matchedIn,
    });
  }

  const tally = (key) => {
    // ⚠️ Every status is seeded to 0 so a status that never occurs reads as a
    // zero rather than a missing key — and so an unseeded one would throw here
    // instead of silently tallying NaN.
    const out = { PRESENT: 0, MISSING: 0, AMBIGUOUS: 0, SETTLED: 0 };
    for (const f of findings) out[f[key]] += 1;
    return out;
  };

  return {
    findings,
    counts: {
      rows: findings.length,
      byKind: findings.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {}),
      base: tally('base_status'),
      implied: tally('implied_status'),
      namedSubjects: findings.filter((f) => f.subject !== '').length,
      nameDisagreesWithBase: findings.filter((f) => f.name_matches_base === 'no').length,
    },
  };
}
