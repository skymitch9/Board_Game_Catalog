-- "We have it, it just isn't a row" — a verdict a BoardGameGeek id cannot carry.
--
-- *"For dice throne everything we have has sleeves, they either came in the KS
-- or an accessory pack. For the sleeves or any accessories maybe we need a new
-- solution or a bgg link bypass."* — the owner, 2026-08-09.
--
-- **The problem is not a missing id; it is that no id exists to find.**
-- BoardGameGeek lists card sleeves per hero — `Dice Throne X-Men: Card Sleeves
-- - Wolverine`, `Dice Throne Outcasts: Card Sleeves - Raveness`, and so on. The
-- owner's sleeves arrived inside a Kickstarter box or an accessory pack and were
-- never a separate purchase, so there is no catalog row that *is* any one of
-- those products, and creating eleven rows to say "yes, sleeved" would be
-- inventing a shelf that does not exist.
--
-- Measured before building this: **5 of the 13 remaining `uncertain` rows** are
-- exactly this case, and they are unfixable by every other lever we have. One
-- row — `Dice Throne: Minimalist Card Sleeves` — is hinted against three
-- different components in three different games, which is proof on its own that
-- no id assignment can be right.
--
-- ## Why a column on `game_component` and not a new table
--
-- The verdict is *per game, per component*, which is exactly the grain of
-- `game_component` — the same id can be a component of several games and the
-- answer may differ for each. A join table would carry the same key and buy
-- nothing.
--
-- **It survives the weekly sweep for free.** `recordGameComponents` upserts on
-- `(item_id, bgg_id)` and its `DO UPDATE` touches only `name`, `kind`,
-- `last_seen_at` and `stale_at` — exactly as it already leaves `publishers`,
-- `official` and `details_at` alone. A manual verdict is the same kind of fact:
-- expensive to produce, and not BoardGameGeek's to overwrite.

-- 'have'   — we hold this, it just is not a catalog row of its own.
-- NULL     — no verdict; the normal id-and-name rules decide.
--
-- Deliberately **not** an 'ignore' value, though the CHECK could hold one. A
-- component we do not want is still a component that exists, and the promo
-- filter and the third-party split already cover the "stop showing me this"
-- cases with rules rather than one-by-one clicks. Adding a second verdict with
-- no measured need is how a column grows a vocabulary nobody remembers.
ALTER TABLE game_component ADD COLUMN manual_state TEXT
  CHECK (manual_state IS NULL OR manual_state IN ('have'));

-- Why, in the owner's words. Shown verbatim on the row, because "held" with no
-- explanation is indistinguishable from the id match this feature spent all its
-- credibility insisting on.
ALTER TABLE game_component ADD COLUMN manual_note TEXT;

-- When it was said. A verdict from before a component was re-listed is worth
-- looking at again; one from yesterday is not.
ALTER TABLE game_component ADD COLUMN manual_at TEXT;
