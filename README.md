# Board Game Catalog

A private catalog of our board game collection — base games, editions,
expansions, Kickstarter exclusives, and accessories — with LLM-assisted research
to fill in the details no single database has.

- **[docs/DESIGN.md](docs/DESIGN.md)** — architecture, data model, research
  pipeline, build plan
- **[docs/SETUP.md](docs/SETUP.md)** — deploy it

**Status:** phase 0 complete (scaffold, database, auth). Phase 1 next.

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
