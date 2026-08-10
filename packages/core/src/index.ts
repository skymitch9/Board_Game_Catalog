/**
 * Shared domain vocabulary for the catalog.
 *
 * This package holds types, schemas and pure rules only — no database access,
 * no fetch, no Worker or Node globals. Both the Worker and the CLI import it,
 * so anything with I/O in it belongs somewhere else.
 *
 * Import order matters: `constants.ts` is the leaf, `schemas.ts` builds on it,
 * and this file re-exports both. Nothing under src/ may import from this file.
 */

import { z } from 'zod';
import { CAPABILITY_MATRIX } from './capabilities.js';
import { ROLES, type Role } from './constants.js';

export * from './constants.js';
export * from './details.js';
export * from './covers.js';
export * from './buy-links.js';
export * from './schemas.js';
export * from './capabilities.js';
export * from './barcode.js';
export * from './completeness.js';
export * from './vision.js';

export const roleSchema = z.enum(ROLES);

export interface AppUser {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  firstSeenAt: string;
  approvedAt: string | null;
}

export type Capability = keyof typeof CAPABILITY_MATRIX;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITY_MATRIX[capability] as readonly Role[]).includes(role);
}

/** Capabilities the given role holds, for the UI to gate on. */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITY_MATRIX) as Capability[]).filter((c) => can(role, c));
}

export function tierRank(tier: import('./constants.js').SourceTier): number {
  return (
    ['official', 'crowdfunding', 'retail', 'community'] as readonly string[]
  ).indexOf(tier);
}

/** True when `a` should beat `b` on a conflicting claim about the same field. */
export function outranks(
  a: import('./constants.js').SourceTier,
  b: import('./constants.js').SourceTier,
): boolean {
  return tierRank(a) < tierRank(b);
}

// ---------------------------------------------------------------------------
// API contracts for identity
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
  /**
   * Outstanding maintenance work, so the nav can hide a screen with nothing on
   * it. Rides here because this is the one call the app makes before it draws
   * anything — see `apps/worker/src/lib/chores.ts` for the trade.
   *
   * **`null` means "not known", not "nothing to do".** A reader is never asked
   * the question, and a count that fails is not worth failing sign-in over. The
   * nav shows both links when it is null: a redundant link is a nuisance, a
   * missing one is invisible.
   */
  chores: z
    .object({
      relatedGames: z.number(),
      missingDetails: z.number(),
      /**
       * ⚠️ Optional because an older worker does not send it. `undefined` means
       * "this deploy cannot tell you", which the nav must not render as a
       * confident zero — the People link is drawn either way, so the only
       * question is whether it carries a count.
       */
      pendingUsers: z.number().optional(),
    })
    .nullable()
    .optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateRoleSchema = z.object({
  role: roleSchema,
});
