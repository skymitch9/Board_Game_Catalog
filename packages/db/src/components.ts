import {
  HELD_STATUSES,
  buildCompleteness,
  isOfficialComponent,
  type ComponentBackfillRun,
  type GameCompleteness,
  type KnownComponent,
  type OwnedThing,
  type PublisherRef,
} from '@bgc/core';
import { statusList } from './copies.js';

/**
 * "What am I missing" — storage and reads for `game_component` /
 * `component_check` (migration 0016).
 *
 * No fetching happens here. This package talks to D1 and nothing else; the
 * BoardGameGeek calls live in `apps/worker/src/lib/component-backfill.ts`,
 * where the subrequest budget actually is. The two *decisions* — official or
 * not, held or not — live in `packages/core/src/completeness.ts`, so they can
 * be exercised without a database.
 */

/**
 * D1 binds a fixed number of variables per statement.
 *
 * The same ceiling `packages/db/src/import.ts` chunks against, and it bites
 * harder here: one game can list 186 components (Ticket to Ride lists 170
 * expansions alone), so a single game's write is already twice the limit.
 */
const D1_MAX_VARIABLES = 100;

/** Columns per inserted component row — the divisor for the chunk size. */
const COMPONENT_COLUMNS = 8;
const COMPONENTS_PER_BATCH = Math.floor(D1_MAX_VARIABLES / COMPONENT_COLUMNS);

/**
 * How long a game's component list stays fresh.
 *
 * Seven days, matching the weekly cron. The value of re-asking is not that BGG
 * corrects itself; it is that a publisher announcing an expansion for a game
 * you own turns up in your missing list without you doing anything. Weekly is
 * as often as that fact can change and still be worth a notification.
 */
export const COMPONENT_REFRESH_DAYS = 7;

// ---------------------------------------------------------------------------
// JSON columns
// ---------------------------------------------------------------------------

/**
 * Publishers are stored as a JSON array of `{id, name}`.
 *
 * Parsed defensively rather than trusted: this column is meant to be editable
 * by hand when a split is called wrong, and a typo there must degrade to "we do
 * not know who published this" rather than throwing on every page load.
 */
export function parsePublishers(raw: string | null): PublisherRef[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const refs = parsed
      .filter((p): p is { id: unknown; name: unknown } => typeof p === 'object' && p !== null)
      .map((p) => ({ id: Number(p.id), name: String(p.name ?? '') }))
      .filter((p) => Number.isFinite(p.id) && p.name !== '');
    return refs.length > 0 ? refs : null;
  } catch {
    return null;
  }
}

const serialisePublishers = (refs: PublisherRef[] | null | undefined): string | null =>
  refs && refs.length > 0 ? JSON.stringify(refs) : null;

// ---------------------------------------------------------------------------
// Writing what BoardGameGeek says exists
// ---------------------------------------------------------------------------

export interface ComponentLink {
  bggId: number;
  name: string;
  kind: 'expansion' | 'accessory';
}

export interface GameSweepResult {
  added: number;
  seen: number;
  markedStale: number;
}

/**
 * Record one game's component list, as BoardGameGeek currently gives it.
 *
 * **Nothing is ever deleted.** A component that stops appearing is stamped
 * `stale_at` and stays. Deleting would be indistinguishable, from the owner's
 * side, from their having bought the thing — the row simply leaves the missing
 * list either way — and this feature's only job is to be trustworthy about what
 * is missing. A stale row that has come back is un-stamped, so a BGG hiccup
 * heals itself on the next run.
 *
 * Idempotent on `(item_id, bgg_id)`, enforced by a unique index rather than by
 * remembering to check. `publishers`, `official` and `details_at` are left
 * alone on conflict: they belong to the second pass, and re-reading the game's
 * link list must not throw away a classification that cost a BGG call.
 */
export async function recordGameComponents(
  db: D1Database,
  itemId: number,
  publishers: PublisherRef[],
  links: ComponentLink[],
): Promise<GameSweepResult> {
  const before = await db
    .prepare('SELECT bgg_id, stale_at FROM game_component WHERE item_id = ?')
    .bind(itemId)
    .all<{ bgg_id: number; stale_at: string | null }>();
  const known = new Map(before.results.map((r) => [r.bgg_id, r.stale_at]));

  // Deduplicate: BGG occasionally lists an id as both an expansion and an
  // accessory, and the unique index would reject the second half of the batch
  // rather than the one bad row.
  const unique = links.filter((l, i, all) => all.findIndex((o) => o.bggId === l.bggId) === i);

  let added = 0;
  for (let i = 0; i < unique.length; i += COMPONENTS_PER_BATCH) {
    const slice = unique.slice(i, i + COMPONENTS_PER_BATCH);
    const results = await db.batch(
      slice.map((l) =>
        db
          .prepare(
            `INSERT INTO game_component (item_id, bgg_id, name, kind, first_seen_at, last_seen_at, stale_at, details_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'), NULL, NULL)
             ON CONFLICT(item_id, bgg_id) DO UPDATE SET
                    name         = ?3,
                    kind         = ?4,
                    last_seen_at = datetime('now'),
                    -- Back on the list after an absence: forget the absence.
                    stale_at     = NULL`,
          )
          .bind(itemId, l.bggId, l.name, l.kind),
      ),
    );
    // `changes` is 1 for an insert and 1 for the update too, so novelty is
    // decided against what was there before rather than from the write.
    void results;
    added += slice.filter((l) => !known.has(l.bggId)).length;
  }

  const current = new Set(unique.map((l) => l.bggId));
  const vanished = [...known.keys()].filter((id) => !current.has(id));

  let markedStale = 0;
  for (let i = 0; i < vanished.length; i += D1_MAX_VARIABLES - 1) {
    const slice = vanished.slice(i, i + D1_MAX_VARIABLES - 1);
    const res = await db
      .prepare(
        `UPDATE game_component SET stale_at = datetime('now')
          WHERE item_id = ? AND stale_at IS NULL
            AND bgg_id IN (${slice.map(() => '?').join(',')})`,
      )
      .bind(itemId, ...slice)
      .run();
    markedStale += res.meta.changes ?? 0;
  }

  await db
    .prepare(
      `INSERT INTO component_check (item_id, checked_at, publishers, expansions, accessories, outcome)
       VALUES (?1, datetime('now'), ?2, ?3, ?4, 'ok')
       ON CONFLICT(item_id) DO UPDATE SET
              checked_at  = datetime('now'),
              publishers  = ?2,
              expansions  = ?3,
              accessories = ?4,
              outcome     = 'ok'`,
    )
    .bind(
      itemId,
      serialisePublishers(publishers),
      unique.filter((l) => l.kind === 'expansion').length,
      unique.filter((l) => l.kind === 'accessory').length,
    )
    .run();

  return { added, seen: unique.length, markedStale };
}

/**
 * BoardGameGeek returned nothing for this game's id.
 *
 * Recorded rather than skipped, because "the id is wrong or the entry was
 * merged away" is a different fact from "nobody has looked", and only one of
 * them is worth the owner's attention. Its components are left exactly as they
 * were — a failed lookup is not evidence that anything stopped existing.
 */
export async function recordGameNotFound(db: D1Database, itemId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO component_check (item_id, checked_at, outcome)
       VALUES (?1, datetime('now'), 'not_found')
       ON CONFLICT(item_id) DO UPDATE SET
              checked_at = datetime('now'),
              outcome    = 'not_found'`,
    )
    .bind(itemId)
    .run();
}

// ---------------------------------------------------------------------------
// Classifying components — the second pass
// ---------------------------------------------------------------------------

export interface ComponentDetails {
  bggId: number;
  publishers: PublisherRef[];
  yearPublished: number | null;
  thumbnailUrl: string | null;
}

/**
 * Write a component's own details, and decide which side of the split it is on.
 *
 * One BoardGameGeek id can be a component of several games we own, and the
 * answer differs per game: Portal Games' wooden tokens are official for Ark
 * Nova and would be third-party for anything Portal did not publish. So the
 * update is per `(item_id, bgg_id)` and the comparison uses each game's own
 * publisher list, taken from `component_check`.
 */
export async function classifyComponents(
  db: D1Database,
  details: ComponentDetails[],
): Promise<number> {
  if (details.length === 0) return 0;

  const byBgg = new Map(details.map((d) => [d.bggId, d]));
  const ids = [...byBgg.keys()];

  const rows: { id: number; bgg_id: number; publishers: string | null }[] = [];
  for (let i = 0; i < ids.length; i += D1_MAX_VARIABLES) {
    const slice = ids.slice(i, i + D1_MAX_VARIABLES);
    const { results } = await db
      .prepare(
        `SELECT gc.id, gc.bgg_id, cc.publishers
           FROM game_component gc
           LEFT JOIN component_check cc ON cc.item_id = gc.item_id
          WHERE gc.bgg_id IN (${slice.map(() => '?').join(',')})`,
      )
      .bind(...slice)
      .all<{ id: number; bgg_id: number; publishers: string | null }>();
    rows.push(...results);
  }

  if (rows.length === 0) return 0;

  let written = 0;
  const statements = rows.map((row) => {
    const d = byBgg.get(row.bgg_id)!;
    const official = isOfficialComponent(d.publishers, parsePublishers(row.publishers));
    return db
      .prepare(
        `UPDATE game_component
            SET publishers = ?2, year_published = ?3, thumbnail_url = ?4,
                official = ?5, details_at = datetime('now')
          WHERE id = ?1`,
      )
      .bind(
        row.id,
        serialisePublishers(d.publishers),
        d.yearPublished,
        d.thumbnailUrl,
        official == null ? null : official ? 1 : 0,
      );
  });

  for (let i = 0; i < statements.length; i += 50) {
    const batch = await db.batch(statements.slice(i, i + 50));
    written += batch.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  }
  return written;
}

/**
 * Take component ids off the classification backlog without a verdict.
 *
 * For ids BoardGameGeek links from a game but returns nothing for when asked
 * about directly. Left unclassified — which is the truth — but stamped as
 * asked-about, so they stop taking a slot from ids that can be answered. That
 * slot theft is silent: the run reports the same twenty ids every time and
 * looks busy while making no progress at all.
 */
export async function markComponentsUnclassifiable(
  db: D1Database,
  bggIds: number[],
): Promise<number> {
  if (bggIds.length === 0) return 0;

  let changed = 0;
  for (let i = 0; i < bggIds.length; i += D1_MAX_VARIABLES) {
    const slice = bggIds.slice(i, i + D1_MAX_VARIABLES);
    const res = await db
      .prepare(
        `UPDATE game_component SET details_at = datetime('now')
          WHERE details_at IS NULL AND bgg_id IN (${slice.map(() => '?').join(',')})`,
      )
      .bind(...slice)
      .run();
    changed += res.meta.changes ?? 0;
  }
  return changed;
}

/**
 * Re-decide the split from what is already stored, with no BoardGameGeek call.
 *
 * The reason `publishers` is a column and not a transient. If the rule changes,
 * or a publisher list is corrected by hand, this makes every affected row agree
 * again for the price of one query.
 */
export async function reclassifyStoredComponents(
  db: D1Database,
  itemId?: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT gc.id, gc.publishers AS theirs, cc.publishers AS ours
         FROM game_component gc
         LEFT JOIN component_check cc ON cc.item_id = gc.item_id
        WHERE gc.publishers IS NOT NULL ${itemId != null ? 'AND gc.item_id = ?' : ''}`,
    )
    .bind(...(itemId != null ? [itemId] : []))
    .all<{ id: number; theirs: string | null; ours: string | null }>();

  if (results.length === 0) return 0;

  const statements = results.map((r) => {
    const official = isOfficialComponent(parsePublishers(r.theirs), parsePublishers(r.ours));
    return db
      .prepare('UPDATE game_component SET official = ?2 WHERE id = ?1')
      .bind(r.id, official == null ? null : official ? 1 : 0);
  });

  let changed = 0;
  for (let i = 0; i < statements.length; i += 50) {
    const batch = await db.batch(statements.slice(i, i + 50));
    changed += batch.reduce((sum, x) => sum + (x.meta?.changes ?? 0), 0);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// The owner's own verdict
// ---------------------------------------------------------------------------

/**
 * Say by hand that we hold a component, or withdraw that.
 *
 * See migration 0022: the case this exists for is a component **no
 * BoardGameGeek id can ever settle**, because what we own is not the product
 * BGG lists — sleeves that came inside a Kickstarter box against eleven
 * per-hero sleeve entries.
 *
 * Scoped to one `game_component` row, which is one component *of one game*.
 * That is deliberate: the same BoardGameGeek id can be a component of several
 * games we own, and "the sleeves came in the box" may be true of one and false
 * of another.
 *
 * Passing `null` clears the verdict and hands the row back to the ordinary
 * id-and-name rules — the undo, and the reason `manual_at` is stamped rather
 * than the row being rewritten.
 */
export async function setComponentManualState(
  db: D1Database,
  componentId: number,
  state: 'have' | null,
  note: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE game_component
          SET manual_state = ?2,
              manual_note  = ?3,
              manual_at    = CASE WHEN ?2 IS NULL THEN NULL ELSE datetime('now') END
        WHERE id = ?1`,
    )
    .bind(componentId, state, state == null ? null : note)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Choosing what to work on
// ---------------------------------------------------------------------------

/**
 * Games due a component sweep, least recently checked first.
 *
 * Only rooted games — a base game or an orphan waiting for one. An expansion's
 * own expansions belong to the tree its root already covers, and asking about
 * both would list the same component twice under two headings.
 *
 * Never-checked games sort first: `COALESCE(..., '')` puts them before any real
 * timestamp, so a game that gained a `bgg_id` yesterday is swept on the next
 * run rather than after a full lap of the catalog.
 */
export async function listGamesNeedingComponents(
  db: D1Database,
  opts: { limit: number; force?: boolean; itemId?: number | null; staleDays?: number },
): Promise<{ id: number; bggId: number }[]> {
  const where = ['i.bgg_id IS NOT NULL', 'i.parent_item_id IS NULL'];
  const params: unknown[] = [];

  if (opts.itemId != null) {
    where.push('i.id = ?');
    params.push(opts.itemId);
  }
  if (!opts.force) {
    where.push(
      `(cc.checked_at IS NULL OR cc.checked_at < datetime('now', ?))`,
    );
    params.push(`-${opts.staleDays ?? COMPONENT_REFRESH_DAYS} days`);
  }

  const { results } = await db
    .prepare(
      `SELECT i.id, i.bgg_id
         FROM item i
         LEFT JOIN component_check cc ON cc.item_id = i.id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(cc.checked_at, '') ASC, i.id
        LIMIT ?`,
    )
    .bind(...params, opts.limit)
    .all<{ id: number; bgg_id: number }>();

  return results.map((r) => ({ id: r.id, bggId: r.bgg_id }));
}

/**
 * Component ids whose own details have never been fetched.
 *
 * Distinct, because one id can be a component of several games and it is one
 * BoardGameGeek call either way. Ordered so the run is deterministic and a
 * repeat covers different ground rather than the same twenty rows.
 */
export async function listUnclassifiedComponentIds(
  db: D1Database,
  limit: number,
): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT bgg_id FROM game_component
        WHERE details_at IS NULL AND stale_at IS NULL
        ORDER BY bgg_id
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ bgg_id: number }>();
  return results.map((r) => r.bgg_id);
}

export interface ComponentCoverage {
  /** Rooted games with a `bgg_id` — the only ones this can ever answer for. */
  eligibleGames: number;
  /** Of those, how many have ever been swept. */
  checkedGames: number;
  /** Of those, how many are due a refresh now. */
  dueGames: number;
  /** Games BoardGameGeek returned nothing for. */
  notFoundGames: number;
  components: number;
  /** Components still awaiting the second pass, distinct by BoardGameGeek id. */
  unclassifiedComponents: number;
  lastRunAt: string | null;
}

/** What is left to do, without spending a BoardGameGeek request to find out. */
export async function componentCoverage(db: D1Database): Promise<ComponentCoverage> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM item
           WHERE bgg_id IS NOT NULL AND parent_item_id IS NULL)          AS eligible,
         (SELECT COUNT(*) FROM component_check cc JOIN item i ON i.id = cc.item_id
           WHERE i.bgg_id IS NOT NULL AND i.parent_item_id IS NULL)      AS checked,
         (SELECT COUNT(*) FROM item i
            LEFT JOIN component_check cc ON cc.item_id = i.id
           WHERE i.bgg_id IS NOT NULL AND i.parent_item_id IS NULL
             AND (cc.checked_at IS NULL
                  OR cc.checked_at < datetime('now', ?1)))               AS due,
         (SELECT COUNT(*) FROM component_check WHERE outcome = 'not_found') AS not_found,
         (SELECT COUNT(*) FROM game_component)                           AS components,
         (SELECT COUNT(*) FROM (SELECT DISTINCT bgg_id FROM game_component
            WHERE details_at IS NULL AND stale_at IS NULL))              AS unclassified,
         (SELECT MAX(checked_at) FROM component_check)                   AS last_run`,
    )
    .bind(`-${COMPONENT_REFRESH_DAYS} days`)
    .first<{
      eligible: number;
      checked: number;
      due: number;
      not_found: number;
      components: number;
      unclassified: number;
      last_run: string | null;
    }>();

  return {
    eligibleGames: row?.eligible ?? 0,
    checkedGames: row?.checked ?? 0,
    dueGames: row?.due ?? 0,
    notFoundGames: row?.not_found ?? 0,
    components: row?.components ?? 0,
    unclassifiedComponents: row?.unclassified ?? 0,
    lastRunAt: row?.last_run ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reading the answer back
// ---------------------------------------------------------------------------

/**
 * What is missing for one game.
 *
 * Answers for the whole tree rooted at this item, so asking from an expansion's
 * page reports on its base game — the components belong to the game, not to
 * whichever row you happened to open.
 *
 * The comparison set is every item under that root plus the root itself,
 * because a "Here to Slay" expansion is filed as its child and an accessory may
 * be filed under the expansion.
 */
export async function getGameCompleteness(
  db: D1Database,
  itemId: number,
): Promise<GameCompleteness | null> {
  const item = await db
    .prepare('SELECT id, bgg_id, root_game_id, parent_item_id FROM item WHERE id = ?')
    .bind(itemId)
    .first<{
      id: number;
      bgg_id: number | null;
      root_game_id: number | null;
      parent_item_id: number | null;
    }>();
  if (!item) return null;

  const rootId = item.root_game_id ?? item.id;

  const batched = await db.batch([
    db.prepare('SELECT id, bgg_id, name FROM item WHERE id = ?').bind(rootId),
    db
      .prepare(
        `SELECT id, bgg_id, name, kind, publishers, year_published, thumbnail_url,
                official, stale_at, manual_state, manual_note
           FROM game_component WHERE item_id = ?`,
      )
      .bind(rootId),
    db.prepare('SELECT checked_at, outcome FROM component_check WHERE item_id = ?').bind(rootId),
    // Everything in the tree, and what we hold of it. `preordered` counts as
    // held: it is money already spent on a box in the post, and putting it back
    // on a shopping list is how a thing gets bought twice. The set itself lives
    // in `packages/core/constants.ts` — this is the only query that asks the
    // "should I stop looking for it?" question, and the counts elsewhere ask a
    // different one.
    db
      .prepare(
        `SELECT i.id, i.name, i.bgg_id,
                MAX(CASE WHEN c.status IN (${statusList(HELD_STATUSES)}) THEN 1 ELSE 0 END) AS held,
                MAX(CASE WHEN c.status = 'wanted' THEN 1 ELSE 0 END) AS wanted
           FROM item i
           LEFT JOIN copy c ON c.item_id = i.id
          WHERE i.root_game_id = ?
          GROUP BY i.id`,
      )
      .bind(rootId),
  ]);

  const root = ((batched[0]?.results ?? [])[0] ?? null) as {
    id: number;
    bgg_id: number | null;
    name: string;
  } | null;
  const componentRows = (batched[1]?.results ?? []) as {
    id: number;
    bgg_id: number;
    name: string;
    kind: string;
    publishers: string | null;
    year_published: number | null;
    thumbnail_url: string | null;
    official: number | null;
    stale_at: string | null;
    manual_state: string | null;
    manual_note: string | null;
  }[];
  const check = ((batched[2]?.results ?? [])[0] ?? null) as {
    checked_at: string;
    outcome: string;
  } | null;
  const ownedRows = (batched[3]?.results ?? []) as {
    id: number;
    name: string;
    bgg_id: number | null;
    held: number;
    wanted: number;
  }[];

  const components: KnownComponent[] = componentRows.map((r) => ({
    id: r.id,
    bggId: r.bgg_id,
    name: r.name,
    kind: r.kind as KnownComponent['kind'],
    publishers: parsePublishers(r.publishers),
    yearPublished: r.year_published,
    thumbnailUrl: r.thumbnail_url,
    official: r.official == null ? null : r.official === 1,
    stale: r.stale_at != null,
    manualState: r.manual_state === 'have' ? 'have' : null,
    manualNote: r.manual_note,
  }));

  const owned: OwnedThing[] = ownedRows.map((r) => ({
    itemId: r.id,
    name: r.name,
    bggId: r.bgg_id,
    held: r.held === 1,
    wanted: r.wanted === 1,
  }));

  return buildCompleteness({
    itemId: rootId,
    bggId: root?.bgg_id ?? null,
    gameName: root?.name ?? '',
    checkedAt: check?.checked_at ?? null,
    outcome: check ? (check.outcome as 'ok' | 'not_found') : null,
    components,
    owned,
  });
}

export type { ComponentBackfillRun };
