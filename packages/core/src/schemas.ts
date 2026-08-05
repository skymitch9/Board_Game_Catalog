/**
 * Request/response contracts shared by the Worker, the web app, and (phase 4)
 * the CLI. Validation lives here so the three can never disagree about shape.
 */

import { z } from 'zod';
import { COPY_STATUSES, ITEM_KINDS } from './constants.js';

export const itemKindSchema = z.enum(ITEM_KINDS);
export const copyStatusSchema = z.enum(COPY_STATUSES);

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemFields = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  kind: itemKindSchema,
  parentItemId: z.number().int().positive().nullable().optional(),
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

export const createItemSchema = itemFields.refine(
  (d) => d.kind === 'base' || (d.parentItemId != null && d.parentItemId > 0),
  {
    message: 'expansions, accessories, promos and upgrades must belong to a base game',
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
  parent: Item | null;
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
