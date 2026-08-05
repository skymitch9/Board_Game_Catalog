-- Editions become the cover picker's data source, so they need two things
-- 0001 did not give them: a note of where a row came from, and a guarantee that
-- re-running a backfill does not double every printing.
--
-- Why this belongs on `edition` rather than in a new table: an item has several
-- known printings, each printing has a cover, and you choose which one
-- represents your copy. A Kickstarter or Gamefound edition IS a printing — it
-- sits alongside the 2019 and 2023 retail ones rather than in a mechanism of its
-- own. The table for that already existed and was simply never populated,
-- because the catalog was filled by POST /api/bgg/match/:id and direct pledge
-- inserts, both of which skip editions.

-- Where the row came from. NULL for anything written before this migration —
-- in practice the barcode linker's "Scanned printing" rows, which carry a
-- barcode and no image and are none of the picker's business.
--
--   'bgg'      — a version off the BoardGameGeek /thing?versions=1 response.
--   'campaign' — the cover an item arrived with from a crowdfunding page,
--                preserved so swapping away from it does not lose it.
--
-- Deliberately no CHECK constraint: SQLite cannot add one to an existing table
-- (see migration 0002, where `quantity >= 1` had to become a pair of triggers),
-- and a lie here is cosmetic rather than corrupting.
ALTER TABLE edition ADD COLUMN source TEXT;

-- Both backfills must be safe to re-run — the BGG one because items keep
-- gaining a bgg_id, the campaign one because covers are still being written by
-- other processes. Idempotency is enforced here rather than trusted to the
-- callers, so a future third writer cannot get it wrong.
--
-- Two partial indexes, not one, because the two kinds of row have different
-- identities. A BGG printing is identified by its version id. A campaign
-- printing has no version id at all, and is identified by the image itself —
-- which is precisely the thing being recorded.
--
-- Dedupe first. Both tables held zero rows when this was written (production
-- and local alike), so these deletes are expected to be no-ops; they exist so
-- the migration cannot fail halfway on a database that has since drifted.
DELETE FROM edition
 WHERE bgg_version_id IS NOT NULL
   AND id NOT IN (SELECT MIN(id) FROM edition
                   WHERE bgg_version_id IS NOT NULL
                   GROUP BY item_id, bgg_version_id);

DELETE FROM edition
 WHERE bgg_version_id IS NULL
   AND image_url IS NOT NULL AND image_url != ''
   AND id NOT IN (SELECT MIN(id) FROM edition
                   WHERE bgg_version_id IS NULL
                     AND image_url IS NOT NULL AND image_url != ''
                   GROUP BY item_id, image_url);

CREATE UNIQUE INDEX idx_edition_item_version
    ON edition(item_id, bgg_version_id)
 WHERE bgg_version_id IS NOT NULL;

CREATE UNIQUE INDEX idx_edition_item_image
    ON edition(item_id, image_url)
 WHERE bgg_version_id IS NULL AND image_url IS NOT NULL AND image_url != '';

-- "Which items still need their printings fetched?" is the backfill's first
-- question every run, and it asks it of every item with a bgg_id.
CREATE INDEX idx_edition_item_source ON edition(item_id, source);
