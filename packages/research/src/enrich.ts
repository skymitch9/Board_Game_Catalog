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

import { APIUserAbortError } from '@anthropic-ai/sdk';
import { fillableFieldsFor, type FillField, type ItemKind } from '@bgc/core';
import {
  RESEARCH_MODEL,
  ResearchError,
  assertSearchBudgetLeft,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';

/**
 * How long one lookup may take before it is stopped and called a failure.
 *
 * This is not a guess at how long the model needs — it is the ceiling the
 * *caller* survives. `POST /api/research/:id/details` does this work under
 * `executionCtx.waitUntil`, and Cloudflare cancels a `waitUntil` task that is
 * still running about thirty seconds after the response was returned. That
 * cancellation is silent: no exception, nothing reaches a `catch`, and the run
 * row sits at `running` for ever. Production said so in as many words —
 *
 *   (warn) waitUntil() tasks did not complete within the allowed time after
 *   invocation end and have been cancelled.
 *
 * — while `research_run` id 3 stayed `running` for eleven hours.
 *
 * So the call is stopped *before* the platform stops it, because a lookup that
 * throws is a lookup that gets written down. **Anything raised above the
 * platform's budget re-opens the silent failure**; if a longer lookup is ever
 * wanted, the work has to leave `waitUntil` first.
 */
export const ENRICH_TIMEOUT_MS = 60_000;

/**
 * An `AbortSignal.timeout` firing, however it reached us.
 *
 * Three spellings on purpose. The SDK wraps an aborted request in its own
 * `APIUserAbortError`, whose `message` is the unhelpful "Request was aborted."
 * and whose `name` is plain `Error` — so neither a name check nor the message
 * alone is enough, and a bare `instanceof` misses a `DOMException` raised
 * before the SDK gets involved.
 */
function isAbort(err: unknown): boolean {
  if (err instanceof APIUserAbortError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

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

  const stream = client.messages.stream(
    {
      model: RESEARCH_MODEL,
      // Six short facts and a two-sentence description. Measured output is
      // 550–1800 tokens; 8000 was headroom nobody used, and every token the
      // model is allowed is time this call is allowed to take.
      max_tokens: 3000,
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
        //
        // These two numbers are a **time** budget, not a subrequest one: search
        // and fetch run on Anthropic's side, so they cost the Worker nothing in
        // subrequests and everything in wall clock. Measured on the three games
        // that have been through this call: 4 searches + 3 fetches took 39s,
        // 57s and 73s; 2 searches and no fetch took 18s and 22s but lost facts
        // worth having — *Before the Stroke of Midnight* came back with a
        // publication year at the higher budget and null at the lower, and the
        // year is the only thing that row is queued for. Three and one is the
        // setting that kept the answers and halved the clock.
        { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1 },
      ],
      messages: [
        {
          role: 'user',
          content: `${identity}

Find this game's publisher and their website, the year it was published, the
player count, a typical playing time, and a one or two sentence description.

Answer from the search results themselves; do not open pages one at a time.
Leave anything you cannot confirm as null.`,
        },
      ],
    },
    // A lookup that runs away must *fail*, not vanish. Without this the promise
    // stays pending until something outside kills it, and on a Worker that kill
    // is silent — see `runDetailsInBackground`. Aborting throws, which lands in
    // a catch and gets written down. No retry: a timeout retried twice is three
    // times the wall clock this exists to bound.
    { signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS), maxRetries: 0 },
  );

  const message = await stream.finalMessage().catch((err: unknown) => {
    if (isAbort(err)) {
      throw new ResearchError(
        `The lookup was still searching after ${Math.round(ENRICH_TIMEOUT_MS / 1000)}s and was stopped. Try again.`,
        504,
      );
    }
    throw err;
  });

  assertSearchBudgetLeft(
    message,
    'The lookup used its whole search budget without finishing. Try again.',
  );

  return { fields: parseStructured<EnrichedFields>(message), usage: usageOf(message) };
}

/**
 * The subset of found fields that this item is actually missing, and may have.
 *
 * Two rules, and they refuse for different reasons:
 *
 * 1. **Gaps only.** An enrichment that overwrote a hand-typed publisher would be
 *    the kind of quiet damage nobody notices until the value they corrected is
 *    wrong again.
 * 2. **Only what this kind of row can have.** `fillableFieldsFor` is the policy —
 *    a dice tray has no player count and no description of its own, and a
 *    rulebook has no playing time. The model is asked the same six questions
 *    whatever it is pointed at, so without this the *answers* land wherever
 *    there is a blank column: searching "Dice Throne Vanguard: Dice Tray" by
 *    name finds Dice Throne Vanguard, and the tray becomes a dice game for 2–6
 *    players. Refusing on the way in is what makes that impossible rather than
 *    merely unlikely.
 */
export function fieldsToFill(
  current: {
    /** Decides what this row may hold at all. */
    kind: ItemKind | string;
    /** A ruleset the row is played under, which has no player count. */
    gameSystem?: string | null;
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

  const allowed = fillableFieldsFor(current.kind, current.gameSystem, current.publisher);
  const fill = (field: FillField, value: string | number | null): void => {
    if (!allowed.includes(field)) return;
    if (!blank(current[field]) || !value) return;
    patch[field] = value;
  };

  fill('publisher', found.publisher);
  fill('publisherUrl', found.publisherUrl);
  fill('yearPublished', found.yearPublished);
  fill('minPlayers', found.minPlayers);
  fill('maxPlayers', found.maxPlayers);
  fill('playtimeMin', found.playtimeMin);
  fill('description', found.description);

  return patch;
}

/** Roughly what one of these costs, for showing before a bulk run. */
export const ENRICH_CENTS_EACH = { low: 2, high: 6 };
