/**
 * WHICH estate consumer this Worker is — config, not a constant.
 *
 * ## The bug this file exists to prevent, before it happens here
 *
 * `library_catalog` shipped exactly this and ran with it for months
 * (estate credentials catalog F-5): its `gate.ts` declared `app: 'library'`
 * and read a hard-coded `ESTATE_APP_TOKEN_LIBRARY`, on BOTH wrangler
 * environments. One build, two Workers, one identity. So `padhard.heygabi.ai`
 * — a SECOND household's catalog — knocked on the estate directory wearing the
 * main library's badge; the `ESTATE_APP_TOKEN_LIBRARY2` secret the auth Worker
 * had held for a day was an orphan nothing ever presented; and the
 * `vis_library2` column written precisely so "another household's shelf" is
 * granted by hand described a door nobody ever knocked on.
 *
 * ⚠️ **Nothing failed.** No test went red, no log line looked wrong, no request
 * 500'd — a hard-coded identity is indistinguishable from a correct one until
 * you ask which instance is speaking.
 *
 * This repo was in that same pre-fix state until 2026-09-05: `'games'` was
 * declared in `middleware/estate.ts`'s posture and `env.ESTATE_APP_TOKEN_GAMES`
 * was read by name in two places. The identity is now CONFIG, one var per
 * wrangler env:
 *
 *   [vars]              ESTATE_APP = "games"    → ESTATE_APP_TOKEN_GAMES
 *   [env.games2.vars]   ESTATE_APP = "games2"   → ESTATE_APP_TOKEN_GAMES2
 *
 * The token var NAME follows the app id (`APP_TOKEN_VAR`), so the estate's
 * pairing rule — *one value, two holders, SAME NAME on both sides* — holds for
 * a second instance too, and a mismatched pairing is a missing NAME
 * (⇒ `estate_config_unset` ⇒ off) rather than a wrong VALUE (⇒ 401 from the
 * directory ⇒ `estate_unreachable`). Failing into off is the direction this
 * app has always chosen, and it is why deploying an instance's code before its
 * bearer is piped cannot lock anyone out.
 *
 * ## Adding instance N is a THREE-line code change, deliberately
 *
 * A new id needs (1) an entry in `ESTATE_APPS` + `APP_TOKEN_VAR`, (2) a `case`
 * in `estateAppToken`, (3) an `ESTATE_APP_TOKEN_<NAME>` field on `Env`. That is
 * not friction for its own sake: (3) is unavoidable in TypeScript, and (1)+(2)
 * are what keep the set of secrets this module may read greppable, so no future
 * var name can be reached by data. See `docs/access/second-instance.md`.
 *
 * ⚠️ These functions do NOT prove the pairing is right. The app id is config;
 * the DIRECTORY resolves identity from the token's VALUE. A right name over a
 * wrong value is a 401 the gate reports as `estate_unreachable`. The only proof
 * of the value is a live `/seen`: `wrangler tail --env <name>` on a real
 * sign-in, reading the instance's own app id.
 */

/**
 * The estate app identities THIS codebase may present — an allowlist, and
 * deliberately not the auth Worker's whole `CONSUMER_APPS` (which also names
 * `library`, `library2`, `index` and `audiobook`, none of which are this repo).
 * A var that could name any string would let one edit make the games catalog
 * impersonate the library's consumer at the directory.
 *
 * `games` is the declared posture's own id and the default; `games2` is the
 * SLOT for a second instance — pre-declared so the provisioner (request-a-
 * catalog design §7.6) fills config in rather than editing three files under
 * time pressure. ⚠️ Its `[env.games2]` block does not exist yet and no Worker
 * asserts it today.
 */
export const ESTATE_APPS = Object.freeze(['games', 'games2'] as const);
export type EstateApp = (typeof ESTATE_APPS)[number];

/**
 * app id → the env var holding ITS paired bearer. ⚠️ The names are the auth
 * Worker's own (`appTokenFor` in `catalog-platform/apps/auth-worker/src/env.ts`),
 * because the estate's pairing rule is *same name, both sides*. Renaming one
 * half is how a pairing silently desyncs.
 */
export const APP_TOKEN_VAR: Readonly<Record<EstateApp, string>> = Object.freeze({
  games: 'ESTATE_APP_TOKEN_GAMES',
  games2: 'ESTATE_APP_TOKEN_GAMES2',
});

/** The default identity when `ESTATE_APP` is unset — the main instance. */
export const DEFAULT_ESTATE_APP: EstateApp = 'games';

/** Only what this module reads. `Env` satisfies it; tests pass literals. */
export interface EstateAppEnv {
  ESTATE_APP?: string;
  ESTATE_AUTH_URL?: string;
  ESTATE_APP_TOKEN_GAMES?: string;
  ESTATE_APP_TOKEN_GAMES2?: string;
}

export interface ResolvedEstateApp {
  /** Null ONLY when a value was set and is not an allowed id — see below. */
  app: EstateApp | null;
  /** The env var this app's bearer must be under. Null with a null `app`. */
  tokenVar: string | null;
  /** The rejected raw value when one was set but not recognised, else null. */
  invalid: string | null;
}

/**
 * Resolve `ESTATE_APP` into an identity and the var holding its bearer.
 *
 * ⚠️ The failure direction is DELIBERATELY the opposite of `estateMode` and
 * `billingPosture`, which fall back to a working default. For those two the
 * safe answer is the inert one; here the "inert" answer would be `games` — the
 * exact wrong identity for a second instance, and the bug F-5 named. A typo
 * must therefore turn the gate OFF (loudly) rather than fall back into
 * asserting the main catalog. Off is still safe: local auth — Firebase
 * verification plus this app's own role ladder — is untouched, so nobody gains
 * anything they did not already have; the estate simply stops being consulted
 * until the var is fixed.
 */
export function resolveEstateApp(raw: string | undefined): ResolvedEstateApp {
  const v = (raw ?? '').trim();
  if (v === '') {
    return { app: DEFAULT_ESTATE_APP, tokenVar: APP_TOKEN_VAR[DEFAULT_ESTATE_APP], invalid: null };
  }
  if ((ESTATE_APPS as readonly string[]).includes(v)) {
    const app = v as EstateApp;
    return { app, tokenVar: APP_TOKEN_VAR[app], invalid: null };
  }
  return { app: null, tokenVar: null, invalid: v };
}

/**
 * Read the bearer for a resolved `tokenVar`. A switch rather than an index
 * expression: the set of secrets this module may read stays greppable, and no
 * future var name can be reached by data.
 */
export function estateAppToken(env: EstateAppEnv, tokenVar: string | null): string {
  switch (tokenVar) {
    case 'ESTATE_APP_TOKEN_GAMES':
      return (env.ESTATE_APP_TOKEN_GAMES ?? '').trim();
    case 'ESTATE_APP_TOKEN_GAMES2':
      return (env.ESTATE_APP_TOKEN_GAMES2 ?? '').trim();
    default:
      return '';
  }
}

/**
 * The gate's configuration as an OUTSIDE observer can check it — what
 * `/api/health` reports. Two instances serve one bundle from one commit, so
 * "which estate consumer is that Worker?" is otherwise a question only a
 * signed-in browser plus `wrangler tail` can answer, and F-5 was exactly that
 * question going unasked for a day.
 *
 * ⚠️ Names and booleans only — never a value, never a fingerprint of one.
 * `configured` says both halves of the config exist, NOT that the token's value
 * is the one the directory expects; only a real `/seen` call proves that.
 */
export function describeEstateApp(env: EstateAppEnv): {
  app: EstateApp | null;
  tokenVar: string | null;
  configured: boolean;
} {
  const { app, tokenVar } = resolveEstateApp(env.ESTATE_APP);
  const configured =
    app !== null &&
    tokenVar !== null &&
    (env.ESTATE_AUTH_URL ?? '').trim() !== '' &&
    estateAppToken(env, tokenVar) !== '';
  return { app, tokenVar, configured };
}

/* ── the same-id build guard ────────────────────────────────────────────────
 *
 * Below is the half that reads `wrangler.toml` rather than `env`. It is a pure
 * function over TOML TEXT so the refusal itself is testable against fixtures —
 * a guard never seen to refuse is a guard never tested.
 */

export interface EstateAppDeclaration {
  /** The TOML table header the value was found under, e.g. `[env.games2.vars]`. */
  table: string;
  /** The wrangler env name: `default` for the top-level `[vars]`. */
  env: string;
  /** The raw declared value. */
  app: string;
}

/**
 * Every UNCOMMENTED `ESTATE_APP = "…"` in a wrangler.toml, with the table it
 * sits under.
 *
 * ⚠️ Commented lines are skipped on purpose: `wrangler.toml` carries a
 * commented `[env.<instance>]` TEMPLATE (the thing a second instance is copied
 * from), and a template that tripped the guard would have to be deleted to
 * deploy — which is how templates rot.
 */
export function declaredEstateApps(toml: string): EstateAppDeclaration[] {
  const out: EstateAppDeclaration[] = [];
  let table = '(file root)';
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const header = trimmed.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      table = `[${header[1]}]`;
      continue;
    }
    const hit = trimmed.match(/^ESTATE_APP\s*=\s*"([^"]*)"/);
    if (!hit) continue;
    // `[vars]` → default; `[env.games2.vars]` → games2. Anything else keeps its
    // header verbatim so an unexpected placement is visible rather than binned.
    const envName =
      table === '[vars]' ? 'default' : (table.match(/^\[env\.([^.\]]+)\./)?.[1] ?? table);
    out.push({ table, env: envName, app: hit[1] ?? '' });
  }
  return out;
}

/**
 * 🔴 THE GUARD. Throws when two wrangler environments assert the SAME estate
 * identity, or when any of them assert an id this codebase cannot present.
 *
 * This is F-5 caught at build time instead of in production: the mutation it
 * refuses is "copy the env block, forget to change `ESTATE_APP`", which is the
 * single most likely way a second games instance gets stood up wrong, and which
 * fails silently in every other instrument.
 */
export function assertOneIdentityPerInstance(declarations: EstateAppDeclaration[]): void {
  if (declarations.length === 0) {
    throw new Error(
      'wrangler.toml declares no ESTATE_APP at all. The main instance must declare ' +
        `ESTATE_APP = "${DEFAULT_ESTATE_APP}" in [vars] — an absent var resolves to the same ` +
        'identity today, but leaving it implicit is what let the hard-coded id hide for months.',
    );
  }

  for (const d of declarations) {
    if (!(ESTATE_APPS as readonly string[]).includes(d.app)) {
      throw new Error(
        `${d.table} declares ESTATE_APP = "${d.app}", which this codebase cannot present — ` +
          `the gate would treat it as OFF and the estate would never be consulted. ` +
          `Allowed: ${ESTATE_APPS.join(', ')}. Adding an id is a code change; see ` +
          'apps/worker/src/lib/estate-app.ts and docs/access/second-instance.md.',
      );
    }
  }

  const byApp = new Map<string, EstateAppDeclaration[]>();
  for (const d of declarations) {
    const seen = byApp.get(d.app);
    if (seen) seen.push(d);
    else byApp.set(d.app, [d]);
  }
  for (const [app, ds] of byApp) {
    if (ds.length > 1) {
      throw new Error(
        `two wrangler environments both declare ESTATE_APP = "${app}" ` +
          `(${ds.map((d) => d.table).join(' and ')}). One build, two Workers, ONE identity — ` +
          'the second instance would knock on the estate directory wearing the first one’s ' +
          'badge, its own ESTATE_APP_TOKEN_* would be an orphan nothing ever presents, and ' +
          'NOTHING would go red. This is estate credentials catalog F-5, which library_catalog ' +
          'ran with for months. Give each env its own id from ' +
          `[${ESTATE_APPS.join(', ')}].`,
      );
    }
  }
}
