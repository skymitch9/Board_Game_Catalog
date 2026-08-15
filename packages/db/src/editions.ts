import type {
  CoverCandidate,
  CoverCandidates,
  CoverSource,
  CoverStatus,
} from '@bgc/core';
import { DEAD_AFTER, UNREACHABLE_AFTER } from './covers.js';

/**
 * Printings, and the covers you may choose between.
 *
 * The model is one idea, not two: an item has several known printings, each
 * printing has a cover, and one of them represents the copy on our shelf. A
 * crowdfunding edition is a printing — it belongs beside the 2019 and 2023
 * retail ones rather than in a Kickstarter-shaped mechanism of its own.
 *
 * `edition` has existed since migration 0001 and sat empty, because the catalog
 * was populated by `POST /api/bgg/match/:id` and direct pledge inserts, neither
 * of which writes editions. Everything here is about filling it and reading it
 * back; no fetching happens in this package.
 */

/** Every BoardGameGeek cover USED TO BE served from this CDN, and nothing else was. */
const BGG_IMAGE_HOST = 'geekdo-images.com';

/**
 * ⚠️ Host-sniffing alone stopped being sufficient 2026-08-15, when the games
 * covers consolidation (catalog-platform/docs/info/
 * covers-consolidation-plan.md) rehosted every `item.thumbnail_url` and
 * `edition.image_url` onto `gamecovers.heygabi.ai` — a BGG cover and a
 * Kickstarter cover now sit on the exact same host, so "is this a BGG image"
 * can no longer be answered from the URL string alone for anything migrated
 * or written after that date.
 *
 * The fix reaches for the fact that survives the rehost: content-addressing.
 * `addBggEditions` already writes an `edition` row with `source = 'bgg'`
 * carrying that printing's `image_url`; the rehost script maps one source
 * URL to one hosted URL, so a BGG-sourced `edition.image_url` and the
 * `item.thumbnail_url` it was chosen from land on the identical hosted URL
 * after migration, same as they were the identical raw URL before it. So
 * "is this item's current thumbnail a BGG image" becomes "does a `source =
 * 'bgg'` edition of this item carry this exact URL" — true whether that URL
 * is still a raw `geekdo-images.com` hotlink (not yet migrated, or a fresh
 * BGG match that predates the intake hook) or already rehosted.
 *
 * Both checks are kept, ORed: the host check for anything never touched by
 * an edition row (imports that predate the edition feature, or a BGG image a
 * person pasted by hand with no matching edition), and the edition check for
 * everything the rehost or the intake hook have since renamed.
 */
const NOT_BGG_IMAGE = (itemIdExpr: string, urlExpr: string) =>
  `${urlExpr} NOT LIKE '%${BGG_IMAGE_HOST}%'
     AND NOT EXISTS (SELECT 1 FROM edition e WHERE e.item_id = ${itemIdExpr}
                       AND e.image_url = ${urlExpr} AND e.source = 'bgg')`;

export function isBggImageUrl(url: string | null | undefined): boolean {
  return !!url && url.includes(BGG_IMAGE_HOST);
}

/**
 * The rehost-aware successor to `isBggImageUrl` — see the long note on
 * `NOT_BGG_IMAGE` above for why a DB check joined to `edition.source='bgg'`
 * is now required alongside the host string check.
 */
async function isBggSourcedCover(db: D1Database, itemId: number, url: string): Promise<boolean> {
  if (isBggImageUrl(url)) return true;
  const row = await db
    .prepare(`SELECT 1 AS hit FROM edition WHERE item_id = ? AND image_url = ? AND source = 'bgg' LIMIT 1`)
    .bind(itemId, url)
    .first<{ hit: number }>();
  return row != null;
}

/** The shape both the BGG client and the importer already speak. */
export interface EditionInput {
  bggVersionId: number;
  name: string | null;
  year: number | null;
  publisher: string | null;
  language: string | null;
  imageUrl: string | null;
}

/**
 * Cap on printings stored per item.
 *
 * Some long-running games carry 80+ versions and importing every
 * foreign-language reprint buries the two you might actually own. Lifted out of
 * `importItem` so the backfill and the importer cannot disagree about it.
 */
export const MAX_EDITIONS_PER_ITEM = 40;

/**
 * Add BoardGameGeek printings to an item, skipping any already recorded.
 *
 * Idempotent on `(item_id, bgg_version_id)` — enforced by a unique index in
 * migration 0014, and checked here first so a re-run is a cheap no-op rather
 * than a batch of caught constraint violations. That matters because this is
 * re-run every time more items gain a `bgg_id`.
 */
export async function addBggEditions(
  db: D1Database,
  itemId: number,
  editions: EditionInput[],
): Promise<number> {
  if (editions.length === 0) return 0;

  const { results } = await db
    .prepare('SELECT bgg_version_id AS v FROM edition WHERE item_id = ? AND bgg_version_id IS NOT NULL')
    .bind(itemId)
    .all<{ v: number }>();
  const known = new Set(results.map((r) => r.v));

  const room = MAX_EDITIONS_PER_ITEM - known.size;
  if (room <= 0) return 0;

  const fresh = editions
    .filter((e) => Number.isFinite(e.bggVersionId) && !known.has(e.bggVersionId))
    // Dedupe within the response too: one malformed <versions> block should not
    // trip the unique index halfway through a batch.
    .filter((e, i, all) => all.findIndex((o) => o.bggVersionId === e.bggVersionId) === i)
    .slice(0, room);

  if (fresh.length === 0) return 0;

  await db.batch(
    fresh.map((e) =>
      db
        .prepare(
          `INSERT INTO edition (item_id, bgg_version_id, name, year, publisher, language, image_url, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'bgg')`,
        )
        .bind(itemId, e.bggVersionId, e.name, e.year, e.publisher, e.language, e.imageUrl),
    ),
  );
  return fresh.length;
}

/**
 * Items whose printings we have not asked BoardGameGeek about.
 *
 * "Have not asked" is inferred from the absence of any `source = 'bgg'` row,
 * which means a game BGG genuinely lists no versions for gets re-asked on every
 * run. That is deliberate — the alternative is writing a fake edition row to
 * remember a negative, and a fake printing would show up in the picker. The
 * cost is one slot in a batch of ten, and the route reports the count so a
 * stall is visible rather than mysterious.
 */
export async function listItemsNeedingBggEditions(
  db: D1Database,
  opts: { limit: number; force?: boolean; itemId?: number | null },
): Promise<{ id: number; bggId: number }[]> {
  const where = ['i.bgg_id IS NOT NULL'];
  const params: unknown[] = [];

  if (opts.itemId != null) {
    where.push('i.id = ?');
    params.push(opts.itemId);
  }
  if (!opts.force) {
    where.push(`NOT EXISTS (SELECT 1 FROM edition e WHERE e.item_id = i.id AND e.source = 'bgg')`);
  }

  const { results } = await db
    .prepare(
      `SELECT i.id, i.bgg_id AS bgg_id FROM item i
        WHERE ${where.join(' AND ')}
        ORDER BY i.id
        LIMIT ?`,
    )
    .bind(...params, opts.limit)
    .all<{ id: number; bgg_id: number }>();

  return results.map((r) => ({ id: r.id, bggId: r.bgg_id }));
}

/** How many items are still waiting, so a run can say what is left to do. */
export async function countItemsNeedingBggEditions(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM item i
        WHERE i.bgg_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM edition e WHERE e.item_id = i.id AND e.source = 'bgg')`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Campaign printings
// ---------------------------------------------------------------------------

const CAMPAIGN_PLATFORMS: [domain: string, label: string][] = [
  ['kickstarter.com', 'Kickstarter'],
  ['gamefound.com', 'Gamefound'],
  ['backerkit.com', 'BackerKit'],
  ['indiegogo.com', 'Indiegogo'],
  ['crowdox.com', 'CrowdOx'],
  ['pledgemanager.com', 'PledgeManager'],
];

/** Words a title case should leave alone, so a slug does not read as a headline. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'to', 'in', 'on', 'for', 'or', 'vs']);

/** "the-lord-of-the-rings-ascension" -> "The Lord of the Rings Ascension". */
function deslug(slug: string): string {
  const words = slug
    .replace(/[_+]/g, '-')
    .split('-')
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Name a campaign printing after the campaign it came from.
 *
 * `item.source_url` is a project page — `gamefound.com/en/projects/iv-studio/altera`
 * — so the platform is the host and the campaign is the last path segment. When
 * there is no usable URL the row still gets a name, because "Campaign edition"
 * beside a 2019 and a 2023 retail printing is already the useful distinction;
 * the campaign's identity is a bonus, not the point.
 */
export function campaignEditionName(sourceUrl: string | null): string {
  if (!sourceUrl) return 'Campaign edition';

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return 'Campaign edition';
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const platform =
    CAMPAIGN_PLATFORMS.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1] ?? host;

  const segments = url.pathname.split('/').filter(Boolean);
  // Skip a trailing locale or numeric id: /projects/creator/slug/12345 should
  // still be named after the slug.
  const slug = [...segments].reverse().find((s) => /[a-z]/i.test(s) && !/^[a-z]{2}$/i.test(s));
  const title = slug ? deslug(slug) : '';

  return title ? `${platform}: ${title}` : `${platform} campaign`;
}

export interface CampaignCoverRun {
  /** Items whose cover is not a BoardGameGeek image. */
  considered: number;
  added: number;
}

/**
 * Record every non-BoardGameGeek cover as a printing of its own.
 *
 * A cover that is not on `cf.geekdo-images.com` came from a crowdfunding page,
 * and it is the only record anyone has of that printing's artwork. Writing it
 * down as an edition is what makes swapping to the BGG cover reversible — the
 * alternative is that picking a retail cover silently destroys the campaign one.
 *
 * Idempotent on `(item_id, image_url)`: the `NOT EXISTS` does the work, and the
 * unique index from migration 0014 is the guarantee. Safe to re-run after any
 * process that writes covers.
 */
export async function recordCampaignCovers(
  db: D1Database,
  limit = 500,
): Promise<CampaignCoverRun> {
  const { results } = await db
    .prepare(
      `SELECT id, thumbnail_url, source_url, year_published, publisher
         FROM item
        WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''
          AND ${NOT_BGG_IMAGE('item.id', 'thumbnail_url')}
        ORDER BY id
        LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: number;
      thumbnail_url: string;
      source_url: string | null;
      year_published: number | null;
      publisher: string | null;
    }>();

  if (results.length === 0) return { considered: 0, added: 0 };

  const statements = results.map((r) =>
    db
      .prepare(
        `INSERT INTO edition (item_id, name, year, publisher, image_url, source)
         SELECT ?1, ?2, ?3, ?4, ?5, 'campaign'
          WHERE NOT EXISTS (SELECT 1 FROM edition WHERE item_id = ?1 AND image_url = ?5)`,
      )
      .bind(
        r.id,
        campaignEditionName(r.source_url),
        r.year_published,
        r.publisher,
        r.thumbnail_url,
      ),
  );

  const batched = await db.batch(statements);
  const added = batched.reduce((sum, res) => sum + (res.meta?.changes ?? 0), 0);
  return { considered: results.length, added };
}

/**
 * Keep the cover an item is about to stop wearing.
 *
 * **Never overwrite a thumbnail without first capturing what was there.** A
 * campaign cover exists nowhere else — no CDN will hand it back once the item
 * stops pointing at it — so a swap to a BoardGameGeek printing would otherwise
 * be one-way, and "swap to the BGG image, keep the Kickstarter one in the
 * picker" would be a promise the data could not keep.
 *
 * Called from `updateItem` rather than left to the campaign backfill, because
 * a backfill only protects covers that existed when it last ran. Nothing
 * happens when an edition already holds the outgoing URL, which is the common
 * case: swapping between two printings that are both already recorded.
 */
export async function preserveDisplacedCover(
  db: D1Database,
  itemId: number,
  outgoingUrl: string | null,
): Promise<boolean> {
  const url = outgoingUrl?.trim();
  if (!url) return false;

  const item = await db
    .prepare('SELECT source_url, year_published, publisher FROM item WHERE id = ?')
    .bind(itemId)
    .first<{ source_url: string | null; year_published: number | null; publisher: string | null }>();

  // A displaced BoardGameGeek image is recorded as an untagged printing rather
  // than as `bgg`, because we do not know which version id it belonged to and
  // guessing would make the backfill think this item had been asked about.
  const isCampaign = !(await isBggSourcedCover(db, itemId, url));

  const res = await db
    .prepare(
      `INSERT INTO edition (item_id, name, year, publisher, image_url, source)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE NOT EXISTS (SELECT 1 FROM edition WHERE item_id = ?1 AND image_url = ?5)`,
    )
    .bind(
      itemId,
      isCampaign ? campaignEditionName(item?.source_url ?? null) : 'Previous cover',
      item?.year_published ?? null,
      item?.publisher ?? null,
      url,
      isCampaign ? 'campaign' : null,
    )
    .run();

  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Reading the candidates back
// ---------------------------------------------------------------------------

interface EditionCoverRow {
  id: number;
  bgg_version_id: number | null;
  name: string | null;
  year: number | null;
  publisher: string | null;
  language: string | null;
  image_url: string;
  source: string | null;
}

interface CoverCheckRow {
  url: string;
  outcome: string;
  consecutive_failures: number;
}

/**
 * What the cover checker last knew about a URL.
 *
 * Reuses the same thresholds the health banner does — one failure is a CDN
 * having a bad minute, not evidence — so the picker cannot call an image dead
 * on weaker grounds than the banner would.
 */
function statusOf(row: CoverCheckRow | undefined): CoverStatus {
  if (!row) return 'unknown';
  if (row.outcome === 'ok') return 'ok';
  if (row.outcome === 'dead') return row.consecutive_failures >= DEAD_AFTER ? 'dead' : 'suspect';
  if (row.outcome === 'error') {
    return row.consecutive_failures >= UNREACHABLE_AFTER ? 'dead' : 'suspect';
  }
  return 'unknown';
}

function sourceOf(row: EditionCoverRow): CoverSource {
  if (row.source === 'campaign') return 'campaign';
  if (row.source === 'bgg' || row.bgg_version_id != null) return 'bgg';
  return 'other';
}

function labelOf(row: EditionCoverRow): string {
  const name = row.name?.trim();
  if (name) return name;
  if (row.year) return `${row.year} printing`;
  if (row.source === 'campaign') return 'Campaign edition';
  return 'Printing';
}

/**
 * Every cover this item could wear, plus which one it wears now.
 *
 * Deduplicated by URL, because an item's current cover is usually also one of
 * its editions — the campaign backfill puts it there on purpose — and showing
 * the same picture twice would read as two printings that happen to look alike.
 * The edition row wins the tie, since it carries the year and publisher that
 * make the choice meaningful.
 */
export async function listCoverCandidates(
  db: D1Database,
  itemId: number,
): Promise<CoverCandidates | null> {
  const item = await db
    .prepare('SELECT id, kind, bgg_id, thumbnail_url FROM item WHERE id = ?')
    .bind(itemId)
    .first<{ id: number; kind: string; bgg_id: number | null; thumbnail_url: string | null }>();
  if (!item) return null;

  const currentUrl = item.thumbnail_url?.trim() || null;

  const batched = await db.batch([
    db
      .prepare(
        `SELECT id, bgg_version_id, name, year, publisher, language, image_url, source
           FROM edition
          WHERE item_id = ? AND image_url IS NOT NULL AND image_url != ''
          ORDER BY (year IS NULL), year DESC, id`,
      )
      .bind(itemId),
    db
      .prepare(
        `SELECT url, outcome, consecutive_failures FROM cover_check
          WHERE url IN (SELECT image_url FROM edition
                         WHERE item_id = ?1 AND image_url IS NOT NULL AND image_url != '')
             OR url = ?2`,
      )
      .bind(itemId, currentUrl),
    db
      .prepare(`SELECT COUNT(*) AS n FROM edition WHERE item_id = ? AND source = 'bgg'`)
      .bind(itemId),
  ]);

  const editionRows = (batched[0]?.results ?? []) as EditionCoverRow[];
  const checkRows = (batched[1]?.results ?? []) as CoverCheckRow[];
  const bggEditions = ((batched[2]?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;

  const checks = new Map(checkRows.map((r) => [r.url, r]));

  const byUrl = new Map<string, CoverCandidate>();
  for (const row of editionRows) {
    if (byUrl.has(row.image_url)) continue;
    byUrl.set(row.image_url, {
      editionId: row.id,
      url: row.image_url,
      label: labelOf(row),
      year: row.year,
      publisher: row.publisher,
      language: row.language,
      source: sourceOf(row),
      selected: currentUrl === row.image_url,
      status: statusOf(checks.get(row.image_url)),
    });
  }

  // The cover on the item but on no edition — a hand-typed URL, or a campaign
  // image written since the last backfill. It is a real candidate either way,
  // and losing it from this list would make the picker able to swap away from
  // something it cannot offer back.
  if (currentUrl && !byUrl.has(currentUrl)) {
    byUrl.set(currentUrl, {
      editionId: null,
      url: currentUrl,
      label: 'Current cover',
      year: null,
      publisher: null,
      language: null,
      source: 'current',
      selected: true,
      status: statusOf(checks.get(currentUrl)),
    });
  }

  const candidates = [...byUrl.values()].sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
    return a.label.localeCompare(b.label);
  });

  return {
    itemId: item.id,
    kind: item.kind as CoverCandidates['kind'],
    currentUrl,
    bggId: item.bgg_id,
    printingsFetched: bggEditions > 0,
    candidates,
  };
}
