import Anthropic from '@anthropic-ai/sdk';

/**
 * Shared Claude plumbing.
 *
 * Every call here costs real money, so the rules are the same throughout:
 * the model is asked for structured output (no parsing, no retry-on-bad-JSON),
 * effort is chosen per call rather than defaulted high, and the system prompt
 * is cached because it is identical across every game.
 */

export const RESEARCH_MODEL = 'claude-opus-5';

export class ResearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) {
    throw new ResearchError(
      'No Anthropic API key configured. Set ANTHROPIC_API_KEY (see docs/SETUP.md).',
      503,
    );
  }
  return new Anthropic({ apiKey });
}

/** Rough cost estimate in cents, for showing before a run rather than after. */
export function estimateCents(inputTokens: number, outputTokens: number): number {
  // claude-opus-5: $5 / MTok in, $25 / MTok out.
  return (inputTokens / 1_000_000) * 500 + (outputTokens / 1_000_000) * 2500;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCents: number;
}

export function usageOf(message: {
  usage?: { input_tokens?: number; output_tokens?: number };
}): Usage {
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  return { inputTokens, outputTokens, estimatedCents: estimateCents(inputTokens, outputTokens) };
}

/**
 * Pull the JSON payload out of a structured-outputs response.
 *
 * Checks stop_reason first: a refusal or a truncation both produce content that
 * looks parseable-ish and isn't, and silently returning half a result is worse
 * than failing.
 */
export function parseStructured<T>(message: {
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
}): T {
  if (message.stop_reason === 'refusal') {
    throw new ResearchError(
      `Claude declined this request${
        message.stop_details?.category ? ` (${message.stop_details.category})` : ''
      }.`,
      422,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ResearchError(
      'The response was cut off before it finished. Try a narrower request.',
      502,
    );
  }

  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new ResearchError('Claude returned no text to parse.', 502);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ResearchError('Claude returned text that was not valid JSON.', 502);
  }
}
