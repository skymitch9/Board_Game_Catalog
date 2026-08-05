/**
 * The three research tiers, and the domains each one may cite.
 *
 * The whole design rests on one mechanism: `allowed_domains` on the web-search
 * tool. Tier 1 is given the publisher's domain and nothing else, so the model
 * *cannot* cite Amazon during the official pass — not "is asked not to", cannot.
 * A prompt that asks nicely drifts; a domain allow-list does not.
 *
 * Which is why a missing publisher domain is a hard stop rather than a quiet
 * widening: an "official" pass that searched the open web would produce
 * findings labelled `official` that are nothing of the kind, and the tier tag
 * is what the merge rules and the reviewer both trust.
 */

import type { SourceTier } from '@bgc/core';

export type ResearchTier = Exclude<SourceTier, 'community'>;

export interface TierSpec {
  tier: ResearchTier;
  label: string;
  /** Null means "derive from the item" — only tier 1 does this. */
  domains: string[] | null;
  /** What this tier is uniquely good for. Goes into the prompt. */
  focus: string;
  /** Search breadth. Retail needs fewer hops than an official spec hunt. */
  maxSearches: number;
  maxFetches: number;
  /**
   * Effort per tier. Tier 1 is the one whose answers get trusted on conflict,
   * so it is worth thinking harder about; tier 3 is mostly lookups.
   */
  effort: 'low' | 'medium' | 'high';
}

export const TIER_SPECS: Record<ResearchTier, TierSpec> = {
  official: {
    tier: 'official',
    label: 'Official — the publisher',
    domains: null,
    focus: [
      'Box contents and exact component counts.',
      'Card sizes in millimetres, and how many cards of each size.',
      'The official list of expansions and accessories for this game.',
      'Errata, rules clarifications and known misprints.',
    ].join(' '),
    maxSearches: 8,
    maxFetches: 5,
    effort: 'high',
  },
  crowdfunding: {
    tier: 'crowdfunding',
    label: 'Crowdfunding — Kickstarter and Gamefound',
    domains: ['kickstarter.com', 'gamefound.com'],
    focus: [
      'Pledge tiers and what each contained.',
      'Kickstarter-exclusive content not available at retail.',
      'Stretch goals that added components.',
      'Deluxe upgrades, and any difference between the retail and crowdfunded versions.',
    ].join(' '),
    maxSearches: 6,
    maxFetches: 4,
    effort: 'medium',
  },
  retail: {
    tier: 'retail',
    label: 'Retail — shops and sleeve vendors',
    domains: [
      'amazon.com',
      'boardgamegeek.com',
      'miniaturemarket.com',
      'coolstuffinc.com',
      'gamenerdz.com',
      'sleevekings.com',
      'maydaygames.com',
      'dragonshield.com',
      'gamegenic.com',
      'boardgamebits.com',
    ],
    focus: [
      'Current availability and typical price.',
      'Sleeve products that match this game’s card sizes, by name and pack size.',
      'Third-party inserts and organisers made for this game.',
    ].join(' '),
    maxSearches: 6,
    maxFetches: 4,
    effort: 'low',
  },
};

/**
 * The publisher's domain, taken from what the catalog already knows.
 *
 * Deliberately narrow: `publisherUrl` is a field a person filled in or a lookup
 * populated, so it is the one piece of publisher identity we can stand behind.
 * Guessing a domain from the publisher's *name* would hand tier 1 an allow-list
 * built from a guess, which is exactly the failure this tier exists to prevent.
 */
export function publisherDomain(publisherUrl: string | null | undefined): string | null {
  if (!publisherUrl) return null;
  try {
    const url = new URL(publisherUrl.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/** Resolve a tier's allow-list for one item, or explain why it cannot run. */
export function domainsForTier(
  spec: TierSpec,
  item: { publisherUrl?: string | null },
): { domains: string[] } | { blocked: string } {
  if (spec.domains) return { domains: spec.domains };

  const domain = publisherDomain(item.publisherUrl);
  if (!domain) {
    return {
      blocked:
        'The official tier needs the publisher’s website, and this game has none recorded. ' +
        'Add a publisher URL on the item and run it again — searching the open web instead ' +
        'would produce findings labelled "official" that are not.',
    };
  }
  return { domains: [domain] };
}
