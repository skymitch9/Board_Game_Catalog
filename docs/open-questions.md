# Open questions

> What still needs a person. Everything solved has been cut — the reasoning that
> is still load-bearing lives in `HANDOFF.md` and the code. Last rewritten
> 2026-08-06 at head `7bcfa7b`.
>
> Delete this file when it is empty.

## The catalog, right now

| | |
|---|---|
| items | **775** |
| covers | **nothing is blank** |
| details queue | **empty** |
| scan jobs waiting | **none** — you sorted them |
| cover-health probes | cron running every 30 min |

Working tree clean, everything deployed, all integrity checks zero.

---

## 1. Fill the component data — or wait until Sunday

`game_component` is **empty**, so "what am I missing" has no data at all. One
call from a signed-in browser console, about eight runs to cover the catalog:

```js
await (await fetch('/api/components/backfill', {method:'POST'})).json()
```

The weekly cron fires Sunday 4:00 PM and will do it unattended. Only worth doing
by hand if you want the shopping list before then.

## 2. Count the Dice Throne playmats

The one piece of evidence that can settle whether you own the 2020 webstore hero
mats. **11 means the Season 1/2 recollection was mistaken; meaningfully more
means those mats explain it** and the checklist should be rebuilt from the
physical count.

Established so far: 11 confirmed bought, 21 provably not bought (the tier said
"No playmats are included in this bundle" and BackerKit recorded zero add-ons),
22 genuinely unknown because they had a retail channel no pledge record can
speak to. Full working in `scratchpad/dice-throne-playmats.md`.

## 3. Is Excursion Tiles 1 really a 2024 release?

Item 117 says **2024**. Its Kickstarter — found and linked 2026-08-06 — actually
ran **2025-08-06 to 2025-08-27** (543 backers, $24,488, 980% funded), estimated
delivery Oct 2025. Nothing supports 2024.

Left alone rather than corrected because you have settled both these years by
hand. If you agree it is 2025:

```sql
UPDATE item SET year_published = 2025 WHERE id = 117;
```

## 4. Rename HELLDIVERS 2: Mystery Expansions when the box arrives

Item 414, kept deliberately. The Gamefound campaign names no such product, so
this row is a placeholder for content not yet revealed — and the owner wants the
reminder that **the pledge will deliver an extra item under a name nobody has
yet**. Rename it from what is actually in the box.

---

## The honest floor

One thing will not resolve, and that is the correct outcome rather than a
backlog:

- **Divine Dungeon the Game** — playing time is published nowhere, including
  Mountaindale's own store. Layer 2 keeps it out of the queue, which is what
  layer 2 is for; making it a class would mean inventing a column for one row.

**Excursion Tiles 1 has left this list.** It was the last item with no image
anywhere; on your call it now shares Excursion Tiles 2's cover, recorded as a
borrowed one in the copy notes and kept in the cover picker as an `edition` row.
Both rows also gained `series = 'Excursion Tiles'` — the Dice Throne pattern,
chosen over a `works_with` relation because nobody has established that set 2's
grids physically snap to set 1's.

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
