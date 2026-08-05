import { rankBySearchedTitle, rankCandidates, type BarcodeCandidate } from '@bgc/core';
import { kindForBggType, things, type BggThing } from '@bgc/bgg';
import { lookupGameUpc, type GameUpcConfig } from './gameupc.js';
import { cleanRetailTitle, lookupUpcItemDb } from './upcitemdb.js';

/**
 * The free half of the barcode ladder.
 *
 * Order is cheapest-first and each rung is allowed to fail without taking the
 * others down: a scan in a shop with bad signal should degrade to fewer
 * candidates, never to an error page. The caller does the local `edition.barcode`
 * lookup before this (free, offline, and the only rung that works with no
 * network at all) and decides whether to pay for Claude after it.
 *
 * BGG hydration is wired in but optional. Until the token arrives every lookup
 * still works — you get GameUPC's name and thumbnail instead of full metadata,
 * and `bggHydrated` says which happened.
 */

export interface ResolveDeps {
  gameUpc: GameUpcConfig | null;
  /** Absent until the BGG application is approved; hydration is skipped without it. */
  bggToken?: string | undefined;
}

export interface ResolveResult {
  candidates: BarcodeCandidate[];
  /** True when the community has human-confirmed this exact barcode. */
  verified: boolean;
  /** Retail title we found, worth showing even with zero candidates — the user can search it. */
  inferredName: string | null;
  /** Write-back endpoints by BGG id, for when the user confirms one. */
  updateUrls: Record<number, string>;
  /** Which rungs actually ran, and what each cost us. For the handoff and the UI. */
  trace: { source: string; outcome: string }[];
  bggHydrated: boolean;
  /** True when every free rung missed, so the caller may want to pay for Claude. */
  exhausted: boolean;
}

/**
 * Fill in what GameUPC does not carry — publisher, kind, year, description-grade
 * metadata — from BGG, which is authoritative and which the import path already
 * uses. Failure here is not fatal: an un-hydrated candidate is still a usable
 * answer, so a BGG outage or a missing token degrades rather than breaks.
 */
async function hydrateFromBgg(
  candidates: BarcodeCandidate[],
  token: string,
): Promise<{ candidates: BarcodeCandidate[]; hydrated: boolean }> {
  const ids = [...new Set(candidates.map((c) => c.bggId).filter((id): id is number => id != null))];
  if (ids.length === 0) return { candidates, hydrated: false };

  let fetched: BggThing[];
  try {
    fetched = await things(token, ids, false);
  } catch {
    return { candidates, hydrated: false };
  }

  const byId = new Map(fetched.map((t) => [t.bggId, t]));
  return {
    hydrated: fetched.length > 0,
    candidates: candidates.map((c) => {
      const thing = c.bggId == null ? undefined : byId.get(c.bggId);
      if (!thing) return c;
      return {
        ...c,
        name: thing.name || c.name,
        publisher: thing.publisher ?? c.publisher,
        yearPublished: thing.yearPublished ?? c.yearPublished,
        kind: kindForBggType(thing.type),
        thumbnailUrl: thing.thumbnailUrl ?? c.thumbnailUrl,
        // The box wins where it was legible; BGG fills the gaps.
        minPlayers: c.minPlayers ?? thing.minPlayers,
        maxPlayers: c.maxPlayers ?? thing.maxPlayers,
        playtimeMin: c.playtimeMin ?? thing.playtimeMin,
        description: c.description ?? thing.description,
      };
    }),
  };
}

/**
 * Turn a *title* into candidates — the photo path's equivalent of a barcode
 * lookup.
 *
 * Reading a name off a box is only half the job: a name alone has no cover, no
 * year, no BGG id, and nothing to distinguish two printings. GameUPC's search
 * resolves it for free, and BGG fills in the rest when a token exists.
 *
 * Shared so single-box and shelf reading behave identically. They diverged
 * once — shelf resolved and single-box didn't, so photographing a box gave you
 * a bare name while photographing a shelf gave you covers.
 */
export async function resolveTitle(
  deps: ResolveDeps,
  title: string,
): Promise<{ candidates: BarcodeCandidate[]; bggHydrated: boolean }> {
  const trimmed = title.trim();
  if (!trimmed || !deps.gameUpc) return { candidates: [], bggHydrated: false };

  let candidates: BarcodeCandidate[] = [];
  try {
    // The barcode path segment is ignored when `search` is supplied, but the
    // endpoint still requires one, so pass a placeholder.
    const hit = await lookupGameUpc(deps.gameUpc, '0000000000000', {
      search: trimmed,
      searchMode: 'quality',
    });
    candidates = rankBySearchedTitle(hit.candidates, trimmed);
  } catch {
    return { candidates: [], bggHydrated: false };
  }

  if (candidates.length === 0) return { candidates: [], bggHydrated: false };

  if (deps.bggToken) {
    const hydrated = await hydrateFromBgg(candidates, deps.bggToken);
    return { candidates: hydrated.candidates, bggHydrated: hydrated.hydrated };
  }
  return { candidates, bggHydrated: false };
}

export async function resolveBarcode(
  deps: ResolveDeps,
  barcode: string,
): Promise<ResolveResult> {
  const trace: { source: string; outcome: string }[] = [];
  let candidates: BarcodeCandidate[] = [];
  let verified = false;
  let inferredName: string | null = null;
  let updateUrls: Record<number, string> = {};
  /** Set only when candidates came from a name search, not a direct barcode hit. */
  let searchedTitle: string | null = null;

  // --- Rung 1: GameUPC, straight barcode lookup -----------------------------
  if (deps.gameUpc) {
    try {
      const hit = await lookupGameUpc(deps.gameUpc, barcode);
      candidates = hit.candidates;
      verified = hit.verified;
      inferredName = hit.inferredName;
      updateUrls = hit.updateUrls;
      trace.push({
        source: 'gameupc',
        outcome: hit.verified
          ? 'verified'
          : hit.candidates.length
            ? `${hit.candidates.length} candidates`
            : 'no data',
      });
    } catch (err) {
      trace.push({ source: 'gameupc', outcome: `failed: ${(err as Error).message}` });
    }
  } else {
    trace.push({ source: 'gameupc', outcome: 'not configured' });
  }

  // --- Rung 2: UPCitemdb for a title, then GameUPC again by name ------------
  // Only worth doing when GameUPC could not name the product itself.
  if (!verified && candidates.length === 0) {
    try {
      const retail = await lookupUpcItemDb(barcode);
      if (retail?.title) {
        // Two different jobs: the cleaned string is a search term (furniture
        // stripped, sometimes to the point of being unreadable), the raw title
        // is what a human should see. Showing the stripped one produced
        // "Wingspan - A Bird-Collection, Engine-Building Stonemaier for , +".
        const cleaned = cleanRetailTitle(retail.title);
        inferredName = retail.title;
        trace.push({ source: 'upcitemdb', outcome: `title: ${retail.title}` });

        if (deps.gameUpc && cleaned) {
          try {
            const bySearch = await lookupGameUpc(deps.gameUpc, barcode, {
              search: cleaned,
              searchMode: 'quality',
            });
            // Re-rank against the title we searched with. GameUPC ranks by its
            // own relevance, which puts a base game above the variant whose name
            // contains it — scanning "King of Tokyo: Duel" returned plain
            // "King of Tokyo" first. We know what was searched; it does not.
            candidates = rankBySearchedTitle(bySearch.candidates, cleaned);
            searchedTitle = cleaned;
            updateUrls = { ...updateUrls, ...bySearch.updateUrls };
            trace.push({
              source: 'gameupc:search',
              outcome: bySearch.candidates.length
                ? `${bySearch.candidates.length} candidates`
                : 'no match',
            });
          } catch (err) {
            trace.push({ source: 'gameupc:search', outcome: `failed: ${(err as Error).message}` });
          }
        }
      } else {
        trace.push({ source: 'upcitemdb', outcome: 'no data' });
      }
    } catch (err) {
      trace.push({ source: 'upcitemdb', outcome: `failed: ${(err as Error).message}` });
    }
  }

  // --- Hydration: BGG, when we have a token --------------------------------
  let bggHydrated = false;
  if (candidates.length > 0) {
    if (deps.bggToken) {
      const result = await hydrateFromBgg(candidates, deps.bggToken);
      candidates = result.candidates;
      bggHydrated = result.hydrated;
      trace.push({ source: 'bgg', outcome: result.hydrated ? 'hydrated' : 'unavailable' });
    } else {
      trace.push({ source: 'bgg', outcome: 'no token — bypassed' });
    }
  }

  return {
    // Rank last: BGG hydration can replace a name, and the ordering should
    // reflect the names the user will actually read.
    candidates: searchedTitle
      ? rankBySearchedTitle(candidates, searchedTitle)
      : rankCandidates(candidates),
    verified,
    inferredName,
    updateUrls,
    trace,
    bggHydrated,
    exhausted: candidates.length === 0,
  };
}
