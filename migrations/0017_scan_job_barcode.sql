-- A scan job can now come from a barcode, not only a photograph.
--
-- `mode` carries a CHECK constraint, and SQLite cannot alter one in place, so
-- the table is rebuilt. Nothing references scan_job by foreign key, so there is
-- no ordering hazard here; the only thing to preserve is the rows and the
-- AUTOINCREMENT high-water mark, which the explicit id column carries across.
--
-- Why a third mode rather than a fake photo job: a barcode job has no image,
-- never calls vision, and costs nothing. Recording it as 'shelf' would make the
-- queue lie about where its titles came from, and the review screen could not
-- tell you which code it was that you scanned.

CREATE TABLE scan_job_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'uploaded'
                CHECK(status IN ('uploaded','reading','read','enriching','review','done','failed')),
  mode          TEXT NOT NULL DEFAULT 'shelf'
                CHECK(mode IN ('shelf','single','barcode')),
  photo_key     TEXT NOT NULL,
  raw_titles    TEXT,
  enriched      TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  reviewed_at   TEXT
);

INSERT INTO scan_job_new
  (id, status, mode, photo_key, raw_titles, enriched, error, created_at, processed_at, reviewed_at)
SELECT
  id, status, mode, photo_key, raw_titles, enriched, error, created_at, processed_at, reviewed_at
FROM scan_job;

DROP TABLE scan_job;

ALTER TABLE scan_job_new RENAME TO scan_job;

CREATE INDEX idx_scan_job_status ON scan_job(status);
