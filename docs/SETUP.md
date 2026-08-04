# Setup

**Phase 0 is deployed and live.** This document records what was configured and
what's left.

## Live

| | |
|---|---|
| URL | <https://board-game-catalog.bgc-worker.workers.dev> |
| Cloudflare account | `113be82b840c956b8378a187047ab3ea` |
| D1 database | `board-game-catalog` · `7dd22702-f0e2-4fc7-b201-d16d60176efa` · region WNAM |
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` (Free plan) |
| Access | Enabled on **production and preview** Worker URLs |
| Login method | **One-time PIN** (email) — Google SSO not yet configured |

Both Worker URLs are set to *Restricted*, so Cloudflare Access intercepts every
request before it reaches the Worker. Verified: an unauthenticated request to
`/api/health` returns `302` to the team login page with
`kid=65e61dbe36fd4482…`, matching the configured audience exactly.

Cloudflare mints a **separate Access application per URL**, so production and
preview have different AUD values. `CF_ACCESS_AUD` is therefore a comma-separated
list and the Worker accepts a token from either.

---

## The one thing left: sign in and claim ownership

Open <https://board-game-catalog.bgc-worker.workers.dev> on your phone.

Because login is currently **one-time PIN**, Access emails you a 6-digit code
rather than bouncing you to Google. Enter it, and you land on the status page.
The user table is empty, so **you become `owner` automatically**.

Expected:

| Check | Value |
|---|---|
| Worker | reachable |
| Database (D1) | migrations applied |
| Signed in as | your email |
| Role | **owner** |

Then have your wife open the same URL. She'll get her own PIN and land as
`pending`. Promote her:

```bash
# GET /api/users first to find her id
curl -X PATCH https://board-game-catalog.bgc-worker.workers.dev/api/users/2/role \
  -H "Content-Type: application/json" -d '{"role":"owner"}'
```

Note these API calls need an Access session too — easiest from the browser
devtools console on the app, or add a service token later. Phase 1 replaces this
with a button.

---

## Optional: swap one-time PIN for Google SSO

Purely a login-UX change — **no code changes**. The Worker reads the verified
email from the Access token regardless of which identity provider produced it.

1. Google Cloud Console → create a project → **APIs & Services → Credentials** →
   **Create OAuth client ID** (Web application).
2. Authorized redirect URI:
   `https://wispy-snowflake-2801.cloudflareaccess.com/cdn-cgi/access/callback`
3. Cloudflare dashboard → **Zero Trust → Integrations → Identity providers →
   Add an identity provider → Google**. Paste the client ID and secret.
4. Zero Trust → **Access controls → Applications → board-game-catalog →
   Login methods** → enable Google.

Worth doing if the PIN emails get annoying. Not worth doing tonight.

---

## Local development

```bash
npm run dev
```

- Web UI on <http://localhost:5173> (Vite, hot reload)
- Worker API on <http://127.0.0.1:8787>, `/api` proxied through

Local auth is faked by `apps/worker/.dev.vars` (gitignored). The bypass only
works when `ENVIRONMENT` is not `"production"`, so it can never affect the
deployed site. Change `DEV_EMAIL` to test as a different person.

```bash
npm run db:migrate:local
npx wrangler d1 execute board-game-catalog --local --command "SELECT * FROM app_user"
```

Start over locally: delete `apps/worker/.wrangler/state/v3/d1`, then
`npm run db:migrate:local`. The next sign-in claims owner again.

---

## Operations

| Task | How |
|---|---|
| Deploy | `npm run deploy` (builds web, pushes Worker) |
| Apply a new migration | `npm run db:migrate` |
| See who has signed in | `GET /api/users` (owners only) |
| Approve someone | `PATCH /api/users/:id/role` → `{"role":"rater"}` or `{"role":"owner"}` |
| Tail logs | `npm run tail --workspace @bgc/worker` |
| Query production DB | `npx wrangler d1 execute board-game-catalog --remote --command "..."` |
| Locked out | Put your email in `OWNER_EMAILS` in `wrangler.toml`, redeploy, sign in, clear it |
| Change who can reach the app | Zero Trust → Access controls → Applications → board-game-catalog → Policies |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/me` → 401 after signing in | Token audience doesn't match | Confirm the AUD in `wrangler.toml` matches the app's *Application Audience (AUD) Tag* |
| `/api/me` → 500 `misconfigured` | Access vars empty | They're set — check the deploy actually shipped them (`npm run deploy` prints the bindings) |
| `/api/health` → `database: down` | Migration missing remotely | `npm run db:migrate` |
| You land as `pending` | Someone already claimed owner | `GET /api/users`; use the `OWNER_EMAILS` recovery hatch |
| Access blocks you entirely | Policy doesn't include your email | Zero Trust → Access controls → Applications → Policies |
| wrangler prints success then exits 255 | libuv teardown quirk on Windows | Harmless — read the output, not the exit code |

---

## What's next

**Phase 1 — the manual catalog.** Add and edit items and copies by hand, browse
them rooted on base games with expansions and accessories nested underneath,
filter and search, record location, purchase, condition and per-person ratings.
No external dependencies, so it works regardless of what BGG or any LLM is doing.

See `docs/DESIGN.md` §7 for the full phase list.
