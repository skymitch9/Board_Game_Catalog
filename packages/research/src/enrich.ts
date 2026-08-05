/**
 * Filling in what the free lookups could not.
 *
 * GameUPC answers with a name, a BGG id and sometimes a year — and that is all.
 * It carries no publisher at all (see the comment in `gameupc.ts`), which is
 * why every game in a freshly scanned collection has an empty publisher field,
 * and why the research pipeline's official tier has no domain to search.
 * BGG would supply it; BGG needs a token that has not arrived.
 *
 * So this asks Claude, with the open web available. It is the cheap
 * counterpart to the tiered research pass: one search, a handful of plain
 * facts, no tier ordering and no staging table. The facts it looks for are the
 * ones printed on the box — publisher, year, player count, playing time — which
 * are widely agreed and dull, exactly the sort of thing worth taking from a
 * single well-chosen source.
 *
 * It only ever *fills gaps*. Nothing already recorded is overwritten, because
 * a value someone typed is better evidence than a value a model found, and a
 * catalog that quietly rewrites your entries is one you stop trusting.
 */

import {
  RESEARCH_MODEL,
  ResearchError,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';

/** The fields worth asking about: printed on the box, and rarely disputed. */
export interface EnrichedFields {
  publisher: string | null;
  /** The publisher's own site. What unblocks the official research tier. */
  publisherUrl: string | null;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  /** One or two sentences. Not a review — what the game is. */
  description: string | null;
  /** Where this came from, so a wrong answer can be traced. */
  sourceUrl: string | null;
  /** Said plainly when the game could not be identified, rather than guessed. */
  notFound: boolean;
  note: string | null;
}

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    publisher: { type: ['string', 'null'] },
    publisherUrl: { type: ['string', 'null'] },
    yearPublished: { type: ['integer', 'null'] },
    minPlayers: { type: ['integer', 'null'] },
    maxPlayers: { type: ['integer', 'null'] },
    playtimeMin: { type: ['integer', 'null'] },
    description: { type: ['string', 'null'] },
    sourceUrl: { type: ['string', 'null'] },
    notFound: { type: 'boolean' },
    note: { type: ['string', 'null'] },
  },
  required: [
    'publisher',
    'publisherUrl',
    'yearPublished',
    'minPlayers',
    'maxPlayers',
    'playtimeMin',
    'description',
    'sourceUrl',
    'notFound',
    'note',
  ],
  additionalProperties: false,
} as const;

/** Identical for every game, so it caches. The game goes in the user turn. */
const SYSTEM_PROMPT = `You look up basic facts about a board game and report only what a source states.

Rules:

- If you cannot confidently identify the game, set notFound to true and leave
  every field null. A wrong game's details are far worse than none: they get
  written into someone's catalog and look correct.
- Report the **English edition**. Where a game was first published in another
  language, name the publisher of the English-language edition, not the
  original — "Stronghold Games", not "Edition Spielwiese (English edition by
  Stronghold Games)"; "Catan Studio", not "Kosmos". Only name a non-English
  publisher when there is no English edition at all.
- publisher is a name and nothing else. No parenthetical parent company, no
  edition history, no second publisher after a semicolon. It is a field someone
  will filter and group by, so "Avalon Hill" and "Avalon Hill (Hasbro)" being
  two different publishers is a real cost.
- publisherUrl is that same publisher's own website — their home page or the
  page for this game on their site. Never a shop, a database, or a wiki. If you
  are not confident of the publisher's real domain, leave it null; a guessed
  domain is worse than an empty field, because a later step will search it as
  though it were authoritative.
- Leave any individual field null rather than estimating it. Partial answers
  are expected and useful.
- description is one or two plain sentences saying what the game is and how it
  plays. Not marketing copy, not a review, no score.
- playtimeMin is a typical full-game length in minutes. For a range, give the
  upper end.
- Prefer the publisher's own pages, then BoardGameGeek, then a retailer.
  sourceUrl is whichever page you actually took the details from.`;

export interface EnrichInput {
  name: string;
  /** Helps disambiguate a common name. Passed through when known. */
  yearPublished?: number | null;
  bggId?: number | null;
  /** Named so the model does not describe a different edition. */
  publisher?: string | null;
}

export interface EnrichResult {
  fields: EnrichedFields;
  usage: Usage;
}

export async function enrichItem(
  apiKey: string | undefined,
  input: EnrichInput,
): Promise<EnrichResult> {
  const client = createClient(apiKey);

  const identity = [
    `Game: ${input.name}`,
    input.yearPublished ? `Published: ${input.yearPublished}` : null,
    input.publisher ? `Publisher: ${input.publisher}` : null,
    input.bggId ? `BoardGameGeek id: ${input.bggId}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const stream = client.messages.stream({
    model: RESEARCH_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      // Cheap on purpose. These are dull, well-agreed facts, and the money in
      // this app belongs in the tiered research pass, not in filling a year in.
      effort: 'low',
      format: { type: 'json_schema', schema: ENRICH_SCHEMA },
    },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [
      // No allowed_domains here, unlike the tiered pass: the whole job is to
      // *find* the publisher, so restricting the search to a domain we do not
      // know yet would be circular.
      { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
    ],
    messages: [
      {
        role: 'user',
        content: `${identity}

Find this game's publisher and their website, the year it was published, the
player count, a typical playing time, and a one or two sentence description.

Leave anything you cannot confirm as null.`,
      },
    ],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'pause_turn') {
    throw new ResearchError(
      'The lookup used its whole search budget without finishing. Try again.',
      502,
    );
  }

  return { fields: parseStructured<EnrichedFields>(message), usage: usageOf(message) };
}

/**
 * The subset of found fields that this item is actually missing.
 *
 * Gap-filling made explicit rather than left to the caller to remember: an
 * enrichment that overwrote a hand-typed publisher would be the kind of quiet
 * damage nobody notices until the value they corrected is wrong again.
 */
export function fieldsToFill(
  current: {
    publisher?: string | null;
    publisherUrl?: string | null;
    yearPublished?: number | null;
    minPlayers?: number | null;
    maxPlayers?: number | null;
    playtimeMin?: number | null;
    description?: string | null;
  },
  found: EnrichedFields,
): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  const blank = (v: string | number | null | undefined): boolean =>
    v == null || (typeof v === 'string' && v.trim() === '');

  if (blank(current.publisher) && found.publisher) patch['publisher'] = found.publisher;
  if (blank(current.publisherUrl) && found.publisherUrl) {
    patch['publisherUrl'] = found.publisherUrl;
  }
  if (blank(current.yearPublished) && found.yearPublished) {
    patch['yearPublished'] = found.yearPublished;
  }
  if (blank(current.minPlayers) && found.minPlayers) patch['minPlayers'] = found.minPlayers;
  if (blank(current.maxPlayers) && found.maxPlayers) patch['maxPlayers'] = found.maxPlayers;
  if (blank(current.playtimeMin) && found.playtimeMin) patch['playtimeMin'] = found.playtimeMin;
  if (blank(current.description) && found.description) patch['description'] = found.description;

  return patch;
}

/** Roughly what one of these costs, for showing before a bulk run. */
export const ENRICH_CENTS_EACH = { low: 2, high: 6 };
