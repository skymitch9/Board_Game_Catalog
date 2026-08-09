import type {
  CollectionEntry,
  CollectionGroup,
  Copy,
  CreateItemInput,
  DetailField,
  GroupAxis,
  Item,
  ItemDetail,
  ItemNode,
  ItemPage,
  ItemQuery,
  MatchedChild,
  PreorderArrival,
  Rating,
  CoverLender,
  InheritedDetail,
  UpdateItemInput,
  WishlistEntry,
} from '@bgc/core';
import {
  COLLECTION_PAGE_SIZE,
  INHERITED_FIELDS,
  detailGapBranches,
  foldSearchText,
  inheritCover,
  isBlankDetail,
  normaliseTitle,
  searchTerms,
} from '@bgc/core';
import { getRelatedItems } from './relations.js';
import { preserveDisplacedCover } from './editions.js';
import { mapCopyRow, toIso, type CopyRow } from './copies.js';

export interface ItemRow {
  id: number;
  bgg_id: number | null;
  kind: string;
  parent_item_id: number | null;
  root_game_id: number | null;
  pending_parent_name: string | null;
  name: string;
  sort_name: string | null;
  year_published: number | null;
  publisher: string | null;
  publisher_url: string | null;
  source_url: string | null;
  game_system: string | null;
  series: string | null;
  designers: string | null;
  min_players: number | null;
  max_players: number | null;
  playtime_min: number | null;
  weight: number | null;
  thumbnail_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export function mapItemRow(r: ItemRow): Item {
  return {
    id: r.id,
    bggId: r.bgg_id,
    kind: r.kind as Item['kind'],
    parentItemId: r.parent_item_id,
    rootGameId: r.root_game_id,
    pendingParentName: r.pending_parent_name,
    name: r.name,
    sortName: r.sort_name,
    yearPublished: r.year_published,
    publisher: r.publisher,
    publisherUrl: r.publisher_url,
    sourceUrl: r.source_url,
    gameSystem: r.game_system,
    series: r.series,
    designers: r.designers,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    playtimeMin: r.playtime_min,
    weight: r.weight,
    thumbnailUrl: r.thumbnail_url,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const ITEM_COLUMNS = `id, bgg_id, kind, parent_item_id, root_game_id, pending_parent_name,
  name, sort_name, year_published, publisher, publisher_url, source_url, game_system, series,
  designers, min_players, max_players, playtime_min, weight, thumbnail_url, description,
  created_at, updated_at`;

/** "The Castles of Burgundy" sorts under C, not T. */
export function toSortName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');
}

/**
 * The SQL half of `foldSearchText`. Both sides of every comparison get this.
 *
 * The characters and the reasoning are in `foldSearchText`'s comment in
 * `packages/core/src/schemas.ts`; **the two lists must agree**, because folding
 * only the typed term would take a working search and break it. The terms are
 * folded there, on their way to becoming `?` params, so nothing in this file
 * folds a term itself.
 *
 * ⚠️ **`char(N)` rather than the glyphs.** The generated SQL is pure ASCII, so a
 * shell that mangles this file's UTF-8 while rewriting it — which has happened
 * in this repo, see CLAUDE.md — cannot silently change which characters get
 * folded. A literal curly quote inside this string would typecheck, build,
 * deploy, and quietly stop matching.
 *
 * Cost: seven `replace()` calls per column per row scanned. Free at this size in
 * the shape `matchingRootsSql` uses — see the note there — and the measurement
 * that says when it stops being free is with it.
 */
const FOLD_CODEPOINTS = [0x2019, 0x0027, 0x2018, 0x0060, 0x002d, 0x2013, 0x2014];

function folded(expr: string): string {
  return FOLD_CODEPOINTS.reduce(
    (sql, cp) => `replace(${sql}, char(${cp}), '')`,
    `lower(${expr})`,
  );
}

/**
 * The fields a search term is looked for in, for one item alias.
 *
 * `series` is here because it is the only name the *line* has. Typing "D&D"
 * used to return **one** of the 14 trees that carry `series = 'D&D'` — the
 * 2024 Dungeon Master's Guide, and only because somebody happened to write
 * "D&D" into a child row's name. The other 13 are called "Player's Handbook
 * (2024)" and "Ryoko's Guide to the Yokai Realms", and nothing in a name, a
 * publisher or a designer says what line they belong to. `game_system` is
 * deliberately *not*
 * here: it duplicates `series` on every row in this catalog that has both, and
 * where it differs it is the more granular claim ("D&D 5e (2014)"), which the
 * dropdown filter already reaches exactly.
 */
function termClause(alias: string): string {
  return `(${folded(`${alias}.name`)} LIKE ? OR ${folded(`${alias}.publisher`)} LIKE ?
           OR ${folded(`${alias}.designers`)} LIKE ? OR ${folded(`${alias}.series`)} LIKE ?)`;
}

/**
 * The same term, looked for in the other names a game answers to.
 *
 * ⚠️ **This is looser than the scanner is allowed to be, on purpose, and the
 * two must never share a code path.** `buildTitleIndex` in
 * `packages/core/src/vision.ts` matches an alias *exactly*, drops one claimed by
 * two items, and lets a real name beat one — because a match there marks a game
 * already-owned with nobody watching, and a wrong guess makes a box vanish from
 * the review list. None of that applies to a search box: it is already
 * `LIKE '%term%'` over four columns, a person reads the results and decides,
 * and nothing is written. A false positive here costs one extra row on screen;
 * the failure that actually hurts is typing "DnD" and being told you own
 * nothing.
 *
 * The asymmetry is deliberate in both directions. A contested alias belongs to
 * nobody in the scanner and to *everybody* here — showing both games that answer
 * to a name is the right answer for a human and the wrong one for an unattended
 * matcher. That is precisely why this is SQL living beside the collection query
 * rather than a flag on the core matcher.
 *
 * ⚠️ **An uncorrelated `IN`, and it has to be — measured, not assumed.** A
 * leading-wildcard LIKE can use no index, so the alias table gets scanned; the
 * only question is how often. Written as a correlated `EXISTS (… WHERE
 * ta.root_game_id = i2.root_game_id …)` the scan happens once per candidate row,
 * and against a fully backfilled table (22,908 rows — 197 items × BGG's ~116
 * alternate names each) the collection count went **3–5 ms → 22–27 ms**. As an
 * `IN` whose subquery mentions nothing from the outer query, SQLite builds the
 * set of matching roots once and probes it: **6–10 ms** on the same data, for
 * the same answers. Do not "tidy" this back into an EXISTS.
 *
 * It is still one scan of `item_alias` per search *term*, which is the honest
 * ceiling here; `searchTerms` caps a query at eight.
 *
 * Kept as a sibling of the text clause rather than folded into it, so the two
 * stay separately readable and `EXPLAIN QUERY PLAN` names them separately. That
 * plan must say `LIST SUBQUERY`, not `CORRELATED`, which is the line to check if
 * this is ever edited.
 *
 * ⚠️ **The alias fold is the one part of the search fold that will not stay
 * free.** `al.alias` gets the same `folded()` treatment as every other column,
 * because an alias typed with a curly apostrophe has to answer to a straight one
 * — but this is the only folded column whose table is unbounded. Measured, same
 * machine, same catalog:
 *
 * | `item_alias` rows | unfolded | folded |
 * |---|---|---|
 * | 72 (today's D&D rows) | 3.9–6.0 ms | 4.9–7.1 ms |
 * | 22,852 (a full BGG backfill) | 10–24 ms | 64–125 ms |
 *
 * Production holds **0** alias rows and the D&D work adds 72, so this costs
 * nothing today. If somebody backfills BGG's alternate names, the fix is a
 * stored folded column on `item_alias` — measured at **11–23 ms** on the same
 * 22,852 rows, i.e. back to the unfolded baseline. Do that then, not now: an
 * empty table does not need a migration.
 */
function aliasTermClause(rootExpr: string): string {
  return `${rootExpr} IN (SELECT ta.root_game_id
                            FROM item_alias al
                            JOIN item ta ON ta.id = al.item_id
                           WHERE ta.root_game_id IS NOT NULL
                             AND ${folded('al.alias')} LIKE ?)`;
}

/**
 * True when this item's own text accounts for the term. Mirrors `termClause`.
 *
 * Aliases are **not** consulted here, and that is not an oversight. This feeds
 * `attachMatchReasons`, whose whole job is to name the child that explains a
 * result, and it works from the trees already in memory — no alias rows were
 * read. A tree that matched only by alias simply gets no "why" line, which is
 * the same thing that happens today when a term is explained by the root.
 *
 * ⚠️ It mirrors `folded()` too, and has to. The term arrives already folded from
 * `searchTerms`, so comparing it against a raw `Player’s Handbook` would find
 * nothing — the search would return the row and then refuse to say why.
 */
function itemMatchesTerm(item: Item, term: string): boolean {
  return [item.name, item.publisher, item.designers, item.series].some(
    (field) => field != null && foldSearchText(field).includes(term),
  );
}

/**
 * The FROM/WHERE that selects the game trees matching the filters.
 *
 * Filtering on the *tree* rather than the item is deliberate: searching for an
 * expansion should surface its base game too, otherwise you get an orphaned
 * result with no context.
 *
 * Each search term gets its own probe of the tree, and the terms are ANDed.
 * That is what lets "catan seafarers" find the Catan group: the two words are
 * satisfied by two different rows in it. Putting both words in one LIKE would
 * require them adjacent in a single field, which they are not — and pushing the
 * AND down onto one item row would require one row to contain both, which is
 * the same mistake wearing different clothes.
 */
/**
 * One grouping label per game tree, and which axis it came from.
 *
 * Two rules, both of which earn their complexity against real data:
 *
 * - **A series outranks a game system.** They can both apply, and the series is
 *   the more specific claim about the box.
 * - **The value most of the tree carries wins.** Production holds exactly one
 *   tree with two systems — 20 rows of "D&D 2024" and one of "D&D (playtest
 *   material)" — and the alphabetically-first of those is the playtest sheet.
 *   Taking `MIN()` would have filed the whole 2024 line under it.
 *
 * A root with no series and no system anywhere in its tree gets no row here, and
 * is its own entry on the page.
 *
 * **A grouping of one line is not a grouping.** `HAVING COUNT(*) > 1` drops it,
 * for the same reason a group of one child on a game card starts expanded:
 * replacing one row with one row and a click is not a saving, it is an extra
 * step. Production has four such systems — D&D 2024, Cypher System, Lewd Dungeon
 * Adventures, the playtest sheet — and each stays the game it already was.
 */
const ROOT_GROUP_CTE = `WITH picked_group AS (
  SELECT root_id, axis, val FROM (
    SELECT root_id, axis, val,
           ROW_NUMBER() OVER (
             PARTITION BY root_id
             ORDER BY CASE axis WHEN 'series' THEN 0 ELSE 1 END, n DESC, val
           ) AS rn
      FROM (
        SELECT root_game_id AS root_id, 'series' AS axis, series AS val, COUNT(*) AS n
          FROM item
         WHERE root_game_id IS NOT NULL AND series IS NOT NULL AND trim(series) != ''
         GROUP BY root_game_id, series
        UNION ALL
        SELECT root_game_id AS root_id, 'system' AS axis, game_system AS val, COUNT(*) AS n
          FROM item
         WHERE root_game_id IS NOT NULL AND game_system IS NOT NULL AND trim(game_system) != ''
         GROUP BY root_game_id, game_system
      )
  ) WHERE rn = 1
),
root_group AS (
  SELECT p.root_id, p.axis, p.val
    FROM picked_group p
    JOIN (SELECT axis, val FROM picked_group GROUP BY axis, val HAVING COUNT(*) > 1) m
      ON m.axis = p.axis AND m.val = p.val
) `;

/**
 * The identity of one entry on the collection page, as SQL.
 *
 * `root:42` for an ordinary game, `series:Dice Throne` or `system:D&D 5e (2014)`
 * for a group. The page is paged on *this*, not on root ids, which is what makes
 * eleven boxes occupy one slot rather than eleven and keeps a page the same size
 * whichever it is.
 */
const GROUP_KEY = `CASE WHEN g.val IS NULL THEN 'root:' || i2.root_game_id
                        ELSE g.axis || ':' || g.val END`;
const ROOT_KEY = `'root:' || i2.root_game_id`;

/** What entries are sorted by, so a group sits where its members were. */
const GROUP_ORD = `CASE WHEN g.val IS NULL THEN lower(COALESCE(r.sort_name, r.name))
                        ELSE lower(g.val) END`;
const ROOT_ORD = `lower(COALESCE(r.sort_name, r.name))`;

function matchingRootsSql(
  query: ItemQuery,
  opts?: {
    /** Fold series and systems into one entry each. Adds the CTE and the join. */
    grouped?: boolean;
    /** An extra condition, ANDed last so its params bind after the rest. */
    extra?: { where: string; params: unknown[] };
  },
): { cte: string; sql: string; key: string; ord: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  for (const term of searchTerms(query.q)) {
    // ⚠️ **Both halves are uncorrelated `IN`s, and the text half only became one
    // when the fold arrived.** It used to be `EXISTS (… WHERE t.root_game_id =
    // i2.root_game_id …)`, which re-evaluates its LIKEs once per candidate row.
    // That was affordable while the comparison was a bare `lower()`; wrapping
    // each column in seven `replace()` calls made the same query cost **16–27 ms
    // against a 4–5 ms baseline**, on 806 items. Hoisted to an `IN` whose
    // subquery mentions nothing from the outer query, SQLite folds the catalog
    // **once per term** and probes the resulting set through `idx_item_root`:
    // **1.7–7.1 ms**, at or under the unfolded baseline it replaced.
    //
    // This is the same rewrite, for the same reason, that the alias probe below
    // already carries — see its comment for the numbers that established it.
    // `EXPLAIN QUERY PLAN` should say `MULTI-INDEX OR` over two `LIST SUBQUERY`s
    // and must never say `CORRELATED`. Verified answer-for-answer against the
    // EXISTS form over 1,212 query pairs — every term pair drawn from the real
    // catalog's own words, crossed with the kind, status and uncatalogued
    // filters — with zero differences.
    where.push(
      `(i2.root_game_id IN (SELECT t.root_game_id FROM item t
                             WHERE t.root_game_id IS NOT NULL AND ${termClause('t')})
        OR ${aliasTermClause('i2.root_game_id')})`,
    );
    const like = `%${term}%`;
    // Four for `termClause`, then one for the alias probe — in the order the
    // two clauses appear above.
    params.push(like, like, like, like, like);
  }
  if (query.kind) {
    where.push('i2.kind = ?');
    params.push(query.kind);
  }
  if (query.gameSystem) {
    // Matched exactly, not by LIKE: the values are free text but the dropdown is
    // built from the ones actually in the column, so "D&D 5e (2014)" is picked
    // rather than typed, and a prefix match would fold it into "D&D 2024".
    where.push('i2.game_system = ?');
    params.push(query.gameSystem);
  }
  if (query.series) {
    // Exactly, for the same reason as `gameSystem`: free text in the column, but
    // picked from a list built out of it rather than typed.
    where.push('i2.series = ?');
    params.push(query.series);
  }
  if (query.status) {
    where.push('c2.status = ?');
    params.push(query.status);
  }
  if (query.uncatalogued) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM item i3 JOIN copy c3 ON c3.item_id = i3.id
                    WHERE i3.root_game_id = i2.root_game_id)`,
    );
  }
  if (query.duplicates) {
    // Anything in this tree we hold more than one of, counting both several
    // rows for the same item and a single row with quantity > 1.
    where.push(
      `EXISTS (SELECT 1 FROM item i4 JOIN copy c4 ON c4.item_id = i4.id
                WHERE i4.root_game_id = i2.root_game_id
                  AND c4.status IN ('owned','lent')
                GROUP BY i4.id
               HAVING SUM(c4.quantity) > 1)`,
    );
  }

  const grouped = opts?.grouped ?? false;

  if (opts?.extra) {
    where.push(opts.extra.where);
    params.push(...opts.extra.params);
  }

  // The join to the root is what makes paging orderable: a page has to be the
  // same 25 entries every time it is asked for, in an order a person
  // recognises, and only the root carries the name the tree is filed under.
  const sql = `FROM item i2
               JOIN item r ON r.id = i2.root_game_id
               LEFT JOIN copy c2 ON c2.item_id = i2.id
               ${grouped ? 'LEFT JOIN root_group g ON g.root_id = i2.root_game_id' : ''}
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  return {
    cte: grouped ? ROOT_GROUP_CTE : '',
    sql,
    key: grouped ? GROUP_KEY : ROOT_KEY,
    ord: grouped ? GROUP_ORD : ROOT_ORD,
    params,
  };
}

/** Assemble flat rows into base-game-rooted trees. */
function buildTrees(items: Item[], copiesByItem: Map<number, Copy[]>): ItemNode[] {
  const nodes = new Map<number, ItemNode>();
  for (const item of items) {
    nodes.set(item.id, { ...item, copies: copiesByItem.get(item.id) ?? [], children: [] });
  }

  const roots: ItemNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentItemId != null ? nodes.get(node.parentItemId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byName = (a: ItemNode, b: ItemNode) =>
    (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name);
  const sortDeep = (list: ItemNode[]) => {
    list.sort(byName);
    list.forEach((n) => sortDeep(n.children));
  };
  sortDeep(roots);

  // The whole tree is in hand, so a row's ancestors cost nothing to walk — no
  // query, and no CTE. `ancestors` is nearest-first, which is what `inheritCover`
  // requires. See `packages/core/src/covers.ts` for the rule itself.
  const lendDown = (node: ItemNode, ancestors: CoverLender[]) => {
    node.inheritedCover = inheritCover(node.thumbnailUrl, ancestors);
    const forChildren = [{ id: node.id, name: node.name, thumbnailUrl: node.thumbnailUrl }, ...ancestors];
    for (const child of node.children) lendDown(child, forChildren);
  };
  for (const root of roots) lendDown(root, []);

  return roots;
}

/** How many matching children a result may name before it stops being a hint. */
const MAX_MATCH_REASONS = 3;

/**
 * Should this request fold series and systems into single entries?
 *
 * Two cases where the answer is no however the caller asked, and both are about
 * not hiding the thing the person is looking at:
 *
 * - **While searching.** The owner's journey is "find Scarlet Witch, work out
 *   which box". Folding her hit into a *Dice Throne* card answers neither half.
 * - **While inside a group.** Filtering to `series=Dice Throne` is the act of
 *   opening it; folding the result back into one card would make the filter do
 *   nothing.
 */
function shouldGroup(query: ItemQuery): boolean {
  return Boolean(query.grouped) && !query.q && !query.series && !query.gameSystem;
}

/**
 * One page of the collection: game trees, and groups standing in for several.
 *
 * Paged on the *entry key*, then each page's trees are fetched whole and each
 * page's groups summarised. The alternative — fetching every matching item and
 * slicing afterwards — would assemble all 739 rows to hand back 25 entries,
 * which is the cost this exists to avoid. Summarising a group in SQL matters for
 * the same reason: a Dice Throne card that had to load its 147 rows to say "147
 * rows" would cost exactly what folding it up was meant to save.
 *
 * Reads: the totals, this page's keys, then two batched reads for the trees and
 * two more for the groups — and the group pair is skipped entirely when the page
 * holds none, which is every page of an ungrouped request.
 */
export async function listItemTrees(db: D1Database, query: ItemQuery): Promise<ItemPage> {
  const grouped = shouldGroup(query);
  const roots = matchingRootsSql(query, { grouped });
  const pageSize = COLLECTION_PAGE_SIZE;

  const counted = await db
    .prepare(
      `${roots.cte}SELECT COUNT(DISTINCT ${roots.key}) AS total,
              COUNT(DISTINCT i2.root_game_id) AS roots ${roots.sql}`,
    )
    .bind(...roots.params)
    .first<{ total: number; roots: number }>();
  const total = counted?.total ?? 0;
  const totalRoots = counted?.roots ?? 0;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Asking for page 9 of 5 gets the last page, not an empty one. A stale link or
  // a filter that narrowed under you should land somewhere, not nowhere.
  const page = Math.min(Math.max(query.page ?? 1, 1), pageCount);

  if (total === 0) {
    return { entries: [], total, totalRoots, page: 1, pageSize, pageCount: 1 };
  }

  // Grouped by the key rather than DISTINCT over (key, ord): a group's members
  // have different sort names, and only one of them can decide where the group
  // lands. MIN is that decision, and it is stable.
  const { results: keyRows } = await db
    .prepare(
      `${roots.cte}SELECT ${roots.key} AS gkey, MIN(${roots.ord}) AS ord
       ${roots.sql}
        GROUP BY gkey
        ORDER BY ord, gkey
        LIMIT ? OFFSET ?`,
    )
    .bind(...roots.params, pageSize, (page - 1) * pageSize)
    .all<{ gkey: string; ord: string }>();

  const keys = keyRows.map((k) => k.gkey);
  if (keys.length === 0) {
    return { entries: [], total, totalRoots, page, pageSize, pageCount };
  }

  const rootKeys = keys.filter((k) => k.startsWith('root:'));
  const groupKeys = keys.filter((k) => !k.startsWith('root:'));

  const [trees, groups] = await Promise.all([
    fetchTrees(db, query, rootKeys.map((k) => Number(k.slice(5)))),
    groupKeys.length > 0 ? summariseGroups(db, query, groupKeys) : Promise.resolve(new Map()),
  ]);

  const treeById = new Map(trees.map((t) => [t.id, t]));

  // Rebuilt in the order the keys came back, so groups sit among the trees
  // where their members were rather than being bolted on at either end.
  const entries: CollectionEntry[] = [];
  for (const key of keys) {
    if (key.startsWith('root:')) {
      const tree = treeById.get(Number(key.slice(5)));
      if (tree) entries.push({ key, kind: 'tree', tree });
    } else {
      const group = groups.get(key);
      if (group) entries.push({ key, kind: 'group', group });
    }
  }

  return { entries, total, totalRoots, page, pageSize, pageCount };
}

/** Whole trees for the roots on this page, with their copies and match reasons. */
async function fetchTrees(
  db: D1Database,
  query: ItemQuery,
  ids: number[],
): Promise<ItemNode[]> {
  if (ids.length === 0) return [];
  const holes = ids.map(() => '?').join(',');

  const batched = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE root_game_id IN (${holes})`).bind(...ids),
    db
      .prepare(
        `SELECT c.* FROM copy c
           JOIN item i ON i.id = c.item_id
          WHERE i.root_game_id IN (${holes})`,
      )
      .bind(...ids),
  ]);
  const itemRows = (batched[0]?.results ?? []) as ItemRow[];
  const copyRows = (batched[1]?.results ?? []) as CopyRow[];

  const items = itemRows.map(mapItemRow);
  const copiesByItem = new Map<number, Copy[]>();
  for (const row of copyRows) {
    const copy = mapCopyRow(row);
    const list = copiesByItem.get(copy.itemId);
    if (list) list.push(copy);
    else copiesByItem.set(copy.itemId, [copy]);
  }

  const trees = buildTrees(items, copiesByItem);
  attachMatchReasons(trees, searchTerms(query.q));
  return trees;
}

/**
 * What a folded-up group has to say for itself, without unfolding it.
 *
 * Two reads. The first is one row per line — its name, its cover, and how many
 * rows are under it; the second sums the copies. Neither returns the tree, which
 * is the point: the Dice Throne card describes 147 rows without loading one.
 *
 * The filters are reapplied inside, so a group counts what *matches* rather than
 * what exists. Filtering to `wanted` and being told the Dice Throne group holds
 * 147 items would be a card describing a different question's answer.
 */
async function summariseGroups(
  db: D1Database,
  query: ItemQuery,
  groupKeys: string[],
): Promise<Map<string, CollectionGroup>> {
  const holes = groupKeys.map(() => '?').join(',');
  const scoped = matchingRootsSql(query, {
    grouped: true,
    extra: { where: `${GROUP_KEY} IN (${holes})`, params: groupKeys },
  });
  const matchedRoots = `SELECT DISTINCT i2.root_game_id AS root_id, ${scoped.key} AS gkey ${scoped.sql}`;

  const batched = await db.batch([
    db
      .prepare(
        `${scoped.cte}SELECT k.gkey, r.id, r.name, r.thumbnail_url,
                (SELECT COUNT(*) FROM item x WHERE x.root_game_id = r.id) AS items
           FROM (${matchedRoots}) k
           JOIN item r ON r.id = k.root_id
          ORDER BY lower(COALESCE(r.sort_name, r.name))`,
      )
      .bind(...scoped.params),
    db
      .prepare(
        `${scoped.cte}SELECT k.gkey,
                COALESCE(SUM(CASE WHEN c.status IN ('owned','lent') THEN c.quantity END), 0) AS owned,
                -- Apart, not together: a group card reading "45 wanted" over 22
                -- items was every pledge in the tree counted as a wish.
                COALESCE(SUM(CASE WHEN c.status = 'wanted' THEN c.quantity END), 0) AS wanted,
                COALESCE(SUM(CASE WHEN c.status = 'preordered' THEN c.quantity END), 0) AS preordered,
                COALESCE(SUM(CASE WHEN c.status IN ('owned','lent') AND c.format = 'digital'
                                  THEN c.quantity END), 0) AS digital,
                COALESCE(SUM(CASE WHEN c.status IN ('owned','lent') AND c.format = 'physical'
                                  THEN c.quantity END), 0) AS physical
           FROM (${matchedRoots}) k
           JOIN item it ON it.root_game_id = k.root_id
           JOIN copy c ON c.item_id = it.id
          GROUP BY k.gkey`,
      )
      .bind(...scoped.params),
  ]);

  type MemberRow = {
    gkey: string;
    id: number;
    name: string;
    thumbnail_url: string | null;
    items: number;
  };
  type CopyRowAgg = {
    gkey: string;
    owned: number;
    wanted: number;
    preordered: number;
    digital: number;
    physical: number;
  };

  const memberRows = (batched[0]?.results ?? []) as MemberRow[];
  const copyRows = (batched[1]?.results ?? []) as CopyRowAgg[];

  const groups = new Map<string, CollectionGroup>();
  for (const row of memberRows) {
    // `series:Dice Throne` — split once, because a value may contain a colon.
    const cut = row.gkey.indexOf(':');
    const axis = row.gkey.slice(0, cut) as GroupAxis;
    const name = row.gkey.slice(cut + 1);

    let group = groups.get(row.gkey);
    if (!group) {
      group = {
        key: row.gkey,
        axis,
        name,
        lines: 0,
        items: 0,
        owned: 0,
        wanted: 0,
        preordered: 0,
        digital: 0,
        physical: 0,
        members: [],
      };
      groups.set(row.gkey, group);
    }
    group.lines += 1;
    group.items += row.items;
    group.members.push({
      id: row.id,
      name: row.name,
      items: row.items,
      thumbnailUrl: row.thumbnail_url,
    });
  }

  for (const row of copyRows) {
    const group = groups.get(row.gkey);
    if (!group) continue;
    group.owned = row.owned;
    group.wanted = row.wanted;
    group.preordered = row.preordered;
    group.digital = row.digital;
    group.physical = row.physical;
  }

  return groups;
}

/**
 * Say which child put a tree in the results, when the base game did not.
 *
 * Searching "seafarers" and being handed "Catan" is correct — that is where
 * Seafarers lives — but it reads as a bug unless the row says so. Computed from
 * the trees already in hand rather than re-queried: every item of every returned
 * tree is here, so a second round trip would be asking the database something we
 * just read.
 *
 * A root that accounts for every term on its own gets nothing, because there is
 * nothing to explain.
 */
function attachMatchReasons(roots: ItemNode[], terms: string[]): void {
  if (terms.length === 0) return;

  for (const root of roots) {
    // Only the terms the base game does not account for need explaining.
    // Searching "catan knights", Catan explains "catan" by itself; naming every
    // child with "Catan" in it would bury the one that explains "knights".
    const unexplained = terms.filter((term) => !itemMatchesTerm(root, term));
    if (unexplained.length === 0) continue;

    // The parent travels with each hit. "Scarlet Witch" alone answers half the
    // question a search asks; the other half is which box to pull off the shelf,
    // and the walker already knows it — no second query, and no rename.
    const scored: (MatchedChild & { hits: number })[] = [];
    const walk = (node: ItemNode) => {
      for (const child of node.children) {
        const hits = unexplained.filter((term) => itemMatchesTerm(child, term)).length;
        if (hits > 0) {
          scored.push({
            id: child.id,
            name: child.name,
            parentId: node.id,
            parentName: node.name,
            hits,
          });
        }
        walk(child);
      }
    };
    walk(root);

    // Most of the missing terms first: one child that answers the whole query
    // is a better explanation than three that each answer a word of it.
    scored.sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
    if (scored.length > 0) {
      root.matchedChildren = scored
        .slice(0, MAX_MATCH_REASONS)
        .map(({ id, name, parentId, parentName }) => ({ id, name, parentId, parentName }));
    }
  }
}

export async function getItem(db: D1Database, id: number): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE id = ?`)
    .bind(id)
    .first<ItemRow>();
  return row ? mapItemRow(row) : null;
}

/**
 * How far up a tree the search for an inherited value will walk.
 *
 * The catalog is three deep today (a Dice Throne box → a hero → the hero's
 * playmat), so eight is generous. It is really a cycle guard: `updateItem`
 * refuses to make a loop, but a recursive CTE against a loop that got in by some
 * other route would not stop on its own, and a hung read is a worse failure than
 * a missing publisher.
 */
const MAX_ANCESTOR_DEPTH = 8;

/**
 * The blanks this item can answer from the game it belongs to.
 *
 * Walks up `parent_item_id` and takes, **per field**, the first ancestor that
 * has one — so a hero with a publisher but no publisher site can supply the
 * publisher while the URL comes from the box above it. That per-field
 * independence is why this is not just "read the root".
 *
 * The cover rides along in the same read rather than in a second one. It is not
 * a `DETAIL_FIELD` — the details queue has never asked for a picture and still
 * does not — but it is resolved by the same walk and by the same rule, so
 * fetching the ancestors twice would be paying twice for one answer. The
 * decision itself lives in `inheritCover`, `packages/core/src/covers.ts`.
 *
 * Nothing is written. See `packages/core/src/details.ts` for which fields are
 * eligible and why the list is as short as it is.
 *
 * Costs one read, and only for a child that is actually missing something: a
 * root, or a child with its own publisher and its own art, returns without
 * touching the database.
 */
export async function resolveInheritedDetails(
  db: D1Database,
  item: Item,
): Promise<{ inherited: ItemDetail['inherited']; cover: InheritedDetail | null }> {
  const inherited: ItemDetail['inherited'] = {};
  if (item.parentItemId == null) return { inherited, cover: null };

  const wanted = INHERITED_FIELDS.filter((field) => isBlankDetail(item[field]));
  const wantsCover = isBlankDetail(item.thumbnailUrl);
  if (wanted.length === 0 && !wantsCover) return { inherited, cover: null };

  const { results } = await db
    .prepare(
      `WITH RECURSIVE ancestor(id, parent_item_id, name, publisher, publisher_url,
                               thumbnail_url, depth) AS (
         SELECT id, parent_item_id, name, publisher, publisher_url, thumbnail_url, 0
           FROM item WHERE id = ?1
         UNION ALL
         SELECT p.id, p.parent_item_id, p.name, p.publisher, p.publisher_url,
                p.thumbnail_url, a.depth + 1
           FROM item p JOIN ancestor a ON p.id = a.parent_item_id
          WHERE a.depth < ?2
       )
       SELECT id, name, publisher, publisher_url, thumbnail_url FROM ancestor
        WHERE depth > 0 ORDER BY depth`,
    )
    .bind(item.id, MAX_ANCESTOR_DEPTH)
    .all<{
      id: number;
      name: string;
      publisher: string | null;
      publisher_url: string | null;
      thumbnail_url: string | null;
    }>();

  for (const field of wanted) {
    const column = field === 'publisher' ? 'publisher' : 'publisher_url';
    const source = results.find((row) => !isBlankDetail(row[column]));
    if (!source) continue;
    inherited[field] = {
      value: String(source[column]),
      fromItemId: source.id,
      fromName: source.name,
    };
  }

  const cover = inheritCover(
    item.thumbnailUrl,
    results.map((r) => ({ id: r.id, name: r.name, thumbnailUrl: r.thumbnail_url })),
  );

  return { inherited, cover };
}

/** An ancestor with everything the wishlist may borrow from it. */
interface WishlistLender extends CoverLender {
  publisherUrl: string | null;
}

/**
 * The ancestors of several items at once, nearest first, for lending covers.
 *
 * One read for a whole screen, rather than one per blank row. Used by the
 * wishlist, where a row appears away from its game and there is no tree in hand
 * to walk — 20 of the 25 wanted rows have no art of their own, so a page of
 * empty boxes was the alternative.
 *
 * It now carries `publisher_url` on the same rows, because the wishlist borrows
 * that too: a playmat almost never has a site of its own and its game always
 * does, and `INHERITED_FIELDS` already says a child may take its parent's. One
 * extra column on a query that was already running beats a second walk of the
 * same chain. It stays nearest-first, so `inheritCover` and the publisher
 * fallback agree about which ancestor answered.
 *
 * The single-item read path does not use this: `resolveInheritedDetails` already
 * fetches the same ancestors for the publisher, and takes the cover from that.
 */
async function ancestorCoversFor(
  db: D1Database,
  ids: number[],
): Promise<Map<number, WishlistLender[]>> {
  const byItem = new Map<number, WishlistLender[]>();
  if (ids.length === 0) return byItem;
  const holes = ids.map(() => '?').join(',');

  const { results } = await db
    .prepare(
      `WITH RECURSIVE chain(of_id, cur, depth) AS (
         SELECT id, parent_item_id, 1 FROM item WHERE id IN (${holes})
         UNION ALL
         SELECT c.of_id, p.parent_item_id, c.depth + 1
           FROM chain c JOIN item p ON p.id = c.cur
          WHERE c.depth < ?
       )
       SELECT c.of_id, i.id, i.name, i.thumbnail_url, i.publisher_url, c.depth
         FROM chain c JOIN item i ON i.id = c.cur
        ORDER BY c.of_id, c.depth`,
    )
    .bind(...ids, MAX_ANCESTOR_DEPTH)
    .all<{
      of_id: number;
      id: number;
      name: string;
      thumbnail_url: string | null;
      publisher_url: string | null;
    }>();

  for (const row of results) {
    const list = byItem.get(row.of_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      thumbnailUrl: row.thumbnail_url,
      publisherUrl: row.publisher_url,
    });
    byItem.set(row.of_id, list);
  }
  return byItem;
}

export async function getItemDetail(db: D1Database, id: number): Promise<ItemDetail | null> {
  const item = await getItem(db, id);
  if (!item) return null;

  const batched = await db.batch([
    db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE parent_item_id = ?`)
      .bind(id),
    db.prepare('SELECT * FROM copy WHERE item_id = ?').bind(id),
    db
      .prepare(
        `SELECT ui.user_id, ui.rating, ui.notes, ui.rated_at, u.email, u.display_name
           FROM user_item ui JOIN app_user u ON u.id = ui.user_id
          WHERE ui.item_id = ? ORDER BY u.email`,
      )
      .bind(id),
  ]);

  type RatingRow = {
    user_id: number;
    rating: number | null;
    notes: string | null;
    rated_at: string;
    email: string;
    display_name: string | null;
  };

  const childRows = (batched[0]?.results ?? []) as ItemRow[];
  const ownCopyRows = (batched[1]?.results ?? []) as CopyRow[];
  const ratingRows = (batched[2]?.results ?? []) as RatingRow[];

  const children: ItemNode[] = childRows.map((r) => ({
    ...mapItemRow(r),
    copies: [] as Copy[],
    children: [] as ItemNode[],
  }));

  // One extra pass so a child's copies show on the parent page.
  if (children.length > 0) {
    const ids = children.map((c) => c.id);
    const { results } = await db
      .prepare(`SELECT * FROM copy WHERE item_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<CopyRow>();
    for (const row of results) {
      const copy = mapCopyRow(row);
      children.find((c) => c.id === copy.itemId)?.copies.push(copy);
    }
  }

  const parent = item.parentItemId != null ? await getItem(db, item.parentItemId) : null;

  const ratings: Rating[] = ratingRows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    rating: r.rating,
    notes: r.notes,
    ratedAt: r.rated_at,
  }));

  // Related items — standalone games linked to this one (bidirectional).
  const relatedItems = await getRelatedItems(db, id);

  // The children list on this page is text, not pictures, so it is deliberately
  // left without borrowed covers — there is nowhere for one to show.
  const { inherited, cover } = await resolveInheritedDetails(db, item);

  return {
    ...item,
    inheritedCover: cover,
    parent,
    copies: ownCopyRows.map(mapCopyRow),
    children: children.sort((a, b) => (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name)),
    ratings,
    relatedItems,
    inherited,
  };
}

export async function createItem(db: D1Database, input: CreateItemInput): Promise<Item> {
  let rootGameId: number | null = null;

  // A non-base item without a parent is allowed, and is the whole point of
  // `pending_parent_name`: an expansion can reach the shelf before the game it
  // belongs to. Demanding a parent here is what forced both add flows to save
  // such a thing as a base game, silently losing what it actually was.
  const orphaned = input.kind !== 'base' && input.parentItemId == null;

  if (input.kind !== 'base' && !orphaned) {
    const parent = await getItem(db, input.parentItemId!);
    if (!parent) throw new ItemError('parent item does not exist', 400);
    // Everything inherits the base game at the top of the tree, however deep.
    rootGameId = parent.rootGameId ?? parent.id;
  }

  // `idx_item_bgg` is UNIQUE where bgg_id IS NOT NULL, so scanning a game you
  // already own fails here rather than silently creating a second entry. That is
  // the behaviour we want — but it has to read as "you already have this",
  // not as an internal error.
  if (input.bggId != null) {
    const existing = await db
      .prepare('SELECT id, name FROM item WHERE bgg_id = ?')
      .bind(input.bggId)
      .first<{ id: number; name: string }>();
    if (existing) {
      throw new ItemError(`"${existing.name}" is already in the collection.`, 409);
    }
  }

  const res = await db
    .prepare(
      `INSERT INTO item (bgg_id, kind, parent_item_id, root_game_id, pending_parent_name,
                         name, sort_name, year_published,
                         publisher, publisher_url, source_url, game_system, series,
                         designers, min_players, max_players,
                         playtime_min, weight, thumbnail_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.bggId ?? null,
      input.kind,
      input.kind === 'base' ? null : (input.parentItemId ?? null),
      rootGameId,
      // Only meaningful while parentless: a name to watch for, not a second
      // way of expressing a relationship that already exists.
      orphaned ? (input.pendingParentName || null) : null,
      input.name,
      toSortName(input.name),
      input.yearPublished ?? null,
      input.publisher || null,
      input.publisherUrl || null,
      input.sourceUrl || null,
      input.gameSystem || null,
      input.series || null,
      input.designers || null,
      input.minPlayers ?? null,
      input.maxPlayers ?? null,
      input.playtimeMin ?? null,
      input.weight ?? null,
      input.thumbnailUrl || null,
      input.description || null,
    )
    .run();

  const id = Number(res.meta.last_row_id);

  // A base game is its own root; we only know the id after the insert. An
  // orphan roots itself for the same reason a base game does — every listing
  // query selects by root_game_id, so a null root would make it invisible
  // rather than unattached.
  if (input.kind === 'base' || orphaned) {
    await db.prepare('UPDATE item SET root_game_id = id WHERE id = ?').bind(id).run();
  }

  const created = await getItem(db, id);
  if (!created) throw new ItemError('item vanished immediately after creation', 500);
  return created;
}

/**
 * Hand every waiting orphan to a game that has just arrived.
 *
 * The other half of `pending_parent_name`. Scanning a shelf can turn up
 * "Wingspan: European Expansion" months before Wingspan itself; the expansion
 * waits, named, and is re-parented the moment its base game is created.
 *
 * Matching is on the normalised name rather than a BGG id on purpose — the
 * orphan was read off a spine and usually has no id at all, which is exactly
 * the situation that produced it.
 *
 * Called after every item creation. Cheap: an indexed lookup that almost always
 * returns nothing, against a mistake that is otherwise invisible until someone
 * notices their collection has two Wingspans.
 *
 * ⚠️ **This is only half the mechanism, and on its own it has a hole.** It is
 * triggered by a *game* arriving and asks "who was waiting for me" — so an
 * orphan created *after* its base game already exists is never looked at again,
 * because the creation event that would have found it has already happened. Item
 * 842 sat that way with item 840 sitting right beside it. The reverse question —
 * "does this orphan's parent already exist?" — is `sweepOrphanAdoptions` below.
 */
export async function adoptOrphans(db: D1Database, parent: Item): Promise<Item[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM item
        WHERE parent_item_id IS NULL
          AND pending_parent_name IS NOT NULL
          AND id != ?1
          AND lower(trim(pending_parent_name)) = lower(trim(?2))`,
    )
    .bind(parent.id, parent.name)
    .all<ItemRow>();

  const orphans = results.map(mapItemRow);
  if (orphans.length === 0) return [];

  const newRoot = parent.rootGameId ?? parent.id;

  for (const orphan of orphans) {
    // The orphan may already have grown a tree of its own — an accessory filed
    // under an expansion that was itself waiting. Move the whole subtree, which
    // is identified by the root the orphan was standing in for.
    await db.batch([
      db
        .prepare('UPDATE item SET root_game_id = ?1 WHERE root_game_id = ?2')
        .bind(newRoot, orphan.id),
      db
        .prepare(
          `UPDATE item
              SET parent_item_id = ?1, pending_parent_name = NULL,
                  updated_at = datetime('now')
            WHERE id = ?2`,
        )
        .bind(parent.id, orphan.id),
    ]);
  }

  const adopted = await Promise.all(orphans.map((o) => getItem(db, o.id)));
  return adopted.filter((i): i is Item => i !== null);
}

const UPDATABLE: Record<keyof UpdateItemInput, string> = {
  name: 'name',
  kind: 'kind',
  // Editable so a game added by hand can be linked to BGG later, and so a wrong
  // match from a scan can be corrected rather than requiring a delete.
  bggId: 'bgg_id',
  parentItemId: 'parent_item_id',
  pendingParentName: 'pending_parent_name',
  yearPublished: 'year_published',
  publisher: 'publisher',
  publisherUrl: 'publisher_url',
  sourceUrl: 'source_url',
  gameSystem: 'game_system',
  series: 'series',
  designers: 'designers',
  minPlayers: 'min_players',
  maxPlayers: 'max_players',
  playtimeMin: 'playtime_min',
  weight: 'weight',
  thumbnailUrl: 'thumbnail_url',
  description: 'description',
};

/**
 * How far the loop and subtree walks are allowed to run.
 *
 * Deliberately far larger than `MAX_ANCESTOR_DEPTH`, which bounds the *read*
 * paths at 8. A guard that stopped where the readers stop could wave through a
 * loop nine levels up and leave the readers to meet it, which is the one
 * outcome this is here to prevent. 64 is free — it is 64 index lookups on a
 * catalog whose deepest tree is three.
 */
const MAX_TREE_WALK = 64;

/**
 * Would making `candidateParentId` the parent of `id` close a loop?
 *
 * Walks the candidate's own ancestors and looks for `id` among them. That is
 * the question, and the old test could not ask it: it compared
 * `parent.rootGameId === id`, which only detects a loop when `id` is itself the
 * root of its tree. Filing an *expansion* under one of its own accessories
 * passed cleanly and produced a real cycle — measured, before this existed, on
 * a three-item test tree.
 *
 * The damage is quiet rather than loud, which is why it survived. Every read
 * path caps its recursion, so nothing hangs; instead the looped rows stop being
 * reachable from their root and simply vanish out of the collection page while
 * still sitting in the table.
 *
 * `UNION` rather than `UNION ALL` so that a tree which is *already* cyclic —
 * one made before this guard existed — is answered rather than walked for ever.
 */
async function wouldLoop(
  db: D1Database,
  id: number,
  candidateParentId: number,
): Promise<boolean> {
  const hit = await db
    .prepare(
      `WITH RECURSIVE chain(id, parent_item_id, depth) AS (
         SELECT id, parent_item_id, 0 FROM item WHERE id = ?1
         UNION
         SELECT p.id, p.parent_item_id, c.depth + 1
           FROM item p JOIN chain c ON p.id = c.parent_item_id
          WHERE c.depth < ?3
       )
       SELECT 1 AS hit FROM chain WHERE id = ?2 LIMIT 1`,
    )
    .bind(candidateParentId, id, MAX_TREE_WALK)
    .first<{ hit: number }>();
  return hit != null;
}

/**
 * Move a whole subtree onto a new root.
 *
 * `root_game_id` is not decoration: every listing, grouping, filter and count
 * in this file selects on it, so a row whose root is stale is a row in the
 * wrong tree. Re-parenting used to set it on the moved item alone and leave its
 * children pointing at wherever they used to live — invisible until a game with
 * expansions under it was filed somewhere else and the expansions stayed
 * behind.
 *
 * `adoptOrphans` gets away with `WHERE root_game_id = <orphan>` because an
 * orphan is always a root and so owns its whole subtree's root value. That is
 * not true here — the item being moved may be halfway down a tree it shares
 * with unrelated branches — so the descendants are walked by parent link
 * instead. `UNION` terminates on a pre-existing cycle.
 */
async function retargetSubtreeRoot(
  db: D1Database,
  id: number,
  newRoot: number,
): Promise<void> {
  await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ?1
         UNION
         SELECT i.id FROM item i JOIN sub s ON i.parent_item_id = s.id
       )
       UPDATE item SET root_game_id = ?2 WHERE id IN (SELECT id FROM sub)`,
    )
    .bind(id, newRoot)
    .run();
}

export async function updateItem(
  db: D1Database,
  id: number,
  input: UpdateItemInput,
): Promise<Item | null> {
  const existing = await getItem(db, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE) as [keyof UpdateItemInput, string][]) {
    if (!(key in input)) continue;
    const value = input[key];
    sets.push(`${column} = ?`);
    params.push(value === '' ? null : (value ?? null));
    if (key === 'name' && typeof value === 'string') {
      sets.push('sort_name = ?');
      params.push(toSortName(value));
    }
  }

  /*
    The root the moved subtree lands on. Held until after the row is written,
    because it applies to the item's descendants too and so cannot be expressed
    as one more `SET` on this statement. Null means "the parent is not changing".
  */
  let newRoot: number | null = null;

  if (input.parentItemId !== undefined) {
    // The kind and the place in the tree have to be decided together. A base
    // game is the top of its own tree by definition, so one with a parent is a
    // contradiction the reader has no way to render — and `createItem` has
    // always refused it. `RetagPage` and the related-games section both send
    // the two fields in one patch, which is the shape this asks for.
    const kind = 'kind' in input ? input.kind : existing.kind;
    if (kind === 'base' && input.parentItemId != null) {
      throw new ItemError(
        'a base game sits at the top of its own tree — say what it becomes (expansion, accessory, promo or upgrade) in the same change',
        400,
      );
    }

    if (input.parentItemId === id) throw new ItemError('an item cannot be its own parent', 400);
    if (input.parentItemId == null) {
      // Detached: it roots itself, exactly as a base game or a fresh orphan
      // does. Every listing query selects by root, so a null root would make it
      // invisible rather than merely unattached.
      newRoot = id;
    } else {
      const parent = await getItem(db, input.parentItemId);
      if (!parent) throw new ItemError('parent item does not exist', 400);
      if (await wouldLoop(db, id, input.parentItemId)) {
        throw new ItemError(
          `"${parent.name}" is already filed under "${existing.name}" — that would make the tree a loop`,
          400,
        );
      }
      newRoot = parent.rootGameId ?? parent.id;
      // Attaching a parent by hand answers the question the pending name was
      // holding open, so it stops being true. Leaving it would keep the item
      // eligible for adoption by a second game with the same name.
      if (!('pendingParentName' in input)) sets.push('pending_parent_name = NULL');
    }
  }

  if (sets.length === 0) return existing;

  /*
    A cover being replaced is recorded as a printing before it goes.

    This is the only place an item's `thumbnail_url` changes, so it is the only
    place that can make the guarantee: the picker offers you the cover you had,
    whichever one you swap to. Left to the campaign backfill, the guarantee
    would hold only for covers that existed the last time somebody remembered to
    run it — and a Kickstarter image, once unreferenced, is gone. The cost is one
    read and one conditional insert on the rare update that touches the cover.
  */
  if (
    'thumbnailUrl' in input &&
    existing.thumbnailUrl &&
    (input.thumbnailUrl || null) !== existing.thumbnailUrl
  ) {
    await preserveDisplacedCover(db, id, existing.thumbnailUrl);
  }

  sets.push(`updated_at = datetime('now')`);
  params.push(id);

  await db.prepare(`UPDATE item SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

  // After the move, not with it: the new root belongs to everything under this
  // item as well, and a subtree cannot be updated by the statement that changes
  // one row. Safe to walk now — the loop guard above has already refused any
  // parent that would make this walk unbounded.
  if (newRoot !== null) await retargetSubtreeRoot(db, id, newRoot);

  return getItem(db, id);
}

/**
 * Separators that mean "…and the rest of this name is the sub-title".
 *
 * En dash and em dash are written as `\u` escapes rather than as themselves:
 * rewriting a source file through this project's shell has mangled those two
 * characters before, and the result typechecked, built and deployed clean. A
 * mangled dash in a comment is cosmetic; one in this character class would fail
 * silently by simply never matching, which is the worst kind of bug this file
 * can have.
 */
const TITLE_SEPARATOR = /:|\s[-\u2013\u2014]\s/g;

/**
 * The names an unfiled item's own title claims it belongs to, most specific
 * first.
 *
 * "Dice Throne: Season Two: Battle Chest" yields *Dice Throne: Season Two* then
 * *Dice Throne* — the longer prefix is tried first, so a box lands under the set
 * it actually names rather than the line's root. A title with no separator
 * yields nothing at all, which is the right answer: it has made no claim.
 */
function claimedParentNames(name: string): string[] {
  const out: string[] = [];
  TITLE_SEPARATOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TITLE_SEPARATOR.exec(name)) !== null) {
    const prefix = name.slice(0, match.index).trim();
    if (prefix) out.push(prefix);
  }
  return out.reverse();
}

/** What the orphan's claim to a parent was made of. */
export type OrphanMatchBasis = 'pending' | 'title';

export interface OrphanAdoption {
  itemId: number;
  itemName: string;
  parentId: number;
  parentName: string;
  via: OrphanMatchBasis;
}

export interface OrphanSweepRun {
  /** Parentless non-base rows carrying a `pending_parent_name`. */
  waiting: number;
  /** Parentless expansion/promo/upgrade rows that have lost even that. */
  unfiled: number;
  adopted: number;
  /** Two or more items answered to the name, so nobody got it. */
  contested: number;
  /** Nothing in the catalog answered to the name. Left exactly as it was. */
  unmatched: number;
  /** The only match was inside the orphan's own subtree. */
  looped: number;
  adoptions: OrphanAdoption[];
}

/**
 * The reverse of `adoptOrphans`: for each orphan, does its parent already exist?
 *
 * `adoptOrphans` is game-first — it fires when a base game is created and
 * collects whoever was waiting for *that* name. That can only ever reunite an
 * orphan that was created **first**. An orphan created after its parent has
 * already missed its one trigger and will wait for ever: item 842 "Tiny Epic
 * Dungeons Adventures: The Phantom Voyage" sat as a parentless expansion with
 * `pending_parent_name = 'Tiny Epic Dungeons Adventures'` while item 840, of
 * exactly that name, sat beside it. Running the old sweep more often would not
 * have found it — there was no creation event left to run it on.
 *
 * ## Two populations, and they are not the same thing
 *
 * | | matched on | why |
 * |---|---|---|
 * | `pending_parent_name` set | that name | a human or a scan **asserted** which game this belongs to |
 * | parentless expansion / promo / upgrade | its own title's prefix | the row has asserted nothing; the box's name is all there is |
 *
 * **`accessory` is deliberately absent from the second population**, matching
 * `BELONGS_TO_A_GAME` in `ItemTree.tsx`. Items 117 and 118 (Excursion Tiles 1 and
 * 2) and item 372 (the Pangea gaming table) are standalone on purpose and must
 * not be filed under anything. An accessory that *does* carry a pending name is
 * in the first population and is adopted, because there the intent was recorded.
 *
 * ## Matching is exact after normalising, and nothing else
 *
 * This runs unattended, which puts it in the scanner's risk class rather than
 * the search box's: nobody is looking at the result, so a confident wrong answer
 * is permanent. So there is **no similarity threshold and no fuzzy fallback** —
 * `normaliseTitle`, the scanner's fold, applied to both sides, then string
 * equality. (Note it folds `Player’s` to `player s` with a space; that is not
 * `foldSearchText`, which drops the apostrophe entirely. The two are deliberately
 * different and must not be conflated.)
 *
 * **If two items answer to the name, nobody gets the orphan.** Same rule as the
 * alias index in `buildTitleIndex` and the fragment rule in `isConfidentMatch`,
 * both of which exist because loose unattended matching in this codebase has
 * produced confident wrong answers before.
 *
 * A candidate parent must itself be **properly filed** — a base game, or a
 * non-base row that has a parent. Adopting an orphan onto another orphan would
 * move the problem rather than solve it.
 *
 * ## Re-parenting goes through `updateItem`, on purpose
 *
 * Not a second parent-setting path. `updateItem` already carries `wouldLoop`
 * (an orphan may have grown children, and one of them may be the thing whose
 * name matched), `retargetSubtreeRoot` (the adopted row's whole subtree has to
 * follow it onto the new root) and the clearing of `pending_parent_name`. A
 * loop is caught there and counted here rather than thrown.
 *
 * `itemId` narrows the sweep to one row — that is the inline call on item
 * creation. Without it the whole catalog is swept, which is the half-hourly
 * cron. One implementation, so the cron proves the inline path and vice versa.
 */
export async function sweepOrphanAdoptions(
  db: D1Database,
  opts: { itemId?: number | null } = {},
): Promise<OrphanSweepRun> {
  const only = opts.itemId ?? null;

  const run: OrphanSweepRun = {
    waiting: 0,
    unfiled: 0,
    adopted: 0,
    contested: 0,
    unmatched: 0,
    looped: 0,
    adoptions: [],
  };

  const { results: orphanRows } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM item
        WHERE parent_item_id IS NULL
          AND kind != 'base'
          AND ( (pending_parent_name IS NOT NULL AND trim(pending_parent_name) != '')
                OR kind IN ('expansion', 'promo', 'upgrade') )
          AND (?1 IS NULL OR id = ?1)
        ORDER BY id`,
    )
    .bind(only)
    .all<ItemRow>();

  const orphans = orphanRows.map(mapItemRow);
  for (const orphan of orphans) {
    if (orphan.pendingParentName?.trim()) run.waiting += 1;
    else run.unfiled += 1;
  }
  if (orphans.length === 0) return run;

  /*
    The candidate side is folded in JS, not SQL, because `normaliseTitle` strips
    diacritics and punctuation and expands `&` — none of which SQLite can express
    without a custom collation. `listItemNames` fetches the whole catalog for the
    same reason and with the same justification: a household catalog is hundreds
    of short rows, so this is one cheap read, and it is only read at all once an
    orphan actually exists to match.
  */
  const { results: candidateRows } = await db
    .prepare(
      `SELECT id, name FROM item
        WHERE kind = 'base' OR parent_item_id IS NOT NULL`,
    )
    .all<{ id: number; name: string }>();

  const byName = new Map<string, { id: number; name: string }[]>();
  for (const row of candidateRows) {
    const key = normaliseTitle(row.name);
    if (key.length < 2) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(row);
    else byName.set(key, [row]);
  }

  for (const orphan of orphans) {
    const pending = orphan.pendingParentName?.trim() ?? '';
    const via: OrphanMatchBasis = pending ? 'pending' : 'title';
    const claims = pending ? [pending] : claimedParentNames(orphan.name);

    // First claim that anything answers to at all decides the outcome — a
    // shorter prefix is a *less* specific claim, so falling through to one after
    // a contested hit would be a way of routing around the ambiguity.
    let matches: { id: number; name: string }[] | undefined;
    for (const claim of claims) {
      const key = normaliseTitle(claim);
      if (key.length < 2) continue;
      matches = byName.get(key);
      if (matches) break;
    }

    if (!matches) {
      run.unmatched += 1;
      continue;
    }
    if (matches.length > 1) {
      run.contested += 1;
      continue;
    }

    const parent = matches[0]!;
    try {
      const moved = await updateItem(db, orphan.id, { parentItemId: parent.id });
      if (!moved) {
        run.unmatched += 1;
        continue;
      }
    } catch (err) {
      // The only match was one of the orphan's own descendants. Left alone.
      if (err instanceof ItemError) {
        run.looped += 1;
        continue;
      }
      throw err;
    }

    run.adopted += 1;
    run.adoptions.push({
      itemId: orphan.id,
      itemName: orphan.name,
      parentId: parent.id,
      parentName: parent.name,
      via,
    });
  }

  return run;
}

/** Cascades to children, copies, ratings and findings via foreign keys. */
export async function deleteItem(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM item WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Every item's name, for matching titles read off a shelf photo.
 *
 * Deliberately fetches the lot and matches in JS rather than issuing one query
 * per title. A household catalog is hundreds of rows, not millions, so this is
 * a single cheap read — and it allows the normalising comparison in
 * `matchShelfTitles` (punctuation, articles, subtitle splits), which SQLite
 * cannot express without a custom collation.
 */
export async function listItemNames(
  db: D1Database,
): Promise<{ id: number; name: string; kind: string }[]> {
  const { results } = await db
    .prepare('SELECT id, name, kind FROM item ORDER BY id')
    .all<{ id: number; name: string; kind: string }>();
  return results;
}

const DETAIL_COLUMN: Record<DetailField, string> = {
  publisher: 'publisher',
  publisherUrl: 'publisher_url',
  yearPublished: 'year_published',
  minPlayers: 'min_players',
  playtimeMin: 'playtime_min',
  description: 'description',
};

/** Mirrors `isBlankDetail`. `trim()` on an integer yields its digits, never ''. */
const blankSql = (column: string) => `(${column} IS NULL OR trim(${column}) = '')`;

/** `game_system` set, or not. The second of the three columns the policy reads. */
const HAS_SYSTEM_SQL = `NOT ${blankSql('game_system')}`;

/**
 * The third: a publisher field that says *there is no publisher*.
 *
 * ⚠️ **Mirrors `isTraditionalPublisher`** in `packages/core/src/details.ts` and
 * must keep mirroring it — the spellings live there, in `NO_PUBLISHER_EXISTS`,
 * and this is the same closed set written as SQL. `IFNULL` first so a NULL
 * publisher is plainly false rather than NULL, which `NOT` would swallow and
 * quietly drop every unresearched row out of the queue.
 */
const TRADITIONAL_SQL = `lower(trim(IFNULL(publisher, ''))) IN ('traditional', 'public domain', '(public domain)')`;

/**
 * The gap test of `detailGaps`, as SQL, generated rather than restated.
 *
 * The policy lives in `packages/core/src/details.ts` and this builds a `WHERE`
 * clause out of it, so adding a kind, or changing what a kind owes, or deciding
 * a rulebook has no playing time, moves the queue and the item page together.
 * Kind names are interpolated, which is safe only because they come from the
 * frozen `ITEM_KINDS` and never from a request.
 *
 * `gapFilter` narrows which fields count as a gap and is what layer 3 uses: a
 * field the last completed run already asked about and could not find is not a
 * reason to queue the row again.
 */
function detailGapsSql(gapFilter?: (field: DetailField) => string): string {
  const branches = detailGapBranches().map(({ kind, hasSystem, traditional, fields }) => {
    const gaps = fields
      .map((field) => {
        const blank = blankSql(DETAIL_COLUMN[field]);
        return gapFilter ? `(${blank} AND ${gapFilter(field)})` : blank;
      })
      .join(' OR ');
    const system = hasSystem ? HAS_SYSTEM_SQL : blankSql('game_system');
    const folk = traditional ? TRADITIONAL_SQL : `NOT ${TRADITIONAL_SQL}`;
    return `(kind = '${kind}' AND ${system} AND ${folk} AND (${gaps}))`;
  });
  return `parent_item_id IS NULL AND (${branches.join('\n            OR ')})`;
}

/**
 * The most recent completed details run for the row being tested.
 *
 * A correlated subquery rather than a join, because the whole predicate below is
 * "is there a reason to ask again", and that reads as one question about one
 * row. `status = 'done'` only: an `error` run bought nothing and must never
 * strand a row — that is the failure direction that would leave a game blank
 * forever over one dropped connection.
 */
const LAST_DONE_RUN = `(
        SELECT r.id FROM research_run r
         WHERE r.item_id = item.id AND r.tier = 'details' AND r.status = 'done'
         ORDER BY r.id DESC LIMIT 1
      )`;

/**
 * Has anything changed since that run that could change the answer?
 *
 * The four inputs recorded by migration 0020, compared against the row as it is
 * now. Costs a comparison and no tokens, which is the entire point: it turns
 * "asked and found nothing" from *nothing exists* into *nothing existed then*.
 *
 * A NULL recorded input reads as changed. Rows written before 0020 have all four
 * NULL, so the first pass after this ships re-opens them — the safe direction,
 * since re-asking costs 1.4¢ and never asking again costs a game that stays
 * blank forever.
 */
const INPUTS_CHANGED = `(
        run.input_owned IS NULL
     OR run.input_name IS NULL
     OR run.input_name <> item.name
     OR (run.input_owned = 0 AND EXISTS (
           SELECT 1 FROM copy c WHERE c.item_id = item.id AND c.status = 'owned'
        ))
     OR IFNULL(run.input_bgg_id, -1) <> IFNULL(item.bgg_id, -1)
     OR IFNULL(run.input_year, -1)   <> IFNULL(item.year_published, -1)
      )`;

/**
 * The whole "is this worth asking about" test.
 *
 * Three layers, and they compose in this order because that is their order of
 * value:
 *
 * 1. **Never ask what cannot exist.** `detailGapsSql` reads `kind`,
 *    `game_system` and `publisher`, so a rulebook is not asked for a player
 *    count it does not have and a folk game is not asked who published it.
 * 2. **Do not re-ask unless an input changed.** A completed run excludes the
 *    row until one of the four recorded inputs differs.
 * 3. **Per field, not per item.** The exclusion covers only the fields that run
 *    asked about and did not find. A gap it never asked about — because the
 *    policy has since changed, or because someone cleared a field — still
 *    queues the row, and only for that field.
 *
 * Layer 3 rides inside layer 1's generator via `gapFilter`, which is why the
 * fields are not restated here either.
 */
function needsDetailsSql(): string {
  const notAlreadyAnswered = (field: DetailField) =>
    `instr(IFNULL(run.unfilled, ''), ',${field},') = 0`;

  return `${detailGapsSql()}
        AND NOT EXISTS (
          SELECT 1 FROM research_run run
           WHERE run.id = ${LAST_DONE_RUN}
             AND NOT ${INPUTS_CHANGED}
             AND NOT (${detailGapsSql(notAlreadyAnswered)})
        )`;
}

/**
 * The rows worth paying to research, and nothing else.
 *
 * The queue for enrichment, at roughly 1.4¢ of Claude usage a row. It used to
 * ask every row in the catalog for the same six facts, which against a real
 * collection meant **694 of 736 items — only 79 of them top-level.** The other
 * 615 were expansions, promos and playmats, so most of that bill was for
 * answering "who publishes the Dice Throne Vanguard dice tray" one tray at a
 * time.
 *
 * Five rules cut it to a fraction of that. Two are about the record:
 *
 * 1. **Anything with a parent is skipped entirely.** Publisher and publisher
 *    site are read through from the nearest ancestor that has them
 *    (`resolveInheritedDetails`), so they are not gaps; the rest — year, player
 *    count, playing time, description — describe a game being played and are
 *    not asked of a sleeve pack at all. And when an ancestry genuinely has no
 *    publisher, the fix is to research the *root*, once, which then answers for
 *    all fifty-three of its children.
 * 2. **A parentless non-base row is asked only for the inheritable fields.**
 *    That is an orphan expansion waiting for its game, or one of the three
 *    genuinely standalone accessories in the catalog. Neither has a player
 *    count worth buying.
 *
 * The other three are `needsDetailsSql` above: never ask what cannot exist,
 * do not re-ask unless an input changed, and exclude per field rather than per
 * item. Read that comment before changing anything here.
 *
 * Ordered by `sort_name` so a run works down the list in the order the
 * collection page shows it.
 */
export async function listItemsNeedingDetails(
  db: D1Database,
  limit = 200,
): Promise<Item[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM item
        WHERE ${needsDetailsSql()}
        ORDER BY sort_name
        LIMIT ?`,
    )
    .bind(limit)
    .all<ItemRow>();
  return results.map(mapItemRow);
}

/**
 * How long that queue is, without building it.
 *
 * For the nav, which draws the "Missing details" link only when there is
 * something behind it. Literally the same predicate as the list — one call to
 * `needsDetailsSql`, not a second copy of the rules — so the number on the link
 * and the rows on the page cannot disagree. A `LIMIT`-less `COUNT(*)`, because
 * the link counts the whole queue and not the page of it a run works through.
 */
export async function countItemsNeedingDetails(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM item WHERE ${needsDetailsSql()}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Everything marked `wanted`, one row per copy.
 *
 * A separate query rather than an option on `matchingRootsSql`, and the
 * difference is the whole point of the screen. That helper matches whole game
 * *trees* so that searching for an expansion also surfaces its base game —
 * correct for browsing, and exactly wrong for a shopping list. The Ark Nova
 * tree holds two wanted items sitting alongside eight preordered 3D upgrades,
 * so `?status=wanted` on the collection page returns all ten. This returns the
 * two.
 *
 * `preordered` is deliberately not included: it is something already bought and
 * waiting for the post, which is a different question from what to buy next.
 *
 * The join to the parent is what lets a row read as "Marine Worlds, expansion
 * of Ark Nova" rather than as a game nobody has heard of. The second join, to
 * the *root*, is what the page groups on: eight X-Men playmats hang off eight
 * different hero boxes, so grouping on the parent would make eight sections of
 * one row apiece. Rows come back in root order so a group is contiguous.
 */
export async function listWishlist(db: D1Database): Promise<WishlistEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id            AS copy_id,
              c.quantity      AS quantity,
              c.notes         AS notes,
              c.created_at    AS added_at,
              i.id            AS item_id,
              i.name          AS name,
              i.kind          AS kind,
              i.thumbnail_url AS thumbnail_url,
              i.publisher     AS publisher,
              i.year_published AS year_published,
              i.min_players   AS min_players,
              i.max_players   AS max_players,
              i.bgg_id        AS bgg_id,
              i.publisher_url AS publisher_url,
              i.source_url    AS source_url,
              p.id            AS parent_item_id,
              p.name          AS parent_name,
              g.id            AS root_game_id,
              g.name          AS root_game_name
         FROM copy c
         JOIN item i ON i.id = c.item_id
         LEFT JOIN item p ON p.id = i.parent_item_id
         LEFT JOIN item g ON g.id = COALESCE(i.root_game_id, i.id)
        WHERE c.status = 'wanted'
        ORDER BY COALESCE(g.sort_name, g.name, i.sort_name, i.name), i.sort_name, c.id`,
    )
    .all<{
      copy_id: number;
      quantity: number | null;
      notes: string | null;
      added_at: string;
      item_id: number;
      name: string;
      kind: string;
      thumbnail_url: string | null;
      publisher: string | null;
      year_published: number | null;
      min_players: number | null;
      max_players: number | null;
      bgg_id: number | null;
      publisher_url: string | null;
      source_url: string | null;
      parent_item_id: number | null;
      parent_name: string | null;
      root_game_id: number | null;
      root_game_name: string | null;
    }>();

  // A wanted row rarely has art of its own — it is a thing nobody has bought
  // yet. One extra read lends each of them its game's cover; the row already
  // names its parent beside the picture, so whose art it is stays legible.
  //
  // Asked for every row now, not only the coverless ones, because the same walk
  // answers "whose publisher site does this playmat use" — 20 of the 25 rows
  // have no site of their own and every one of their games does. `inheritCover`
  // still returns null for a row that has its own art, so nothing about the
  // covers changed.
  const ancestors = await ancestorCoversFor(
    db,
    results
      .filter((r) => isBlankDetail(r.thumbnail_url) || isBlankDetail(r.publisher_url))
      .map((r) => r.item_id),
  );

  return results.map((r) => {
    const chain = ancestors.get(r.item_id) ?? [];
    const lender = isBlankDetail(r.publisher_url)
      ? chain.find((a) => !isBlankDetail(a.publisherUrl))
      : undefined;
    return {
      copyId: r.copy_id,
      itemId: r.item_id,
      name: r.name,
      kind: r.kind as WishlistEntry['kind'],
      parentItemId: r.parent_item_id,
      parentName: r.parent_name,
      // Self for a root, so the page always has something to group on.
      rootGameId: r.root_game_id ?? r.item_id,
      rootGameName: r.root_game_name ?? r.name,
      thumbnailUrl: r.thumbnail_url,
      inheritedCover: inheritCover(r.thumbnail_url, chain),
      publisherUrl: r.publisher_url,
      inheritedPublisherUrl: lender
        ? {
            value: lender.publisherUrl as string,
            fromItemId: lender.id,
            fromName: lender.name,
          }
        : null,
      sourceUrl: r.source_url,
      publisher: r.publisher,
      yearPublished: r.year_published,
      minPlayers: r.min_players,
      maxPlayers: r.max_players,
      bggId: r.bgg_id,
      quantity: r.quantity ?? 1,
      notes: r.notes,
      addedAt: toIso(r.added_at),
    };
  });
}

/**
 * How far below the item asked about the arrivals walk will go.
 *
 * The same guard, for the same reason, as `MAX_ANCESTOR_DEPTH` one direction
 * up: `updateItem` refuses to make a loop, but a recursive CTE meeting one that
 * arrived by another route would not stop on its own, and a hung read is worse
 * than a short list. Deliberately the same number — a tree is as deep read from
 * either end.
 */
const MAX_SUBTREE_DEPTH = MAX_ANCESTOR_DEPTH;

/**
 * Everything under this item that is paid for and not yet here.
 *
 * The list behind "mark this preorder as arrived". A pledge does not turn up as
 * one row: the game, four expansions and six accessories are eleven copies
 * across three levels of the tree, and confirming them one at a time is the
 * thing the owner asked to stop doing.
 *
 * **Subtree, not root tree.** `root_game_id` would have been the cheaper join
 * and is wrong here — a game can hold two pledges at once (a base game bought
 * years ago, an expansion wave still in the post), and confirming one must not
 * offer up the other. Walking `parent_item_id` down from the item asked about
 * scopes the question to the branch the person is looking at.
 *
 * Returns `null` when there is no such item, so the caller can tell "nothing on
 * preorder" from "no such game" — an empty array is a real answer.
 *
 * Nothing is written. Flipping a row is an ordinary `PATCH /api/copies/:id`;
 * this endpoint decides *what to offer*, never what to do with it.
 */
export async function listPreorderArrivals(
  db: D1Database,
  id: number,
): Promise<PreorderArrival[] | null> {
  const exists = await db.prepare('SELECT 1 FROM item WHERE id = ?').bind(id).first();
  if (!exists) return null;

  const { results } = await db
    .prepare(
      `WITH RECURSIVE sub(id, depth) AS (
         SELECT ?1, 0
         UNION ALL
         SELECT i.id, s.depth + 1
           FROM item i JOIN sub s ON i.parent_item_id = s.id
          WHERE s.depth < ?2
       )
       SELECT c.id            AS copy_id,
              c.quantity      AS quantity,
              c.format        AS format,
              c.notes         AS notes,
              c.created_at    AS added_at,
              s.depth         AS depth,
              i.id            AS item_id,
              i.name          AS name,
              i.kind          AS kind,
              p.id            AS parent_item_id,
              p.name          AS parent_name
         FROM sub s
         JOIN item i ON i.id = s.id
         JOIN copy c ON c.item_id = i.id AND c.status = 'preordered'
         LEFT JOIN item p ON p.id = i.parent_item_id
        ORDER BY s.depth, COALESCE(i.sort_name, i.name), c.id`,
    )
    .bind(id, MAX_SUBTREE_DEPTH)
    .all<{
      copy_id: number;
      quantity: number | null;
      format: string | null;
      notes: string | null;
      added_at: string;
      depth: number;
      item_id: number;
      name: string;
      kind: string;
      parent_item_id: number | null;
      parent_name: string | null;
    }>();

  return results.map((r) => ({
    copyId: r.copy_id,
    itemId: r.item_id,
    name: r.name,
    kind: r.kind as PreorderArrival['kind'],
    depth: r.depth,
    parentItemId: r.parent_item_id,
    parentName: r.parent_name,
    quantity: r.quantity ?? 1,
    format: (r.format as PreorderArrival['format']) ?? 'physical',
    notes: r.notes,
    addedAt: toIso(r.added_at),
  }));
}

/** Top-level items and their kinds — the input to a re-tagging pass. */
export async function listTopLevelItems(
  db: D1Database,
): Promise<{ id: number; name: string; kind: string; parentItemId: number | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, kind, parent_item_id FROM item
        WHERE parent_item_id IS NULL ORDER BY sort_name`,
    )
    .all<{ id: number; name: string; kind: string; parent_item_id: number | null }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    parentItemId: r.parent_item_id,
  }));
}

/** One series or one ruleset in use, and how much of the catalog claims it. */
export interface GroupOption {
  axis: GroupAxis;
  name: string;
  /** Rows carrying the value itself. 147 for Dice Throne, 79 for D&D 5e. */
  items: number;
  /** Top-level lines those rows sit in. 11 and 9 respectively. */
  lines: number;
}

/**
 * The series and rulesets actually in use, for the filter and the group cards.
 *
 * Built from the values in the columns rather than from a constant, because both
 * are deliberately free text — an enum would have to be edited every time a book
 * from a new system or a box from a new line arrived, and would then be a second
 * place for the truth to live.
 *
 * **`lines` is the number worth reading.** 79 rows need D&D 5e and they sit in
 * *nine* separate trees: 53 books inside D&D, and 26 third-party products
 * catalogued as their own lines because they `require` the Player's Handbook
 * rather than being part of it. That split is correct and is not going to be
 * fixed by re-parenting, which is exactly why the filter has to reach across it.
 *
 * Empty for a collection of board games with no series recorded, and the filter
 * then does not appear at all.
 */
export async function listGroupOptions(db: D1Database): Promise<GroupOption[]> {
  const { results } = await db
    .prepare(
      `SELECT 'series' AS axis, series AS name,
              COUNT(*) AS items, COUNT(DISTINCT root_game_id) AS lines
         FROM item
        WHERE series IS NOT NULL AND trim(series) != ''
        GROUP BY series
       UNION ALL
       SELECT 'system' AS axis, game_system AS name,
              COUNT(*) AS items, COUNT(DISTINCT root_game_id) AS lines
         FROM item
        WHERE game_system IS NOT NULL AND trim(game_system) != ''
        GROUP BY game_system
        ORDER BY items DESC, name`,
    )
    .all<{ axis: string; name: string; items: number; lines: number }>();

  return results.map((r) => ({
    axis: r.axis as GroupAxis,
    name: r.name,
    items: r.items,
    lines: r.lines,
  }));
}

export async function collectionStats(db: D1Database): Promise<{
  baseGames: number;
  expansions: number;
  accessories: number;
  totalItems: number;
  ownedCopies: number;
  /**
   * Things we might buy — **rows, not units**, and separate from `preordered`.
   *
   * These two were one number, `wanted + preordered` summed over `quantity`,
   * and it read 262 on the home screen while `/wishlist` listed 25 things. Both
   * were internally right and they described different sets under one word:
   * 236 of the 262 were pledges already paid for, which is not a shopping list.
   * A pre-order drowning the wishlist twelve to one makes both useless.
   *
   * Rows rather than `SUM(quantity)` because this figure **links to
   * `/wishlist`**, and that page counts rows — "25 games wanted", with a `×2`
   * against the one entry we want two of. `ownedCopies` next door is still
   * units, and that is not an inconsistency to tidy away: nothing links to it,
   * and "how many boxes do I own" really is a different question from "how many
   * lines are on my list". A number that links somewhere must count what the
   * place it links to counts, or this recurs.
   */
  wantedEntries: number;
  /** Paid for and on its way. Not a wishlist entry, and never was. */
  preorderedEntries: number;
  duplicatedItems: number;
  /** Licences rather than objects — the D&D Beyond half of the shelf. */
  digitalCopies: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM item WHERE kind = 'base')                     AS base_games,
         (SELECT COUNT(*) FROM item WHERE kind = 'expansion')                AS expansions,
         (SELECT COUNT(*) FROM item WHERE kind IN ('accessory','promo','upgrade')) AS accessories,
         (SELECT COUNT(*) FROM item)                                         AS total_items,
         (SELECT COALESCE(SUM(quantity), 0) FROM copy
           WHERE status IN ('owned','lent'))                                 AS owned_copies,
         -- COUNT, not SUM(quantity): these two are list lengths, and the
         -- wishlist page they link to counts rows. See the doc comment above.
         (SELECT COUNT(*) FROM copy WHERE status = 'wanted')                 AS wanted_entries,
         (SELECT COUNT(*) FROM copy WHERE status = 'preordered')             AS preordered_entries,
         (SELECT COUNT(*) FROM (
            SELECT item_id FROM copy WHERE status IN ('owned','lent')
             GROUP BY item_id HAVING SUM(quantity) > 1))                     AS duplicated_items,
         (SELECT COALESCE(SUM(quantity), 0) FROM copy
           WHERE format = 'digital' AND status IN ('owned','lent'))          AS digital_copies`,
    )
    .first<{
      base_games: number;
      expansions: number;
      accessories: number;
      total_items: number;
      owned_copies: number;
      wanted_entries: number;
      preordered_entries: number;
      duplicated_items: number;
      digital_copies: number;
    }>();

  return {
    baseGames: row?.base_games ?? 0,
    expansions: row?.expansions ?? 0,
    accessories: row?.accessories ?? 0,
    totalItems: row?.total_items ?? 0,
    ownedCopies: row?.owned_copies ?? 0,
    wantedEntries: row?.wanted_entries ?? 0,
    preorderedEntries: row?.preordered_entries ?? 0,
    duplicatedItems: row?.duplicated_items ?? 0,
    digitalCopies: row?.digital_copies ?? 0,
  };
}

/** Thrown for conditions the caller can fix; carries the status to return. */
export class ItemError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
