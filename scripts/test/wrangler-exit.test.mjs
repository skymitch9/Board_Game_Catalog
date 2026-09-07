/**
 * `classifyWranglerExit` — the difference between the Windows quirk and a real
 * failure.
 *
 * 2026-08 audit, finding 21. `push-secrets.mjs` ended `process.exit(0)`
 * unconditionally, INCLUDING in the branch that had just printed
 * `wrangler exited N`. The exit(0) was a deliberate mitigation for the
 * documented Windows quirk — wrangler prints a clean success and then exits
 * non-zero on a libuv teardown — but it forgave every non-zero exit, so a real
 * failure (bad credentials, a Worker that does not exist, a rejected payload)
 * reported success to any `&&` chain or CI.
 *
 * 🔴 **The direction matters.** The failure it caused is "you believe
 * production has been rotated and it has not", which is exactly the class of
 * silent success this repo keeps refusing.
 *
 * ⚠️ **Names only. No secret value appears in this file**, and none can: the
 * function is handed a transcript and an exit code, and wrangler's output names
 * keys rather than values.
 *
 * NOT proved here: that a real wrangler run produces these strings. They are
 * read from wrangler's output format, not measured against a live push — a live
 * push would rotate production secrets, which no test may do.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyWranglerExit } from '../lib/wrangler-exit.mjs';

const SUCCESS_LINE = '✨ Success! Uploaded 4 secrets.';
const FINISHED_LINE = 'Finished processing secrets JSON file: 4 successful, 0 failures';

describe('classifyWranglerExit', () => {
  it('exit 0 is a success', () => {
    const v = classifyWranglerExit({ code: 0, output: SUCCESS_LINE });
    assert.equal(v.ok, true);
    assert.equal(v.exitCode, 0);
  });

  it('⚠️ exit 0 with NO recognisable output is still a success — it must not invent a failure', () => {
    // Wrangler's wording changes between versions. A classifier that demanded a
    // known success line would start failing every push the day it did.
    const v = classifyWranglerExit({ code: 0, output: 'something new and unfamiliar' });
    assert.equal(v.ok, true);
    assert.equal(v.exitCode, 0);
  });

  it('🔴 exit NON-ZERO after a printed success is forgiven — the Windows quirk, and ONLY that', () => {
    for (const line of [SUCCESS_LINE, FINISHED_LINE]) {
      const v = classifyWranglerExit({ code: 1, output: line });
      assert.equal(v.ok, true, `not forgiven: ${line}`);
      assert.equal(v.exitCode, 0);
      // And it says so, so the forgiveness is visible rather than silent.
      assert.match(v.reason, /Windows/);
    }
  });

  it('🔴 exit NON-ZERO with no success line is a REAL failure — this is the whole finding', () => {
    const v = classifyWranglerExit({
      code: 1,
      output: 'Authentication error [code: 10000]',
    });
    assert.equal(v.ok, false);
    assert.notEqual(v.exitCode, 0, 'a caller in an && chain has to see this');
    assert.match(v.reason, /REAL failure/);
  });

  it('the real failure keeps wrangler\'s own exit code where there is one', () => {
    assert.equal(classifyWranglerExit({ code: 3, output: 'boom' }).exitCode, 3);
  });

  it('a child killed by a signal (code null) still fails, with 1', () => {
    const v = classifyWranglerExit({ code: null, output: 'partial output' });
    assert.equal(v.ok, false);
    assert.equal(v.exitCode, 1);
  });

  it('🔴 a run that FINISHED but reports failures is a failure, even at exit 0', () => {
    // The case neither the old code nor the audit named: `secret bulk` can exit
    // 0 and tell you two of the secrets did not upload. Cheerful, and wrong.
    const v = classifyWranglerExit({
      code: 0,
      output: 'Finished processing secrets JSON file: 2 successful, 2 failures',
    });
    assert.equal(v.ok, false);
    assert.equal(v.exitCode, 1);
    assert.match(v.reason, /2 failures/);
  });

  it('…and "0 failures" is not read as a failure', () => {
    assert.equal(classifyWranglerExit({ code: 0, output: FINISHED_LINE }).ok, true);
  });

  it('missing output does not throw', () => {
    assert.equal(classifyWranglerExit({ code: 0, output: undefined }).ok, true);
  });
});
