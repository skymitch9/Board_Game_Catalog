# Board Game Catalog

A private catalog of our board game collection — base games, editions,
expansions, Kickstarter exclusives, and accessories — with LLM-assisted research
to fill in the details no single database has.

- **[docs/DESIGN.md](docs/DESIGN.md)** — architecture, data model, research
  pipeline, build plan
- **[docs/SETUP.md](docs/SETUP.md)** — deploy it

**Status:** phases 0–1 complete and deployed. Phase 2 (BoardGameGeek lookup) next.

- **Phase 0** — scaffold, D1 schema, Cloudflare Access auth, first-sign-in-claims-ownership
- **Phase 1** — the manual catalog: add/edit items and copies, base-game-rooted
  browsing with expansions and accessories nested underneath, search and
  filters, quantities and copy status, per-person ratings

## Quick start

```bash
npm install
npm run dev          # web on :5173, worker API on :8787
```

Deploying needs a Cloudflare account — see [docs/SETUP.md](docs/SETUP.md).

## Layout

```
packages/core/   Domain types, schemas, permission rules. No I/O.
packages/db/     D1 queries. Every function takes the database as an argument.
apps/worker/     Cloudflare Worker: routing and auth only.
apps/web/        React PWA.
migrations/      D1 schema migrations.
```

Entry points stay thin — `apps/worker/src/index.ts` mounts routes, the CLI (phase
4) parses argv, and both delegate to `packages/`. There is exactly one
implementation of anything that makes a decision.

## ⚠️ Build dependency: catalog-platform (new 2026-08-13)

This repo now materialises the canonical **estate-auth** module from a sibling
`catalog-platform` checkout at build time — `scripts/sync-estate-auth.mjs` runs
as `predev` / `pretypecheck` / `predeploy`, writes the gitignored copy to
`apps/worker/src/estate-auth/`, and **fails the build loudly** if the checkout
is missing (set `CATALOG_PLATFORM_DIR` if yours is not a sibling). The module
is the one implementation of Firebase token verification and estate membership
for every heygabi.ai Worker; this repo's old `middleware/auth.ts` verifier was
its ancestor and was replaced by it, so the swap changed no behaviour. Design:
`catalog-platform/docs/info/estate-auth-design.md` (§8.1 the mechanism, §14.5
this adoption). The estate check itself ships **off** — see `ESTATE_CHECK` in
`apps/worker/wrangler.toml` for the off → shadow → enforce ladder.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Web + Worker locally, hot reload |
| `npm run build` | Build the web app |
| `npm run deploy` | Build and deploy the Worker |
| `npm run typecheck` | Typecheck every workspace |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:migrate` | Apply migrations to the deployed database |

## Costs

Cloudflare (Workers, D1, Access) and BoardGameGeek are free at this scale. The
only metered cost is Anthropic API usage for research, which is opt-in per item
and never fires automatically — see [docs/DESIGN.md §8](docs/DESIGN.md).

## Notes

`npm audit` reports advisories in dev-only build tooling. `npm audit --omit=dev`
reports **0** — nothing vulnerable ships to the Worker.
