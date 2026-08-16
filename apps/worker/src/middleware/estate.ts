/**
 * Estate membership — the games Worker's adoption of estate auth, SHADOW-first.
 *
 * Design: catalog-platform/docs/info/estate-auth-design.md §3.1 (the
 * combination table), §5 (the check protocol), §5.4 (default-grant), §14.5
 * (this adoption step). The module itself is the canonical one, materialised
 * from catalog-platform by scripts/sync-estate-auth.mjs — nothing in this file
 * decides WHAT the estate answer means; it only wires the answer into this
 * app's request flow at the strength ESTATE_CHECK allows.
 *
 * ## The three modes — and why `off` is the default
 *
 *   off      Nothing happens. No /seen call, no log line, no cache write. A
 *            missing/typo'd/unset ESTATE_CHECK is also `off`, because the safe
 *            direction for a misread flag on THIS feature is "behave exactly
 *            as before the deploy" — the deploy carrying this code must be
 *            inert until the owner flips the flag deliberately.
 *   shadow   The full §5.2 protocol runs — /seen called, cache columns
 *            written, the §3.1 verdict computed — and then the request
 *            proceeds EXACTLY as local auth already decided, whatever the
 *            verdict said. The verdict goes to the log with a greppable
 *            `WOULD-DENY` token on the rows that enforce-mode would refuse.
 *            Run this for days; zero WOULD-DENY lines for household members is
 *            the evidence that makes flipping to enforce boring (§9 step 5/6).
 *   enforce  The §3.1 verdicts act: revoked → 403 always; unreachable with no
 *            local standing → named 503; default-grant assigns `guest`.
 *
 * ## What this deliberately does NOT touch (§14.5's own warnings)
 *
 *  - `upsertUserOnLogin` and its OWNER_EMAILS recovery hatch run BEFORE this
 *    and are untouched — the way back in cannot depend on the thing being
 *    added. §3.1's local-wins rows mean a forced owner proceeds even in
 *    enforce with the directory down.
 *  - The rate limiter sits in front of the whole /api/* stack; the /seen call
 *    is an outbound subrequest and never meets it.
 *  - A locally-`pending` person still sees the request screen via the existing
 *    capability gates — `request_screen` maps to "proceed and let local
 *    pending do its job", not a new response shape.
 *
 * ## Reading the shadow logs in production
 *
 *    npm run tail --workspace @bgc/worker     (or the dashboard's Live Logs)
 *    grep for "estate shadow:"  — one line per checked request
 *    grep for "WOULD-DENY"      — the lines that matter; expect zero
 */

import type { Context } from 'hono';
import type { AppUser } from '@bgc/core';
import { grantEstateDefaultRole, readEstateCache, writeEstateCache } from '@bgc/db';
import {
  combineEstateAndLocal,
  declareAuthPosture,
  estateCheck,
  isEstateStatus,
  type EstateVerdict,
  type Identity,
} from '../estate-auth/index.js';
import type { AppBindings } from '../env.js';

/**
 * The per-surface posture declaration (owner decision #1): this surface is
 * gated, on the record. `defaultRole: 'guest'` is owner decision #2 — the
 * SMALLER of this app's two guest roles, deliberately, so rating rights stay a
 * local per-person upgrade and the distinction migrations 0023/0024 built
 * survives estate-wide approval. In shadow this role is never written; it
 * appears only in would-grant log lines.
 *
 * ⚠️ Renamed from `'viewer'` by the 2026-08-16 role-ladder redesign (migration
 * 0027): `viewer` -> `guest`, same rung, same reasoning, new name. Nothing
 * about *which* rung is granted changed — this is still deliberately the
 * smaller of the two read-capable roles, not `member`.
 */
export const AUTH_POSTURE = declareAuthPosture({
  public: false,
  app: 'games',
  defaultRole: 'guest',
});

export type EstateMode = 'off' | 'shadow' | 'enforce';

export function estateMode(raw: string | undefined): EstateMode {
  if (raw === 'shadow' || raw === 'enforce') return raw;
  if (raw !== undefined && raw !== '' && raw !== 'off') {
    // A typo'd mode must not silently strengthen OR weaken auth — it falls to
    // `off` (today's behaviour) and says so on every request until fixed.
    console.error(`estate: unrecognised ESTATE_CHECK value '${raw}' — treating as 'off'`);
  }
  return 'off';
}

/** What enforce-mode WOULD do for a verdict — also the shadow log vocabulary. */
function actionFor(verdict: EstateVerdict): { deny: boolean; action: string } {
  switch (verdict) {
    case 'proceed':
      return { deny: false, action: 'proceed on local role' };
    case 'request_screen':
      return { deny: false, action: 'proceed to local request screen' };
    case 'default_grant':
      return { deny: false, action: `grant default role '${AUTH_POSTURE.defaultRole}'` };
    case 'revoked':
      return { deny: true, action: '403 estate_revoked' };
    case 'estate_unreachable':
      return { deny: true, action: '503 estate_unreachable' };
  }
}

/**
 * Run the estate check for an already-locally-authenticated user, at the
 * strength `ESTATE_CHECK` allows. Returns a Response only when enforce-mode
 * refuses; null means proceed (which in shadow is the only possible answer).
 *
 * Mutates `user.role` in place on an enforce-mode default-grant so the rest of
 * the request (capability gates, /api/me) sees the granted role immediately.
 */
export async function estateGate(
  c: Context<AppBindings>,
  identity: Identity,
  user: AppUser,
): Promise<Response | null> {
  const mode = estateMode(c.env.ESTATE_CHECK);
  if (mode === 'off') return null;

  try {
    const baseUrl = c.env.ESTATE_AUTH_URL;
    const appToken = c.env.ESTATE_APP_TOKEN_GAMES;
    if (!baseUrl || !appToken) {
      // Named loudly IN the shadow log stream: a misconfigured shadow that
      // stayed silent would read as "zero would-denies" — false comfort, the
      // exact lie shadow mode exists to prevent. Behaviour stays `off`.
      console.warn(
        `estate ${mode}: config unset (need ESTATE_AUTH_URL [vars] + ESTATE_APP_TOKEN_GAMES secret) — check skipped`,
      );
      return null;
    }

    // §5.2: cache while fresh, /seen otherwise, stale cache on failure. The
    // cache columns live on this user's own app_user row (migration 0026).
    const cached = await readEstateCache(c.env.DB, user.id);
    const result = await estateCheck(
      { status: isEstateStatus(cached.status) ? cached.status : null, checkedAt: cached.checkedAt },
      { email: user.email, firebaseUid: identity.uid, displayName: identity.name },
      { baseUrl, appToken },
    );
    if (result.refresh) {
      await writeEstateCache(c.env.DB, {
        userId: user.id,
        status: result.refresh.status,
        checkedAt: result.refresh.checkedAt,
      });
    }

    // §3.1. `active` = any role beyond pending; `locallyDecided` = an owner
    // ever stamped approved_at (so an explicit local demotion stays standing).
    const verdict = combineEstateAndLocal(result.status, {
      active: user.role !== 'pending',
      locallyDecided: user.approvedAt !== null,
    });

    const { deny, action } = actionFor(verdict);
    console.log(
      `estate ${mode}: ${user.email} role=${user.role} estate=${result.status ?? 'none'}` +
        `${result.stale ? ' (stale cache, auth Worker unreachable)' : ''} verdict=${verdict}` +
        ` ${mode === 'shadow' ? 'would=' : 'action='}${action}` +
        `${deny ? (mode === 'shadow' ? ' WOULD-DENY' : ' DENIED') : ''}` +
        `${mode === 'shadow' ? ' (response unchanged)' : ''}`,
    );

    if (mode === 'shadow') return null;

    // enforce — the §3.1 verdicts act.
    switch (verdict) {
      case 'proceed':
      case 'request_screen':
        return null;
      case 'default_grant': {
        const role = AUTH_POSTURE.defaultRole as string;
        const granted = await grantEstateDefaultRole(c.env.DB, { userId: user.id, role });
        if (granted) {
          console.log(`estate enforce: default-granted '${role}' to ${user.email} (estate-wide approval, §5.4)`);
          user.role = role as AppUser['role'];
          user.approvedAt = new Date().toISOString();
        }
        // Not granted = a concurrent local decision won; proceed on it.
        return null;
      }
      case 'revoked':
        // Computed, never stored: the local role stays intact so a later
        // re-approval restores the person exactly as they were (§3.1 row 1).
        return c.json({ error: 'estate_revoked' }, 403);
      case 'estate_unreachable':
        // Named so an outage is distinguishable from a denial (§6 row 1).
        return c.json(
          {
            error: 'estate_unreachable',
            detail: 'the estate directory did not answer and no admission stands; try again shortly',
          },
          503,
        );
    }
  } catch (err) {
    // No estate failure may break a request that local auth already passed —
    // in shadow that is the contract, and in enforce an unexpected throw here
    // degrades to local-only auth (§6 row 1's direction: open for the
    // admitted; strangers are still `pending` locally and gated by
    // capabilities). Loud in the log either way.
    console.error(`estate ${estateMode(c.env.ESTATE_CHECK)}: check failed, proceeding on local auth`, err);
    return null;
  }
}
