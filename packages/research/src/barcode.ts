import { RESEARCH_MODEL, createClient, parseStructured, usageOf, type Usage } from './client.js';

/**
 * Identify a board game product from a barcode.
 *
 * Only ever called after a local lookup misses, and its output is a *proposal*
 * — the caller confirms before anything is written. Barcode-to-game matching is
 * genuinely unreliable: retail UPCs are reused, regional printings differ, and
 * plenty of games simply aren't indexed anywhere searchable. Returning ranked
 * candidates with confidence is honest; returning one confident answer would
 * not be.
 */

export interface BarcodeCandidate {
  name: string;
  publisher: string | null;
  yearPublished: number | null;
  kind: 'base' | 'expansion' | 'accessory' | 'promo' | 'upgrade';
  editionName: string | null;
  confidence: 'high' | 'medium' | 'low';
  sourceUrl: string | null;
  note: string | null;
}

export interface BarcodeIdentification {
  candidates: BarcodeCandidate[];
  usage: Usage;
}

const SYSTEM = `You identify board game products from retail barcodes (UPC-A, EAN-13).

Search the web for the barcode number to find what product it belongs to. Retail
listings, publisher pages and barcode databases are all fair game.

Rules:
- Return candidates ranked most likely first. Zero candidates is a valid and
  useful answer — say so rather than inventing a plausible game.
- Confidence must reflect the evidence you actually found. "high" means a source
  explicitly ties this barcode to this product. "low" means you are inferring
  from a partial or indirect match.
- Distinguish the base game from expansions and accessories. A sleeve pack, an
  insert and a promo box are not the base game.
- editionName is the specific printing where the source names one (e.g. "2nd
  Edition", "Retail Edition", "Kickstarter Deluxe"), otherwise null.
- Never guess a year or publisher you did not see. Use null.`;

const SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          publisher: { type: ['string', 'null'] },
          yearPublished: { type: ['integer', 'null'] },
          kind: { type: 'string', enum: ['base', 'expansion', 'accessory', 'promo', 'upgrade'] },
          editionName: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          sourceUrl: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
        },
        required: [
          'name',
          'publisher',
          'yearPublished',
          'kind',
          'editionName',
          'confidence',
          'sourceUrl',
          'note',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

export async function identifyBarcode(
  apiKey: string | undefined,
  barcode: string,
): Promise<BarcodeIdentification> {
  const client = createClient(apiKey);

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 2000,
    // Cheap by design: this fires on every scan miss, and identifying a barcode
    // is lookup rather than reasoning.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        // Three searches is enough to find a barcode or establish it isn't findable.
        max_uses: 3,
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Barcode: ${barcode}\n\nWhat board game product is this?`,
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const parsed = parseStructured<{ candidates: BarcodeCandidate[] }>(
    message as Parameters<typeof parseStructured>[0],
  );

  return {
    candidates: parsed.candidates ?? [],
    usage: usageOf(message as { usage?: { input_tokens?: number; output_tokens?: number } }),
  };
}

/**
 * UPC-A / EAN-13 check digit. Catches most misreads before they cost an API
 * call — a scanner that misreads one digit produces a syntactically valid
 * number that fails this.
 */
export function isPlausibleBarcode(code: string): boolean {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 12 && digits.length !== 13) return false;

  const padded = digits.padStart(13, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(padded[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(padded[12]);
}
