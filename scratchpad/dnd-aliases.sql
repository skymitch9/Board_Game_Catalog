-- The D&D line's spelling variants, as `item_alias` rows.  2026-08-08
--
-- Written for the owner's ask: *"add aliases to the parents so DnD, Dungeons and
-- Dragons, D&D etc all return in the search for this one."*
--
-- Idempotent — every statement is ON CONFLICT DO NOTHING, so re-running it adds
-- nothing. Applied and measured locally; **not applied to production.**
--
-- ## Which rows, and why not the other 95
--
-- 109 rows carry `series = 'D&D'`. They sit in **14 trees**, because the core
-- rulebooks were promoted to roots on 2026-08-08. Collection search matches whole
-- *trees* (`matchingRootsSql` in `packages/db/src/items.ts`), so one alias
-- anywhere in a tree surfaces that whole tree — putting the same strings on all
-- 109 rows would return exactly the same entries and cost 436 rows instead of 72.
-- The root is the row the tree is filed under and the row a result is titled
-- with, so the root is where it goes.
--
-- **Plus four roots that carry no `series` at all**: the D&D-branded board games
-- (Castle Ravenloft, Legend of Drizzt, Wrath of Ashardalon, Tomb of
-- Annihilation). They are already returned by "Dungeons & Dragons", because that
-- is literally the front of the box, and were *not* returned by "D&D" or "DnD" —
-- so without them the four spellings disagree with each other, which is the bug
-- this is fixing wearing a different hat. 18 roots, not 14.
--
-- They are matched by name rather than by id so this stays true if a fifth is
-- added; today it selects exactly 797, 798, 799 and 810.
--
-- ## Which strings, and which of them are load-bearing
--
-- Four, and only two of them add reach on their own. Measured, aliases empty vs
-- present, against a local copy of production (806 items, 171 roots):
--
--   search box              before  +series  +aliases
--   D&D                        1       14       18
--   DnD                        0        0       18
--   Dungeons and Dragons       0        0       18
--   Dungeons & Dragons         4        4       18
--
-- `D&D` and `Dungeons & Dragons` are already reachable once search matches the
-- `series` column — "&" alone satisfies `series = 'D&D'`. They are recorded
-- anyway so the identity lives in `item_alias` rather than depending on a
-- free-text column staying spelled the way it is today.
--
-- `Dungeons and Dragons` is not optional and not redundant: `searchTerms` splits
-- the box on whitespace and ANDs the words, so "and" has to be found somewhere in
-- the tree, and nothing in the D&D line contains it.
--
-- "D and D" needs no row — its terms are "d", "and", "d", all satisfied by the
-- string above.
--
-- ## What this does to the scanner: nothing, and that is by construction
--
-- `buildTitleIndex` (`packages/core/src/vision.ts`) drops an alias claimed by
-- more than one item — "a contested alias belongs to nobody". `normaliseTitle`
-- folds the four strings to three keys (`d and d`, `dnd`, `dungeons and
-- dragons` — "&" becomes " and "), and each is claimed by all 18 roots, so all
-- three are contested and none reaches `aliasKeys`. A shelf photo reading
-- "Dungeons & Dragons" is matched exactly as it is today.
--
-- ⚠️ Putting one of these strings on a *single* root is what would change
-- scanner behaviour — it would start auto-marking that one book as owned from a
-- spine reading "D&D". Spreading it across the line is what keeps it inert.
--
-- ## source = 'manual'
--
-- `replaceBggAliases` clears `source = 'bgg'` only, so a later
-- `POST /api/aliases/backfill` cannot delete these.
--
-- ## Before-state — production, read 2026-08-08 before writing anything
--
--   SELECT COUNT(*) FROM item_alias;                        -- 0
--   SELECT COUNT(*) FROM item_alias WHERE source='manual';  -- 0
--   SELECT COUNT(*) FROM alias_check;                       -- (unread, untouched)
--
-- The table is empty in production: migration 0021 is applied but the BGG
-- backfill has never been run there.
--
-- ## Reversal
--
--   DELETE FROM item_alias
--    WHERE source = 'manual'
--      AND alias IN ('D&D', 'DnD', 'Dungeons & Dragons', 'Dungeons and Dragons');
--
-- Exact while `item_alias` holds nothing else a person typed, which the
-- before-state above establishes. If the table has grown by the time this is
-- reversed, add:
--      AND item_id IN (SELECT DISTINCT root_game_id FROM item WHERE series = 'D&D'
--                      UNION SELECT root_game_id FROM item
--                             WHERE lower(name) LIKE 'dungeons & dragons%')

INSERT INTO item_alias (item_id, alias, source)
SELECT r.id, a.alias, 'manual'
  FROM (SELECT DISTINCT root_game_id AS id FROM item
         WHERE series = 'D&D' AND root_game_id IS NOT NULL
        UNION
        SELECT DISTINCT root_game_id AS id FROM item
         WHERE lower(name) LIKE 'dungeons & dragons%' AND root_game_id IS NOT NULL) r
       , (SELECT 'D&D' AS alias
          UNION ALL SELECT 'DnD'
          UNION ALL SELECT 'Dungeons & Dragons'
          UNION ALL SELECT 'Dungeons and Dragons') a
-- `WHERE true` is not decoration. SQLite cannot tell an upsert's ON CONFLICT
-- from a join's ON without a clause between them, and reports it as
-- `near "DO": syntax error`. This is the documented workaround.
 WHERE true
    ON CONFLICT(item_id, alias) DO NOTHING;
