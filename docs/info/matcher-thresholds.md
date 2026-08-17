# Matcher thresholds — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17**. Every number below was measured 2026-08-17
> against the live production catalog (read-only) unless dated otherwise.

Evidence for the standing TODO item "Two thresholds worth re-measuring one
day". **Measurement only — nothing in production code was changed.** The
threshold decision belongs to the owner; this file is the evidence for it.

Reproduce everything here with:

```
npx tsx scripts/measure-matcher.ts            # queries remote D1, SELECT only
```

## Where the knob actually lives (and where it does not)

`matchExistingTitle` → `matchIndexedTitle` (`packages/core/src/vision.ts`)
answers "you already own this" in three passes: exact-after-normalise, exact
alias, then **substring containment gated by a char-length ratio —
`shorter/longer >= 0.6`** (vision.ts, the containment filter in
`matchIndexedTitle`). The exact and alias passes have no threshold. **The 0.6
length ratio is the only tunable number in the ownership matcher.**

The famous "similarity floor set to 0.34 that did nothing"
(`MIN_TITLE_SIMILARITY`, and its sibling `MIN_SPINE_SIMILARITY = 0.7`, both in
`packages/core/src/barcode.ts`) gates a *different* question — how well a
free-database **lookup result** matches the searched title. Those floors never
touch `matchExistingTitle`. That is *why* 0.34 did nothing for this failure:
it was the right value on the wrong knob. Do not repeat this — any change to
"the matcher threshold" means the 0.6 ratio in `vision.ts`.

## Method (2026-08-17)

- Catalog: **837 items, 72 aliases**, pulled read-only from remote D1.
- Harness: `scripts/measure-matcher.ts` restates the containment gate with the
  floor injected, and **aborts unless its 0.60 output is identical to the real
  `matchIndexedTitle` on every probe** (6,788 probes checked) — it measures the
  shipped algorithm or nothing.
- Probe sets:
  - **LOO** — all 837 real names, each matched against the catalog minus its
    own row. Any hit pairs two *different* products.
  - **POS** (3,908) — synthetic same-game reads per real name: ALL-CAPS,
    reprint suffixes ("2nd Edition" / ": Second Edition"), last word truncated,
    one interior OCR substitution (o→0). A miss is a false reject.
  - **NEG** (2,042) — synthetic different-game reads: unowned base-game prefix
    (the Boss Monster shape), sequel `" 2"`, `"Super "` prefix, bare last word.
    A hit is a false accept — the failure that **loses** a new game.
  - **Real scans** — all 13 production shelf scans (255 vision reads) from
    `scan_job.raw_titles`, including job 13, the actual BOSS MONSTER scan.
    Replayed descriptively (no ground-truth labels).

## Design A — the production knob (char-length ratio), swept

| floor | NEG false-accepts | POS false-rejects (excl. OCR¹) | LOO cross-matches (same-family) |
|---|---|---|---|
| 0.34 | 1810 (88.6%) | 88 (2.8%) | 289 (280) |
| 0.50 | 1715 (84.0%) | 153 (4.8%) | 149 (143) |
| 0.55 | 1678 (82.2%) | 227 (7.2%) | 99 (91) |
| **0.60 (today)** | **1665 (81.5%)** | **326 (10.3%)** | **69 (60)** |
| 0.62 | 1655 (81.0%) | 403 (12.7%) | 53 (43) |
| 0.64 | 1648 (80.7%) | 479 (15.1%) | 45 (36) |
| 0.66 | 1633 (80.0%) | 592 (18.7%) | 42 (33) |
| **0.68** | **1619 (79.3%)** | **682 (21.6%)** | **35 (27)** |
| 0.70 | 1609 (78.8%) | 821 (25.9%) | 24 (18) |
| 0.75 | 1564 (76.6%) | 1301 (41.1%) | 17 (11) |
| 0.80 | 1448 (70.9%) | 1766 (55.8%) | 6 (2) |
| 0.95 | 328 (16.1%) | 2325 (73.5%) | 2 (0) |

¹ OCR-noise probes (744) are excluded from the headline FR because **no floor
can save them**: containment has zero tolerance for an interior wrong
character, so `pos-ocr` matched **0 at every floor**. The full-sweep table with
both columns is in the harness output.

**There is no elbow.** False accepts fall only ~2 points across the whole
usable range (0.60→0.70) while false rejects climb ~16 points. The reason is
in the per-class detail:

| class | probes | matched @0.60 | @0.65 | @0.70 |
|---|---|---|---|---|
| neg-base-prefix (Boss Monster shape) | 65 | 19 | 10 | 4 |
| neg-sequel ("X 2") | 836 | 836 | 836 | 832 |
| neg-super ("Super X") | 837 | 809 | 790 | 773 |
| neg-one-word | 304 | 1 | 0 | 0 |
| pos-reprint | 1674 | 1408 | 1231 | 968 |
| pos-trunc | 653 | 621 | 595 | 555 |
| pos-caps (exact path) | 837 | 837 | 837 | 837 |

⚠️ **The floor only discriminates in the base-prefix class.** Appending `" 2"`
or `"Super "` barely changes a string's length, so those ratios sit near 1.0
and sail over any floor that lets anything genuine through. "You own *Boss
Monster*, you scan *Boss Monster 2*" is unfixable by this knob at any value —
and it is invisible to the word-level machinery too, because `titleWords`
drops single-character tokens, making `"X 2"` *word-identical* to `"X"`.

## Designs B and C — the word-level machinery is not a better gate here

- **B** (containment gated by `titleSimilarity >= f` instead of char ratio):
  at matched NEG false-accepts (1665), B@0.70 has lower synthetic FR (6.8% vs
  10.3%) but **nearly double the real-catalog cross-matches (133 vs 69)** —
  and it does **not** kill BOSS MONSTER:
  `titleSimilarity("super boss monster 2", "boss monster") = 0.80`, over even
  the strict spine floor.
- **C** (containment + `isConfidentMatch`, i.e. fragment veto + 0.7): kills
  BOSS MONSTER, but its fragment veto rejects any strict word-subset — which
  is nearly the whole containment class. **FR 70.3% (excl. OCR)**: it
  effectively deletes the containment pass.

## BOSS MONSTER — reproduced on the real production scan (job 13)

| floor | `BOSS MONSTER` → |
|---|---|
| 0.34 | "Boss Monster: Rise of the Minibosses" |
| 0.60 (production, verified against real `matchIndexedTitle`) | **"Super Boss Monster 2"** — the incident, exactly |
| 0.62 | "Boss Monster Junior" |
| 0.64–0.66 | "Super Boss Monster" |
| **0.68+** | **no match** |

The mechanics: "boss monster" (12 chars) is a substring of three owned keys —
"super boss monster 2" (12/20 = **0.600**, exactly on today's gate), "boss
monster junior" (0.632), "super boss monster" (0.667). Longest-key-wins picks
the sequel. Intermediate floors just rotate through *different wrong games*;
only **≥ 0.68** clears the whole cluster (next boundary up: 0.667; first
genuine casualty band starts immediately after, see below).

## The real 255 production reads: what 0.60 → 0.68 actually changes

162 of the 184 real matches at 0.60 are **exact/alias — untouched by any
floor** (this is the modern form of "the 44/73 were nearly all exact"). Of the
22 containment matches, 13 flip at 0.68 — and **none of the 13 was a correct
answer at 0.60**:

| read (job) | 0.60 said | truth | 0.68 says |
|---|---|---|---|
| BOSS MONSTER (13) | Super Boss Monster 2 | different game | no match ✔ |
| Dice Throne (7, 11, 15, 34 — 4×) | Marvel Dice Throne | no bare "Dice Throne" row exists; wrong specific product | no match |
| DEEP ROCK GALACTIC (12, 13 — 3×) | DRG: **Steeve Mini** (promo) | owned base is "DRG: The Board Game" (ratio 0.545 — under the gate!) | no match |
| Tic Tac K.O. (12) | **Tic-Tac** (different game) | owned row is "Tic Tac K.O.: Dragons vs Unicorns" (0.35 — unreachable) | no match ✔ |
| Marvel Dice Throne: Deadpool (11) | Marvel Dice Throne | owned row is "Dice Throne: Deadpool Box Deluxe Edition" | no match |
| King of Tokyo (15) | KoT **Playmat** (accessory) | no bare KoT owned | KoT: **Duel** — still wrong |
| TED Adventures: Phantom Voyage (19) | the base game | owned row is "…: **The** Phantom Voyage" — interior word breaks substring containment at any floor | no match |
| Auroboros …Worldbook: Lawbrand (35) | the base game | worldbook row not in catalog | no match |

The 9 containment matches that survive 0.68 are a mix of genuine catches
("Ryoko's Guide to the Yokai Realm**s**", "Hypothetical(ly)", "Cosmere RPG
Stonewalkers" → "…Stonewalkers Adventure") and family-level wrong-products
("Marvel Dice Throne X-Men" → "Marvel Dice Throne").

What 0.68 costs on synthetics: reprint-suffix reads of *short* titles stop
matching ("Sheriff of Nottingham 2nd Edition" → null; long titles still pass),
plus some truncations ("TICKET TO" → null). Real scans contained zero
reprint-suffix reads.

## Recommendation (owner's decision — not applied)

**Raise the containment ratio in `matchIndexedTitle` from 0.60 to 0.68.** It
is the lowest value that kills the entire BOSS MONSTER cluster, it costs *zero
correct answers on all 255 real production reads* (every real flip was a
confident wrong match at 0.60, several of the lost-game kind), it halves
real-catalog cross-collisions (69 → 35), and it leaves the exact/alias passes
— which carry 162 of 184 real matches — untouched. The measured cost is
synthetic: ~11 points more false-reject on reprint-suffix/truncation reads
(10.3% → 21.6% excl. OCR), a class that has not yet appeared in a real scan
and whose failure costs a duplicate prompt, not a lost game.

Worth knowing before deciding:

- **0.62–0.66 are the worst options** — BOSS MONSTER still matches, just to
  different wrong games.
- **No value of this knob fixes sequels** ("X 2", "Super X"): near-1.0 length
  ratios, and `" 2"` is invisible to word-level similarity too. If that class
  matters, it needs a different guard (e.g. trailing-number mismatch veto) or
  a confirm-first UX for containment matches — a design change, not a
  threshold.
  **→ BUILT 2026-08-16 (confirm-first).** The matcher now says *how* it
  matched — `matchIndexedTitleDetailed` / `matchExistingTitleDetailed` in
  `packages/core/src/vision.ts` return `matchKind:
  'exact' | 'alias' | 'containment'`; the plain functions are unchanged
  wrappers. Enrichment persists the kind on the queue row
  (`ScannedTitle.matchKind`, `apps/worker/src/lib/barcode-scan.ts`; set in
  `enrichOne` and the barcode name-match), and `resolveOwnership`
  (`apps/worker/src/lib/scan-ownership.ts`) marks any unanswered containment
  match `pendingConfirmation`. The review screen (`ScanJobsPage.tsx`) renders
  those rows as **"Looks like {existing} — same game?"** with confirm/reject:
  confirm settles the row as already-owned (persisted as
  `ownershipConfirmed`), reject (`ownershipRejected`) turns it into an
  ordinary add-candidate and stops containment matches being honoured for
  that row. Exact/alias passes and the 0.68 floor are untouched; rows
  enriched before the field existed carry no `matchKind` and keep the old
  auto-file behaviour. Tests:
  `apps/worker/src/lib/ownership-confirm.test.ts`.
- Two real reads ("Deep Rock Galactic" at 0.545, "Tic Tac K.O." at 0.35) show
  the *owned correct row sitting under the gate* while a wrong row passed it.
  Containment + longest-wins can prefer a promo over the base game; a floor
  cannot fix ranking, only admission.
- OCR interior noise never matches at any floor; only exact reads and clean
  truncations survive normalisation. The matcher's robustness comes almost
  entirely from `normaliseTitle`, not from containment.

## Not verified / not measured

- Synthetic POS/NEG labels are constructed (a "2nd Edition" read is *assumed*
  same-game, an "X 2" read *assumed* different): real-world reprints and
  sequels vary. The real-scan replay carries no such assumption but also no
  ground-truth labels beyond the catalog itself.
- The original 44/73 run was against the 86-item local catalog and was not
  re-run; its modern analogue (162/184 exact on 255 production reads) was
  measured instead.
- `MIN_SPINE_SIMILARITY = 0.7` (the lookup-result floor, barcode.ts) was not
  re-swept against lookup candidates — this file measured the ownership
  matcher only. The 0.7 floor's own calibration story is in `HANDOFF.md`
  ("two thresholds on purpose").
- What the UI does downstream of a false accept (how "already owned" renders,
  whether a wrongly-filed game is recoverable) was not exercised.
