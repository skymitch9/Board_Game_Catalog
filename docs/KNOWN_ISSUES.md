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

