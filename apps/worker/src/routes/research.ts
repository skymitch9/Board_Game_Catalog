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
import {
  claimDetailsRun,
  runDetailsInBackground,
  toDetailsRun,
} from '../lib/details-run.js';
import { requireCapability } from '../middleware/auth.js';

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
   * Fill in one game's blanks from the open web — in the background.
   *
   * Answers with a run id straight away rather than holding the request open
   * for the tens of seconds a Claude web search takes. That wait was not the
   * real problem: a connection dropping mid-call paid for the lookup and lost
   * the answer, because nothing but the response held it. The work now runs
   * under `waitUntil` and reports through `research_run`, so closing the tab
   * costs nothing — see `lib/details-run.ts`.
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

    if (!alreadyRunning) {
      c.executionCtx.waitUntil(runDetailsInBackground(c.env, run.id, id));
    }

    return c.json({ run: toDetailsRun(run), alreadyRunning }, alreadyRunning ? 200 : 202);
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
