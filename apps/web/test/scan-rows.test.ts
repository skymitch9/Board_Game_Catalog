/**
 * `lib/scan-rows.ts` — one row per barcode, so two `<li>` never share a key.
 *
 * 2026-08 audit, finding 16. `BarcodeQueue` keys its scanned list on the
 * barcode, which is the right key. What was wrong is that a retry after a
 * failure did not replace the earlier attempt: the failed row kept its code,
 * `acceptedRef` released the code so the box could be scanned again, and
 * `accept` prepended a SECOND row with the same code.
 *
 * ⚠️ **The duplicate key is the visible half; the stale row is the worse one.**
 * The result handler finds its row by `code === code && state === 'pending'`,
 * so it updated the new row and left the old `error` one sitting above it,
 * contradicting the answer, until the page was left.
 *
 * NOT proved here: React's reconciliation, or that the component calls this.
 * The invariant is what is testable without a DOM, and it is the invariant the
 * key depends on.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { codesAreUnique, replaceByCode } from '../src/lib/scan-rows';

type Row = { code: string; state: string; detail?: string };

describe('replaceByCode — a retry replaces its own failed attempt', () => {
  it('🔴 re-scanning a failed code leaves ONE row, not two sharing a key', () => {
    const failed: Row[] = [
      { code: '0123456789012', state: 'error', detail: 'network' },
      { code: '9999999999999', state: 'added' },
    ];

    const after = replaceByCode(failed, { code: '0123456789012', state: 'pending' });

    assert.ok(codesAreUnique(after), `duplicate code in ${JSON.stringify(after)}`);
    assert.equal(after.length, 2);
    assert.equal(after.filter((r) => r.code === '0123456789012').length, 1);
  });

  it('and the row that survives is the NEW one — the error is gone, not stacked', () => {
    const after = replaceByCode<Row>(
      [{ code: 'abc12345', state: 'error', detail: 'network' }],
      { code: 'abc12345', state: 'pending' },
    );
    assert.equal(after[0]?.state, 'pending');
    assert.equal(after[0]?.detail, undefined, 'the old failure reason does not linger');
  });

  it('newest first — the box you just scanned is the one you are looking at', () => {
    const after = replaceByCode<Row>(
      [{ code: 'aaaaaaaa', state: 'added' }],
      { code: 'bbbbbbbb', state: 'pending' },
    );
    assert.deepEqual(
      after.map((r) => r.code),
      ['bbbbbbbb', 'aaaaaaaa'],
    );
  });

  it('a first scan of a new code just prepends', () => {
    const after = replaceByCode<Row>([], { code: 'aaaaaaaa', state: 'pending' });
    assert.equal(after.length, 1);
  });

  it('every other row is untouched, in order', () => {
    const rows: Row[] = [
      { code: 'ccc', state: 'added' },
      { code: 'bbb', state: 'error' },
      { code: 'aaa', state: 'owned' },
    ];
    const after = replaceByCode(rows, { code: 'bbb', state: 'pending' });
    assert.deepEqual(
      after.map((r) => r.code),
      ['bbb', 'ccc', 'aaa'],
    );
  });

  it('codesAreUnique actually catches a duplicate — the check is not vacuous', () => {
    assert.equal(codesAreUnique([{ code: 'a' }, { code: 'a' }]), false);
    assert.equal(codesAreUnique([{ code: 'a' }, { code: 'b' }]), true);
    assert.equal(codesAreUnique([]), true);
  });
});
