import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Full data export.
 *
 * docs/DESIGN.md §9 lists "D1 is the only copy of your data" as a risk. This is
 * the answer: one request, everything, in a format you could rebuild from or
 * open in a spreadsheet. No pagination — a household collection is small, and a
 * backup that arrives in pieces isn't a backup.
 */
export const exportRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  .get('/export.json', async (c) => {
    const [items, editions, copies, ratings, sleeves] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT * FROM item ORDER BY id'),
      c.env.DB.prepare('SELECT * FROM edition ORDER BY id'),
      c.env.DB.prepare('SELECT * FROM copy ORDER BY id'),
      c.env.DB.prepare(
        `SELECT ui.*, u.email FROM user_item ui
           JOIN app_user u ON u.id = ui.user_id ORDER BY ui.id`,
      ),
      c.env.DB.prepare('SELECT * FROM sleeve_requirement ORDER BY id'),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: '0001_init',
      counts: {
        items: items?.results.length ?? 0,
        editions: editions?.results.length ?? 0,
        copies: copies?.results.length ?? 0,
        ratings: ratings?.results.length ?? 0,
        sleeveRequirements: sleeves?.results.length ?? 0,
      },
      items: items?.results ?? [],
      editions: editions?.results ?? [],
      copies: copies?.results ?? [],
      ratings: ratings?.results ?? [],
      sleeveRequirements: sleeves?.results ?? [],
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
         c.status, c.location, c.condition,
         c.is_sleeved, c.is_punched,
         c.price_paid_cents, c.currency, c.vendor, c.acquired_on,
         c.lent_to, c.completeness_notes, c.notes
       FROM copy c
       JOIN item i ON i.id = c.item_id
       LEFT JOIN item root ON root.id = i.root_game_id
       ORDER BY root.sort_name, i.sort_name`,
    ).all<Record<string, unknown>>();

    const headers = [
      'game', 'item', 'kind', 'year', 'publisher', 'status', 'location', 'condition',
      'sleeved', 'punched', 'price_paid', 'currency', 'vendor', 'acquired_on',
      'lent_to', 'completeness_notes', 'notes',
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
        r['status'], r['location'], r['condition'],
        r['is_sleeved'] ? 'yes' : 'no',
        r['is_punched'] ? 'yes' : 'no',
        r['price_paid_cents'] == null ? '' : (Number(r['price_paid_cents']) / 100).toFixed(2),
        r['currency'], r['vendor'], r['acquired_on'],
        r['lent_to'], r['completeness_notes'], r['notes'],
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
