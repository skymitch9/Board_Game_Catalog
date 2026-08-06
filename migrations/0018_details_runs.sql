-- Background "fill in details" runs.
--
-- `POST /api/research/:id/details` used to `await enrichItem` inside the
-- request: a Claude call with web search, held open for tens of seconds. If the
-- connection dropped — a phone locking, a tab closing, a walk out of wifi — the
-- lookup was paid for and the answer was lost. It now runs under
-- `executionCtx.waitUntil` and reports through `research_run`, which is the
-- table built for exactly this and had never been written to.
--
-- Two things stood in the way, and both are fixed here rather than worked
-- around:
--
-- 1. `tier` was CHECKed against the three *source* tiers. A details lookup is
--    not one of those — it is a single cheap open-web pass, not a search
--    restricted to a publisher's domain — so 'details' joins the set. Calling it
--    'retail' to fit the constraint would have been a lie stored 78 times.
-- 2. There was nowhere to record what a run actually did. The queue page says
--    "Filled publisher, year." or "Nothing new found.", and that sentence has to
--    survive the browser navigating away, which is the entire point of moving
--    the work to the background. `result_json` holds `{ filled, detail }`.
--
-- SQLite cannot alter a CHECK constraint, so the table is redefined. That is
-- safe because it is **empty in every environment** — verified 2026-08-06
-- against production (0 rows) and local (0 rows). It has always been empty: the
-- only route that wrote runs was the tiered research pass, which nobody has run.
-- `research_finding` references it and is also empty, so the implicit DELETE
-- that DROP performs removes nothing and violates nothing.

DROP TABLE research_run;

CREATE TABLE research_run (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tier               TEXT    NOT NULL CHECK (tier IN ('official', 'crowdfunding', 'retail', 'details')),
  model              TEXT,
  effort             TEXT,
  status             TEXT    NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'done', 'error')),
  error_message      TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  -- What the run changed: `{"filled":{"publisher":"Roxley"},"detail":null}`.
  -- Only a details run writes it; a tiered run stages `research_finding` rows
  -- instead and changes nothing.
  result_json        TEXT,
  triggered_by       INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  started_at         TEXT,
  finished_at        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_run_item   ON research_run(item_id);
CREATE INDEX idx_run_status ON research_run(status);
-- The queue page asks for the latest run per item, filtered to details runs.
CREATE INDEX idx_run_tier   ON research_run(tier, item_id);
