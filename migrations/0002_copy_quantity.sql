-- Owning more than one of something.
--
-- A `copy` row already represents one physical thing, so three sleeve packs
-- could be three rows. That's right when the copies differ — one on Shelf A,
-- one lent to Dave, one still shrink-wrapped — and needless bookkeeping when
-- they're identical.
--
-- `quantity` covers the identical case without collapsing the distinct one:
-- separate rows still describe copies that differ, and quantity describes how
-- many that particular row stands for.

ALTER TABLE copy ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;

-- SQLite can't add a CHECK constraint to an existing table, so guard the
-- invariant with triggers instead.
CREATE TRIGGER copy_quantity_positive_insert
BEFORE INSERT ON copy
WHEN NEW.quantity < 1
BEGIN
  SELECT RAISE(ABORT, 'quantity must be at least 1');
END;

CREATE TRIGGER copy_quantity_positive_update
BEFORE UPDATE OF quantity ON copy
WHEN NEW.quantity < 1
BEGIN
  SELECT RAISE(ABORT, 'quantity must be at least 1');
END;

-- Finding duplicates is a first-class question ("do we own two of this?"),
-- so make the aggregate cheap.
CREATE INDEX idx_copy_item_quantity ON copy(item_id, quantity);
