/**
 * `assertSearchBudgetLeft` — the guard the most expensive rung did not have.
 *
 * 2026-08 audit, finding 20. A server-tool turn can stop at the search loop's
 * iteration cap rather than because the model is done. When it does, there is
 * no final text block, so the next call — `parseStructured` — throws *"Claude
 * returned no text to parse."*
 *
 * 🔴 **That sentence is wrong AND it is aimed at the wrong reader.** Nothing is
 * malformed; the model ran out of searches. And it reaches somebody who scanned
 * a barcode and waited about two minutes, on the one rung that costs a
 * web-search fee. `runTier` and `enrichItem` both guarded this;
 * `identifyBarcode` did not.
 *
 * ⚠️ The guard is now ONE function that all three call, because the finding was
 * never "this branch is missing here" — it was "there are three copies of a
 * rule and one of them was never written". A fourth call site can now only
 * forget to CALL it, which is visible in review, rather than get the sentinel
 * string subtly wrong, which is not.
 *
 * NOT proved here: that `identifyBarcode` reaches this line. That needs the
 * Anthropic SDK stubbed at the module boundary, which no harness in this repo
 * does. What is proved is the guard's behaviour and its status code.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ResearchError, assertSearchBudgetLeft } from '../src/client.js';

describe('assertSearchBudgetLeft', () => {
  it('🔴 pause_turn throws a ResearchError, so the route can map it', () => {
    assert.throws(
      () => assertSearchBudgetLeft({ stop_reason: 'pause_turn' }, 'out of searches'),
      (err: unknown) => {
        assert.ok(err instanceof ResearchError, `expected ResearchError, got ${String(err)}`);
        assert.equal(err.message, 'out of searches');
        return true;
      },
    );
  });

  it('⚠️ 502, not 500 — an upstream limit was reached, nothing here is broken', () => {
    try {
      assertSearchBudgetLeft({ stop_reason: 'pause_turn' }, 'out of searches');
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal((err as ResearchError).status, 502);
    }
  });

  it('the refusal is the caller\'s own words, not a generic one', () => {
    // Per-surface on purpose: "re-run this tier" and "type the game name
    // instead" are different advice, and advice that does not fit the screen it
    // appears on is noise.
    const advice = 'Run it again, or type the game name instead';
    try {
      assertSearchBudgetLeft({ stop_reason: 'pause_turn' }, advice);
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal((err as ResearchError).message, advice);
    }
  });

  it('every OTHER stop_reason passes through untouched', () => {
    // Including `max_tokens` and `refusal`, which `parseStructured` handles and
    // must go on handling — this guard must not start swallowing them.
    for (const stop of ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'refusal']) {
      assert.doesNotThrow(() => assertSearchBudgetLeft({ stop_reason: stop }, 'x'), `${stop} threw`);
    }
  });

  it('a missing or null stop_reason is not a pause', () => {
    assert.doesNotThrow(() => assertSearchBudgetLeft({}, 'x'));
    assert.doesNotThrow(() => assertSearchBudgetLeft({ stop_reason: null }, 'x'));
  });
});
