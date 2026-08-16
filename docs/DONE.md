# DONE — Board Game Catalog (dated archive)

> **Audience:** Claude sessions. **Status:** TRACKED. Created **2026-08-16** to
> complete the estate's four-doc set (`TODO.md` · `DONE.md` · `access/` ·
> `info/`), which this repo was otherwise missing.
>
> ⚠️ **This is an archive, not a living doc. APPEND ONLY.** Nothing here is
> ever edited, re-summarised or tidied. An item arrives exactly once, at
> completion, moved **whole** from [`TODO.md`](TODO.md) — cut and paste, never
> summarised, because the summary always drops the *why*.

## It starts empty, and that is correct

Nothing has been moved here yet. Unlike its siblings, this repo's
[`TODO.md`](TODO.md) never accumulated finished work — it is 64 lines and says
of itself that it holds *only* "we decided to do this later". So there was no
backlog of completed items to archive, and inventing entries by trawling git
history would produce exactly the summarised, why-less record this file exists
to avoid.

**Where this repo's finished work is actually recorded, until entries arrive
here:**

| Looking for | Read |
|---|---|
| What shipped, and the state it left things in | [`HANDOFF.md`](HANDOFF.md) |
| How and why something works | [`info/`](info/README.md) |
| How to operate or deploy it | [`access/`](access/README.md) |
| Questions still genuinely open | [`open-questions.md`](open-questions.md) |

## How to use it from here

When a `TODO.md` item finishes, move the **whole** section here under a dated
heading, newest first. Do not edit it on the way out, and do not edit it after.
If what finished produced a durable fact — a gotcha, a measured threshold, a
design rationale — that part belongs in [`info/`](info/README.md) or
[`access/`](access/README.md) instead, findable by topic rather than by the day
it happened. Cross-link; never duplicate.

⚠️ This split does **not** reinstate the "competing living docs" problem. An
archive is not a living doc — it does not compete with `TODO.md` or
`HANDOFF.md` for "what is happening now", so do not helpfully re-merge them.
