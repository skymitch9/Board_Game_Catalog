# Firebase Auth — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED. Code is
> **written and typechecking, NOT deployed**. Cloudflare Access is still live
> and still the thing letting you in. Last verified: **2026-08-10**.
>
> Supersedes [`login.md`](login.md) once §3 is complete. Until then both are
> true: Access authenticates today, this describes what replaces it.

This app is moving from **Cloudflare Access** to **Firebase ID tokens**, so one
Google sign-in covers all three catalogs under `heygabi.ai`.

---

## 1. Why

Not because Access was weak — it was *stronger*, and §4 is honest about what is
being given up. Because Access is a **second allowlist** that has to be edited
by hand before the app can so much as tell somebody they are `pending`.

The catalog already has an owner / rater / viewer / pending model, a "Make
viewer" button and a waiting screen. None of it could be reached by anyone not
already named in a Cloudflare policy, so the roles were unreachable machinery
and letting a person in meant editing Cloudflare instead of using the app. It
was also a *different* Google SSO from the sibling catalogs, so the same human
was two unlinkable records.

`catalog-platform/docs/PLATFORM.md` §4 chose Firebase ID tokens for both editor
Workers. This is that decision, executed.

## 2. How it works now

| | |
|---|---|
| Firebase project | **`audiobook-catalog`** — shared with the audiobook and library catalogs, deliberately |
| What the browser sends | `Authorization: Bearer <Firebase ID token>` on every `/api/*` call |
| Who verifies it | `apps/worker/src/middleware/auth.ts` |
| Verified against | `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com` |
| Pinned claims | `iss = https://securetoken.google.com/audiobook-catalog`, `aud = audiobook-catalog` |
| Also required | `email` present, and `email_verified` not `false` |
| Config | `FIREBASE_PROJECT_ID` in `apps/worker/wrangler.toml`; `projectId` in `apps/web/src/lib/firebase.ts`. **They must match** |
| Rate limit | `RATE_LIMITER` binding, 300/60s per IP — `apps/worker/src/middleware/rate-limit.ts` |

⚠️ **Pinning `iss` *and* `aud` is the whole check.** Every Firebase project's
tokens are validly signed by the same Google keys, so dropping either assertion
does not weaken the check — it removes it, and admits any Google user of any
Firebase app on the internet.

### 2.1 What a stranger now experiences

1. Opens `boardgames.heygabi.ai`, gets the app, sees the sign-in screen
2. Signs in with Google — **this does not let them in**
3. `upsertUserOnLogin` creates them as `pending` (the table is non-empty, so the
   first-user-becomes-owner branch cannot fire)
4. They see the waiting screen, with a sign-out link in case it was the wrong
   Google account
5. An owner promotes them on the People page

## 3. 🔴 The cutover — in this order

🔴 = owner only. **The order is the safety property, not a preference.**

| # | Step | Why here |
|---|---|---|
| 1 | ✅ **Done 2026-08-10** — add `boardgames.heygabi.ai` to Firebase → Authentication → Settings → Authorised domains, project `audiobook-catalog` | Harmless while Access is up. Do it *before* anything else or sign-in fails `auth/unauthorized-domain` |
| 2 | `npm run deploy` **with Access still in front** | The deploy is reversible; deleting the Access application is the part that is not. Both gates run at once, which is fine — Access lets you through, then the app verifies your token |
| 3 | Sign in at `boardgames.heygabi.ai` and confirm the collection loads | You are proving the token path works *while still protected*. If it fails, roll back and nothing was ever exposed |
| 4 | 🔴 **Only then** delete the Access application (Zero Trust → Access controls → Applications → `board-game-catalog`) | This is the irreversible-feeling one and the moment the Worker becomes the only gate |
| 5 | Remove the "Owner only" pill from the card in `catalog-platform/sites/heygabi-home/public/index.html` | The front door should not advertise open access before step 4 |
| 6 | Delete `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` from `wrangler.toml` and `env.ts`, and this section's rows from `login.md` | Cleanup only. Deliberately last: while they are set, step 4 is trivially reversible |

⚠️ **Do not do step 4 before step 3.** Access removed while the token path is
broken leaves a gate nobody — including you — can pass, on a public host.

### 3.1 Verifying

```bash
# public, and rate limited
curl -s -D - -o /dev/null https://boardgames.heygabi.ai/api/health | head -1

# no token -> 401, NOT the Access login redirect, once step 4 is done
curl -s -D - -o /dev/null https://boardgames.heygabi.ai/api/me | head -1
```

⚠️ `curl -I` and `curl -o /dev/null` misreport on this machine — exit 43,
status `000`, on hosts that are plainly up. Use `-D -` as above.

In a browser: sign in, confirm the collection loads, then sign out and confirm
you land on the sign-in screen rather than a blank page.

## 4. What is given up, stated plainly

Access blocked unauthenticated traffic **at the edge, before any code ran**. A
leaked URL cost nothing. After step 4 the Worker is the only gate, and the
three things `PLATFORM.md` §4.1 required before shipping are:

| Required | State |
|---|---|
| Every route deny-by-default | ✅ **Audited 2026-08-10.** `app.use('/api/*', requireAuth())` is blanket; every route carries a `requireCapability` except `/api/me`, which must be reachable by `pending` and returns only your own identity — `chores` is `null` without `editCatalog`/`manageUsers` |
| Re-read the dev bypass | ✅ **Tightened.** It tested `ENVIRONMENT !== 'production'`, so *any* unrecognised value enabled it. Now `=== 'development'`, which `.dev.vars` sets |
| Rate limiting | ✅ **Added.** 300/60s per IP, ahead of both `/api/health` and token verification. ⚠️ Fails **open** if the binding is missing — a misconfigured limiter should not take the catalog down |

The *authorization* posture is unchanged: a signed-in stranger is `pending` and
sees a waiting screen, not the collection.

## 5. Gotchas

⚠️ **All three catalogs share one Firebase Auth session.** `audiobook_catalog/site/identity.js`
calls `signOut()` on page load, so visiting the audiobook site signs you out of
this app too. That is why `catalog-platform/docs/HEYGABI_LAYOUT.md` §1.3 forbids
new auth origins and why the apex landing page has no sign-in.

⚠️ **`OWNER_EMAILS` is empty**, and after step 4 there is no Access allowlist to
fall back on. The recovery hatch if you ever lose owner: put an email in
`OWNER_EMAILS` and redeploy. Worth knowing *before* it is needed.

⚠️ **The web bundle grew** from ~330 kB to **582 kB** (157 kB gzipped) — that is
`firebase/auth`, and it crosses Vite's 500 kB warning. Not fixed: code-splitting
the sign-in path is an optimisation, and this is a household app on a fast
connection.

⚠️ **A signed-in user who is `pending` still calls `/api/me` on every load.**
That is intended — it is how the waiting screen knows to keep waiting.
