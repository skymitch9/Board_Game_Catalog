/**
 * Phase 3 — the research pipeline, as routes.
 *
 * Research is always an explicit, per-item, per-tier action. Never automatic,
 * never a background sweep: a full three-tier pass costs real money and takes
 * minutes, and the thing it produces is a list of claims for a person to judge,
 * not an improvement that can be applied while nobody is looking.
 *
 * Findings land in `research_finding` and stop there. Accepting one marks the
 * row; it does not write to the catalog. Applying accepted findings is a
 * separate step, deliberately not built yet — see docs/HANDOFF.md.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { DETAIL_FIELD_LABEL, SOURCE_TIERS, detailGaps } from '@bgc/core';
import {
  createRun,
  finishRun,
  findingCounts,
  getItem,
  latestDetailsRuns,
  listFindings,
  listItemsNeedingDetails,
  listRuns,
  reviewFinding,
  saveFindings,
} from '@bgc/db';
import {
  ENRICH_CENTS_EACH,
  RESEARCH_MODEL,
  ResearchError,
  TIER_SPECS,
  domainsForTier,
  estimateTierCents,
  runTier,
} from '@bgc/research';
import type { AppBindings } from '../env.js';
import { claimDetailsRun, runDetailsLookup, toDetailsRun } from '../lib/details-run.js';
import { requireCapability } from '../middleware/auth.js';
import { BILLING_FEATURES, billingRefusal } from '../lib/billing-gate.js';

const RESEARCH_TIERS = SOURCE_TIERS.filter((t) => t !== 'community');
const tierSchema = z.enum(['official', 'crowdfunding', 'retail']);

const reviewStateSchema = z.enum(['pending', 'accepted', 'rejected']);
const runSchema = z.object({ tier: tierSchema });
const reviewSchema = z.object({ reviewState: z.enum(['accepted', 'rejected']) });

const idParam = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const researchRoutes = new Hono<AppBindings>()

  /**
   * What a pass would cost and whether it can even run, before spending it.
   *
   * The blocked case matters as much as the price: the official tier needs a
   * publisher URL, and finding that out after a two-minute run would be a
   * needlessly expensive way to learn it.
   */
  .get('/:id/plan', requireCapability('read'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const item = await getItem(c.env.DB, id);
    if (!item) return c.json({ error: 'not_found' }, 404);

    const tiers = RESEARCH_TIERS.map((tier) => {
      const spec = TIER_SPECS[tier as 'official' | 'crowdfunding' | 'retail'];
      const resolved = domainsForTier(spec, item);
      const cost = estimateTierCents(spec.tier);
      return {
        tier: spec.tier,
        label: spec.label,
        focus: spec.focus,
        effort: spec.effort,
        estimatedCents: cost,
        ...('blocked' in resolved
          ? { runnable: false, blocked: resolved.blocked, domains: [] }
          : { runnable: true, blocked: null, domains: resolved.domains }),
      };
    });

    return c.json({
      item: { id: item.id, name: item.name },
      model: RESEARCH_MODEL,
      tiers,
      counts: await findingCounts(c.env.DB, id),
    });
  })

  /** Everything found for this game so far, plus the runs that produced it. */
  .get('/:id/findings', requireCapability('read'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const state = reviewStateSchema.safeParse(c.req.query('state'));
    const filter = state.success ? { reviewState: state.data } : undefined;

    return c.json({
      findings: await listFindings(c.env.DB, id, filter),
      runs: await listRuns(c.env.DB, id),
      counts: await findingCounts(c.env.DB, id),
    });
  })

  /**
   * Run one tier, now, and wait for it.
   *
   * Deliberately synchronous, unlike the photo queue. A research pass is
   * something a person chose and is watching the cost of; handing back a job id
   * and finishing in the background would make it far too easy to start five by
   * accident. The run row is written before the call so a crash mid-flight
   * leaves a record rather than nothing.
   */
  .post('/:id/run', requireCapability('runResearch'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = runSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const item = await getItem(c.env.DB, id);
    if (!item) return c.json({ error: 'not_found' }, 404);

    const tier = parsed.data.tier;
    const spec = TIER_SPECS[tier];

    // Checked before the run row exists: a tier that cannot run is a bad
    // request, not a failed run, and should not litter the history.
    const resolved = domainsForTier(spec, item);
    if ('blocked' in resolved) {
      return c.json({ error: 'bad_request', detail: resolved.blocked }, 400);
    }

    // G5 — the spending gate, ANDed with `runResearch` above; it replaces
    // nothing (billing design §3.3). Inert while `BILLING_POLICY` is "off".
    // 🔴 This is the most expensive path in the repo — 6–40¢ a run — and it is
    // checked BEFORE the run row is written, for the same reason the blocked
    // tier is: a refusal must not litter the history with a run that never ran.
    const billing = billingRefusal(c, BILLING_FEATURES.tier, 'Research runs', '6-40');
    if (billing) return c.json(billing.body, billing.status);

    const user = c.get('user');
    const run = await createRun(c.env.DB, {
      itemId: id,
      tier,
      model: RESEARCH_MODEL,
      effort: spec.effort,
      triggeredBy: user?.id ?? null,
    });

    try {
      const result = await runTier(c.env.ANTHROPIC_API_KEY, { item, tier });

      const saved = await saveFindings(c.env.DB, {
        runId: run.id,
        itemId: id,
        tier: result.tier,
        findings: result.findings,
      });

      const finished = await finishRun(c.env.DB, run.id, {
        status: 'done',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      return c.json({
        run: finished ?? run,
        saved,
        summary: result.summary,
        domains: result.domains,
        usage: result.usage,
        findings: await listFindings(c.env.DB, id, { reviewState: 'pending' }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finishRun(c.env.DB, run.id, { status: 'error', errorMessage: message });

      if (err instanceof ResearchError) {
        return c.json({ error: 'research_failed', detail: message }, err.status as 400);
      }
      return c.json({ error: 'research_failed', detail: message }, 502);
    }
  })

  /**
   * The games still missing details, and what filling them would cost.
   *
   * Publisher is the one that matters beyond tidiness: it is empty on
   * everything a scan produced, and the official research tier cannot run
   * without the URL that comes with it.
   *
   * Expansions, promos and accessories are **not** here: they read their
   * publisher through from the game they belong to, and the rest of the list
   * describes a game being played rather than a dice tray. `detailGaps` is the
   * one place that decides, so the "missing:" line under a row and the query
   * that chose the row cannot disagree — see `packages/core/src/details.ts`.
   */
  .get('/needs-details', requireCapability('read'), async (c) => {
    const items = await listItemsNeedingDetails(c.env.DB);
    return c.json({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        kind: i.kind,
        missing: detailGaps(i).map((field) => DETAIL_FIELD_LABEL[field]),
      })),
      centsEach: ENRICH_CENTS_EACH,
    });
  })

  /**
   * The outcome of every game that has been looked up.
   *
   * One row per item, newest attempt only. This is what makes the queue survive
   * a reload: the running cost, what each run filled in and what is still going
   * all come back from the table rather than from React state that a navigation
   * throws away.
   */
  .get('/details-runs', requireCapability('read'), async (c) => {
    const runs = await latestDetailsRuns(c.env.DB);
    return c.json({ runs: runs.map(toDetailsRun) });
  })

  /**
   * Fill in one game's blanks from the open web.
   *
   * **This request is slow on purpose — 20 to 70 seconds — and that is the
   * fix, not the bug.** It used to answer in 0.25s and do the work under
   * `executionCtx.waitUntil`, which sounds strictly better and is not: a
   * `waitUntil` task gets about thirty seconds *after the response is
   * returned*, and roughly half of these lookups take longer than that. The
   * cancellation is silent, so those runs sat at `running` for ever. Awaiting
   * keeps the invocation open, and an invocation doing I/O has no such clock.
   *
   * The same promise is still handed to `waitUntil`, which now does the job it
   * was reached for in the first place: if the caller disconnects mid-lookup,
   * the work keeps its thirty seconds and writes down whatever it reaches
   * rather than being dropped. Either way the answer lands in `research_run`,
   * so the queue page's poll finds it even if this response never arrives.
   *
   * Gaps only — anything already recorded is left alone, because a value you
   * typed is better evidence than one a model found, and a catalog that quietly
   * rewrites your entries is one you stop trusting.
   *
   * A second request while one is in flight gets the run already working rather
   * than starting another; the queue page polls, and an unguarded route would
   * buy the same answer twice.
   */
  .post('/:id/details', requireCapability('runResearch'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const item = await getItem(c.env.DB, id);
    if (!item) return c.json({ error: 'not_found' }, 404);

    // G6 — the spending gate, ANDed with `runResearch` above, the key check
    // below and the in-flight dedupe (billing design §3.3). Inert while
    // `BILLING_POLICY` is "off".
    //
    // ⚠️ `research.details` here, NOT `research.tier` — the registry gives the
    // missing-details lookup the same id the library's details run has, because
    // they are the same question asked of the same model, and the owner
    // switching "details research" off means both. The tier run above is its
    // own, far more expensive, switch.
    const billingDetails = billingRefusal(
      c,
      BILLING_FEATURES.details,
      'Missing-details lookups',
      '2-6',
    );
    if (billingDetails) return c.json(billingDetails.body, billingDetails.status);

    // Checked here rather than left to fail in the background: no key is a
    // misconfiguration the caller can act on, and recording it as a failed run
    // would put an error on a game that has nothing wrong with it.
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json(
        { error: 'lookup_failed', detail: 'No Anthropic API key configured (see docs/SETUP.md).' },
        503,
      );
    }

    const user = c.get('user');
    const { run, alreadyRunning } = await claimDetailsRun(c.env.DB, id, user?.id ?? null);

    // Somebody else's lookup is already paying for this answer. Say so and get
    // out of the way; the caller polls for the outcome like everyone else.
    if (alreadyRunning) return c.json({ run: toDetailsRun(run), alreadyRunning: true }, 200);

    const work = runDetailsLookup(c.env, run.id, id);
    // Registered *and* awaited. See the note above: the await is what buys the
    // time, the registration is what saves the answer if this caller vanishes.
    c.executionCtx.waitUntil(work);
    const finished = await work;

    return c.json({ run: toDetailsRun(finished ?? run), alreadyRunning: false }, 200);
  })

  /** Accept or reject one finding. The only thing review does is mark the row. */
  .patch('/findings/:findingId', requireCapability('reviewFindings'), async (c) => {
    const findingId = idParam(c.req.param('findingId'));
    if (!findingId) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = reviewSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const user = c.get('user');
    const finding = await reviewFinding(c.env.DB, findingId, {
      reviewState: parsed.data.reviewState,
      reviewedBy: user.id,
    });

    if (!finding) return c.json({ error: 'not_found' }, 404);
    return c.json({ finding });
  });
