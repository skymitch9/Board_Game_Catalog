import type { Role } from './constants.js';

/**
 * What each role may do, expressed once so the Worker and the UI can't drift
 * apart. Routes gate on a capability rather than a role, so adding a role later
 * doesn't mean auditing every route.
 */
export const CAPABILITY_MATRIX = {
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
