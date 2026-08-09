# Disposal & copy history — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. **PLANNED — NOT BUILT.**
> Last verified: **2026-08-09** (all counts read live from production D1).

*"For sold and lent we can mark them as not owned anymore but we should keep a
history of them items."* — the owner, 2026-08-09, deferring the build to the
next session.

Read this before writing any code. **The obvious version of this feature is the
wrong one**, and the reason is in the first two sections.

---

## 1. Most of it already exists, and none of it is used

| Fact | Where |
|---|---|
| `COPY_STATUSES = ['owned','wanted','preordered','lent','sold']` | `packages/core/src/constants.ts:20` |
| Matching `CHECK` on the column | `migrations/0001_init.sql:114` |
| A `<select>` over **all five** statuses | `apps/web/src/components/CopyEditor.tsx:102` |
| A `lent_to` free-text column | `migrations/0001_init.sql` |
| A `lent` conditional already in the editor | `CopyEditor.tsx:130` |

So a copy **can** be marked `sold` today, through existing UI, with no change at
all.

### ⚠️ And yet, production, 2026-08-09

| status | copies | units |
|---|---|---|
| `owned` | 587 | 660 |
| `preordered` | 204 | 236 |
| `wanted` | 30 | 31 |
| **`lent`** | **0** | **0** |
| **`sold`** | **0** | **0** |

`lent_to` is populated on **zero** rows.

**Two statuses have existed since migration 0001 and have never once been
used.** The owner's request is therefore not "add sold and lent" — they are
there. It is one of:

1. **Discoverability.** `CopyEditor` is not reachable from wherever the thought
   "I gave this away" occurs. *Check this first — it may be the whole feature.*
2. **Vocabulary.** Neither word fits. `sold` implies money changed hands;
   *given away* did not. `lent` implies it is coming back.
3. **Consequence.** Setting `sold` today silently keeps the copy counted as
   *not* held but leaves no record of what happened, which is worse than doing
   nothing — see §4.

**Do not start by writing a migration.** Start by opening the app and trying to
mark item 303 as gone, and write down what stops you.

---

## 2. The model: two questions, currently conflated into one

The codebase asks *"do we have it?"* as a single boolean. The owner's request
splits it in two, and every later decision falls out of this:

| | Do I **own** it? (→ should I buy one?) | Is it **on the shelf**? (→ can I play tonight?) |
|---|---|---|
| `owned` | yes | yes |
| `preordered` | yes | no |
| `lent` | **yes** | no |
| `sold` / given away | no | no |
| `wanted` | no | no |

⚠️ **This is the one decision the owner has to make, because their words and
this table disagree.** They said *"for sold and lent we can mark them as not
owned anymore"*. Doing that to `lent` means **a game you lent to a friend
reappears on your shopping list** — which is the exact failure
`getGameCompleteness` was written to prevent (*"money already spent… is how a
thing gets bought twice"*, and why `preordered` counts as held).

**Recommendation:** `lent` stays **owned but not on shelf**; only `sold` and a
new *given away* leave ownership. Ask, then build. Both readings are cheap to
implement — but only if the two axes exist. If they stay one boolean, the answer
is a coin flip that will be wrong half the time.

### ✅ "Held" is now defined once — done 2026-08-09, before the feature

**This prerequisite is complete.** It was worse than this section recorded:
not four definitions but **eight SQL clauses** across three files, in two
spellings, with nothing naming the distinction between them.

| Now | Means | Set |
|---|---|---|
| `HELD_STATUSES` | *"do we have it — stop looking"* | `owned, lent, preordered` |
| `OWNED_COPY_STATUSES` | *"how many copies do we actually have"* | `owned, lent` |

Both in `packages/core/src/constants.ts` (a leaf module — safe under the
load-bearing import order), reachable from SQL through `statusList()` in
`packages/db/src/copies.ts`.

⚠️ **The two sets differ by exactly `preordered`, and that is a decision, not
drift.** A box in the post is a reason not to buy another; it is not a copy you
can count, sleeve or hand across a table. Counting it would inflate "573 owned
copies" with things nobody has yet.

⚠️ **There is a third rule and it stays a literal.** `countOwnedCopies` counts
`owned` **alone** — excluding `lent` as well as `preordered` — because its caller
is a barcode scan asking "do I already have this, and how many?", and a copy at a
friend's house cannot go on the table tonight. Deliberately *not* given an
exported constant: one caller, one question, and a third named set would invite
somebody to pick it without reading why.

**So adding a status is now a one-line change in one file** — which is the whole
point, and the reason this was worth doing before the decision below is answered.

Proved behaviour-preserving rather than assumed: ten endpoints captured before
and after against seeded data covering `owned`/`lent`/`sold`/`preordered`/
`wanted`, physical and digital, and duplicates — **byte-for-byte identical**.

---

## 3. The migration is harder than it looks

**SQLite cannot alter a `CHECK` constraint.** Adding `given_away` to
`status IN (...)` needs the full 12-step table rebuild of `copy`, which carries:

- a self-referencing FK (`applies_to_copy_id → copy(id)`)
- an FK to `item` (`ON DELETE CASCADE`) and to `edition` (`ON DELETE SET NULL`)
- **two triggers** from `0002_copy_quantity.sql` (`copy_quantity_positive_insert`
  and `..._update`) — a rebuild drops them silently
- **five indexes** (`idx_copy_item`, `idx_copy_status`, `idx_copy_location`,
  `idx_copy_applies`, `idx_copy_item_quantity`)
- 821 live rows

Migration 0002 already hit this wall and chose triggers over a CHECK for exactly
this reason. **Read its comment before deciding.**

### Two ways out, and the cheaper one is probably right

| Option | Cost | Notes |
|---|---|---|
| **A · Rebuild `copy`** to widen the CHECK | High — the whole list above | Cleanest vocabulary; one status per real-world state |
| **B · Reuse `sold` + a nullable `disposal` column** (`'sold'`/`'given_away'`/`'lost'`) | One `ALTER TABLE ADD COLUMN`, no rebuild | Status stays 5 values; *why* it left lives beside it. Matches how `game_component.manual_state` was added in 0022 |

**Recommendation: B.** It is additive, reversible, needs no rebuild, and the
distinction the owner actually wants (*sold* vs *given away*) is a reason, not a
state — both mean "no longer ours".

---

## 4. History is the actual feature, and it has one trap

*"We should keep a history of them items."* A status column cannot do this:
setting `sold` **overwrites** `owned`, so "we had this from March to August" is
gone the moment it is recorded.

```sql
CREATE TABLE copy_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  copy_id     INTEGER REFERENCES copy(id) ON DELETE SET NULL,   -- NOT cascade
  item_id     INTEGER REFERENCES item(id) ON DELETE SET NULL,   -- NOT cascade
  item_name   TEXT NOT NULL,        -- snapshot; see below
  from_status TEXT,
  to_status   TEXT NOT NULL,
  disposal    TEXT,                 -- 'sold' | 'given_away' | 'lost'
  counterpart TEXT,                 -- who bought it / who has it
  price_cents INTEGER,
  note        TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_copy_event_item ON copy_event(item_id, at);
CREATE INDEX idx_copy_event_copy ON copy_event(copy_id, at);
```

⚠️ **`ON DELETE CASCADE` would defeat the entire feature.** `copy` cascades from
`item`, so deleting a game would erase the record that you ever owned or sold
it — the one fact this table exists to keep. Hence `SET NULL` on both, **plus a
denormalised `item_name`**, so a deleted game still reads as *"Catan — given
away to Dave, 2026-03-04"* rather than *"item 41"*.

This is the same reasoning as `game_component.stale_at`
([`completeness.md`](completeness.md)): *a row vanishing is indistinguishable
from the thing never having happened.*

**Write the event from one place** — the copy-update route — not from the UI.
Every caller that changes a status must produce an event, or the history is
quietly partial, which is worse than absent.

---

## 5. Build order

1. **Reproduce the problem.** Try to mark item 303 (`The Binding of Isaac: Four
   Souls - Gold Box Expansion`, copy 298, still `owned`) as gone. Write down
   what stopped you. If the answer is "nothing", the feature is a shortcut, not
   a schema change.
2. **Ask the `lent` question** from §2. Nothing else can be decided first.
3. **Consolidate the four `held` definitions** into `packages/core` — two
   predicates, `isOwned` and `isOnShelf`, exported and used everywhere.
4. **Migration 0023**: `copy_event`, plus `ALTER TABLE copy ADD COLUMN disposal`
   (option B). Additive only; no rebuild.
5. **Route**: write a `copy_event` row on every status change in the existing
   update-copy handler. One place.
6. **UI**: a *"No longer ours"* action on the copy, asking sold / given away /
   lost, who, and how much. Plus the history shown on the item page.
7. **Collection**: exclude disposed copies by default, reachable behind a
   filter — the same bargain the completeness disclosures use.

## 6. Verification

```bash
# statuses actually in use — expect lent/sold at 0 before, non-zero after
npx wrangler d1 execute board-game-catalog --remote --config apps/worker/wrangler.toml \
  --command "SELECT status, COUNT(*) FROM copy GROUP BY status"

# history survives deleting the game it belonged to — the whole point
npx wrangler d1 execute board-game-catalog --remote --config apps/worker/wrangler.toml \
  --command "SELECT item_name, from_status, to_status, disposal, at FROM copy_event ORDER BY at DESC LIMIT 10"
```

⚠️ **`wrangler d1 migrations apply --remote` returns `7403` on this account.**
Apply migrations as plain SQL through `d1 execute --remote`, followed by
`INSERT INTO d1_migrations (name) VALUES ('0023_....sql');` — see
[`../HANDOFF.md`](../HANDOFF.md).

## 7. Out of scope, deliberately

- **Per-person ownership.** `0001_init.sql` says *"One joint collection; no
  per-person ownership"*. `counterpart` is free text, not a user id.
- **Money.** `price_cents` records what a disposal fetched; it is not an
  accounting feature and nothing should sum it into a portfolio.
- **Re-acquiring.** Buying something back is a new copy plus a new event, not an
  edit to the old one. History is append-only.
