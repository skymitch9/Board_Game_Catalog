import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { canExportEmails, exportOmissions, userItemQuery } from '../lib/export-fields.js';

/**
 * Full data export.
 *
 * docs/DESIGN.md §9 lists "D1 is the only copy of your data" as a risk. This is
 * the answer: one request, everything, in a format you could rebuild from or
 * open in a spreadsheet. No pagination — a household collection is small, and a
 * backup that arrives in pieces isn't a backup.
 *
 * ⚠️ **What is in it depends on who asked** — see `lib/export-fields.ts`. The
 * route is `editCatalog` (contributor+), and until 2026-09-05 the ratings join
 * handed every one of them every household account's email address. It no
 * longer does; the decision, the allow-list and the reasoning live in that one
 * module rather than being spelled out in the SQL here.
 */
export const exportRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  .get('/export.json', async (c) => {
    // Admin and owner only. A contributor's export carries the ratings and the
    // user ids, and not the addresses behind them.
    const withEmail = canExportEmails(c.get('user').role);

    // ⚠️ `sleeve_requirement` is NOT read here any more, and the table is dropped
    // by 0025. It held 0 rows against 836 items for the life of the catalog: no
    // code ever wrote it, and this export was its only reader, so the backup
    // shipped an always-empty array that looked like a feature.
    //
    // The CONCEPT is alive and moved, which is why dropping the table loses
    // nothing: `sleeve_requirement` is a research FINDING FIELD in
    // `packages/research/src/research.ts`, so sleeve sizes are gathered as prose
    // findings against the item. That name collision is the trap here — a grep
    // for "sleeve_requirement" still hits, and reads like a live dependency.
    //
    // `play` was deliberately NOT dropped: also empty, but unbuilt rather than
    // superseded — it is a reasonable design for logging game nights, kept as a
    // standing intention.
    const [items, editions, copies, ratings, copyEvents] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT * FROM item ORDER BY id'),
      c.env.DB.prepare('SELECT * FROM edition ORDER BY id'),
      c.env.DB.prepare('SELECT * FROM copy ORDER BY id'),
      // ⚠️ Default-deny, built from the allow-list in lib/export-fields.ts —
      // never `ui.*`. This is the one export row that joins another table, so
      // it is the one where a new column on either side ships to a contributor
      // without anybody deciding it should.
      c.env.DB.prepare(userItemQuery(withEmail)),
      /*
        ⚠️ **The copy history has to be in the backup or the feature has a hole
        in the shape of its own purpose.** `copy_event` exists so a record
        survives the deletion of the copy and the game (migration 0029), and a
        backup that omits it means the one class of fact designed to outlive its
        row does not outlive a restore. Added with 0029; every export before
        that date has no `copyEvents` key at all, which a reader must not read
        as "nothing ever happened".
      */
      c.env.DB.prepare('SELECT * FROM copy_event ORDER BY id'),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      // Bumped with 0029, which is what added `copyEvents` and `copy.disposal`.
      // It names the last migration whose shape this file knows about, so a
      // restore can tell what it is looking at.
      schemaVersion: '0029_copy_disposal_history',
      // ⚠️ Says what this copy does NOT contain. Without it a restore reading
      // an export with no `email` key cannot tell "the accounts had no
      // addresses" from "whoever exported it was not allowed to see them".
      // Empty for an admin or the owner.
      omitted: exportOmissions(withEmail),
      counts: {
        items: items?.results.length ?? 0,
        editions: editions?.results.length ?? 0,
        copies: copies?.results.length ?? 0,
        ratings: ratings?.results.length ?? 0,
        copyEvents: copyEvents?.results.length ?? 0,
      },
      items: items?.results ?? [],
      editions: editions?.results ?? [],
      copies: copies?.results ?? [],
      ratings: ratings?.results ?? [],
      copyEvents: copyEvents?.results ?? [],
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="board-game-catalog-${stamp}.json"`,
      },
    });
  })

  /** Flat one-row-per-copy view, for spreadsheets and insurance inventories. */
  .get('/export.csv', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT
         root.name  AS game,
         i.name     AS item,
         i.kind     AS kind,
         i.year_published AS year,
         i.publisher,
         c.status,
         -- WARNING: carried beside the status because the status alone is
         -- misleading in a spreadsheet. A copy the owner GAVE AWAY is stored as
         -- sold, and an insurance inventory that says "sold" about a gift is
         -- wrong in the one direction that matters. See migration 0029.
         c.disposal,
         c.is_sleeved, c.is_punched,
         c.lent_to, c.completeness_notes, c.notes,
         c.created_at AS added_at
       FROM copy c
       JOIN item i ON i.id = c.item_id
       LEFT JOIN item root ON root.id = i.root_game_id
       ORDER BY root.sort_name, i.sort_name`,
    ).all<Record<string, unknown>>();

    const headers = [
      'game', 'item', 'kind', 'year', 'publisher', 'status', 'disposal',
      'sleeved', 'punched',
      'lent_to', 'completeness_notes', 'notes', 'added_at',
    ];

    const cell = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      // Quote anything that could break a cell, and double embedded quotes.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = results.map((r) =>
      [
        r['game'], r['item'], r['kind'], r['year'], r['publisher'],
        r['status'],
        r['disposal'],
        r['is_sleeved'] ? 'yes' : 'no',
        r['is_punched'] ? 'yes' : 'no',
        r['lent_to'], r['completeness_notes'], r['notes'], r['added_at'],
      ]
        .map(cell)
        .join(','),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response([headers.join(','), ...rows].join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="board-game-catalog-${stamp}.csv"`,
      },
    });
  });
