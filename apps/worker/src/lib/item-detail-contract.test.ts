/**
 * The response CONTRACT test — the board-game twin of the library's
 * 2026-08-24 blank-page outage (a refactor dropped `editions` from
 * `GET /api/works/:id`, the page `.find()`'d over it, every page went blank,
 * and NOTHING failed because the field was in no test).
 *
 * The crash surface here is the same shape: `ItemPage.tsx` renders the item
 * page off `GET /api/items/:id`, which returns `{ item: ItemDetail }` built by
 * `getItemDetail` (packages/db). The page `.map()`s and `.filter()`s over
 * `item.copies`, `item.children`, `item.ratings` and `item.relatedItems` — drop
 * any one from the wire contract and the page throws on `undefined.map(...)`
 * and white-screens. Nothing in the suite guarded that until this file.
 *
 * This asserts EVERY field `ItemPage` actually reads off the item is a declared
 * property of the `ItemDetail` wire type — and it DERIVES both sides from
 * source rather than hand-maintaining a copy that would drift:
 *   - consumer  = every `item.<field>` read in `apps/web/src/pages/ItemPage.tsx`
 *   - contract  = the fields on `interface ItemDetail` (+ the `Item` it extends)
 *                 in `packages/core/src/schemas.ts`
 * If the page reads a field the contract does not promise, that field is
 * `undefined` at runtime — the outage class — and this goes RED naming it.
 *
 * The estate gate does NOT run `tsc` before deploy (predeploy is sync-scripts +
 * check-clean), so TypeScript is not there to catch a dropped field on the way
 * out. This test — wired into `npm test`, which predeploy now runs — is.
 *
 * ⚠️ Proven to go RED: delete `relatedItems:` (or any consumed field) from
 * `interface ItemDetail` and this test fails naming that field. That proof is
 * in the guards' commit / the task report.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// `fileURLToPath(import.meta.url)` takes the string form — avoids `new URL`,
// whose DOM type clashes with node:url under the worker's DOM lib.
const here = dirname(fileURLToPath(import.meta.url));
const itemPageSrc = readFileSync(join(here, '../../../web/src/pages/ItemPage.tsx'), 'utf8');
const schemasSrc = readFileSync(
  join(here, '../../../../packages/core/src/schemas.ts'),
  'utf8',
);
const catalogSrc = readFileSync(join(here, '../routes/catalog.ts'), 'utf8');

/**
 * The fields the item page reads off the response, derived from every
 * `item.<field>` access in `ItemPage.tsx`. `item` is bound once, on the line
 * `const item = detail.data.item`, to the `ItemDetail` the response carries, so
 * every `item.` read is a field the wire MUST supply. This is the CONSUMER
 * contract.
 */
function consumedFields(src: string): Set<string> {
  const fields = new Set<string>();
  for (const m of src.matchAll(/\bitem\.([a-zA-Z_]\w*)/g)) fields.add(m[1]!);
  return fields;
}

/**
 * The body of an `export interface Name {...}` block in schemas.ts.
 *
 * The interface bodies of interest carry no nested `{` (their most complex
 * member is `Partial<Record<...>>`), so the block ends at the first line that
 * is a lone `}` — robust for these two and cheaper than a real parser.
 */
function interfaceBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `${decl} must exist — the contract derivation depends on it`);
  const open = src.indexOf('{', start);
  const end = src.indexOf('\n}', open);
  assert.ok(end > open, `${decl} must be a brace-delimited block`);
  return src.slice(open + 1, end);
}

/** Field names declared directly on an interface body (skips JSDoc lines). */
function declaredOn(body: string): Set<string> {
  const fields = new Set<string>();
  for (const line of body.split('\n')) {
    const m = /^\s*([a-zA-Z_]\w*)\??:/.exec(line);
    if (m) fields.add(m[1]!);
  }
  return fields;
}

describe('item-detail contract — the /api/items/:id response carries every field the page reads', () => {
  // ItemDetail is `interface ItemDetail extends Item`, so its wire surface is
  // its own fields UNION the base Item's fields.
  const declared = new Set<string>([
    ...declaredOn(interfaceBody(schemasSrc, 'export interface ItemDetail extends Item {')),
    ...declaredOn(interfaceBody(schemasSrc, 'export interface Item {')),
  ]);
  const consumed = consumedFields(itemPageSrc);

  it('the derivation is not vacuous — it found the fields the page is built on', () => {
    // A regex that silently matched nothing would make the subset assertion
    // pass for the wrong reason. Pin the floor on both sides.
    for (const f of ['copies', 'children', 'ratings', 'relatedItems', 'inherited', 'parent']) {
      assert.ok(consumed.has(f), `ItemPage must read item.${f}`);
    }
    assert.ok(consumed.size >= 15, `expected >= 15 consumed fields, found ${consumed.size}`);
    // And the contract side actually parsed the interfaces.
    for (const f of ['id', 'name', 'kind', 'copies', 'children', 'ratings', 'relatedItems']) {
      assert.ok(declared.has(f), `ItemDetail/Item must declare ${f}`);
    }
    assert.ok(declared.size >= 25, `expected >= 25 declared fields, found ${declared.size}`);
  });

  it('every field the page consumes is declared on the ItemDetail wire contract', () => {
    const missing = [...consumed].filter((f) => !declared.has(f));
    assert.deepEqual(
      missing,
      [],
      `ItemPage reads item.${missing.join(', item.')} but the ItemDetail contract ` +
        `(packages/core/src/schemas.ts) does not declare ${missing.length === 1 ? 'it' : 'them'}. ` +
        `A field the page reads that the response does not promise is undefined at ` +
        `runtime — the blank-page outage class. Add it to ItemDetail (and to what ` +
        `getItemDetail returns), or stop the page reading it.`,
    );
  });

  it('the four array fields the page iterates are on the contract (undefined.map = white screen)', () => {
    // These are the members ItemPage.tsx does `.map()`/`.filter()` on directly.
    // A missing key here is not a wrong value — it is a thrown TypeError and a
    // blank page, so they get their own named guard.
    for (const f of ['copies', 'children', 'ratings', 'relatedItems']) {
      assert.ok(
        consumed.has(f) && declared.has(f),
        `item.${f} is iterated by the page and MUST be present on the response`,
      );
    }
  });

  it('the route still builds the response through getItemDetail — no inline literal to drift', () => {
    // If a future refactor inlines c.json({ item: {...} }) instead of returning
    // the typed getItemDetail result, the type stops guarding the shape. Pin
    // that GET /items/:id still routes through the builder.
    assert.match(
      catalogSrc,
      /getItemDetail\(/,
      'GET /api/items/:id must build its response with getItemDetail, not an inline object',
    );
  });
});
