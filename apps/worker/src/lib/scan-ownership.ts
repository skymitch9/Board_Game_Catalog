/**
 * Whether a queued title is already in the catalog — asked now, not remembered.
 *
 * **The bug this exists to fix.** Photograph a shelf twice, which is the normal
 * way to photograph a shelf, and the same box lands on two jobs. Resolve it in
 * one and the other still offered it as new, because `alreadyOwned` was written
 * into `scan_job.enriched` during enrichment and nothing ever revisited it. The
 * owner's words: *"when the game is resolved in 1 its not known to the other
 * item waiting processing."*
 *
 * **The split.** A job row holds two different kinds of thing:
 *
 * | | Stored | Computed |
 * |---|---|---|
 * | `addedItemId`, `dismissed` | ✅ a decision a person made | |
 * | ownership | | ✅ a fact about the catalog |
 * | kind and parent proposals | | ✅ also a fact about the catalog |
 *
 * The proposals joined this list second, and for the same reason — see
 * `scan-classify.ts`. `withFreshView` resolves both.
 *
 * The catalog is the only authority on what is in the catalog, so ownership is
 * resolved when a job is *read* and never written back. This is the third time
 * this project has made that trade — `inheritCover` and `resolveInheritedDetails`
 * are the other two — and it is settled: a copied fact is indistinguishable from
 * a researched one a month later, and it is wrong the moment anything else
 * changes.
 *
 * ⚠️ **Nothing here may reach a write.** Every write path parses the *stored*
 * blob straight from `getScanJob`; resolution is applied on the way out, after
 * the last write. Persisting `ownership` would recreate the snapshot under a new
 * name.
 *
 * **What it costs.** Two D1 reads per request, whatever the size of the queue:
 * the catalog's names (~41 KB for 760 rows, already how the shelf scanner
 * works) and the added-item provenance. Matching is then in memory against a
 * folded index — no per-title round trip, which is the thing to preserve if this
 * is ever touched.
 */

import {
  buildTitleIndex,
  isConfidentMatch,
  matchIndexedTitle,
  type TitleIndex,
} from '@bgc/core';
import {
  listAddedItemSources,
  listItemNames,
  type ScanJob,
  type ScanJobMode,
} from '@bgc/db';
import type { ScannedTitle } from './barcode-scan.js';
import { classifyTitles } from './scan-classify.js';

interface CatalogItem {
  id: number;
  name: string;
  kind: string;
}

export interface OwnershipContext {
  /** The catalog as `classifyShelfResults` wants it — the same rows, unfolded. */
  items: CatalogItem[];
  index: TitleIndex<CatalogItem>;
  byId: Map<number, CatalogItem>;
  /** itemId → the job whose review screen added it, when one did. */
  addedBy: Map<number, { jobId: number; mode: ScanJobMode }>;
}

/**
 * Where a row's game came from, as far as the queue can tell.
 *
 * `catalog` covers every route that is not a review screen — a barcode scan, a
 * typed name, an import, or an earlier session — and is also what an ordinary
 * "you already own this" row says.
 */
export type OwnershipVia = 'catalog' | 'this-job' | 'other-job';

export interface ResolvedOwnership {
  itemId: number;
  name: string;
  via: OwnershipVia;
  /** How the *other* job took it in, so the copy can say "photo" or "scan". */
  jobMode: ScanJobMode | null;
}

/**
 * The two reads, once per request.
 *
 * Provenance is the *optional* half and is treated as such. It is the one query
 * in this path that leans on SQLite's JSON functions — confirmed working on
 * production D1, but if that ever stops being true the queue must degrade to
 * saying "already in your collection" rather than failing to load at all. The
 * warning is there because a silently degraded feature is the failure this
 * project keeps producing; `wrangler tail` prints it.
 */
export async function ownershipContext(db: D1Database): Promise<OwnershipContext> {
  const [items, sources] = await Promise.all([
    listItemNames(db),
    listAddedItemSources(db).catch((err: unknown) => {
      console.warn('scan-job provenance unavailable', (err as Error).message);
      return [];
    }),
  ]);

  const addedBy = new Map<number, { jobId: number; mode: ScanJobMode }>();
  for (const s of sources) {
    if (!addedBy.has(s.itemId)) addedBy.set(s.itemId, { jobId: s.jobId, mode: s.mode });
  }

  return {
    items,
    index: buildTitleIndex(items),
    byId: new Map(items.map((i) => [i.id, i])),
    addedBy,
  };
}

/**
 * The names this row actually claims to be, best first.
 *
 * A lookup's answer counts only when the row is entitled to it: `isConfidentMatch`
 * is the same gate the review screen draws the row with, so a spine read as
 * "Zorblax Quandary" and resolved to *Quandary* is not quietly matched against a
 * catalogued *Quandary*. Reusing that function rather than writing a second
 * similarity rule is deliberate — the three wrong-game matches this project has
 * shipped (Brink, Iliad, Moon) all came from a second rule drifting from the
 * first.
 */
function claimedNames(t: ScannedTitle): string[] {
  const read = t.relookedUpAs ?? t.title;
  const names: string[] = [];
  if (t.resolvedName && (t.acceptedMatch || isConfidentMatch(t.resolvedName, read))) {
    names.push(t.resolvedName);
  }
  names.push(read);
  if (t.title !== read) names.push(t.title);
  return names;
}

/**
 * Is this title in the catalog *now*?
 *
 * Null means genuinely outstanding — still wanting a decision.
 *
 * A row that already carries a decision is left alone. Its own outcome is the
 * more specific answer and the screen has already drawn it: an added row keeps
 * its "Added — open it" link, and **a dismissed title stays dismissed**, because
 * dismissal is a judgement about this photo's reading rather than about the
 * catalog, and the catalog has no business overturning it.
 */
export function resolveOwnership(
  t: ScannedTitle,
  jobId: number,
  ctx: OwnershipContext,
): ResolvedOwnership | null {
  if (t.addedItemId || t.dismissed) return null;

  // What the row already claims, when that item is still there. This is what
  // keeps a *barcode* match exact: rung 0 matched a code against `edition`, not
  // a name, and re-deriving it from the name would be a weaker question than
  // the one already answered.
  let item = t.existingItemId ? (ctx.byId.get(t.existingItemId) ?? null) : null;

  if (!item) {
    for (const name of claimedNames(t)) {
      item = matchIndexedTitle(ctx.index, name);
      if (item) break;
    }
  }
  if (!item) return null;

  const source = ctx.addedBy.get(item.id);
  return {
    itemId: item.id,
    name: item.name,
    via: !source ? 'catalog' : source.jobId === jobId ? 'this-job' : 'other-job',
    jobMode: source?.mode ?? null,
  };
}

/**
 * Titles still wanting a decision.
 *
 * True by construction now: a title is outstanding when it has no decision of
 * its own *and* the catalog does not already hold it. The old version asked the
 * stored `alreadyOwned` flag, which is exactly the stale answer.
 */
export function countOutstanding(
  titles: ScannedTitle[],
  jobId: number,
  ctx: OwnershipContext,
): number {
  return titles.filter((t) => !t.addedItemId && !t.dismissed && !resolveOwnership(t, jobId, ctx))
    .length;
}

/** Parse a job's titles, tolerating a blob that is not what we expect. */
export function titlesOf(job: ScanJob): ScannedTitle[] | null {
  if (!job.enriched) return null;
  try {
    const parsed = JSON.parse(job.enriched);
    return Array.isArray(parsed) ? (parsed as ScannedTitle[]) : null;
  } catch {
    return null;
  }
}

/**
 * A job as it should be *read*: the same stored rows, every claim about the
 * catalog answered afresh.
 *
 * Two claims, resolved in this order because the second depends on the first:
 *
 * 1. **ownership** — is this game here already?
 * 2. **classification** — if not, what is it and what does it belong to?
 *
 * The order is the whole reason they live in one function. A row that turns out
 * to be owned takes no part in classification, and a row whose base game was
 * added from the other photograph must be classified against a catalog that now
 * contains it. Resolving either one from a stale copy of the other reintroduces
 * the bug in miniature.
 *
 * The only place `ownership` and the proposal fields are set for display. Call
 * it on the way out of a route, after every write, and never before one.
 */
export function withFreshView<T extends ScanJob>(job: T, ctx: OwnershipContext): T {
  const titles = titlesOf(job);
  if (!titles) return job;

  const resolved = titles.map((t) => ({ ...t, ownership: resolveOwnership(t, job.id, ctx) }));

  return {
    ...job,
    enriched: JSON.stringify(classifyTitles(resolved, ctx.items, (t) => t.ownership !== null)),
  };
}

/**
 * Has this job quietly finished while the owner was working on another one?
 *
 * The queue closing itself is half of what the owner asked for: the complaint
 * was about *"items waiting to be sorted"*, and a job with nothing left to sort
 * should not still be asking. `countOutstanding` reaching zero already closes a
 * job on a write; this is the same rule for the case where the work that
 * finished it happened somewhere else entirely, so no write to *this* job ever
 * comes.
 *
 * Sweeping on a read follows `closeStaleDetailsRuns`, which does the same thing
 * for the same reason.
 *
 * ⚠️ **Barcode jobs are exempt, and it is not a detail.** One stays open for the
 * next scan, and a session of scanning boxes you already own has nothing
 * outstanding at every point in it — closing it would split one session into a
 * job per box, which is the thing barcode batching exists to avoid.
 */
export function shouldAutoClose(job: ScanJob, ctx: OwnershipContext): boolean {
  if (job.status !== 'review' || job.mode === 'barcode') return false;
  const titles = titlesOf(job);
  if (!titles || titles.length === 0) return false;
  return countOutstanding(titles, job.id, ctx) === 0;
}
