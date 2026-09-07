import { Hono } from 'hono';
import { z } from 'zod';
import type { BarcodeCandidate } from '@bgc/core';
import {
  GAMEUPC_HOST,
  contributeGameUpc,
  gameUpcConfig,
  isGameUpcUrl,
  lookupGameUpc,
  resolveBarcode,
  type GameUpcConfig,
} from '@bgc/barcode';
import { BarcodeConflict, findByBarcode, linkBarcode } from '@bgc/db';
import { ResearchError, identifyBarcode } from '@bgc/research';
import type { AppBindings } from '../env.js';
import { validateBarcode } from '../lib/barcode-scan.js';
import { requireCapability } from '../middleware/auth.js';
import { BILLING_FEATURES, billingRefusal } from '../lib/billing-gate.js';

/**
 * Barcode scanning: a ladder, cheapest rung first.
 *
 *   local edition.barcode   free, instant, works offline
 *   GameUPC                 free, board-game native, answers with a BGG id
 *   UPCitemdb -> GameUPC    free, catches what GameUPC alone misses
 *   Claude + web search     ~$0.01 and 1-2 MINUTES, so it is opt-in only
 *
 * The split across two routes is deliberate. GET /:code runs everything free
 * and returns fast; the expensive rung is a separate POST the user has to ask
 * for, because measured latency on it is 74-137 seconds and nobody should hit
 * that by accident while standing at a shelf.
 *
 * Nothing here writes to the catalog. Confirmation is always a separate call.
 */

const linkSchema = z.object({
  itemId: z.number().int().positive(),
  barcode: z.string().trim().min(8).max(20),
  editionId: z.number().int().positive().nullable().optional(),
  editionName: z.string().trim().max(200).nullable().optional(),
  /** BGG id of the candidate the user picked, so we can thank GameUPC for it. */
  bggId: z.number().int().positive().nullable().optional(),
  /**
   * GameUPC's own write-back endpoint for this barcode, as GameUPC handed it
   * to us in the lookup the scan screen already made.
   *
   * 🔴 **Host-checked, not merely URL-shaped.** `contributeGameUpc` attaches
   * the Worker's `GAMEUPC_API_KEY` to whatever it is given, so a bare
   * `z.string().url()` here let any `editCatalog` user name a listener of their
   * own and be sent the key — credential forwarding, 2026-08 audit finding 11.
   * The library refuses it too (that is the real choke point, since the key is
   * attached there); this is the half that says so IN WORDS, before anything
   * is written.
   */
  updateUrl: z
    .string()
    .url()
    .refine((u) => isGameUpcUrl(u), {
      message: `a write-back endpoint must be an https URL on ${GAMEUPC_HOST} — this one is not, and it will not be sent anything. It comes from the lookup that found the game; if you are building this request by hand, leave it out and pass "contribute": true instead`,
    })
    .nullable()
    .optional(),
  /**
   * Ask GameUPC for a write-back endpoint when the caller has none.
   *
   * The scan screen already holds one, because the lookup that found the game
   * returned it. Naming an *unknown* barcode at review is the case with no
   * endpoint to hand — and it is the most valuable contribution there is, since
   * by definition nobody has catalogued that code yet.
   */
  contribute: z.boolean().optional(),
  /** The name to offer GameUPC when discovering an endpoint. */
  name: z.string().trim().min(1).max(200).nullable().optional(),
});

const identifySchema = z.object({
  barcode: z.string().trim().min(8).max(20),
});

/**
 * A stable, anonymous id for GameUPC contributions.
 *
 * They only need to attribute a submission consistently, so hash the email
 * rather than send it — a third party has no business learning who is in this
 * household.
 */
async function contributorId(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bgc:${email}`));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Find GameUPC's write-back endpoint for a barcode we are about to link.
 *
 * Best-effort and free: one search against the code we hold, taking the
 * endpoint offered for the BGG id the user actually chose. Returns null for
 * every kind of disappointment, because a contribution that cannot be made must
 * never affect the catalog write that has already succeeded.
 */
async function discoverUpdateUrl(
  config: GameUpcConfig,
  barcode: string,
  bggId: number,
  name: string | null,
): Promise<string | null> {
  if (!name) return null;
  try {
    const hit = await lookupGameUpc(config, barcode, { search: name, searchMode: 'quality' });
    return hit.updateUrls[bggId] ?? null;
  } catch {
    return null;
  }
}

export const barcodeRoutes = new Hono<AppBindings>()
  /**
   * Everything free: the local table first, then GameUPC and UPCitemdb.
   *
   * `read` rather than `editCatalog` on purpose — looking up a barcode to check
   * whether you already own something is a browsing action, and it is the thing
   * you most want while standing in a shop.
   */
  .get('/:code', requireCapability('read'), async (c) => {
    const checked = validateBarcode(c.req.param('code'));
    if (!checked.ok) return c.json({ error: 'bad_request', detail: checked.detail }, 400);

    const local = await findByBarcode(c.env.DB, checked.code);
    if (local) {
      return c.json({
        barcode: checked.code,
        owned: true,
        match: local,
        candidates: [] as BarcodeCandidate[],
        trace: [{ source: 'local', outcome: 'already in the collection' }],
        exhausted: false,
      });
    }

    const resolved = await resolveBarcode(
      { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN },
      checked.code,
    );

    return c.json({ barcode: checked.code, owned: false, match: null, ...resolved });
  })

  /**
   * The paid rung. Gated on `runResearch` rather than `editCatalog` because
   * this is the capability that means "may spend money", and gated behind an
   * explicit request because it is slow enough to feel broken.
   */
  .post('/identify', requireCapability('runResearch'), async (c) => {
    const parsed = identifySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const checked = validateBarcode(parsed.data.barcode);
    if (!checked.ok) return c.json({ error: 'bad_request', detail: checked.detail }, 400);

    // G4 — the spending gate, ANDed with `runResearch` above; it replaces
    // nothing (billing design §3.3). Inert while `BILLING_POLICY` is "off".
    //
    // ⚠️ `barcode.paid` is its OWN registry id and is not `scan.photo`, for the
    // same reason this route is on `runResearch` while the vision routes are on
    // `scanPhoto`: it is a research action about a NUMBER, not a photo, and it
    // buys a web search on top of the model call. Two costs, two switches.
    const billing = billingRefusal(
      c,
      BILLING_FEATURES.barcodePaid,
      'Paid barcode identify',
      'per call, plus a web search',
    );
    if (billing) return c.json(billing.body, billing.status);

    try {
      const result = await identifyBarcode(c.env.ANTHROPIC_API_KEY, checked.code);
      return c.json({
        barcode: checked.code,
        candidates: result.candidates,
        usage: result.usage,
      });
    } catch (err) {
      if (err instanceof ResearchError) {
        return c.json({ error: 'upstream', detail: err.message }, err.status as 500);
      }
      // A transient 400 from the model API has been observed here and succeeds
      // on retry. Say so rather than presenting it as a permanent failure.
      return c.json(
        {
          error: 'upstream',
          detail: `Identification failed: ${(err as Error).message}. This call is occasionally flaky — trying again usually works.`,
          retryable: true,
        },
        502,
      );
    }
  })

  /**
   * Confirm a match. The only route here that writes.
   *
   * Also hands the confirmation back to GameUPC, which is what keeps their
   * database growing — but only after our own write has succeeded, and never in
   * a way that can fail the user's scan.
   */
  .post('/link', requireCapability('editCatalog'), async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      // ⚠️ A sentence first, the machine's version beside it. A zod `issues`
      // array is not something a person can act on, and this route now carries
      // a refusal (the `updateUrl` host check) whose whole value is the words.
      return c.json(
        {
          error: 'bad_request',
          detail: parsed.error.issues.map((i) => i.message).join(' '),
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const checked = validateBarcode(parsed.data.barcode);
    if (!checked.ok) return c.json({ error: 'bad_request', detail: checked.detail }, 400);

    let match;
    try {
      match = await linkBarcode(c.env.DB, {
        itemId: parsed.data.itemId,
        barcode: checked.code,
        editionId: parsed.data.editionId ?? null,
        editionName: parsed.data.editionName ?? null,
      });
    } catch (err) {
      if (err instanceof BarcodeConflict) {
        return c.json({ error: 'conflict', detail: err.message, itemId: err.itemId }, 409);
      }
      // The unique index (migration 0003) turns a lost race into this.
      if (/UNIQUE constraint failed/i.test((err as Error).message)) {
        const winner = await findByBarcode(c.env.DB, checked.code);
        return c.json(
          {
            error: 'conflict',
            detail: winner
              ? `That barcode was just linked to "${winner.item.name}".`
              : 'That barcode is already linked to another game.',
            itemId: winner?.item.id ?? null,
          },
          409,
        );
      }
      throw err;
    }

    // Best-effort contribution back to the shared database. Everything below
    // this line runs after our own write has succeeded and cannot fail it.
    let contributed = false;
    const config = gameUpcConfig(c.env);
    if (config) {
      const url =
        parsed.data.updateUrl ??
        (parsed.data.contribute && parsed.data.bggId
          ? await discoverUpdateUrl(
              config,
              checked.code,
              parsed.data.bggId,
              parsed.data.name ?? match.item.name,
            )
          : null);
      if (url) {
        contributed = await contributeGameUpc(config, url, await contributorId(c.get('user').email));
      }
    }

    return c.json({ barcode: checked.code, match, contributed });
  });
