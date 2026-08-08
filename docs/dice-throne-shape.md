# Dice Throne — how should it be organised?

> **Status: BUILT (2026-08-06) — options 2 and 3, as recommended below.**
> Kept rather than deleted, because the argument against option 1 is the reason
> the code looks the way it does and would otherwise be re-litigated. Current
> state and numbers live in
> [`HANDOFF.md`](HANDOFF.md#folding-a-line-into-one-entry--built-2026-08-06).
>
> What shipped: `item.series` (migration 0019), a collection page that folds a
> series **and a `game_system`** into one entry and offers both through one
> filter, and a muted, linked parent name beside any child shown away from its
> parent. 114 entries became 93; Dice Throne's eleven cards became one. No item
> was re-parented and no item was renamed.

## The situation, measured

You are seeing **11 cards, not 50**. The 45 heroes already nest inside their
boxes and collapse by default. Dice Throne is **11 of 114** top-level entries —
about a tenth of the collection page, and easily the largest single presence,
but an order of magnitude less than it feels.

That reframes the problem. It is not "too many rows". It is **one line dominating
the page**.

| Box | Rows in group |
|---|---|
| Dice Throne: X-Men | 36 |
| Marvel Dice Throne | 26 |
| Dice Throne: Outcasts | 24 |
| Dice Throne Vanguard | 17 |
| Season Two – Battle Chest | 10 |
| Santa vs Krampus | 10 |
| Season One ReRolled | 9 |
| Deadpool Box Deluxe Edition | 5 |
| Marvel Dice Throne: Missions | 4 |
| Mystic Brawler | 4 |
| Alchemist | 2 |

**147 rows across the line.** Current shape is three levels: box → hero →
accessory.

## Two questions the structure has to serve

They pull in different directions, which is the whole difficulty.

- **"What is on my shelf?"** — the box matters. You physically pick up a box, and
  the tree currently answers this correctly. It took several corrections to get
  right (Deadpool ships with X-Men but is its own tray; Moonrakers is one box,
  not two).
- **"Do I have Scarlet Witch?"** — the hero matters and the box is incidental.

## The argument against a single "Dice Throne" parent

A parent row would make the whole line **one tree of 147 rows**.

Search in this app matches **trees**, deliberately — searching for an expansion
surfaces its base game so you get context instead of an orphaned result. That is
right at 20 rows. At 147 it means **any** Dice Throne hit returns the entire
line, which is worse for the exact case you described: checking quickly whether
you already have something.

There is a second, smaller objection. "Dice Throne" is not a thing you own. Two
rows exactly like that — the D&D edition containers — were deleted this evening
because you preferred rooting each edition at a real book you hold.

## Four options

### 1. Single Dice Throne parent — four levels

`Dice Throne → box → hero → accessory`, as you proposed.

- **Wins** the browse view: 11 cards become 1.
- **Costs** the search view: every hit returns 147 rows.
- Adds a synthetic row and a fourth level of indentation.

### 2. A `series` column

One field — `"Dice Throne"` — exactly like `game_system`, which already works
and is already filterable. The collection page groups or filters on it, so the
line reads as one entry with no structural change.

- Trees stay small, so **search stays sharp**.
- No invented rows, no re-parenting, reversible.
- Costs a migration and some collection-page work.
- Generalises: "Ascension", "Here to Slay", "Deep Rock Galactic" all get the same
  benefit later.

### 3. Show the box beside each hero

You suggested renaming heroes to *"Scarlet Witch - Marvel"*. Better not to
rename — the app can display the parent's name next to a child for free, and the
wishlist already does exactly this (`parentName`).

You would see **Scarlet Witch** with a muted *Marvel Dice Throne* beside it.

- Same benefit, nothing lost, no name to unpick later.
- Works everywhere a hero appears: search results, wishlist, completeness list.
- Small, additive change.

### 4. Synthetic "Heroes" / "Expansions" category rows

Recommended against. They are rows you do not own, and the distinction is already
carried by `kind` — heroes are `expansion`; Missions and Adventures are too, but
sit at box level because they are not hero products. If that split needs to be
visible, a filter beats two fake rows in the collection.

## Recommendation

**Options 2 and 3 together.**

A `series` column collapses Dice Throne to one line on the collection page.
Showing the parent box beside each hero makes every hero self-describing wherever
it appears.

Together they keep the current three-level structure, which correctly answers
*"what is physically in which box"* — the question that took several corrections
to get right and is the one the catalog exists to answer when you are standing in
front of the shelf.

Worth remembering that **search and the barcode scanner already answer "do I have
this?"** better than any nesting would. Typing "scarlet witch" finds her; scanning
the box answers instantly and exactly.

If the page still feels heavy afterwards, **Option 1 remains available** — it is
an insert plus a root rewrite, and reversible.

## Open, unrelated to shape

- Every Dice Throne page will list **~56 `same_family` relatives**. Dropping the
  45 hero→box links leaves the 11 boxes linked to each other and shortens the
  section, with no real loss: you still reach the family from any hero via its
  box.

---

## The paradigm as the data actually expresses it — read back 2026-08-08

Everything above describes the *decision*. When a second line was asked to
"match the paradigm of Dice Throne" (Unstable Unicorns, below), the shape had to
be read out of production, and it turns out to have **three** ingredients, not
the two this document recommends. Measured against production D1:

| Ingredient | What Dice Throne does |
|---|---|
| **Roots** | all 11 boxes are `kind = 'base'`, `parent_item_id IS NULL` — *including* the ones that are commercially add-ons (Mystic Brawler, Alchemist, Deadpool Box Deluxe). A box you can play by yourself is a root, whatever the shop called it |
| **Label** | `series = 'Dice Throne'` on **all 146 rows**, roots and descendants alike — not only the roots |
| **Links** | **56 `same_family` rows**, and `same_family` only. Every one points at a box; boxes point at Season One ReRolled. Transitive, so any member reaches the whole line |

Two things worth knowing that the recommendation above does not say:

- **`series` on every row is a choice, not a requirement.** `ROOT_GROUP_CTE`
  groups by `root_game_id` and takes the value most of the tree carries, so one
  tagged row per tree would form the group. Tagging the whole line is what makes
  the `series=Dice Throne` **filter** return 146 rows instead of 11.
- **A group needs two roots.** `HAVING COUNT(*) > 1` in `ROOT_GROUP_CTE` drops a
  series carried by a single line — so a `series` label on one root is inert.

### ⚠️ `works_with`'s doc comment names Dice Throne. No Dice Throne row uses it.

`packages/core/src/constants.ts` describes `works_with` as *"standalone games
that combine (Dice Throne characters, Unmatched fighters)"*. Production holds
**zero** `works_with` rows in the Dice Throne line; all 56 are `same_family`.
The comment is the pre-`same_family` design and was not updated when
`same_family` was added as the "common case in a real collection" it now is.
**Follow the data, not that comment.** (Left unedited — `packages/` was owned by
other agents at the time.)

`requires` *is* used inside Dice Throne, and only where it is literally true:
**Adventures – Unchained** and **Marvel Dice Throne: Missions** each `requires`
the hero boxes they cannot be played without. That is the line between the two —
`same_family` for a box that plays alone, `requires` for one that does not.

### Applied to Unstable Unicorns — 2026-08-08

*"Like Dice Throne, Unstable Unicorns Chaos and Control are standalone
expansions that are also expansions, because they can be used with the base
game"* — the owner.

Chaos (501) and Control (500) were **already** roots with `kind = 'base'`; what
was missing was the label and the right link. Four statements, no rows deleted,
no code changed:

| | |
|---|---|
| 502 *Christmas Expansion Pack* | re-parented from 500 (Control) to **832** (the base game), `root_game_id` following |
| 500, 501, 502, 832, 853 | `series = 'Unstable Unicorns'` |
| relations 79, 80 | `works_with` → **`same_family`** |

`requires` was rejected — it means "unplayable without", and both are sold as
complete base games. Transitivity does the rest: Chaos ↔ Control needs no row of
its own.

The line folds to **one entry**: *Unstable Unicorns · 3 lines · 5 items*, and the
collection page goes 147 → 145 entries.

## The box carries the `bgg_id`; the heroes carry none — 2026-08-08

Settled by the owner: *"The box just contains the hero. For us we can ignore
this. We encompass it."*

The data already worked this way and it is now deliberate rather than
incidental. Every one of the **12 Dice Throne roots has a `bgg_id`; every
hero row has `NULL`**:

```
676  Dice Throne: Season One ReRolled        base, root      bgg 291794
└── 680-687  Dice Throne Hero: Barbarian…    expansion       bgg NULL

114  Dice Throne: Deadpool Box Deluxe Ed.    base, root      bgg 403511
└── 722  Dice Throne Hero: Deadpool          expansion       bgg NULL
    └── 761/762/783  sculpt, sleeves, playmat
```

### Why item 114 is not a mismatch, though an audit will flag it

The 2026-08-08 `bgg_id` audit marked 114 SUSPECT: we call it *"Dice Throne:
Deadpool Box Deluxe Edition"*, BoardGameGeek calls `403511` *"Marvel Dice
Throne: Deadpool"* and types it `boardgameexpansion` where we say `base`.

Both disagreements are cosmetic:

- **The "Marvel" prefix is BGG's convention for this whole wave**, not
  something specific to Deadpool. Its siblings sit in the same id block —
  96 X-Men is 403494, 115 Missions is 403495, 114 is 403511 — and carry the
  same naming difference. They simply scored above the audit's line.
- **`boardgameexpansion` is BGG's taxonomy, not ours.** A box that plays
  alone is a root here regardless of what BGG types it, which is the same
  rule that makes all 11 Dice Throne boxes roots.

**Do not "fix" 114 by moving its id to hero 722.** That was proposed and
rejected: it would break the convention above, and 722 is not the thing the
owner bought — the box is.

### Consequence for the audit's false-negative worklist

Eight of the twenty rows on that list are heroes, flagged because we write
`Dice Throne Hero: X` and BGG writes `Dice Throne: X – Hero Pack`. **They are
not missing matches.** Heroes are not supposed to carry ids, so there is
nothing to fill in. The worklist is smaller than it looks.

What survives on that list is **item 277 *Casting Shadows: Expansion Pack***,
whose apparent match is the base game — the genuine trap the audit warned
about, and the reason `pack` must never be added to `GENERIC_TITLE_WORDS`.
