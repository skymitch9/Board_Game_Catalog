-- Remember what a photo said, so re-shooting the same box is free.
--
-- The title cache in 0005 stops us re-resolving a name we have seen. This stops
-- the step before it: photographing a box, not adding it, and photographing it
-- again a minute later used to pay for a second vision call for an identical
-- answer.
--
-- Matching is on a 64-bit difference hash rather than the bytes. Two handheld
-- shots of the same cover are never byte-identical — different exposure, a few
-- degrees of rotation — but their dHashes land within a handful of bits.
--
-- Separate table rather than a third `kind` in lookup_cache: SQLite cannot alter
-- a CHECK constraint without rebuilding the table, and hash lookup needs its own
-- scan pattern anyway (nearest match, not exact key).
--
-- `mode` keeps single-box and shelf readings apart. They ask different questions
-- of the same pixels, and a shelf photo must never answer a box lookup.

CREATE TABLE photo_cache (
  hash        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('identify', 'shelf')),
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hash, mode)
);

-- Candidate rows are fetched newest-first within a mode and compared in JS,
-- because Hamming distance is not something SQLite can index.
CREATE INDEX idx_photo_cache_recent ON photo_cache(mode, created_at DESC);
