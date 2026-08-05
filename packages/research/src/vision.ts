import type { BarcodeCandidate, Confidence, ItemKind, ShelfTitle } from '@bgc/core';
import { RESEARCH_MODEL, createClient, parseStructured, usageOf, type Usage } from './client.js';

/**
 * Reading games off a photograph.
 *
 * This exists because barcodes are a weak primitive for board games — half the
 * sample we measured had no usable barcode record anywhere, and Kickstarter and
 * small-publisher editions frequently have none at all. The title, meanwhile, is
 * printed on the box in very large type. Vision reads what barcodes cannot.
 *
 * There is no useful "reverse image search" API to lean on here (Bing's was
 * retired, Google's is closed to new customers), so the model reading the words
 * off the box *is* the matching step.
 */

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof MEDIA_TYPES)[number];

export interface Photo {
  /** Raw base64, no data: URL prefix. */
  data: string;
  mediaType: PhotoMediaType;
}

export function isPhotoMediaType(v: string): v is PhotoMediaType {
  return (MEDIA_TYPES as readonly string[]).includes(v);
}

function imageBlock(photo: Photo) {
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: photo.mediaType, data: photo.data },
  };
}

// ---------------------------------------------------------------------------
// One box, read carefully
// ---------------------------------------------------------------------------

const IDENTIFY_SYSTEM = `You identify board games from a photograph of the box.

Read what is actually printed. The title is normally the largest text on the
front. Publisher logos, designer names, player counts and age ratings are also
usually present and are worth reporting when legible.

Rules:
- Report only what you can see. Do not infer a year, publisher or edition that
  is not visible or that you do not recognise with confidence.
- Zero candidates is a valid answer. Say so rather than inventing a plausible game.
- Distinguish the base game from an expansion. Expansion boxes are usually
  smaller and normally name their base game somewhere on the front.
- editionName only when the box actually says so ("2nd Edition", "Kickstarter
  Exclusive", "Big Box"), otherwise null.
- If the photo is too blurry, dark or angled to read, return zero candidates and
  say why in note. That is far more useful than a guess.`;

const CANDIDATE_PROPERTIES = {
  name: { type: 'string' },
  publisher: { type: ['string', 'null'] },
  yearPublished: { type: ['integer', 'null'] },
  kind: { type: 'string', enum: ['base', 'expansion', 'accessory', 'promo', 'upgrade'] },
  editionName: { type: ['string', 'null'] },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  note: { type: ['string', 'null'] },
} as const;

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: CANDIDATE_PROPERTIES,
        required: ['name', 'publisher', 'yearPublished', 'kind', 'editionName', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['candidates', 'unreadable'],
  additionalProperties: false,
} as const;

interface RawIdentified {
  name: string;
  publisher: string | null;
  yearPublished: number | null;
  kind: ItemKind;
  editionName: string | null;
  confidence: Confidence;
  note: string | null;
}

export interface PhotoIdentification {
  candidates: BarcodeCandidate[];
  /** True when the model could not read the photo at all — prompt a retake. */
  unreadable: boolean;
  usage: Usage;
}

/**
 * Identify one game from a photo of its box.
 *
 * No web search: the title is right there in the image, and searching would add
 * a minute and a per-search fee for information the photo already contains.
 * Resolving the name to a BGG id is the free lookup rungs' job afterwards.
 */
export async function identifyFromPhoto(
  apiKey: string | undefined,
  photo: Photo,
): Promise<PhotoIdentification> {
  const client = createClient(apiKey);

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 1500,
    // Reading large print off a box is perception, not reasoning.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: IDENTIFY_SCHEMA } },
    system: [{ type: 'text', text: IDENTIFY_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [imageBlock(photo), { type: 'text', text: 'What board game is this?' }],
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const parsed = parseStructured<{ candidates: RawIdentified[]; unreadable: boolean }>(
    message as Parameters<typeof parseStructured>[0],
  );

  return {
    candidates: (parsed.candidates ?? []).map((c) => ({
      ...c,
      bggId: null,
      thumbnailUrl: null,
      source: 'llm' as const,
      sourceUrl: null,
    })),
    unreadable: parsed.unreadable ?? false,
    usage: usageOf(message as { usage?: { input_tokens?: number; output_tokens?: number } }),
  };
}

// ---------------------------------------------------------------------------
// Many spines, read broadly
// ---------------------------------------------------------------------------

const SHELF_SYSTEM = `You read board game titles off a photograph of a shelf.

Board game spines and box edges carry the title in large type, because that is
how people find them on a shelf. Read every one you can.

Rules:
- Report titles exactly as printed. Do not expand abbreviations, correct
  spelling, or add a subtitle you cannot see.
- Order by position, left to right (or top to bottom for a stack), starting at 1.
  This is how the person will find the box again, so it matters.
- Include partly-obscured titles at lower confidence, with what blocked them in
  note. A partial title the user can correct beats a missing one.
- Do not guess at a spine you cannot read at all. Omit it.
- Expansions shelved next to their base game are separate entries. Do not merge
  them, and do not assume which is which from position alone.`;

const SHELF_SCHEMA = {
  type: 'object',
  properties: {
    titles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          position: { type: 'integer' },
          note: { type: ['string', 'null'] },
        },
        required: ['text', 'confidence', 'position', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['titles', 'unreadable'],
  additionalProperties: false,
} as const;

export interface ShelfReading {
  titles: ShelfTitle[];
  unreadable: boolean;
  usage: Usage;
}

/**
 * Read every title on a shelf.
 *
 * Deliberately does no resolution — twelve web searches would take minutes.
 * The caller matches these titles against the local catalog and the free lookup
 * rungs, which is fast and costs nothing.
 */
export async function readShelf(
  apiKey: string | undefined,
  photo: Photo,
): Promise<ShelfReading> {
  const client = createClient(apiKey);

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    // A dense shelf can hold twenty-plus titles.
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SHELF_SCHEMA } },
    system: [{ type: 'text', text: SHELF_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          imageBlock(photo),
          { type: 'text', text: 'List every board game title you can read on this shelf.' },
        ],
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const parsed = parseStructured<{ titles: ShelfTitle[]; unreadable: boolean }>(
    message as Parameters<typeof parseStructured>[0],
  );

  return {
    titles: (parsed.titles ?? []).sort((a, b) => a.position - b.position),
    unreadable: parsed.unreadable ?? false,
    usage: usageOf(message as { usage?: { input_tokens?: number; output_tokens?: number } }),
  };
}
