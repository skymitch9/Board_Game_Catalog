-- One barcode, one printing.
--
-- 0001 created this index non-unique, which made linkBarcode()'s "is this
-- barcode taken?" check advisory only: two confirmations racing each other both
-- passed the check and both wrote, and findByBarcode()'s LIMIT 1 then resolved
-- that barcode to whichever row SQLite felt like returning. Silently wrong, and
-- invisible in the UI.
--
-- With the index unique the database refuses the second write, so BarcodeConflict
-- becomes a real guarantee rather than a hopeful one.
--
-- The predicate excludes '' as well as NULL: linkBarcode treats an empty string
-- as "no barcode yet" (see its free-edition query), so several editions can
-- legitimately hold '' and a NULL-only predicate would collide on them.
--
-- Safe to apply: production held 0 editions and 0 barcodes when this was written.
-- If that has changed, find duplicates first with
--   SELECT barcode, COUNT(*) c FROM edition
--    WHERE barcode IS NOT NULL AND barcode != ''
--    GROUP BY barcode HAVING c > 1;

DROP INDEX IF EXISTS idx_edition_barcode;

CREATE UNIQUE INDEX idx_edition_barcode
    ON edition(barcode)
 WHERE barcode IS NOT NULL AND barcode != '';
