# Covers Wanted — decisions for the owner

> ⚠️ **ARCHIVED 2026-08-21** during the docs-tree restructure. Kept for the
> reasoning and the evidence, **not as current fact** — do not act on anything
> here without re-measuring. Current state: this repo's `docs/TODO.md`,
> `docs/KNOWN_ISSUES.md` and the `access/` + `info/` indexes. Rules:
> `catalog-platform/docs/DOCS_STANDARD.md` §6.

> **Audience:** the owner first, Claude sessions second. **Status:** TRACKED.
> Last verified: **2026-08-06**.

Ten rows still have no `thumbnail_url`. None of them can be filled under the
standing rules, which are:

- durable source only — BoardGameGeek, `cdn.shopify.com`, or a publisher origin
- the image must be **of that exact product**
- verified cookieless: `200` + `image/*`
- no `bgg_id` attached to reach a picture

Every candidate below needs an **exception** to one of those, so none was
written. Each entry says what the exception is. Approve or reject per item.

Every URL listed here was fetched cookieless and returned `200` with an
`image/*` content type on 2026-08-06, unless the entry says otherwise.

**How to use this:** under each item, either say "take candidate A" or paste
your own URL on the `Owner's URL:` line.

---

## Two candidates I would take if you approve them

### 303 — The Binding of Isaac: Four Souls - Gold Box Expansion
*under* The Binding of Isaac: Four Souls

**Candidate A — recommended.** BoardGameGeek entry 257422, *"The Binding of
Isaac Four Souls: Kickstarter Expansion Pack"* (2018).

```
https://cf.geekdo-images.com/AMSX6i7hdLXp4B9g8uVffw__small/img/ujNZ-f98wXW7MelTUZDOZSrTFdg=/fit-in/200x150/filters:strip_icc()/pic6122601.jpg
```
Full size (19 KB): `.../AMSX6i7hdLXp4B9g8uVffw__original/img/Yf73n2ixviPg-dmnCfF5fng0TBw=/0x0/filters:format(jpeg)/pic6122601.jpg`

- **Depicts:** a gold-trimmed wooden coffin-style box, open, with the Four Souls
  logo on the lid. I looked at it.
- **Exception needed:** name mismatch only. BGG calls it the "Kickstarter
  Expansion Pack"; you call it the "Gold Box Expansion". The BGG description
  reads *"The first ever Expansion ... exclusive to Kickstarter Campaigns ...
  adds 68 more cards"*, and Amazon sells the same thing as "Four Souls **Gold
  Box** Edition — Kickstarter Exclusive". Item 303's `source_url` is the 2018
  campaign that produced it. I believe it is the same product, but the name
  differs, so it is an identity call and yours to make.
- **Also checked:** maestromedia.com Shopify store, 143 products — no Gold Box
  product listed. It has been out of print since 2018.

Owner's URL: ___________________________________________

---

### 277 — Casting Shadows: Expansion Pack
*under* Casting Shadows

The campaign reward is named exactly "Casting Shadows Expansion Pack" — I
confirmed that on the Kickstarter rewards page. It has no BGG entry under that
name; what shipped is listed on BGG under its retail name.

**Candidate A — recommended.** BGG 360484, *"Casting Shadows: The Ice Storm
Expansion"* (2023), the expansion the 2022 campaign delivered. Its BGG
description opens *"The 5-6 player expansion pack..."*.

```
https://cf.geekdo-images.com/ix0mRjCPtrU-vaeX-U5PNw__small/img/R4aZPANkmiBtjN3NvB5lKO0WtKQ=/fit-in/200x150/filters:strip_icc()/pic8909672.jpg
```

**Candidate B.** BGG 392200, *"Casting Shadows: The Molten Rock Expansion"*
(2024) — a later, separate release. Almost certainly not what you backed.

```
https://cf.geekdo-images.com/sOt30J3el5ZwBZMY3jegDA__small/img/qAtAq19-jWFbxGIwHHdYWsrAdzk=/fit-in/200x150/filters:strip_icc()/pic7615624.jpg
```

**Candidate C.** BGG 365761, *"Casting Shadows: Exclusive Edition"* — the whole
Kickstarter box, not the expansion. Wrong scope, listed only for completeness.

```
https://cf.geekdo-images.com/X6yCyoqhOERpzB2zPMYSXQ__small/img/JmfIQb55ypwVj7-YfIk_iXEJNW4=/fit-in/200x150/filters:strip_icc()/pic9493508.jpg
```

- **Exception needed:** borrowed art — a retail printing standing in for the
  campaign one, under a different name.

Owner's URL: ___________________________________________

---

## Borrowed retail art for Kickstarter-exclusive printings

Both of these are the KS-exclusive printing of an expansion that later shipped
at retail. The retail BGG art shows the same cards in a retail box.

### 294 — Here to Slay: KS Exclusive Monster Expansion Pack
*under* Here to Slay

**Candidate A.** BGG 308526, *"Here to Slay: Monsters Expansion"* (2020) — the
retail printing of the same 13 oversized monster cards.

```
https://cf.geekdo-images.com/67rusdh37wX2idA0vE4Qmw__small/img/n5nJuKgfo_LSSOtrecXB9e_0l3I=/fit-in/200x150/filters:strip_icc()/pic5611283.jpg
```

- **Exception needed:** borrowed art (different printing).
- **Also checked:** `unstablegames.com/products.json` returns HTML, not JSON —
  their storefront is not a plain Shopify JSON endpoint. The pack is
  KS-exclusive and only appears on resale sites.

Owner's URL: ___________________________________________

### 295 — Here to Slay: KS Exclusive Dragon Sorcerers Expansion Pack
*under* Here to Slay

**Candidate A.** BGG 308525, *"Here to Slay: Dragon Sorcerer Expansion"* (2020).

```
https://cf.geekdo-images.com/n5pGRkeVlwyaPY_SdJjSMQ__small/img/emtH23TOx3g09nLRPjJugpBpuQQ=/fit-in/200x150/filters:strip_icc()/pic5611247.jpg
```

- **Exception needed:** borrowed art (different printing). Note the singular
  "Sorcerer" on BGG against your plural "Sorcerers".

Owner's URL: ___________________________________________

---

## Only a Kickstarter image exists

For both of these the campaign page is the only place the product is pictured.

**An important practical problem:** `i.kickstarter.com` URLs only work with
their signed query string, and I could not capture one. I confirmed the
signature is required — three unsigned URLs pulled from the Casting Shadows
campaign all returned `404`. The browser tool redacts query strings from
anything it returns, so the signature is exactly the part it will not hand
over. **You will need to copy the image address from the campaign page
yourself** (right-click the product image → Copy image address) and paste it
below, keeping the whole `?...` on the end.

Be aware those URLs expire. The cover-health cron (`*/30 * * * *`) will flag
them when they die.

### 161 — Deep Rock Galactic: Barrel Flick Game
*under* Deep Rock Galactic: The Board Game

- Campaign: <https://www.kickstarter.com/projects/moodpublishing/deep-rock-galactic-rivals-and-horrors-of-hoxxes>
  — a Kickstarter-exclusive mini game, given to all backers.
- **Checked and came up empty:** moodpublishing.com Shopify store, all 61
  products — no Barrel Flick. BGG search "Deep Rock Galactic", 25 results — no
  entry for it.
- **Exception needed:** expiring Kickstarter URL.

Owner's URL: ___________________________________________

### 264 — Taverns & Dragons: Pyrodruid Solo Mode
*under* Taverns & Dragons

- Campaign: <https://www.kickstarter.com/projects/qvernet/taverns-and-dragons>
- **Checked and came up empty:** I walked every product page on Lord Raccoon
  Games' Gamefound project (ids 17520–17700, 134 products). The Sneaky Goblin
  expansion is there — that is where item 263's new cover came from — but there
  is no Pyrodruid or solo-mode product. BGG has no entry either; the only
  Taverns & Dragons expansion on BGG is "Granit the Golem & Nobz Whizwagon".
- **Exception needed:** expiring Kickstarter URL.

Owner's URL: ___________________________________________

---

## Nothing found anywhere

I would leave these blank. Listing what was checked so the next session does not
repeat it.

### 414 — HELLDIVERS 2: Mystery Expansions
*under* HELLDIVERS 2: The Board Game

The Steamforged Gamefound campaign contains **no occurrence of the word
"mystery"** anywhere in its page text. There is no such product to photograph —
this row looks like a placeholder for unrevealed stretch content. A HELLDIVERS
box shot would be the exact failure mode you called out: it would look like
data and not be.

If you want it to stop showing as a gap, renaming or removing the row is the
real fix, and that is your call, not mine.

Owner's URL: ___________________________________________

### 540 — Starlight Arcana: Quickstart Box
*under* Starlight Arcana

- `kelfecilstales.com/shop` redirects to a page titled "Random" with no product
  listing; the images on it are all site chrome, shared with every other page.
- The BackerKit pledge manager (`starlight-arcana.backerkit.com`, the row's
  `source_url`) shows only a banner image on its front page — the item list is
  behind a login.
- BGG has one Starlight Arcana entry, rpgitem 425980 "Astral Supplement &
  Campaign" — that is the book, not the Quickstart Box.

Owner's URL: ___________________________________________

### 609 — D&D Beyond Basic Rules
### 673 — Unearthed Arcana
*both under* Dungeon Master's Guide (2024)

D&D Beyond publishes no cover art for either. I scraped both source pages:

| Page | og:image | What it actually is |
|---|---|---|
| `/sources/dnd/br-2024` | `avatars/104/378/636511944060210307.png` | the D&D Beyond logo, 2 KB |
| `/sources/dnd/ua` | `avatars/30761/635/638061086303056337.jpeg` | a generic red D&D ampersand banner — I looked at it |

One further image, `avatars/48763/493/638809278615622299.jpeg`, appears on both
pages **and** on the `/sources` index, so it is site promo furniture, not a
cover for either.

Neither of these comes in a box — they are digital-only sources. Blank is the
honest answer.

Owner's URL (609): ___________________________________________

Owner's URL (673): ___________________________________________

---

## Deliberately skipped

**808 — Veiled Fate: Metal Edition** (`upgrade`). You said it is basically an
accessory and does not need a cover. Untouched.

---

## What was filled this pass, for contrast

Eight rows were filled without needing any exception, and are already live:

| id | Item | Source |
|---|---|---|
| 203 | Ichor: Reinforcements & Gates Expansion | BGG 436368, exact name |
| 263 | Taverns & Dragons: Sneaky Goblin Expansion | publisher campaign product tile |
| 267 | Moonrakers: Binding Ties Expansion | BGG 366450, exact |
| 268 | Moonrakers: Overload Expansion | BGG 366451, exact |
| 269 | Moonrakers: Nomad Expansion | BGG 366452, exact |
| 288 | The Binding of Isaac: Four Souls+ Expansion | BGG 269477, exact |
| 304 | Aeon's End: Return to Gravehold | BGG 318951, exact |
| 305 | Realm of Reckoning: New Foundations Expansion | BGG 471458, exact |

No `bgg_id` was attached to any of them. Each one's full-size image is also
recorded as an `edition` row, so the cover picker still offers it.

---

# Details lookups — decisions for the owner

> Added 2026-08-06 by the session that built the three-layer "ask once, re-ask
> when the world changes" policy. These are opinions, not changes; nothing below
> was written to the catalog.

## 1. The bulk fill is not safe to run right now

Two of three trial runs **stalled**. Item 92 (Dice Throne: Outcasts) completed
normally in about twenty seconds and filled its playing time for 1.7¢. Items 383
(Ascension 15th Anniversary) and 488 (Before the Stroke of Midnight) both sat at
`status = 'running'` with no error for over four minutes each.

That is the silent-kill signature this project has already been bitten by twice:
the Worker subrequest ceiling **terminates** an invocation rather than throwing,
which takes `waitUntil` with it, so nothing reaches the `catch` and nothing is
recorded. A stalled run looks identical to a working one.

**Pressing "Fill in 88 games" would have fired 88 of these.** The page's driver
starts the next item only when nothing is in flight, so a stall does not spend
88 times over — but it does stop the queue dead while looking busy, which is
exactly the twenty-minute mystery the shelf scanner produced.

The two stalled runs are not permanently stuck: `claimDetailsRun` closes a run
quiet for more than five minutes and starts a fresh one, so asking again about
either item recovers it. But something should be understood before spending
$1.78–$5.28 on the rest.

**Worth checking first:** whether `enrichItem` with web search now costs more
subrequests than the eight the header of `lib/details-run.ts` budgets for. Fifty
is the free-plan ceiling and every D1 call counts alongside every fetch.

## 2. Do not copy Dice Throne player counts across by hand

The instruction was to solve one hero and copy `min_players`, `max_players` and
`playtime_min` to the rest. I did not, and think it should not be done.

The four unfilled rows — 676 Season One ReRolled, 677 Marvel Dice Throne, 678
Mystic Brawler, 679 Alchemist — are **queued for their descriptions anyway**, so
copying the numbers across saves no lookup and no money. It only adds a chance
of being wrong, and the solved rows do not actually agree: X-Men, Santa vs
Krampus and Deadpool are all 2–6 players / 20 min, but Season Two Battle Chest
is 2–6 / 40, Vanguard is 2–4 / 30 and Outcasts is 2–4 / 40. "Every hero is the
same game" is true of the play, not of the box, and the boxes are what the
catalog records.

The same single call that fetches the description fills the numbers. Let it.

## 3. The D&D Beyond publisher URL was applied

Items 621 and 600 (Dungeon Master's Guide 2014 and 2024) now carry
`https://www.dndbeyond.com`. Both had a `source_url` on that domain already, so
this is certain rather than inferred. They stay in the queue for their
descriptions.

Lifting those descriptions from the `source_url` page — a fetch, not a Claude
call — is still worth building and was not built.

## 4. Expect the policy to shorten the queue slowly, not suddenly

Production went 92 → 89 on deploy. Only 17 queued rows carry a `game_system`,
and most are also missing a description or a year, so layer 1 removed exactly
three: Auroboros, Bergin's Book of Beasts and the Cosmere Mistborn Handbook. It
did shrink what the other fourteen are *asked* for, which is where the saving
actually is.

Layer 2 removed nothing, and could not have: `research_run` was empty, so
nothing had ever been asked. It pays from the second pass onward — which is the
pass that would otherwise have re-bought all 89 answers.
