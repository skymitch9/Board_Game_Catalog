# Board_Game_Catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-21**.
>
> **This file exists to stop the same non-bug being re-reported every month.**
> It holds things that ARE wrong, or look wrong, and are deliberately tolerated.
>
> - Work in flight → [`TODO.md`](TODO.md)
> - Traps you fall INTO while working → [`info/gotchas.md`](info/gotchas.md)
> - Finished work → [`DONE.md`](DONE.md)
>
> ⚠️ **A gotcha is something you *do* wrong. A known issue is something that
> *is* wrong and is tolerated.**
>
> Every entry carries **Symptom · Status · Why tolerated · What would change
> it** — the last one a NUMBER wherever it can be. Format rules:
> `catalog-platform/docs/DOCS_STANDARD.md` §5.

**Status values:** `ACCEPTED` · `WAIVED` · `BLOCKED` · `WATCHING`.

---

## ~~KI-1~~ · RESOLVED 2026-08-21

`HANDOFF.md` was split into `TODO.md` (4 open items) + `DONE.md` (36 finished
sections) + `info/` (gotchas, system reference, design decisions) per estate
DOCS_STANDARD. The original is archived at
`archive/HANDOFF.superseded-2026-08-21.md`.

---

## KI-2 · `bgc-photos` is an unbound bucket holding zero objects — `ACCEPTED`

**Symptom.** A bucket exists, is empty, and is skipped by the backup matrix.

**Why tolerated.** It is genuinely empty (measured 2026-08-15) and unbound to
any Worker, so a zero-object listing is the truth rather than a failed backup.
`scripts/backup-r2.mjs` would otherwise treat 0 objects as a failure — correctly,
which is why the bucket is out of the matrix rather than passed `--allow-empty`.

**What would change it.** The day it holds anything, it joins the matrix.
⚠️ Written as a rule in `backup.yml`'s header beside the matrix it explains —
prose has lost that argument before, which is why `estate-audio` got a
mechanical guard instead.

---

## KI-3 · Text written on this machine can come back double-encoded — `WATCHING`, and it has now happened TWICE

**Symptom.** Every `—`, `…`, `✅`, `⚠️` and `·` in a file turns into `â€"`,
`â€¦`, `âœ…`, `âš ` and `Â·`. ⚠️ **Nothing catches it** — the file typechecks,
builds, deploys and renders; it just reads as garbage.

**Why tolerated.** It is an environment trap (UTF-8 bytes decoded as cp1252 and
re-encoded), not a bug in any one script. This repo's own gotchas file has
recorded it since the `ScanPage.tsx` incident; it recurred on **2026-08-21**
during the `HANDOFF.md` split, corrupting **1,362 lines across six docs**.

**What would change it.** A pre-commit check. Until then, ⚠️ **after any bulk
rewrite of text files on this machine, scan before committing** —
`git diff` will show it, and so will one heading.

🔴 **THREE THINGS THAT MAKE THE REPAIR ITSELF DANGEROUS**, all measured the day
it recurred:

1. ⚠️ **Detect per SEGMENT, not per file or per line.** A whole-file round trip
   reported *zero* corrupt files against a file with 681 corrupt lines: one
   character outside cp1252 anywhere makes the encode raise and the file is
   written off as clean. Per-line has the same flaw one level down.
2. ⚠️ **Prefer git over inference.** Where the pre-corruption bytes exist in a
   commit, restore them — that is exact. The archived `HANDOFF` copy was
   restored that way and verified **byte-identical** (223,407 bytes).
3. 🔴 **NEVER run a repair to convergence.** A document *about* mojibake
   contains mojibake **on purpose** — this repo's gotcha reads *"every `—`,
   `…` and `·` came back as `â€”`, `â€¦` and `Â·`"*. A second pass turns that
   into *"`·` came back as `·`"* and destroys the example. It happened, and the
   line had to be restored verbatim from the original.
