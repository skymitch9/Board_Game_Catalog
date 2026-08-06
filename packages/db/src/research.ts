/**
 * Research runs and their findings.
 *
 * Findings are staged, never applied. A run writes rows a person then accepts
 * or rejects; nothing here touches the catalog tables. That separation is the
 * point of the pipeline — a confident wrong answer from a retail page should
 * cost a rejected row, not a corrupted game.
 *
 * The tables come from migration 0001; this is the first code to use them.
 */

import type { RunTier, SourceTier } from '@bgc/core';

export type ResearchTier = Exclude<SourceTier, 'community'>;
export type RunStatus = 'queued' | 'running' | 'done' | 'error';
export type ReviewState = 'pending' | 'accepted' | 'rejected';

/** What a details run changed, stored on the run so it survives the request. */
export interface DetailsResult {
  /** Column-ish field names — `publisher`, `yearPublished` — and their values. */
  filled: Record<string, string | number>;
  /** Why nothing was filled, when nothing was. */
  detail: string | null;
}

/**
 * What the item looked like when a details run started.
 *
 * Recorded so the queue can tell "asked and found nothing" from "asked, before
 * there was anything to find". A 2027 pre-order asked today has no page, no
 * BoardGameGeek entry and no reviews; the same box asked the week it ships has
 * all three. Comparing these four against the row as it is now costs a SQL
 * predicate and re-opens the item for free — see `needsDetailsSql` in
 * `items.ts` and migration 0020.
 */
export interface RunInputs {
  /** Did any copy say we hold it? `preordered` → `owned` is the strongest signal. */
  owned: boolean;
  bggId: number | null;
  name: string;
  yearPublished: number | null;
}

export interface ResearchRun {
  id: number;
  itemId: number;
  tier: RunTier;
  model: string | null;
  effort: string | null;
  status: RunStatus;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Only a details run writes this; a tiered run stages findings instead. */
  result: DetailsResult | null;
  triggeredBy: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Null on a run written before migration 0020, which reads as "unknown". */
  inputs: RunInputs | null;
  /** Fields this run asked about and could not find. */
  unfilled: string[];
}

export interface ResearchFinding {
  id: number;
  runId: number;
  itemId: number;
  field: string;
  value: string;
  sourceTier: SourceTier;
  sourceUrl: string | null;
  confidence: number | null;
  reviewState: ReviewState;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Caveats the model attached. Stored inside value_json alongside the claim. */
  notes: string | null;
}

interface RunRow {
  id: number;
  item_id: number;
  tier: string;
  model: string | null;
  effort: string | null;
  status: string;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  result_json: string | null;
  triggered_by: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  input_owned: number | null;
  input_bgg_id: number | null;
  input_name: string | null;
  input_year: number | null;
  unfilled: string | null;
}

interface FindingRow {
  id: number;
  run_id: number;
  item_id: number;
  field: string;
  value_json: string;
  source_tier: string;
  source_url: string | null;
  confidence: number | null;
  review_state: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

function mapRun(r: RunRow): ResearchRun {
  return {
    id: r.id,
    itemId: r.item_id,
    tier: r.tier as RunTier,
    model: r.model,
    effort: r.effort,
    status: r.status as RunStatus,
    errorMessage: r.error_message,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    result: parseResult(r.result_json),
    triggeredBy: r.triggered_by,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    inputs:
      r.input_owned == null && r.input_name == null
        ? null
        : {
            owned: r.input_owned === 1,
            bggId: r.input_bgg_id,
            name: r.input_name ?? '',
            yearPublished: r.input_year,
          },
    unfilled: splitUnfilled(r.unfilled),
  };
}

/**
 * The comma-delimited `unfilled` column, back as a list.
 *
 * Stored with leading and trailing commas so `instr(unfilled, ',minPlayers,')`
 * in the queue predicate is an exact test — without them `,minPlayers` would
 * also match inside `,maxPlayers`. The empty strings that produces are dropped
 * here rather than in SQL.
 */
function splitUnfilled(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter((f) => f !== '');
}

/** Unreadable JSON is treated as no result rather than failing the read. */
function parseResult(raw: string | null): DetailsResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DetailsResult>;
    return { filled: parsed.filled ?? {}, detail: parsed.detail ?? null };
  } catch {
    return null;
  }
}

/**
 * `value_json` holds `{ value, notes }` rather than a bare string.
 *
 * The column is the schema's only free-form slot, and a caveat ("true of the
 * 2019 printing only") is worth exactly as much as the claim it qualifies —
 * dropping it to keep the column tidy would be throwing away the part that
 * stops a finding being applied to the wrong edition.
 */
function mapFinding(r: FindingRow): ResearchFinding {
  let value = r.value_json;
  let notes: string | null = null;
  try {
    const parsed = JSON.parse(r.value_json) as { value?: string; notes?: string | null };
    if (typeof parsed?.value === 'string') {
      value = parsed.value;
      notes = parsed.notes ?? null;
    }
  } catch {
    // A row written before this shape, or by hand. Show it as-is rather than
    // hiding it — a finding you cannot read is still a finding you can reject.
  }

  return {
    id: r.id,
    runId: r.run_id,
    itemId: r.item_id,
    field: r.field,
    value,
    notes,
    sourceTier: r.source_tier as SourceTier,
    sourceUrl: r.source_url,
    confidence: r.confidence,
    reviewState: r.review_state as ReviewState,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  };
}

const RUN_COLUMNS = `id, item_id, tier, model, effort, status, error_message,
  input_tokens, output_tokens, result_json, triggered_by, started_at, finished_at, created_at,
  input_owned, input_bgg_id, input_name, input_year, unfilled`;

const FINDING_COLUMNS = `id, run_id, item_id, field, value_json, source_tier,
  source_url, confidence, review_state, reviewed_by, reviewed_at, created_at`;

/**
 * Open a run, stamping the inputs it is about to work from.
 *
 * `inputs` is written here rather than at `finishRun` on purpose: the point of
 * the record is what the lookup *had to go on*, and an item edited while a run
 * was in flight would otherwise be stamped with the new value and never
 * re-asked. The tiered pass passes none and stores NULLs, which is right — it
 * stages findings and this exclusion does not apply to it.
 */
export async function createRun(
  db: D1Database,
  input: {
    itemId: number;
    tier: RunTier;
    model: string;
    effort: string;
    triggeredBy: number | null;
    inputs?: RunInputs;
  },
): Promise<ResearchRun> {
  const row = await db
    .prepare(
      `INSERT INTO research_run
         (item_id, tier, model, effort, status, triggered_by, started_at,
          input_owned, input_bgg_id, input_name, input_year)
       VALUES (?1, ?2, ?3, ?4, 'running', ?5, datetime('now'), ?6, ?7, ?8, ?9)
       RETURNING ${RUN_COLUMNS}`,
    )
    .bind(
      input.itemId,
      input.tier,
      input.model,
      input.effort,
      input.triggeredBy,
      input.inputs ? (input.inputs.owned ? 1 : 0) : null,
      input.inputs?.bggId ?? null,
      input.inputs?.name ?? null,
      input.inputs?.yearPublished ?? null,
    )
    .first<RunRow>();

  if (!row) throw new Error('Failed to create research run');
  return mapRun(row);
}

/**
 * The four inputs, read off the item as it stands right now.
 *
 * One query, and `owned` is the interesting one: copy status is what says the
 * thing physically exists, and an item can hold several copies, so the question
 * is "does *any* of them say we hold it" rather than "what is the status".
 *
 * Null when the item is gone, which the caller treats as "do not stamp
 * anything" rather than as an error — the run is about to fail on the missing
 * item anyway and would only report it twice.
 */
export async function detailsRunInputs(
  db: D1Database,
  itemId: number,
): Promise<RunInputs | null> {
  const row = await db
    .prepare(
      `SELECT i.name AS name, i.bgg_id AS bgg_id, i.year_published AS year_published,
              EXISTS (SELECT 1 FROM copy c
                       WHERE c.item_id = i.id AND c.status = 'owned') AS owned
         FROM item i WHERE i.id = ?1`,
    )
    .bind(itemId)
    .first<{ name: string; bgg_id: number | null; year_published: number | null; owned: number }>();

  if (!row) return null;
  return {
    owned: row.owned === 1,
    bggId: row.bgg_id,
    name: row.name,
    yearPublished: row.year_published,
  };
}

export async function finishRun(
  db: D1Database,
  id: number,
  outcome:
    | {
        status: 'done';
        inputTokens: number;
        outputTokens: number;
        /** A details run's outcome. Omitted by the tiered pass, which stages findings. */
        result?: DetailsResult;
        /**
         * Fields asked about and not found. Stored comma-delimited *with*
         * leading and trailing commas, so the queue's `instr` test is exact —
         * `,minPlayers,` cannot match inside `,maxPlayers,`.
         */
        unfilled?: string[];
      }
    | { status: 'error'; errorMessage: string },
): Promise<ResearchRun | null> {
  const row =
    outcome.status === 'done'
      ? await db
          .prepare(
            `UPDATE research_run
                SET status = 'done', input_tokens = ?2, output_tokens = ?3,
                    result_json = ?4, unfilled = ?5, finished_at = datetime('now')
              WHERE id = ?1 RETURNING ${RUN_COLUMNS}`,
          )
          .bind(
            id,
            outcome.inputTokens,
            outcome.outputTokens,
            outcome.result ? JSON.stringify(outcome.result) : null,
            outcome.unfilled && outcome.unfilled.length > 0
              ? `,${outcome.unfilled.join(',')},`
              : null,
          )
          .first<RunRow>()
      : await db
          .prepare(
            `UPDATE research_run
                SET status = 'error', error_message = ?2, finished_at = datetime('now')
              WHERE id = ?1 RETURNING ${RUN_COLUMNS}`,
          )
          .bind(id, outcome.errorMessage)
          .first<RunRow>();

  return row ? mapRun(row) : null;
}

/**
 * The run still working on this item, if there is one.
 *
 * The queue page polls, and a poll that arrives while a lookup is in flight
 * must not start a second one — two Claude calls for one game is money spent
 * twice for one answer. A run killed with its invocation (see the subrequest
 * ceiling in the scan-job notes) would otherwise block the item forever, so
 * staleness is the caller's to judge from `startedAt`; this only reports what
 * the row says.
 */
export async function activeDetailsRun(
  db: D1Database,
  itemId: number,
): Promise<ResearchRun | null> {
  const row = await db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM research_run
        WHERE item_id = ?1 AND tier = 'details' AND status IN ('queued', 'running')
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(itemId)
    .first<RunRow>();
  return row ? mapRun(row) : null;
}

/**
 * The most recent details run for each item that has one.
 *
 * One row per item rather than a history: the queue shows a list of games and
 * what happened to each, and an older attempt on a game since filled in is not
 * an outcome anyone is looking at. The history is still in the table.
 */
export async function latestDetailsRuns(
  db: D1Database,
  limit = 300,
): Promise<ResearchRun[]> {
  const { results } = await db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM research_run r
        WHERE r.tier = 'details'
          AND r.id = (SELECT MAX(id) FROM research_run
                       WHERE item_id = r.item_id AND tier = 'details')
        ORDER BY r.id DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<RunRow>();
  return results.map(mapRun);
}

export async function saveFindings(
  db: D1Database,
  input: {
    runId: number;
    itemId: number;
    tier: SourceTier;
    findings: { field: string; value: string; sourceUrl: string; confidence: number; notes: string | null }[];
  },
): Promise<number> {
  if (input.findings.length === 0) return 0;

  const statements = input.findings.map((f) =>
    db
      .prepare(
        `INSERT INTO research_finding (run_id, item_id, field, value_json, source_tier, source_url, confidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        input.runId,
        input.itemId,
        f.field,
        JSON.stringify({ value: f.value, notes: f.notes }),
        input.tier,
        f.sourceUrl,
        f.confidence,
      ),
  );

  await db.batch(statements);
  return statements.length;
}

export async function listRuns(db: D1Database, itemId: number): Promise<ResearchRun[]> {
  const { results } = await db
    .prepare(`SELECT ${RUN_COLUMNS} FROM research_run WHERE item_id = ? ORDER BY created_at DESC`)
    .bind(itemId)
    .all<RunRow>();
  return results.map(mapRun);
}

/**
 * Findings for one game, highest tier first.
 *
 * Ordering is the merge rule made visible: official outranks crowdfunding
 * outranks retail, so when three sources disagree about a card count the one
 * worth believing is already at the top of the group.
 */
export async function listFindings(
  db: D1Database,
  itemId: number,
  filter?: { reviewState?: ReviewState },
): Promise<ResearchFinding[]> {
  const where = ['item_id = ?1'];
  const binds: unknown[] = [itemId];
  if (filter?.reviewState) {
    where.push('review_state = ?2');
    binds.push(filter.reviewState);
  }

  const { results } = await db
    .prepare(
      `SELECT ${FINDING_COLUMNS} FROM research_finding
        WHERE ${where.join(' AND ')}
        ORDER BY field,
                 CASE source_tier
                   WHEN 'official' THEN 0
                   WHEN 'crowdfunding' THEN 1
                   WHEN 'retail' THEN 2
                   ELSE 3
                 END,
                 confidence DESC`,
    )
    .bind(...binds)
    .all<FindingRow>();

  return results.map(mapFinding);
}

export async function reviewFinding(
  db: D1Database,
  id: number,
  input: { reviewState: Exclude<ReviewState, 'pending'>; reviewedBy: number },
): Promise<ResearchFinding | null> {
  const row = await db
    .prepare(
      `UPDATE research_finding
          SET review_state = ?2, reviewed_by = ?3, reviewed_at = datetime('now')
        WHERE id = ?1 RETURNING ${FINDING_COLUMNS}`,
    )
    .bind(id, input.reviewState, input.reviewedBy)
    .first<FindingRow>();

  return row ? mapFinding(row) : null;
}

/** Counts for the item page, so it can say "9 findings waiting" without loading them. */
export async function findingCounts(
  db: D1Database,
  itemId: number,
): Promise<Record<ReviewState, number>> {
  const { results } = await db
    .prepare(
      `SELECT review_state, COUNT(*) AS n FROM research_finding
        WHERE item_id = ? GROUP BY review_state`,
    )
    .bind(itemId)
    .all<{ review_state: string; n: number }>();

  const counts: Record<ReviewState, number> = { pending: 0, accepted: 0, rejected: 0 };
  for (const row of results) counts[row.review_state as ReviewState] = row.n;
  return counts;
}
