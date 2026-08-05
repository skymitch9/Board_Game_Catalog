-- Photo upload job queue.
-- A photo is uploaded, vision reads it, enrichment resolves titles, user reviews.
CREATE TABLE scan_job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'uploaded'
                CHECK(status IN ('uploaded','reading','read','enriching','review','done','failed')),
  mode          TEXT NOT NULL DEFAULT 'shelf'
                CHECK(mode IN ('shelf','single')),
  photo_key     TEXT NOT NULL,
  -- Vision output: array of {text, position, confidence, note?}
  raw_titles    TEXT,
  -- Enriched results: array of ClassifiedItem-like objects with lookup data
  enriched      TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  reviewed_at   TEXT
);

CREATE INDEX idx_scan_job_status ON scan_job(status);
