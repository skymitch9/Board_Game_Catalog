# Information — Index

> **Audience:** Claude/Kiro sessions. **Status:** TRACKED (public repo — see
> [`../README.md`](../README.md)).
> Last verified: **2026-09-05** — the docs audit checked one thing here: that
> **every `.md` in this folder has a row and every row's file exists**. It found
> `DESIGN.md` had no row and was linked at a path that does not resolve; both
> are fixed below. ⚠️ **The one-line descriptions themselves were NOT re-read
> against their files** and still carry their original dates.

How and why things work. Stable design facts only — current state and work in
flight live in [`../TODO.md`](../TODO.md); finished work in
[`../DONE.md`](../DONE.md); credentials and endpoints in
[`../access/`](../access/README.md).

| File | Covers |
|---|---|
| [`DESIGN.md`](DESIGN.md) | The overall architecture and the phase plan — the longest document in the tree. ⚠️ **Added to this index 2026-09-05**; it was the one `.md` in this folder with no row, while the closing line of this page linked it as `../DESIGN.md`, a path that has never resolved. ⚠️ Its §on roles **predates the role-ladder redesign** and says so in its own banner: the current picture is `packages/core/src/capabilities.ts` |
| [`completeness.md`](completeness.md) | "What am I missing" — how the official/third-party split is decided, why a BoardGameGeek id is the only proof of ownership, and the 20-id ceiling that answers 400 |
| [`barcode-ladder.md`](barcode-ladder.md) | Why barcode resolution is tiered, what each rung buys, measured hit rates |
| [`scan-queue.md`](scan-queue.md) | What a scan job stores and what it refuses to store — ownership is computed on every read, so two photos of one shelf stop arguing |
| [`ios-camera.md`](ios-camera.md) | Every WebKit constraint the scanner works around, and why photos never reach the camera roll |
| [`copy-status-history.md`](copy-status-history.md) | ✅ **BUILT 2026-09-02 (migration 0029)** — marking a copy sold / given away / lost and keeping an append-only history of it. ⚠️ Read §0 first: a **given-away copy is stored as `status = 'sold'`** (SQLite cannot widen a CHECK), so render state through `copyStateLabel()` and never print `copy.status`. Also holds the evidence that the statuses which already existed had still never been used, three weeks and 49 copies later |
| [`future-plans.md`](future-plans.md) | Deferred ideas, and the measurements that killed the ones already tried |
| [`cost-reduction.md`](cost-reduction.md) | Measured cost of every lookup path, and the one change that would move the needle |
| [`estate-theme.md`](estate-theme.md) | How this app gets its skin: the theme system is CANONICAL in catalog-platform and materialised here at build time by `scripts/sync-estate-theme.mjs`. ⚠️ `apps/web/public/assets/` is gitignored build output; the cog holds no theme list of its own |
| [`matcher-thresholds.md`](matcher-thresholds.md) | Measured sweep of `matchExistingTitle`'s containment floor (the real knob — not the 0.34 lookup floor), the BOSS MONSTER reproduction, and the evidence for 0.68. ⚠️ **The threshold HAS since changed** — `1b7763e` raised the containment floor 0.60 → 0.68 on owner approval, and the sequel class got confirm-first UX (`5e6a8a7`). This row read "measurement only; the threshold is unchanged" until 2026-08-17 |
| [`gotchas.md`](gotchas.md) | Traps found the hard way — things that look right and are not, or fail silently |
| [`system-reference.md`](system-reference.md) | Deployment state, what works today, repo layout, commands |
| [`design-decisions.md`](design-decisions.md) | Settled questions, owner decisions, future plans (from the original handoff) |
| [`audit-2026-08-findings.md`](audit-2026-08-findings.md) | Estate code audit (2026-08) — 24 confirmed findings (0 critical/high, 13 medium, 11 low), severity-ranked with evidence and fix notes; the two reviewed-high findings are also tracked as ☐ items in [`../TODO.md`](../TODO.md) |
| [`instance-model.md`](instance-model.md) | 🆕 **The instance model (2026-09-05)** — what is SHARED vs PER-INSTANCE in this repo now that the second-instance machinery exists, why the estate identity had to become config before it could differ, the gaps a second instance would inherit — and 🔴 the **MEASURED** `RATE_LIMITER` `namespace_id` answer (per ACCOUNT, quoted from Cloudflare's docs with its URL). Operating a second instance: [`../access/second-instance.md`](../access/second-instance.md) |
| [`multi-catalog-strategy.md`](multi-catalog-strategy.md) | ⚠️ **PARTLY SUPERSEDED 2026-09-05** — see its banner. Its §1 (how `library_catalog` runs two instances, the `[env.friend]` pattern) is still the best reference; its §2–§4 gap analysis described a repo that no longer exists, and its §5 `RATE_LIMITER` open question is now answered in [`instance-model.md`](instance-model.md) §3 |

The overall architecture and phase plan are in [`DESIGN.md`](DESIGN.md);
the repo map is in [`system-reference.md`](system-reference.md).

⚠️ **Corrected 2026-09-05:** that first link read `../DESIGN.md` and resolved to
`docs/DESIGN.md`, which does not exist — the file has been `docs/info/DESIGN.md`
since the 2026-08-21 restructure. It is now also a row in the table above.
