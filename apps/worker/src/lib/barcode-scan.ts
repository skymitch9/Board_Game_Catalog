/**
 * Turning one scanned barcode into one queue entry.
 *
 * A barcode is the only *exact* identification this app has. It carries a check
 * digit and names a specific printing, where reading a title off a box is a
 * guess that has matched Brink, Iliad and Moon to the wrong games at a perfect
 * 1.00 similarity. So the ladder is: our own `edition.barcode` table, then the
 * free services, and the photo path is the fallback for boxes with no code —
 * which is a large slice of this catalog, since most of it is crowdfunding.
 *
 * The result is shaped as a `ScannedTitle`, the same record a photographed
 * spine becomes, so one review screen serves both.
 */

import {
  classifyShelfResults,
  isPlausibleBarcode,
  matchExistingTitle,
  matchExistingTitleDetailed,
  normaliseBarcode,
  type BarcodeCandidate,
  type ItemKind,
  type TitleMatchKind,
} from '@bgc/core';
import { gameUpcConfig, resolveBarcode } from '@bgc/barcode';
import { countOwnedCopies, findByBarcode, listItemAliases, listItemNames } from '@bgc/db';
import type { Env } from '../env.js';
// Type-only, so nothing links the two files at runtime: `scan-ownership.ts`
// imports `ScannedTitle` from here, and this import is erased.
import type { ResolvedOwnership } from './scan-ownership.js';

/**
 * One line of an intake job, as it stands after enrichment and any review.
 *
 * `addedItemId` and `dismissed` are the outcome fields — everything else is
 * what was read or looked up. A title with neither set is unfinished business,
 * which is the state the whole review screen exists to make visible.
 *
 * The last four fields only ever appear on a barcode-sourced row. They are
 * optional rather than a separate type because the review screen treats every
 * row the same way and should not have to ask which kind it is holding.
 */
export interface ScannedTitle {
  title: string;
  confidence: string;
  position: number;
  alreadyOwned: boolean;
  existingItemId: number | null;
  existingName: string | null;
  bggId: number | null;
  resolvedName: string | null;
  thumbnailUrl: string | null;
  publisher: string | null;
  yearPublished: number | null;
  similarity: number | null;
  proposedKind: string | null;
  proposedParentId: number | null;
  proposedParentName: string | null;
  inferredParentName: string | null;
  reason: string | null;
  addedItemId?: number | null;
  dismissed?: boolean;
  /** Set when a retry searched with corrected text rather than what was read. */
  relookedUpAs?: string | null;

  /**
   * Whether the catalog holds this game **now**. Computed on every read, and
   * deliberately never stored — see `scan-ownership.ts`.
   *
   * `alreadyOwned` above is the answer enrichment got at the time, kept because
   * it is what stopped a lookup being paid for; it is not the answer the review
   * screen should be shown. Two photographs of one shelf share boxes, and the
   * second job used to keep offering a game the first had already added.
   */
  ownership?: ResolvedOwnership | null;

  /**
   * *How* the enrichment-time name match behind `existingItemId` was made.
   *
   * Persisted precisely because the three kinds do not deserve the same trust:
   * `exact` and `alias` are identity and stay automatic, but `containment` is a
   * guess the sequel class defeats at any floor ("Boss Monster 2" read against
   * an owned "Boss Monster" — see docs/info/matcher-thresholds.md). A
   * containment claim reaches the review screen as a *question*, and this field
   * is how the read path knows to ask it.
   *
   * Absent on legacy rows and on rows whose claim is not a name match at all
   * (an exact barcode hit) — both are treated as trusted, which is exactly the
   * old behaviour.
   */
  matchKind?: TitleMatchKind | null;
  /**
   * A person answered the containment question with "yes, same game".
   *
   * Set only by an explicit action on the review screen, like `acceptedMatch`.
   * Once set, the row settles as already-owned instead of asking again.
   */
  ownershipConfirmed?: boolean;
  /**
   * A person answered the containment question with "no, different game".
   *
   * The row then becomes an ordinary add-candidate: the read path stops
   * honouring containment matches for it (exact and alias still count, because
   * those are identity — e.g. the game gets added properly later and a rescan
   * really is it).
   */
  ownershipRejected?: boolean;

  /**
   * The runners-up, best first, including the one currently on the row.
   *
   * Kept because the top answer being wrong does not mean the lookup knew
   * nothing: GameUPC returns a ranked list and the box in the owner's hand is
   * often second. Without these, a review screen can only say no.
   */
  candidates?: TitleSuggestion[];
  /**
   * A person looked at the box and said this identification is right.
   *
   * The one thing the review screen could not express. A `medium`-confidence
   * hit or a weak name match was shown, correctly, as untrustworthy — and there
   * was no way to answer "I have checked, it is that one", so the only route
   * into the catalog was to retype a name the app already knew and throw away
   * the BoardGameGeek id, publisher, year and cover that came with it.
   *
   * Set only by an explicit human action, never inferred, and carried onto the
   * copy's notes so a later session can tell an accepted guess from a verified
   * lookup.
   */
  acceptedMatch?: boolean;

  /** The code that was scanned. Absent on anything that came from a photo. */
  barcode?: string | null;
  /**
   * The lookup services could not be *reached* — as distinct from being reached
   * and knowing nothing. Conflating those is expensive: a quota exhaustion
   * frozen in as "this game does not exist" is a lie that outlives the outage.
   */
  lookupFailed?: boolean;
  /** How many we already hold, when this code is already on something we own. */
  ownedQuantity?: number | null;
  /** GameUPC's write-back endpoint for the chosen candidate, if it offered one. */
  updateUrl?: string | null;
  /**
   * A plausible answer that nobody has confirmed. Shown, and left unticked at
   * review — see the confidence discussion in `resolveScannedBarcode`.
   */
  needsConfirmation?: boolean;
}

/** Runners-up kept on a row, matching the title path's `KEEP_CANDIDATES`. */
const KEEP_CANDIDATES = 5;

/**
 * A suggestion, trimmed to what a person needs to recognise a box.
 *
 * **Not the whole `BarcodeCandidate`, and the difference is measured.** One
 * Ticket to Ride scan with five full candidates made a job's `enriched` blob
 * **23 KB**, almost all of it BoardGameGeek description prose. That blob is
 * returned by `listScanJobs` for up to fifty jobs, on a poll that fires every
 * 2.5 seconds while anything is working — so a shelf of seventy titles would
 * have put megabytes over the wire a minute. Name, year, publisher and a
 * thumbnail are what the decision is made from; the descriptions are what the
 * item's own lookup is for.
 */
export interface TitleSuggestion {
  name: string;
  bggId: number | null;
  publisher: string | null;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  kind: ItemKind;
  /** The band the source gave it, so a weak guess still says it is weak. */
  confidence: string;
}

export function toSuggestion(c: BarcodeCandidate): TitleSuggestion {
  return {
    name: c.name,
    bggId: c.bggId,
    publisher: c.publisher,
    yearPublished: c.yearPublished,
    thumbnailUrl: c.thumbnailUrl,
    kind: c.kind,
    confidence: c.confidence,
  };
}

/** The top few, trimmed. One call site's worth of decision, in one place. */
export function toSuggestions(candidates: BarcodeCandidate[]): TitleSuggestion[] {
  return candidates.slice(0, KEEP_CANDIDATES).map(toSuggestion);
}

export type BarcodeCheck = { ok: true; code: string } | { ok: false; detail: string };

/**
 * Normalise and sanity-check a scanned code.
 *
 * Shared with `routes/barcode.ts` so the two ways into the app cannot disagree
 * about what counts as a barcode — the check digit rejection in particular is a
 * decision, and a second copy of it would drift.
 */
export function validateBarcode(raw: string): BarcodeCheck {
  const code = normaliseBarcode(raw);
  if (!code) return { ok: false, detail: 'That does not look like a barcode.' };
  if (!isPlausibleBarcode(code)) {
    return {
      ok: false,
      detail:
        'That barcode failed its check digit, which usually means a misread. Try scanning again.',
    };
  }
  return { ok: true, code };
}

/** A blank row, so every branch below returns the same shape. */
function blank(code: string, position: number): ScannedTitle {
  return {
    title: code,
    confidence: 'high',
    position,
    alreadyOwned: false,
    existingItemId: null,
    existingName: null,
    bggId: null,
    resolvedName: null,
    thumbnailUrl: null,
    publisher: null,
    yearPublished: null,
    similarity: null,
    proposedKind: 'base',
    proposedParentId: null,
    proposedParentName: null,
    inferredParentName: null,
    reason: null,
    barcode: code,
    lookupFailed: false,
    ownedQuantity: null,
    updateUrl: null,
    needsConfirmation: false,
  };
}

/**
 * Was the ladder actually walked, or did it fall over?
 *
 * `resolveBarcode` never throws — each rung records its own outcome in the
 * trace instead, so "no data" and "failed: quota reached" are both just strings
 * by the time they get here. Only the second one means the answer is unknown
 * rather than negative.
 */
function ladderBroke(trace: { source: string; outcome: string }[]): boolean {
  return trace.some((t) => t.outcome.startsWith('failed:') || t.outcome === 'not configured');
}

/**
 * Resolve one scanned code into a queue entry.
 *
 * Never throws: a scan that cannot be resolved still belongs in the queue, to
 * be named at review. Losing the scan would mean walking back to the shelf.
 */
export async function resolveScannedBarcode(
  env: Env,
  code: string,
  position: number,
): Promise<ScannedTitle> {
  const base = blank(code, position);

  // --- Rung 0: our own table. Free, instant, and works with no signal --------
  // This is also the duplicate check, which is the answer the owner most often
  // wants while holding a box.
  const local = await findByBarcode(env.DB, code);
  if (local) {
    return {
      ...base,
      title: local.item.name,
      alreadyOwned: true,
      existingItemId: local.item.id,
      existingName: local.item.name,
      resolvedName: local.item.name,
      bggId: local.item.bggId,
      thumbnailUrl: local.item.thumbnailUrl,
      ownedQuantity: await countOwnedCopies(env.DB, local.item.id),
      reason: 'This exact barcode is already on a game in the collection.',
    };
  }

  // --- Rungs 1-3: GameUPC, UPCitemdb, then BGG hydration --------------------
  const resolved = await resolveBarcode(
    { gameUpc: gameUpcConfig(env), bggToken: env.BGG_API_TOKEN },
    code,
  );
  const best: BarcodeCandidate | null = resolved.candidates[0] ?? null;

  if (!best) {
    const failed = ladderBroke(resolved.trace);
    return {
      ...base,
      // A retail title with no game behind it is still worth keeping: it names
      // the row for review instead of leaving thirteen digits on the screen.
      title: resolved.inferredName ?? code,
      lookupFailed: failed,
      reason: failed
        ? 'The lookup services could not be reached, so nothing is known about this code yet. Nothing was recorded as a negative — scan it again, or name it here.'
        : 'No free database knows this barcode. Crowdfunding boxes often have no retail code at all — name it here, or photograph the box instead.',
    };
  }

  /*
   * How much of a barcode's exactness actually survives the lookup.
   *
   * "A barcode is exact" is true of the *code*, and not of what GameUPC does
   * with one it has never seen. Measured against the live `test` stage on
   * 2026-08-06:
   *
   *   029877030712  Catan            verified, 1 candidate, `high`
   *   824968717615  Ticket to Ride   15 candidates, right answer first, `medium`
   *   9780306406157 a textbook ISBN  15 candidates, "Labyrinth" first, `low`
   *   653341070005  a dog bed        15 candidates, "Ten in a Bed" first, `low`
   *
   * So an unknown code does not come back empty — it comes back with fifteen
   * confident-looking guesses, complete with BGG ids, years and cover art. The
   * confidence band GameUPC supplies is the only thing separating those two
   * populations, and it separates them cleanly, so it is load-bearing here:
   *
   *   high / verified  trust it, tick it at review
   *   medium           show it, do not tick it — the person can see the box
   *   low              do not claim to know: name the guess and move on
   *
   * Ignoring this was the first version of this file, and it would have added
   * "Labyrinth" to the collection off the back of a textbook.
   */
  if (best.confidence === 'low') {
    return {
      ...base,
      title: code,
      // The guesses are carried even here, unticked and unclaimed. Fifteen
      // wrong ones is what an unknown code looks like — but the sixteenth case
      // is a real box whose code nobody has catalogued well, and a person
      // holding it can settle in a second what no database can. Offering the
      // list is not the same as believing it.
      candidates: toSuggestions(resolved.candidates),
      reason: `No database confidently knows this code. The closest guess was "${best.name}", which is too weak to trust — check the list against the box, name it here, or photograph the box instead.`,
    };
  }
  const needsConfirmation = !resolved.verified && best.confidence !== 'high';

  // Do we already own this game under a different code? Worth saying: the same
  // game can carry several barcodes, and adding it twice is the thing the
  // review screen is for catching.
  //
  // Only ever claimed for a match we trust. An unconfirmed guess that happens
  // to collide with something owned would file a genuinely new game under
  // "already yours", which loses it — much worse than a duplicate.
  const [existing, aliases] = await Promise.all([listItemNames(env.DB), listItemAliases(env.DB)]);
  const owned = needsConfirmation ? null : matchExistingTitleDetailed(best.name, existing, aliases);
  if (owned) {
    // `matchKind` travels with the claim. Exact and alias matches settle the
    // row as before; a containment match is a guess ("Boss Monster 2" contains
    // "Boss Monster") and the review screen turns it into a question instead of
    // filing a possibly-new game under "already yours" — which would lose it.
    const guess = owned.matchKind === 'containment';
    return {
      ...base,
      title: best.name,
      alreadyOwned: true,
      existingItemId: owned.item.id,
      existingName: owned.item.name,
      matchKind: owned.matchKind,
      bggId: best.bggId,
      resolvedName: best.name,
      thumbnailUrl: best.thumbnailUrl,
      publisher: best.publisher,
      yearPublished: best.yearPublished,
      ownedQuantity: await countOwnedCopies(env.DB, owned.item.id),
      updateUrl: resolved.updateUrls?.[best.bggId ?? -1] ?? null,
      reason: guess
        ? `"${best.name}" looks like "${owned.item.name}", which is already in the collection — but only the names are close. Say at review whether it is the same game.`
        : 'A different barcode, but this game is already in the collection.',
    };
  }

  // Same classification the photo path uses, so an expansion scanned off its own
  // box proposes the base game it belongs under rather than rooting itself.
  const [classified] = classifyShelfResults(
    [{ name: best.name, bggId: best.bggId, thumbnailUrl: best.thumbnailUrl }],
    existing,
    aliases,
  );

  return {
    ...base,
    title: best.name,
    bggId: best.bggId,
    resolvedName: best.name,
    thumbnailUrl: best.thumbnailUrl,
    publisher: best.publisher,
    yearPublished: best.yearPublished,
    // Nothing here was matched by *name*, so the similarity floor that guards
    // spine reads has nothing to measure. 1 says exactly that; whether the row
    // is ticked is decided by `needsConfirmation` instead.
    similarity: 1,
    candidates: toSuggestions(resolved.candidates),
    proposedKind: classified?.proposedKind ?? best.kind ?? 'base',
    proposedParentId: classified?.proposedParentId ?? null,
    proposedParentName: classified?.proposedParentName ?? null,
    inferredParentName: classified?.inferredParentName ?? null,
    updateUrl: resolved.updateUrls?.[best.bggId ?? -1] ?? null,
    needsConfirmation,
    reason:
      classified?.reason ??
      (resolved.verified
        ? 'Community-verified barcode match.'
        : needsConfirmation
          ? `Nobody has confirmed this code. "${best.name}" is the best the free databases offered — check it against the box.${
              matchExistingTitle(best.name, existing, aliases)
                ? ' You may already own it under a different code.'
                : ''
            }`
          : null),
  };
}
