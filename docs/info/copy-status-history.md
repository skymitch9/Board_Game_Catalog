# Disposal & copy history — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. ✅ **BUILT — shipped
> 2026-09-02 as migration 0029.**
> Last verified: **2026-09-02** — the counts in §1 were re-read live from
> production D1 that day, and §6's 7403 claim was re-measured and found FALSE.
> The rest of the prose still carries its 2026-08-09 reasoning, which is the
> point of it.

*"For sold and lent we can mark them as not owned anymore but we should keep a
history of them items."* — the owner, 2026-08-09, deferring the build to the
next session.

Read this before writing any code. **The obvious version of this feature is the
wrong one**, and the reason is in the first two sections.

---

## 0. What was actually built — read this first

Shipped 2026-09-02 as `migrations/0029_copy_disposal_history.sql`, plus the
route, the db layer and the UI listed below. The full landing note, with the
verification table and everything that was NOT verified, is in
[`../DONE.md`](../DONE.md) under *"SHIPPED — disposal reasons + append-only copy
history"*.

| Where | What |
|---|---|
| `migrations/0029_copy_disposal_history.sql` | `copy.disposal` (`sold`/`given_away`/`lost`), the `copy_event` table, two indexes, **two append-only triggers** |
| `packages/core/src/constants.ts` | `DISPOSALS`, `DISPOSED_STATUS`, `DISPOSAL_LABELS`, `COPY_STATUS_LABELS`, `copyStateLabel()`, `isDisposedStatus()` |
| `packages/core/src/schemas.ts` | `disposalSchema`, `disposalConflict()` — the pairing rule, stated once — `disposalDetailsSchema`, and the `CopyEvent` contract |
| `packages/db/src/copy-events.ts` | `copyEventInsert()` (a prepared statement, for batching) and `listItemCopyEvents()` |
| `packages/db/src/copies.ts` | `updateCopy` — **the one place history is written**, batched with the UPDATE |
| `apps/worker/src/routes/catalog.ts` | `GET /api/items/:id/history`, and the merged status/disposal check on `PATCH /api/copies/:id` |
| `apps/web/src/components/CopyEditor.tsx` | The **"No longer ours"** action and the "What happened to it" fieldset |
| `apps/web/src/components/CopyHistory.tsx` | The History card on the item page |
| `packages/db/test/copy-event-no-cascade.test.ts` | 14 tests: the no-cascade guarantee against real SQLite, and the append-only triggers |
| `apps/worker/src/lib/copy-disposal.test.ts` | 20 tests: the pairing rule rejects rather than strips, and a given-away copy never reads "sold" |

⚠️ **Three things a later session will want to know, and each is argued in full
in `DONE.md`:**

1. **A given-away copy is stored as `status = 'sold'`** (option B, §3). Nothing
   shows that word — `copyStateLabel()` is the only correct way to render a
   copy's state, and `COPY_STATUS_LABELS` the only correct way to render a bare
   status. Use them; do not print `copy.status`.
2. **Creating a copy writes no event.** History is written by `updateCopy` and
   nowhere else, so it can travel in the same `db.batch` as the change it
   describes.
3. **The collection's paging SQL was NOT changed** (§5 step 7 was implemented at
   the item page instead). A game whose every copy has gone is still listed.

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

### ⚠️ And yet, production, 2026-08-09 — and still, on the day it shipped

| status | copies (2026-08-09) | units | copies (2026-09-02) | units |
|---|---|---|---|---|
| `owned` | 587 | 660 | 636 | 710 |
| `preordered` | 204 | 236 | 172 | 204 |
| `wanted` | 30 | 31 | 30 | 31 |
| **`lent`** | **0** | **0** | **0** | **0** |
| **`sold`** | **0** | **0** | **0** | **0** |

`lent_to` is populated on **zero** rows.

⚠️ **Three and a half weeks and 49 more owned copies later, `lent` and `sold`
were still at zero** — which is the strongest available evidence that §1's
diagnosis was right and the feature was never "add statuses". The collection
moved; the premise did not.

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

⚠️ **This was the one decision the owner had to make, because their words and
this table disagreed.** They said *"for sold and lent we can mark them as not
owned anymore"*. Doing that to `lent` means **a game you lent to a friend
reappears on your shopping list** — the exact failure `getGameCompleteness` was
written to prevent (*"money already spent… is how a thing gets bought twice"*,
and why `preordered` counts as held).

### ✅ ANSWERED by the owner, 2026-08-09 — build to this

| Question | Ruling |
|---|---|
| Does `lent` still count as owned? | **Yes — owned, but not on the shelf.** It keeps counting towards "we have this", so a lent game never reappears as missing or gets re-bought. Flagged as out of the house, not as gone. |
| Is *given away* its own status? | **Yes — its own value, separate from `sold`.** |

So the ruling **overrides the owner's earlier wording** on `lent` and keeps
their wording on `sold`. Both readings were cheap; this is the one that does not
re-create the bought-twice bug.

`given_away` and `sold` behave **identically** — both leave ownership, neither
counts as held, neither is on the shelf. The distinction is purely so the
history reads truthfully later: item 303 was given away, and `sold` implies
money changed hands. Cheap to add now, annoying to backfill once rows exist.

**The two axes therefore both exist**, and the final table is:

| status | own it? | on shelf? |
|---|---|---|
| `owned` | yes | yes |
| `preordered` | yes | no |
| `lent` | **yes** | no |
| `sold` | no | no |
| `given_away` | no | no |
| `wanted` | no | no |

Which maps onto the two sets consolidated below: `HELD_STATUSES` is the "own it"
column, and neither new value joins it.

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

### ✅ B was built, 2026-09-02 — and here is what it cost

⚠️ **B partly overrides §2's ruling that *given away* is "its own value".** It
is its own value — of `disposal`, not of `status`. The owner sees the word he
asked for everywhere; the database does not have it.

**So: a copy that was given away carries `status = 'sold'`.** That is the entire
bill for skipping the rebuild, and it is paid in exactly one place —
`copyStateLabel(status, disposal)` in `packages/core/src/constants.ts`, which
every render goes through. A hand-written SQL query will still see `sold`; the
CSV export therefore carries a `disposal` column beside `status` so a
spreadsheet cannot make the same mistake.

**Option A remains open** and costs one careful rebuild migration: recreate
`copy` with the widened CHECK, then re-create migration 0002's two quantity
triggers and all five indexes, which a rebuild drops silently. If the owner
would rather pay that for the cleaner vocabulary, `DISPOSED_STATUS` is the
constant that moves and no caller changes.

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

🔴 ~~**`wrangler d1 migrations apply --remote` returns `7403` on this
account.**~~ **RETIRED 2026-09-02 — re-measured and FALSE.** `npm run db:migrate`
(which is exactly `wrangler d1 migrations apply board-game-catalog --remote`)
applied 0029 in **10.42 ms** on wrangler 4.118.0, and it handled the migration's
two `CREATE TRIGGER` bodies — semicolons and all — without needing the file
split by hand.

The old advice was to apply migrations as plain SQL through `d1 execute --remote`
and then `INSERT INTO d1_migrations (name) VALUES (…)` by hand. **Do not do
that any more:** it is more work and it is the shape that leaves `d1_migrations`
disagreeing with the database when somebody forgets the second half. The
deploy runbook is [`../access/deploys.md`](../access/deploys.md).

⚠️ Kept visible rather than deleted, because it is a claim a session may
otherwise re-derive from an old transcript. If 7403 ever comes back, it is an
account/permission condition to diagnose, not a standing fact about this repo.

## 7. Out of scope, deliberately

- **Per-person ownership.** `0001_init.sql` says *"One joint collection; no
  per-person ownership"*. `counterpart` is free text, not a user id.
- **Money.** `price_cents` records what a disposal fetched; it is not an
  accounting feature and nothing should sum it into a portfolio.
- **Re-acquiring.** Buying something back is a new copy plus a new event, not an
  edit to the old one. History is append-only.
