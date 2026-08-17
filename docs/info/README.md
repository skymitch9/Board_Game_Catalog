# Information — Index

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** (theme row added that day; the other rows were not re-checked).

How and why things work. Stable design facts only — current state and work in
flight live in [`../HANDOFF.md`](../HANDOFF.md); credentials and endpoints in
[`../access/`](../access/README.md).

| File | Covers |
|---|---|
| [`completeness.md`](completeness.md) | "What am I missing" — how the official/third-party split is decided, why a BoardGameGeek id is the only proof of ownership, and the 20-id ceiling that answers 400 |
| [`barcode-ladder.md`](barcode-ladder.md) | Why barcode resolution is tiered, what each rung buys, measured hit rates |
| [`scan-queue.md`](scan-queue.md) | What a scan job stores and what it refuses to store — ownership is computed on every read, so two photos of one shelf stop arguing |
| [`ios-camera.md`](ios-camera.md) | Every WebKit constraint the scanner works around, and why photos never reach the camera roll |
| [`copy-status-history.md`](copy-status-history.md) | ⏳ **PLANNED, not built.** Marking a copy sold/given away and keeping its history — why the statuses that already exist have never been used, and the one question the owner has to answer first |
| [`future-plans.md`](future-plans.md) | Deferred ideas, and the measurements that killed the ones already tried |
| [`cost-reduction.md`](cost-reduction.md) | Measured cost of every lookup path, and the one change that would move the needle |
| [`estate-theme.md`](estate-theme.md) | How this app gets its skin: the theme system is CANONICAL in catalog-platform and materialised here at build time by `scripts/sync-estate-theme.mjs`. ⚠️ `apps/web/public/assets/` is gitignored build output; the cog holds no theme list of its own |
| [`matcher-thresholds.md`](matcher-thresholds.md) | Measured sweep of `matchExistingTitle`'s containment floor (the real knob — not the 0.34 lookup floor), the BOSS MONSTER reproduction, and the evidence for 0.68. Measurement only; the threshold is unchanged |

The overall architecture and phase plan are in [`../DESIGN.md`](../DESIGN.md);
the repo map is in [`../HANDOFF.md`](../HANDOFF.md). Not duplicated here.
