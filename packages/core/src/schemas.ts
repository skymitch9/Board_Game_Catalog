/**
 * Request/response contracts shared by the Worker, the web app, and (phase 4)
 * the CLI. Validation lives here so the three can never disagree about shape.
 */

import { z } from 'zod';
import { COPY_STATUSES, ITEM_KINDS, RELATION_TYPES } from './constants.js';

export const itemKindSchema = z.enum(ITEM_KINDS);
export const copyStatusSchema = z.enum(COPY_STATUSES);

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
});

export type ItemQuery = z.infer<typeof itemQuerySchema>;

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
  designers: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  weight: number | null;
  thumbnailUrl: string | null;
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
}

export interface ItemDetail extends Item {
  copies: Copy[];
  children: ItemNode[];
  ratings: Rating[];
  relatedItems: RelatedItemRef[];
  parent: Item | null;
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
}

/** How many of this item we hold, counting quantities across all its copies. */
export function ownedCount(copies: Copy[]): number {
  return copies
    .filter((c) => c.status === 'owned' || c.status === 'lent')
    .reduce((sum, c) => sum + (c.quantity || 1), 0);
}

/** Aggregate shown on a collapsed base-game card. */
export function summarizeTree(node: ItemNode): {
  owned: number;
  wanted: number;
  totalItems: number;
  /** Items in this tree we hold more than one of. */
  duplicates: { id: number; name: string; count: number }[];
} {
  let owned = 0;
  let wanted = 0;
  let totalItems = 0;
  const duplicates: { id: number; name: string; count: number }[] = [];

  const walk = (n: ItemNode) => {
    totalItems += 1;
    const held = ownedCount(n.copies);
    owned += held;
    if (held > 1) duplicates.push({ id: n.id, name: n.name, count: held });

    for (const c of n.copies) {
      const q = c.quantity || 1;
      if (c.status === 'wanted' || c.status === 'preordered') wanted += q;
    }
    n.children.forEach(walk);
  };
  walk(node);

  return { owned, wanted, totalItems, duplicates };
}
