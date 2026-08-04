# Handoff

Written at the end of phase 1 so the work can be finished without Claude.
**Last updated:** 2026-08-04, after phase 1 deployed.

---

## Where things stand

| | |
|---|---|
| Live URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Deployed version | `ce09f62b-c01e-49fc-aab1-ddbb918ebd17` (phase 1) |
| Branch | `phase-1-manual-catalog` — **not merged to main** |
| main | `f80cc3a` (phase 0 only) |
| Working tree | clean |
| Production database | empty — no games, no users yet |

**Phases 0 and 1 are complete, deployed, and verified.** Phase 2 has not started.

---

## The one thing waiting on you

**Sign in at the live URL.** Cloudflare Access emails a 6-digit PIN (Google SSO
is not configured — see below). The user table is empty, so the first person to
sign in becomes `owner` automatically.

Until someone signs in, the catalog has no owner and nobody can add anything.

---

## Pending decisions

1. **Merge `phase-1-manual-catalog` into `main`?** The deployed code is this
   branch's content. Nothing depends on the branch staying separate:
   ```bash
   git checkout main && git merge phase-1-manual-catalog
   ```
2. **Google SSO instead of email PIN?** Purely a login-UX change, no code
   impact — the Worker reads the verified email from the Access token whichever
   provider issued it. Steps in `docs/SETUP.md`.

---

## What exists

```
packages/core/   constants.ts (leaf) → schemas.ts → capabilities.ts → index.ts
packages/db/     users, health, items, copies, ratings — all take the D1 handle as an argument
apps/worker/     Hono routes + Access JWT verification. Logic lives in packages/.
apps/web/        React SPA: collection list, item detail, forms, ratings. ~30-line router.
migrations/      0001_init.sql — the whole schema, applied to local and production
```

**API surface** (all behind Cloudflare Access; `/api/health` is the only
unauthenticated route):

| Method | Path | Capability |
|---|---|---|
| GET | `/api/health` | none |
| GET | `/api/me` | any signed-in |
| GET | `/api/users`, PATCH `/api/users/:id/role` | manageUsers |
| GET | `/api/items`, `/api/items/:id`, `/api/meta` | read |
| POST/PATCH/DELETE | `/api/items`, `/api/items/:id` | editCatalog |
| POST | `/api/items/:id/copies` | editCatalog |
| PATCH/DELETE | `/api/copies/:id` | editCatalog |
| PUT/DELETE | `/api/items/:id/rating` | rate |

`GET /api/items` accepts `q`, `status`, `location`, `kind`, `uncatalogued`.

---

## Commands

```bash
npm run dev              # web :5173, worker API :8787
npm run typecheck        # all four workspaces
npm run build            # build the web app
npm run deploy           # build + deploy the Worker
npm run db:migrate       # apply migrations to production
npm run db:migrate:local # apply migrations locally
```

Local dev has **seeded sample data** (Gloomhaven, Wingspan, Castles of Burgundy
with expansions, accessories and copies) so the UI isn't empty while working on
it. Production is untouched. To clear local:

```bash
rm -rf apps/worker/.wrangler/state/v3/d1 && npm run db:migrate:local
```

---

## Gotchas discovered along the way

- **`packages/core` has a load-bearing import order.** `constants.ts` is a leaf;
  `schemas.ts` imports from it; `index.ts` re-exports both. Nothing under
  `src/` may import from `index.ts`. Violating this reintroduces the circular
  import that made `z.enum()` receive `undefined` and every write endpoint
  return 500 — with a misleading "Cannot read properties of undefined" message.
- **`migrations_dir` belongs inside the `[[d1_databases]]` block**, not at the
  top level of `wrangler.toml`. Wrangler silently looks in the wrong place.
- **Cloudflare mints one Access application per Worker URL.** Production and
  preview have different AUD values, which is why `CF_ACCESS_AUD` is a
  comma-separated list.
- **PowerShell mangles multi-line strings containing double quotes** when
  passing them to native executables. Use `git commit -F <file>`.
- **wrangler on Windows sometimes prints success then exits 255** — a libuv
  teardown quirk. Read the output, not the exit code.
- **The browser extension has no permission for `*.workers.dev`**, so the live
  site can't be screenshotted through automation. Verify with `curl` instead.

---

## Phase 2, when it starts

BoardGameGeek resolution — the design is in `docs/DESIGN.md` §4:

1. `packages/bgg/` — XML API2 client with a ~1 req/sec throttle, retry on
   `202 Accepted`, and a KV cache. No API key needed.
2. `POST /api/resolve` — takes names (one or many), returns candidates for a
   human to pick from. `GET /xmlapi2/search?query=&type=boardgame,boardgameexpansion,boardgameaccessory`
3. On confirm, `GET /xmlapi2/thing?id=…&versions=1&stats=1` fills metadata and
   the edition list, then upserts item + editions.
4. UI: type-ahead on the collection page, a paste-a-list flow, and an edition
   picker.

Key principle from the design: **BGG resolves identity, the LLM never does.**
Research (phase 3) only runs on items a human has already confirmed.

Optional: bulk-import an existing BGG collection via
`GET /xmlapi2/collection?username=…&own=1` — the account is unmaintained, so
this is a nice-to-have, not the main path.
