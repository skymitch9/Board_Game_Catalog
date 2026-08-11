import type { Role } from './constants.js';

/**
 * What each role may do, expressed once so the Worker and the UI can't drift
 * apart. Routes gate on a capability rather than a role, so adding a role later
 * doesn't mean auditing every route.
 */
export const CAPABILITY_MATRIX = {
  /** See the collection at all. */
  read: ['owner', 'manager', 'rater', 'viewer'],
  /**
   * Rate an item and leave notes on it.
   *
   * Deliberately excludes `viewer`: that is the whole difference between the two
   * read-capable guest roles, and the reason `viewer` had to exist rather than
   * everybody being made a `rater`.
   */
  rate: ['owner', 'manager', 'rater'],
  /** Add or change items, editions, copies. */
  editCatalog: ['owner', 'manager'],
  /**
   * Spend money: trigger LLM research runs.
   *
   * `manager` is included by the owner's explicit choice. It is the one
   * capability here with a bill attached and no cap in the app, so if that ever
   * becomes uncomfortable this is the line to change — not the role.
   */
  runResearch: ['owner', 'manager'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner', 'manager'],
  /**
   * Approve a pending user, change roles.
   *
   * ⚠️ **The only owner-exclusive capability, and the entire point of `manager`.**
   * Every other row above lists `manager`, which makes the rule one sentence: a
   * manager can do anything to the catalog and nothing to the guest list.
   *
   * Keep it that way. If a capability is added later and `manager` is left out
   * without a reason written beside it, the role quietly stops meaning what it
   * is called — and the People page tells a human it means "everything except
   * managing people".
   */
  manageUsers: ['owner'],
} as const satisfies Record<string, readonly Role[]>;
