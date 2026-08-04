/**
 * Shared domain vocabulary for the catalog.
 *
 * This package holds types, schemas and pure rules only — no database access,
 * no fetch, no Worker or Node globals. Both the Worker and the CLI import it,
 * so anything with I/O in it belongs somewhere else.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// People and permissions
// ---------------------------------------------------------------------------

export const ROLES = ['owner', 'rater', 'pending'] as const;
export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES);

export interface AppUser {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  firstSeenAt: string;
  approvedAt: string | null;
}

/**
 * Capabilities, expressed once so the Worker and the UI can't drift apart on
 * who is allowed to do what.
 */
export const CAPABILITIES = {
  /** See the collection at all. */
  read: ['owner', 'rater'],
  /** Rate an item and leave notes on it. */
  rate: ['owner', 'rater'],
  /** Add or change items, editions, copies. */
  editCatalog: ['owner'],
  /** Spend money: trigger LLM research runs. */
  runResearch: ['owner'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner'],
  /** Approve a pending user, change roles. */
  manageUsers: ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Every catalog row is one of these. A base game is the root of a tree; every
 * other kind hangs off it. See docs/DESIGN.md §6.
 */
export const ITEM_KINDS = ['base', 'expansion', 'accessory', 'promo', 'upgrade'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const COPY_STATUSES = ['owned', 'wanted', 'preordered', 'lent', 'sold'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * Research source priority: official publisher first, then crowdfunding, then
 * retail. `community` covers BGG itself. Lower index wins on conflict.
 */
export const SOURCE_TIERS = ['official', 'crowdfunding', 'retail', 'community'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export function tierRank(tier: SourceTier): number {
  return SOURCE_TIERS.indexOf(tier);
}

/** True when `a` should beat `b` on a conflicting claim about the same field. */
export function outranks(a: SourceTier, b: SourceTier): boolean {
  return tierRank(a) < tierRank(b);
}

// ---------------------------------------------------------------------------
// API contracts (shared by Worker and web app)
// ---------------------------------------------------------------------------

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  database: z.enum(['up', 'down']),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const meResponseSchema = z.object({
  email: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  capabilities: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateRoleSchema = z.object({
  role: roleSchema,
});

/** Capabilities the given role holds, for the UI to gate on. */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));
}
