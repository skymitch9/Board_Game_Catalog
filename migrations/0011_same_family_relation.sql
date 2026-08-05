-- Add "same family" to the relation vocabulary.
--
-- The three existing types were all being stretched to cover the commonest
-- case in a real collection: a game that is the same game reworked. Catan: New
-- Energies and CATAN: Starfarers are Catan games built on the Catan rules by
-- the same publisher, and playable without owning Catan. They do not "work
-- with" Catan — you cannot shuffle them together — and calling them
-- reimplementations overstates it. They are simply other Catans.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt and the rows
-- copied across. Dropping the old table takes its indexes with it, hence the
-- recreation at the end.

CREATE TABLE item_relation_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  to_item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL
               CHECK(relation IN ('same_family','works_with','reimplements','integrates_with')),
  UNIQUE(from_item_id, to_item_id, relation)
);

INSERT INTO item_relation_new (id, from_item_id, to_item_id, relation)
  SELECT id, from_item_id, to_item_id, relation FROM item_relation;

DROP TABLE item_relation;

ALTER TABLE item_relation_new RENAME TO item_relation;

CREATE INDEX idx_item_relation_from ON item_relation(from_item_id);
CREATE INDEX idx_item_relation_to   ON item_relation(to_item_id);
