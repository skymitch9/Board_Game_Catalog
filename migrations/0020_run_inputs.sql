-- What a details run knew when it ran, so the next pass can tell whether
-- anything has changed since.
--
-- "Ask once" and "ask always" are both wrong, and for the same reason: the
-- inputs move. A 2027 pre-order asked in 2026 has nothing to find. The same box
-- asked the week it ships has a BoardGameGeek page, a publisher listing and
-- reviews. The question did not change — the world did.
--
-- So a completed run stops being a fact about the item and becomes a fact about
-- a *moment*: these were the inputs, this is what could be found from them. The
-- queue re-opens a row when one of the four inputs below now differs, and that
-- comparison costs a SQL predicate rather than a Claude call.
--
-- Why these four:
--
--   input_owned    The owner's own insight, and the strongest signal here. A
--                  `preordered` copy that becomes `owned` means the product now
--                  physically exists, so information about it can too. Stored as
--                  0/1 — "does any copy of this say we hold it" — because status
--                  lives on `copy` and an item can have several.
--   input_bgg_id   An id appearing is an entirely new source of truth. Nothing
--                  else in this catalog changes what a lookup can reach as much.
--   input_name     A corrected name is a different search. Half this collection
--                  was typed off a spine by a vision model.
--   input_year     A game listed 2027 and asked in 2026 was always coming back
--                  empty. The year arriving says it is out.
--
-- `unfilled` is the per-field half: which fields the run asked about and did not
-- find, comma-delimited *with leading and trailing commas* so an exact test is
-- `instr(unfilled, ',playtimeMin,')` with no risk of `minPlayers` matching
-- inside `maxPlayers`. It exists so that a run which found a publisher but no
-- playing time does not put the row back in the queue to be asked for the
-- publisher it already has.
--
-- Nullable throughout and added with ALTER, so the rows written before this
-- migration keep their meaning: a NULL input reads as "not recorded", and the
-- queue treats that as changed — the safe direction, since re-asking costs
-- 1.4¢ and wrongly never asking costs a game that stays blank forever.

ALTER TABLE research_run ADD COLUMN input_owned  INTEGER;
ALTER TABLE research_run ADD COLUMN input_bgg_id INTEGER;
ALTER TABLE research_run ADD COLUMN input_name   TEXT;
ALTER TABLE research_run ADD COLUMN input_year   INTEGER;
ALTER TABLE research_run ADD COLUMN unfilled     TEXT;

-- The queue asks "has this item a completed details run" once per candidate row.
CREATE INDEX IF NOT EXISTS idx_run_details_done
  ON research_run(item_id, tier, status);
