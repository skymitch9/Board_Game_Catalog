# Login & Identity — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Last verified: **2026-08-08**.

How this app authenticates people, and how to swap the annoying email one-time
PIN for **Google SSO** without locking anybody out. Current live state lives in
[`../HANDOFF.md`](../HANDOFF.md); this file holds the stable facts.

---

## How login works today

| | |
|---|---|
| Zero Trust team | `wispy-snowflake-2801.cloudflareaccess.com` (Free plan) |
| Access applications | **two** — one per Worker URL (production, preview). Cloudflare mints one per URL |
| Access policy | **Everyone** — anyone may authenticate; the *app* decides who gets in |
| Login method | **One-time PIN** (6-digit code by email) |
| Owner | `nbaslamking@gmail.com`, claimed on first sign-in |
| Who reads the token | `apps/worker/src/middleware/auth.ts` |
| Who keys the user | `packages/db/src/users.ts` → `upsertUserOnLogin`, on **`email`, lowercased** |

The chain: Access authenticates at the edge → puts a signed JWT on the request
(`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie) → `auth.ts`
verifies it against `https://<team>/cdn-cgi/access/certs` with `issuer` = team
domain and `audience` = one of `CF_ACCESS_AUD` → pulls `email` and `name` out of
the payload → `upsertUserOnLogin` looks the email up in `app_user`.

**`auth.ts` never asks which identity provider produced the token.** It reads
`payload.email`. That single fact is why this whole change is configuration
only.

---

## Does it cost money? **No.**

Verified 2026-08-08. Both halves are free at this scale.

| Thing | Cost | Basis |
|---|---|---|
| Cloudflare Zero Trust Free plan | **$0/month, up to 50 users** | Cloudflare's own Zero Trust plan pages. Next tier is $7/user/month with no cap — irrelevant at 2 users |
| Adding Google as an identity provider | **$0** | Not a plan-gated feature. Free-plan account limits cap **identity providers at 50** and **Access applications at 500**; the docs list no per-plan IdP restriction |
| Instant Auth (skip the chooser) | **$0** | A per-application toggle, not a SKU |
| Google Cloud project | **$0** | Projects are free to create |
| Google OAuth 2.0 client ID + secret | **$0**, and **no billing account required** | Creating OAuth credentials for `openid`/`email`/`profile` is not a billed Cloud API |
| Google app verification | **$0** and **not required here** | Verification is for *sensitive/restricted* scopes. Access requests only basic profile scopes; a 2-person app is far under the 100-user unverified cap |

Cloudflare's onboarding does ask for a payment method even on the Free plan —
their docs say plainly: *"If you chose the Zero Trust Free plan, this step is
still needed but you will not be charged."* This team is already onboarded, so
it should not re-prompt.

**Could not verify:** `cloudflare.com/plans/zero-trust-services/` and
`teams-pricing/` render their comparison table client-side, so WebFetch returned
navigation chrome, and `teams-pricing` 403'd. The 50-user / $0 / $7-per-user
figures come from Cloudflare's own pricing copy surfaced via search plus the
Zero Trust docs, **not** from a direct read of the table. Google publishes no
price for OAuth client creation because there is no charge — that is an
argument from absence, so treat "free" as very-high-confidence rather than
quoted.

---

## Does the owner's account survive? **Yes — the email is the key.**

`upsertUserOnLogin` does `findUserByEmail(db, email.toLowerCase())` and returns
the existing row if there is one. Google's OIDC `email` claim for
`nbaslamking@gmail.com` is the same string the PIN flow produced.

| Thing | Survives? | Why |
|---|---|---|
| `app_user` row | **yes** | Matched by email; no insert happens |
| `id` | **yes** | Same row, so every FK below still points at it |
| `owner` role | **yes** | The `owner`/`pending` decision is inside the INSERT — it never runs for an existing email |
| Ratings (`user_item.user_id`) | **yes** | FK to `app_user(id)`, unchanged |
| `first_seen_at`, `approved_at` | **yes** | Never rewritten on login |
| Provenance (`scan_job.triggered_by`, `reviewed_by`, `logged_by_user_id`) | **yes** | All FKs to the same `id` |
| `display_name` | **may change** | If Google's `name` claim differs from the stored one, the row is updated. Cosmetic |

**A different Google address = a different person.** Signing in as, say,
`nick.baslam@gmail.com` creates a **new** `app_user` row. It will land as
**`pending`**, not owner — the bootstrap rule only fires against an empty table
and an owner already exists. Ratings do not follow; they belong to the old row.
Recovery is `OWNER_EMAILS` in `wrangler.toml` + redeploy, or a D1 `UPDATE`.

⚠️ Gmail dot-and-plus variants are *the same mailbox to Google but a different
string to us*. `nbaslamking@gmail.com` and `n.baslamking@gmail.com` are two
users in `app_user`. There is no normalisation beyond `toLowerCase()`. Sign in
with the exact address already in the table.

---

## Account inventory — read from production, 2026-08-08

Both intended Google addresses already exist, one row each, both `owner`.
**There is nothing to merge.** Confirm before believing otherwise:

```
npx wrangler d1 execute board-game-catalog --remote --command "SELECT id, email, role FROM app_user ORDER BY id"
```

| id | email | role | approved_at | ratings | research runs |
|---|---|---|---|---|---|
| 1 | `nbaslamking@gmail.com` | `owner` | 2026-08-04 | 0 | 45 |
| 2 | `asprint200@gmail.com` | `owner` | 2026-08-05 (approved_by 1) | 0 | 1 |

Those are the only two rows: no case variants, no dot/plus duplicates, no
`pending` leftovers, no stale test row, no orphaned FKs. Google's OIDC `email`
claim returns the same two strings, so at cutover both land on their existing
rows via `findUserByEmail` and keep `owner`. **The correct action is no action**
— an invented "merge" could only lose data.

**Every column referencing `app_user(id)`**, read from the live schema, so that
a future merge repoints all of them and misses none:

| Table.column | On delete | Rows today |
|---|---|---|
| `user_item.user_id` | CASCADE | 0 — table is empty |
| `play.logged_by_user_id` | SET NULL | 0 — table is empty |
| `research_run.triggered_by` | SET NULL | 46 |
| `research_finding.reviewed_by` | SET NULL | 0 — table is empty |
| `app_user.approved_by` | SET NULL | 1 |

⚠️ **`scan_job` has no `app_user` FK at all** — no `triggered_by`, no
`reviewed_by`, despite the queue being a per-person workflow. Don't go hunting
for one during a merge. `cover_check`, `component_check`, `item_relation` and
`game_component` have none either. The five columns above are the whole surface.

⚠️ If a real duplicate ever does turn up, order is repoint-every-FK-first,
delete-the-loser-last, and note that `user_item` carries
`UNIQUE (item_id, user_id)` — repointing a rating onto a keeper who rated the
same item fails the constraint rather than merging quietly. Ratings here are
shown per person rather than averaged, so collapsing two humans' rows destroys
the distinction even when the SQL succeeds. Never delete an `app_user` row that
still has an FK pointing at it.

---

## Does any code, secret or config change? **No.**

Checked directly against the repo:

| Value | Where | Affected? |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `apps/worker/wrangler.toml` (plain var) | **No.** The team domain is a property of the Zero Trust org, not the login method |
| `CF_ACCESS_AUD` | `apps/worker/wrangler.toml` (plain var, comma-separated) | **No.** The AUD tag belongs to the *application*. Adding an IdP does not mint a new application, so the AUD does not move |
| JWKS URL | derived in `auth.ts` | **No.** `/cdn-cgi/access/certs` is per team, and Access signs the token itself — Google's keys never appear |
| `issuer` check | `auth.ts` | **No.** Still `https://<team-domain>` |
| `email` / `name` claims | `auth.ts` | **No.** Google supplies both; OTP supplied only `email` (so display names may start appearing — that is the `display_name` update above) |
| `OWNER_EMAILS` | `wrangler.toml`, currently `""` | **No.** Leave empty |
| `DEV_EMAIL` + `ENVIRONMENT !== 'production'` bypass | `auth.ts` lines 49–53 | **No.** It returns before any Access logic runs and never touches an IdP. `npm run dev:worker` keeps working with no Google client configured |

**Verified:** the AUD values, team domain and bypass gating by reading
`wrangler.toml`, `auth.ts` and `users.ts`. **Assumed (not tested against the
live dashboard):** that Cloudflare does not re-issue the AUD tag when an
application's login methods change. It never has for policy edits, and the AUD
is documented as the application's identifier — but the cheap insurance is to
re-read the AUD tag after the change and compare it to `wrangler.toml` before
concluding anything is broken.

**No deploy is required for this change.** Nothing in the repo moves.

---

## The steps

### 1. Google Cloud — create the OAuth client (free)

1. <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → Credentials → Configure consent screen** (the 2026 UI
   calls this the **Google Auth Platform**): *Get started* → app name + user
   support email → audience **External** → contact email → agree → continue.
3. **Create OAuth client** → application type **Web application**.
4. Authorized **JavaScript origin**:

   ```
   https://wispy-snowflake-2801.cloudflareaccess.com
   ```

5. Authorized **redirect URI** — exactly this, no trailing slash:

   ```
   https://wispy-snowflake-2801.cloudflareaccess.com/cdn-cgi/access/callback
   ```

6. **Publish the app.** Audience → **Publish app** so publishing status reads
   **In production**. See the gotcha below — this is the step people skip.
7. Copy the **Client ID** and **Client secret**. Paste them into Cloudflare
   directly; do not write them into this repo.

### 2. Cloudflare — add the identity provider

**Zero Trust → Integrations → Identity providers → Add new identity provider →
Google.** Paste Client ID (Cloudflare labels it *App ID*) and Client secret.
PKCE optional. **Save**, then use the **Test** button next to Google before
touching any application.

### 3. Cloudflare — point the apps at Google

**Zero Trust → Access controls → Applications →** open the app → the
authentication section:

- Select **Google** as the enabled identity provider.
- Turn on **Apply instant authentication**.

Cloudflare's wording, verbatim: *"If you plan to only allow access via a single
IdP, turn on **Apply instant authentication**. End users will not be shown the
Cloudflare Access login page. Instead, Cloudflare will redirect users directly
to your SSO login event."*

**The precise condition:** Instant Auth skips the chooser when the application
has exactly **one** login method enabled. Leave one-time PIN selected alongside
Google and the picker comes back — the annoyance survives, in a new shape.

⚠️ **Do this on both applications.** There is one per Worker URL — production
and preview — and they are configured independently. Fixing only production
leaves the preview URL on the PIN chooser and looks like the change didn't take.

---

## Rollback, and how not to lock yourself out

The real risk is not Google failing; it is removing the only working way in
before the new one is proven.

**Order of operations — do not reorder:**

1. Add the Google IdP and hit **Test** in Integrations. It round-trips without
   touching any application.
2. On **one** application (start with **preview**), enable Google **alongside**
   one-time PIN, with Instant Auth **off**. The chooser now offers both.
3. Sign in through Google in a private window. Confirm `/api/me` shows your
   email with role `owner`.
4. Only then turn Instant Auth on and drop one-time PIN — first on preview,
   then on production.

**To roll back** at any point: Zero Trust → Access controls → Applications →
the app → re-enable **One-time PIN** as a login method and turn **Apply instant
authentication** off. Effective immediately; no deploy, no code change. If OTP
is no longer listed as an available method, re-add it at Integrations →
Identity providers → Add new identity provider → **One-time PIN** (Cloudflare's
docs note OTP *"is no longer added automatically"* for newer orgs, and that
since 2026-05-19 the Cloudflare IdP is the default for new accounts — this org
predates that and already has OTP).

**If you are locked out of the dashboard itself** — different problem, and the
one that actually hurts. Access protects the app, not `dash.cloudflare.com`.
Sign in to the Cloudflare dashboard with your normal Cloudflare account and
edit the application there. That account is not governed by this Access policy.

**Locked out of the app but not Cloudflare?** Two hatches, both still valid:
put your email in `OWNER_EMAILS` in `apps/worker/wrangler.toml` and redeploy, or
`npx wrangler d1 execute board-game-catalog --remote --command "UPDATE app_user
SET role='owner' WHERE email='...'"`.

⚠️ **`OWNER_EMAILS` only fires when the row does not exist**, so those two
hatches are not interchangeable. `upsertUserOnLogin` returns early for any email
already in `app_user`; the `isRecoveryOwner` check sits *inside* the INSERT
branch (`packages/db/src/users.ts`, verified 2026-08-08). The var therefore
recovers a **missing** row — a never-seen address, a deleted row, an empty table
after a restore — and will **not** restore an existing row demoted to `pending`
or `rater`. For a demotion, the D1 `UPDATE` is the only hatch.

Which is why populating it today buys little: both rows exist and are `owner`,
so the code path can never run for them. Setting
`OWNER_EMAILS = "nbaslamking@gmail.com,asprint200@gmail.com"` is still cheap
insurance for the restore-from-nothing case (the next sign-in re-creates the row
as `owner` instead of `pending`), but it costs a deploy, and it commits both
addresses to a tracked file. It is not a prerequisite for the SSO cutover.

---

## Gotchas that cost real time

⚠️ **Leaving the Google app in "Testing" publishing status.** This is the
expensive one. In Testing, only the up-to-100 email addresses explicitly listed
as *test users* can sign in at all, and **authorizations expire seven days from
consent**. The symptom is the worst kind: it works perfectly the day you set it
up, then a week later both of you are bounced with a Google error and the
Cloudflare side looks completely healthy. Publish the app to **In production**.
No verification is needed — that is only for sensitive/restricted scopes, and
Access asks for basic profile only.

⚠️ **A redirect URI that is nearly right.** `http://` instead of `https://`, a
trailing slash, `/cdn-cgi/access/callback/`, or the *app's* hostname instead of
the **team** hostname. Google fails with `redirect_uri_mismatch` and names no
useful cause. It must be the team domain:
`https://wispy-snowflake-2801.cloudflareaccess.com/cdn-cgi/access/callback`.

⚠️ **Your existing Access session hides the change.** You are already signed in;
a browser that holds a valid `CF_Authorization` cookie will not re-authenticate
and you will conclude nothing happened. Test in a private window, or revoke:
Zero Trust → **Team & Resources → Users** → tick yourself → **Action → Revoke**.
Tokens stop being accepted in 20–30 seconds, and re-login is blocked for up to
a minute afterwards — that error is expected, wait it out.

⚠️ **The policy is still "Everyone".** Google SSO does not narrow who may
authenticate; anyone with a Google account can complete Access and reach the
app, where they land as `pending` and see the holding screen. That is unchanged
from today's PIN behaviour, and the app is the gate — but do not read "Google
SSO" as "only my household". To actually narrow it: Applications → the app →
Policies.

⚠️ **Verify against production is hard by design.** Access intercepts even
`/api/health` at the edge, and a Cloudflare **service token cannot** substitute
— `auth.ts` requires an `email` claim and service-token JWTs carry
`common_name`. Check from the browser devtools console on the app itself, or
locally via `npm run dev:worker` (which bypasses Access entirely and therefore
proves nothing about the IdP).

---

## Verification

| Check | How | Expect |
|---|---|---|
| IdP configured | Zero Trust → Integrations → Identity providers → **Test** next to Google | Round-trips, returns your claims incl. `email` |
| Chooser is gone | Private window → <https://board-game-catalog.bgc-worker.workers.dev> | Straight to Google's account picker; no Cloudflare login page |
| Account survived | Signed-in devtools console: `await (await fetch('/api/me')).json()` | Your email, `"role": "owner"` |
| No new user row | `npx wrangler d1 execute board-game-catalog --remote --command "SELECT id, email, role FROM app_user"` | Same ids and count as before the switch |
| AUD unchanged | Compare the app's *Application Audience (AUD) Tag* in the dashboard against `CF_ACCESS_AUD` in `apps/worker/wrangler.toml` | Identical, both entries |
| Preview URL too | Same private-window test against the preview URL | Also skips the chooser |

**Secrets:** the Google Client ID and Client secret live **only** in the
Cloudflare Zero Trust dashboard. They are not Worker secrets, are not needed by
any code here, and must never be written into this repo. Nothing in
[`README.md`](README.md)'s secret table changes.
