import { Hono } from 'hono';
import { z } from 'zod';
import { gameUpcConfig, resolveTitle } from '@bgc/barcode';
import { getCached, putCached } from '@bgc/db';
import type { BarcodeCandidate } from '@bgc/core';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Look a game up by name, to fill in a form.
 *
 * The catalog knows a title the moment someone types one, and everything else —
 * publisher, year, player count, cover, BGG id — is a lookup away. Making a
 * person retype what a free API already knows is the kind of busywork this app
 * exists to remove.
 *
 * Same free rungs and the same week-long cache as everything else, so typing in
 * a game you already scanned costs nothing. No model call: this is a name
 * search, not a reading.
 */

const querySchema = z.object({
  q: z.string().trim().min(2, 'type at least two characters').max(200),
});

export const lookupRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  .get('/', async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const title = parsed.data.q;

    const cached = await getCached<BarcodeCandidate[] | null>(c.env.DB, 'title', `q:${title}`);
    if (cached) return c.json({ candidates: cached, cached: true });

    const deps = { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN };
    const hit = await resolveTitle(deps, title);

    // Cache only once BGG has had its chance, so a week of type-ahead is not
    // pinned to the thinner shape from before the token arrived.
    if (hit.bggHydrated || !deps.bggToken) {
      await putCached(c.env.DB, 'title', `q:${title}`, hit.candidates);
    }

    return c.json({ candidates: hit.candidates, cached: false });
  });
