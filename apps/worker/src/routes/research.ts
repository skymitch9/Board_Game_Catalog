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
  listFindings,
  listItemsNeedingDetails,
  listRuns,
  reviewFinding,
  saveFindings,
  updateItem,
} from '@bgc/db';
import {
  ENRICH_CENTS_EACH,
  RESEARCH_MODEL,
  ResearchError,
  TIER_SPECS,
  domainsForTier,
  enrichItem,
  estimateTierCents,
  fieldsToFill,
  runTier,
} from '@bgc/research';
import type { AppBindings } from '../env.js';
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
   * Fill in one game's blanks from the open web.
   *
   * Gaps only — anything already recorded is left alone, because a value you
   * typed is better evidence than one a model found, and a catalog that
   * quietly rewrites your entries is one you stop trusting. The response says
   * exactly which fields moved.
   */
  .post('/:id/details', requireCapability('runResearch'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const item = await getItem(c.env.DB, id);
    if (!item) return c.json({ error: 'not_found' }, 404);

    try {
      const { fields, usage } = await enrichItem(c.env.ANTHROPIC_API_KEY, {
        name: item.name,
        yearPublished: item.yearPublished,
        bggId: item.bggId,
        publisher: item.publisher,
      });

      if (fields.notFound) {
        return c.json({
          item,
          filled: {},
          found: fields,
          usage,
          detail: fields.note ?? 'That game could not be identified confidently.',
        });
      }

      const patch = fieldsToFill(item, fields);
      const updated =
        Object.keys(patch).length > 0 ? await updateItem(c.env.DB, id, patch) : item;

      return c.json({ item: updated, filled: patch, found: fields, usage });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ResearchError) {
        return c.json({ error: 'lookup_failed', detail: message }, err.status as 400);
      }
      return c.json({ error: 'lookup_failed', detail: message }, 502);
    }
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
