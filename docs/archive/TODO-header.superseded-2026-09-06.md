# 🛑 RETIRED — the `TODO.md` header as it stood on 2026-09-06

> **Status:** ARCHIVE. **Retired:** 2026-09-06 by agent `W13-GAMES`.
> **Replaced by:** the single current paragraph at the top of
> [`../TODO.md`](../TODO.md). Nothing on this page describes current state.
>
> ⚠️ **Do not read this for what is open.** Every line below was true when it
> was written and most were superseded within hours; read `../TODO.md`.

## Why it was retired

The header had grown to **five stacked paragraphs**, each announcing that the
one above it was wrong:

| Order | Dated | What it did |
|---|---|---|
| 1 | 2026-09-06 | KI-7 fixed and moved to `DONE.md` |
| 2 | 2026-09-05 evening | struck through in place — the bug it announced had moved |
| 3 | 2026-09-05 afternoon | "Last updated", the docs-audit summary |
| 4 | 2026-09-05 evening | *"Superseded the same evening"* — corrects 3 |
| 5 | 2026-09-05 evening | *"Superseded again the same evening"* — corrects 4 |

🔴 **The failure that made this worth retiring rather than trimming: paragraph
3 asserted states that paragraphs 4 and 5 corrected, and a reader who stopped
at the first plausible-looking line got a stale answer.** A `TODO.md` is read
top-down by somebody in a hurry; a header that has to be read to the bottom
before any of it can be trusted is a header that does not work. The strikethrough
in paragraph 2 and the `~~…~~` inside paragraph 5 were the same instinct applied
one edit at a time.

⚠️ It is kept **whole and verbatim** rather than summarised, per the estate
docs standard: the summary always drops the *why*, and the reason a claim was
made and then withdrawn is the only reason to keep it at all.

---

## The text, verbatim

✅ **Newest first, 2026-09-06 (agent W9-KI7): KI-7 IS FIXED AND DEPLOYED, and
its section has moved WHOLE to [`DONE.md`](DONE.md).** The conductor called it,
the guard was ported from `library_catalog` into `@bgc/db`'s `setUserRole` keyed
on the target's current role, both route-level copies are gone, the two `.todo`
tests are live, and it shipped as `c0e55a0` → worker version `e4519a77…`. The
number KI-7 was written UNMEASURED to demand was read from production D1 and
written into its entry: **1 `admin`, 2 `owner`, 1 `member`.**
**This repo has no open privilege bug.**

~~🔴 **Newest first, 2026-09-05 (evening, agent W9-BOARD-ROUTES):** the repo's
first route tests landed (16 files, +387 cases, 348 → 735 — see
[`DONE.md`](DONE.md)) and **found a live privilege bug**. It is the first `##`
section below: **KI-7, an `admin` can demote the last `owner`.** It was
deliberately not fixed — a role-bearing change is the conductor's call — and the
fix already exists in `library_catalog`. Nothing was deployed on that pass.~~
(The route tests themselves are unchanged and still in `DONE.md`; only the bug
they found has moved.)

**Last updated:** 2026-09-05 (afternoon) — **a full docs audit re-measured
every `##` section in this file against git, the code and live D1**, and the
headline is that **this file was telling the truth in its bodies and lying in
its headings**. Two `##` sections carried `☐` over bodies that read BUILT →
DEPLOYED → live-proved; a third said `☐ phase 9` over a body saying phase 9 had
moved to `DONE.md`. Both are fixed, and each carries a dated
`⚠️ Corrected 2026-09-05` line saying what was measured. **Four rows of *What
still wants a person* turned out to have already happened** — the component
backfill, the Excursion Tiles edge, the three orphaned rows and the Excursion
Tiles year — all struck with the live number that settled them. One stale
`file:line` in the audit section would have sent a fixer to a file that no
longer holds the code. **Nothing was built and nothing was deployed on this
pass; only claims changed.** The audit also **surfaced one owner decision that
had never reached this file** — the family-rating question he raised on
2026-08-05, which had lived in `info/design-decisions.md` for a month while half
of the section around it was quietly built.

⚠️ **Superseded the same evening, 2026-09-05 (agent W2-GAMES).** The line below
read *"two audit findings"* and *"the billing soak, which needs the owner to
write a deny rule before anything can be measured"*. **Both are now wrong, in
opposite directions:** the two audit findings — and the export exposure beside
them — were BUILT and moved to [`DONE.md`](DONE.md) (`751980b`, `7f75804`,
`6394cca`), and the owner had **already written the deny rule** on 2026-09-02;
the billing section's "no row for `games`" claim was stale and is corrected in
place. What is open now: ❓ **one owner decision** (the family score); ~~🔴 **ONE
DEPLOY** — `DEPLOY_HOLDER=<you> npm run deploy`, which ships all three audit
fixes, refused to the session that made them~~ (⚠️ Corrected 2026-09-05 14:40
Phoenix: **deployed**, version `7fb197b3` — it ran in PowerShell where Git Bash
was refused; only the contributor eyeball of `/api/export.json` remains);
🔴 **the billing shadow flip,
also an OWNER STEP** — refused on `apps/worker/wrangler.toml`, with the exact
three-file change written out in that section; three person-errands in *What
still wants a person*; and three owner reviews on his phone.

🔴 **Two of those are permission refusals, not judgement calls.** Agent
W2-GAMES was denied every edit to `apps/worker/wrangler.toml` and denied
`npm run deploy`, stopped rather than working around either, and left both
written out to the keystroke.

✅ **Superseded again the same evening, 2026-09-05 (agent W5-FAMILY).** The
line above says *"What is open now: ❓ **one owner decision** (the family
score)"*. **The owner answered it at 16:14 Phoenix — (a), the base-weighted
mean — and it is built (`aef62e8`) and deployed.** The section that asked the
question has moved WHOLE to [`DONE.md`](DONE.md); what is left in this file is
an owner review, two reversible defaults he did not rule on, and one thing
deliberately not built. **No owner decision is outstanding here now.** The
billing shadow flip is still an owner step and is untouched — `wrangler.toml`
and `BILLING_POLICY` were off-limits to that agent too, and it did not go near
them.

~~**What is genuinely open, in full:** ❓ one owner decision (the family score),
the billing soak (which needs the owner to write a deny rule before anything can
be measured), two audit findings, three person-errands in *What still wants a
person*, and two owner reviews on his phone.~~ Before that:
2026-09-05 — phase 9 landed (the games provisioner + the
`BILLING_SITE` lift) and both items moved WHOLE to [`DONE.md`](DONE.md); the
one owner question it left (the naming split) was answered the same morning:
(a), as built. Before that:
2026-09-02 — billing phase 3 landed INERT; the soak that
flips it is the item directly below. The two 2026-08-13 **"BUILT, NOT
DEPLOYED"** items left for [`DONE.md`](DONE.md) the same day: both were
verified **already live** in `2e598a9e` (they rode the 2026-09-02 deploys) and
neither needed a deploy of its own. ⚠️ The estate-auth one is at **`enforce`**,
not shadow, and stays there — the reasoning is in its `DONE.md` entry.
