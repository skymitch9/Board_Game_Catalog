-- A `viewer` role: reads the collection, and does nothing else.
--
-- `rater` was the only other role that can read, and it also carries `rate`.
-- The people being let in to look at the collection were never being asked to
-- score it, so handing out `rater` would have granted a capability nobody
-- wanted, on the one table that stores a per-person opinion.
--
-- SQLite cannot alter a CHECK constraint, so `app_user` is redefined.
--
-- ⚠️ **THIS IS NOT THE REBUILD MIGRATION 0018 DID, AND COPYING THAT ONE HERE
-- WOULD DESTROY DATA.** 0018 could `DROP TABLE research_run` safely for exactly
-- one reason, stated in its own header: the table was empty in every
-- environment. `app_user` is not empty, and five columns in four tables point at
-- it. `DROP TABLE` on a parent performs an implicit `DELETE FROM`, and that
-- fires foreign key actions:
--
--   user_item.user_id            ON DELETE CASCADE   -> every rating row DELETED
--   play.logged_by_user_id       ON DELETE SET NULL  -> nulled
--   research_run.triggered_by    ON DELETE SET NULL  -> nulled (46 rows in prod)
--   research_finding.reviewed_by ON DELETE SET NULL  -> nulled
--   app_user.approved_by         ON DELETE SET NULL  -> nulled (self-reference)
--
-- Measured on the local D1 rather than assumed, with throwaway tables of the
-- same shape. Two ways of dodging it were tried and **both lost the data**:
--
--   PRAGMA defer_foreign_keys = ON   -> 0 of 3 child links survived
--   PRAGMA legacy_alter_table = ON   -> 0 of 3 links, 0 of 2 cascade rows
--     (D1 does not honour it, so the RENAME repointed the children at the old
--      table and the DROP then cascaded through them)
--
-- D1 does not support `PRAGMA foreign_keys = OFF` either. So the values are
-- stashed before the rebuild and put back after, which depends on no pragma at
-- all and is checkable by counting rows on both sides.
--
-- The self-reference is the subtle one: `app_user_new.approved_by` references
-- `app_user` **by name**, which is still the old table when `DROP` runs — so the
-- new table's own column is nulled too, before the rename makes it
-- self-referential. It is restored from the same stash as the rest.

-- 1. Stash everything the rebuild is about to break.
--    user_item is CASCADE, so whole rows have to survive, not just a column.
CREATE TABLE _mig23_user_item AS SELECT * FROM user_item;
CREATE TABLE _mig23_play     AS SELECT id, logged_by_user_id FROM play             WHERE logged_by_user_id IS NOT NULL;
CREATE TABLE _mig23_run      AS SELECT id, triggered_by      FROM research_run     WHERE triggered_by      IS NOT NULL;
CREATE TABLE _mig23_finding  AS SELECT id, reviewed_by       FROM research_finding WHERE reviewed_by       IS NOT NULL;
CREATE TABLE _mig23_approved AS SELECT id, approved_by       FROM app_user         WHERE approved_by       IS NOT NULL;

-- 2. Rebuild with the widened CHECK. Column order matches 0001 exactly; ids are
--    carried across unchanged, because every stash above is keyed on them.
CREATE TABLE app_user_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  display_name   TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'rater', 'viewer', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

INSERT INTO app_user_new (id, email, display_name, role, first_seen_at, approved_at, approved_by)
  SELECT id, email, display_name, role, first_seen_at, approved_at, approved_by FROM app_user;

DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- 3. Put back what the implicit DELETE took.
INSERT INTO user_item SELECT * FROM _mig23_user_item;

UPDATE play SET logged_by_user_id =
  (SELECT s.logged_by_user_id FROM _mig23_play s WHERE s.id = play.id)
  WHERE id IN (SELECT id FROM _mig23_play);

UPDATE research_run SET triggered_by =
  (SELECT s.triggered_by FROM _mig23_run s WHERE s.id = research_run.id)
  WHERE id IN (SELECT id FROM _mig23_run);

UPDATE research_finding SET reviewed_by =
  (SELECT s.reviewed_by FROM _mig23_finding s WHERE s.id = research_finding.id)
  WHERE id IN (SELECT id FROM _mig23_finding);

UPDATE app_user SET approved_by =
  (SELECT s.approved_by FROM _mig23_approved s WHERE s.id = app_user.id)
  WHERE id IN (SELECT id FROM _mig23_approved);

-- 4. The indexes on user_item survive (they belong to that table, which was
--    never dropped — only emptied). app_user itself carries none beyond the
--    implicit UNIQUE on email, which the new definition repeats.
DROP TABLE _mig23_user_item;
DROP TABLE _mig23_play;
DROP TABLE _mig23_run;
DROP TABLE _mig23_finding;
DROP TABLE _mig23_approved;
