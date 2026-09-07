# Here to Slay duplicate expansion pairs — verify + drop plan

> **Audience:** the owner and any later session that needs to undo this.
> **Status:** LOCAL WORKING NOTE (this file lives in `scratchpad/`, which is
> tracked but is not part of the `docs/` tree). The durable record is the
> `DONE.md` entry written the same session.
> **Last verified: 2026-09-07** — every row below was read from **production
> D1** (`wrangler d1 execute board-game-catalog --remote`) on that date, and the
> external evidence was fetched the same afternoon. Agent `W20-DEDUPE`.
>
> Owner order, verbatim (2026-09-07 12:00 Phoenix): *"Verify then drop
> duplicates"*.

---

## 1. The four rows, as measured

| id | name | bgg_id | kind | parent | root | year | publisher | thumbnail_url | source_url | series | created_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **294** | Here to Slay: KS Exclusive **Monster** Expansion Pack | NULL | expansion | 107 | 107 | NULL | NULL | `covers/item-294-3f228606bc1c578c.jpg` | the Kickstarter campaign | `Here to Slay` | 2026-08-05 21:36:26 |
| **862** | Here to Slay: **Monsters** Expansion | 308526 | expansion | 107 | 107 | 2020 | Unstable Games | 🔴 `covers/item-294-3f228606bc1c578c.jpg` | NULL | NULL | 2026-08-08 22:54:13 |
| **295** | Here to Slay: KS Exclusive **Dragon Sorcerers** Expansion Pack | NULL | expansion | 107 | 107 | NULL | NULL | `covers/item-295-06b2fc38c468a3be.jpg` | the Kickstarter campaign | `Here to Slay` | 2026-08-05 21:36:26 |
| **863** | Here to Slay: **Dragon Sorcerer** Expansion | 308525 | expansion | 107 | 107 | 2020 | Unstable Games | 🔴 `covers/item-295-06b2fc38c468a3be.jpg` | NULL | NULL | 2026-08-08 22:54:55 |

`description` is **NULL on all four**. `publisher_url`, `designers`,
`min_players`, `max_players`, `playtime_min`, `weight`, `game_system` and
`pending_parent_name` are NULL on all four. Base game **107 Here to Slay**
(bgg 299252, TeeTurtle, 2020) is the parent of all four.

🔴 **Each 2026-08-08 row points at the 2026-08-05 row's OWN cover object.** The
cover file names carry the item id that minted them (`item-294-…`,
`item-295-…`), so the session that inserted 862/863 had 294/295 in hand and
copied their `thumbnail_url` across. That is the direct evidence for the cause
recorded in §5.

## 2. Every child row, measured across every table that references `item(id)`

Tables checked (from the live schema, not assumed): `copy`, `copy_event`,
`edition`, `item_relation` (both directions), `item` (as `parent_item_id` and
as `root_game_id`), `game_component`, `component_check`, `item_alias`,
`alias_check`, `user_item`, `play`, `research_run`, `research_finding`.

| table | 294 | 295 | 862 | 863 |
|---|---|---|---|---|
| `copy` | **289** owned, qty 1, rich KS note | **290** owned, qty 1, rich KS note | **836** owned, qty 1, no note | **837** owned, qty 1, no note |
| `edition` | **1063** *Borrowed cover (approved exception)* | **1064** *Borrowed cover (approved exception)* | — | — |
| everything else | 0 | 0 | **0** | **0** |

The copy note on 289/290, verbatim and identical on both:

> *Kickstarter pledge: Ultimate Collector's Set. Estimated delivery Sep 2020.
> Also on BackerKit: Here to Slay (Kickstarter Exclusive Everything Bundle).
> Cover borrowed from the retail printing; the Kickstarter-exclusive edition is
> not pictured anywhere. Owner approved 2026-08-06.*

⚠️ **So the newer rows carry NOTHING the older ones lack except three scalar
fields** (`bgg_id`, `publisher`, `year_published`). No relation, no child item,
no alias, no rating, no play, no research run points at 862 or 863. Nothing has
to be re-pointed; the two duplicate `owned` copies are deleted rather than
re-pointed, because the box is owned once.

## 3. The evidence that each pair is ONE product

**Instrument 1 — BGG's own component list for Here to Slay, read out of the
`game_component` table** (no BGG token needed; the XML API answers 401 to an
agent session — `docs/info/gotchas.md`). For item 107 it holds **36** rows, and
among them exactly **one** Monsters expansion and exactly **one** Dragon
Sorcerer expansion:

| game_component.id | bgg_id | name | kind | year | publishers |
|---|---|---|---|---|---|
| 938 | **308526** | Here to Slay: Monsters Expansion | expansion | 2020 | Unstable Games |
| 935 | **308525** | Here to Slay: Dragon Sorcerer Expansion | expansion | 2020 | Unstable Games |

There is no second BGG id for a "KS exclusive" printing of either, so the KS
row and the BGG row cannot be two different products.

**Instrument 2 — sources outside this repo**, fetched 2026-09-07:

* Noble Knight Games, *"Here to Slay Expansions (Kickstarter Exclusive)"*,
  TeeTurtle, **2020** — one product comprising the two packs: *"13 oversized
  Kickstarter Exclusive Monster cards"* and *"a new class of characters (Dragon
  Sorcerers), a new Monster card, and additional Item, Magic, Challenge, and
  Modifier cards"*. **Both are identified as Kickstarter exclusives.**
  <https://www.nobleknight.com/P/2147833113/Here-to-Slay-Expansions-Kickstarter-Exclusive>
* The Game Steward's exclusives bundle names them as **"KS Exclusive Monster
  Expansion"** and **"KS Exclusive Dragon Sorcerer Expansion"** —
  the KS wording and the BGG wording on the same two boxes.
* Secondary-market listings repeat it: *"Here To Slay — Dragon Sorcerer
  Expansion 2020 Printing (Kickstarter Exclusive)"*.

⚠️ **BGG's own web pages could NOT be read** — `boardgamegeek.com` answered
**403** to `curl` with a browser UA on both `/boardgameexpansion/308525` and
`/308526`, which is the WAF, not the 401 the XML API gives. The BGG facts above
come from `game_component`, which is BGG's data already in this database.

**Verdict: both pairs are one product held twice.** Same publisher, same year,
same BGG id space, same box.

## 4. The keeper, per pair

The rule: keep the older id with the KS provenance **unless** the newer row
carries references the older lacks. Measured in §2 — it carries **none**.

| pair | KEEPER | LOSER | why |
|---|---|---|---|
| Monsters | **294** *Here to Slay: KS Exclusive Monster Expansion Pack* | **862** | older, the owner's own shelf record, the KS `source_url`, `series`, the copy note, its own cover object and an `edition` row |
| Dragon Sorcerer | **295** *Here to Slay: KS Exclusive Dragon Sorcerers Expansion Pack* | **863** | same |

**Carried onto the keeper** (the only fields the loser had and the keeper did
not): `bgg_id`, `publisher`, `year_published`. Nothing else — `thumbnail_url`
is already the same file, `description` is NULL on both, `publisher_url` is
NULL on both, and the keeper's `source_url`/`series` are strictly better.

## 5. The cause, confirmed

The 2026-08-08 accessory-implies-the-game pass (`docs/DONE.md`) inserted
861/862/863 by hand from BGG's expansion list for Here to Slay, **matching on
the BGG name and not on the rows already held under the Kickstarter names.**
The copied `thumbnail_url` (§1) proves the KS rows were on screen at the time.
The lesson is written up in `docs/info/completeness.md`.

## 6. 🔴 The cascade, and why the children are deleted explicitly

`PRAGMA foreign_keys` reads **1** on production D1, and **every** table that
references `item(id)` does so `ON DELETE CASCADE` except `copy_event`
(`SET NULL`). So `DELETE FROM item WHERE id = 862` would silently take copy
836 with it. It is deleted **first, by id**, so the row that disappears is one
this plan names rather than one the engine chose.

No trigger fires on a `copy` DELETE (the two `copy` triggers are
`BEFORE INSERT`/`BEFORE UPDATE OF quantity`; the two `copy_event` triggers
guard that table's own append-only rule). No `copy.applies_to_copy_id`
references 836, 837, 289 or 290.

⚠️ **`idx_item_bgg` is a UNIQUE index on `item(bgg_id) WHERE bgg_id IS NOT
NULL`.** The keeper's `bgg_id` therefore CANNOT be set while the loser still
holds it — the DELETE has to come before the UPDATE, and the rollback has to
undo them in the opposite order.

## 7. The SQL applied

```sql
-- 1. the two duplicate owned copies (the box is owned once, so these are
--    deleted rather than re-pointed)
DELETE FROM copy WHERE id IN (836, 837);

-- 2. the two loser items. Must precede step 3: idx_item_bgg is UNIQUE.
DELETE FROM item WHERE id IN (862, 863);

-- 3. carry the three fields only the losers had onto the keepers
UPDATE item
   SET bgg_id = 308526, publisher = 'Unstable Games', year_published = 2020,
       updated_at = datetime('now')
 WHERE id = 294 AND bgg_id IS NULL;

UPDATE item
   SET bgg_id = 308525, publisher = 'Unstable Games', year_published = 2020,
       updated_at = datetime('now')
 WHERE id = 295 AND bgg_id IS NULL;
```

## 8. 🔴 The rollback

Run the three blocks **in this order**. Step R1 must precede R2, because the
UNIQUE `bgg_id` index will refuse the INSERT while the keeper holds the id.

```sql
-- R1. give the ids back
UPDATE item
   SET bgg_id = NULL, publisher = NULL, year_published = NULL,
       updated_at = '2026-08-08 15:44:33'
 WHERE id IN (294, 295);

-- R2. recreate the two dropped items, byte for byte as they were read
--     2026-09-07 from production D1
INSERT INTO item
  (id, bgg_id, kind, parent_item_id, root_game_id, name, sort_name,
   year_published, publisher, publisher_url, designers, min_players,
   max_players, playtime_min, weight, thumbnail_url, description,
   created_at, updated_at, pending_parent_name, source_url, game_system, series)
VALUES
  (862, 308526, 'expansion', 107, 107,
   'Here to Slay: Monsters Expansion', 'here to slay: monsters expansion',
   2020, 'Unstable Games', NULL, NULL, NULL, NULL, NULL, NULL,
   'https://gamecovers.heygabi.ai/covers/item-294-3f228606bc1c578c.jpg', NULL,
   '2026-08-08 22:54:13', '2026-08-08 22:54:13', NULL, NULL, NULL, NULL),
  (863, 308525, 'expansion', 107, 107,
   'Here to Slay: Dragon Sorcerer Expansion', 'here to slay: dragon sorcerer expansion',
   2020, 'Unstable Games', NULL, NULL, NULL, NULL, NULL, NULL,
   'https://gamecovers.heygabi.ai/covers/item-295-06b2fc38c468a3be.jpg', NULL,
   '2026-08-08 22:54:55', '2026-08-08 22:54:55', NULL, NULL, NULL, NULL);

-- R3. recreate the two dropped copies
INSERT INTO copy
  (id, item_id, edition_id, applies_to_copy_id, status, is_sleeved, is_punched,
   completeness_notes, lent_to, notes, created_at, updated_at, quantity,
   format, disposal)
VALUES
  (836, 862, NULL, NULL, 'owned', 0, 0, NULL, NULL, NULL,
   '2026-08-08 22:54:13', '2026-08-08 22:54:13', 1, 'physical', NULL),
  (837, 863, NULL, NULL, 'owned', 0, 0, NULL, NULL, NULL,
   '2026-08-08 22:54:55', '2026-08-08 22:54:55', 1, 'physical', NULL);
```

⚠️ **The rollback does not restore `item.updated_at` exactly for 294/295**: both
read `2026-08-08 15:44:33` before this change, and R1 writes that literal back.
Nothing else about the two keeper rows is touched by §7.

## 9. R2 objects

**No orphan.** Both losers' `thumbnail_url` was the KEEPER's own cover object
(`item-294-3f228606bc1c578c.jpg`, `item-295-06b2fc38c468a3be.jpg`), which the
keeper still uses. 862 and 863 never had a cover object of their own, so
nothing in the `game-covers` bucket is left unreferenced by this drop, and
**no R2 object was deleted**.
