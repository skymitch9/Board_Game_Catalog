# Board Game Catalog — working rules

Read `docs/HANDOFF.md` first; it holds current state and the gotchas that cost
real time. This file is only the things that will bite you in the first ten
minutes.

## Committing on Windows

**Always `git commit -F <file>`. Never `-m`.**

This shell is PowerShell. A `-m` message containing double quotes, an em dash,
or a newline gets mangled before git ever sees it — the observed failure is
`error: unknown option`, with the commit silently not happening. Write the
message to a file and pass `-F`.

Related traps, all seen in this repo:

- **PowerShell has no heredocs.** `<<'EOF'` is a parser error, not a quoting
  problem. Use a file.
- **Rewriting a source file through PowerShell can corrupt its UTF-8.**
  `ScanPage.tsx` once came back with every `—` as `â€”`. It typechecks, builds
  and deploys clean, so nothing catches it. Sweep with
  `grep -rn 'â€\|Â·\|Ã' --exclude-dir=dist`.
- **wrangler sometimes prints success then exits 255** on Windows — a libuv
  teardown quirk. Read the output, not the exit code.

## Commit, then deploy — in that order

`npm run deploy` now refuses a dirty working tree (`scripts/check-clean.mjs`).
That guard exists because production twice ended up running code that was in no
commit: once from deploying straight out of the working tree, and once when a
chained `git commit && npm run deploy` had its commit rejected by the quoting
problem above while the deploy went ahead anyway.

If you genuinely mean it: `ALLOW_DIRTY_DEPLOY=1 npm run deploy`.

Migrate before deploying, so new code never meets an old schema.

## Verifying anything

`npm run dev:worker` serves the API on `:8787` with **no Cloudflare Access** —
`middleware/auth.ts` has a dev bypass gated on `ENVIRONMENT !== 'production'`
and `DEV_EMAIL`, both already set in `apps/worker/.dev.vars`. So curl works
locally with no tokens.

Against production it does not: Access intercepts even `/api/health` at the
edge, and a Cloudflare **service token cannot** stand in, because `auth.ts`
requires an `email` claim and service-token JWTs carry `common_name`.

Prefer exercising a change locally over reasoning about it. The similarity
floor in `packages/core/src/barcode.ts` looked correct at 0.34 and did nothing;
running it showed every bogus match scoring 0.67.

## Shape of the code

Entry points stay thin — `apps/worker/src/index.ts` mounts routes and delegates
to `packages/`, so there is exactly one implementation of anything that makes a
decision. If two routes need the same logic, it belongs in `packages/` or
`apps/worker/src/lib/`, not copied.

**`packages/core` has a load-bearing import order.** `constants.ts` is a leaf,
`schemas.ts` imports it, `index.ts` re-exports both. Nothing under `src/` may
import from `index.ts` — doing so reintroduces a cycle that makes `z.enum()`
receive `undefined`, and every write endpoint starts returning 500 with a
misleading message. Typecheck does not catch it.
