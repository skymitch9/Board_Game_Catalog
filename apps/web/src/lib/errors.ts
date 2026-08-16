import { CAPABILITY_MATRIX, ROLE_LADDER, type Capability, type Role } from '@bgc/core';

/**
 * Turns a failed request's body into a sentence a person can act on.
 *
 * `bookbuddy/audiobook_catalog/docs/info/ROLES.md` §1e (the canonical copy of
 * this standard) sets the bar: **nobody sees a bare HTTP status.** Every
 * refusal says what happened, what it needs (naming the role), and how to get
 * it; a network/server failure must never read as a permission problem.
 *
 * Called from `ApiError.detail` in `../api.ts`, which is the one place every
 * screen already reads through (`ErrorBox`, and the three call sites that
 * read `.detail` directly) — so fixing the getter fixes the whole app rather
 * than adding a second, competing helper.
 */

/** What each capability lets you do, in the words a refusal should use. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  read: 'Viewing the collection',
  rate: 'Rating an item',
  suggestWishlist: 'Suggesting something for the wishlist',
  editCatalog: 'Adding or editing items',
  manageWishlist: 'Curating the wishlist',
  scanBarcode: 'Scanning a barcode',
  scanPhoto: 'Scanning a photo',
  runResearch: 'Running research',
  reviewFindings: 'Reviewing research findings',
  manageUsers: 'Managing people',
};

/** The lowest rung on the ladder that already holds this capability. */
function minRoleFor(capability: Capability): Role {
  const allowed = CAPABILITY_MATRIX[capability] as readonly Role[];
  for (const role of ROLE_LADDER) {
    if (allowed.includes(role)) return role;
  }
  return 'owner';
}

function humanizeCode(code: string | undefined): string | null {
  if (!code) return null;
  return code.replace(/_/g, ' ');
}

interface ErrorBody {
  error?: string;
  capability?: string;
  role?: string;
  detail?: unknown;
}

/**
 * The human sentence for a failed API response, given its status and parsed
 * JSON body (or `null` when the body was not JSON — the bare-`HTTP 500` case
 * this exists to remove).
 */
export function describeApiError(status: number, body: unknown): string {
  const b = (body ?? null) as ErrorBody | null;

  // Not signed in — or a token that expired mid-session; `req()` already
  // retried once with a fresh token before this could surface here (a
  // top-level 401 on `/api/me` is caught earlier, in App.tsx, and shows the
  // sign-in screen instead of this sentence).
  if (status === 401) {
    return 'Your session has expired. Sign in again to continue.';
  }

  if (status === 403) {
    // `requireCapability` in the Worker's auth middleware is the one shape
    // every role refusal takes — see apps/worker/src/middleware/auth.ts.
    if (b?.error === 'forbidden') {
      if (b.role === 'pending') {
        return 'Your account is waiting to be approved by an owner or admin.';
      }
      const capability = b.capability as Capability | undefined;
      if (capability && capability in CAPABILITY_LABEL) {
        const needs = minRoleFor(capability);
        return `${CAPABILITY_LABEL[capability]} needs the ${needs} role. Ask an owner or admin to grant it.`;
      }
      return 'Your role does not allow that. Ask an owner or admin for access.';
    }
    // estate_revoked — computed, never stored (middleware/estate.ts). Quiet
    // and non-accusatory on purpose: never explain the enforcement to the
    // person it just applied to.
    if (b?.error === 'estate_revoked') {
      return 'This account no longer has access here.';
    }
    return 'You do not have permission to do that.';
  }

  // estate_unreachable: the directory could not be asked, which is an
  // outage, not a verdict. Must not read as "you are not allowed".
  if (status === 503) {
    return "Couldn't check your access right now. Try again in a moment.";
  }

  if (status === 404) {
    return 'That could not be found.';
  }

  if (status >= 500) {
    return 'The server had a problem. Try again in a moment.';
  }

  // Ordinary validation / business refusals (400/409/…) — the route usually
  // already wrote a sentence into `detail`; fall back to a de-snaked version
  // of the error code rather than the raw code, and only then to the bare
  // status this function exists to stop showing.
  if (typeof b?.detail === 'string' && b.detail) return b.detail;
  if (Array.isArray(b?.detail)) {
    const issues = b.detail as { path?: unknown[]; message?: string }[];
    const said = issues
      .map((i) => `${(i.path ?? []).join('.') || 'value'}: ${i.message ?? 'is invalid'}`)
      .join('; ');
    if (said) return said;
  }
  return humanizeCode(b?.error) ?? `Something went wrong (${status}).`;
}
