/**
 * Batch-parent resolution — the 2026-08 audit's finding 2.
 *
 * The defect was never in the decoding; it was that `ScanPanel.addSelected`
 * read the id map out of React state inside the loop that filled it, so the
 * map it read was always the version from before the loop started. That is not
 * something a pure function can be wrong about — which is why the last test in
 * this file is written as a SEQUENCE: it plays the loop twice over the same
 * rows, once against a map updated synchronously (the fix) and once against a
 * map that is not (the bug), and pins the difference.
 *
 * ⚠️ `node:test`, no jsdom in this app — so nothing here may import a
 * component. `lib/batch-parents.ts` is deliberately pure and imports nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { batchRefIndex, resolveBatchParent } from '../src/lib/batch-parents';

describe('batchRefIndex — two screens, two encodings, one decoder', () => {
  it('decodes the scan panel\'s negative pseudo-ids: -(index + 1)', () => {
    assert.equal(batchRefIndex(-1), 0);
    assert.equal(batchRefIndex(-3), 2);
  });

  it('decodes the scan-jobs page\'s "batch:<index>" strings', () => {
    assert.equal(batchRefIndex('batch:0'), 0);
    assert.equal(batchRefIndex('batch:3'), 3);
  });

  it('a real item id is NOT a batch reference', () => {
    // The whole point of the negative encoding: positive ids are rows that
    // already exist in the collection and must be passed straight through.
    assert.equal(batchRefIndex(412), null);
    // ⚠️ Zero is not an item id and was never a batch reference either.
    // Reading it as one would resolve index -1.
    assert.equal(batchRefIndex(0), null);
  });

  it('nothing chosen, and malformed strings, decode to nothing', () => {
    assert.equal(batchRefIndex(null), null);
    assert.equal(batchRefIndex(undefined), null);
    assert.equal(batchRefIndex('412'), null);
    assert.equal(batchRefIndex('batch:'), null);
    assert.equal(batchRefIndex('batch:x'), null);
    assert.equal(batchRefIndex('batch:-2'), null);
  });
});

describe('resolveBatchParent', () => {
  const siblings = [
    { proposedKind: 'base', name: 'Wingspan' },
    { proposedKind: 'expansion', name: 'Wingspan: European Expansion' },
  ];

  it('a base game never has a parent, whatever was chosen', () => {
    assert.equal(
      resolveBatchParent({ kind: 'base', parentRef: 412, batchIds: { 0: 900 } }),
      null,
    );
  });

  it('a batch reference resolves against the ids saved SO FAR', () => {
    assert.equal(
      resolveBatchParent({ kind: 'expansion', parentRef: -1, batchIds: { 0: 900 } }),
      900,
    );
    assert.equal(
      resolveBatchParent({ kind: 'expansion', parentRef: 'batch:0', batchIds: { 0: 900 } }),
      900,
    );
  });

  it('🔴 a batch reference to a row that has not been saved yet is null, not the raw id', () => {
    // Returning -1 here would send a negative id to the API. The row instead
    // becomes an orphan that remembers its parent's NAME, which is what the
    // server reunites on.
    assert.equal(resolveBatchParent({ kind: 'expansion', parentRef: -1, batchIds: {} }), null);
  });

  it('an existing item id is passed straight through', () => {
    assert.equal(
      resolveBatchParent({ kind: 'expansion', parentRef: 412, batchIds: {} }),
      412,
    );
  });

  it('nothing chosen falls back to the proposed parent NAME among this batch', () => {
    assert.equal(
      resolveBatchParent({
        kind: 'expansion',
        parentRef: null,
        proposedParentName: 'Wingspan',
        siblings,
        batchIds: { 0: 900 },
      }),
      900,
    );
  });

  it('the name fallback only matches rows proposed as BASE games', () => {
    // Matching an expansion by name would nest an expansion under an
    // expansion — a tree the catalog does not mean to have.
    assert.equal(
      resolveBatchParent({
        kind: 'expansion',
        parentRef: null,
        proposedParentName: 'Wingspan: European Expansion',
        siblings,
        batchIds: { 0: 900, 1: 901 },
      }),
      null,
    );
  });

  it('no siblings and no reference is simply no parent', () => {
    assert.equal(resolveBatchParent({ kind: 'expansion', parentRef: null, batchIds: {} }), null);
  });
});

describe('🔴 the finding-2 regression: the map has to be written SYNCHRONOUSLY', () => {
  // Base game first, then two expansions pointing at it — one by an explicit
  // batch reference (the hand-picked case, which had NO name to be rescued by)
  // and one by name (the auto-classified case, which the server's
  // pendingParentName reunion was silently covering for).
  const rows = [
    { kind: 'base', parentRef: null as number | null, proposedParentName: null as string | null },
    { kind: 'expansion', parentRef: -1 as number | null, proposedParentName: null as string | null },
    { kind: 'expansion', parentRef: null as number | null, proposedParentName: 'Wingspan' },
  ];
  const siblings = [
    { proposedKind: 'base', name: 'Wingspan' },
    { proposedKind: 'expansion', name: 'Wingspan: European Expansion' },
    { proposedKind: 'expansion', name: 'Wingspan: Oceania Expansion' },
  ];

  /** The loop both screens run, with the id map handed in. */
  function runBatch(write: (map: Record<number, number>, i: number, id: number) => void) {
    const map: Record<number, number> = {};
    const saved: (number | null)[] = [];
    rows.forEach((row, i) => {
      saved.push(
        resolveBatchParent({
          kind: row.kind,
          parentRef: row.parentRef,
          proposedParentName: row.proposedParentName,
          siblings,
          batchIds: map,
        }),
      );
      write(map, i, 900 + i);
    });
    return saved;
  }

  it('a synchronously-mutated map links both expansions to the base game', () => {
    const saved = runBatch((map, i, id) => {
      map[i] = id;
    });
    assert.deepEqual(saved, [null, 900, 900]);
  });

  it('a map written the React-state way loses BOTH links — the bug, pinned', () => {
    // `setBatchIds(b => ({...b, [i]: id}))` returns a NEW object; the running
    // closure keeps reading the old one. Modelled here by writing to a copy
    // that is thrown away, which is exactly what the old code did.
    const saved = runBatch((map, i, id) => {
      void { ...map, [i]: id };
    });
    assert.deepEqual(
      saved,
      [null, null, null],
      'if this ever passes as [null, 900, 900] the model is wrong, not the fix',
    );
  });
});
