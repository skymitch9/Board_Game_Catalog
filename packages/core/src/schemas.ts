/**
 * Request/response contracts shared by the Worker, the web app, and (phase 4)
 * the CLI. Validation lives here so the three can never disagree about shape.
 */

import { z } from 'zod';
import { COPY_FORMATS, COPY_STATUSES, ITEM_KINDS, RELATION_TYPES } from './constants.js';
import type { InheritedDetail, InheritedField } from './details.js';

export const itemKindSchema = z.enum(ITEM_KINDS);
export const copyStatusSchema = z.enum(COPY_STATUSES);
export const copyFormatSchema = z.enum(COPY_FORMATS);

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemFields = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  kind: itemKindSchema,
  /**
   * BoardGameGeek id, when something already resolved it — a barcode lookup or a
   * photo both hand one back. Storing it is what stops a later BGG import
   * creating a second copy of a game you already scanned in.
   */
  bggId: z.number().int().positive().nullable().optional(),
  parentItemId: z.number().int().positive().nullable().optional(),
  /**
   * The base game this belongs to, when it is not in the collection yet.
   *
   * Set only for a parentless expansion, accessory, promo or upgrade. Holds the
   * name to watch for — usually the prefix read off a spine — and is cleared the
   * moment a matching game is created and the orphan is adopted.
   */
  pendingParentName: nullableString(200),
  yearPublished: z.number().int().min(1000).max(2200).nullable().optional(),
  publisher: nullableString(200),
  publisherUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('')),
  /**
   * The campaign this came from — a Kickstarter or Gamefound project page.
   *
   * Not the same thing as `publisherUrl`, and an item can carry both: one is
   * the publisher's own site, the other is where *this pledge* was made. For
   * two thirds of the catalog the campaign page is the only authoritative
   * record there is, since the box never had a retail listing.
   */
  sourceUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('')),
  /**
   * Which ruleset this needs, for the things that do not carry their own.
   *
   * Free text on purpose — the space of systems is open, and an enum here would
   * be rewritten every time a new one arrives. "D&D 5e (2014)", "Cypher
   * System", "system-agnostic". Null for every board game, which is most of the
   * catalog, and null must render as nothing rather than as "unknown".
   */
  gameSystem: nullableString(100),
  /**
   * The line this belongs to — "Dice Throne", "Ascension".
   *
   * A *label*, never a place in the tree. Eleven Dice Throne boxes stay eleven
   * roots; the collection page folds them into one entry and offers the name as
   * a filter. Making it a parent row instead would put 147 rows in one tree, and
   * search matches trees — so every hit for any hero would return the whole
   * line. See `docs/dice-throne-shape.md`.
   *
   * Free text, like `gameSystem`, and null for almost everything.
   */
  series: nullableString(100),
  designers: nullableString(500),
  minPlayers: z.number().int().min(1).max(99).nullable().optional(),
  maxPlayers: z.number().int().min(1).max(999).nullable().optional(),
  playtimeMin: z.number().int().min(1).max(10000).nullable().optional(),
  weight: z.number().min(0).max(5).nullable().optional(),
  thumbnailUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('')),
  description: nullableString(5000),
});

/**
 * A non-base item needs a parent, *or* the name of one to wait for.
 *
 * The second half is the point. Requiring a real parent meant an expansion
 * found on a shelf before its base game could not be recorded as an expansion
 * at all, so both add flows saved it as a base game instead — which put it in
 * the collection as a root and threw away what it actually was. Naming what it
 * is waiting for keeps the record honest until the base game turns up.
 */
export const createItemSchema = itemFields.refine(
  (d) =>
    d.kind === 'base' ||
    (d.parentItemId != null && d.parentItemId > 0) ||
    (d.pendingParentName != null && d.pendingParentName.trim() !== ''),
  {
    message:
      'an expansion, accessory, promo or upgrade needs a base game — either pick one, or name the one it is waiting for',
    path: ['parentItemId'],
  },
);

export const updateItemSchema = itemFields
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

// ---------------------------------------------------------------------------
// Copies — the physical things on our shelf
// ---------------------------------------------------------------------------

const copyFields = z.object({
  editionId: z.number().int().positive().nullable().optional(),
  appliesToCopyId: z.number().int().positive().nullable().optional(),
  /** How many identical copies this row stands for. */
  quantity: z.number().int().min(1).max(999).default(1),
  status: copyStatusSchema.default('owned'),
  /** A thing or a licence. Defaults to `physical`, which is 564 of 639 rows. */
  format: copyFormatSchema.default('physical'),
  isSleeved: z.boolean().default(false),
  isPunched: z.boolean().default(false),
  completenessNotes: nullableString(1000),
  lentTo: nullableString(120),
  notes: nullableString(1000),
});

export const createCopySchema = copyFields;
export const updateCopySchema = copyFields
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });

export type CreateCopyInput = z.infer<typeof createCopySchema>;
export type UpdateCopyInput = z.infer<typeof updateCopySchema>;

// ---------------------------------------------------------------------------
// Ratings — the one per-person thing
// ---------------------------------------------------------------------------

export const upsertRatingSchema = z.object({
  rating: z.number().int().min(1).max(10).nullable(),
  notes: nullableString(1000),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;

// ---------------------------------------------------------------------------
// Relations — standalone games that belong together
// ---------------------------------------------------------------------------

export const relationTypeSchema = z.enum(RELATION_TYPES);

export const createRelationSchema = z.object({
  toItemId: z.number().int().positive(),
  relation: relationTypeSchema,
});

export type CreateRelationInput = z.infer<typeof createRelationSchema>;

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

export const itemQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: copyStatusSchema.optional(),
  kind: itemKindSchema.optional(),
  /** Only base games with no copies recorded anywhere in their tree. */
  uncatalogued: z.coerce.boolean().optional(),
  /** Only trees containing something we hold more than one of. */
  duplicates: z.coerce.boolean().optional(),
  /** An exact ruleset, chosen from the ones actually in use. Free text in the
   *  column, so matched exactly rather than fuzzily — the dropdown is built
   *  from the distinct values, so there is nothing to guess at. */
  gameSystem: z.string().trim().max(100).optional(),
  /** An exact series. Matched like `gameSystem`, and for the same reasons. */
  series: z.string().trim().max(100).optional(),
  /**
   * Fold each series and each game system into a single entry.
   *
   * Off by default, so a caller that knows nothing about groups is handed game
   * trees exactly as before. **Ignored while searching or while inside a
   * group** — see `listItemTrees`. Send it only when true: `z.coerce.boolean()`
   * reads the string "false" as true, which is the same convention the other
   * flags here already follow.
   */
  grouped: z.coerce.boolean().optional(),
  /** 1-based. The size of a page is the server's decision, not the caller's. */
  page: z.coerce.number().int().min(1).optional(),
});

export type ItemQuery = z.infer<typeof itemQuerySchema>;

/**
 * Split a search box into the words that must all be found.
 *
 * "catan seafarers" is two facts about one game tree, and they live in different
 * rows: the first is the base game's name, the second an expansion's. Treating
 * the box as one string requires them adjacent in a single field, which they
 * never are. Every term has to match *something* in the tree; no term has to
 * match the same thing as another.
 *
 * Lowercased here so the SQL and the "why did this match" check downstream
 * cannot drift apart on case.
 */
export function searchTerms(q: string | undefined | null): string[] {
  if (!q) return [];
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface Item {
  id: number;
  bggId: number | null;
  kind: (typeof ITEM_KINDS)[number];
  parentItemId: number | null;
  rootGameId: number | null;
  /** Set when this hangs off a game that is not in the collection yet. */
  pendingParentName: string | null;
  name: string;
  sortName: string | null;
  yearPublished: number | null;
  publisher: string | null;
  publisherUrl: string | null;
  /** The campaign page this pledge came from. Distinct from `publisherUrl`. */
  sourceUrl: string | null;
  /** The ruleset a book needs. Null for anything that carries its own rules. */
  gameSystem: string | null;
  /** The line this box belongs to. A label, never a place in the tree. */
  series: string | null;
  designers: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  weight: number | null;
  thumbnailUrl: string | null;
  /**
   * A picture borrowed from the nearest ancestor that has one. **Never stored.**
   *
   * Present only when `thumbnailUrl` is blank *and* an ancestor could answer, so
   * a non-null value always means "this art belongs to something else" and the
   * item page can say whose it is. See `packages/core/src/covers.ts`.
   *
   * Optional because it is resolved by the read paths that assemble trees and
   * item pages; a row fetched for a write does not carry it, and nothing may
   * persist it.
   */
  inheritedCover?: InheritedDetail | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Copy {
  id: number;
  itemId: number;
  editionId: number | null;
  appliesToCopyId: number | null;
  quantity: number;
  status: (typeof COPY_STATUSES)[number];
  /** `physical` for a box on a shelf, `digital` for a licence. */
  format: (typeof COPY_FORMATS)[number];
  isSleeved: boolean;
  isPunched: boolean;
  completenessNotes: string | null;
  lentTo: string | null;
  notes: string | null;
  /**
   * When this copy joined the collection, as an ISO instant. Set by the
   * database on insert and never editable — it records a fact about the
   * catalog, not a claim about the box.
   */
  addedAt: string;
}

export interface Rating {
  userId: number;
  email: string;
  displayName: string | null;
  rating: number | null;
  notes: string | null;
  ratedAt: string;
}

/** An item plus everything hanging off it — the unit the list page renders. */
export interface ItemNode extends Item {
  copies: Copy[];
  children: ItemNode[];
  /**
   * Why this tree is in the results, when the answer is not the game itself.
   *
   * Set only on a root, only when searching, and only when the root's own name,
   * publisher and designers do not account for every term. Searching "seafarers"
   * and being handed "Catan" looks arbitrary until the row says the match was on
   * "Catan: Seafarers" — which is the expansion you were looking for, filed
   * where it belongs.
   */
  matchedChildren?: MatchedChild[];
}

/**
 * A child that explains a search hit, and the box it is in.
 *
 * The parent travels with it because that is the answer to the question being
 * asked. Searching "scarlet witch" is the first half of the owner's journey;
 * the second half is *which box do I pull off the shelf*, and a bare child name
 * does not answer it. It reads "Scarlet Witch — Marvel Dice Throne", and both
 * halves are links.
 */
export interface MatchedChild {
  id: number;
  name: string;
  parentId: number | null;
  parentName: string | null;
}

/**
 * Two axes, one mechanism.
 *
 * `series` is a line of boxes — the eleven Dice Thrones. `system` is a ruleset
 * — the 79 rows that need D&D 5e, which sit in **nine different trees** because
 * 53 of them are books inside D&D and 26 are third-party products that merely
 * *require* the Player's Handbook. Filing Auroboros inside D&D would misdescribe
 * what the owner owns, so that split is correct and stays. Grouping therefore
 * has to work over both, or the more valuable half does not work at all.
 */
export type GroupAxis = 'series' | 'system';

/** One series or system, folded into a single entry on the collection page. */
export interface CollectionGroup {
  /** `series:Dice Throne`. The paging unit's identity, and the React key. */
  key: string;
  axis: GroupAxis;
  name: string;
  /** Top-level lines folded into this entry — 11, for Dice Throne. */
  lines: number;
  /** Rows across those lines' trees — 147, for Dice Throne. */
  items: number;
  owned: number;
  /** Might buy. Kept apart from `preordered` — see `summarizeTree`. */
  wanted: number;
  /** Paid for and on its way. */
  preordered: number;
  /**
   * Copies held as a licence, and as a thing.
   *
   * Shown because a combined 5e list is exactly where "do I have this on paper
   * or only on D&D Beyond?" gets asked, and the answer is otherwise buried one
   * level down.
   */
  digital: number;
  physical: number;
  /** The lines themselves, so the card names what it folded up. */
  members: { id: number; name: string; items: number; thumbnailUrl: string | null }[];
}

/**
 * One thing on the collection page: a game tree, or a group standing for
 * several.
 *
 * A single ordered list rather than two, because the two kinds are interleaved
 * alphabetically and paged together — "Dice Throne" sits where the Dice Thrones
 * were. Returning groups separately would either put them all at the top of
 * every page or break paging.
 */
export type CollectionEntry =
  | { key: string; kind: 'tree'; tree: ItemNode }
  | { key: string; kind: 'group'; group: CollectionGroup };

/**
 * One page of the collection, and how much there is in total.
 *
 * `total` counts every matching entry, not the ones on this page: the header
 * needs to say "104 entries" while showing 25 of them, and a count that shrank
 * to the page size would make paging look like filtering. `totalRoots` counts
 * game trees, which is the same number when nothing is grouped and a larger one
 * when something is — that difference is the feature, so both are reported.
 */
export interface ItemPage {
  entries: CollectionEntry[];
  total: number;
  totalRoots: number;
  /** 1-based, and clamped to the last page when asked for one past the end. */
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ItemDetail extends Item {
  copies: Copy[];
  children: ItemNode[];
  ratings: Rating[];
  relatedItems: RelatedItemRef[];
  parent: Item | null;
  /**
   * Blank fields answered by the nearest ancestor that has one.
   *
   * Resolved on read and never written down, which is the whole point: the
   * catalog goes on saying that this playmat's publisher is unknown, while the
   * page shows the game's and says where it came from. A stored copy would be
   * indistinguishable from a fact somebody checked. See `details.ts`.
   *
   * Empty for anything with no parent, and for a child that already has its own
   * value — only genuine gaps appear here.
   */
  inherited: Partial<Record<InheritedField, InheritedDetail>>;
}

/**
 * One thing we want but do not have — the unit the wishlist renders.
 *
 * Deliberately item-level rather than tree-level. Every other listing query
 * matches whole game trees so that finding an expansion also surfaces its base
 * game, which is right for browsing and wrong here: the Ark Nova tree holds two
 * wanted items and eight preordered upgrades, and a tree-shaped wishlist would
 * show all ten. A wishlist is a shopping list, so it lists exactly the copies
 * marked `wanted` and nothing that merely sits beside one.
 *
 * `copyId` rather than `itemId` is the identity, because the wanted-ness is a
 * property of the copy — it is the copy that gets flipped to `owned` when the
 * box arrives.
 */
export interface WishlistEntry {
  copyId: number;
  itemId: number;
  name: string;
  kind: (typeof ITEM_KINDS)[number];
  /** The game this hangs off, so "Marine Worlds" reads as an Ark Nova expansion. */
  parentItemId: number | null;
  parentName: string | null;
  thumbnailUrl: string | null;
  /** Borrowed from the nearest ancestor with art. See `covers.ts`. */
  inheritedCover?: InheritedDetail | null;
  publisher: string | null;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  bggId: number | null;
  quantity: number;
  /** Whatever was written on the copy — "birthday", "pledged, wave 2". */
  notes: string | null;
  /** When it was added to the wishlist, as an ISO instant. */
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Filling in details — a paid lookup that outlives the request that asked
// ---------------------------------------------------------------------------

/**
 * One background "fill in the blanks" lookup, as the queue page sees it.
 *
 * The whole reason this is a row and not a response body: the call takes tens
 * of seconds, and it used to be held open inside the request. A phone locking
 * mid-lookup paid for the search and threw the answer away. The run is written
 * before the call starts and finished after it lands, so navigating away costs
 * nothing — come back and the outcome is here.
 *
 * `filled` and `detail` are the two possible outcomes of a *successful* run, and
 * they are not the same as an error: "that game could not be identified" is an
 * answer, and a run that answers it is `done`.
 */
export interface DetailsRun {
  id: number;
  itemId: number;
  status: 'queued' | 'running' | 'done' | 'error';
  /** Only for `error` — the lookup itself failed, rather than finding nothing. */
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * What this run cost, in cents, from its own token counts.
   *
   * Computed server-side because the price of a model is not something a
   * browser should hold an opinion about — and because the queue page's running
   * total has to keep meaning the same thing after a reload, when the numbers
   * come back from the database rather than from the response that produced
   * them.
   */
  estimatedCents: number;
  /** Field names as a person would say them: "publisher", "year". */
  filled: string[];
  /** Said when nothing was filled, so the row explains itself. */
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Cover health — every thumbnail is somebody else's file
// ---------------------------------------------------------------------------

/**
 * What one probe of a cover URL found.
 *
 * `dead` and `error` are kept apart because they license different actions. A
 * 404 is the host telling us the file is gone; a timeout is the host telling us
 * nothing at all. Only the first is worth reporting quickly.
 */
export type CoverOutcome = 'ok' | 'dead' | 'error';

/** An item whose cover has failed often enough to be believed. */
export interface DeadCover {
  itemId: number;
  name: string;
  kind: (typeof ITEM_KINDS)[number];
  url: string;
  /** Null when the request never got an answer at all. */
  statusCode: number | null;
  outcome: CoverOutcome;
  consecutiveFailures: number;
  lastCheckedAt: string;
}

export interface CoverHealth {
  dead: DeadCover[];
  /** Distinct cover URLs in the catalog. */
  total: number;
  /** How many of those have been probed at least once. */
  checked: number;
  /** Failing, but not yet often enough to be called dead. */
  suspect: number;
  lastRunAt: string | null;
}

/** The summary a single check run reports back. */
export interface CoverCheckRun {
  checked: number;
  ok: number;
  dead: number;
  errors: number;
  /** Cover URLs still never probed, after this run. */
  unchecked: number;
}

// ---------------------------------------------------------------------------
// Cover candidates — the printings you may choose between
// ---------------------------------------------------------------------------

/**
 * Where a candidate cover came from.
 *
 * `campaign` is not a special case bolted on beside BoardGameGeek — a
 * Kickstarter or Gamefound edition is a printing like any other, and the only
 * reason it needs its own label is that nobody but us records it.
 */
export type CoverSource = 'bgg' | 'campaign' | 'current' | 'other';

/**
 * What the checker last knew about this image, so a candidate that will render
 * as a broken box can say so before it is picked.
 *
 * `suspect` is failing but not yet often enough to be believed — the same
 * one-failure-is-not-enough rule the health banner uses.
 */
export type CoverStatus = 'ok' | 'dead' | 'suspect' | 'unknown';

/** One cover you could choose for an item. */
export interface CoverCandidate {
  /** The edition row behind it, or null for a cover held only by the item. */
  editionId: number | null;
  url: string;
  /** "2019 English edition", "Gamefound: Altera", "Current cover". */
  label: string;
  year: number | null;
  publisher: string | null;
  language: string | null;
  source: CoverSource;
  /** True for the one currently on the item. Exactly one, when there are any. */
  selected: boolean;
  status: CoverStatus;
}

export interface CoverCandidates {
  itemId: number;
  /**
   * How much a missing cover matters here.
   *
   * Not decoration: the owner cares a lot about game and expansion artwork,
   * somewhat about miniatures, and barely at all about accessories and
   * components. A sleeve pack with no picture is fine and not worth chasing; a
   * base game without one is worth real effort. The picker says which of those
   * it is looking at rather than nagging identically about both.
   */
  kind: (typeof ITEM_KINDS)[number];
  /** Whatever the item wears right now, which may be nothing. */
  currentUrl: string | null;
  /** Null when the item was never matched to BoardGameGeek — the usual reason there is nothing to pick between. */
  bggId: number | null;
  /** True once a BGG backfill has actually asked about this item's printings. */
  printingsFetched: boolean;
  /** Deduplicated by URL; the selected one first, then newest printing first. */
  candidates: CoverCandidate[];
}

/** What one backfill run did, for the owner-triggered routes to report. */
export interface EditionBackfillRun {
  itemsConsidered: number;
  itemsUpdated: number;
  editionsAdded: number;
  /** Requests actually made to BoardGameGeek. Each covers several items. */
  bggCalls: number;
  /** Items with a bgg_id whose printings are still unfetched after this run. */
  remaining: number;
  failures: { itemId: number; bggId: number; detail: string }[];
}

/** A game linked via item_relation — standalone but connected. */
export interface RelatedItemRef {
  /**
   * The link that says so, or null when this game is family by implication.
   *
   * Link Starfarers to Catan and New Energies to Catan, and Starfarers and New
   * Energies are family too — with no row between them. Only a real link can be
   * removed, which is why unlinking lives on the edit form.
   */
  relationId: number | null;
  itemId: number;
  name: string;
  kind: string;
  thumbnailUrl: string | null;
  relation: (typeof RELATION_TYPES)[number];
  /**
   * True when the item being viewed is the `from` side of the stored row.
   *
   * Only meaningful for a directional relation, and there it is the whole
   * meaning: `requires` with `outgoing: true` reads "this needs that", and with
   * `outgoing: false` reads "that needs this". Without it the Player's Handbook
   * would list eight supplements and claim to require every one of them.
   *
   * False for a member reached through the family rather than by a link of its
   * own, which is correct by accident and harmless by design — family is
   * symmetric, so there is no direction to get wrong.
   */
  outgoing: boolean;
}

/** How many of this item we hold, counting quantities across all its copies. */
export function ownedCount(copies: Copy[]): number {
  return copies
    .filter((c) => c.status === 'owned' || c.status === 'lent')
    .reduce((sum, c) => sum + (c.quantity || 1), 0);
}

/**
 * Aggregate shown on a collapsed base-game card.
 *
 * **`wanted` and `preordered` are counted apart**, and folding them back
 * together is the bug this replaced: an *Ascension* card read "45 wanted" over
 * 22 items, because 45 was every pledge in the tree plus the two things anybody
 * actually wanted. Might-buy and paid-for-and-shipping are not the same fact,
 * and the card is where the difference is most visible.
 *
 * These are **units**, unlike the catalog-wide figures in `collectionStats`,
 * which are rows. Not an oversight: `owned` beside them has to be units or the
 * multi-copy `×N` feature disappears from the card, and a card is a summary of
 * a shelf rather than of a list. The rule is that a number counts what the
 * thing it links to counts — these link nowhere.
 */
export function summarizeTree(node: ItemNode): {
  owned: number;
  wanted: number;
  preordered: number;
  totalItems: number;
  /** Items in this tree we hold more than one of. */
  duplicates: { id: number; name: string; count: number }[];
} {
  let owned = 0;
  let wanted = 0;
  let preordered = 0;
  let totalItems = 0;
  const duplicates: { id: number; name: string; count: number }[] = [];

  const walk = (n: ItemNode) => {
    totalItems += 1;
    const held = ownedCount(n.copies);
    owned += held;
    if (held > 1) duplicates.push({ id: n.id, name: n.name, count: held });

    for (const c of n.copies) {
      const q = c.quantity || 1;
      if (c.status === 'wanted') wanted += q;
      else if (c.status === 'preordered') preordered += q;
    }
    n.children.forEach(walk);
  };
  walk(node);

  return { owned, wanted, preordered, totalItems, duplicates };
}
