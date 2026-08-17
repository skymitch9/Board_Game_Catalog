# Estate Theme — Information Reference (how this app gets its skin)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — the sync was run, the build inspected, and
> the deployed site read in a browser that day (Worker version `783aad0e`).
> Canonical contract: `catalog-platform/docs/info/estate-themes.md` — read its
> §3a before adding or changing a theme. Per-surface live state:
> `library_catalog/docs/access/themes.md`.

## The one rule

**This repo owns NO part of the theme system.** Not the CSS, not the switcher,
not the list of themes, not their names. All of it lives in
`catalog-platform/sites/heygabi-home/public/assets/`, and this repo
materialises it at build time. An edit made here is lost work: the next build
overwrites it, and the improvement never reaches the other four estate sites,
which is the entire point of the shared asset.

## What arrives, and how

| Thing | Where it lands | Who writes it |
|---|---|---|
| `estate-theme.css`, `theme.js`, the six self-hosted faces + their two OFL files | `apps/web/public/assets/` — ⚠️ **gitignored**, the WHOLE directory is build output | `scripts/sync-estate-theme.mjs` |
| the shared `<estate-search>` element | `apps/web/public/estate/` (also gitignored) | `scripts/sync-estate-search.mjs` |
| the estate auth module | `apps/worker/src/estate-auth/` (also gitignored) | `scripts/sync-estate-auth.mjs` |

The theme sync runs on `pretypecheck`, `pretest`, `prebuild`, `predev`,
`predev:web` and inside `predeploy` — the same "nothing has to remember to run
it" rule the other two established. It **fails the build** when the sibling
checkout is missing, rather than skipping: `index.html` names
`/assets/estate-theme.css` and `/assets/theme.js` in `<head>`, so a silent skip
would ship an unstyled, unswitchable page.

Set `CATALOG_PLATFORM_DIR` if your checkout is not a sibling
(`scripts/lib/platform-repo.mjs` tries three layouts first and names the fix in
its error).

⚠️ **`apps/web/public/fonts/` is a DIFFERENT directory** — older, hand-written,
still tracked, and not part of this. Do not merge the two.

⚠️ **Do not move the theme files under `/estate/`** to match estate-search:
`sync-estate-search.mjs` does an `rm -rf` on that directory every run, so the
two syncs would fight over it. They stay at `/assets/`, where `public/_headers`
already carves the two un-hashed files out of the year-long immutable rule
while leaving the fonts immutable (a face never changes bytes without changing
name).

## The cog holds no list of its own

`ThemeToggle.tsx` renders `estateThemes()` and names them with
`estateThemeLabel()` — both in `src/lib/theme.ts`, both reading
`window.estateTheme` at call time. That is what makes the owner's 2026-08-17
order true here: *"when a theme is added all sites get it"*. Adding a theme
upstream reaches this cog on the next build with **no change in this repo**.

- `FALLBACK_THEMES` in `lib/theme.ts` is **not** the list. It is what to show
  when `/assets/theme.js` is absent (a unit-test DOM, or a 404), and nothing
  else.
- `EstateTheme` is `string`, deliberately. A union over a local array is what
  made "offer whatever the switcher offers" untypeable, and that is how a
  second registry got written down here in the first place.
- `MODE_LABELS` stays hardcoded on purpose: `MODES` is a closed set of three.

## What theme.js does that this app used to do itself

Both deleted from `index.html` on 2026-08-17, because canonical does them for
every estate site now:

- **the `bgc-theme` migrate-once** (`'system'|'light'|'dark'` → `hg_mode`).
  Safe to run centrally *because localStorage is origin-scoped* — that key can
  only exist on this host, so canonical's table is inert everywhere else.
- **the `theme-color` sync** from `--et-bg`. The static
  `<meta name="theme-color" content="#f2e8d5">` in `index.html` STAYS: it is
  the value for the frame before any script runs, and `theme.js` updates that
  same element.

Do not reinstate either. Duplicated theme logic per site is exactly how the
estate drifted.

## Identity, which is not yours to change

`<html data-default-theme="retro">` — this app's comic-print look IS the
`retro` theme, extracted verbatim into the canonical CSS. It stays the default;
only this site's user changes it, in the cog. The estate rule (owner,
2026-08-14) is *defaults are identity*: never "helpfully" restyle a site.

## Verifying a theme change reached the site

⚠️ **A soft reload can run the OLD `theme.js` from the browser's memory
cache**, even though it is served `no-cache`. Measured 2026-08-17 on the apex:
a fresh navigation ran the previous copy and a hard reload picked up the new
one. Use ctrl+shift+R, or `fetch(url, {cache:'reload'})` — a plain revisit will
have you reporting a good deploy as broken.

Review link: <https://boardgames.heygabi.ai/> — the cog is in the top bar (it
renders only when signed in).
