# Open questions — for review

> Written 2026-08-06 at the end of a long session. Everything here is either a
> decision only you can make or a task only you can do. Nothing is blocked on me.
> Delete this file once it is worked through.

## Usage watch — trial run, 2026-08-06

**State: session 48% (resets in ~1 hr 48 min) · weekly 63% (resets Sun 3:59 PM)**
Fourth check. Unchanged from the third — with no agents running, nothing is
burning but the checks. The session window will reset long before 89%.
**The weekly figure is the one to watch.**

### Poll rate should track the rate of change

Interval widened from 13 to 25 minutes once the agents finished. Each check now
costs four tool calls — away, back, sometimes a click, then `find` — so polling
every 13 minutes to observe that nothing is happening spends the budget the
monitor exists to protect. Tighten it again when agents are working.

### The read sequence that actually works

1. navigate to another claude.ai page (`/recents`)
2. navigate to `claude.ai/new#settings/usage`
3. `find` **"Usage tab in settings navigation"** and click it — the hash route
   opens the settings dialog but lands on an arbitrary section, so this step is
   not optional
4. `find` the figures

Element refs change on every load, so nothing can be hardcoded. Four to five tool
calls per check.

### Re-armed, and the session window rolled over

**Session 15% (fresh window) · weekly 65% (resets Sun 4:00 PM) · Fable 56%.**

The session limit reset from 49% to 15% while idle, confirming it is the cheap
one: waiting it out costs a nap. **The weekly figure moved 63% → 65% and does not
recover until Sunday** — it is the only number that can actually stop work for
days, and it is the one the 89% rule should be applied to.

Monitor re-armed at 15 minutes because agents are working again, per the rule
below.

### Stood down earlier — the monitor was the only thing burning

Final reading: **session 49% (reset in 41 min) · weekly 63% · Fable 56%**.

The session rose 48% → 49% across 40 idle minutes, with nothing running but the
checks themselves. That is roughly **1.5% of session budget an hour to observe
that nothing is happening**, and the read had by then grown to six tool calls:
the hash route stopped opening the settings dialog at all, so it needs
`/recents` → `#settings/usage` → click **Settings** → click **Usage** → `find`.

So the monitor was stood down rather than re-armed. **Arm it only while delegated
work is in flight.** An idle system cannot run away, and there is nothing for a
threshold to stop when no agents are running — the check can only cost.

**The rule this trial actually produces:**

- Watch **both** limits; the weekly one is the real ceiling.
- Navigate away and back, then click through to Usage — a stale read is silent
  and looks exactly like low usage.
- Poll only while agents are working, and match the interval to how fast usage is
  actually moving.
- At 89%, stop the agents first, then pause.
- Never kill a deploy mid-flight.

### The reader must navigate away and back, or it lies

Checks two and three both returned "46% used, resets in 2 hr 18 min" — the
countdown frozen across 26 minutes. `claude.ai` is a single-page app and the
usage figures sit behind a hash route, so re-navigating to the same URL does not
remount it and `find` keeps returning the first render. Going to another
claude.ai page and back gave the true figure.

A monitor without that step reports a stale number forever and **never trips the
threshold** — silent, and indistinguishable from low usage. Third
staleness-shaped failure in this project after the cached `index.html` and the
covers that had been written but not shown.

### There are TWO limits, and the weekly one matters more

The first check only read the session figure. The page also carries a **weekly**
limit, and it is the binding constraint on a long run:

- **Session** — resets in hours. Hitting it costs a nap.
- **Weekly** — resets **Sunday 3:59 PM**, three days out. Hitting it stops work
  until then.

At 46% session / 63% weekly, the weekly is over half gone and recovers far more
slowly. **Apply the 89% rule to whichever is higher**, and treat the weekly as
the real ceiling: pausing two hours for a session reset is cheap, pausing three
days is not.

Worth carrying into the global rule — a monitor that reads only the session
figure will sail past the limit that actually hurts.

How it works, and what was changed from the original idea:

- **Readable via `find`, not page text.** `claude.ai/new#settings/usage` renders
  the figures in a modal that `get_page_text` does not capture; `find` returns
  "44% used", "Current session", "Resets in 2 hr 30 min" cleanly.
- **Checked on a ~13 minute background timer**, not by a dedicated monitor agent.
  An agent carries its own context and reasoning cost to do what is two tool
  calls.
- **Handoff at milestones, not every 10 minutes.** A handoff is a long output;
  six an hour would consume a real share of the budget it exists to protect, and
  consecutive copies would be near-identical. The timer updates the state line
  above; a full refresh happens when an agent reports or a deploy lands.
- **At 89%: stop the agents first, then pause.** This was the gap in the original
  plan — pausing the conversation while a code agent keeps building and deploying
  achieves nothing. `TaskStop` everything running, write the final handoff, then
  wait out the window.
- **Long waits are chained.** Background commands cap at 10 minutes; `Monitor`
  reaches an hour. Size the wait from the reset time, which is readable.

If this holds up it is worth promoting to a global rule.

### The 10% after the threshold is a budget, not a runway

- **Stop the agents first** — the largest ongoing spend, and two tool calls.
- **Refresh the handoff, do not compose one.** These docs are kept current as
  things land precisely so the threshold is an edit. Writing one from scratch at
  89% means it was left too late.
- **Nothing new starts.** No agents, no "quick" fixes, no final deploy. A
  half-finished change at the boundary is worse than an unstarted one: the tree
  ends up dirty and `npm run deploy` then refuses everything.
- **Never kill a deploy mid-flight.** Let it land. A killed deploy can leave the
  live version ahead of or behind the repo, which is the one state that is
  genuinely expensive to untangle.

### Overage credits — emergency only

The owner's bar: use them only if stopping would **hard-lock the app**, or cost
more than the overage to repair.

Worth knowing that on this project almost nothing meets that bar:

- **A dirty tree is not an emergency.** `npm run deploy` refuses it by design, so
  nothing half-finished can ship. Finish or discard it later.
- **An interrupted D1 write is not an emergency.** Writes are individually
  complete; there are no multi-statement transactions in flight.
- **A migration applied without its deploy is not an emergency.** The project
  migrates *before* deploying on purpose, so new-schema-with-old-code is the
  intended transient state and the app tolerates it.

The realistic case is a deploy killed partway. Avoid it by not killing deploys,
and the overage should never be needed.

## The details lookup stalls — SOLVED, and the fill has been run

**It was `waitUntil`, not the CPU ceiling.** Production named it itself, in
`wrangler tail`:

```
POST /api/research/488/details - Ok
  (warn) waitUntil() tasks did not complete within the allowed time after
  invocation end and have been cancelled.
```

A `waitUntil` task gets about thirty seconds **after the response is returned**,
and that route answered in 0.25s — so the entire Claude call was living on that
budget. Measured against the real items with the real code, one lookup takes
**17 to 73 seconds**. Roughly half were being cancelled, silently: nothing is
thrown, the `catch` never runs, and the row stays `running` for ever.

The CPU theory was wrong, and so was the plan question that hung off it. Item 92
passing and 383 failing was not a size difference — it was luck. Item 383 has
since taken 22s, 21s and 61s on three separate runs of identical input.

**Fixed in `e355873`**, deployed as `e71840f0-d0a0-4bb4-ad57-4a3568e07417`. The
work is awaited inside the request (an invocation that has not ended has no such
clock) and *also* registered with `waitUntil`, which now does what it was
originally reached for: if the caller disconnects, the work still gets its thirty
seconds to write itself down. Three layers guarantee a run cannot go quiet — a
60-second abort on the Claude call, the existing `catch`, and
`closeStaleDetailsRuns` swept on every read of the runs table.

**The fill has been run and the queue is empty.** See the handoff for numbers.

## If work stopped overnight

One agent was running when this was filed, with four things queued in sequence:

1. **Header and nav** — "Type a name" folded into Add games as a fourth tab; the
   collection header reduced to a single **+ Add games**; **Related games** and
   **Missing details** moved up to the nav beside Wishlist and hidden when they
   have nothing outstanding.
2. **The three-layer details policy** — never ask what cannot exist (TTRPG books
   have no playtime); do not re-ask unless an input changed (`preordered` →
   `owned`, a `bgg_id` appeared, the name was edited, the release year arrived);
   and track asked-and-not-found **per field** rather than per item.
3. **Deploy.**
4. **Run the details fill** through Chrome, since the route is behind Access.

**If the tree is dirty**, an agent died partway. `git diff` shows where it got
to. `npm run deploy` refuses a dirty tree by design, so nothing half-finished can
have shipped. Either finish the change or `git checkout -- <file>` to drop it —
neither is dangerous, because everything already deployed is committed.

**Nothing is lost by stopping.** Catalog writes are individually complete, the
deployed app is whatever was last committed, and the queue of scan jobs is
untouched.

## Where the catalog stands

| | |
|---|---|
| items | **760** |
| copies | 532 owned · 204 preordered · 25 wanted |
| with a cover | **425** |
| boxed items still blank | **18** (base + expansion) |
| scan jobs waiting to be sorted | **6** |
| cover-health probes recorded | 120, cron running every 30 min |

---

## 1. Cover exceptions — needs your approval, item by item

**See [`covers-wanted.md`](covers-wanted.md)** (being written by an agent as this
is filed; if it is missing, the agent had nothing to propose).

You asked that the two image rules stay as rules, and that any deviation be an
exception you approve rather than a new policy. So the defaults are unchanged:

- durable sources only — BoardGameGeek, Shopify, publisher origin
- the image must be **of that exact product**

Two kinds of candidate need your yes:

- **Kickstarter-hosted images.** They carry a signed, expiring URL and will 404
  eventually. The cover-health cron would flag it when it happens.
- **Borrowed art** — e.g. a retail printing's cover standing in for the
  Kickstarter-exclusive one. Your Binding of Isaac suggestion. If approved, no
  `bgg_id` is attached (borrowing a picture is not an identity claim) and the
  copy note records that the art is a stand-in.

14 of the 18 blanks are Kickstarter-exclusive expansions with no retail listing
and no BGG entry, so most will need one exception or the other.

Known dead ends, listed so you know they were tried: **HELLDIVERS 2: Mystery
Expansions** (no such product exists in the campaign — a placeholder for
unrevealed content), **Starlight Arcana: Quickstart Box** (publisher's Wix store
403s on hotlink), **D&D Beyond Basic Rules** and **Unearthed Arcana** (D&D Beyond
publishes no cover for either).

---

## 2. Things only you can do

**Sort the six scan jobs.** Your shelf photos are at `review`. The three that
stalled finished on their own with 73, 74 and 36 titles.

**Count the Dice Throne playmats.** The only evidence that can settle whether you
own the 2020 webstore hero mats. **11** means the Season 1/2 recollection was
mistaken; meaningfully more means those mats explain it and the checklist should
be rebuilt from the physical count. Full working in
`scratchpad/dice-throne-playmats.md`. Confirmed so far: 11 bought, 21 provably
not bought, 22 genuinely unknown.

**Fill the component data**, or leave it — the weekly cron fires Sunday. From a
signed-in browser console, about 8 runs covers the catalog:

```js
await (await fetch('/api/components/backfill', {method:'POST'})).json()
```

`game_component` is empty until then, so "what am I missing" has no data.

---

## 3. Decisions still open

**Dice Throne heroes: keep thumbnails in the related-games list?** They draw at
44px in a list of 55 relatives. An agent is swapping them to WordPress's own
smaller derivatives, which should settle it — but if the list still feels heavy,
dropping thumbnails from that one list solves it completely.

**The Scadrial Pack.** Set to quantity 1 as you asked. If it turns out to
duplicate the four Mistborn books, raise them to 2. Contents were unrecoverable —
the store has closed.

---

## 4. Done overnight — no action needed

- **Deep Rock Galactic: Rival Incursion and Horrors of Hoxxes split into two
  rows**, both with MOOD's own product renders.
- **Mythic Mischief** — 551 renamed to *Volume I*, and Appendix A now links to
  Volume II as well as Volume I, because BGG lists it against both.
- **All five BackerKit near-misses resolved.** Sleeves and meeples were the same
  products under different names; Veiled Fate: Metal Edition became the catalog's
  first `upgrade` row; the ita bag stayed out.
- **Every Dice Throne hero and box has art** — 46 heroes, 11 boxes, 0 blank.
- **The background details lookup is verified in production** — 21 seconds,
  1.5¢, filled Dice Throne: Outcasts' playtime. It was the last unverified piece.
- **Vanguard marked as arrived**, all 17 rows owned.
- Ratings now sit above the relations list; the home page lost two duplicate
  camera buttons; thumbnails lazy-load.

---

## 5. A note on my own errors this session

Recorded because two of them are still worth checking behind.

- I read a pledge tier name as a packing list twice, splitting **Moonrakers**
  into two rows and inventing a second **Deep Rock Galactic** token set. Both
  corrected. **A tier name is a marketing description, not a manifest.**
- I created **20 wanted playmat rows** from a conversational aside rather than
  evidence. The research since suggests the X-Men and Marvel ones are right, but
  they began as my assumption, not your record.
- I characterised your recollection as unreliable on the basis of those two
  errors, which were mine. The playmat research later moved *toward* your
  version, not away from it.
