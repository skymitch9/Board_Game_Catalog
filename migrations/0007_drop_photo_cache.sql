-- Remove the photo cache. It could not work.
--
-- The idea was to recognise a re-photographed box by perceptual hash and skip
-- the vision call. Measured against five real handheld shots of the same box
-- (Shards of Creation, 2026-08-05), the pairwise Hamming distances were:
--
--   21, 21, 26, 26, 27, 28, 29, 32, 33, 35
--
-- The matching threshold was 8. Two *random* 64-bit values average 32 bits
-- apart, so same-box shots were barely distinguishable from noise.
--
-- The reason: a difference hash is robust to brightness, scale and compression,
-- but not to framing. Every handheld shot crops and rotates a little, so the
-- 9x8 sample grid lands on different parts of the box and nearly every bit
-- flips. dHash suits "same file, re-encoded", not "same object, re-photographed".
--
-- No threshold rescues it. Loose enough to match 35 bits would match almost
-- anything, and a wrong cached reading is far worse than paying for a second
-- look — roughly half a cent and three seconds.
--
-- lookup_cache stays. Resolving a *title* is deterministic — same string in,
-- same answer out — so that one works exactly as intended.
--
-- A translation-invariant fingerprint could work, but would need proving against
-- real photos before being built. See docs/info/future-plans.md.

DROP INDEX IF EXISTS idx_photo_cache_recent;
DROP TABLE IF EXISTS photo_cache;
