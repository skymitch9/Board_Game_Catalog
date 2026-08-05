-- Remember what we have already looked up.
--
-- Re-photographing a shelf re-resolves every title on it. The vision call itself
-- is one request per photo and cannot be avoided — a new photo is genuinely new
-- input — but the *resolution* of each title is deterministic and was costing a
-- GameUPC round trip per game, every time.
--
-- Keyed on (kind, key) so barcodes and titles share one table without colliding.
-- The payload is whole-response JSON rather than columns: what a rung returns
-- changes as rungs are added, and a cache that needs a migration every time the
-- shape shifts is worse than no cache.
--
-- Deliberately NOT a substitute for the local catalog. `edition.barcode` is the
-- authoritative "we own this"; this is only "we asked the internet this before".

CREATE TABLE lookup_cache (
  kind        TEXT NOT NULL CHECK (kind IN ('barcode', 'title')),
  -- Normalised by the caller: lower-cased, punctuation-folded for titles, digits
  -- only for barcodes. Two spellings of the same question must hit one row.
  key         TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, key)
);

-- Sweeping expired rows is a range scan over age, not a lookup by key.
CREATE INDEX idx_lookup_cache_age ON lookup_cache(created_at);
