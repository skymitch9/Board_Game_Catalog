# BGG audit — decision sheet

> **Audience:** the owner, then Claude. **Status:** transient — delete once applied.
> Generated 2026-08-08 from `bgg-audit-2026-08-08.tsv` (806 rows, the full map).

Three decisions. Nothing here has been applied.

| # | Decision | Rows |
|---|---|---|
| 1 | Apply the high-confidence `bgg_id` matches? | 35 |
| 2 | Item **114** — is `403511` the Deadpool *deluxe* box or the standard? | 1 |
| 3 | Item **496** — is our row the whole *Yeti or Not* game, or the exclusive edition? | 1 |

Why it matters: completeness uses `bgg_id` to ask BoardGameGeek what expansions exist,
so a wrong id makes one game claim another's components. A missing id only means
"no data". That asymmetry is why the bar is high and why nothing was auto-applied.

---

## 1. Proposed matches, score >= 0.85

**23 exact name matches (score 1.00).** Nothing to judge — the names are identical.

| id | ours | BGG id | own |
|---|---|---|---|
| 90 | Deep Rock Galactic: Rival Incursion | 450336 | yes |
| 152 | Super Boss Monster: Combo Pack | 454604 | — |
| 153 | Risk of Rain: The Board Game - Survivors of the Void Expansion | 452174 | — |
| 154 | Risk of Rain: The Board Game - Seekers of the Storm Expansion | 452175 | — |
| 155 | Risk of Rain: The Board Game - Gup Containment Expansion | 452176 | — |
| 169 | Deep Rock Galactic: Horrors of Hoxxes Acrylic Tokens | 474536 | yes |
| 170 | Deep Rock Galactic: Rival Incursion Acrylic Tokens | 474537 | yes |
| 176 | Dice Throne Outcasts: Promo Pack | 457577 | yes |
| 201 | Iliad: Deluxe Wood Tiles | 465335 | yes |
| 202 | Iliad: Deluxe Token Pedestal | 465336 | yes |
| 203 | Ichor: Reinforcements & Gates Expansion | 436368 | yes |
| 204 | Ichor: Deluxe Acrylic Standees | 465340 | yes |
| 206 | Ichor: Deluxe Resin Discs | 465342 | yes |
| 278 | Casting Shadows: Card Sleeves | 404827 | yes |
| 304 | Aeon's End: Return to Gravehold | 318951 | yes |
| 306 | Realm of Reckoning: Playmat | 462754 | yes |
| 307 | Realm of Reckoning: Metal Coins | 462756 | yes |
| 308 | Realm of Reckoning: Metal Monuments | 462757 | yes |
| 309 | Realm of Reckoning: Screen-Printed Cloth Bags | 462759 | yes |
| 345 | Altera: 5+6 Player Expansion | 473169 | — |
| 462 | Here to Slay: Dragon Class Meeple Set | 369124 | yes |
| 554 | Mythic Mischief: Layout Cards | 431603 | — |
| 809 | Deep Rock Galactic: Horrors of Hoxxes | 450406 | yes |

**12 differ slightly.** The difference is shown so you can strike any individually.

| id | ours | BGG name | score | own |
|---|---|---|---|---|
| 181 | Tend: 12-Player Expansion | Tend: 7-12 Player Expansion (466553) | 0.89 | yes |
| 238 | Command of Nature: Sand & Wind Expansion | Command of Nature: Sand & Wind (392144) | 0.89 | yes |
| 255 | Slay the Spire: Metal Coins & Merchant Bag | Slay the Spire: Merchant Bag & Metal Coins (440471) | 0.87 | yes |
| 288 | The Binding of Isaac: Four Souls+ Expansion | The Binding of Isaac: Four Souls + (269477) | 0.87 | yes |
| 305 | Realm of Reckoning: New Foundations Expansion | Realm of Reckoning: New Foundations (471458) | 0.87 | yes |
| 321 | Boss Monster: Tools of Hero-kind | Boss Monster: Tools of Hero-Kind (133772) | 0.88 | yes |
| 322 | Boss Monster: Crash Landing | Boss Monster: Crash Landing (202831) | 0.88 | yes |
| 323 | Boss Monster: Implements of Destruction | Boss Monster: Implements of Destruction (225319) | 0.88 | yes |
| 324 | Boss Monster: Vault of Villains | Boss Monster: Vault of Villains (310974) | 0.88 | yes |
| 353 | Mystic Moon: Full Moon Box Set | Mystic Moon: Full Moon Box Set (455743) | 0.93 | yes |
| 451 | Moonrakers: Gold Holo Moro Mada | Moonrakers: Gold Holo Moro Mada (388050) | 0.94 | yes |
| 497 | Twisted Cryptids: Nostalgic Wilderness Board | Twisted Cryptids: The Nostalgic Wilderness Board (430245) | 0.87 | yes |

### The SQL, if you approve

```sql
UPDATE item SET bgg_id = 450336, updated_at = datetime('now') WHERE id = 90 AND bgg_id IS NULL;  -- Deep Rock Galactic: Rival Incursion
UPDATE item SET bgg_id = 454604, updated_at = datetime('now') WHERE id = 152 AND bgg_id IS NULL;  -- Super Boss Monster: Combo Pack
UPDATE item SET bgg_id = 452174, updated_at = datetime('now') WHERE id = 153 AND bgg_id IS NULL;  -- Risk of Rain: The Board Game - Survivors of the Void Expansion
UPDATE item SET bgg_id = 452175, updated_at = datetime('now') WHERE id = 154 AND bgg_id IS NULL;  -- Risk of Rain: The Board Game - Seekers of the Storm Expansion
UPDATE item SET bgg_id = 452176, updated_at = datetime('now') WHERE id = 155 AND bgg_id IS NULL;  -- Risk of Rain: The Board Game - Gup Containment Expansion
UPDATE item SET bgg_id = 474536, updated_at = datetime('now') WHERE id = 169 AND bgg_id IS NULL;  -- Deep Rock Galactic: Horrors of Hoxxes Acrylic Tokens
UPDATE item SET bgg_id = 474537, updated_at = datetime('now') WHERE id = 170 AND bgg_id IS NULL;  -- Deep Rock Galactic: Rival Incursion Acrylic Tokens
UPDATE item SET bgg_id = 457577, updated_at = datetime('now') WHERE id = 176 AND bgg_id IS NULL;  -- Dice Throne Outcasts: Promo Pack
UPDATE item SET bgg_id = 466553, updated_at = datetime('now') WHERE id = 181 AND bgg_id IS NULL;  -- Tend: 12-Player Expansion
UPDATE item SET bgg_id = 465335, updated_at = datetime('now') WHERE id = 201 AND bgg_id IS NULL;  -- Iliad: Deluxe Wood Tiles
UPDATE item SET bgg_id = 465336, updated_at = datetime('now') WHERE id = 202 AND bgg_id IS NULL;  -- Iliad: Deluxe Token Pedestal
UPDATE item SET bgg_id = 436368, updated_at = datetime('now') WHERE id = 203 AND bgg_id IS NULL;  -- Ichor: Reinforcements & Gates Expansion
UPDATE item SET bgg_id = 465340, updated_at = datetime('now') WHERE id = 204 AND bgg_id IS NULL;  -- Ichor: Deluxe Acrylic Standees
UPDATE item SET bgg_id = 465342, updated_at = datetime('now') WHERE id = 206 AND bgg_id IS NULL;  -- Ichor: Deluxe Resin Discs
UPDATE item SET bgg_id = 392144, updated_at = datetime('now') WHERE id = 238 AND bgg_id IS NULL;  -- Command of Nature: Sand & Wind Expansion
UPDATE item SET bgg_id = 440471, updated_at = datetime('now') WHERE id = 255 AND bgg_id IS NULL;  -- Slay the Spire: Metal Coins & Merchant Bag
UPDATE item SET bgg_id = 404827, updated_at = datetime('now') WHERE id = 278 AND bgg_id IS NULL;  -- Casting Shadows: Card Sleeves
UPDATE item SET bgg_id = 269477, updated_at = datetime('now') WHERE id = 288 AND bgg_id IS NULL;  -- The Binding of Isaac: Four Souls+ Expansion
UPDATE item SET bgg_id = 318951, updated_at = datetime('now') WHERE id = 304 AND bgg_id IS NULL;  -- Aeon's End: Return to Gravehold
UPDATE item SET bgg_id = 471458, updated_at = datetime('now') WHERE id = 305 AND bgg_id IS NULL;  -- Realm of Reckoning: New Foundations Expansion
UPDATE item SET bgg_id = 462754, updated_at = datetime('now') WHERE id = 306 AND bgg_id IS NULL;  -- Realm of Reckoning: Playmat
UPDATE item SET bgg_id = 462756, updated_at = datetime('now') WHERE id = 307 AND bgg_id IS NULL;  -- Realm of Reckoning: Metal Coins
UPDATE item SET bgg_id = 462757, updated_at = datetime('now') WHERE id = 308 AND bgg_id IS NULL;  -- Realm of Reckoning: Metal Monuments
UPDATE item SET bgg_id = 462759, updated_at = datetime('now') WHERE id = 309 AND bgg_id IS NULL;  -- Realm of Reckoning: Screen-Printed Cloth Bags
UPDATE item SET bgg_id = 133772, updated_at = datetime('now') WHERE id = 321 AND bgg_id IS NULL;  -- Boss Monster: Tools of Hero-kind
UPDATE item SET bgg_id = 202831, updated_at = datetime('now') WHERE id = 322 AND bgg_id IS NULL;  -- Boss Monster: Crash Landing
UPDATE item SET bgg_id = 225319, updated_at = datetime('now') WHERE id = 323 AND bgg_id IS NULL;  -- Boss Monster: Implements of Destruction
UPDATE item SET bgg_id = 310974, updated_at = datetime('now') WHERE id = 324 AND bgg_id IS NULL;  -- Boss Monster: Vault of Villains
UPDATE item SET bgg_id = 473169, updated_at = datetime('now') WHERE id = 345 AND bgg_id IS NULL;  -- Altera: 5+6 Player Expansion
UPDATE item SET bgg_id = 455743, updated_at = datetime('now') WHERE id = 353 AND bgg_id IS NULL;  -- Mystic Moon: Full Moon Box Set
UPDATE item SET bgg_id = 388050, updated_at = datetime('now') WHERE id = 451 AND bgg_id IS NULL;  -- Moonrakers: Gold Holo Moro Mada
UPDATE item SET bgg_id = 369124, updated_at = datetime('now') WHERE id = 462 AND bgg_id IS NULL;  -- Here to Slay: Dragon Class Meeple Set
UPDATE item SET bgg_id = 430245, updated_at = datetime('now') WHERE id = 497 AND bgg_id IS NULL;  -- Twisted Cryptids: Nostalgic Wilderness Board
UPDATE item SET bgg_id = 431603, updated_at = datetime('now') WHERE id = 554 AND bgg_id IS NULL;  -- Mythic Mischief: Layout Cards
UPDATE item SET bgg_id = 450406, updated_at = datetime('now') WHERE id = 809 AND bgg_id IS NULL;  -- Deep Rock Galactic: Horrors of Hoxxes
```

The `AND bgg_id IS NULL` guard makes each statement idempotent and stops it
overwriting anything that gained an id in the meantime.

**Reversal:**

```sql
UPDATE item SET bgg_id = NULL WHERE id IN (
  90, 152, 153, 154, 155, 169, 170, 176, 181, 201, 202, 203, 204, 206, 238, 255, 278, 288, 304, 305, 306, 307, 308, 309, 321, 322, 323, 324, 345, 353, 451, 462, 497, 554, 809
);
```

---

## 2 & 3. The five SUSPECT rows

Existing ids where BoardGameGeek disagrees. **No replacements are proposed** — a
flag is a complete finding, and swapping a correct id for a differently-correct one
is exactly the change you said not to make.

| id | ours | current id | BGG says | verdict |
|---|---|---|---|---|
| 56 | Magic Number | 432512 | Magic Number: The Party Game of Wild Guesstimation | |
| 68 | Savage | 360259 | Savage: A Game of Survival | |
| 114 | Dice Throne: Deadpool Box Deluxe Edition | 403511 | Marvel Dice Throne: Deadpool | |
| 496 | Yeti or Not: Exclusive Edition Expansion | 449715 | Twisted Cryptids: Yeti or Not | |
| 801 | Go Fish | 7682 | Go Fish | |

**Three are noise:**

- **801 Go Fish** — publisher reads `Traditional`, which is the deliberate folk-game
  marker from the handoff, not an error. Leave it.
- **56 Magic Number** — BGG carries a longer subtitle. Id looks right.
- **68 Savage** — BGG spells the publisher `Grinly Games`, we have `Grinley Games`.
  One of the two has a typo; worth knowing which, but the id is fine.

**Two need you, and only you can answer them:**

- ⚠️ **114 Dice Throne: Deadpool Box Deluxe Edition** — BGG's `403511` is named
  *Marvel Dice Throne: Deadpool* and typed `boardgameexpansion`, while we call it
  `base`. Is the id pointing at the deluxe box you own, or at the standard release?
- ⚠️ **496 Yeti or Not: Exclusive Edition Expansion** — BGG's `449715` is
  *Twisted Cryptids: Yeti or Not*, the game itself. Earlier research found
  "Kickstarter exclusive edition" is a **version** of that entry, not a separate one.
  So the id may well be right and our *name* the misleading part.

---

## Not proposed, but worth a sit-down later

**A 20-row false-negative list** (19 owned, mostly expansions) rejected purely because
of words like "KS Exclusive", "Pack" and "Set". Eight are Dice Throne heroes, where we
say `Dice Throne Hero: X` and BGG says `Dice Throne: X – Hero Pack`.

⚠️ **Do not fix this by adding `pack` to the generic-word list.** Row **277**
*Casting Shadows: Expansion Pack* sits in the same table and its "match" is the base
game. Same textual pattern, ~19 right answers and one genuine trap — only a person can
separate them. See the worklist in `bgg-audit-2026-08-08.md`.

## What the audit rejected on purpose

323 of the 466 UNMATCHED rows carry a **named** near-miss. The gate is
`isFragmentOf` false **and** similarity >= 0.7 (`MIN_SPINE_SIMILARITY`, the unattended
threshold — not the forgiving 0.34 used when a human is watching).

Item **250** *Fractured Sky: Holofoil Box* is the case that proves it works:
`rejected 370581 "Fractured Sky" — same family, different product`. Writing that id
would have made a holofoil box claim the base game's identity.
