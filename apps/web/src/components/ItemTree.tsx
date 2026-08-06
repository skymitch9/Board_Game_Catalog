import { useState } from 'react';
import { ownedCount, summarizeTree, type Copy, type ItemNode } from '@bgc/core';
import { Link } from '../router';
import { Badge, DigitalTag } from './ui';

/**
 * True when everything we hold of this item is a licence.
 *
 * "Every", not "any": a book owned in print *and* on D&D Beyond can still be
 * handed across the table, so it is not the thing this marker warns about.
 */
function allDigital(copies: Copy[]): boolean {
  return copies.length > 0 && copies.every((c) => c.format === 'digital');
}

const KIND_LABEL: Record<ItemNode['kind'], string> = {
  base: 'Base game',
  expansion: 'Expansion',
  accessory: 'Accessory',
  promo: 'Promo',
  upgrade: 'Upgrade',
};

/** Plural forms for the collapsed summary — "3 expansions, 8 accessories". */
const KIND_PLURAL: Record<ItemNode['kind'], [string, string]> = {
  base: ['base game', 'base games'],
  expansion: ['expansion', 'expansions'],
  accessory: ['accessory', 'accessories'],
  promo: ['promo', 'promos'],
  upgrade: ['upgrade', 'upgrades'],
};

/**
 * `preordered` has its own colour, and does not share `wanted`'s.
 *
 * They mean opposite things about your wallet — one is a decision still to make,
 * the other is money already spent on a box in the post — and the collection
 * holds 145 of the second against 5 of the first. Sharing amber made the far
 * commoner state wear the colour that means "you do not have this".
 */
const STATUS_TONE: Record<
  Copy['status'],
  'owned' | 'wanted' | 'preordered' | 'lent' | 'sold' | 'neutral'
> = {
  owned: 'owned',
  wanted: 'wanted',
  preordered: 'preordered',
  lent: 'lent',
  sold: 'sold',
};

/**
 * Which groups the reader has opened, for the life of the tab.
 *
 * Module-level rather than component state because the card is unmounted and
 * rebuilt every time the collection is re-fetched — opening a group, tapping
 * into a game and coming back would otherwise close it again. Deliberately not
 * persisted to storage: this is where you were a moment ago, not a preference.
 */
const openGroups = new Map<number, boolean>();

/**
 * Below this many descendants a group starts open.
 *
 * The control is itself a row: collapsing one or two children replaces two lines
 * with one line and a click, which is not a saving. Three is where the summary
 * starts describing something you would otherwise have to read.
 */
const AUTO_EXPAND_UP_TO = 2;

/** Condensed copy state for a row: "2 owned · lent". */
function copySummary(copies: Copy[]): {
  tone: Copy['status'] | null;
  text: string;
  duplicated: boolean;
  /**
   * The same summary with "owned" left out, and null when there is nothing
   * left to say. Being owned is what the collection *means*, so a card that
   * announces it on every row is announcing nothing — but "lent" alongside it
   * still matters, which is why this drops a word rather than the whole badge.
   */
  notable: { tone: Copy['status']; text: string } | null;
} {
  if (copies.length === 0) {
    return { tone: null, text: 'not catalogued', duplicated: false, notable: null };
  }

  const counts = new Map<Copy['status'], number>();
  for (const c of copies) counts.set(c.status, (counts.get(c.status) ?? 0) + (c.quantity || 1));

  const order: Copy['status'][] = ['owned', 'lent', 'preordered', 'wanted', 'sold'];
  const primary = order.find((s) => counts.has(s)) ?? copies[0]!.status;

  const label = (s: Copy['status']) => (counts.get(s)! > 1 ? `${counts.get(s)} ${s}` : s);
  const parts = order.filter((s) => counts.has(s)).map(label);

  const exceptions = order.filter((s) => s !== 'owned' && counts.has(s));
  const notable =
    exceptions.length > 0
      ? { tone: exceptions[0]!, text: exceptions.map(label).join(' · ') }
      : null;

  return {
    tone: primary,
    text: parts.join(' · '),
    duplicated: ownedCount(copies) > 1,
    notable,
  };
}

/** "12 items: 3 expansions, 8 accessories, 1 promo". */
function describeChildren(node: ItemNode): { count: number; text: string } {
  const counts = new Map<ItemNode['kind'], number>();
  let count = 0;
  const walk = (n: ItemNode) => {
    for (const child of n.children) {
      count += 1;
      counts.set(child.kind, (counts.get(child.kind) ?? 0) + 1);
      walk(child);
    }
  };
  walk(node);

  const breakdown = (Object.keys(KIND_PLURAL) as ItemNode['kind'][])
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${KIND_PLURAL[k][counts.get(k) === 1 ? 0 : 1]}`)
    .join(', ');

  return { count, text: `${count} item${count === 1 ? '' : 's'}: ${breakdown}` };
}

function ChildRow({ node, depth }: { node: ItemNode; depth: number }) {
  const summary = copySummary(node.copies);
  /*
    The same argument the card badge makes, applied one level down: an owned
    child says "owned" and nothing else, so a game with twelve accessories used
    to say it twelve times. Only the exceptions are worth the ink — wanted, lent,
    preordered, sold, and having nothing recorded at all. The duplicate flag
    stays either way, because two of something is a fact about the shelf.
  */
  const status = summary.tone === null ? { tone: null, text: 'not catalogued' } : summary.notable;

  return (
    <>
      <Link to={`/items/${node.id}`} className="child-row" style={{ paddingLeft: 12 + depth * 16 }}>
        <span className="child-kind">{KIND_LABEL[node.kind]}</span>
        <span className="child-name">{node.name}</span>
        <span
          className={
            status?.tone ? `child-status tone-${STATUS_TONE[status.tone]}` : 'child-status muted'
          }
        >
          {summary.duplicated && (
            <span className="dupe-flag" title="More than one">
              ×{ownedCount(node.copies)}
            </span>
          )}
          {allDigital(node.copies) && <DigitalTag />}
          {status?.text}
        </span>
      </Link>
      {node.children.map((c) => (
        <ChildRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

export function ItemCard({ node }: { node: ItemNode }) {
  const stats = summarizeTree(node);
  const own = copySummary(node.copies);
  const brood = describeChildren(node);

  const [open, setOpen] = useState(
    () => openGroups.get(node.id) ?? brood.count <= AUTO_EXPAND_UP_TO,
  );
  const toggle = () => {
    const next = !open;
    openGroups.set(node.id, next);
    setOpen(next);
  };

  return (
    <article className="card item-card">
      <Link to={`/items/${node.id}`} className="item-head">
        {node.thumbnailUrl ? (
          <img className="thumb" src={node.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <span className="thumb thumb-blank" aria-hidden="true" />
        )}
        <span className="item-head-text">
          <span className="item-name">
            {node.name}
            {node.yearPublished && <span className="item-year"> ({node.yearPublished})</span>}
          </span>
          <span className="item-sub">
            {[
              node.publisher,
              node.minPlayers && node.maxPlayers
                ? `${node.minPlayers}–${node.maxPlayers} players`
                : null,
              node.playtimeMin ? `${node.playtimeMin} min` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No details yet'}
          </span>
        </span>
        <span className="item-badges">
          {/* Which ruleset this needs, for the things that do not carry their
              own. Absent on every board game, which is most of the catalog. */}
          {node.gameSystem && <Badge tone="lent">{node.gameSystem}</Badge>}
          {allDigital(node.copies) && <DigitalTag />}
          {/* An expansion sitting at the top level is not a game — it is one
              waiting for its game. Saying so is the difference between a
              catalog that looks wrong and one that is honest about a gap. */}
          {node.kind !== 'base' && node.parentItemId == null && (
            <Badge tone="wanted">
              {node.pendingParentName
                ? `${KIND_LABEL[node.kind]}, waiting for ${node.pendingParentName}`
                : `${KIND_LABEL[node.kind]}, not filed yet`}
            </Badge>
          )}
          {/* "Owned" is not worth a badge: it is what being in the collection
              means, and a label repeated on every card stops being read. The
              exceptions still are — wanted, lent, preordered and sold each say
              something the shelf does not, and so does having no copy at all. */}
          {own.notable && (
            <Badge tone={STATUS_TONE[own.notable.tone]}>{own.notable.text}</Badge>
          )}
          {own.tone === null && <Badge tone="neutral">not catalogued</Badge>}
        </span>
      </Link>

      {/* Why this group is in the results at all. Searching "seafarers" and
          being handed "Catan" is correct — that is where Seafarers is filed —
          but without this the result looks arbitrary, and the match is hidden
          behind a collapsed list. */}
      {node.matchedChildren && node.matchedChildren.length > 0 && (
        <p className="match-why">
          Matched <span>{node.matchedChildren.map((m) => m.name).join(', ')}</span>
        </p>
      )}

      {stats.duplicates.length > 0 && (
        <div className="dupe-strip" title="You hold more than one of these">
          {stats.duplicates.map((d) => (
            <span key={d.id}>
              {d.count} × {d.name}
            </span>
          ))}
        </div>
      )}

      {brood.count > 0 && (
        <>
          <button
            type="button"
            className="children-toggle"
            aria-expanded={open}
            aria-controls={`children-${node.id}`}
            onClick={toggle}
          >
            <span className="children-toggle__caret" aria-hidden="true" data-open={open}>
              ▸
            </span>
            <span>{brood.text}</span>
          </button>
          {/* The container is always in the tree so `aria-controls` always
              points at something; its rows are not, so a collapsed group of 53
              books costs no render. */}
          <div className="children" id={`children-${node.id}`} hidden={!open}>
            {open && node.children.map((c) => <ChildRow key={c.id} node={c} depth={0} />)}
          </div>
        </>
      )}

      <footer className="item-foot">
        <span>
          {stats.totalItems} item{stats.totalItems === 1 ? '' : 's'}
        </span>
        {stats.owned > 0 && <span>{stats.owned} owned</span>}
        {stats.wanted > 0 && <span>{stats.wanted} wanted</span>}
        <Link to={`/items/new?parent=${node.id}`} className="foot-action">
          + Add to this game
        </Link>
      </footer>
    </article>
  );
}

export { KIND_LABEL, STATUS_TONE };
