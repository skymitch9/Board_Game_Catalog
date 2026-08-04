-- Board Game Catalog — initial schema
-- See docs/DESIGN.md §6 for the model and the reasoning behind it.
--
-- Two rules this schema exists to enforce:
--   1. Catalog (facts about the world) is separate from collection (facts about us).
--      Research may overwrite the former; it must never touch the latter.
--   2. The base game is the root. Everything else — expansions, promos, upgrades,
--      accessories — hangs off it via parent_item_id, with root_game_id
--      denormalized so "everything for Gloomhaven" is one indexed lookup.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Identity comes from the Cloudflare Access JWT (Google SSO). Access proves who
-- someone is; this table decides what they may do.
CREATE TABLE app_user (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  display_name   TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'rater', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Catalog — facts about the world
-- ---------------------------------------------------------------------------

CREATE TABLE item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bgg_id          INTEGER,
  kind            TEXT    NOT NULL
                          CHECK (kind IN ('base', 'expansion', 'accessory', 'promo', 'upgrade')),
  -- Direct parent: an accessory may belong to an expansion, not just a base game.
  parent_item_id  INTEGER REFERENCES item(id) ON DELETE CASCADE,
  -- The base game at the root of this subtree. For a base game, root_game_id = id.
  root_game_id    INTEGER REFERENCES item(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  sort_name       TEXT,
  year_published  INTEGER,
  publisher       TEXT,
  publisher_url   TEXT,
  designers       TEXT,
  min_players     INTEGER,
  max_players     INTEGER,
  playtime_min    INTEGER,
  weight          REAL,
  thumbnail_url   TEXT,
  description     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_item_bgg      ON item(bgg_id) WHERE bgg_id IS NOT NULL;
CREATE        INDEX idx_item_root     ON item(root_game_id);
CREATE        INDEX idx_item_parent   ON item(parent_item_id);
CREATE        INDEX idx_item_kind     ON item(kind);
CREATE        INDEX idx_item_sortname ON item(sort_name);

-- A specific printing / version of an item.
CREATE TABLE edition (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  bgg_version_id  INTEGER,
  name            TEXT,
  year            INTEGER,
  publisher       TEXT,
  language        TEXT,
  -- UPC/EAN. Self-healing: every successful barcode scan writes back here, so
  -- the collection gradually becomes its own barcode lookup table.
  barcode         TEXT,
  image_url       TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_edition_item    ON edition(item_id);
CREATE INDEX idx_edition_barcode ON edition(barcode) WHERE barcode IS NOT NULL;

-- Sleeve needs. Several rows per item is normal — most games use more than one
-- card size. confidence + source_url exist because this data is cross-checked
-- across publisher, BGG and sleeve vendors before it is trusted.
CREATE TABLE sleeve_requirement (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id          INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  card_size_label  TEXT    NOT NULL,
  width_mm         REAL,
  height_mm        REAL,
  count            INTEGER,
  source_url       TEXT,
  source_tier      TEXT    CHECK (source_tier IN ('official', 'crowdfunding', 'retail', 'community')),
  confidence       REAL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sleeve_item ON sleeve_requirement(item_id);

-- ---------------------------------------------------------------------------
-- Collection — facts about us. One joint collection; no per-person ownership.
-- ---------------------------------------------------------------------------

CREATE TABLE copy (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id             INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  edition_id          INTEGER REFERENCES edition(id) ON DELETE SET NULL,
  -- Sleeves/inserts point at the specific copy they belong to.
  applies_to_copy_id  INTEGER REFERENCES copy(id) ON DELETE SET NULL,
  status              TEXT    NOT NULL DEFAULT 'owned'
                              CHECK (status IN ('owned', 'wanted', 'preordered', 'lent', 'sold')),
  location            TEXT,
  acquired_on         TEXT,
  price_paid_cents    INTEGER,
  currency            TEXT    NOT NULL DEFAULT 'USD',
  vendor              TEXT,
  condition           TEXT    CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'poor')),
  is_sleeved          INTEGER NOT NULL DEFAULT 0 CHECK (is_sleeved IN (0, 1)),
  is_punched          INTEGER NOT NULL DEFAULT 0 CHECK (is_punched IN (0, 1)),
  completeness_notes  TEXT,
  lent_to             TEXT,
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_copy_item     ON copy(item_id);
CREATE INDEX idx_copy_status   ON copy(status);
CREATE INDEX idx_copy_location ON copy(location);
CREATE INDEX idx_copy_applies  ON copy(applies_to_copy_id);

-- Ratings are the one per-person thing.
CREATE TABLE user_item (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  rating    INTEGER CHECK (rating BETWEEN 1 AND 10),
  notes     TEXT,
  rated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, user_id)
);

CREATE INDEX idx_user_item_item ON user_item(item_id);
CREATE INDEX idx_user_item_user ON user_item(user_id);

CREATE TABLE play (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id             INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  played_on           TEXT    NOT NULL,
  players_json        TEXT,
  winner              TEXT,
  duration_min        INTEGER,
  logged_by_user_id   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_play_item ON play(item_id);
CREATE INDEX idx_play_date ON play(played_on);

-- ---------------------------------------------------------------------------
-- Research staging — the LLM never writes to the catalog directly.
-- Every claim lands here with a source and a tier, and a human promotes it.
-- ---------------------------------------------------------------------------

CREATE TABLE research_run (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tier               TEXT    NOT NULL CHECK (tier IN ('official', 'crowdfunding', 'retail')),
  model              TEXT,
  effort             TEXT,
  status             TEXT    NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'done', 'error')),
  error_message      TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  triggered_by       INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  started_at         TEXT,
  finished_at        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_run_item   ON research_run(item_id);
CREATE INDEX idx_run_status ON research_run(status);

CREATE TABLE research_finding (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field         TEXT    NOT NULL,
  value_json    TEXT    NOT NULL,
  source_tier   TEXT    NOT NULL CHECK (source_tier IN ('official', 'crowdfunding', 'retail', 'community')),
  source_url    TEXT,
  confidence    REAL,
  review_state  TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (review_state IN ('pending', 'accepted', 'rejected')),
  reviewed_by   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_finding_item   ON research_finding(item_id);
CREATE INDEX idx_finding_review ON research_finding(review_state);
CREATE INDEX idx_finding_run    ON research_finding(run_id);
