import { Hono } from 'hono';
import { z } from 'zod';
import { gameUpcConfig } from '@bgc/barcode';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { cachedResolveAll, readCachedTitle } from '../lib/resolve-title.js';

/**
 * Look a game up by name, to fill in a form.
 *
 * The catalog knows a title the moment someone types one, and everything else —
 * publisher, year, player count, cover, BGG id — is a lookup away. Making a
 * person retype what a free API already knows is the kind of busywork this app
 * exists to remove.
 *
 * Same free rungs and **the same cache entries** as everything else, so typing
 * in a game you already scanned costs nothing. No model call: this is a name
 * search, not a reading.
 *
 * ✅ **Fixed 2026-09-06 — the 2026-08 audit's finding 3.** This route used to
 * hand-roll the cache around a direct `resolveTitle()`, and got both halves
 * wrong in opposite directions:
 *
 * - its predicate was `hit.bggHydrated || !deps.bggToken`, and a genuine "no
 *   such game" answer is neither (`bggHydrated` is false when there was nothing
 *   to hydrate), so **a real negative was NEVER cached** — every keystroke of
 *   every nonexistent title re-ran the whole free ladder against a shared
 *   100/day quota;
 * - a lookup that **FAILED** (quota exhausted, 5xx) returns the same
 *   `bggHydrated: false`, so with no BGG token it was cached as an empty
 *   answer, freezing "this game does not exist" in place for a week. That is
 *   the trap `info/gotchas.md` records as *"a lookup that failed is not a
 *   lookup that found nothing"*.
 *
 * It also keyed on `q:${title}` while every other caller keys on the bare
 * title, so the type-ahead and the scan path each paid for the same answer
 * despite this file's own docstring claiming they shared one. `cachedResolveAll`
 * has all three right, and is now the only implementation.
 *
 * ⚠️ **One deliberate consequence:** `cachedResolveAll` keeps five candidates,
 * where this route used to return every candidate GameUPC ranked. The two
 * consumers that read past the first (`AddRelated`, the review screen) are
 * offering a list nobody scrolls, and the scan path has been on five since it
 * was written.
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

    // Read first, only so the body can SAY whether it was cached — the same
    // read `cachedResolveAll` would do, through the same helper, rather than a
    // second copy of the stored-null normalisation. A hit returns here; a miss
    // is going to the network anyway, where one D1 read is noise.
    const cached = await readCachedTitle(c.env.DB, title);
    if (cached) return c.json({ candidates: cached, cached: true });

    const deps = { gameUpc: gameUpcConfig(c.env), bggToken: c.env.BGG_API_TOKEN };
    const candidates = await cachedResolveAll(c.env.DB, deps, title);

    return c.json({ candidates, cached: false });
  });
