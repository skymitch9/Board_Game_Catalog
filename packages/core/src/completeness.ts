/**
 * "What am I missing" — official expansions and accessories, versus what we hold.
 *
 * BoardGameGeek knows, per game, every expansion and accessory ever linked to
 * it. This module holds the two decisions that turn those lists into a shopping
 * list, and nothing else: **is this component official**, and **do we already
 * have it**. No I/O; the fetching lives in `apps/worker/src/lib` and the storage
 * in `packages/db`.
 *
 * Imports `barcode.ts` for `isConfidentMatch` and nothing from `index.ts` — see
 * the note at the top of that file about the import cycle.
 */

import { isConfidentMatch, titleSimilarity } from './barcode.js';

// ---------------------------------------------------------------------------
// Official versus third-party
// ---------------------------------------------------------------------------

/**
 * A publisher as BoardGameGeek links it: an id and a name.
 *
 * **The id is the reason this is a pair and not a string.** BGG publishers are
 * linked entities, so "Rebel Sp. z o.o." always carries id 7466 wherever it
 * appears. Comparing ids makes the official/third-party split exact and removes
 * the entire class of bug where a legal suffix, an accent or a rebrand quietly
 * turns an official expansion into a third-party one.
 */
export interface PublisherRef {
  id: number;
  name: string;
}

/**
 * Names BoardGameGeek uses for "we do not know", written as if they were
 * publishers: `(Self-Published)`, `(Unknown)`, `(Web published)`.
 *
 * Excluded from the comparison because they are not identities. Two
 * self-published things share that link and nothing else, and letting them
 * match would mark a stranger's insert as an official component — the exact
 * false positive this feature must not produce.
 */
function isRealPublisher(p: PublisherRef): boolean {
  return !p.name.trim().startsWith('(');
}

/**
 * Did the people who made the game make this too?
 *
 * The owner's rule: third-party does not count towards completeness, but stays
 * checkable on demand. BGG lists a Folded Space insert beside a publisher's own
 * expansion with nothing to tell them apart except who made them.
 *
 * Any overlap counts, because both lists are full of localisation houses and a
 * component is usually credited to a subset of the game's publishers rather
 * than all of them. Measured on Ark Nova: `Zoo Map Pack 1` shares twelve of the
 * base game's twenty publishers, while `Ark Nova: 3Dition` shares none — its
 * only publisher is Kekpop Spiele, who did not make Ark Nova.
 *
 * Returns **null** only when the *game* has no real publisher either. Then
 * there is no yardstick, and calling anything third-party would be inventing
 * one — a self-published game's own supplement would be thrown out of its
 * count.
 *
 * A component with no real publisher against a game that *has* one is third
 * party, and confidently so: BoardGameGeek credits it to `(Web published)` or
 * `(Self-Published)`, which is how it labels a fan expansion. Measured on the
 * local catalog, 170 of 1,137 components sit in exactly this state — "Alaska
 * (fan expansion for Ticket to Ride)" among them — and every one of them is
 * something a stranger made. Leaving them unclassified would have parked a
 * seventh of the data in "we do not know" and made every count look partial.
 */
export function isOfficialComponent(
  componentPublishers: PublisherRef[] | null | undefined,
  gamePublishers: PublisherRef[] | null | undefined,
): boolean | null {
  const theirs = (componentPublishers ?? []).filter(isRealPublisher);
  const ours = (gamePublishers ?? []).filter(isRealPublisher);
  if (ours.length === 0) return null;
  if (theirs.length === 0) return false;

  const ids = new Set(ours.map((p) => p.id));
  return theirs.some((p) => ids.has(p.id));
}

// ---------------------------------------------------------------------------
// Chaseable versus collectible
// ---------------------------------------------------------------------------

/**
 * Words that mean "this was a one-off, not a thing you can go and buy".
 *
 * *"We're getting bogged down by things like promo cards, or limited 1-off
 * items, random collectible vinyl figures."* — the owner. The shopping list is
 * the whole point of this feature, and a convention card handed out in 2014 is
 * not shopping; it is a fact about the past. Terraforming Mars is the case that
 * makes it unusable: **76 official expansions, 57 of them single promo cards**.
 *
 * Publisher tells us nothing here — these are made by the same people who made
 * the game, which is exactly why `isOfficialComponent` waves them through. The
 * only signal in the data is the name, so the name is what this reads.
 *
 * Measured against the local catalog on 2026-08-08: **180 of 660** official
 * components matched. Terraforming Mars' expansions fall 76 → 19, Sheriff of
 * Nottingham's 17 → 7, Scythe's 16 → 5, Mysterium's 8 → 2, and Twisted
 * Cryptids' accessories 19 → 8 as its eleven vinyl cryptids leave.
 *
 * ⚠️ **Deliberately a rough cut, and it must stay one.** The owner asked for
 * "it doesn't need to be perfect", and every term here was checked against the
 * 660 real names rather than imagined:
 *
 * - `dice tower`, `spiel essen` and `adventskalender` are **not** here even
 *   though they name promo distributors. Every such row in the catalog already
 *   says "promo" as well, and "Dice Tower" is also a real accessory a game can
 *   genuinely have.
 * - `anniversary` is not here. "Ticket to Ride: Deluxe Train Set – 20th
 *   Anniversary" is a limited run, but so are ordinary reprints described that
 *   way, and the cost of dropping a real expansion is the one this feature
 *   cannot pay.
 * - `foil` and `holo` are word-bounded so "tinfoil" and "Holocene" cannot match.
 *
 * What it does not catch, and knowingly: Catan's fifty regional scenarios
 * ("Catan Geographies: Mallorca") are as unbuyable as any promo, but nothing in
 * their names says so, and guessing from language or place would be a different
 * and much worse rule. Catan falls 82 → 80. The size collapse in the UI is what
 * carries that case.
 */
const COLLECTIBLE_TERMS =
  /\bpromo\w*\b|\bvinyl\b|\bexclusives?\b|\blimited edition\b|\balt(ernate)? art\b|\bfoils?\b|\bholo(graphic)?\b|\bkickstarter\b|\bindiegogo\b|\bgen ?con\b|\bconvention\b|\bcollector'?s\b/i;

/**
 * Is this a promo or a collectible rather than something to chase?
 *
 * Exported because it is a judgement the owner will want to argue with, and an
 * argument needs something to point at.
 */
export function isCollectible(name: string): boolean {
  return COLLECTIBLE_TERMS.test(name);
}

// ---------------------------------------------------------------------------
// Do we have it?
// ---------------------------------------------------------------------------

/** One component BoardGameGeek lists for a game, as stored. */
export interface KnownComponent {
  /** The `game_component` row id — the identity the UI keys on. */
  id: number;
  bggId: number;
  name: string;
  kind: 'expansion' | 'accessory';
  publishers: PublisherRef[] | null;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  /** Null until the component's own details have been fetched. */
  official: boolean | null;
  /** True when BoardGameGeek has stopped listing this. Kept, never deleted. */
  stale: boolean;
  /**
   * The owner's own verdict, when no BoardGameGeek id can carry one.
   *
   * See migration 0022. `'have'` means *we hold this, it just is not a catalog
   * row of its own* — sleeves that came inside a Kickstarter box, an accessory
   * pack that BoardGameGeek lists per hero. Null means the ordinary rules
   * decide.
   */
  manualState?: 'have' | null;
  /** Why, in the owner's words. Shown verbatim rather than paraphrased. */
  manualNote?: string | null;
}

/** One thing in our catalog that could be a component of this game. */
export interface OwnedThing {
  itemId: number;
  name: string;
  bggId: number | null;
  /** At least one copy says we hold it — `owned`, `lent` or `preordered`. */
  held: boolean;
  /** Catalogued, but every copy is `wanted`: already on the shopping list. */
  wanted: boolean;
}

/**
 * `held` is the only state that counts towards completeness.
 *
 * `uncertain` exists because a false "you already own this" costs the owner a
 * purchase they wanted and never tells them why, while a false "missing" is a
 * visible annoyance they can correct in one look. So anything short of a
 * BoardGameGeek id agreeing lands here, and here is counted as missing.
 */
export type ComponentState = 'held' | 'missing' | 'uncertain';

export interface ComponentStatus extends KnownComponent {
  state: ComponentState;
  /** The catalog row this was matched to, when it was matched to one. */
  matchedItemId: number | null;
  matchedName: string | null;
  /** Why this is not simply held. Shown to the owner verbatim. */
  note: string | null;
}

/**
 * Drop the game's own name off the front of one of its components' titles.
 *
 * **Without this, name matching inside a family is noise.** Every one of Here
 * to Slay's thirty-six components begins "Here to Slay", and so does every row
 * filed under it, so three words agree before anything meaningful is compared.
 * Measured against the real collection: matching the full strings paired
 * "Central Play Mat" with "Warriors & Druids Play Mat Set" at 0.71 and
 * "6-Class Meeple Set" with "6-Class Dice Set" — nine hints, almost all wrong.
 * Comparing what is left after the shared prefix, all nine disappear and the
 * one genuine pair (an identically named meeple set) survives at 1.00.
 *
 * This is not a second similarity function — `isConfidentMatch` still makes
 * every decision. It is the same trick `classifyShelfResults` already uses on
 * spine text: the part of a title that identifies *which* product this is comes
 * after the game's name, not before it.
 *
 * Stripping is skipped when nothing would be left, so an expansion named
 * exactly after its game still has something to compare.
 */
function withoutGamePrefix(title: string, gameName: string): string {
  const t = title.trim();
  const g = gameName.trim();
  if (g.length === 0 || !t.toLowerCase().startsWith(g.toLowerCase())) return t;

  // The separators publishers actually use, plus the space that follows them.
  const rest = t.slice(g.length).replace(/^[\s:\u2013\u2014-]+/, '').trim();
  return rest.length > 0 ? rest : t;
}

/**
 * Decide one component's state against everything filed under the game.
 *
 * **A BoardGameGeek id is the only thing that proves ownership here.** Name
 * comparison is offered as a *hint* — it flags a likely match and still counts
 * the component as missing, because `isConfidentMatch` was built for matching
 * spine text where a false positive costs a tap, and this is a context where a
 * false positive costs a purchase the owner wanted and never explains itself.
 *
 * **The one exception is the owner saying so directly**, and it is checked
 * first. `manual_state` exists precisely for components no id can ever settle —
 * sleeves that came inside a Kickstarter box, which BoardGameGeek lists per
 * hero and which were never a separate purchase. The strict rule is there to
 * stop *the software* guessing; it was never meant to overrule the person
 * holding the box. Its note is carried through so the row still says why it is
 * held, rather than presenting a human verdict as machine proof.
 */
function statusFor(
  component: KnownComponent,
  owned: OwnedThing[],
  gameName: string,
): ComponentStatus {
  const base = { ...component, matchedItemId: null, matchedName: null, note: null };

  if (component.manualState === 'have') {
    return {
      ...base,
      state: 'held',
      note: component.manualNote?.trim() || 'Marked as owned by hand — no separate catalog row.',
    };
  }

  const byId = owned.find((o) => o.bggId != null && o.bggId === component.bggId);
  if (byId) {
    if (byId.held) {
      return { ...base, state: 'held', matchedItemId: byId.itemId, matchedName: byId.name };
    }
    return {
      ...base,
      state: 'uncertain',
      matchedItemId: byId.itemId,
      matchedName: byId.name,
      note: byId.wanted
        ? 'Already on your wishlist.'
        : 'In your catalog, but no copy is recorded against it.',
    };
  }

  // Only rows with no id of their own are worth comparing by name: a row whose
  // BoardGameGeek id disagrees is a different product, however alike they read.
  //
  // **The best candidate, not the first.** Taking the first row that clears the
  // floor is how "Dragon Class Meeple Set" ended up hinted against "6-Class
  // Dice Set" while an identically named row sat further down the list —
  // several members of a family clear the bar and list order decided which won.
  const theirs = withoutGamePrefix(component.name, gameName);
  const byName = owned
    .filter((o) => o.bggId == null)
    .map((o) => ({ o, ours: withoutGamePrefix(o.name, gameName) }))
    .filter(({ ours }) => isConfidentMatch(ours, theirs))
    .sort((a, b) => titleSimilarity(b.ours, theirs) - titleSimilarity(a.ours, theirs))[0]?.o;

  if (byName) {
    return {
      ...base,
      state: 'uncertain',
      matchedItemId: byName.itemId,
      matchedName: byName.name,
      note: `Possibly “${byName.name}”, matched on name alone — counted as missing until a BoardGameGeek id says otherwise.`,
    };
  }

  return { ...base, state: 'missing' };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** One counted category: official expansions, or official accessories. */
export interface CompletenessSection {
  /** Official components of this kind that BoardGameGeek lists. */
  total: number;
  /** How many of those a BoardGameGeek id proves we hold. */
  held: number;
  /**
   * How many of the rest look like something already in the catalog.
   *
   * Shown beside the count rather than folded into it. Without this the strict
   * rule reads as a worse collection than the owner has — a "Dragon Class
   * Meeple Set" whose name matches exactly but carries no BoardGameGeek id is
   * almost certainly the same thing — while folding it in would be the false
   * "you already own this" the strict rule exists to prevent. Saying both is
   * the only honest option, and it points at the fix: set the id.
   */
  uncertain: number;
  /** The rest, missing and uncertain alike, newest first. */
  outstanding: ComponentStatus[];
}

/**
 * Why a game has no answer, when it has none.
 *
 * These must never read as "complete". 525 of 640 catalog rows are not on
 * BoardGameGeek at all — Kickstarter promos, a Pangea table's nineteen
 * furniture components, seventy-five D&D Beyond books — and telling their owner
 * they own everything that exists would make this feature actively misleading.
 */
export type CompletenessState =
  /** No `bgg_id`, so there is nothing to compare against and never will be. */
  | 'not_on_bgg'
  /** Has an id; nobody has asked BoardGameGeek yet. */
  | 'never_checked'
  /** Asked, and BoardGameGeek returned nothing for the id. */
  | 'not_found'
  /** Asked and answered. */
  | 'checked';

export interface GameCompleteness {
  itemId: number;
  bggId: number | null;
  state: CompletenessState;
  /** When BoardGameGeek was last asked. Null unless `state` is checked/not_found. */
  checkedAt: string | null;
  expansions: CompletenessSection;
  accessories: CompletenessSection;
  /**
   * Everything a different publisher made. Never counted, always available.
   *
   * Carries its own held count so the disclosure can say "you have 3 of these"
   * without them touching the headline figure.
   */
  thirdParty: { total: number; held: number; components: ComponentStatus[] };
  /**
   * Official, but a promo or a collectible. Never counted, always available.
   *
   * Same shape and same bargain as `thirdParty`, for the same reason: the
   * owner wants these out of the way "for the most part but check if we want
   * something specific when desired". They are kept apart from `thirdParty`
   * rather than folded into it because the two answer different questions — one
   * is *somebody else made this*, the other is *you cannot buy this* — and a
   * promo made by the game's own publisher would be a lie in a group labelled
   * third-party.
   */
  collectibles: { total: number; held: number; components: ComponentStatus[] };
  /**
   * Components the owner marked as held by hand — a *review* list, not a split.
   *
   * ⚠️ **These are already counted in the sections above**, unlike `thirdParty`
   * and `collectibles`, which this deliberately does not resemble in meaning
   * despite sharing a shape. It exists because `sectionFor` puts only
   * `state !== 'held'` into `outstanding`: the moment a component is marked, it
   * leaves the visible list and there is nowhere left to click undo. A verdict
   * you cannot see is a verdict you cannot withdraw, and this one is a human
   * claim rather than a machine one — so it has to stay auditable.
   */
  manual: { total: number; held: number; components: ComponentStatus[] };
  /**
   * Components whose own publisher has not been fetched yet.
   *
   * Counted in neither total. A component with no publisher cannot be placed on
   * either side of the split, and guessing which side would corrupt the one
   * number this feature exists to produce.
   */
  unclassified: number;
  /** Components BoardGameGeek has stopped listing. Marked, never deleted. */
  stale: number;
}

/** Newest first, then alphabetical — what a person scanning for a name expects. */
function byRecency(a: ComponentStatus, b: ComponentStatus): number {
  return (b.yearPublished ?? 0) - (a.yearPublished ?? 0) || a.name.localeCompare(b.name);
}

function sectionFor(components: ComponentStatus[]): CompletenessSection {
  return {
    total: components.length,
    held: components.filter((c) => c.state === 'held').length,
    uncertain: components.filter((c) => c.state === 'uncertain').length,
    outstanding: components.filter((c) => c.state !== 'held').sort(byRecency),
  };
}

/**
 * Turn the stored components and the catalog into the report the page renders.
 *
 * Pure, so the interesting half of this feature can be exercised without a
 * database: hand it a component list and an owned list and it answers.
 */
export function buildCompleteness(input: {
  itemId: number;
  bggId: number | null;
  /** The game's own name — stripped off both sides before any name comparison. */
  gameName: string;
  checkedAt: string | null;
  outcome: 'ok' | 'not_found' | null;
  components: KnownComponent[];
  owned: OwnedThing[];
}): GameCompleteness {
  const state: CompletenessState =
    input.bggId == null
      ? 'not_on_bgg'
      : input.checkedAt == null
        ? 'never_checked'
        : input.outcome === 'not_found'
          ? 'not_found'
          : 'checked';

  // The game itself is never a component of itself, and leaving it in the
  // comparison set lets a base game answer for one of its own expansions.
  const owned = input.owned.filter((o) => o.itemId !== input.itemId);
  const statuses = input.components.map((c) => statusFor(c, owned, input.gameName));

  // A stale component is still shown, but it is not evidence about what exists
  // today, so it stays out of every denominator.
  const live = statuses.filter((s) => !s.stale);

  // Two splits, in this order. Third-party first, because "somebody else made
  // this" is decided from stored publisher ids and is the stronger fact; a
  // stranger's promo card belongs under third-party, where it already was.
  // Only what survives that is asked whether it is chaseable.
  const third = live.filter((s) => s.official === false).sort(byRecency);
  const official = live.filter((s) => s.official === true);
  const chaseable = official.filter((s) => !isCollectible(s.name));
  const collectible = official.filter((s) => isCollectible(s.name)).sort(byRecency);

  return {
    itemId: input.itemId,
    bggId: input.bggId,
    state,
    checkedAt: input.checkedAt,
    expansions: sectionFor(chaseable.filter((s) => s.kind === 'expansion')),
    accessories: sectionFor(chaseable.filter((s) => s.kind === 'accessory')),
    thirdParty: {
      total: third.length,
      held: third.filter((s) => s.state === 'held').length,
      components: third,
    },
    collectibles: {
      total: collectible.length,
      held: collectible.filter((s) => s.state === 'held').length,
      components: collectible,
    },
    // Drawn from `live` rather than from any one split, because a hand-marked
    // component can be official, third-party or a collectible and the owner
    // still needs one place to find what they claimed.
    manual: (() => {
      const marked = live.filter((s) => s.manualState === 'have').sort(byRecency);
      return {
        total: marked.length,
        held: marked.filter((s) => s.state === 'held').length,
        components: marked,
      };
    })(),
    unclassified: live.filter((s) => s.official == null).length,
    stale: statuses.filter((s) => s.stale).length,
  };
}

/** What one backfill or refresh run did, for the routes to report. */
export interface ComponentBackfillRun {
  /** Games whose component list was re-read from BoardGameGeek. */
  gamesChecked: number;
  /** Components inserted for the first time — the "something new" number. */
  componentsAdded: number;
  /** Components seen again, and their names/last-seen refreshed. */
  componentsSeen: number;
  /** Components BoardGameGeek stopped listing this run. Marked, not deleted. */
  componentsMarkedStale: number;
  /** Components whose own publisher was fetched, so they could be classified. */
  componentsClassified: number;
  /** Requests actually made to BoardGameGeek. Each covers up to 20 ids. */
  bggCalls: number;
  /** Games still awaiting a first or overdue check. */
  gamesRemaining: number;
  /** Components still unclassified after this run. */
  unclassifiedRemaining: number;
  failures: { detail: string }[];
}
