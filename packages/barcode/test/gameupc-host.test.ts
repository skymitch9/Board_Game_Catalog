/**
 * `isGameUpcUrl` — the host check that stands between a client-supplied URL and
 * this Worker's `GAMEUPC_API_KEY`.
 *
 * 🔴 **The threat is credential forwarding.** `contributeGameUpc` POSTs to a
 * URL and attaches `x-api-key` on the way. That URL reaches it from
 * `/api/barcode/link`, where it was validated as *a URL* and nothing else — so
 * before this guard, any `editCatalog` user could name a listener of their own
 * and be handed the key. 2026-08 audit, finding 11.
 *
 * The exposure was latent only in the sense that the key is currently GameUPC's
 * published demo key; the outbound POST was exploitable the whole time, and the
 * day `GAMEUPC_API_KEY` is set is the day the leak becomes real. That is a
 * configuration change, not a code change, which is exactly why this is fixed
 * rather than watched.
 *
 * NOT proved here: that `contributeGameUpc` refuses (it is a network call).
 * What is proved is the predicate it refuses BY, plus the derivation of the
 * host from `STAGES` — see the last case.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GAMEUPC_HOST, isGameUpcUrl } from '../src/gameupc.js';

describe('isGameUpcUrl — exact host, https only', () => {
  it('allows GameUPC\'s own write-back endpoints', () => {
    for (const url of [
      `https://${GAMEUPC_HOST}/v1/barcode/0123456789012/update`,
      `https://${GAMEUPC_HOST}/test/anything`,
      `https://${GAMEUPC_HOST}/`,
      `https://${GAMEUPC_HOST}/v1/x?y=1#z`,
    ]) {
      assert.equal(isGameUpcUrl(url), true, `${url} should be allowed`);
    }
  });

  it('🔴 refuses another host outright', () => {
    assert.equal(isGameUpcUrl('https://evil.test/collect'), false);
  });

  it('🔴 refuses a SUFFIX of the right host — the classic endsWith hole', () => {
    // `api.gameupc.com.evil.test` ends with the allowed string, and a check
    // written as `endsWith` waves it straight through to the attacker.
    assert.equal(isGameUpcUrl(`https://${GAMEUPC_HOST}.evil.test/collect`), false);
    assert.equal(isGameUpcUrl(`https://not-${GAMEUPC_HOST}/collect`), false);
  });

  it('🔴 refuses a subdomain — the allow-list is one host, not a zone', () => {
    assert.equal(isGameUpcUrl(`https://x.${GAMEUPC_HOST}/collect`), false);
  });

  it('🔴 refuses userinfo pointing the real host at somebody else', () => {
    // `https://api.gameupc.com@evil.test/` reads as the right host to a human
    // and resolves to `evil.test`. `new URL` gets this right; a regex on the
    // string would not.
    assert.equal(isGameUpcUrl(`https://${GAMEUPC_HOST}@evil.test/collect`), false);
  });

  it('⚠️ refuses plaintext http on the RIGHT host — the key would be on the wire', () => {
    assert.equal(isGameUpcUrl(`http://${GAMEUPC_HOST}/v1/update`), false);
  });

  it('refuses non-http schemes and unparseable junk rather than throwing', () => {
    for (const url of [
      'javascript:fetch("//evil.test")',
      'data:text/plain,hi',
      'file:///etc/passwd',
      'not a url',
      '',
      '//api.gameupc.com/v1',
    ]) {
      assert.equal(isGameUpcUrl(url), false, `${JSON.stringify(url)} should be refused`);
    }
  });

  it('the allowed host is DERIVED from the stage URLs, so it cannot drift', () => {
    // A hostname typed out a second time is how an allow-list stops matching
    // the thing it allows. Every stage this module talks to must be on it.
    for (const stage of ['test', 'dev', 'v1']) {
      assert.equal(
        isGameUpcUrl(`https://${GAMEUPC_HOST}/${stage}`),
        true,
        `the ${stage} stage is not on the allowed host`,
      );
    }
    assert.equal(GAMEUPC_HOST, 'api.gameupc.com');
  });
});
