-- `item.series` — the line a box belongs to, without moving the box.
--
-- Dice Throne is 11 of 114 top-level entries and 147 of 739 rows: about a tenth
-- of the collection page, and the single line that dominates it. The obvious
-- fix — one "Dice Throne" parent above the eleven boxes — was measured and
-- rejected, and the reasoning is in `docs/dice-throne-shape.md`. In short:
-- search in this app matches whole *trees*, deliberately, so that finding an
-- expansion surfaces the game it belongs to. That is right at 26 rows and wrong
-- at 147 — every Dice Throne hit would return the entire line, which is worse
-- for exactly the question the owner asks ("do I already have Scarlet Witch?").
-- "Dice Throne" is also not a thing anyone owns.
--
-- So the trees are left exactly as they are and the line becomes a *column*.
-- The collection page folds a series into one entry and offers it as a filter;
-- opening it gives the eleven boxes back, unchanged.
--
-- Free text, like `game_system`, and for the same reason: the space of series
-- is open, and an enum would be rewritten every time a new one arrived. The
-- filter dropdown is built from the values actually in use, so nothing has to
-- be typed twice.
--
-- Only Dice Throne is set. Ascension and Deep Rock Galactic will want the same
-- treatment and are deliberately left alone — inventing a series for a line
-- nobody has agreed on is how a free-text column becomes a mess.
--
-- The eleven ids are the Dice Throne boxes, and the rows are selected by
-- `root_game_id` so every hero, playmat and dice tray beneath them travels with
-- its box. Verified against production on 2026-08-06: 147 rows.

ALTER TABLE item ADD COLUMN series TEXT;

-- Grouping reads this per root, and the filter matches it exactly.
CREATE INDEX idx_item_series ON item(series);

UPDATE item
   SET series = 'Dice Throne'
 WHERE root_game_id IN (35, 88, 92, 96, 104, 114, 115, 676, 677, 678, 679);
