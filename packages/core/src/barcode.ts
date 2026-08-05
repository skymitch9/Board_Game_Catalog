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
  /**
   * Printed on almost every box, so vision reads them in the same call it reads
   * the title — no extra request, no extra cost. Null when not visible rather
   * than guessed, because a wrong player count is worse than a blank one.
   */
  minPlayers: number | null;
  maxPlayers: number | null;
  playtimeMin: number | null;
  /** What the box says the game is, in its own words. Never invented copy. */
  description: string | null;
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
 *
 * Sorting is stable, so candidates the source already ranked keep that order
 * within a band — we only ever re-rank across bands.
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

/**
 * How well a candidate name matches the title we actually searched for, 0..1.
 *
 * Word overlap in both directions, so neither a candidate that says more nor one
 * that says less is unfairly favoured. Deliberately not edit distance: "Duel"
 * and "Dark" are one letter apart in the wrong places, whereas word membership
 * is exactly what distinguishes a variant from its base game.
 */
export function titleSimilarity(candidateName: string, searchedFor: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter((w) => w.length > 1),
    );

  const a = words(candidateName);
  const b = words(searchedFor);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  // Penalise both missing words and extra ones: "King of Tokyo" scores worse
  // against "King of Tokyo Duel" than "King of Tokyo: Duel" does, which is the
  // whole point — a base game should not outrank the variant we scanned.
  return (2 * shared) / (a.size + b.size);
}

/**
 * Below this, a match is a guess rather than an answer — for a title a person
 * typed and then asked us to look up.
 *
 * Ranking orders candidates but never rejects one, so a search always answers
 * with *something*, and the something for a game no database knows is whatever
 * was closest. This is the floor that stops "Gloomhaven" being filled in from
 * "Gloomhaven: Jaws of the Lion" (0.33).
 *
 * Deliberately forgiving, because someone named this specific item on purpose:
 * "Azul" against "Azul (Nordic edition)" scores 0.5 and should still fill.
 */
export const MIN_TITLE_SIMILARITY = 0.34;

/**
 * The stricter floor, for a title nobody confirmed — read off a spine in a
 * photograph and matched without anyone looking.
 *
 * Measured, not guessed. The free databases match on a single word, so six
 * invented titles resolved like this:
 *
 *     ZORBLAX QUANDARY -> Quandary   0.67
 *     NURDLETON RIFT   -> Rift       0.67
 *     FRASKET GAMBIT   -> Gambit     0.67
 *
 * A one-word fragment of a two-word title always scores 2*1/(1+2) = 0.67, while
 * genuine reads — CATAN, BRASS: BIRMINGHAM, TICKET TO RIDE — all score 1.0.
 * 0.7 is the gap between those two populations. `MIN_TITLE_SIMILARITY` sits far
 * below the bogus cluster and would have passed every one of them.
 *
 * An honest read that lands just under this is not lost, only left unticked:
 * a false negative costs a tap, a false positive costs a wrong game in the
 * catalog wearing someone else's cover.
 */
export const MIN_SPINE_SIMILARITY = 0.7;

/** Close enough to act on, for a title a person named themselves. */
export function isTrustedMatch(candidateName: string, searchedFor: string): boolean {
  return titleSimilarity(candidateName, searchedFor) >= MIN_TITLE_SIMILARITY;
}

/** Close enough to act on unattended, for a title read off a photograph. */
export function isConfidentMatch(candidateName: string, searchedFor: string): boolean {
  return titleSimilarity(candidateName, searchedFor) >= MIN_SPINE_SIMILARITY;
}

/**
 * Re-rank candidates against the title we searched with.
 *
 * Only meaningful when candidates came from a *name* search rather than a direct
 * barcode hit. GameUPC ranks a name search by its own relevance, which favours
 * the base game — scanning "King of Tokyo: Duel" returned plain "King of Tokyo"
 * first, because the shorter name is contained in the longer one. We know which
 * string was searched; the search engine's ranking does not get to override that.
 *
 * Similarity is banded to two decimal places so near-ties fall back to the
 * source's own ordering rather than being reshuffled by noise.
 */
export function rankBySearchedTitle(
  candidates: BarcodeCandidate[],
  searchedFor: string,
): BarcodeCandidate[] {
  if (!searchedFor.trim()) return rankCandidates(candidates);

  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: Math.round(titleSimilarity(candidate.name, searchedFor) * 100) / 100,
  }));

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.candidate);
}
