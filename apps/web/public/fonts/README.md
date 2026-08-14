# Display fonts — self-hosted on purpose

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-13**.

> ⚠️ **2026-08-13, estate themes:** the faces the app actually loads now live
> in `public/assets/fonts/` — declared by `public/assets/estate-theme.css`,
> the estate theme contract — which adds Rajdhani ×3 + Share Tech Mono for
> the cyberpunk theme, each pair with its OFL file. Bangers/Luckiest Guy are
> duplicated there because the estate asset is copied VERBATIM from
> `catalog-platform/sites/heygabi-home/public/assets/` and references
> `/assets/fonts/…`; do not "deduplicate" by editing the copied css. This
> directory stays as the provenance record, and the licence story below is
> still why nothing is ever linked from a CDN — the estate adopted that rule.

| File | Font | Used for |
|---|---|---|
| `bangers.woff2` | Bangers | Headlines — `h1`, the brand, page titles |
| `luckiest-guy.woff2` | Luckiest Guy | Short decorative labels — badges, kind tags |
| `OFL.txt` | SIL Open Font License 1.1 | Covers both |

Both are **latin subsets only**, pulled from the Google Fonts CDN on
2026-08-09 and committed. 23 KB and 17 KB respectively — 40 KB for the pair.

## ⚠️ Why these are committed rather than linked

**This app makes no third-party requests, and adding the first one for
decoration would be a bad trade.** It is used one-handed in game shops on
whatever signal is going, and a `<link>` to `fonts.googleapis.com` is a
render-blocking round trip to somebody else's server before a headline can
paint — plus a second one to `fonts.gstatic.com` for the file itself. Served
from our own Worker assets they are same-origin, cached with everything else,
and work with no network at all.

It also keeps a promise the rest of the codebase already makes: covers are
hotlinked and *that is a known wart* the cover-health cron exists to police.
Fonts did not need to join it.

## Replacing or adding one

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -sL -A "$UA" "https://fonts.googleapis.com/css2?family=Bangers&display=swap"
# take the `src: url(...)` under the `/* latin */` block, then curl that .woff2 here
```

The `@font-face` declarations live at the top of
`apps/web/public/assets/estate-theme.css` (since the estate-theme adoption;
`styles.css` no longer declares any), and all use `font-display: swap` so text
is readable before the file lands.

⚠️ **`/fonts/` is served by the Worker's asset handler**, which serves
`index.html` for any non-`/api` path that is not a real file — so a typo in a
font URL returns the HTML page with a 200, and the browser reports a format
error rather than a 404. Check the path, not just the console message.
