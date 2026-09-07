/**
 * Request/response contracts shared by the Worker, the web app, and (phase 4)
 * the CLI. Validation lives here so the three can never disagree about shape.
 */

import { z } from 'zod';
import {
  COPY_FORMATS,
  COPY_STATUSES,
  DISPOSALS,
  DISPOSED_STATUS,
  ITEM_KINDS,
  OWNED_COPY_STATUSES,
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  RELATION_TYPES,
  type CopyStatus,
  type Disposal,
} from './constants.js';
import type { InheritedDetail, InheritedField } from './details.js';
import type { FamilyScore } from './family-score.js';

export const itemKindSchema = z.enum(ITEM_KINDS);
export const copyStatusSchema = z.enum(COPY_STATUSES);
export const copyFormatSchema = z.enum(COPY_FORMATS);
export const disposalSchema = z.enum(DISPOSALS);

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Schemes a stored URL may have. **`https:` and `http:`, and nothing else.**
 *
 * 🔴 `z.url()` is a FORMAT check, not a safety one. Measured against the
 * installed zod on 2026-08: `javascript:alert(1)`, `data:text/html,…` and
 * `vbscript:…` all parse as valid URLs. `publisherUrl` and `sourceUrl` flow
 * into `buyLinksFor()` and out as an `<a href>`, so a `javascript:` value
 * stored there is a link that runs code when somebody clicks "Publisher".
 * `thumbnailUrl` becomes an `<img src>`. 2026-08 audit, finding 19.
 *
 * ⚠️ **This is defence in depth, and it is worth having anyway.** Writing an
 * item needs `editCatalog`, and React refuses to render a `javascript:` href —
 * so the practical exposure today is small. But "React happens to block it" is
 * a property of a library version, the values are also read by exports, the
 * cover pipeline and anything future, and a scheme check at the door costs one
 * line. The rule this repo keeps: validators REJECT, they do not silently
 * strip.
 *
 * `http:` is allowed deliberately. Plenty of small publishers and long-dead
 * campaign pages are still plain http, and refusing them would lose real data
 * to buy a warning nobody asked for. The scheme allow-list is about code
 * execution, not about transport.
 */
const SAFE_URL_SCHEMES = ['https:', 'http:'];

function hasSafeScheme(value: string): boolean {
  try {
    return SAFE_URL_SCHEMES.includes(new URL(value).protocol);
  } catch {
    // Unparseable never reaches here — `.url()` runs first — but a validator
    // that throws is worse than one that refuses.
    return false;
  }
}

/** A stored, later-rendered URL: valid, bounded, and not a code-execution scheme. */
const safeUrl = (max: number) =>
  z
    .string()
    .trim()
    .url()
    .max(max)
    .refine(hasSafeScheme, { message: 'a link must start with https:// or http://' })
    .nullable()
    .optional()
    .or(z.literal(''));

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
  publisherUrl: safeUrl(500),
  /**
   * The campaign this came from — a Kickstarter or Gamefound project page.
   *
   * Not the same thing as `publisherUrl`, and an item can carry both: one is
   * the publisher's own site, the other is where *this pledge* was made. For
   * two thirds of the catalog the campaign page is the only authoritative
   * record there is, since the box never had a retail listing.
   */
  sourceUrl: safeUrl(500),
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
  thumbnailUrl: safeUrl(500),
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
export const createItemSchema = itemFields.strict().refine(
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

/**
 * 🔴 **`.strict()` on both, and the PATCH one is the half that matters.**
 *
 * zod's default is `strip`: an unknown key is silently discarded and the parse
 * SUCCEEDS. So `PATCH {"yearPublish": 2019}` — one letter short — passed
 * validation, updated nothing, and answered **200**. The caller is told the
 * edit was saved; the field still holds the old value; nothing anywhere logs a
 * word. The `refine(len > 0)` below only catches the case where EVERY key is
 * unknown, which is the rare one. 2026-08 audit, finding 18.
 *
 * ⚠️ This repo's standing rule, learned from a validator that stripped instead
 * of rejecting: **validators REJECT.** A silent strip is indistinguishable from
 * success to everyone who can see it.
 */
export const updateItemSchema = itemFields
  .partial()
  .strict()
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
  /**
   * Why this copy is no longer ours. Legal only alongside `status: 'sold'`,
   * and required by it — see `disposalConflict`, which is the one place that
   * rule is written.
   */
  disposal: disposalSchema.nullable().optional(),
});

/**
 * The pairing rule between `status` and `disposal`, stated once.
 *
 * Returns a worded message when the pair is illegal, or `null` when it is fine.
 * ⚠️ **It returns a SENTENCE, not a boolean**, because it is what a person
 * reads: a 400 that says "bad_request" and nothing else is the bare-status
 * failure the estate rules forbid.
 *
 * Two directions, and both are real mistakes rather than theoretical ones:
 *
 * 1. **`sold` with no disposal.** The status means "no longer ours" and nothing
 *    else; without a reason the history reads "gone, no idea why", which is the
 *    exact outcome §1 of the design doc calls *worse than doing nothing*.
 * 2. **A disposal on a copy that is still ours.** A stale `given_away` left on
 *    a row that was flipped back to `owned` would have the item page announcing
 *    a game was given away while it sits on the shelf.
 *
 * ⚠️ It must be applied to the **merged** state on a PATCH, not to the request
 * body: `{ status: 'sold' }` alone is legal when the row already carries a
 * disposal, and `{ disposal: null }` alone is not when the row is `sold`.
 * The route does that merge; `createCopySchema` can check the body directly
 * because a create always carries both (status has a default).
 */
export function disposalConflict(
  status: CopyStatus,
  disposal: Disposal | null | undefined,
): string | null {
  const disposed = status === DISPOSED_STATUS;
  if (disposed && !disposal) {
    return 'say what happened to it — sold, given away or lost';
  }
  if (!disposed && disposal) {
    return `a copy that is "${status}" cannot also be recorded as ${disposal.replace('_', ' ')} — clear the reason, or mark it as no longer ours`;
  }
  return null;
}

export const createCopySchema = copyFields.strict().superRefine((d, ctx) => {
  const message = disposalConflict(d.status, d.disposal ?? null);
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['disposal'] });
});

/**
 * What a disposal is worth recording beyond the reason: who, how much, and any
 * words. **Event metadata, not columns on `copy`** — they describe the moment
 * the copy left, and a second disposal (a copy bought back and given away
 * again) is a second event with its own answers.
 *
 * Nothing here is required. The owner giving a game to a friend whose name he
 * does not want to type must not be blocked from recording that it is gone.
 */
export const disposalDetailsSchema = z.object({
  /** Who bought it / who has it. Free text — never a user id. */
  counterpart: nullableString(120),
  /** What it fetched, in cents. ⚠️ Not an accounting feature; nothing sums it. */
  priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  note: nullableString(1000),
});

export const updateCopySchema = copyFields
  .partial()
  .extend({
    /**
     * Ride-along detail for the history row this update writes. Not a column:
     * `updateCopy` reads it, writes it into `copy_event`, and never sets it on
     * `copy`. Ignored when the update changes no status and no disposal, since
     * there is then no event for it to land on.
     */
    disposalDetails: disposalDetailsSchema.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });

export type CreateCopyInput = z.infer<typeof createCopySchema>;
export type UpdateCopyInput = z.infer<typeof updateCopySchema>;
export type DisposalDetailsInput = z.infer<typeof disposalDetailsSchema>;

// ---------------------------------------------------------------------------
// Ratings — the one per-person thing
// ---------------------------------------------------------------------------

export const upsertRatingSchema = z.object({
  // 0.5–5 in half-star steps — the audiobook library's scale, shared so a rating
  // means the same number on both sites. See RATING_* in constants.ts, and the
  // matching CHECK on user_item.rating in migration 0028. The `multipleOf` guard
  // is what rejects a 2.25 that min/max alone would wave through.
  rating: z
    .number()
    .min(RATING_MIN)
    .max(RATING_MAX)
    .multipleOf(RATING_STEP)
    .nullable(),
  notes: nullableString(1000),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;

// ---------------------------------------------------------------------------
// Relations — standalone games that belong together
// ---------------------------------------------------------------------------

export const relationTypeSchema = z.enum(RELATION_TYPES);

export const createRelationSchema = z
  .object({
    toItemId: z.number().int().positive(),
    relation: relationTypeSchema,
  })
  .strict();

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
 * Punctuation that is typography rather than spelling, folded away on **both**
 * sides of a search comparison.
 *
 * `Player’s Handbook` is stored with U+2019 and `Aeon's End` with U+0027 — the
 * same intent, two codepoints, decided by whichever tool the row was typed in.
 * Measured on the 806-item catalog: **15 rows carry the curly apostrophe and 47
 * the straight one**, so neither spelling is the odd one out and a search box
 * that respects the difference is wrong for half the collection whichever half
 * you pick. `players handbook` returned nothing at all.
 *
 * Dashes are the same failure with a different glyph: 189 hyphens against 12 en
 * dashes, and typing "season two - battle chest" for a row printed with an en
 * dash returned nothing. All three dashes fold to the same nothing, so it no
 * longer matters which one either side used.
 *
 * **Removed, not replaced with a space**, and it is a real choice. 145 of the
 * dashes are ` - ` separators and 56 sit inside a word ("X-Men", "5-6 Player",
 * "Gilmour-Long"). For the separators the two options are indistinguishable —
 * terms are split on whitespace, so no term ever spans one. Inside a word,
 * removal is a strict superset: `X-Men` folded to `xmen` is found by "x-men",
 * "x men" *and* "xmen", where folding to a space loses the last of those.
 *
 * ⚠️ **`&` and `:` are deliberately NOT here.** `D&D` would fold to `dd`, and
 * the 72 alias rows the D&D line depends on are spelled `D&D`; worse, a user
 * typing `D D` produces two one-character terms that match most of the catalog.
 * `:` separates the line from the box in 622 places and is what makes "catan
 * seafarers" mean something. Diacritics are not folded either — three characters
 * in three rows, and SQLite has no NFD, so matching `normaliseTitle`'s
 * accent-stripping here would cost a replace() per accented letter for no
 * measured failure. `normaliseTitle` in `vision.ts` is the scanner's fold and
 * stays the scanner's; this one is looser about quotes and stricter about
 * everything else, because a search box shows a person a list and the scanner
 * decides unattended.
 *
 * ⚠️ **Written as `\u` escapes rather than literal glyphs on purpose.** A
 * PowerShell rewrite has silently mangled the UTF-8 of a source file in this
 * repo before (see CLAUDE.md), and the failure is invisible: the mangled form
 * typechecks, builds and deploys, and the search quietly stops folding. Escapes
 * survive it. Keep them.
 */
const SEARCH_FOLD = /[\u2019\u0027\u2018\u0060\u002d\u2013\u2014]/g;

/** Lowercase and drop the folded punctuation. The JS half of the comparison. */
export function foldSearchText(s: string): string {
  return s.toLowerCase().replace(SEARCH_FOLD, '');
}

/**
 * Split a search box into the words that must all be found.
 *
 * "catan seafarers" is two facts about one game tree, and they live in different
 * rows: the first is the base game's name, the second an expansion's. Treating
 * the box as one string requires them adjacent in a single field, which they
 * never are. Every term has to match *something* in the tree; no term has to
 * match the same thing as another.
 *
 * Lowercased and folded here so the SQL and the "why did this match" check
 * downstream cannot drift apart on case or on punctuation. Folding *before* the
 * length filter is what drops a term of pure punctuation — typing a bare "-"
 * asks no question, and `LIKE '%%'` is not the answer to it.
 */
export function searchTerms(q: string | undefined | null): string[] {
  if (!q) return [];
  return q
    .split(/\s+/)
    .map((t) => foldSearchText(t).trim())
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
   * Why this copy is no longer ours — `sold`, `given_away` or `lost`.
   *
   * Non-null exactly when `status` is `sold`; see `disposalConflict`. Read it
   * with `copyStateLabel(status, disposal)` rather than showing `status`
   * directly, or a game the owner gave away will tell him he sold it.
   */
  disposal: (typeof DISPOSALS)[number] | null;
  /**
   * When this copy joined the collection, as an ISO instant. Set by the
   * database on insert and never editable — it records a fact about the
   * catalog, not a claim about the box.
   */
  addedAt: string;
}

/**
 * One thing that happened to one copy — the append-only history.
 *
 * ⚠️ **`copyId` and `itemId` are nullable and that is the feature.** The FKs
 * are `ON DELETE SET NULL`, so deleting the copy — or the whole game — leaves
 * the event standing. `itemName` is the denormalised snapshot that keeps such
 * an orphaned event readable: *"Catan — given away to Dave"*, never *"item 41"*.
 * See `docs/info/copy-status-history.md` §4 and migration 0029.
 */
export interface CopyEvent {
  id: number;
  copyId: number | null;
  itemId: number | null;
  /** The item's name as it stood when the event was written. Never re-read. */
  itemName: string;
  /** Null on a copy's first event — it came from nowhere. */
  fromStatus: (typeof COPY_STATUSES)[number] | null;
  toStatus: (typeof COPY_STATUSES)[number];
  disposal: (typeof DISPOSALS)[number] | null;
  /** Who bought it / who has it. Free text, never a user id. */
  counterpart: string | null;
  /** What it fetched. ⚠️ Not an accounting feature — nothing sums it. */
  priceCents: number | null;
  note: string | null;
  /** When it happened, as an ISO instant. */
  at: string;
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
  /**
   * One number for the whole family — the base-weighted mean, derived on read.
   *
   * Never stored, never a column: it is a roll-up over the per-item ratings and
   * the `same_family` relations that already exist. `score` is `null` when
   * nothing in the family is rated, which is not a zero. The weights and the
   * decision behind them are in `family-score.ts`; the family it is rolled up
   * over is decided by `packages/db/src/family-score.ts`.
   */
  familyScore: FamilyScore;
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
  /**
   * The game at the top of the tree — what the page groups by.
   *
   * The *root*, not the parent: eight X-Men playmats hang off eight different
   * hero boxes, and grouping on the parent would make eight sections of one row
   * where the owner asked for one section of eight. Self for a row that is its
   * own root, so every entry has one.
   */
  rootGameId: number | null;
  rootGameName: string | null;
  thumbnailUrl: string | null;
  /** Borrowed from the nearest ancestor with art. See `covers.ts`. */
  inheritedCover?: InheritedDetail | null;
  /**
   * Where to buy it, and where the pledge was taken. Both feed `buyLinksFor` in
   * `buy-links.ts` and neither is a link this app made up — see that file for
   * why a finished Kickstarter is not offered as a shop.
   */
  publisherUrl: string | null;
  /** Borrowed from the nearest ancestor with one, like the publisher itself. */
  inheritedPublisherUrl?: InheritedDetail | null;
  sourceUrl: string | null;
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

/**
 * One preordered copy somewhere under the item being asked about — a line on
 * the "what turned up?" checklist.
 *
 * Subtree-shaped rather than root-shaped, and that is the whole point: a pledge
 * arrives as a box holding a game and everything filed under it, so the unit
 * being confirmed is a *branch* of the tree, not a game and not a single row.
 * Asking from an expansion's page therefore offers that expansion and its
 * accessories, and nothing from the base game beside it.
 *
 * `copyId` is the identity for the same reason it is on `WishlistEntry`: being
 * on preorder is a property of the copy, and the copy is what gets flipped to
 * `owned` when the box is opened.
 */
export interface PreorderArrival {
  copyId: number;
  itemId: number;
  name: string;
  kind: (typeof ITEM_KINDS)[number];
  /**
   * How far below the item asked about this sits — 0 is that item's own copy.
   *
   * Carried so the checklist can indent, which is not decoration: a pledge with
   * eleven rows in it is read as "the game, and these under it", and a flat list
   * of eleven names makes the owner work out the shape for themselves.
   */
  depth: number;
  parentItemId: number | null;
  parentName: string | null;
  /** Identical copies on the one row — "×3" on the checklist. */
  quantity: number;
  format: (typeof COPY_FORMATS)[number];
  /** Whatever was written on the copy — "wave 2", "KS exclusive". */
  notes: string | null;
  /** When the preorder was recorded, as an ISO instant. */
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
  /**
   * Set only when a caller asked for more URLs than one Worker invocation can
   * pay for, and got the ceiling instead.
   *
   * ⚠️ It exists because the alternative is silence. Exceeding the subrequest
   * budget TERMINATES the invocation rather than throwing — no exception, no
   * log line — so a run that was quietly truncated looks exactly like a run
   * that found nothing. That was the 2026-08 audit's finding 5, and finding 1
   * before it in the details sweep. Absent on every normal run.
   */
  capped?: string;
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

/**
 * How many of this item we hold, counting quantities across all its copies.
 *
 * ⚠️ **"Held" is `OWNED_COPY_STATUSES`, and only that.** This used to write the
 * rule out by hand as `status === 'owned' || status === 'lent'`, which gave the
 * one rule two definitions — and the constant's own header warns that adding a
 * held-like status "in eight places… any miss is silent". The miss here was the
 * expensive kind: every SQL consumer counts through `statusList(
 * OWNED_COPY_STATUSES)`, so a new status would have been counted by the
 * database and NOT by the collapsed base-game card, and the two numbers would
 * simply have disagreed on screen with nothing failing. 2026-08 audit,
 * finding 9.
 */
export function ownedCount(copies: Copy[]): number {
  return copies
    .filter((c) => OWNED_COPY_STATUSES.includes(c.status))
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
