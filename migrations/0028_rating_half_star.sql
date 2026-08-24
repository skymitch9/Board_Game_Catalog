-- Rescale ratings from the legacy 1–10 integer scale to the 0.5–5 half-star
-- scale the audiobook catalog uses, so a rating means the same number on both
-- sites (owner request, 2026-08-24 — "make the board game ratings match the
-- audiobook ratings"). See RATING_* and legacyRatingToHalfStar in
-- packages/core/src/constants.ts, and upsertRatingSchema in schemas.ts.
--
-- Two things change together and MUST ship in one migration, because the new
-- values violate the old constraint and the old column type cannot hold them:
--   1. every stored rating is divided by 2   (1→0.5, 2→1, … 10→5 — exact,
--      lossless, every result on a legal half-step; NULL carried through);
--   2. the column becomes REAL and the CHECK becomes the half-star domain
--      (0.5–5 on 0.5 steps), replacing `INTEGER CHECK (rating BETWEEN 1 AND 10)`.
--
-- SQLite cannot ALTER a column's type or CHECK constraint in place, so the table
-- is rebuilt. Unlike migration 0023's app_user rebuild, this is the SIMPLE case:
-- `user_item` is a LEAF — nothing has a foreign key pointing AT it (only item and
-- app_user are referenced BY it, and those are untouched), so DROPping it fires
-- no cascade and needs no stash. Its two indexes are recreated by hand because
-- the rebuild is a genuinely new table, not the empty-and-refill 0023 did.
--
-- ⚠️ Column order and constraints mirror migrations/0001_init.sql exactly, save
-- for the rating type/CHECK this migration is here to change. ids are carried
-- across unchanged.

CREATE TABLE user_item_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  rating    REAL    CHECK (
                      rating IS NULL
                      OR (rating >= 0.5 AND rating <= 5.0
                          AND (rating * 2) = CAST(rating * 2 AS INTEGER))
                    ),
  notes     TEXT,
  rated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, user_id)
);

-- The rescale. `rating / 2.0` forces real division (SQLite integer `/` would
-- floor, turning a 9 into 4 instead of 4.5); the CASE keeps a NULL a NULL rather
-- than dividing it to 0.
INSERT INTO user_item_new (id, item_id, user_id, rating, notes, rated_at)
  SELECT id, item_id, user_id,
         CASE WHEN rating IS NULL THEN NULL ELSE rating / 2.0 END,
         notes, rated_at
    FROM user_item;

DROP TABLE user_item;
ALTER TABLE user_item_new RENAME TO user_item;

-- Recreate the indexes 0001 defined (they belonged to the old table, which is
-- gone).
CREATE INDEX idx_user_item_item ON user_item(item_id);
CREATE INDEX idx_user_item_user ON user_item(user_id);
