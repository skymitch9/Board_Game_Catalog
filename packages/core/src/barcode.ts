/**
 * Leaf module: what a barcode is, and what "we think this is the game" looks like.
 *
 * Every tier of the resolution ladder — local table, GameUPC, UPCitemdb, Claude —
 * answers in this same shape, so the Worker route and the confirm screen only
 * ever deal with one type. `source` is kept on each candidate rather than on the
 * response so a merged list stays honest about where each row came from.
 *
 * Imports `constants.ts` only. Nothing here does I/O.
 */

import type { ItemKind } from './constants.js';

/** Which rung of the ladder produced a candidate. Ordered cheapest first. */
export const CANDIDATE_SOURCES = ['local', 'gameupc', 'upcitemdb', 'llm'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export interface BarcodeCandidate {
  name: string;
  /** Set when the source knows it. The whole point of GameUPC is that it does. */
  bggId: number | null;
  publisher: string | null;
  yearPublished: number | null;
  kind: ItemKind;
  /** The specific printing, when named: "2nd Edition", "Kickstarter Deluxe". */
  editionName: string | null;
  thumbnailUrl: string | null;
  confidence: Confidence;
  source: CandidateSource;
  sourceUrl: string | null;
  note: string | null;
}

/**
 * UPC-A / EAN-13 check digit.
 *
 * Catches most misreads before they cost a network call — a scanner that drops
 * or flips one digit produces a syntactically valid number that fails this.
 * Cheap enough to run on the phone before the request is even sent.
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

/** Strip formatting so the same physical barcode always keys the same row. */
export function normaliseBarcode(code: string): string {
  return code.replace(/\D/g, '');
}

/**
 * Best-first ordering: confidence dominates, then how much we trust the source.
 * A `local` hit is a barcode a human already confirmed, so it outranks anything
 * a remote service guessed at the same confidence.
 */
export function rankCandidates(candidates: BarcodeCandidate[]): BarcodeCandidate[] {
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const bySource: Record<CandidateSource, number> = {
    local: 0,
    gameupc: 1,
    llm: 2,
    upcitemdb: 3,
  };
  return [...candidates].sort(
    (a, b) =>
      byConfidence[a.confidence] - byConfidence[b.confidence] ||
      bySource[a.source] - bySource[b.source],
  );
}
