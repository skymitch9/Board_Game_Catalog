# Design decisions and plans

> Extracted from `HANDOFF.md` on 2026-08-21. Design rationale, settled
> questions, and future plans that have not yet moved to `TODO.md`.
>
> These sections were reference material in the original handoff — not finished
> work and not open items, but context anyone touching this codebase needs.

---

## Related games â€” the standalone/nested question, answered per game

`/retag` ("Related games" on the collection) lists every top-level game whose
name contains another game you own, and asks the one question that decides it:
**can you play this without the other box?**

- **Standalone** â†’ writes an `item_relation` and leaves the game where it is.
- **File under** â†’ sets kind and parent, nesting it.

The heuristic finds the pairs and refuses to pick. It cannot: "Scythe: Invaders
from Afar" and "CATAN: Starfarers" are structurally identical, and one is an
expansion while the other is a whole game. Only names containing "expansion" or
"extension" outright are marked confident. This is the Catan / Seafarers /
Starfarers question from the original design discussion, and it needed no new
schema â€” `item_relation` already existed.

Parent matching takes the **longest** owned prefix, not the first. "Catan:
Starfarers â€“ 5-6 Player Extension" contains both "Catan" and "Catan:
Starfarers"; the first-colon rule filed it under Catan while looking correct.
Separators include the en and em dashes publishers actually use.

---

## Filling in blanks â€” `/details`

A queue of every game missing publisher / year / players / playing time /
description, working down the list one at a time with a running cost, stoppable
mid-run. Per-game, the item page offers **Free lookup** (the scanner's sources)
beside **Search the web** (Claude, ~1.4Â¢, owner-only). Kept separate rather
than chained, because the free one is right often enough that paying for every
blank would be waste.

---

---

## Blocked, waiting on you

> **Current list of what actually needs a person lives in
> [`open-questions.md`](open-questions.md).** This section is the older
> setup-level backlog; item 1 below is done.

### 1. BoardGameGeek token â€” âœ… DONE

**The token is set** in both `wrangler secret` and `apps/worker/.dev.vars`, and
has been in use all session â€” 153 items carry a `bgg_id` and 1,060 printings have
been imported through it. The rest of this entry is kept only as the recipe, in
case it ever needs reissuing.

BGG closed its XML API in **July 2025**; registration and a bearer token are now
required. The client is written and token-aware; without the token every lookup
route answers 502 with an explanation and nothing else is affected.

1. <https://boardgamegeek.com/applications> â†’ **Create New Application** â†’
   choose **non-commercial** (free). Approval is manual â€” *"it may be a week or
   more"*.
2. Then â†’ **Tokens** â†’ create one.
3. `npx wrangler secret put BGG_API_TOKEN`, and add it to `apps/worker/.dev.vars`.

Requirements already satisfied in code: `Authorization: Bearer <token>`, domain
`boardgamegeek.com` with **no** `www`, server-side requests only, week-long edge
cache.

### 1b. GameUPC production key â€” optional, improves barcode hit rate

Email **`gameupc@grettir.org`** asking for a `/v1` API key, then:

```bash
npm run secret GAMEUPC_API_KEY      # production
# and add GAMEUPC_API_KEY=... to apps/worker/.dev.vars for local
```

**Not blocking.** With no key set, `gameUpcConfig()` falls back to GameUPC's
public `test` stage using their published demo key
(`test_test_test_test_test`), which is what every measurement above was taken
against. The `test` stage's data is *wiped periodically*, so a barcode that
resolved yesterday may miss today â€” that is the cost of not having the key, and
it is why a miss should never be treated as an outage.

### 1c. Phase 3 is built â€” and here is what unblocked it

The research pipeline (`packages/research/{tiers,research}.ts`,
`apps/worker/src/routes/research.ts`) is written and typechecks. Three tiers,
three separate calls, `allowed_domains` enforcing the ordering. Findings land
in `research_finding` for review and are **never applied** â€” that step is
deliberately not built.

**The official tier needs a publisher domain**, taken from the item's
`publisherUrl`, and refuses to run without one rather than quietly searching
the open web. That was a universal blocker: GameUPC carries no publisher at all
(`packages/barcode/src/gameupc.ts:179`), so every scanned game had an empty
field and tier 1 could not run on anything.

`packages/research/src/enrich.ts` fixes that. It asks Claude with the open web
for the dull box-facts â€” publisher, their site, year, players, playing time,
description â€” at `effort: low`, ~1.4 cents a game measured. Verified end to
end: a bare "Wingspan" came back Stonemaier Games / stonemaiergames.com / 2019
/ 1â€“5 players / 90 min, and the research plan for that item then reported
`official RUNNABLE` against `stonemaiergames.com`.

It fills **gaps only** â€” a second run over the same game changes nothing.

| Route | Does |
|---|---|
| `GET /api/research/needs-details` | The queue: games with blanks, and what filling costs |
| `POST /api/research/:id/details` | Fill one game's gaps from the web |
| `GET /api/research/:id/plan` | Per-tier cost, domains, and whether it can run |
| `POST /api/research/:id/run` | Run one tier, synchronously |
| `GET /api/research/:id/findings` | What has been found, official-tier first |
| `PATCH /api/research/findings/:id` | Accept or reject one finding |

**Not built:** the review UI for findings, and the step that applies an accepted
finding to the catalog.

### 2. Anthropic API key â€” âœ… DONE, nothing outstanding

Set in `apps/worker/.dev.vars` **and** in production, and **rotated on
2026-08-05** after the original leaked into a chat transcript. Both verified by
live call.

Sync with **`npm run secrets:push`** rather than `wrangler secret put` per key.
The per-key flow is how production once ended up holding a *pre-rotation* key
while `.dev.vars` had the new one â€” the symptom was photo mode failing with an
unhelpful error. The script reads `.dev.vars`, pushes only allowlisted names,
prints a last-4 fingerprint so you can confirm which value went up, and passes
secrets over stdin so they never touch a command line or shell history.

```bash
npm run secrets:push          # sync .dev.vars -> production
npm run secrets:push -- --dry # names and fingerprints only, sends nothing
```

---

---

## âš ï¸ Decisions waiting on the owner

### Grouping / family model â€” owner wants to discuss before catalog UI work

Raised 2026-08-05. The requirement:

- **Catan + Catan: Seafarers** â†’ one entry. Seafarers must not appear as a
  separate game.
- **Catan: Starfarers** â†’ its own entry, because it is standalone.
- **But Starfarers still keeps a relational tie back to Catan.**

**The schema cannot express this today.** `item` has exactly one relationship â€”
`parent_item_id`, with `root_game_id` denormalized. That models *containment*
and nothing else, so an item is either nested (and invisible as its own game) or
a root (and unrelated to anything). There is no third option, which is precisely
what Starfarers needs.

Two relationships are actually in play, and conflating them is the bug:

| Relationship | Example | Behaviour |
|---|---|---|
| **requires** | Seafarers â†’ Catan | Nest. Not a separate entry |
| **related to** | Starfarers â†’ Catan | Own root entry, plus a visible link |

The clean discriminator is **"can you play it without the base game?"** â€”
checkable, and it maps 1:1 onto nest-vs-link.

Sketch (not built, not agreed):

- Add `item_relation(from_item_id, to_item_id, relation)` where `relation` is
  something like `standalone_expansion_of` / `reimplements` / `integrates_with`.
  Directional, and it survives either item being deleted independently.
- Add a `standalone` flag (or a `standalone_expansion` kind) so import knows
  which branch to take.
- This aligns with how BGG already models it â€” `boardgameexpansion`,
  `boardgameintegration`, `boardgameimplementation` are separate link types on
  the `/thing` response the client already parses â€” so BGG import could populate
  it rather than needing hand-entry.

**Ratings â€” decided 2026-08-05.** Every entry keeps its own rating; Seafarers
might be a 3 while Catan base is a 5, and flattening that loses the most useful
thing the catalog knows. On top of the per-entry scores, show a **family score**.
So three numbers are visible: base game, expansion, family.

Per-person ratings already work this way (`rating` is keyed on item + user), so
the per-entry half needs no schema change â€” only the family roll-up is new, and
it is derived, not stored.

Still open for that conversation:

- **How is the family score computed?** A plain mean lets one poor accessory drag
  a great game down, which is wrong. Options: weight the base game heavier;
  average only `base` + `expansion` and ignore accessories/promos; or treat it as
  its own rating people give explicitly ("how good is Catan *as a whole*").
  Recommend deriving it with base-weighting first â€” no schema change, and it can
  become explicit later if it feels wrong.
- Does the `duplicates` filter treat a family as one thing, or per-entry?
- Does search surface the family or the individual entries?

### Shelf mode / camera vision

Approved 2026-08-05, in progress. See "Next session â†’ A2" below.

---

---

## Next session â€” decided 2026-08-04, revised 2026-08-05

Two things to build, in this order. Both are unblocked; neither needs BGG.

### A. Barcode scanning â€” backend âœ… done, UI still to build

The original plan was **scan â†’ local â†’ LLM â†’ confirm**. Research on 2026-08-05
found two free rungs that belong between local and the LLM, so the shipped
design is **local â†’ GameUPC â†’ UPCitemdb â†’ LLM â†’ confirm**. That took the
measured hit rate from 2/4 to 4/4 without spending anything, and demoted the
2-minute LLM call to a rare fallback. Details in the barcode section above.

Still to build: the scanner UI. `BarcodeDetector` where available (Android
Chrome), ZXing wasm fallback for iOS Safari, which does not support it. Present
every result as a **candidate to confirm**, never an automatic write. Confirmed
scans write back to `edition.barcode` *and* to GameUPC.

Rejected: always asking the LLM (costs money and two minutes for games already
owned) and local-only matching (useless for adding anything new, which is the
point).

### A2. Camera / vision â€” proposed 2026-08-05, awaiting a decision

The insight worth keeping: **barcodes are a weak primitive for board games.**
Half the sample had no usable barcode record anywhere, Kickstarter and
small-publisher editions frequently have none at all, and the barcode is often
on shrink-wrap that is long gone. The title, meanwhile, is printed on the box in
40-point type.

Ideas, ranked:

1. **Shelf mode.** One photo of a row of spines â†’ Claude returns every title it
   can read â†’ tick a checklist. Turns 40 games into ~4 photos. ~$0.005/photo at
   1024px. Barcode is precision for one item; a shelf photo is recall for many.
   Pairs with the existing `uncatalogued` filter as the follow-up worklist.
2. **Photograph the cover, not the barcode.** Degrades gracefully â€” a partial
   read still yields a name to confirm.
3. **Capture the video frame alongside the barcode**, so a barcode miss already
   has an image for vision fallback with no second interaction.
4. **Batch capture, deferred processing** (IndexedDB queue, one review screen).
   Never block on network â€” these boxes live in a basement.
5. ~~Store the cover photo on the copy (R2)~~ â€” **demoted to opt-in only.** See
   the transience requirement below.

**Photos must be self-contained (owner requirement, 2026-08-05).** No captured
photo may land in the iPhone's camera roll â€” nobody wants a photo library full
of pictures only one app needed. The same logic applies server-side: capture into
memory, send, read, discard.

**Settled 2026-08-05: nothing is stored at all.** The R2 binding is gone from
`wrangler.toml`. A scan photo goes from the upload request straight into the
vision call and is then unreferenced â€” vision takes the base64 from the request,
enrichment works from the extracted titles, and the review screen never shows an
image. The bucket had been write-only storage whose entire purpose was to be
deleted later, and one code path forgetting to delete was all it took to keep
photos indefinitely. Not writing them is a guarantee; remembering to delete them
was a habit. `photo_key` now holds the marker `not-stored`.

This makes `getUserMedia` + canvas the *primary* capture path rather than a
fallback, since it provably writes nothing to Photos. Whether
`<input type="file" capture>` also avoids the camera roll on iOS is being
verified â€” if it does not, that fallback is out entirely.

Known limits, so nobody oversells it: stylized spine typography misreads, you
get a title only (no edition/printing), and base-vs-expansion is unreliable from
a spine. Downscale to ~1024px long edge on-device â€” 4Ã— cheaper, no accuracy loss
for reading a title.

Rejected: on-device OCR (Tesseract.js). Board game cover typography is stylized
and OCR does badly on it; the vision call is cheap enough that shipping a wasm
blob isn't worth it.

### B. Phase 3 â€” the research pipeline

See below. The key is verified and the web-search tool works.

**Note on scheduling:** cloud routines were considered and rejected â€” they run
in Anthropic's cloud with no access to this machine, so they cannot read the
API key, deploy to Cloudflare, migrate D1, or test on a phone. Work happens in
a local session instead.

---

---

## Phase 3, when the key is in

The design is `docs/DESIGN.md` Â§5. The shape that matters:

1. **Three tiers, three separate API calls** â€” official publisher, then
   crowdfunding, then retail. Separate calls keep provenance clean and let one
   tier be re-run alone.
2. **`allowed_domains` on the web-search tool enforces the ordering.** Tier 1
   sets it to the publisher's domain and nothing else, so the model *cannot*
   cite Amazon during the official pass. That's the difference between a prompt
   that asks nicely and a constraint that holds.
3. **Findings land in `research_finding`, never the catalog.** Each row carries
   source URL, tier and confidence; a human accepts or rejects. The tables and
   indexes already exist from migration 0001.
4. **Cost is the design constraint** â€” Â§8. Roughly $0.30â€“$1.00 per game for a
   full three-tier pass. Research must be an explicit per-item action with a
   tier picker, never automatic, and bulk runs must show an estimate first.
5. Model `claude-opus-5`, adaptive thinking, structured outputs so findings
   arrive already shaped for the staging table, and a cached system prompt
   since it's identical across every game.

Sleeve requirements deserve the cross-check described in Â§5: publisher, BGG and
sleeve-vendor charts agreeing â†’ auto-accept; disagreeing â†’ flagged with all
three values side by side.

---

---

## Not built

- Phase 2 UI (search-and-pick, paste-a-list, edition picker) â€” blocked on token
- Phase 3 research pipeline â€” blocked on key
- Phase 4 bulk CLI, phase 5 barcode scanning, phase 6 offline PWA
- `sleeve_requirement` has a table and no UI
- No automated tests â€” everything so far verified by exercising the running app

---
