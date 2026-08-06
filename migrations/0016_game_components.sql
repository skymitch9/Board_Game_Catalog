-- What else exists for a game we own — "what am I missing".
--
-- BoardGameGeek publishes, per game, `boardgameexpansion` and
-- `boardgameaccessory` links. Those two lists are the whole answer to "you own
-- four expansions; seven exist", and the catalog has never held them.
--
-- **Cached, not looked up live.** Measured on 2026-08-05 against the real
-- collection: 83 rooted games with a `bgg_id` list **1,148 components** between
-- them (680 expansions, 468 accessories, 1,120 distinct ids). A live lookup
-- would be a ~1.1s BoardGameGeek call on every item-page view, would go blank
-- whenever BGG did, and could never answer the question that only a stored
-- history can — *something new was published for a game you own*.
--
-- Two tables, because they answer two different questions:
--
--   game_component  — one row per known component of one game.
--   component_check — what we know about the *game*, including whether anyone
--                     has ever asked. Without it, "no components found" and
--                     "never checked" are the same empty result, and the UI
--                     would have to tell an owner their collection is complete
--                     on the strength of never having looked.

CREATE TABLE game_component (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The base game in *our* catalog this belongs to.
  item_id        INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  -- The component's own BoardGameGeek id. This is the identity that makes
  -- "do I own this" answerable without comparing strings.
  bgg_id         INTEGER NOT NULL,
  name           TEXT NOT NULL,
  -- BGG's own vocabulary, narrowed: an expansion or an accessory, nothing else.
  kind           TEXT NOT NULL CHECK (kind IN ('expansion', 'accessory')),

  -- ---- filled by the second pass -------------------------------------------
  -- A game's `related` links carry only an id and a name. Everything below
  -- needs the component fetched as a thing of its own, which is a separate
  -- 20-ids-per-call sweep. Until that happens these are NULL and the component
  -- is *unclassified* — deliberately counted towards neither total.

  -- BGG lists several publishers for most things (the original plus every
  -- localisation). Stored as a JSON array so the official/third-party split can
  -- be recomputed with no BoardGameGeek call at all, and so a wrong call is
  -- fixable by editing one row.
  publishers     TEXT,
  year_published INTEGER,
  thumbnail_url  TEXT,
  -- 1 official, 0 third-party, NULL not yet decided.
  --
  -- Derived from `publishers` against the base game's own publisher list, and
  -- stored rather than computed on read so the two cannot disagree mid-page.
  -- Measured on Ark Nova: of 24 accessories exactly one (Portal Games' wooden
  -- tokens) is official — the rest are Folded Space, Laserox, e-Raptor and a
  -- dozen other insert makers. Three of its seven "expansions" are Kekpop
  -- Spiele's 3D upgrades, so this is not an accessory-only problem.
  official       INTEGER CHECK (official IN (0, 1)),
  -- When the component's own details were fetched. NULL means unclassified.
  details_at     TEXT,

  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Set when a refresh stopped finding this component on BoardGameGeek.
  --
  -- **Marked, never deleted.** A row disappearing from the missing list looks
  -- exactly like the owner having bought the thing, and that is a fact about
  -- their shelf we would be inventing. A stale row is shown, quietly, saying
  -- BGG no longer lists it.
  stale_at       TEXT
);

-- One row per component per game, so a re-run is an upsert rather than a
-- duplicate. This is the index the whole backfill's idempotency rests on.
CREATE UNIQUE INDEX idx_game_component_unique ON game_component(item_id, bgg_id);

-- The item page's read: every component of one game.
CREATE INDEX idx_game_component_item ON game_component(item_id, kind);

-- The second pass walks the unclassified ones. NULLs sort first in SQLite, so
-- "ORDER BY details_at" hands back exactly the rows still needing a fetch.
CREATE INDEX idx_game_component_details ON game_component(details_at);


CREATE TABLE component_check (
  item_id     INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  checked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- The base game's publishers as BoardGameGeek lists them, JSON array. This is
  -- the other half of the official/third-party comparison, and keeping it here
  -- is what makes the split recomputable offline.
  --
  -- Not `item.publisher`: that column holds one name a human typed, while the
  -- split needs the whole set. Here to Slay is published by TeeTurtle *and*
  -- Unstable Games *and* seven localisation houses, and its expansions are
  -- credited to different subsets of those.
  publishers  TEXT,
  -- What the last sweep saw, so a run can report movement without recounting.
  expansions  INTEGER NOT NULL DEFAULT 0,
  accessories INTEGER NOT NULL DEFAULT 0,
  -- 'ok'        — BGG answered, and this is what it said.
  -- 'not_found' — BGG returned nothing for the id. Entries get merged and
  --               removed; that is a fact worth showing, not a silent zero.
  outcome     TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'not_found'))
);

-- The weekly sweep takes the least recently checked games first, exactly as the
-- cover check walks URLs. This index is what makes that cheap.
CREATE INDEX idx_component_check_age ON component_check(checked_at);
