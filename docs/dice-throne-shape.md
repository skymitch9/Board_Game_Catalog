# Dice Throne — how should it be organised?

> **Status:** proposal, nothing implemented. Written 2026-08-06 for review.
> Delete once a decision is made and recorded in the handoff.

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
