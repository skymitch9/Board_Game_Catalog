-- An expansion can reach the shelf before the game it belongs to.
--
-- Until now an expansion whose base game was not in the collection could not be
-- recorded as an expansion at all: createItem demanded a parent, so both add
-- flows quietly saved it as a base game instead. That put "Wingspan: European
-- Expansion" in the catalog as a root, counted it as a game, and lost the fact
-- that it was ever meant to hang off something.
--
-- The intent is kept here instead. parent_item_id stays null, kind stays
-- honest, and pending_parent_name holds the name we expect to find later — the
-- prefix read off the spine. When a matching game is created, the orphan is
-- adopted and this column is cleared.
ALTER TABLE item ADD COLUMN pending_parent_name TEXT;

-- Adoption looks up by this name on every item creation, so it is worth an
-- index even though the column is almost always null.
CREATE INDEX idx_item_pending_parent
  ON item(pending_parent_name) WHERE pending_parent_name IS NOT NULL;
