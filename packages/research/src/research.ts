/**
 * One research pass over one game, for one tier.
 *
 * Three tiers, three separate API calls — not one call told to consider three
 * kinds of source. Separate calls are what keep provenance clean (every finding
 * inherits the tier that produced it) and what let a single tier be re-run
 * without redoing the other two.
 *
 * Nothing here writes to the catalog. Findings land in a staging table for a
 * person to accept or reject, because a confident wrong answer from a retailer
 * is exactly the thing this pipeline is most likely to produce.
 */

import {
  RESEARCH_MODEL,
  ResearchError,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';
import { TIER_SPECS, domainsForTier, type ResearchTier, type TierSpec } from './tiers.js';

/**
 * The fields a finding may describe.
 *
 * A closed set rather than free text: `field` is what the review screen groups
 * by and what a future apply-step would map onto columns, so an open vocabulary
 * would turn into forty spellings of "card size" within a week.
 */
export const FINDING_FIELDS = [
  'component_counts',
  'card_sizes',
  'box_contents',
  'official_expansions',
  'official_accessories',
  'errata',
  'player_count',
  'playtime',
  'weight',
  'designers',
  'publisher',
  'year_published',
  'ks_exclusives',
  'stretch_goals',
  'deluxe_upgrades',
  'retail_vs_ks_differences',
  'retail_availability',
  'price',
  'sleeve_requirement',
  'insert_options',
] as const;

export type FindingField = (typeof FINDING_FIELDS)[number];

export interface RawFinding {
  field: FindingField;
  /** The claim itself, as plain prose. Rendered to a person, so it reads as one. */
  value: string;
  /** The page this came from. Always within the tier's allow-list. */
  sourceUrl: string;
  /** 0..1. The model's own estimate of how firmly the source states this. */
  confidence: number;
  /** Caveats worth carrying: ambiguity, a printing-specific detail, a guess. */
  notes: string | null;
}

interface FindingsPayload {
  findings: RawFinding[];
  /** Said plainly when a tier genuinely found nothing, rather than inventing. */
  summary: string;
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: [...FINDING_FIELDS] },
          value: { type: 'string' },
          sourceUrl: { type: 'string' },
          confidence: { type: 'number' },
          notes: { type: ['string', 'null'] },
        },
        required: ['field', 'value', 'sourceUrl', 'confidence', 'notes'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
  additionalProperties: false,
} as const;

/**
 * Identical for every game and every tier, so it is worth caching.
 *
 * Everything that varies — the game, the tier, the domains — goes in the user
 * turn, after the cache breakpoint. Interpolating the game's name up here would
 * make the prefix unique per request and the cache never read.
 */
const SYSTEM_PROMPT = `You research board games and report only what a source actually states.

You are one pass of a three-pass pipeline. Each pass may only cite a fixed list
of domains, and the list has been enforced for you — anything you can reach is
in scope, and there is nothing else to look for.

Rules that matter more than completeness:

- Report only claims a page you actually read supports. If you did not find
  something, leave it out and say so in the summary. An empty findings list is
  a perfectly good result and much better than a plausible guess.
- Every finding carries the URL of the page that states it. Not the search
  results page, not the site's front page — the page with the claim on it.
- Confidence reflects how firmly the *source* states the claim, not how sure
  you feel. A spec table is high; a forum comment repeating a rumour is low.
- Component counts and card sizes are the point of this exercise and the most
  frequently wrong data in the hobby. Prefer an exact figure with a source over
  a rounded one without. If a game has several card sizes, report each one.
- Where a claim is true only of a specific printing, edition, or region, say so
  in the notes rather than stating it flatly.
- Never merge two sources into one finding. One claim, one URL.`;

export interface ResearchInput {
  item: {
    id: number;
    name: string;
    yearPublished?: number | null;
    publisher?: string | null;
    publisherUrl?: string | null;
  };
  tier: ResearchTier;
}

export interface TierResult {
  tier: ResearchTier;
  findings: RawFinding[];
  summary: string;
  usage: Usage;
  /** The allow-list actually enforced, recorded so a run can be explained later. */
  domains: string[];
}

function buildUserPrompt(spec: TierSpec, domains: string[], item: ResearchInput['item']): string {
  const identity = [
    `Game: ${item.name}`,
    item.yearPublished ? `Published: ${item.yearPublished}` : null,
    item.publisher ? `Publisher: ${item.publisher}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${identity}

This is the ${spec.label} pass. You may only cite these domains: ${domains.join(', ')}.

What this pass is for: ${spec.focus}

Search, read the pages that look like they carry specifics, and report what they
state. If this game had no crowdfunding campaign, or the publisher's site has no
component list, say that in the summary and return no findings for it.`;
}

/**
 * Run one tier.
 *
 * Streams because a tier can take a while — several searches, several fetches,
 * and thinking between them — and a non-streaming request that long risks an
 * HTTP timeout before the model is finished.
 */
export async function runTier(
  apiKey: string | undefined,
  input: ResearchInput,
): Promise<TierResult> {
  const spec = TIER_SPECS[input.tier];
  const resolved = domainsForTier(spec, input.item);
  if ('blocked' in resolved) throw new ResearchError(resolved.blocked, 400);
  const { domains } = resolved;

  const client = createClient(apiKey);

  const stream = client.messages.stream({
    model: RESEARCH_MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: spec.effort,
      format: { type: 'json_schema', schema: FINDINGS_SCHEMA },
    },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        allowed_domains: domains,
        max_uses: spec.maxSearches,
      },
      {
        type: 'web_fetch_20260209',
        name: 'web_fetch',
        allowed_domains: domains,
        max_uses: spec.maxFetches,
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(spec, domains, input.item) }],
  });

  const message = await stream.finalMessage();

  // A server-tool turn can stop at the search loop's iteration cap rather than
  // because the model is done. Treated as a real outcome, not a crash: the
  // caller can re-run the tier, and half a findings list is not worth keeping.
  if (message.stop_reason === 'pause_turn') {
    throw new ResearchError(
      'This tier used its whole search budget without finishing. Re-run it, or narrow the game name.',
      502,
    );
  }

  const payload = parseStructured<FindingsPayload>(message);

  return {
    tier: input.tier,
    // Belt and braces on the allow-list: the tool enforces it, but a finding
    // whose URL is off-list would still be mislabelled if one ever slipped by.
    findings: payload.findings.filter((f) => isWithin(f.sourceUrl, domains)),
    summary: payload.summary,
    usage: usageOf(message),
    domains,
  };
}

function isWithin(sourceUrl: string, domains: string[]): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * What a full pass would cost, before anyone spends it.
 *
 * Rough by construction — web search pulls in real page content, so the input
 * side dominates and varies with how chatty the sources are. Shown as a range
 * in the UI rather than a figure, because a precise-looking wrong number is
 * worse than an honest bracket.
 */
export function estimateTierCents(tier: ResearchTier): { low: number; high: number } {
  const byTier: Record<ResearchTier, [number, number]> = {
    official: [12, 40],
    crowdfunding: [8, 25],
    retail: [6, 20],
  };
  const [low, high] = byTier[tier];
  return { low, high };
}
