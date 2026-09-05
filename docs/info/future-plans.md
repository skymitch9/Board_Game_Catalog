# Future Plans — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-05** for the fingerprinting measurements below —
> they were NOT re-run on 2026-09-05. What the 2026-09-05 docs audit *did*
> do is repair this file's pointers and file one more parked idea into it
> (the shelf-photograph split, moved whole out of `TODO.md`).

Ideas deliberately deferred, with enough detail to pick up later and enough
honesty about why they were deferred to avoid repeating a dead end.

Current work in flight lives in [`../TODO.md`](../TODO.md); this file is
only for things nobody is building right now. ⚠️ **Corrected 2026-09-05:**
this line used to send readers to `../HANDOFF.md`, which has been a 15-line
signpost since the 2026-08-21 split and has held no state since.

---

## Translation-invariant photo fingerprinting

**Deferred 2026-08-05, after the naive version was built, measured, and removed.**

**The goal:** re-photographing a box you already scanned should not pay for a
second vision call.

**What was tried:** a 64-bit difference hash of the captured frame, matched by
Hamming distance. It failed decisively. Five handheld shots of the same box gave
pairwise distances of 21, 21, 26, 26, 27, 28, 29, 32, 33, 35 — against a
threshold of 8, and against 32 being the average distance between two *random*
64-bit values. Essentially no signal.

**Why:** dHash is robust to brightness, scale and compression, and not at all to
framing. Every handheld shot crops and rotates slightly, so the 9×8 sample grid
lands on different parts of the box and nearly every bit flips. It suits "same
file, re-encoded" — not "same object, re-photographed by a person".

**What would actually be needed:** a fingerprint invariant to translation, small
rotation and crop. Realistic options are feature-descriptor matching (ORB/AKAZE
keypoints, match count as the similarity score) or a small embedding model. Both
are far more work than the problem justifies at current prices.

**The bar for revisiting.** Prove it before building it: collect 20–30 real
handheld pairs (same box, different shots) plus 20–30 negative pairs (different
boxes), and show a threshold that separates them cleanly. If the distributions
overlap, stop — a false positive means confidently showing the *wrong game*,
which is much worse than a repeat call.

**Why it is low priority:** a repeat box scan costs about half a cent and three
to five seconds. The genuinely expensive path — barcode → web search, ~2 minutes
— is already avoided by the ladder, and `lookup_cache` already makes repeat
*title* resolution free because that one is deterministic.

**A cheaper alternative to consider first:** solve it in the UI instead. Keeping
the last reading on screen, or showing this session's recent scans so a game can
be re-added without re-shooting, addresses the real cost — the person's time —
without needing any of the above.

---

## Splitting a shelf photograph into pieces

**Moved whole out of `TODO.md` on 2026-09-05** (docs audit). It sat in the work
log as an untitled `##` section with no ☐, reading like queued work; it is a
measurement that killed an idea, which is what this file is for. Original text,
verbatim:

> Raised alongside the enrichment stall, and **would not have fixed it** — worth
> recording so nobody spends a day on it for the wrong reason.
>
> Vision reads a wide shelf perfectly well: production job 5 produced all 73
> titles and stored them. What ran out of budget was the per-title *enrichment*
> afterwards, which is now chunked. Splitting the image would have made vision
> cost more and changed nothing about the failure.
>
> It may still be worth doing later for **accuracy** on a very wide shelf, where
> spines at the edges are small and skewed. That is a different argument and needs
> its own evidence — measure the read rate on a wide shelf before building it.

**The bar for revisiting**, restated as this file's other entries state theirs:
photograph a genuinely wide shelf, count how many spines the single-image read
returns against how many are on it, and only then compare a split. A split that
is not measured against the whole-image read is a cost increase with no number
behind it.

---

## Family / grouping model

Design agreed in outline, not built. ⚠️ **Corrected 2026-09-05:** this pointed
at a "Decisions waiting on the owner" section of `../HANDOFF.md`, which has been
a 15-line signpost since 2026-08-21. The full write-up — `requires` (nest)
versus `related to` (own entry plus a link), the `item_relation` sketch, and the
ratings decision (per-entry scores plus a derived family score) — is in
[`design-decisions.md`](design-decisions.md), and the pre-split original is kept
at [`../archive/HANDOFF.superseded-2026-08-21.md`](../archive/HANDOFF.superseded-2026-08-21.md).
