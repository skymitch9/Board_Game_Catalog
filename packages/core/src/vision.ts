/**
 * Leaf module: reading games off a photograph.
 *
 * **Photos are transient.** Nobody wants a camera roll full of pictures only one
 * app needed, and the same logic applies server-side: a photo is captured into
 * memory, sent, read, and dropped. It is never written to the device's photo
 * library, never stored in D1, and never put in R2 unless the owner explicitly
 * asks for a cover image on a copy. This constrains capture to a live
 * `getUserMedia` frame grab — the one path on iOS that provably touches nothing.
 *
 * Two different jobs, deliberately kept apart:
 *
 *   identify  one box, read carefully -> a BarcodeCandidate, same shape every
 *             other rung of the ladder answers in
 *   shelf     many spines, read broadly -> plain titles to be matched afterwards
 *
 * Shelf reading returns *titles*, not candidates, because resolving twelve
 * spines through web search would take minutes and cost more than the whole
 * feature is worth. Matching happens afterwards, against the local catalog and
 * the free lookup rungs.
 *
 * Imports nothing. No I/O.
 */

/** One title read off a spine or cover, before anything tries to resolve it. */
export interface ShelfTitle {
  /** Exactly the text as printed, no expansion or correction. */
  text: string;
  confidence: 'high' | 'medium' | 'low';
  /** Where on the shelf, left to right, so the user can find it again. */
  position: number;
  /** Why it is uncertain: glare, partly hidden, stylised type. */
  note: string | null;
}

/**
 * A shelf title once we have tried to match it against what we know.
 *
 * `alreadyOwned` is the point of the whole screen — re-adding games you already
 * have is the obvious failure mode of bulk intake, so it is resolved before the
 * user is asked to tick anything.
 */
export interface ShelfMatch {
  title: ShelfTitle;
  /** Set when this title matches something already in the collection. */
  existingItemId: number | null;
  existingName: string | null;
  /** Best guess from the free lookup rungs, when it found one. */
  bggId: number | null;
  resolvedName: string | null;
  thumbnailUrl: string | null;
  /**
   * How well `resolvedName` matches what was actually read off the spine, 0..1.
   * Null when nothing was resolved. Below `MIN_TITLE_SIMILARITY` the match is a
   * guess and must not be acted on without the user looking at it.
   */
  similarity: number | null;
}

/**
 * Long edge, in pixels, to downscale a photo to before upload.
 *
 * Claude charges images in 28x28 patches: ceil(w/28) * ceil(h/28) visual tokens.
 * Opus 5 is in the high-resolution tier — it accepts up to 2576px on the long
 * edge and caps at 4784 visual tokens, downscaling anything larger server-side.
 *
 * 1500px is the sweet spot for a box: a title occupies a large fraction of the
 * frame and is already 100+px tall at this size, so the extra pixels up to 2576
 * roughly double the cost for no gain. A 48MP iPhone photo is pure waste — it
 * gets downscaled anyway, after you have paid to upload it.
 */
export const PHOTO_LONG_EDGE = 1500;

/**
 * Fold a title down to something comparable.
 *
 * Spines print titles in ways the catalog never will — all caps, ampersands,
 * accented type, a leading article. None of that changes which game it is.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // Café -> Cafe
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Match a title read off a shelf against items already in the collection.
 *
 * Exact-after-normalising first, then containment — a spine reading "CATAN"
 * finds "Catan", and one reading "Catan Seafarers" finds "Catan: Seafarers".
 * Containment is checked both ways because a spine may print more or less than
 * the catalog does. The longest match wins, so "Catan: Seafarers" beats plain
 * "Catan" when the spine actually said Seafarers.
 *
 * A containment match requires the shorter string to be at least 60% of the
 * longer one's length — otherwise "Scythe" would falsely match "Scythe:
 * Invaders from Afar". That threshold catches abbreviations and extra subtitles
 * while rejecting base-game-inside-expansion matches.
 *
 * Deliberately conservative: no fuzzy edit-distance matching. A wrong match
 * silently merges two different games, which is far worse than asking about one
 * the user already owns.
 */
export function matchExistingTitle<T extends { id: number; name: string }>(
  title: string,
  existing: readonly T[],
  aliases: readonly ItemAliasRef[] = [],
): T | null {
  return matchIndexedTitle(buildTitleIndex(existing, aliases), title);
}

/**
 * One known other name for one item — see `migrations/0021_item_alias.sql`.
 *
 * Structural rather than the db package's row type, so `packages/core` stays a
 * leaf with no I/O and nothing to import.
 */
export interface ItemAliasRef {
  itemId: number;
  alias: string;
}

/**
 * The catalog's names, folded once, ready to be asked about repeatedly.
 *
 * `matchExistingTitle` normalises every name it is given on every call, which is
 * right for one question and wrong for seventy: a shelf photo asked against 760
 * items re-folds 53,000 strings. Building the index once and asking it N times
 * is the same decision, made the same way — this exists so nobody writes a
 * second, faster, subtly different matcher when the loop starts to hurt.
 */
export interface TitleIndex<T> {
  entries: { item: T; key: string }[];
  /**
   * Folded alternate names, exact-match only. Kept apart from `entries` rather
   * than flagged inside it because the two are asked *different questions* —
   * see `matchIndexedTitle`.
   */
  aliasKeys: Map<string, T>;
}

/**
 * Fold the catalog, and fold what else each row answers to.
 *
 * **Two rules keep an alias from becoming the wrong-game bug it exists to
 * prevent**, and both drop the alias rather than guess:
 *
 * 1. **A real name always wins.** An alias folding to some *other* item's actual
 *    name is discarded outright. BoardGameGeek's alternates are not curated
 *    against this catalog and one of them will eventually be a game somebody
 *    owns — BGG 13 alone offers the bare "The Settlers".
 * 2. **A contested alias belongs to nobody.** BGG 13 and BGG 152959 both list
 *    "Los Colonos de Catán", so owning both would make that string ambiguous.
 *    Picking either is how two different games get silently merged, which this
 *    module's own comment calls far worse than asking about one you already own.
 *
 * An alias equal to its own item's name is dropped as redundant, not as a
 * collision — that is the ordinary case for a row whose primary name we already
 * hold.
 */
export function buildTitleIndex<T extends { id: number; name: string }>(
  existing: readonly T[],
  aliases: readonly ItemAliasRef[] = [],
): TitleIndex<T> {
  const entries = existing.map((item) => ({ item, key: normaliseTitle(item.name) }));

  if (aliases.length === 0) return { entries, aliasKeys: new Map() };

  const byId = new Map(existing.map((item) => [item.id, item]));
  const realNames = new Map<string, number>();
  for (const e of entries) if (!realNames.has(e.key)) realNames.set(e.key, e.item.id);

  const claimed = new Map<string, T | null>(); // null = contested, do not use
  for (const a of aliases) {
    const item = byId.get(a.itemId);
    if (!item) continue;
    const key = normaliseTitle(a.alias);
    if (key.length < 2) continue;

    const realOwner = realNames.get(key);
    if (realOwner !== undefined) continue; // rule 1 — an item's own name wins

    const seen = claimed.get(key);
    if (seen === undefined) claimed.set(key, item);
    else if (seen !== null && seen.id !== item.id) claimed.set(key, null); // rule 2
  }

  const aliasKeys = new Map<string, T>();
  for (const [key, item] of claimed) if (item) aliasKeys.set(key, item);

  return { entries, aliasKeys };
}

/**
 * `matchExistingTitle`, against a pre-folded catalog. Identical rules.
 *
 * **Aliases answer the exact question only, and that is the whole design.** A
 * name is compared three ways here, in falling order of how much it claims:
 *
 * | | |
 * |---|---|
 * | exact, real name | the same game, said the same way |
 * | exact, alias | the same game, said another way — asserted, not inferred |
 * | containment, real name only | a guess, gated at 60% of the longer string |
 *
 * An alias is an *identity claim* about one specific string, so it needs no
 * similarity score and gets no similarity credit. Letting aliases into the
 * containment pass would undo the guard: "The Settlers of Catan" would start
 * swallowing "The Settlers of Catan: Seafarers", which is a different box, and
 * the fragment rule in `isConfidentMatch` would have nothing left to protect.
 * Adding a *known other name* is not the same as lowering the floor, and the
 * floor is not lowered — `MIN_SPINE_SIMILARITY` is untouched at 0.7.
 */
export function matchIndexedTitle<T extends { id: number; name: string }>(
  index: TitleIndex<T>,
  title: string,
): T | null {
  const target = normaliseTitle(title);
  if (target.length < 2) return null;

  const exact = index.entries.find((e) => e.key === target);
  if (exact) return exact.item;

  const aliased = index.aliasKeys.get(target);
  if (aliased) return aliased;

  return (
    index.entries
      .filter((e) => {
        if (e.key.length < 3) return false;
        const contains = e.key.includes(target) || target.includes(e.key);
        if (!contains) return false;
        // Require the shorter string to be at least 60% of the longer one.
        // This prevents "Scythe" matching "Scythe: Invaders from Afar".
        const shorter = Math.min(e.key.length, target.length);
        const longer = Math.max(e.key.length, target.length);
        return shorter / longer >= 0.6;
      })
      .sort((a, b) => b.key.length - a.key.length)[0]?.item ?? null
  );
}

/**
 * Shelves earn the extra pixels: a dozen spines share the frame, so each title
 * is a fraction of the height a single box cover gets. 2400 stays under the
 * 2576px high-resolution ceiling, so nothing is re-scaled server-side.
 */
export const SHELF_LONG_EDGE = 2400;

// ---------------------------------------------------------------------------
// Post-scan classification
// ---------------------------------------------------------------------------

export interface ClassifiedItem {
  /** The original index in the shelf results array. */
  index: number;
  name: string;
  /** Proposed kind based on name analysis. */
  proposedKind: 'base' | 'expansion';
  /** If classified as expansion, the existing item it likely belongs to. */
  proposedParentId: number | null;
  proposedParentName: string | null;
  /**
   * The base game read off this title that is *not* in the collection.
   *
   * "Wingspan: European Expansion" implies a "Wingspan" that may not be here
   * yet. The default proposal stays `base` — plenty of standalone games carry a
   * subtitle — but the prefix is kept so that choosing expansion has a name to
   * remember, rather than forcing a choice between the wrong kind and nothing.
   */
  inferredParentName: string | null;
  /** Why we think this is an expansion (for display). */
  reason: string | null;
  /** Original ShelfMatch data preserved for the add flow. */
  bggId: number | null;
  thumbnailUrl: string | null;
}

/**
 * Classify shelf scan results by matching title prefixes against the collection.
 *
 * Board game expansions almost always follow one of these patterns:
 * - "Base Game: Expansion Name" (colon)
 * - "Base Game - Expansion Name" (dash)
 *
 * If the part before the separator matches an existing base game in the
 * collection, propose this as an expansion of that game. Also catches items
 * being added in the *same batch* — if "Scythe" and "Scythe: Invaders" are
 * both in the list, Invaders gets classified under Scythe even before Scythe
 * is saved.
 *
 * This is a heuristic, not a certainty — the UI shows the proposal and lets
 * the user override before anything is written.
 */
export function classifyShelfResults(
  items: { name: string; bggId: number | null; thumbnailUrl: string | null }[],
  existing: readonly { id: number; name: string; kind: string }[],
  aliases: readonly ItemAliasRef[] = [],
): ClassifiedItem[] {
  // Build a lookup of existing items by normalised name.
  const existingByKey = new Map<string, { id: number; name: string }>();
  for (const item of existing) {
    existingByKey.set(normaliseTitle(item.name), { id: item.id, name: item.name });
  }

  // A prefix may be an *alternate* name of the game it belongs to, and then it
  // is the same question one level down: "The Settlers of Catan: Seafarers" is
  // an expansion of the box filed as "Catan". Same collision rules as the
  // matcher — `buildTitleIndex` has already dropped anything contested or
  // shadowed by a real name — and real names still win, because they are
  // written first and only missing keys are filled in.
  for (const [key, item] of buildTitleIndex(existing, aliases).aliasKeys) {
    if (!existingByKey.has(key)) existingByKey.set(key, { id: item.id, name: item.name });
  }

  // First pass: classify each item. We also track batch items (things being
  // added in the same scan) so "Scythe: X" can find "Scythe" even if Scythe
  // isn't saved yet.
  const batchBases = new Map<string, { index: number; name: string }>();
  const results: ClassifiedItem[] = [];

  // Collect all base-looking items first (no separator).
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const prefix = extractPrefix(item.name);
    if (!prefix) {
      // No separator — this is a base game candidate. Register it for batch matching.
      batchBases.set(normaliseTitle(item.name), { index: i, name: item.name });
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const { name, bggId, thumbnailUrl } = item;
    const prefix = extractPrefix(name);

    if (!prefix) {
      results.push({
        index: i,
        name,
        proposedKind: 'base',
        proposedParentId: null,
        proposedParentName: null,
        inferredParentName: null,
        reason: null,
        bggId,
        thumbnailUrl,
      });
      continue;
    }

    const normPrefix = normaliseTitle(prefix);

    // Check existing collection first.
    const existingMatch = existingByKey.get(normPrefix);
    if (existingMatch) {
      results.push({
        index: i,
        name,
        proposedKind: 'expansion',
        proposedParentId: existingMatch.id,
        proposedParentName: existingMatch.name,
        inferredParentName: null,
        reason: `"${prefix}" is already in your collection`,
        bggId,
        thumbnailUrl,
      });
      continue;
    }

    // Check if the base game is in this same batch.
    const batchMatch = batchBases.get(normPrefix);
    if (batchMatch) {
      results.push({
        index: i,
        name,
        proposedKind: 'expansion',
        proposedParentId: null, // No ID yet — it hasn't been saved
        proposedParentName: batchMatch.name,
        inferredParentName: null,
        reason: `"${prefix}" is also in this scan`,
        bggId,
        thumbnailUrl,
      });
      continue;
    }

    // Has a separator but no match — might still be a standalone game with a
    // subtitle (e.g. "Dice Throne: Mystic Brawler" where there's no "Dice Throne"
    // base). Propose as base.
    results.push({
      index: i,
      name,
      proposedKind: 'base',
      proposedParentId: null,
      proposedParentName: null,
      // Kept rather than discarded: if this really is an expansion, the base
      // game's name is right there in the title and is the only clue we will
      // get about what to attach it to later.
      inferredParentName: prefix,
      reason: `"${prefix}" is not in your collection — if this is an expansion, it will wait for it`,
      bggId,
      thumbnailUrl,
    });
  }

  return results;
}

/**
 * Extract the part before the first `:` or ` - ` separator.
 * Returns null if no separator is found (it's a standalone title).
 */
function extractPrefix(name: string): string | null {
  // Colon first — "Scythe: Invaders from Afar"
  const colonIdx = name.indexOf(':');
  if (colonIdx > 2) return name.slice(0, colonIdx).trim();

  // Spaced dash — "Catan - Traders & Barbarians" (not hyphens inside words)
  const dashIdx = name.indexOf(' - ');
  if (dashIdx > 2) return name.slice(0, dashIdx).trim();

  return null;
}

/**
 * Games sitting at the top level whose name says they belong to another.
 *
 * The clean-up counterpart to `classifyShelfResults`: that one classifies
 * titles on their way in, this one finds the ones that got in wrongly. Both
 * read the same signal — the part of a name before a colon — because the same
 * signal is what was missed.
 *
 * It exists because a bulk scan produces this mess in bulk. Twenty games came
 * off one shelf photo tagged as base games when a dozen were expansions, and
 * fixing that a page at a time is enough work that it does not get done.
 *
 * Every result is a *proposal*. The heuristic cannot tell "Scythe: Invaders
 * from Afar" (an expansion) from "CATAN: Starfarers" (a standalone game that
 * merely shares a brand), and guessing wrong buries a real game inside another
 * one. `confident` marks the rows whose name says "expansion" outright — those
 * are safe to tick for you. The rest are a judgment call and are offered, not
 * assumed.
 */
export interface RetagSuggestion {
  itemId: number;
  name: string;
  currentKind: string;
  proposedParentId: number;
  proposedParentName: string;
  /** The name says "expansion"/"extension" outright, so it needs no judgement. */
  confident: boolean;
  reason: string;
}

/** Words that state the relationship rather than leaving it to be inferred. */
const EXPLICIT_EXPANSION = /\b(expansion|extension|expansions)\b/i;

/**
 * Every leading fragment of a name, shortest first.
 *
 * Broader than `extractPrefix`, which stops at the first separator: publishers
 * nest two deep ("Catan: Starfarers – 5-6 Player Extension"), and the en dash
 * they favour is not a hyphen. Returned shortest-first so a caller taking the
 * last match gets the most specific parent it actually owns.
 */
function prefixCandidates(name: string): string[] {
  const out: string[] = [];
  const separators = [':', ' - ', ' – ', ' — '];
  for (let i = 1; i < name.length; i++) {
    for (const sep of separators) {
      if (name.startsWith(sep, i)) {
        const prefix = name.slice(0, i).trim();
        if (prefix.length > 2) out.push(prefix);
        break;
      }
    }
  }
  return out;
}

export function suggestRetags(
  items: readonly { id: number; name: string; kind: string; parentItemId: number | null }[],
  existingPairs: ReadonlySet<string> = new Set(),
): RetagSuggestion[] {
  const byKey = new Map<string, { id: number; name: string }>();
  for (const item of items) byKey.set(normaliseTitle(item.name), { id: item.id, name: item.name });

  const suggestions: RetagSuggestion[] = [];
  for (const item of items) {
    // Only things standing on their own. An item already filed under a parent
    // is not what this screen is for, whatever its name looks like.
    if (item.kind !== 'base' || item.parentItemId !== null) continue;

    // Longest match wins. "Catan: Starfarers – 5-6 Player Extension" contains
    // both "Catan" and "Catan: Starfarers", and only the longer one is its
    // actual parent — filing it under Catan would put a Starfarers expansion
    // in the wrong tree while looking like a success.
    let parent: { id: number; name: string } | undefined;
    for (const prefix of prefixCandidates(item.name)) {
      const found = byKey.get(normaliseTitle(prefix));
      if (found && found.id !== item.id) parent = found;
    }
    if (!parent) continue;

    // A link is an answer. Saying "standalone, same family" settles the only
    // question this screen asks, so the row leaves — it used to stay, greyed
    // out but still there, which reads as the click not having worked.
    if (existingPairs.has(`${item.id}:${parent.id}`)) continue;

    const explicit = EXPLICIT_EXPANSION.test(item.name);
    suggestions.push({
      itemId: item.id,
      name: item.name,
      currentKind: item.kind,
      proposedParentId: parent.id,
      proposedParentName: parent.name,
      confident: explicit,
      reason: explicit
        ? `Says "expansion" in the name, so it almost certainly needs "${parent.name}".`
        : `Shares a name with "${parent.name}" — which does not say whether it needs it.`,
    });
  }

  return suggestions;
}

/**
 * Standalone games that belong to the same family.
 *
 * The mirror image of `suggestRetags`, off the same signal. Both find a game
 * whose name contains another game you own; they differ only in what that
 * ought to mean. "Scythe: Invaders from Afar" is a box you cannot play without
 * Scythe, so it belongs *inside* Scythe. "CATAN: Starfarers" is a complete game
 * that happens to wear the Catan name, so it belongs *beside* Catan — filed on
 * its own, and linked.
 *
 * No heuristic separates those two, which is why the app never decides: the
 * re-filing screen offers the first reading, this offers the second, and the
 * same row can be answered either way. The discriminator is one only you have:
 * can you play it without the other box.
 *
 * Pairs already linked are dropped, so an answered suggestion stops being one.
 */
/**
 * JPEG quality for the downscaled upload.
 *
 * 0.85, not lower: the phone's photo is *already* lossy, so this is a second
 * compression pass and the artifacts stack exactly on the letterforms we need to
 * read. Below ~0.7 small type visibly mushes. One decode, one resize, one encode.
 */
export const PHOTO_QUALITY = 0.85;

/**
 * iOS Safari refuses to render a canvas whose area exceeds this, and does it
 * *silently* — you get a blank image rather than an error. A 48MP iPhone photo
 * (8064x6048) is roughly three times over. This is why downscaling must happen
 * during decode via `createImageBitmap({resizeWidth})` rather than by drawing
 * the full-size image to a canvas first.
 */
export const IOS_MAX_CANVAS_AREA = 16_777_216;


/** Request bodies cap out well below this; a guard beats a confusing 413. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
