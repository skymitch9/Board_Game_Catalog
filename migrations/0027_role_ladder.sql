-- Role ladder redesign: guest < member < contributor < moderator < admin < owner.
--
-- Owner-approved role matrix (2026-08-16, "Role matrix approved"). Renames
-- three existing roles and adds two new rungs nobody is migrated into
-- automatically:
--
--   viewer  -> guest         same rung, new name (read only)
--   rater   -> member        same rung, new name (read + rate + suggest the
--                             wishlist)
--   manager -> moderator     same rung, new name — every capability `manager`
--                             held, `moderator` still holds (packages/core/src/
--                             capabilities.ts), plus the two new cost-gated
--                             scan capabilities. Nobody loses anything.
--   (new)      contributor   nobody starts here; granted by hand
--   (new)      admin         nobody starts here; granted by hand, and only by
--                             `owner` — see `canGrantRole` in capabilities.ts
--
-- `pending` is untouched — a status, not a rung, and stays out of every ladder
-- comparison (see `ROLE_LADDER` in packages/core/src/constants.ts).
--
-- SQLite cannot alter a CHECK constraint, so `app_user` is rebuilt exactly as
-- 0023 and 0024 did — read 0023's header for the full story of why. The short
-- version, repeated because it is the part that loses data if skipped:
-- `DROP TABLE` on a parent performs an implicit `DELETE FROM`, which fires
-- foreign key actions; D1 supports no pragma escape from that (`defer_
-- foreign_keys` and `legacy_alter_table` were both measured and both lost
-- rows in 0023); so every value a cascade or a SET NULL would touch is
-- stashed before the rebuild and put back after:
--
--   user_item.user_id            ON DELETE CASCADE   -> every rating row DELETED
--   play.logged_by_user_id       ON DELETE SET NULL  -> nulled
--   research_run.triggered_by    ON DELETE SET NULL  -> nulled
--   research_finding.reviewed_by ON DELETE SET NULL  -> nulled
--   app_user.approved_by         ON DELETE SET NULL  -> nulled (self-reference)
--
-- ⚠️ Two columns that did not exist at 0023/0024 now do — `estate_status` and
-- `estate_checked_at` (migration 0026). They carry no CHECK and no FK of their
-- own, so they need no stash of their own either: they ride across in the
-- column list exactly like `first_seen_at` or `display_name` always have.
--
-- The role rename happens in the same INSERT that does the rebuild, via a
-- CASE, rather than as a separate UPDATE afterwards — one pass over the table
-- instead of two, and no window where the new CHECK is live but the old
-- values still violate it.

-- 1. Stash everything the rebuild is about to break.
--    user_item is CASCADE, so whole rows have to survive, not just a column.
CREATE TABLE _mig27_user_item AS SELECT * FROM user_item;
CREATE TABLE _mig27_play     AS SELECT id, logged_by_user_id FROM play             WHERE logged_by_user_id IS NOT NULL;
CREATE TABLE _mig27_run      AS SELECT id, triggered_by      FROM research_run     WHERE triggered_by      IS NOT NULL;
CREATE TABLE _mig27_finding  AS SELECT id, reviewed_by       FROM research_finding WHERE reviewed_by       IS NOT NULL;
CREATE TABLE _mig27_approved AS SELECT id, approved_by       FROM app_user         WHERE approved_by       IS NOT NULL;

-- 2. Rebuild with the widened CHECK, carrying the two 0026 columns across
--    unchanged. Column order matches 0026 exactly; ids are carried across
--    unchanged, because every stash above is keyed on them.
CREATE TABLE app_user_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT    NOT NULL UNIQUE,
  display_name       TEXT,
  role               TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (role IN ('owner', 'admin', 'moderator', 'contributor', 'member', 'guest', 'pending')),
  first_seen_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at        TEXT,
  approved_by        INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  estate_status      TEXT,
  estate_checked_at  TEXT
);

INSERT INTO app_user_new (id, email, display_name, role, first_seen_at, approved_at, approved_by, estate_status, estate_checked_at)
  SELECT id, email, display_name,
         CASE role
           WHEN 'viewer'  THEN 'guest'
           WHEN 'rater'   THEN 'member'
           WHEN 'manager' THEN 'moderator'
           ELSE role
         END,
         first_seen_at, approved_at, approved_by, estate_status, estate_checked_at
    FROM app_user;

DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- 3. Put back what the implicit DELETE took.
INSERT INTO user_item SELECT * FROM _mig27_user_item;

UPDATE play SET logged_by_user_id =
  (SELECT s.logged_by_user_id FROM _mig27_play s WHERE s.id = play.id)
  WHERE id IN (SELECT id FROM _mig27_play);

UPDATE research_run SET triggered_by =
  (SELECT s.triggered_by FROM _mig27_run s WHERE s.id = research_run.id)
  WHERE id IN (SELECT id FROM _mig27_run);

UPDATE research_finding SET reviewed_by =
  (SELECT s.reviewed_by FROM _mig27_finding s WHERE s.id = research_finding.id)
  WHERE id IN (SELECT id FROM _mig27_finding);

UPDATE app_user SET approved_by =
  (SELECT s.approved_by FROM _mig27_approved s WHERE s.id = app_user.id)
  WHERE id IN (SELECT id FROM _mig27_approved);

-- 4. Indexes on user_item survive (never dropped, only emptied). app_user
--    itself carries none beyond the implicit UNIQUE on email, repeated above.
DROP TABLE _mig27_user_item;
DROP TABLE _mig27_play;
DROP TABLE _mig27_run;
DROP TABLE _mig27_finding;
DROP TABLE _mig27_approved;
