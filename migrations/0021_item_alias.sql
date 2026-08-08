-- `item_alias` — the other names one game answers to.
--
-- *"Settlers of Catan and Catan are the same game — the studio just did a naming
-- thing."* The owner, after a rescan added **The Settlers of Catan** (item 826)
-- beside the **Catan** (item 54) already in the collection.
--
-- ## Why the existing matcher could not have caught it, and must not be loosened
--
-- `matchIndexedTitle` compares folded names, and "catan" against "settlers of
-- catan" is a one-word fragment of a longer title. `isConfidentMatch` rejects
-- exactly that shape on purpose: a one-word fragment of a two-word title scores
-- 2*1/(1+2) = 0.67 *every time*, genuine reads score 1.00, and
-- MIN_SPINE_SIMILARITY sits at 0.7 in the gap between those two populations.
-- That guard is what stops "Quandary" matching "Zorblax Quandary" and
-- "Deep Rock Galactic" matching "Deep Rock Galactic: Biome Expansion".
--
-- Catan is the *same shape* as the case the guard exists to reject. No
-- threshold separates them, because there is nothing in the two strings to
-- separate. The difference is not textual — it is a fact about the world, and a
-- fact about the world has to be recorded rather than computed.
--
-- ## Why not `bgg_id`, which we already store — measured, not assumed
--
-- The obvious free answer is "both names are BGG 13, match on that". Checked
-- against production on 2026-08-08 and it is **false here**:
--
--     item  54  Catan                  bgg_id 13
--     item 826  The Settlers of Catan  bgg_id 152959
--
-- 152959 is a genuinely separate BoardGameGeek entry (Mayfair, 2008) whose own
-- primary name is "The Settlers of Catan". The free lookup rung resolved the
-- spine to it, correctly by its own lights. A bgg_id comparison would have said
-- "different games" and added the row anyway. It also only works once a row has
-- an id at all, and 128 of 802 do.
--
-- What *is* true is that BGG 13 lists "The Settlers of Catan" among its
-- `<name type="alternate">` nodes — along with 60 others, in fourteen scripts.
-- The identity already exists upstream; the client was throwing it away in
-- `primaryName()`. This table is where it lands.
--
-- ## Shape
--
-- One row per known alternate name. A table rather than an `alt_names` text
-- column because the knowledge is a *list* that gets added to, corrected and
-- argued with: a row can be deleted when BGG's alternate turns out to collide
-- with a real game, and `source` records who claimed it so a person's answer
-- outranks an import. A packed column can do neither without string surgery.
--
-- This is the same judgement that added `series`: the concept is real and
-- recurring — renamed games are common and Catan is not the only one — and
-- unlike `inheritCover` there is nothing already in D1 to resolve it from at
-- read time. The alternate names live at BoardGameGeek, behind a network call
-- that the scan path's subrequest budget cannot afford per title.
--
-- ## What is deliberately NOT stored
--
-- No folded `alias_key` column. The fold is `normaliseTitle` in
-- `packages/core/src/vision.ts`, it is applied to item names at index-build time
-- already, and a stored copy would silently go stale the day that function
-- changes. UNIQUE is on the raw alias, which is enough: two rows differing only
-- in case fold to one key, and `buildTitleIndex` drops a key claimed by two
-- different items rather than picking one.

CREATE TABLE item_alias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  -- As printed. Shown to a person on the item page; folded before comparison.
  alias      TEXT    NOT NULL,
  -- 'bgg' was imported and may be re-imported; 'manual' is a person's answer
  -- and a re-import must never delete it.
  source     TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('bgg', 'manual')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, alias)
);

-- Every scan request reads the whole table once and folds it in memory, the
-- same way it already reads every item name. This index is for the item page
-- asking for one game's aliases, and for the re-import deleting one item's.
CREATE INDEX idx_item_alias_item ON item_alias(item_id);

-- "Has this item ever been asked?" — distinct from "does it have aliases", the
-- same distinction `component_check` draws against `game_component`. A game
-- with no alternate names is a real answer and must not be re-asked every run.
CREATE TABLE alias_check (
  item_id    INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  checked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  bgg_id     INTEGER,
  -- How many BGG offered, before any were dropped for colliding.
  offered    INTEGER NOT NULL DEFAULT 0,
  outcome    TEXT    NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'not_found'))
);
