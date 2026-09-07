/**
 * The accessory-implies-the-game rule, pinned against the case that proved it.
 *
 * `docs/TODO.md` records the finding: six Here to Slay accessories — *Warriors
 * & Druids* Play Mat Set / Standee Set / Meeples Set, and the same three for
 * *Berserkers & Necromancers* — sat in the collection with no expansion row
 * behind them, and both expansions were real. They are items **858** and
 * **859** now. *Banner Quest* is the control: accessory AND expansion both
 * present, so a rule that reports it MISSING is over-firing.
 *
 * 🔴 **The single most important assertion in this file is `banner quest` →
 * PRESENT.** A rule that flags everything finds Here to Slay and is worthless,
 * because the report it produces is 400 rows a person will not read.
 *
 * ⚠️ **These fixtures are shaped from real rows read out of production D1 on
 * 2026-09-07 (read-only), with the names verbatim.** They are a fixture, not a
 * live read — nothing here touches the network, and the numbers in
 * `docs/TODO.md` come from the live sweep, not from this file.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  sweep, subjectOf, words, containsRun, sharedPrefixLength,
  PACKAGING, NAMES_A_PRODUCT, VERIFIED_NOT_MISSING,
  PRESENT, MISSING, AMBIGUOUS, SETTLED,
} from '../lib/implied-product.mjs';

/** Real rows, real names — item ids as they are in production. */
const HERE_TO_SLAY = [
  { id: 107, kind: 'base', parent_item_id: null, root_game_id: 107, name: 'Here to Slay' },
  // The two expansions the sweep's own finding put here.
  { id: 858, kind: 'expansion', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Warriors & Druids Expansion' },
  { id: 859, kind: 'expansion', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Berserkers & Necromancers Expansion' },
  // The control: expansion and accessory both present, from the start.
  { id: 498, kind: 'expansion', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Banner Quest Expansion' },
  { id: 499, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Banner Quest Play Mat' },
  // The six that carried the inference.
  { id: 505, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Warriors & Druids Play Mat Set' },
  { id: 506, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Warriors & Druids Standee Set' },
  { id: 507, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Warriors & Druids Meeples Set' },
  { id: 508, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Berserkers & Necromancers Play Mat Set' },
  { id: 509, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Berserkers & Necromancers Standee Set' },
  { id: 510, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Berserkers & Necromancers Meeples Set' },
  // Packaging only: implies the base game and nothing else.
  { id: 297, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: KS Exclusive Central Play Mat' },
  { id: 299, kind: 'accessory', parent_item_id: 107, root_game_id: 107, name: 'Here to Slay: Base Game Card Sleeves' },
];

const find = (findings, id) => findings.find((f) => f.id === id);

describe('subjectOf — the name is read against its ROOT, word by word', () => {
  it('drops the shared prefix and the packaging, leaving the product name', () => {
    const { subject } = subjectOf('Here to Slay: Warriors & Druids Play Mat Set', 'Here to Slay');
    assert.deepEqual(subject, ['warriors', '&', 'druids']);
  });

  it('🔴 strips a root name the child does not repeat in full', () => {
    // The roots carry suffixes the children do not, so a `startsWith` on the
    // whole root name matches NEITHER of these. Word-wise is the whole trick.
    const { subject } = subjectOf(
      'Deep Rock Galactic: Rivals Neoprene Mat',
      'Deep Rock Galactic: The Board Game',
    );
    assert.deepEqual(subject, ['rivals']);
  });

  it('strips decoration from BOTH ends — it sits on both', () => {
    const { subject } = subjectOf('Here to Slay: KS Exclusive Dragon Party Leader Acrylic Standee', 'Here to Slay');
    assert.deepEqual(subject, ['dragon'], 'KS Exclusive leads, Leader Acrylic Standee trails');
  });

  it('a row that is nothing but packaging has an EMPTY subject, which is correct and common', () => {
    assert.deepEqual(subjectOf('Here to Slay: KS Exclusive Central Play Mat', 'Here to Slay').subject, []);
    assert.deepEqual(subjectOf('Here to Slay: Base Game Card Sleeves', 'Here to Slay').subject, []);
  });

  it('keeps & and | — they separate two real products, and joining them invents a third', () => {
    assert.deepEqual(
      subjectOf('Here to Slay Dungeons: Hero Vinyl Figure Set - Molten | Overgrown', 'Here to Slay Dungeons').subject,
      ['molten', '|', 'overgrown'],
    );
  });

  it('splits a hyphen INSIDE a word, so its halves can reach the vocabulary', () => {
    // `Icy-themed` as one token matches nothing; split, `themed` is packaging.
    assert.deepEqual(words('Icy-themed'), ['icy', '-', 'themed']);
  });

  it('a row with no root name at all still parses rather than throwing', () => {
    assert.deepEqual(subjectOf('Some Orphan: Dice Tray', '').subject, ['some', 'orphan']);
  });
});

describe('sharedPrefixLength / containsRun', () => {
  it('counts only the LEADING run', () => {
    assert.equal(sharedPrefixLength(['a', 'b', 'c'], ['a', 'b', 'z']), 2);
    assert.equal(sharedPrefixLength(['x', 'b'], ['a', 'b']), 0);
  });

  it('matches a consecutive run, not a bag of words', () => {
    assert.equal(containsRun(['a', 'b', 'c'], ['b', 'c']), true);
    assert.equal(containsRun(['a', 'b', 'c'], ['a', 'c']), false, 'a gap is not a match');
    assert.equal(containsRun(['a'], []), false, 'an empty subject matches nothing');
  });
});

describe('sweep — the Here to Slay case, as it stands today', () => {
  const { findings, counts } = sweep({ items: HERE_TO_SLAY, relations: [] });

  it('every accessory reaches its base game — that half finds nothing here', () => {
    assert.equal(counts.base.MISSING, 0);
    assert.equal(counts.base.AMBIGUOUS, 0);
    assert.equal(find(findings, 505).base_game, 'Here to Slay');
    assert.equal(find(findings, 505).base_status, PRESENT);
  });

  it('🔴 the six accessories now resolve to the expansions that were added for them', () => {
    for (const id of [505, 506, 507]) {
      const f = find(findings, id);
      assert.equal(f.subject, 'warriors & druids', `id ${id}`);
      assert.equal(f.implied_status, PRESENT, `id ${id}`);
      assert.equal(f.matched_by, 'Here to Slay: Warriors & Druids Expansion');
    }
    for (const id of [508, 509, 510]) {
      const f = find(findings, id);
      assert.equal(f.subject, 'berserkers & necromancers', `id ${id}`);
      assert.equal(f.implied_status, PRESENT, `id ${id}`);
    }
  });

  it('…and the confidence column counts three accessories per subject, which is the SHAPE of the finding', () => {
    assert.equal(find(findings, 505).subject_rows, 3);
    assert.equal(find(findings, 508).subject_rows, 3);
  });

  it('🔴 REMOVE item 858 and the sweep reports exactly what it reported in August', () => {
    // This is the regression that matters: the rule must reproduce the original
    // finding, or it is not the rule that made it.
    const without = HERE_TO_SLAY.filter((r) => r.id !== 858);
    const { findings: f2 } = sweep({ items: without, relations: [] });
    for (const id of [505, 506, 507]) {
      assert.equal(find(f2, id).implied_status, MISSING, `id ${id} should be MISSING with no 858`);
      assert.equal(find(f2, id).implied_product, 'Here to Slay — warriors & druids');
    }
    // And the OTHER family is untouched — the rule is per-subject, not per-game.
    assert.equal(find(f2, 508).implied_status, PRESENT);
  });

  it('🔴 THE CONTROL: Banner Quest has both, and is PRESENT on one accessory alone', () => {
    const f = find(findings, 499);
    assert.equal(f.subject, 'banner quest');
    assert.equal(f.subject_rows, 1, 'one accessory — a low-confidence row that is nonetheless right');
    assert.equal(f.implied_status, PRESENT);
    assert.equal(f.matched_by, 'Here to Slay: Banner Quest Expansion');
  });

  it('a packaging-only accessory answers for its base game and claims no product', () => {
    for (const id of [297, 299]) {
      const f = find(findings, id);
      assert.equal(f.subject, '', `id ${id}`);
      assert.equal(f.implied_status, PRESENT);
      assert.equal(f.implied_product, 'Here to Slay');
    }
  });
});

describe('sweep — what it deliberately does NOT ask', () => {
  it('🔴 an EXPANSION is never asked what it implies — that question is circular', () => {
    // Measured 2026-09-07: leaving expansions in produced 444 MISSING rows, 257
    // of which were expansions announcing their own non-existence.
    assert.equal(NAMES_A_PRODUCT.has('expansion'), false);
    const { findings } = sweep({ items: HERE_TO_SLAY, relations: [] });
    for (const id of [858, 859, 498]) {
      const f = find(findings, id);
      assert.equal(f.implied_status, PRESENT, `expansion ${id} must not report itself missing`);
      assert.equal(f.subject, '', 'and it is not given a subject to be judged on');
    }
  });

  it('accessories, promos and upgrades are asked; nothing else is', () => {
    assert.deepEqual([...NAMES_A_PRODUCT].sort(), ['accessory', 'promo', 'upgrade']);
  });
});

describe('sweep — the statuses that are not PRESENT/MISSING', () => {
  const ODD = [
    { id: 1, kind: 'base', parent_item_id: null, root_game_id: 1, name: 'Real Game' },
    // A self-rooted accessory: furniture, not a game. Production has three.
    { id: 2, kind: 'accessory', parent_item_id: null, root_game_id: 2, name: 'Pangea Gaming Table 4x6 (Dark Walnut)' },
    // Rooted under that accessory rather than under a game.
    { id: 3, kind: 'accessory', parent_item_id: 2, root_game_id: 2, name: 'Lucid Dice Tower' },
    // A dangling root.
    { id: 4, kind: 'accessory', parent_item_id: null, root_game_id: 999, name: 'Orphan: Card Sleeves' },
  ];
  const { findings } = sweep({ items: ODD, relations: [] });

  it('a row whose root is not a base game is AMBIGUOUS, not MISSING — nothing is being bought', () => {
    assert.equal(find(findings, 3).base_status, AMBIGUOUS);
    assert.match(find(findings, 3).base_note, /not a base game/);
  });

  it('🔴 …and it is asked NO subject question either — there is no game title to read against', () => {
    // Measured 2026-09-07: the eighteen Pangea gaming-table parts are rooted
    // under the table (an accessory), so the name rule had nothing to strip and
    // proposed products called "cup" and "legs standard 26". Eighteen rows of
    // pure noise in a report a person has to read.
    const f = find(findings, 3);
    assert.equal(f.subject, '', 'no subject is claimed');
    assert.equal(f.implied_status, AMBIGUOUS, 'not MISSING — nothing is implied');
  });

  it('a self-rooted accessory says so in its own words', () => {
    assert.equal(find(findings, 2).base_status, AMBIGUOUS);
    assert.match(find(findings, 2).base_note, /self-rooted/);
  });

  it('a dangling root_game_id is MISSING, and names the id that resolved to nothing', () => {
    assert.equal(find(findings, 4).base_status, MISSING);
    assert.match(find(findings, 4).base_note, /999/);
  });

  it('AMBIGUOUS when one subject matches products under two different roots', () => {
    const TWO = [
      { id: 1, kind: 'base', parent_item_id: null, root_game_id: 1, name: 'Veiled Fate' },
      { id: 2, kind: 'base', parent_item_id: null, root_game_id: 2, name: 'Scales of Fate' },
      { id: 3, kind: 'accessory', parent_item_id: 1, root_game_id: 1, name: 'Veiled Fate: Fate Dice' },
    ];
    // The two roots are one family, so the sweep looks across both and finds
    // the word in each — which is exactly the case it must refuse to decide.
    const rel = [{ from_item_id: 1, to_item_id: 2, relation: 'same_family' }];
    const { findings: f } = sweep({ items: TWO, relations: rel });
    assert.equal(find(f, 3).subject, 'fate');
    assert.equal(find(f, 3).implied_status, AMBIGUOUS);
  });

  it('a same_family edge lets a sibling ROOT answer for a subject', () => {
    const FAM = [
      { id: 1, kind: 'base', parent_item_id: null, root_game_id: 1, name: 'Catan' },
      { id: 2, kind: 'base', parent_item_id: null, root_game_id: 2, name: 'Catan: Starfarers' },
      { id: 3, kind: 'accessory', parent_item_id: 1, root_game_id: 1, name: 'Catan: Starfarers Card Sleeves' },
    ];
    const rel = [{ from_item_id: 1, to_item_id: 2, relation: 'same_family' }];
    assert.equal(find(sweep({ items: FAM, relations: rel }).findings, 3).implied_status, PRESENT);
    // Without the edge the sibling root is invisible and the row reads MISSING.
    assert.equal(find(sweep({ items: FAM, relations: [] }).findings, 3).implied_status, MISSING);
  });

  it('🔴 an accessory NEVER answers for another accessory — that is the Here to Slay bug', () => {
    // Three sleeves naming a product do not prove the product exists. If they
    // did, the six rows that started all this would have reported PRESENT.
    const ACC = [
      { id: 1, kind: 'base', parent_item_id: null, root_game_id: 1, name: 'Game' },
      { id: 2, kind: 'accessory', parent_item_id: 1, root_game_id: 1, name: 'Game: Widgets Play Mat' },
      { id: 3, kind: 'accessory', parent_item_id: 1, root_game_id: 1, name: 'Game: Widgets Sleeves' },
    ];
    const { findings: f } = sweep({ items: ACC, relations: [] });
    assert.equal(find(f, 2).implied_status, MISSING);
    assert.equal(find(f, 2).subject_rows, 2, 'they still count each other for CONFIDENCE');
  });
});

describe('SETTLED — the six subjects a person checked on 2026-09-07', () => {
  /**
   * 🔴 The whole shortlist the first live run produced — every subject named by
   * two or more accessories — and every one of them a FALSE POSITIVE. Four name
   * no product at all; two name a product already held under a different name.
   * The fixtures below are the real rows, with the real subjects the sweep
   * extracts from them: note `magic` (not `black magic` — `black` is a colour in
   * PACKAGING) and `minimalist flaming` (not `minimalist` — `die` is packaging
   * and `flaming` is not).
   */
  const SETTLED_CASES = [
    {
      key: '105::rivals', root: { id: 105, name: 'Deep Rock Galactic: The Board Game' },
      rows: [
        [168, 'Deep Rock Galactic: Rivals Neoprene Mat'],
        [171, 'Deep Rock Galactic: Rivals Card Sleeves'],
        [494, 'Deep Rock Galactic: Rivals Exclusive Gift Box'],
      ],
      subject: 'rivals',
    },
    {
      key: '511::yokai dawn', root: { id: 511, name: "Ryoko's Guide to the Yokai Realms" },
      rows: [
        [516, "Ryoko's Guide: Yokai Dawn Dice Mini Set"],
        [517, "Ryoko's Guide: Yokai Dawn Resin Dice Set"],
      ],
      subject: 'yokai dawn',
    },
    {
      key: '107::dragon class', root: { id: 107, name: 'Here to Slay' },
      rows: [
        [460, 'Here to Slay: Dragon Class Dice'],
        [462, 'Here to Slay: Dragon Class Meeple Set'],
      ],
      subject: 'dragon class',
    },
    {
      key: '428::3dition', root: { id: 428, name: 'Ark Nova' },
      rows: [
        [409, 'Ark Nova 3Dition: Premium Metal Coins'],
        [412, 'Ark Nova 3Dition: Premium Custom Sleeves'],
      ],
      subject: '3dition',
    },
    {
      key: '53::magic', root: { id: 53, name: 'Fractured Sky' },
      rows: [
        [251, 'Fractured Sky: Black Magic Custom Organizer'],
        [252, 'Fractured Sky: Black Magic Custom Trays'],
      ],
      subject: 'magic',
    },
    {
      key: '92::minimalist flaming', root: { id: 92, name: 'Dice Throne: Outcasts' },
      rows: [
        [561, 'Dice Throne: Card Sleeves - Minimalist (Flaming Die)'],
        [568, 'Dice Throne: Playmat - Minimalist (Flaming Die)'],
      ],
      subject: 'minimalist flaming',
    },
  ];

  for (const c of SETTLED_CASES) {
    it(`${c.key} — reports SETTLED, not MISSING, and carries its reason`, () => {
      const items = [
        { id: c.root.id, kind: 'base', parent_item_id: null, root_game_id: c.root.id, name: c.root.name },
        ...c.rows.map(([id, name]) => ({
          id, kind: 'accessory', parent_item_id: c.root.id, root_game_id: c.root.id, name,
        })),
      ];
      const { findings, counts } = sweep({ items, relations: [] });
      for (const [id] of c.rows) {
        const f = find(findings, id);
        assert.equal(f.subject, c.subject, `id ${id} — the subject the registry is keyed on`);
        assert.equal(f.implied_status, SETTLED, `id ${id}`);
        assert.match(f.matched_by, /\[verified \d{4}-\d{2}-\d{2}\]$/, `id ${id} — the date travels with the verdict`);
      }
      assert.equal(counts.implied.MISSING, 0, 'nothing in this family is still a gap');
      assert.equal(counts.implied.SETTLED, c.rows.length);
    });
  }

  it('🔴 an UNLISTED subject under a settled root is still MISSING — the entry is per-subject', () => {
    // The registry must not amount to "stop asking about this game". Deep Rock
    // Galactic has `rivals` settled; a different subject under the same root has
    // been checked by nobody and must still be reported.
    const items = [
      { id: 105, kind: 'base', parent_item_id: null, root_game_id: 105, name: 'Deep Rock Galactic: The Board Game' },
      { id: 168, kind: 'accessory', parent_item_id: 105, root_game_id: 105, name: 'Deep Rock Galactic: Rivals Neoprene Mat' },
      { id: 900, kind: 'accessory', parent_item_id: 105, root_game_id: 105, name: 'Deep Rock Galactic: Glyphid Swarm Neoprene Mat' },
    ];
    const { findings } = sweep({ items, relations: [] });
    assert.equal(find(findings, 168).implied_status, SETTLED);
    assert.equal(find(findings, 900).subject, 'glyphid swarm');
    assert.equal(find(findings, 900).implied_status, MISSING);
  });

  it('🔴 SETTLED never masks a live PRESENT — a real match still wins', () => {
    // If the owner ever adds a row actually named "Rivals", the sweep must say
    // PRESENT rather than keep quoting a 2026-09-07 verdict about its absence.
    const items = [
      { id: 105, kind: 'base', parent_item_id: null, root_game_id: 105, name: 'Deep Rock Galactic: The Board Game' },
      { id: 168, kind: 'accessory', parent_item_id: 105, root_game_id: 105, name: 'Deep Rock Galactic: Rivals Neoprene Mat' },
      { id: 901, kind: 'expansion', parent_item_id: 105, root_game_id: 105, name: 'Deep Rock Galactic: Rivals Expansion' },
    ];
    const { findings } = sweep({ items, relations: [] });
    assert.equal(find(findings, 168).implied_status, PRESENT);
    assert.equal(find(findings, 168).matched_by, 'Deep Rock Galactic: Rivals Expansion');
  });

  it('every registry entry carries a verdict, the evidence and the date it was checked', () => {
    // ⚠️ An entry with no source is a guess wearing a measurement's clothes,
    // which is exactly what this file is here to stop.
    assert.equal(VERIFIED_NOT_MISSING.size, 6);
    for (const [key, e] of VERIFIED_NOT_MISSING) {
      assert.match(key, /^\d+::.+$/, `key shape: ${key}`);
      assert.match(e.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, key);
      assert.ok(e.verdict && e.verdict.length > 20, `${key} needs a verdict`);
      assert.ok(e.evidence && e.evidence.length > 40, `${key} needs its source named`);
      assert.ok(e.root && e.root.length > 0, `${key} needs its root game named`);
    }
  });
});

describe('the vocabulary is a measured list, and the report depends on knowing that', () => {
  it('holds the words that actually appear as packaging in this collection', () => {
    for (const w of ['playmat', 'sleeves', 'ks', 'exclusive', 'deluxe', 'neoprene', 'meeples']) {
      assert.equal(PACKAGING.has(w), true, `missing from PACKAGING: ${w}`);
    }
  });

  it('⚠️ and does NOT hold words that name products — this is what makes MISSING an UPPER BOUND', () => {
    // `town` survives out of "Icy-themed Neoprene Town Mat" and produces a
    // spurious MISSING row. That is the documented, accepted failure direction:
    // the report over-proposes for a person to read, and writes nothing.
    for (const w of ['town', 'rivals', 'druids', 'warriors']) {
      assert.equal(PACKAGING.has(w), false, `wrongly in PACKAGING: ${w}`);
    }
  });
});
