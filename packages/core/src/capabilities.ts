import { ROLE_LADDER, type LadderRole, type Role } from './constants.js';

/**
 * What each role may do, expressed once so the Worker and the UI can't drift
 * apart. Routes gate on a capability rather than a role, so adding a role later
 * doesn't mean auditing every route.
 *
 * ## The ladder these rows are built on (owner-approved 2026-08-16)
 *
 * `guest < member < contributor < moderator < admin < owner`, cumulative — see
 * `ROLE_LADDER` in `constants.ts`. Read top to bottom, this file is the table
 * the owner reviewed and approved verbatim ("Role matrix approved"); every row
 * below is a straight transcription of it, not a reinterpretation.
 *
 * Three splits were owner-directed and are deliberately **not** folded back
 * into one capability apiece, even where two rows happen to list the same
 * roles today:
 *
 * 1. **Wishlist**: `suggestWishlist` ("I want this", member+) vs
 *    `manageWishlist` (curate/remove/prioritise, contributor+). Wired into
 *    `apps/worker/src/routes/catalog.ts`'s copy routes — creating a `wanted`
 *    copy needs only `suggestWishlist`; editing or deleting one that is (or
 *    was) `wanted` needs `manageWishlist`.
 * 2. **Scan, by cost**: `scanBarcode` (free, contributor+) vs `scanPhoto`
 *    (bills the Anthropic vision API, moderator+). Wired into
 *    `apps/worker/src/routes/scan-jobs.ts` (`POST /` is a photo upload,
 *    `POST /barcode` is a free barcode append) and `apps/worker/src/routes/
 *    vision.ts` (both routes call the vision model directly).
 * 3. **`admin`'s escalation limit**: not a matrix row at all — `manageUsers`
 *    is a flat capability like any other, but an `admin` holding it may not
 *    use it to mint another `admin` or an `owner`. That is `canGrantRole`,
 *    below, checked in the route in *addition* to the `manageUsers` gate.
 */
export const CAPABILITY_MATRIX = {
  /** See the collection at all. */
  read: ['owner', 'admin', 'moderator', 'contributor', 'member', 'guest'],
  /**
   * Rate an item, leave notes on it.
   *
   * Deliberately excludes `guest`: that is the whole difference between the
   * two read-capable guest roles, and the reason `guest` (née `viewer`) had to
   * exist rather than everybody being made a `member`.
   */
  rate: ['owner', 'admin', 'moderator', 'contributor', 'member'],
  /**
   * "I want this" — add a `wanted` copy. The member+ half of the wishlist
   * split; see the header above. Deliberately does **not** cover editing or
   * removing a wanted copy — that is `manageWishlist`, one row down — because
   * suggesting something and curating the list are different amounts of trust,
   * and folding them together would hand a `member` the delete button the
   * owner explicitly did not ask to give them.
   */
  suggestWishlist: ['owner', 'admin', 'moderator', 'contributor', 'member'],
  /** Add or change items, editions, copies. */
  editCatalog: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * Curate the wishlist: edit or remove a `wanted` copy, reprioritise it.
   *
   * The contributor+ half of the wishlist split. Shares its role list with
   * `editCatalog` today — every role that can edit the catalog can also curate
   * the wishlist, and vice versa — but the two are kept as separate rows on
   * the owner's explicit instruction (do not fold the splits back together).
   * A future matrix that hands `manageWishlist` to `member` without also
   * handing them `editCatalog` is exactly the change this separation exists to
   * make possible without an audit of every route.
   */
  manageWishlist: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * Scan a barcode onto the intake queue. Free — the local `edition.barcode`
   * table, then GameUPC and UPCitemdb, all no-cost lookups — which is why it
   * sits at contributor rather than beside `scanPhoto`.
   *
   * *"lets let contributors scan barcodes only since those are free"* — the
   * owner, refining the proposed table. Shares its role list with
   * `editCatalog` in this matrix (both are contributor+), which is a
   * coincidence of where the ladder happened to land the two, not a merge —
   * see the note on `manageWishlist` above; the same reasoning applies here.
   *
   * Looking a barcode up to check whether it is already owned
   * (`GET /api/barcode/:code`) is gated on plain `read` instead, unchanged —
   * that is a browsing action available to every approved role, not a scan
   * onto the intake queue, and the two were kept apart on purpose before this
   * redesign touched anything.
   */
  scanBarcode: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * Scan a photo — a single box or a whole shelf. Moderator+, because unlike
   * `scanBarcode` this bills the Anthropic vision API on every call
   * (`apps/worker/src/routes/vision.ts`, `apps/worker/src/routes/
   * scan-jobs.ts`'s `POST /`). ⚠️ **This is the line to change if photo-scan
   * spend becomes uncomfortable** — narrow this row, not the role, exactly as
   * the old `runResearch` comment said about `manager`. It moved here rather
   * than staying folded into `runResearch` because the owner's cost split was
   * specifically photo-vs-barcode, not "vision-and-web-search-together" —
   * `POST /api/barcode/identify` (Claude + web search on a barcode number,
   * also billed) stays gated on `runResearch` below, because it is a research
   * action about a number, not a photo.
   */
  scanPhoto: ['owner', 'admin', 'moderator'],
  /**
   * Spend money: trigger LLM research runs, and the paid barcode-identify rung
   * (`POST /api/barcode/identify` — Claude plus a web search on a barcode
   * number nothing free could resolve).
   *
   * `moderator` is included by the owner's explicit choice, same as `manager`
   * carried it before this redesign. It is a capability with a bill attached
   * and no cap in the app, so if that ever becomes uncomfortable this is the
   * line to change — not the role. (See `scanPhoto` above for the sibling
   * cost-gated capability this redesign split out of the old single
   * `manager`-carries-everything shape.)
   */
  runResearch: ['owner', 'admin', 'moderator'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner', 'admin', 'moderator'],
  /**
   * Approve a pending user, change roles.
   *
   * **No longer owner-exclusive** — the one respect in which this row
   * supersedes the old comment calling it "the entire point of `manager`".
   * `admin` holds it too now, by owner decision, which is what makes `admin` a
   * real rung rather than a second name for `moderator`. What keeps the guest
   * list from being wide open at the top is not this row — it is
   * `canGrantRole` below, which lets an `admin` change anyone's role **except**
   * to mint another `admin` or an `owner`. Only `owner` can do that. Read
   * `canGrantRole`'s own comment before changing either half of this pair;
   * they are designed together and neither is complete alone.
   */
  manageUsers: ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

// ---------------------------------------------------------------------------
// The admin escalation limit
// ---------------------------------------------------------------------------

/** `ROLE_LADDER`'s position for each rung, for a strict "beneath" comparison. */
const LADDER_RANK: ReadonlyMap<LadderRole, number> = new Map(
  ROLE_LADDER.map((role, index) => [role, index]),
);

/**
 * May `granterRole` set someone's role to `targetRole`?
 *
 * Pure and unit-tested (`apps/worker/src/lib/role-grant.test.ts`) rather than
 * folded into the route, because "can this person mint that role" is exactly
 * the kind of one-sentence rule that is easy to get right in isolation and
 * easy to get wrong buried in a handler alongside the last-owner guard and the
 * zod parse. Called from `apps/worker/src/routes/users.ts` and
 * `apps/worker/src/routes/admin.ts` **in addition to** the `manageUsers`
 * capability gate on the route — this function does not check `manageUsers`
 * itself, and calling it for a role with no `manageUsers` is meaningless, not
 * dangerous: a `contributor` never reaches it because `requireCapability
 * ('manageUsers')` already 403s first.
 *
 * ## The rule
 *
 * `owner` is unrestricted: it may grant anything, `owner` included. That is a
 * deliberate choice, not an oversight — the People page has always offered
 * "Make owner" for every role (`PeoplePage.tsx`'s `RoleControls`, built off
 * `ROLES` so a new role is never assignable nowhere), and an owner adding a
 * co-owner is existing behaviour this redesign must not quietly take away.
 * Owner granting `pending` (a revoke) is the same unrestricted case.
 *
 * Everyone else may grant only a role **strictly beneath their own** on
 * `ROLE_LADDER` — never their own rung, never anything above it. This is what
 * stops an `admin` minting another `admin` or an `owner`: `admin` sits one
 * rung below `owner`, so `admin` granting `admin` fails the strict inequality
 * exactly the way `admin` granting `owner` does, with no separate case needed
 * for either.
 *
 * `targetRole === 'pending'` is granted unconditionally by anyone who reaches
 * this function (i.e. anyone the route already knows holds `manageUsers`).
 * Revoking is always a demotion, never an escalation, and `pending` sits
 * outside `ROLE_LADDER` on purpose (see the note on `ROLES` in
 * `constants.ts`) — it has no rank to compare against, and needs none.
 */
export function canGrantRole(granterRole: Role, targetRole: Role): boolean {
  if (granterRole === 'owner') return true;
  if (targetRole === 'pending') return true;

  const granterRank = LADDER_RANK.get(granterRole as LadderRole);
  const targetRank = LADDER_RANK.get(targetRole as LadderRole);
  // `pending` as a granter (or any value outside the ladder) has no rank of
  // its own and may grant nothing.
  if (granterRank === undefined || targetRank === undefined) return false;

  return targetRank < granterRank;
}
