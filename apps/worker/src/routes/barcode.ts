import { Hono } from 'hono';
import { z } from 'zod';
import { isPlausibleBarcode, normaliseBarcode, type BarcodeCandidate } from '@bgc/core';
import { contributeGameUpc, gameUpcConfig, resolveBarcode } from '@bgc/barcode';
import { BarcodeConflict, findByBarcode, linkBarcode } from '@bgc/db';
import { ResearchError, identifyBarcode } from '@bgc/research';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

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
  updateUrl: z.string().url().nullable().optional(),
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

function validate(raw: string): { ok: true; code: string } | { ok: false; detail: string } {
  const code = normaliseBarcode(raw);
  if (!code) return { ok: false, detail: 'That does not look like a barcode.' };
  if (!isPlausibleBarcode(code)) {
    return {
      ok: false,
      detail:
        'That barcode failed its check digit, which usually means a misread. Try scanning again.',
    };
  }
  return { ok: true, code };
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
    const checked = validate(c.req.param('code'));
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
    const checked = validate(parsed.data.barcode);
    if (!checked.ok) return c.json({ error: 'bad_request', detail: checked.detail }, 400);

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
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const checked = validate(parsed.data.barcode);
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

    // Best-effort contribution back to the shared database.
    let contributed = false;
    const config = gameUpcConfig(c.env);
    if (config && parsed.data.updateUrl) {
      contributed = await contributeGameUpc(
        config,
        parsed.data.updateUrl,
        await contributorId(c.get('user').email),
      );
    }

    return c.json({ barcode: checked.code, match, contributed });
  });
