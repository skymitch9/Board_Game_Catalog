-- Owner-approved games-side writes, 2026-08-15 (estate orphan sweep).
-- Audit trail: docs/dcc-series-and-lotr-parent-2026-08-15-snapshot.json holds the
-- prior value of every column below. This repo has no change_log table.

-- 1. The Dungeon Crawler Carl product line (29 rows, series was NULL on all).
UPDATE item SET series = 'Dungeon Crawler Carl', updated_at = datetime('now') WHERE id IN (570, 571, 572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594, 595, 596, 597, 598) AND series IS NULL;

-- 2. Un-parent 'The Lord of the Rings Roleplaying' from the 2014 DM's Guide.
--    A standalone licensed RPG, not a supplement to the core book.
UPDATE item SET kind = 'base', parent_item_id = NULL, root_game_id = 665, updated_at = datetime('now') WHERE id = 665 AND parent_item_id = 621;
