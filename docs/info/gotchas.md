# Gotchas found the hard way

> Extracted from `HANDOFF.md` on 2026-08-21. These are traps you fall INTO
> while working on this repo — things that look right and are not, or that
> fail silently. See also [`../KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) for
> things that ARE wrong and are tolerated.

## Gotchas found the hard way

- **`packages/core` has a load-bearing import order.** `constants.ts` is a leaf,
  `schemas.ts` imports it, `index.ts` re-exports both. **Nothing under `src/` may
  import from `index.ts`.** Breaking this reintroduces a circular import that
  makes `z.enum()` receive `undefined` and every write endpoint return 500 with
  a misleading "Cannot read properties of undefined". Typecheck does not catch it.
- **Migrate production before deploying**, so new code never meets an old schema.
- **`migrations_dir` goes inside `[[d1_databases]]`**, not at the top level of
  `wrangler.toml`. Wrangler silently looks in the wrong place.
- **Cloudflare mints one Access application per Worker URL** â€” production and
  preview have different AUDs, hence `CF_ACCESS_AUD` being a comma-separated list.
- **SQLite can't add a `CHECK` to an existing table** â€” `quantity >= 1` is
  enforced by triggers (migration 0002).
- **PowerShell mangles strings containing double quotes** when passing them to
  native executables, and rewriting files through it corrupts UTF-8. Use
  `git commit -F <file>` and edit files directly â€” see [`CLAUDE.md`](../CLAUDE.md),
  which now states this as a rule because it has bitten twice. The second time,
  `git commit -m "..." && npm run deploy` had its commit rejected for quoting
  while the deploy went ahead anyway, putting live code ahead of the repo.
  `npm run deploy` now runs `scripts/check-clean.mjs` first and refuses a dirty
  working tree; override with `ALLOW_DIRTY_DEPLOY=1` when you mean it.
  **UTF-8 corruption has also already happened once**, to `ScanPage.tsx`: every `â€”`, `â€¦` and `Â·` came back as `Ã¢â‚¬â€`, `Ã¢â‚¬Â¦`
  and `Ã‚Â·`, including in text shown to the user while scanning. Nothing catches
  it â€” it typechecks, builds and deploys clean. Sweep for it with
  `grep -rn 'Ã¢â‚¬\|Ã‚Â·\|Ãƒ' --exclude-dir=dist`, and note that PowerShell heredocs
  do not exist either (`<<'EOF'` is a parser error).
- **`$b` and `$B` are the same variable in PowerShell.** Cost me a confusing
  debugging detour.
- **wrangler on Windows sometimes prints success then exits 255** â€” a libuv
  teardown quirk. Read the output, not the exit code.
- **A cached `index.html` pins a phone to a previous deploy.** It names the
  content-hashed bundles, so Safari serving a stale copy kept loading old
  JavaScript while the new assets sat there unused â€” the symptom is "I deployed
  a fix and the phone still shows the old behaviour". Fixed in two places:
  `apps/web/public/_headers` (`no-cache` on index.html, `immutable` on /assets/*)
  and the Worker's SPA fallback, which now sets `Cache-Control: no-cache` on the
  index.html it hands back. On iOS a pull-to-refresh does **not** clear it â€”
  close the tab and reopen.
- **The browser extension has no permission for `*.workers.dev`**, so the live
  site can't be screenshotted through automation. Verify with `curl`.
- **The Anthropic API can return a transient `400 "Invalid request data"`.**
  Observed once on a request shape that then passed 15/15 identical retries.
  The SDK does **not** retry 400s, so it surfaces as a hard failure. Don't spend
  an hour bisecting a schema before re-running it â€” `/api/barcode/identify`
  returns `retryable: true` for exactly this.
- **GameUPC says "no idea" as the literal string `"None"`**, not `null` or an
  absent field. Passing it through puts the word "None" in front of the user.
- **GameUPC returns every BGG version, not the matching one.** Catan came back
  with 136; taking `versions[0]` labelled a US retail scan "Arabic/English
  edition". Only name a printing when there is exactly one.
- **Never strip the publisher name from a retail title.** In this hobby the
  brand often *is* the game â€” stripping "CATAN Studio" turned
  "Catan 5-6 Player Extension" into "Asmodee Extension". A redundant word costs
  a search nothing; a missing title costs it everything.
- **UPCitemdb's free quota is per IP.** A Worker is one IP for every user, so
  100/day is a whole-app budget, not per-person. It is deliberately only called
  after GameUPC misses. **One 55-title shelf photo can exhaust it**, and the
  failures cluster in the back half of the photo â€” if a bulk scan resolves the
  first thirty games and then stops finding anything, this is why, not the data.
- **A lookup that *failed* is not a lookup that found nothing.** `resolveTitle`
  used to return the same empty result for both, and `cachedResolve` then wrote
  a negative cache entry â€” so a quota exhaustion or a 5xx got frozen in as "this
  game does not exist" for a week. It caused real damage: a shelf scan produced
  nine games with correct titles and no cover art, several of them household
  names that resolve perfectly on a retry. `resolveTitle` now returns `failed`,
  and a failed lookup is never cached. **Keep that distinction if you touch the
  resolver** â€” it is invisible in every type signature that does not carry it.
- **Word-overlap similarity scores a fragment far too kindly.** "Deep Rock
  Galactic" against "Deep Rock Galactic: Biome Expansion" scores 0.75 and sails
  past a 0.7 floor, so a base game takes its expansion's identity. `isFragmentOf`
  in `packages/core/src/barcode.ts` rejects strict-subset matches outright, after
  stripping generic words like "expansion" and "edition" â€” without that strip it
  also rejected "Catan Expansion: Cities & Knights" against "Catan: Cities &
  Knights", which is the same box.
- **A dead image URL does not have to answer 404.** `cf.geekdo-images.com`
  returns **400** for every unresolvable path â€” measured three ways. A link
  checker that only looks for 404/410 reports a clean bill of health on a
  catalog whose covers are almost entirely geekdo URLs. See the cover-health
  section above; `PERMANENT` in `apps/worker/src/lib/cover-check.ts` is the list
  that matters.
- **`d1_migrations` drifted from the local schema.** On 2026-08-06 the local
  database already had `item.source_url` while `0012_source_url.sql` was not
  recorded as applied, so `npm run db:migrate:local` died with
  `duplicate column name: source_url` and refused to apply anything after it.
  Fixed by inserting the row into `d1_migrations` by hand. If a local migration
  fails on a column that already exists, this is why â€” check
  `SELECT name FROM d1_migrations` before assuming the migration is wrong.
- **`getCached` cannot tell a stored `null` from a cache miss** â€” both come back
  as `null`. Caching "nothing found" as `null` and then checking
  `if (cached !== null)` therefore does nothing, silently, forever: the entry is
  written on every pass and read on none. Production had 15 of 69 title entries
  in exactly that state before it was spotted, each one re-running the full free
  ladder every time. **If you cache negatives, use `getCachedEntry`**, which
  returns `{ value } | null` so a hit carrying a null value is still a hit.
  Nothing about this fails loudly â€” the only symptom is quota quietly draining.
- **A quoted heredoc (`<<'EOF'`) still ate backslashes** in this Git Bash,
  corrupting regexes in throwaway scripts. Write scratch files with the editor,
  not the shell.

---
