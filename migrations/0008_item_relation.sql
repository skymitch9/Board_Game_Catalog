-- Related games that are standalone but connected.
-- Dice Throne characters, Unmatched fighters, standalone expansions, reimplementations.
CREATE TABLE item_relation (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  to_item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL CHECK(relation IN ('works_with','reimplements','integrates_with')),
  UNIQUE(from_item_id, to_item_id, relation)
);

CREATE INDEX idx_item_relation_from ON item_relation(from_item_id);
CREATE INDEX idx_item_relation_to   ON item_relation(to_item_id);
