-- Room for roleplaying books, which the catalog was never shaped for.
--
-- Three gaps, all of which turned up the moment the collection stopped being
-- only board games.
--
-- 1. WHICH RULESET. A board game carries its own rules in the box, so there was
--    never anything to record. A roleplaying book does not: "Auroboros: Coils of
--    the Serpent" is unusable without knowing it is built on D&D 5e, and "Tidal
--    Blades: Cypher System RPG" is not D&D at all. Free text rather than an
--    enum, because the space of systems is open and a CHECK here would be
--    rewritten every time a new one arrives. Expected values look like
--    'D&D 5e (2014)', 'D&D 2024', 'Cypher System', 'system-agnostic'.
--
-- 2. PHYSICAL OR DIGITAL. Every D&D Beyond book is a licence, not an object.
--    Without this, "do I own the Monster Manual" answers yes without saying
--    whether it can be handed across the table. Defaulting to 'physical' is
--    right for all 458 existing rows: every one of them is a thing in a box.

ALTER TABLE item ADD COLUMN game_system TEXT;

ALTER TABLE copy ADD COLUMN format TEXT NOT NULL DEFAULT 'physical'
  CHECK (format IN ('physical', 'digital'));

-- 3. REQUIRES. The relation vocabulary had no way to say "you cannot use this
--    without owning that".
--
--    `works_with` is the near miss and it is wrong: it implies optional
--    compatibility, where a 5e supplement is unplayable without the Player's
--    Handbook. Nor is parent_item_id the answer — Auroboros is not *part of*
--    D&D, it is a separate product with a hard dependency, and filing it inside
--    a D&D tree would misdescribe what is owned. A directed relation says the
--    true thing and leaves both products standing on their own.
--
--    Directed, and deliberately not symmetric: the supplement requires the
--    Player's Handbook, never the reverse. getRelatedItems already treats
--    same_family as transitive and everything else as direct, which is the
--    correct handling here.
--
--    SQLite cannot alter a CHECK constraint, so the table is rebuilt and the
--    rows copied across. Dropping the old table takes its indexes with it,
--    hence the recreation at the end.

CREATE TABLE item_relation_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  to_item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL
               CHECK(relation IN ('same_family','works_with','reimplements','integrates_with','requires')),
  UNIQUE(from_item_id, to_item_id, relation)
);

INSERT INTO item_relation_new (id, from_item_id, to_item_id, relation)
  SELECT id, from_item_id, to_item_id, relation FROM item_relation;

DROP TABLE item_relation;

ALTER TABLE item_relation_new RENAME TO item_relation;

CREATE INDEX idx_item_relation_from ON item_relation(from_item_id);
CREATE INDEX idx_item_relation_to   ON item_relation(to_item_id);
