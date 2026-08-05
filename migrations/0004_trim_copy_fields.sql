-- Trim the copy table down to what we actually record.
--
-- 0001 modelled a copy the way an insurance inventory would: where it lives,
-- what condition it's in, what it cost, who sold it, when it was bought. In
-- practice none of that got filled in — the questions we ask of this catalog
-- are "do we own it?", "how many?" and "who has it right now?", and the six
-- columns below only ever added fields to skip past in the form.
--
-- `created_at` stays and now does the one job `acquired_on` was reaching for:
-- it is the date the copy joined the collection, and the database sets it, so
-- nobody has to remember to.
--
-- Safe to apply: checked immediately before running, production held exactly one
-- copy (King of Tokyo: Duel, added by the first real barcode scan) and every
-- column dropped below was NULL on it — only `currency` held its 'USD' default.
-- Nothing real is lost. If you are applying this to some other database, check
-- what you would be dropping first with
--   SELECT COUNT(*) FROM copy
--    WHERE location IS NOT NULL OR acquired_on IS NOT NULL
--       OR price_paid_cents IS NOT NULL OR vendor IS NOT NULL
--       OR condition IS NOT NULL;
--
-- The index goes first: SQLite refuses to DROP COLUMN while a column is
-- referenced by an index, so dropping `location` fails unless idx_copy_location
-- is gone. The CHECK constraint on `condition` is a column constraint and
-- leaves with the column.

DROP INDEX IF EXISTS idx_copy_location;

ALTER TABLE copy DROP COLUMN location;
ALTER TABLE copy DROP COLUMN acquired_on;
ALTER TABLE copy DROP COLUMN price_paid_cents;
ALTER TABLE copy DROP COLUMN currency;
ALTER TABLE copy DROP COLUMN vendor;
ALTER TABLE copy DROP COLUMN condition;
