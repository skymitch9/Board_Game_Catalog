import { ownedCount, summarizeTree, type Copy, type ItemNode } from '@bgc/core';
import { Link } from '../router';
import { Badge } from './ui';

const KIND_LABEL: Record<ItemNode['kind'], string> = {
  base: 'Base game',
  expansion: 'Expansion',
  accessory: 'Accessory',
  promo: 'Promo',
  upgrade: 'Upgrade',
};

const STATUS_TONE: Record<Copy['status'], 'owned' | 'wanted' | 'lent' | 'sold' | 'neutral'> = {
  owned: 'owned',
  wanted: 'wanted',
  preordered: 'wanted',
  lent: 'lent',
  sold: 'sold',
};

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

function ChildRow({ node, depth }: { node: ItemNode; depth: number }) {
  const summary = copySummary(node.copies);
  return (
    <>
      <Link to={`/items/${node.id}`} className="child-row" style={{ paddingLeft: 12 + depth * 16 }}>
        <span className="child-kind">{KIND_LABEL[node.kind]}</span>
        <span className="child-name">{node.name}</span>
        <span className={summary.tone ? `child-status tone-${STATUS_TONE[summary.tone]}` : 'child-status muted'}>
          {summary.duplicated && <span className="dupe-flag" title="More than one">×{ownedCount(node.copies)}</span>}
          {summary.text}
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

      {stats.duplicates.length > 0 && (
        <div className="dupe-strip" title="You hold more than one of these">
          {stats.duplicates.map((d) => (
            <span key={d.id}>
              {d.count} × {d.name}
            </span>
          ))}
        </div>
      )}

      {node.children.length > 0 && (
        <div className="children">
          {node.children.map((c) => (
            <ChildRow key={c.id} node={c} depth={0} />
          ))}
        </div>
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
