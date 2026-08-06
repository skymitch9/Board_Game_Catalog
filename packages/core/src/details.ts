/**
 * Which facts a catalog row owes, and which it may take from the box it came in.
 *
 * A leaf module, like `constants.ts`: it imports only from there, so `schemas.ts`
 * and the database layer can both build on it without reintroducing the cycle
 * that makes `z.enum()` receive `undefined`.
 *
 * ## Why this exists
 *
 * The details queue asked every row for the same six facts. Against a real
 * collection that is 694 items of which 79 are top-level — the other 615 are
 * expansions, promos, playmats and dice trays, each costing ~1.4¢ of Claude
 * usage to answer questions like *"who publishes the Dice Throne Vanguard dice
 * tray"*. The answer is "whoever publishes Dice Throne Vanguard", and it is
 * already in the database one row up.
 *
 * ## The three decisions, kept separate
 *
 * 1. **What a child may inherit** (`INHERITED_FIELDS`) — resolved at read time
 *    from the nearest ancestor that has a value. Nothing is written to the
 *    child's row: a stored copy would be indistinguishable later from a fact
 *    somebody actually verified, and would go stale the moment the parent was
 *    corrected. Reading it through is reversible and honest.
 * 2. **What a row is asked for at all** (`detailFieldsFor`) — the gap test the
 *    queue runs on. A field that inherits is never a gap on a child, and a field
 *    that is meaningless for a kind is never a gap either.
 * 3. **What may be written into a row at all** (`fillableFieldsFor`) — the
 *    stronger claim, and the one that was missing. See below.
 *
 * ## Not asked is not the same as never written
 *
 * Decisions 2 and 3 look like the same decision and are not, which is how a
 * dice tray ended up able to acquire a description of a dice game. The queue has
 * never asked an accessory for one — an accessory is filed under its game, and
 * anything with a parent is asked for nothing at all. But a lookup fired *at one
 * item* from its own page filled **every blank field the model returned**, and
 * "Dice Throne Vanguard: Dice Tray" searched by name finds Dice Throne Vanguard.
 * The tray is then a dice game for 2–6 players taking 40 minutes, sourced
 * plausibly, dated today and indistinguishable from a fact.
 *
 * The owner's instruction is the general form of that: *"maybe we remove the
 * desc of accessories all together, the name and potential photo should be
 * enough information for what something is. This is mainly a catalog of things i
 * own"*. So a field a kind cannot have is now refused on the way **in**, not
 * merely left off the shopping list — `fillableFieldsFor` gates both the paid
 * details run (`fieldsToFill`) and the free by-name lookup on the item page.
 *
 * ## The field-by-field reasoning
 *
 * | Field | Inherits | Demanded of | Refused on |
 * |---|---|---|---|
 * | `publisher` | **yes** | items with no parent | — |
 * | `publisherUrl` | **yes** | items with no parent | — |
 * | `yearPublished` | no | base games | — |
 * | `minPlayers` / `maxPlayers` | no | base games | accessories, promos, upgrades, rulesets |
 * | `playtimeMin` | no | base games | accessories, promos, upgrades, rulesets |
 * | `description` | no | base games | accessories, promos, upgrades |
 *
 * - **publisher / publisherUrl inherit.** The owner's instruction, verbatim:
 *   *"I dont super care if an expansion or accessory has a different
 *   publisher"*. It is also nearly always right — a promo pack is made by the
 *   people who make the game — and `publisherUrl` is what unblocks the official
 *   research tier, so inheriting it makes a child researchable for free.
 * - **yearPublished does not inherit.** An expansion published years after its
 *   base game is the common case, not the exception, and the year renders in the
 *   `<h1>` beside the name. A wrong year there is a visible false statement for
 *   a fact worth very little. Blank is better, so it is simply not asked for.
 * - **Player count and playing time do not inherit**, and this is the one that
 *   looks safe and is not. They describe *a game*: a dice tray has none, and an
 *   expansion mostly shares its base game's — except when it does not, and the
 *   exception is precisely the expansion that exists to change it. This catalog
 *   holds "Catan: Starfarers – 5-6 Player Extension"; inheriting 3–4 players
 *   onto it would be wrong in exactly the case anyone would look.
 * - **description never inherits.** A dice tray is not described by the base
 *   game's description. Copying it would be actively misleading rather than
 *   merely unhelpful.
 *
 * ## Why a child is asked for nothing
 *
 * Not "asked for the inheritable fields and usually satisfied": asked for
 * nothing. A child whose whole ancestry has no publisher is not fixed by
 * researching the child — it is fixed by researching the root, once, which then
 * answers for all fifty-three of its children. Queueing the children too would
 * pay fifty-three times for one answer.
 */

import { ITEM_KINDS, type ItemKind } from './constants.js';

/** The facts the details queue fills in. Ordered as they are reported. */
export const DETAIL_FIELDS = [
  'publisher',
  'publisherUrl',
  'yearPublished',
  'minPlayers',
  'playtimeMin',
  'description',
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** Field names as a person would say them. */
export const DETAIL_FIELD_LABEL: Record<DetailField, string> = {
  publisher: 'publisher',
  publisherUrl: 'publisher site',
  yearPublished: 'year',
  minPlayers: 'players',
  playtimeMin: 'playing time',
  description: 'description',
};

/**
 * Every field a details lookup can write.
 *
 * A superset of `DETAIL_FIELDS`, because what a run *fills* and what the queue
 * *asks for* are not the same set: `maxPlayers` is written when the model finds
 * it, but is never a gap on its own — a game missing only its upper player count
 * is not worth 1.4¢, and `minPlayers` stands for the pair in the queue.
 */
export const FILL_FIELDS = [...DETAIL_FIELDS, 'maxPlayers'] as const;
export type FillField = (typeof FILL_FIELDS)[number];

/**
 * Every field a details lookup can write, as a person would say it.
 *
 * Both player counts read as "players", so a run that filled the pair says it
 * once.
 */
export const FILLED_FIELD_LABEL: Record<string, string> = {
  ...DETAIL_FIELD_LABEL,
  maxPlayers: 'players',
};

/**
 * The fields a blank child resolves from its nearest ancestor with a value.
 *
 * Deliberately short. Everything else on the list either describes a game being
 * played — which an accessory is not — or is wrong often enough that a blank is
 * the better answer. See the file header.
 */
export const INHERITED_FIELDS = ['publisher', 'publisherUrl'] as const;
export type InheritedField = (typeof INHERITED_FIELDS)[number];

/** Enough of an item to decide what it owes. Structural, so rows fit too. */
export interface DetailSubject {
  kind: ItemKind | string;
  parentItemId: number | null;
  /** A ruleset the row belongs to — "D&D 5e (2014)", "Cypher System". */
  gameSystem?: string | null;
  publisher?: string | null;
  publisherUrl?: string | null;
  yearPublished?: number | null;
  minPlayers?: number | null;
  playtimeMin?: number | null;
  description?: string | null;
}

/**
 * The facts that describe a game while it is being played.
 *
 * **A rulebook is not a game with a duration**, and neither is a dice tray. The
 * Player's Handbook has no player count and no playing time; a session is as
 * long as the table wants and the party is as big as it turns up. Asking bought
 * a confident invention — "3–6 players, 240 minutes" — at 1.4¢ a book, and there
 * are 79 rows carrying `D&D 5e (2014)` alone.
 */
const OF_A_GAME_IN_PLAY: readonly FillField[] = ['minPlayers', 'maxPlayers', 'playtimeMin'];

/**
 * Kinds that are a thing you own rather than a game you play.
 *
 * *"the name and potential photo should be enough information for what
 * something is. This is mainly a catalog of things i own"* — the owner, about
 * accessories, and it decides the whole set. A sleeve pack, a playmat, a promo
 * card and a set of metal coins are all objects belonging to a game rather than
 * games, so none of them has a player count, a length, or a description that is
 * not just its game's description wearing the wrong name.
 *
 * The measured case for it: of **356 accessories only 3 carry a description**
 * and of **48 promos only 1** — after months of cataloguing, so it is not a
 * field anyone was going to fill. What the field did do was give a lookup
 * somewhere to put a plausible sentence: "Dice Throne Vanguard: Dice Tray"
 * matches Dice Throne Vanguard by name, and the tray becomes a dice game for
 * 2–6 players.
 *
 * **`expansion` is deliberately absent.** An expansion can genuinely have its
 * own description, and — the case that settles it — its own player count: this
 * catalog holds *Catan: Starfarers – 5-6 Player Extension*, an expansion whose
 * entire purpose is to change the number this would have refused to record.
 */
const A_THING_NOT_A_GAME: readonly (ItemKind | string)[] = ['accessory', 'promo', 'upgrade'];

/**
 * The facts that cannot exist for this row, whoever asks and whatever they find.
 *
 * Two independent reasons, and a row can carry both. `gameSystem` is keyed on
 * being set at all rather than on a list of systems: the column exists precisely
 * to say "this is played under a ruleset", and a hardcoded list would need
 * editing every time the owner buys a new one.
 *
 * A ruleset keeps its description — a rulebook is a thing there is something to
 * say about — while an accessory does not.
 */
export function impossibleFields(
  kind: ItemKind | string,
  gameSystem?: string | null,
): FillField[] {
  const impossible = new Set<FillField>();
  if (A_THING_NOT_A_GAME.includes(kind)) {
    impossible.add('description');
    for (const field of OF_A_GAME_IN_PLAY) impossible.add(field);
  }
  if (!isBlankDetail(gameSystem)) {
    for (const field of OF_A_GAME_IN_PLAY) impossible.add(field);
  }
  // Rebuilt from FILL_FIELDS so the order is the order everything else reports.
  return FILL_FIELDS.filter((field) => impossible.has(field));
}

/**
 * The facts a lookup may write into this row.
 *
 * The gate on the way *in*, applied to whatever a lookup came back with rather
 * than to what it was sent to find. `detailFieldsFor` is the shopping list;
 * this is the door. Unasked-for and refused are different, and only the second
 * one stops a playmat acquiring its game's blurb from a lookup somebody fired
 * at it by hand.
 */
export function fillableFieldsFor(
  kind: ItemKind | string,
  gameSystem?: string | null,
): FillField[] {
  const impossible = impossibleFields(kind, gameSystem);
  return FILL_FIELDS.filter((field) => !impossible.includes(field));
}

/**
 * The facts this row is asked for.
 *
 * `hasParent` and not `kind === 'base'`, because the thing that makes a fact
 * free is having somewhere to inherit it from. An orphan expansion — one
 * catalogued before its game arrived — has no ancestor, so it is still asked for
 * a publisher; the day its game turns up and `adoptOrphans` re-parents it, it
 * stops being asked, with nothing to clean up.
 *
 * `kind` and `gameSystem` narrow it further — see `impossibleFields`. Nothing
 * impossible can survive here, though in practice the two rules barely meet: a
 * parentless non-base row is only ever asked for the two inheritable fields,
 * and neither of those is ever impossible.
 */
export function detailFieldsFor(
  kind: ItemKind | string,
  hasParent: boolean,
  gameSystem?: string | null,
): DetailField[] {
  if (hasParent) return [];
  const asked: DetailField[] = kind === 'base' ? [...DETAIL_FIELDS] : [...INHERITED_FIELDS];
  const impossible = impossibleFields(kind, gameSystem);
  return asked.filter((field) => !impossible.includes(field));
}

/** True for null, undefined, and a string of nothing but spaces. */
export function isBlankDetail(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/** What this row is asked for and does not have. Empty means "not in the queue". */
export function detailGaps(item: DetailSubject): DetailField[] {
  return detailFieldsFor(item.kind, item.parentItemId != null, item.gameSystem).filter((field) =>
    isBlankDetail(item[field]),
  );
}

/**
 * Every case that can be asked for something, with what it is asked for.
 *
 * Exported so the SQL that runs this test over 736 rows can be *generated* from
 * the policy rather than restating it. A `WHERE` clause typed out by hand would
 * be a second implementation of the decision, and the two would drift the first
 * time a kind was added.
 *
 * Two branches per kind now — with a `game_system` and without — because the
 * answer differs between them and the generator must produce both. `hasSystem`
 * is what the SQL turns into a predicate on the column.
 */
export function detailGapBranches(): {
  kind: ItemKind;
  hasSystem: boolean;
  fields: DetailField[];
}[] {
  const branches: { kind: ItemKind; hasSystem: boolean; fields: DetailField[] }[] = [];
  for (const kind of ITEM_KINDS) {
    for (const hasSystem of [false, true]) {
      const fields = detailFieldsFor(kind, false, hasSystem ? 'a ruleset' : null);
      if (fields.length > 0) branches.push({ kind, hasSystem, fields });
    }
  }
  return branches;
}

/** A value shown on a child that belongs to an ancestor, and where it came from. */
export interface InheritedDetail {
  value: string;
  fromItemId: number;
  fromName: string;
}
