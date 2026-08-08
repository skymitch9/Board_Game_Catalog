# Access — Index

> **Audience:** Claude sessions. **Status:** TRACKED (committed — no secret
> values here, only names and how to obtain them).
> Last verified: **2026-08-05**.

How to reach and operate everything this project depends on. Stable facts only —
current state and work in flight live in [`../HANDOFF.md`](../HANDOFF.md).

| File | Covers |
|---|---|
| [`external-apis.md`](external-apis.md) | Every third-party service: endpoints, key names, quotas, what breaks without them |
| [`login.md`](login.md) | How sign-in works, swapping one-time PIN for Google SSO (free), skipping the login chooser, rollback without locking yourself out |

Cloudflare, D1 and Access details are in [`../SETUP.md`](../SETUP.md); commands
and deploy levers are in [`../HANDOFF.md`](../HANDOFF.md). Not duplicated here.

## Secret names (values live in `.dev.vars` locally / `wrangler secret` in prod)

| Name | Required? | Without it |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | yes | No auth; every request rejected |
| `OWNER_EMAILS` | yes | Nobody is seeded as owner |
| `ANTHROPIC_API_KEY` | for research | `/api/barcode/identify` and phase 3 return 503 |
| `BGG_API_TOKEN` | for BGG | `/api/bgg/*` returns 502; barcode lookups still work, unhydrated |
| `GAMEUPC_API_KEY` | no | Falls back to GameUPC's public `test` stage + demo key |
| `DEV_EMAIL` | local only | No local auth bypass. Ignored unless `ENVIRONMENT=development` |

```bash
npm run secret <NAME>     # set in production
npm run secret:list       # what is set
```

⚠️ Never run `wrangler secret put` from the repo root — it fails with
"Required Worker name missing". The npm scripts point it at
`apps/worker/wrangler.toml`.
