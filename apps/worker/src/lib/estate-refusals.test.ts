/**
 * Every estate refusal says something, and the flag's comment tells the truth.
 *
 * Two defects, both found by the LLM-billing design read
 * (`catalog-platform/docs/info/llm-billing-control-design.md` §6.1, defects 1
 * and 3 of 3) and both fixed 2026-08-26. This pins them.
 *
 * ## 1. `estate_revoked` answered a BARE `{ error }`
 *
 * `estateGate`'s `revoked` case returned `{ error: 'estate_revoked' }` and
 * nothing else, while the very next case — `estate_unreachable`, one line
 * down — carried a worded `detail`. The estate rule is that **a person must
 * never see a bare status or a bare code**: every refusal says what happened,
 * what it needs, and how to get it.
 *
 * ⚠️ **"But the web app translates the code" is not a defence, and it is why
 * this was easy to miss.** `apps/web/src/lib/errors.ts` maps
 * `estate_revoked` to a sentence, so a browser never showed the code — but the
 * rule is about the RESPONSE, not about one client being kind enough to make
 * up for it. Everything else that can reach this Worker (curl, GABI, a second
 * surface, a future app) got a machine code and no way to act on it.
 *
 * ## 2. The `ESTATE_CHECK` comment said `off` while the value said `enforce`
 *
 * `wrangler.toml`'s comment claimed the flag was *"deliberately 'off' in the
 * committed file … must be inert until the owner flips it"*, three lines above
 * `ESTATE_CHECK = "enforce"`. Anyone reasoning about who this Worker refuses
 * got the answer exactly backwards. It is the shape the estate audit already
 * named: **a flag is flipped, the sweep updates three places, and the missed
 * copy is always a comment or a README, never code.** So the guard is a
 * convention the next flip cannot skip — the comment must NAME the value that
 * is actually set.
 *
 * ⚠️ Source assertions rather than behaviour tests, deliberately: `estateGate`
 * needs a Hono context, a D1 binding and a live `/seen` fetch, and the thing
 * that broke here is not the verdict logic (which `estate-auth/combine.ts`
 * already pins) but the WORDS and the COMMENT beside them. Both tests assert
 * they actually found what they parse before asserting anything about it — a
 * grep-shaped guard's failure mode is passing vacuously against a file it
 * could not read.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function repoFile(relative: string): string {
  // fileURLToPath, not a URL object — readFileSync(URL) does not typecheck
  // across this repo's TS libs (the library repo's tests hit the same).
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url).href), 'utf8');
}

const ESTATE_TS = repoFile('apps/worker/src/middleware/estate.ts');
const WRANGLER = repoFile('apps/worker/wrangler.toml');

/**
 * Every `c.json(...)` argument list in the file, extracted by counting
 * parentheses rather than by regex — a refusal body spans several lines and a
 * lazy `\)` match would stop at the first inner bracket.
 */
function jsonCalls(src: string): string[] {
  const calls: string[] = [];
  const NEEDLE = 'c.json(';
  let from = 0;
  for (;;) {
    const start = src.indexOf(NEEDLE, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + NEEDLE.length - 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(start, i + 1));
    from = i + 1;
  }
  return calls;
}

describe('estate refusals — no bare code leaves this Worker', () => {
  it('the middleware was read and its refusal calls were found', () => {
    assert.ok(ESTATE_TS.length > 0, 'estate.ts read as empty — an empty read is a failed read');
    const calls = jsonCalls(ESTATE_TS);
    assert.ok(
      calls.length >= 2,
      `found ${calls.length} c.json(...) calls in estate.ts; expected at least the two refusals ` +
        `(estate_revoked, estate_unreachable). If the file was restructured, re-point this test — do not delete it.`,
    );
  });

  it('🔴 every refusal body carries a worded `detail`, not just an `error` code', () => {
    for (const call of jsonCalls(ESTATE_TS)) {
      const code = call.match(/error:\s*'([a-z_]+)'/)?.[1];
      assert.ok(code, `a c.json(...) in estate.ts has no \`error\` code at all:\n${call}`);
      assert.match(
        call,
        /detail:\s*'/,
        `\`${code}\` answers a bare { error } with no sentence. Every refusal must say what happened, ` +
          `what it needs and how to get it — the web app translating the code is not a substitute, ` +
          `because curl, GABI and any future surface get the raw body.`,
      );
    }
  });

  it('the revoked sentence stays quiet and non-accusatory, and still offers a way back', () => {
    const revoked = jsonCalls(ESTATE_TS).find((c) => c.includes("'estate_revoked'"));
    assert.ok(revoked, 'the estate_revoked refusal is gone from estate.ts');
    const detail = revoked.match(/detail:\s*'([^']+)'/)?.[1];
    assert.ok(detail, 'estate_revoked has no detail sentence');
    // "How to get it" is the half a quiet refusal most easily drops: saying
    // only "no access" leaves a person with nowhere to go.
    assert.match(detail, /owner/, 'the revoked sentence names nobody to ask — a refusal must offer a route back');
  });

  it('⚠️ an OUTAGE is not worded as a refusal', () => {
    const unreachable = jsonCalls(ESTATE_TS).find((c) => c.includes("'estate_unreachable'"));
    assert.ok(unreachable, 'the estate_unreachable refusal is gone from estate.ts');
    assert.match(unreachable, /,\s*503,?\s*\)$/, 'estate_unreachable must stay a 503 — it is an outage, not a verdict');
  });
});

describe('the ESTATE_CHECK comment must name the value that is actually set', () => {
  /** The live value, from the committed wrangler.toml. */
  const value = WRANGLER.match(/^ESTATE_CHECK\s*=\s*"([a-z]+)"/m)?.[1];

  it('wrangler.toml was read and ESTATE_CHECK was found', () => {
    assert.ok(WRANGLER.length > 0, 'wrangler.toml read as empty — an empty read is a failed read');
    assert.ok(value, 'no `ESTATE_CHECK = "…"` line in apps/worker/wrangler.toml');
    assert.ok(
      ['off', 'shadow', 'enforce'].includes(value),
      `ESTATE_CHECK is "${value}", which estateMode() will treat as 'off' while looking deliberate`,
    );
  });

  it('🔴 the comment claims the SAME mode the flag is set to', () => {
    // The convention: the comment block must contain the literal
    //   ESTATE_CHECK IS "<value>"
    // so flipping the flag without touching the prose beside it goes red. The
    // old comment asserted "off" three lines above `enforce` and nothing
    // noticed for the whole life of the rollout.
    assert.match(
      WRANGLER,
      new RegExp(`#\\s*⚠️\\s*ESTATE_CHECK IS "${value}"`),
      `wrangler.toml sets ESTATE_CHECK = "${value}" but no comment says \`⚠️ ESTATE_CHECK IS "${value}"\`. ` +
        `If you changed the flag, change the sentence beside it in the same commit.`,
    );
  });
});
