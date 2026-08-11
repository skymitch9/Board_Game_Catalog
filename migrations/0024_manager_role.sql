-- A `manager` role: everything an owner can do, except decide who is in.
--
-- Ownership had been doing two unrelated jobs — keeping the catalog, and
-- controlling the guest list. Two people were `owner` purely so that both could
-- add games, which made "who can let someone in" a question with two answers.
-- After this there is one owner, and helping with the catalog no longer
-- requires ownership.
--
-- `manager` appears in every CAPABILITY_MATRIX entry except `manageUsers`
-- (packages/core/src/capabilities.ts), including `runResearch`, which spends
-- money — that was the owner's explicit choice, recorded there.
--
-- ⚠️ THIS MIGRATION IS 0023 WITH ONE WORD CHANGED, AND THAT IS DELIBERATE.
-- Read 0023's header before touching it. The short version: SQLite cannot alter
-- a CHECK constraint, so `app_user` must be redefined; `DROP TABLE` on a parent
-- performs an implicit `DELETE FROM` which fires foreign key actions; and five
-- columns in four tables point here:
--
--   user_item.user_id            ON DELETE CASCADE   -> every rating row DELETED
--   play.logged_by_user_id       ON DELETE SET NULL  -> nulled
--   research_run.triggered_by    ON DELETE SET NULL  -> nulled
--   research_finding.reviewed_by ON DELETE SET NULL  -> nulled
--   app_user.approved_by         ON DELETE SET NULL  -> nulled (self-reference)
--
-- 0023 measured both pragma escapes on a real D1 and both LOST DATA
-- (`defer_foreign_keys`, `legacy_alter_table`), and D1 does not support
-- `foreign_keys = OFF`. So the values are stashed and put back, which depends on
-- no pragma at all. Do not "simplify" this into a plain rebuild.
--
-- The self-reference is the subtle one: `app_user_new.approved_by` references
-- `app_user` **by name**, which is still the old table when `DROP` runs, so the
-- new table's own column is nulled too before the rename makes it
-- self-referential. It is restored from the same stash as everything else.

-- 1. Stash everything the rebuild is about to break.
--    user_item is CASCADE, so whole rows have to survive, not just a column.
CREATE TABLE _mig24_user_item AS SELECT * FROM user_item;
CREATE TABLE _mig24_play     AS SELECT id, logged_by_user_id FROM play             WHERE logged_by_user_id IS NOT NULL;
CREATE TABLE _mig24_run      AS SELECT id, triggered_by      FROM research_run     WHERE triggered_by      IS NOT NULL;
CREATE TABLE _mig24_finding  AS SELECT id, reviewed_by       FROM research_finding WHERE reviewed_by       IS NOT NULL;
CREATE TABLE _mig24_approved AS SELECT id, approved_by       FROM app_user         WHERE approved_by       IS NOT NULL;

-- 2. Rebuild with the widened CHECK. Column order matches 0001 and 0023
--    exactly; ids are carried across unchanged, because every stash is keyed on
--    them. The ONLY difference from 0023 is 'manager' in the CHECK list.
CREATE TABLE app_user_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  display_name   TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'manager', 'rater', 'viewer', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

INSERT INTO app_user_new (id, email, display_name, role, first_seen_at, approved_at, approved_by)
  SELECT id, email, display_name, role, first_seen_at, approved_at, approved_by FROM app_user;

DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- 3. Put back what the implicit DELETE took.
INSERT INTO user_item SELECT * FROM _mig24_user_item;

UPDATE play SET logged_by_user_id =
  (SELECT s.logged_by_user_id FROM _mig24_play s WHERE s.id = play.id)
  WHERE id IN (SELECT id FROM _mig24_play);

UPDATE research_run SET triggered_by =
  (SELECT s.triggered_by FROM _mig24_run s WHERE s.id = research_run.id)
  WHERE id IN (SELECT id FROM _mig24_run);

UPDATE research_finding SET reviewed_by =
  (SELECT s.reviewed_by FROM _mig24_finding s WHERE s.id = research_finding.id)
  WHERE id IN (SELECT id FROM _mig24_finding);

UPDATE app_user SET approved_by =
  (SELECT s.approved_by FROM _mig24_approved s WHERE s.id = app_user.id)
  WHERE id IN (SELECT id FROM _mig24_approved);

-- 4. Indexes on user_item survive: that table was emptied, never dropped.
--    app_user carries none beyond the implicit UNIQUE on email, repeated above.
DROP TABLE _mig24_user_item;
DROP TABLE _mig24_play;
DROP TABLE _mig24_run;
DROP TABLE _mig24_finding;
DROP TABLE _mig24_approved;
