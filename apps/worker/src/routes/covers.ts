import { Hono } from 'hono';
import { z } from 'zod';
import { coverHealth } from '@bgc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { COVER_BATCH, runCoverCheck } from '../lib/cover-check.js';
import { coverStorageStatus } from '../lib/cover-storage.js';

/**
 * Cover-image health.
 *
 * Reading the verdict is browsing — anyone who can see the collection can see
 * that some of its pictures are broken — so `/health` needs only `read`.
 * Running a check makes outbound requests and writes rows, so it is
 * `editCatalog`, like every other write.
 */

const runSchema = z.object({
  /**
   * Capped, not merely defaulted. A forced check is the natural place for
   * somebody to type a large number, and the subrequest ceiling does not care
   * that the request was deliberate.
   *
   * 🔴 **The ceiling is `COVER_BATCH`, not `COVER_BATCH * 2`.** It was the
   * double until 2026-09-06, which meant this route could ask for a run
   * costing twice what one Worker invocation can pay for — the *worse* half of
   * the 2026-08 audit's finding 5, because a forced run is the one somebody is
   * watching. `COVER_BATCH` is now derived from that budget, so anything above
   * it is a request to be terminated mid-run.
   */
  limit: z.coerce.number().int().min(1).max(COVER_BATCH).default(COVER_BATCH),
});

/**
 * ⚠️ Zod's `issues` array is a machine's answer, not a person's. The estate
 * rule is that a refusal says what happened, what it needs, and how to get
 * there; `detail` is that sentence and `issues` is kept beside it for whoever
 * is reading with a debugger open.
 */
const LIMIT_DETAIL =
  `A forced cover check probes between 1 and ${COVER_BATCH} URLs. ` +
  `${COVER_BATCH} is the most one run can pay for — a Worker invocation has a fixed ` +
  'subrequest budget, and a run that goes over it is cut off part-way with nothing ' +
  'written down. Ask for a number in that range, or run it twice: the queue is ' +
  'oldest-checked-first, so a second run continues where the first stopped.';

export const coverRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('read'))

  .get('/health', async (c) => {
    return c.json({ health: await coverHealth(c.env.DB) });
  })

  /**
   * Is the `game-covers` R2 bucket wired up? A property of the deployment,
   * not of the collection, so `read` rather than `editCatalog` — mirrors
   * library's `GET /api/cover-storage`.
   */
  .get('/storage', (c) => c.json(coverStorageStatus(c.env)))

  /** Force a slice now, rather than waiting for the cron. Also how it is tested. */
  .post('/check', requireCapability('editCatalog'), async (c) => {
    const parsed = runSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: 'bad_request', detail: LIMIT_DETAIL, issues: parsed.error.issues },
        400,
      );
    }
    const run = await runCoverCheck(c.env.DB, parsed.data.limit);
    return c.json({ run, health: await coverHealth(c.env.DB) });
  });
