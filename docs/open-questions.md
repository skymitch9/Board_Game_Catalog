# Open questions

> What still needs a person. Everything solved has been cut — the reasoning that
> is still load-bearing lives in `HANDOFF.md` and the code. Last rewritten
> 2026-08-06 at head `926bd85`.
>
> Delete this file when it is empty.

## The catalog, right now

| | |
|---|---|
| items | **760** |
| copies | 532 owned · 204 preordered · 25 wanted |
| covers | 437 own art · 322 borrow their game's · **1 blank** |
| descriptions | 222 |
| BoardGameGeek links | 153 · 1,060 known printings |
| details queue | **empty** |
| cover-health probes | 437, cron running every 30 min |

Working tree clean, everything deployed, all integrity checks zero.

---

## 1. Six scan jobs are waiting to be sorted

Your shelf photos sit at `review`. Nothing else blocks the catalog from growing,
and this is the only item on this page that grows the collection rather than
tidying it.

## 2. Count the Dice Throne playmats

The one piece of evidence that can settle whether you own the 2020 webstore hero
mats. **11 means the Season 1/2 recollection was mistaken; meaningfully more
means those mats explain it** and the checklist should be rebuilt from the
physical count.

Established so far: 11 confirmed bought, 21 provably not bought (the tier said
"No playmats are included in this bundle" and BackerKit recorded zero add-ons),
22 genuinely unknown because they had a retail channel no pledge record can
speak to. Full working in `scratchpad/dice-throne-playmats.md`.

## 3. Fill the component data — or wait until Sunday

`game_component` is **empty**, so "what am I missing" has no data at all. One
call from a signed-in browser console, about eight runs to cover the catalog:

```js
await (await fetch('/api/components/backfill', {method:'POST'})).json()
```

The weekly cron fires Sunday 4:00 PM and will do it unattended. Only worth doing
by hand if you want the shopping list before then.

## 4. Deadpool's description needs an edit

Item 722. He has no page on `dicethrone.com`, so it uses publisher box copy from
The Op, which ends *"…requires an additional Dice Throne hero or co-op expansion
to play"* — pack-level phrasing rather than character flavour. Every other hero
took its own copy. Recorded on the copy notes.

## 5. Two small identity calls

**HELLDIVERS 2: Mystery Expansions** (id 414) — the Gamefound campaign contains
no occurrence of "mystery" at all. It is a placeholder row for unrevealed
content. Rename it, delete it, or leave it until the pledge ships.

**Excursion Tiles 2's year** — sources contradict each other and the set was
never delivered, so it is blank rather than guessed.

---

## The honest floor

Two things will not resolve, and that is the correct outcome rather than a
backlog:

- **Divine Dungeon the Game** — playing time is published nowhere, including
  Mountaindale's own store. Layer 2 keeps it out of the queue, which is what
  layer 2 is for; making it a class would mean inventing a column for one row.
- **Excursion Tiles 1** — the single item with no image anywhere. Standalone 3D
  print files with nothing above them to borrow a cover from.

---

## Recently settled, kept only because you may want to revisit

- **Cover exceptions.** You approved all of them; four were applied (Gold Box,
  Casting Shadows, and the two Here to Slay KS packs), each recorded in its copy
  notes as borrowed and preserved as an `edition` row. The rest needed no
  exception once covers began inheriting from the group.
- **The usage-limit trial** produced a global rule, now in `~/.claude/CLAUDE.md`.
  The findings worth remembering: there are **two** limits and the weekly one is
  the real ceiling; a stale read is silent and looks exactly like low usage;
  monitor only while delegated work is running; stop the agents before pausing.
- **`wrangler tail` works against production despite Access**, and named a
  silent failure in one line that had been misdiagnosed three times by
  reasoning. Reach for it first, not last.
