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
 */
function statusFor(
  component: KnownComponent,
  owned: OwnedThing[],
  gameName: string,
): ComponentStatus {
  const base = { ...component, matchedItemId: null, matchedName: null, note: null };

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

  const official = live.filter((s) => s.official === true);
  const third = live.filter((s) => s.official === false).sort(byRecency);

  return {
    itemId: input.itemId,
    bggId: input.bggId,
    state,
    checkedAt: input.checkedAt,
    expansions: sectionFor(official.filter((s) => s.kind === 'expansion')),
    accessories: sectionFor(official.filter((s) => s.kind === 'accessory')),
    thirdParty: {
      total: third.length,
      held: third.filter((s) => s.state === 'held').length,
      components: third,
    },
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
