-- Disposal & copy history — "for sold and lent we can mark them as not owned
-- anymore but we should keep a history of them items" (the owner, 2026-08-09).
--
-- The whole design, measured against production that day, is in
-- docs/info/copy-status-history.md. Read it before changing anything here; the
-- three decisions this file encodes are all argued there and all had a plausible
-- opposite.
--
-- ## 1. Why a `disposal` COLUMN and not a `given_away` STATUS  (§3, option B)
--
-- SQLite cannot alter a CHECK constraint. Adding 'given_away' to
-- `status IN (...)` needs the full 12-step rebuild of `copy`, which carries a
-- self-referencing FK, two FKs out, **two triggers from 0002 that a rebuild
-- drops silently**, five indexes and 821 live rows. Migration 0002 already hit
-- this wall and chose triggers over a CHECK for exactly this reason.
--
-- So `status` keeps its five values, `sold` means "no longer ours", and
-- `disposal` says which flavour. The distinction the owner asked for — sold vs
-- given away — is a *reason*, not a state: both mean the same thing about
-- ownership, and only the history has to read truthfully later.
--
-- ⚠️ The cost, stated plainly: a copy that was given away carries
-- `status = 'sold'`. Nothing shows that word to a human — the UI reads
-- `disposal` and prints "given away" — but a hand-written SQL query will see it.
-- Option A (rebuild, one status per real-world state) remains available and is
-- what to do if the owner would rather pay for the cleaner vocabulary.
--
-- ## 2. Why `lost` is here from the start
--
-- Cheap now, annoying to backfill once rows exist. Same argument as splitting
-- 'sold' from 'given_away' at all.
--
-- ## 3. Why the history table does NOT cascade  (§4)
--
-- This is the whole feature and the one trap. `copy` cascades from `item`, so
-- the obvious `ON DELETE CASCADE` would mean deleting a game erases the record
-- that you ever owned or sold it — the single fact this table exists to keep.
-- Hence SET NULL on both FKs, **plus a denormalised `item_name`**, so a deleted
-- game still reads as "Catan — given away to Dave, 2026-03-04" rather than
-- "item 41". Same reasoning as `game_component.stale_at`: a row vanishing is
-- indistinguishable from the thing never having happened.

-- The reason a copy left, when it did. NULL for every copy that is still ours,
-- which is all 821 of them today.
--
-- CHECK on ADD COLUMN is legal and has precedent here: 0022 added
-- `game_component.manual_state` exactly this way. It is `status`'s partner and
-- not its replacement — see the route-level rule that refuses a `disposal` on a
-- copy that is not `sold`, and a `sold` copy with no `disposal`.
ALTER TABLE copy ADD COLUMN disposal TEXT
  CHECK (disposal IS NULL OR disposal IN ('sold', 'given_away', 'lost'));

-- Every status a copy has ever been in, and what happened at each change.
--
-- A status column cannot answer "we had this from March to August": setting
-- 'sold' OVERWRITES 'owned', and the fact is gone the moment it is recorded.
CREATE TABLE copy_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ⚠️ SET NULL, never CASCADE. See the header. The row outlives the copy.
  copy_id     INTEGER REFERENCES copy(id) ON DELETE SET NULL,
  -- ⚠️ SET NULL for the same reason, and it is the one that bites: `copy`
  -- cascades from `item`, so deleting a game would otherwise take its whole
  -- history with it through two hops.
  item_id     INTEGER REFERENCES item(id) ON DELETE SET NULL,
  -- Denormalised on purpose. Both ids above can become NULL, and an event that
  -- cannot name what it was about is not a history, it is a timestamp.
  item_name   TEXT    NOT NULL,
  -- NULL on the first event of a copy's life — it came from nowhere.
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  disposal    TEXT    CHECK (disposal IS NULL OR disposal IN ('sold', 'given_away', 'lost')),
  -- Who bought it / who has it. ⚠️ Free text, NOT a user id: 0001_init says
  -- "one joint collection; no per-person ownership", and this is a person
  -- outside the household by definition.
  counterpart TEXT,
  -- What a disposal fetched. ⚠️ Not an accounting feature — nothing may sum
  -- this into a portfolio (docs/info/copy-status-history.md §7).
  price_cents INTEGER,
  note        TEXT,
  at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- "What happened to this game" and "what happened to this copy" are the two
-- questions asked, both newest-first.
CREATE INDEX idx_copy_event_item ON copy_event(item_id, at);
CREATE INDEX idx_copy_event_copy ON copy_event(copy_id, at);

-- ---------------------------------------------------------------------------
-- Append-only, enforced by the database rather than by a comment.
--
-- §7: "Re-acquiring. Buying something back is a new copy plus a new event, not
-- an edit to the old one. History is append-only." A rule that matters gets
-- promoted from prose to a mechanical guard, so here it is one. To retire it,
-- write a migration that drops these triggers — deliberately more work than
-- typing a DELETE.
-- ---------------------------------------------------------------------------

CREATE TRIGGER copy_event_append_only_delete
BEFORE DELETE ON copy_event
BEGIN
  SELECT RAISE(ABORT, 'copy_event is append-only: history is never deleted');
END;

-- ⚠️ **This one CANNOT be a blanket abort**, and that is the whole subtlety.
-- The two FKs above are `ON DELETE SET NULL`, which is an UPDATE of this table.
-- SQLite does not fire triggers for foreign-key actions unless
-- `recursive_triggers` is on — but that is a *pragma*, it is not ours to
-- promise on D1, and a blanket abort would turn "delete a copy" into a hard
-- error on any day that pragma changed. So the trigger permits exactly the
-- shape a SET NULL makes (an id going to NULL, nothing else moving) and
-- refuses every other edit.
CREATE TRIGGER copy_event_append_only_update
BEFORE UPDATE ON copy_event
WHEN NOT (
      NEW.id          IS OLD.id
  AND NEW.item_name   IS OLD.item_name
  AND NEW.from_status IS OLD.from_status
  AND NEW.to_status   IS OLD.to_status
  AND NEW.disposal    IS OLD.disposal
  AND NEW.counterpart IS OLD.counterpart
  AND NEW.price_cents IS OLD.price_cents
  AND NEW.note        IS OLD.note
  AND NEW.at          IS OLD.at
  AND (NEW.copy_id IS OLD.copy_id OR NEW.copy_id IS NULL)
  AND (NEW.item_id IS OLD.item_id OR NEW.item_id IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'copy_event is append-only: an event is never edited');
END;
