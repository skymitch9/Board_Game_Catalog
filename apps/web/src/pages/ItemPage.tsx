import { useState } from 'react';
import {
  DETAIL_FIELD_LABEL,
  detailGaps,
  fillableFieldsFor,
  copyStateLabel,
  isDisposedStatus,
  isTrustedMatch,
  type Copy,
  type CopyStatus,
  type DetailsRun,
  type InheritedDetail,
  type ItemDetail,
  type ItemNode,
  type MeResponse,
  type RelatedItemRef,
  type UpdateItemInput,
} from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link, navigate } from '../router';
import { AddRelatedPanel, RELATION_LABEL } from '../components/AddRelated';
import { Arrivals } from '../components/Arrivals';
import { Completeness } from '../components/Completeness';
import { CopyForm, CopyRow } from '../components/CopyEditor';
import { CopyHistory } from '../components/CopyHistory';
import { ItemForm } from '../components/ItemForm';
import { KIND_LABEL, STATUS_TONE } from '../components/ItemTree';
import { Ratings } from '../components/Ratings';
import {
  Badge,
  ConfirmButton,
  Cover,
  DigitalTag,
  EmptyState,
  ErrorBox,
  Spinner,
} from '../components/ui';

export function ItemPage({
  id,
  me,
  editing = false,
}: {
  id: number;
  me: MeResponse;
  editing?: boolean;
}) {
  const [detail, refresh] = useAsync(() => api.item(id), [id]);
  const [addingCopy, setAddingCopy] = useState(false);
  /**
   * Held here rather than inside the panel that did the work: refreshing puts
   * the page back through its loading state, which unmounts everything below
   * it. The report of what changed has to outlive the reload that proves it.
   */
  const [changeNote, setChangeNote] = useState<string | null>(null);
  /**
   * Which add panel is open, and where it is rendered.
   *
   * One piece of state for three buttons in three sections, so opening one
   * closes the others. They open the *same* component — see `AddRelatedPanel` —
   * and differ only in which row of its dropdown starts selected: `expansion`
   * and `accessory` are both nest panels opened on their own kind, `link` is the
   * sideways-relation panel on the related-games section.
   */
  const [adding, setAdding] = useState<'expansion' | 'accessory' | 'link' | null>(null);

  const canEdit = me.capabilities.includes('editCatalog');
  const canRate = me.capabilities.includes('rate');

  if (detail.state === 'loading') return <Spinner />;
  if (detail.state === 'error') {
    return <ErrorBox error={detail.error} what="Could not load this item" />;
  }

  const item = detail.data.item;
  const reload = () => refresh();

  if (editing) {
    return (
      <>
        <ItemForm
          existing={item}
          parentId={item.parentItemId}
          parentName={item.parent?.name ?? null}
          onSaved={() => navigate(`/items/${item.id}`)}
          onCancel={() => navigate(`/items/${item.id}`)}
        />
        {/* Unlinking lives here rather than beside the links themselves, so
            breaking a connection takes a deliberate trip to the edit screen
            while making one stays a single tap. */}
        <LinkEditor itemId={item.id} related={item.relatedItems} onChanged={reload} />
      </>
    );
  }

  return (
    <>
      <nav className="crumbs">
        <Link to="/">Collection</Link>
        {item.parent && (
          <>
            <span aria-hidden="true">›</span>
            <Link to={`/items/${item.parent.id}`}>{item.parent.name}</Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span className="crumb-current">{item.name}</span>
      </nav>

      <header className="page-head item-detail-head">
        {/* Its own picture, or its game's. `.thumb-lg` is never lazy — it is
            the picture you opened the page to see. Whose it is is said in
            words below, beside the name, not stamped on the image. */}
        <Cover item={item} size="lg" />
        <div className="grow">
          <Badge tone="kind">{KIND_LABEL[item.kind]}</Badge>
          {/* Only when there is one. A board game carries its rules in the box,
              so most items have nothing here, and an empty badge or an
              "unknown" would be noise on 516 of 640 pages. */}
          {item.gameSystem && <Badge tone="lent">{item.gameSystem}</Badge>}
          {/* The line this belongs to. The tree is unchanged — this box is
              still its own root — so the badge is the only place it shows. */}
          {item.series && <Badge tone="kind">{item.series}</Badge>}
          <h1>
            {item.name}
            {item.yearPublished && <span className="item-year"> ({item.yearPublished})</span>}
          </h1>
          <Subtitle item={item} />
          {/* Somebody looking at one row on its own deserves to know the art is
              not this product's. The same muted, linked treatment the borrowed
              publisher gets — and it appears only when the picture really is
              somebody else's, because `inheritedCover` is null whenever the row
              has art of its own. */}
          {item.inheritedCover && (
            <p className="subtitle inherited-from">
              Cover from{' '}
              <Link to={`/items/${item.inheritedCover.fromItemId}`}>
                {item.inheritedCover.fromName}
              </Link>
            </p>
          )}
          <ExternalLinks item={item} />
          <Dependencies related={item.relatedItems} />
        </div>
        {canEdit && (
          <div className="head-actions">
            <Link to={`/items/${item.id}/edit`} className="btn btn-quiet">
              Edit
            </Link>
            <ConfirmButton
              confirmLabel={
                item.children.length > 0
                  ? `Delete and ${item.children.length} child item(s)?`
                  : 'Really delete?'
              }
              onConfirm={async () => {
                await api.deleteItem(item.id);
                navigate(item.parent ? `/items/${item.parent.id}` : '/');
              }}
            >
              Delete
            </ConfirmButton>
          </div>
        )}
      </header>

      {changeNote && <p className="lookup-filled">{changeNote}</p>}

      {/* Above everything else on purpose. A preorder landing is why the page
          was opened — nobody navigates to Cyberpunk 2077 to fill in its player
          count on the day the box turns up. It renders nothing at all for the
          items that have nothing on the way, which is nearly all of them. */}
      <Arrivals
        item={item}
        canEdit={canEdit}
        onArrived={(note) => {
          setChangeNote(note);
          reload();
        }}
      />

      {canEdit && (
        <LookupDetails
          item={item}
          onFilled={(summary) => {
            setChangeNote(summary);
            reload();
          }}
          canResearch={me.capabilities.includes('runResearch')}
        />
      )}

      {item.description && <p className="description card">{item.description}</p>}

      <Shelf
        item={item}
        canEdit={canEdit}
        addingCopy={addingCopy}
        onAddCopy={() => setAddingCopy(true)}
        onDoneAdding={() => {
          setAddingCopy(false);
          reload();
        }}
        onCancelAdding={() => setAddingCopy(false)}
        reload={reload}
      />

      {/* Directly under the shelf, because it is the shelf's own past tense.
          Renders nothing when there is no history, which is every game today. */}
      <CopyHistory itemId={item.id} />

      <ChildSections
        item={item}
        canEdit={canEdit}
        adding={adding}
        onAdd={setAdding}
        onSaved={(note) => {
          setChangeNote(note);
          setAdding(null);
          reload();
        }}
        onCancel={() => setAdding(null)}
      />

      {/* Only on the game itself. The report is always about the tree's root,
          so rendering it on an expansion's page would repeat the base game's
          answer under a heading that reads as being about the expansion. */}
      {item.parentItemId == null && <Completeness item={item} canEdit={canEdit} />}

      {/* Ratings before related games, deliberately. A Dice Throne hero lists
          about fifty-five relatives — family is transitive and the whole line is
          one family — so a related-games list above this buried the short useful
          thing under the long one. The list is unchanged; only its position is.

          The family score rides in here rather than on the "Related games"
          heading below, which is the other place the family is shown: one fact,
          one home. It is a fact about ratings, it sits directly above the list
          it summarises, and printing it twice on one page is how two numbers
          eventually disagree. */}
      <Ratings
        itemId={item.id}
        ratings={item.ratings}
        familyScore={item.familyScore}
        myEmail={me.email}
        canRate={canRate}
        onChanged={reload}
      />

      <RelatedGames
        item={item}
        canEdit={canEdit}
        adding={adding === 'link'}
        onAdd={() => setAdding('link')}
        onCancel={() => setAdding(null)}
        onSaved={(note) => {
          setChangeNote(note);
          setAdding(null);
          reload();
        }}
      />
    </>
  );
}

/**
 * Shelf order — held first, gone last.
 *
 * The shelf leads with what you actually have, so `owned` and `lent` (still
 * yours, just not in the house) sort to the top, then the box in the post, then
 * the wishlist, then what has left the collection. A status the map does not
 * know sorts to the end rather than throwing.
 */
const SHELF_ORDER: Record<CopyStatus, number> = {
  owned: 0,
  lent: 1,
  preordered: 2,
  wanted: 3,
  sold: 4,
};

function byShelfOrder(a: Copy, b: Copy): number {
  const ra = SHELF_ORDER[a.status] ?? 9;
  const rb = SHELF_ORDER[b.status] ?? 9;
  if (ra !== rb) return ra - rb;
  // Within a status, newest-added first — the most recent shelf change on top.
  return b.addedAt.localeCompare(a.addedAt);
}

/**
 * On your shelf — what you hold, led by what you hold.
 *
 * The library's redesign leads a work with its editions and nests copies under
 * them. **Board games differ, and deliberately.** `copy.edition_id` is null
 * across the whole catalog and is settled to stay that way (the owner, 2026-08:
 * *"that'll probably be null forever … I don't super care to track it down"*),
 * so the catalog knows which printings *exist* — the cover picker on the edit
 * form offers them — but never records which printing a given box is. There is
 * therefore no edition to nest a copy under, and the copies themselves are the
 * shelf units.
 *
 * What carries across is the shape, not the schema: lead with what you have, and
 * never render an empty shelf. Copies sort held-first; a game with no copy at
 * all shows a single "not on your shelf" slot rather than a blank — and mints
 * nothing to do it, because a wish is not a fake copy (the data guard the whole
 * catalog is built on).
 */
function Shelf({
  item,
  canEdit,
  addingCopy,
  onAddCopy,
  onDoneAdding,
  onCancelAdding,
  reload,
}: {
  item: ItemDetail;
  canEdit: boolean;
  addingCopy: boolean;
  onAddCopy: () => void;
  onDoneAdding: () => void;
  onCancelAdding: () => void;
  reload: () => void;
}) {
  /*
    Copies that have left are split out rather than sorted to the bottom.

    `docs/info/copy-status-history.md` §5 step 7 asks for disposed copies to be
    excluded by default and reachable behind a filter. This is that, at the one
    surface where a copy is actually shown: a game given away is still catalog
    data worth keeping, but it is not "on your shelf", and leaving it in the
    list — even last — makes the section's own heading a lie.

    ⚠️ The collection PAGE's query is deliberately untouched, so a game whose
    every copy has gone is still listed there. Hiding whole trees is a bigger,
    separate decision (the catalog row is not the copy), and there are zero
    disposed copies in production today to justify it. The collection's status
    dropdown offers "no longer ours" as the filter half.
  */
  const held = item.copies.filter((c) => !isDisposedStatus(c.status)).sort(byShelfOrder);
  const gone = item.copies.filter((c) => isDisposedStatus(c.status)).sort(byShelfOrder);

  return (
    <section className="card">
      <div className="section-head">
        <h2>On your shelf</h2>
        {canEdit && !addingCopy && (
          <button type="button" className="btn btn-quiet" onClick={onAddCopy}>
            + Add copy
          </button>
        )}
      </div>

      {addingCopy && (
        <CopyForm
          itemId={item.id}
          onDone={onDoneAdding}
          onCancel={onCancelAdding}
        />
      )}

      {held.length > 0 ? (
        <ul className="copy-list">
          {held.map((copy) => (
            <CopyRow key={copy.id} copy={copy} canEdit={canEdit} onChanged={reload} />
          ))}
        </ul>
      ) : (
        !addingCopy && (
          /* Never a blank shelf. A single dashed slot standing in for "nothing
             here yet" — display only, so no fake copy is minted to fill it. */
          <ul className="copy-list">
            <li className="copy copy--empty">
              <Badge tone="neutral">not on your shelf</Badge>
              <span className="copy-facts">
                {canEdit
                  ? 'No copy recorded yet — add one to say you hold it, or mark it wanted.'
                  : 'No copy recorded yet.'}
              </span>
            </li>
          </ul>
        )
      )}

      {gone.length > 0 && <GoneCopies copies={gone} canEdit={canEdit} reload={reload} />}
    </section>
  );
}

/**
 * The copies that have left — folded away, one click from open.
 *
 * ⚠️ **Collapsed, not hidden.** The count is on the summary line whether it is
 * open or shut, because a shelf that quietly omits three copies is how somebody
 * concludes the catalog lost them. The bargain the completeness disclosures
 * already make: default to the useful view, never to a silent one.
 */
function GoneCopies({
  copies,
  canEdit,
  reload,
}: {
  copies: Copy[];
  canEdit: boolean;
  reload: () => void;
}) {
  return (
    <details className="gone-copies">
      <summary>
        {copies.length === 1 ? '1 copy no longer ours' : `${copies.length} copies no longer ours`}
      </summary>
      <ul className="copy-list">
        {copies.map((copy) => (
          <CopyRow key={copy.id} copy={copy} canEdit={canEdit} onChanged={reload} />
        ))}
      </ul>
    </details>
  );
}

/**
 * What a nested row holds, said the same way wherever a child is listed.
 *
 * Pulled out so an expansion card and an accessory row cannot drift on how they
 * report ownership — the digital tag, the copy count, the status badge. A child
 * with no copy at all reads "not catalogued" rather than showing nothing, which
 * on a shelf-first page would be indistinguishable from a bug.
 */
function ChildMeta({ child }: { child: ItemNode }) {
  const primary = child.copies[0];
  // A container of D&D Beyond books has 53 children and not one can be handed
  // across the table. Saying so here is the difference between a shelf and a
  // library card.
  const allDigital = child.copies.length > 0 && child.copies.every((c) => c.format === 'digital');
  return (
    <>
      {allDigital && <DigitalTag />}
      {primary ? (
        <Badge tone={STATUS_TONE[primary.status]}>
          {/* ⚠️ `copyStateLabel`, not `primary.status`: a given-away copy is
              stored as `sold`, and the raw word would misreport it. */}
          {child.copies.length > 1
            ? `${child.copies.length} copies`
            : copyStateLabel(primary.status, primary.disposal)}
        </Badge>
      ) : (
        <span className="muted">not catalogued</span>
      )}
    </>
  );
}

/**
 * Expansions and accessories, now two sections rather than one.
 *
 * Expansions are the thing the owner reaches for — "what else can I add to this
 * game" — so they lead as a grid of promoted cards, each its own full page
 * behind a tap on its cover. Accessories, promos and upgrades are the long tail
 * (the catalog holds 221 accessories against 186 expansions) and sit below as a
 * lighter list, the same `.child-list` the page used before the split.
 *
 * Both open the *same* `AddRelatedPanel`; the only difference is which kind its
 * dropdown starts on, so adding an accessory is one tap from the accessories
 * heading rather than a dropdown hunt under "Expansions".
 */
function ChildSections({
  item,
  canEdit,
  adding,
  onAdd,
  onSaved,
  onCancel,
}: {
  item: ItemDetail;
  canEdit: boolean;
  adding: 'expansion' | 'accessory' | 'link' | null;
  onAdd: (which: 'expansion' | 'accessory') => void;
  onSaved: (note: string) => void;
  onCancel: () => void;
}) {
  const expansions = item.children.filter((c) => c.kind === 'expansion');
  // Everything nested that is not an expansion — accessory, promo, upgrade.
  const extras = item.children.filter((c) => c.kind !== 'expansion');

  return (
    <>
      {(expansions.length > 0 || canEdit) && (
        <section className="card">
          <div className="section-head">
            <h2>
              Expansions
              {expansions.length > 0 && <span className="count"> {expansions.length}</span>}
            </h2>
            {/* A button, not a link out to a blank form. Adding an expansion used
                to mean leaving the page for `/items/new`, which is where the
                suggestion list that could not be acted on lived. */}
            {canEdit && adding !== 'expansion' && (
              <button type="button" className="btn btn-quiet" onClick={() => onAdd('expansion')}>
                + Add
              </button>
            )}
          </div>

          {adding === 'expansion' && (
            <AddRelatedPanel
              item={item}
              mode="nest"
              defaultKind="expansion"
              onSaved={onSaved}
              onCancel={onCancel}
            />
          )}

          {expansions.length === 0 ? (
            <p className="muted">
              No expansions filed under this{canEdit ? ' — add one to fold it into this game.' : '.'}
            </p>
          ) : (
            <ul className="expansion-grid">
              {expansions.map((child) => (
                <li key={child.id}>
                  <Link to={`/items/${child.id}`} className="expansion-card">
                    <Cover item={child} size="md" />
                    <span className="expansion-card__body">
                      <span className="expansion-card__name">{child.name}</span>
                      {child.yearPublished && (
                        <span className="expansion-card__year">{child.yearPublished}</span>
                      )}
                      <span className="expansion-card__meta">
                        <ChildMeta child={child} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(extras.length > 0 || canEdit) && (
        <section className="card">
          <div className="section-head">
            <h2>
              Accessories &amp; extras
              {extras.length > 0 && <span className="count"> {extras.length}</span>}
            </h2>
            {canEdit && adding !== 'accessory' && (
              <button type="button" className="btn btn-quiet" onClick={() => onAdd('accessory')}>
                + Add
              </button>
            )}
          </div>

          {adding === 'accessory' && (
            <AddRelatedPanel
              item={item}
              mode="nest"
              defaultKind="accessory"
              onSaved={onSaved}
              onCancel={onCancel}
            />
          )}

          {extras.length === 0 ? (
            <p className="muted">
              Nothing else filed under this
              {canEdit ? ' — accessories, promos, sleeves, inserts and upgrades go here.' : '.'}
            </p>
          ) : (
            <ul className="child-list">
              {extras.map((child) => (
                <li key={child.id}>
                  <Link to={`/items/${child.id}`} className="child-link">
                    <span className="child-kind">{KIND_LABEL[child.kind]}</span>
                    <span className="child-name">{child.name}</span>
                    <ChildMeta child={child} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/**
 * Publisher and publisher site, as this page should show them.
 *
 * A playmat's publisher is its game's publisher, and the catalog deliberately
 * does not write that onto the playmat's row — a stored copy would be
 * indistinguishable later from a fact somebody checked, and would go stale the
 * moment the game's was corrected. So the value is resolved here, on the way to
 * the screen, and carries where it came from. See `packages/core/src/details.ts`.
 *
 * **The site is only borrowed alongside the publisher.** An item that records
 * its own publisher but no URL gets nothing: linking it to the ancestor's
 * website would name one company and point at another's.
 */
function resolvePublisher(item: ItemDetail): {
  publisher: string | null;
  publisherUrl: string | null;
  /** The ancestor the values were borrowed from — null when they are this item's own. */
  from: InheritedDetail | null;
} {
  const own = !isBlank(item.publisher);
  const borrowedName = own ? null : (item.inherited.publisher ?? null);
  const borrowedUrl = own ? null : (item.inherited.publisherUrl ?? null);

  return {
    publisher: own ? item.publisher : (borrowedName?.value ?? null),
    publisherUrl: isBlank(item.publisherUrl)
      ? (borrowedUrl?.value ?? null)
      : item.publisherUrl,
    from: borrowedName ?? borrowedUrl,
  };
}

/**
 * The line under the name — and the one place a value shown here may not be
 * this item's own.
 *
 * An inherited publisher is shown with a muted "from <game>" beside it rather
 * than silently, because a fact borrowed from the box upstairs and a fact
 * somebody looked up should not read identically. The name links, so the claim
 * can be checked in one tap.
 */
function Subtitle({ item }: { item: ItemDetail }) {
  const { publisher, from } = resolvePublisher(item);

  const rest = [
    item.designers,
    item.minPlayers && item.maxPlayers ? `${item.minPlayers}–${item.maxPlayers} players` : null,
    item.playtimeMin ? `${item.playtimeMin} min` : null,
    item.weight ? `weight ${item.weight}` : null,
  ].filter((part): part is string => Boolean(part));

  if (!publisher && rest.length === 0) {
    return <p className="subtitle">No details recorded</p>;
  }

  return (
    <p className="subtitle">
      {publisher}
      {publisher && from && (
        <span className="inherited-from">
          {' '}
          from <Link to={`/items/${from.fromItemId}`}>{from.fromName}</Link>
        </span>
      )}
      {publisher && rest.length > 0 && ' · '}
      {rest.join(' · ')}
    </p>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState title="No such page">
      <p className="muted">
        <Link to="/">Back to the collection</Link>
      </p>
    </EmptyState>
  );
}

/**
 * The details a name lookup can supply, in the order they get reported back.
 *
 * The keys are deliberately shared with `BarcodeCandidate`: a candidate and an
 * item name these fields identically, which is what lets one loop do the work
 * of seven near-identical assignments.
 */
type FillableKey =
  | 'publisher'
  | 'yearPublished'
  | 'minPlayers'
  | 'maxPlayers'
  | 'playtimeMin'
  | 'description'
  | 'thumbnailUrl';

const FILLABLE: { key: FillableKey; label: string }[] = [
  { key: 'publisher', label: 'publisher' },
  { key: 'yearPublished', label: 'year' },
  { key: 'minPlayers', label: 'min players' },
  { key: 'maxPlayers', label: 'max players' },
  { key: 'playtimeMin', label: 'play time' },
  { key: 'description', label: 'description' },
  { key: 'thumbnailUrl', label: 'cover image' },
];

/**
 * The same list, minus anything this row cannot have.
 *
 * `fillableFieldsFor` is the policy, shared with the paid lookup and the queue,
 * so this button and that one cannot come to different conclusions about whether
 * a playmat wants a description. `thumbnailUrl` is not in the policy and is
 * always offered: a photograph of the thing is exactly what the owner said stood
 * in for the words.
 */
function fillableFor(item: ItemDetail): { key: FillableKey; label: string }[] {
  const allowed: readonly string[] = fillableFieldsFor(item.kind, item.gameSystem, item.publisher);
  return FILLABLE.filter(({ key }) => key === 'thumbnailUrl' || allowed.includes(key));
}

const isBlank = (v: string | number | null): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '');

/** "publisher, year and cover image" — a sentence, not a list of columns. */
function inWords(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Between polls while a web lookup runs. Matches the details queue's. */
const RUN_POLL_MS = 2500;
/** Give up *watching* after two minutes. The run itself is unaffected. */
const RUN_POLL_TRIES = 48;

/**
 * Wait for one background lookup to land, or give up watching it.
 *
 * Returns null on giving up rather than throwing, and the distinction matters:
 * the run has not failed, this page has merely stopped watching. Saying "it
 * failed" would be a lie about work still in progress and would invite paying
 * for it a second time.
 */
async function waitForDetailsRun(itemId: number, runId: number): Promise<DetailsRun | null> {
  for (let i = 0; i < RUN_POLL_TRIES; i++) {
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
    try {
      const { runs } = await api.detailsRuns();
      const run = runs.find((r) => r.itemId === itemId && r.id === runId);
      if (run && run.status !== 'queued' && run.status !== 'running') return run;
    } catch {
      // A dropped poll is not an outcome; try again.
    }
  }
  return null;
}

/**
 * Fill in what nobody has got round to typing.
 *
 * The rule that makes this safe to offer at all: it only ever writes into
 * fields that are empty. A human who recorded a publisher knows something the
 * lookup does not — that the box on our shelf is the Spanish printing, say —
 * and a free API is in no position to correct them.
 *
 * Only shown while something is actually missing, so a fully-recorded game
 * carries no invitation to re-fetch what it already knows.
 *
 * **Missing and expected are two different things.** A dice tray is not asked
 * for a player count, so announcing that it has none would be scolding a record
 * for being exactly what it should be. `detailGaps` decides what is expected —
 * the same function the details queue is built from — and anything else that
 * happens to be blank is offered rather than demanded. The buttons stay either
 * way: this is the only per-item way in, and an expansion big enough to want a
 * description of its own should not have to be researched from the queue.
 */
function LookupDetails({
  item,
  onFilled,
  canResearch,
}: {
  item: ItemDetail;
  onFilled: (summary: string) => void;
  /** The web search costs money, so it is owner-only like the other paid calls. */
  canResearch: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // What a lookup could write into. A field answered by the game upstairs is
  // excluded: without that, every playmat in the catalog would offer to fill in
  // a publisher directly under a subtitle already displaying one. A field this
  // kind of row cannot have is excluded too — a dice tray is not a dice game,
  // however confidently a name search says otherwise.
  const missing = fillableFor(item).filter(
    ({ key }) => isBlank(item[key]) && !(key in item.inherited),
  );

  // What this row is asked for and does not have — the queue's own test, so the
  // page and the queue can never disagree about whether a record is finished.
  // Empty for everything filed under a game.
  const gaps = detailGaps(item).map((field) => DETAIL_FIELD_LABEL[field]);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { candidates } = await api.lookup(item.name);
      const best = candidates[0];

      if (!best) {
        setNote(
          `No match for “${item.name}”. Photographing the box reads more off it than a name search can.`,
        );
        return;
      }
      if (!isTrustedMatch(best.name, item.name)) {
        setNote(
          `The closest thing found was “${best.name}”, which is different enough that nothing was changed.`,
        );
        return;
      }

      // TypeScript cannot see through the key union to prove this write sound,
      // so the claim is made once, here, rather than seven times below.
      const patch: Partial<Record<FillableKey, string | number>> = {};
      const filled: string[] = [];
      for (const { key, label } of missing) {
        const value = best[key];
        if (value == null || value === '') continue;
        patch[key] = value;
        filled.push(label);
      }

      if (filled.length === 0) {
        setNote(`“${best.name}” was found, but it knew nothing we were missing.`);
        return;
      }

      await api.updateItem(item.id, patch as UpdateItemInput);
      onFilled(`Filled in ${inWords(filled)} from “${best.name}”.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The paid fallback: Claude, with the open web.
   *
   * Offered separately rather than as an automatic second attempt, because it
   * costs a few cents and the free lookup is right often enough that spending
   * on every blank field would be silly. It is also the only thing that finds a
   * publisher — the free sources carry none at all, which is why a scanned
   * collection has an empty publisher on every game.
   *
   * The lookup itself runs on the server, so this waits on a run rather than on
   * a request. Leaving the page mid-wait no longer throws the answer away — the
   * run finishes, the item is filled in, and reopening it shows the result.
   */
  async function runWeb() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { run } = await api.startItemDetails(item.id);
      setNote(
        'Searching the web. This takes up to a minute — you can leave this page, it carries on.',
      );

      const finished = await waitForDetailsRun(item.id, run.id);
      if (!finished) {
        setNote('Still searching. It carries on without this page — look again shortly.');
        return;
      }
      if (finished.status === 'error') {
        setNote(finished.errorMessage ?? 'The lookup failed.');
        return;
      }
      if (finished.filled.length === 0) {
        setNote(finished.detail ?? 'Nothing new was found on the web either.');
        return;
      }
      onFilled(`Filled in ${inWords(finished.filled)} from the web.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (missing.length === 0 && gaps.length === 0) return null;

  return (
    <section className="card lookup-fill">
      <div className="lookup-fill__row">
        <div className="grow">
          {gaps.length > 0 ? (
            <>
              <strong>No {inWords(gaps)} recorded</strong>
              <p className="muted small">
                Only blanks are filled — anything already written down stays as it is.
                The free lookup uses the same sources as the scanner; searching the web
                costs a few cents and is the only thing that finds a publisher.
              </p>
            </>
          ) : (
            <>
              <strong>Nothing more is expected of this one</strong>
              <p className="muted small">
                Anything filed under a game takes that game&rsquo;s publisher, and is not
                asked for a year, a player count or a description of its own. Look it up
                anyway if you want the extra detail — only blanks are filled.
              </p>
            </>
          )}
        </div>
        <div className="lookup-fill__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
            {busy ? 'Looking…' : 'Free lookup'}
          </button>
          {canResearch && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => void runWeb()}
            >
              Search the web
            </button>
          )}
        </div>
      </div>

      {note && <p className="scan-note">{note}</p>}
      {error != null && <ErrorBox error={error} what="Could not look that up" />}
    </section>
  );
}

/**
 * Removing links, on the edit screen.
 *
 * Only links this game actually holds can be removed. A family member reached
 * through another game — Starfarers and New Energies are both Catans, without a
 * row between them — has no link of its own to break, and is shown greyed with
 * the reason rather than silently omitted, so the list matches what the game
 * page displays.
 */
function LinkEditor({
  itemId,
  related,
  onChanged,
}: {
  itemId: number;
  related: RelatedItemRef[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (related.length === 0) return null;

  async function unlink(relationId: number) {
    setBusy(relationId);
    setError(null);
    try {
      await api.removeRelation(relationId);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>Linked games</h2>
      {/* Trimmed 2026-08-17 (owner's estate-wide order). Where links are ADDED
          is discoverable by going there; where they come OFF is not, which is
          why that is the half that stayed. */}
      <p className="muted small">This is where links come off.</p>

      {error != null && <ErrorBox error={error} what="Could not unlink" />}

      <ul className="child-list">
        {related.map((rel) => (
          <li key={rel.itemId}>
            <Link to={`/items/${rel.itemId}`} className="child-link">
              <span className="child-name">{rel.name}</span>
              <Badge tone="kind">{relationLabel(rel)}</Badge>
            </Link>
            {rel.relationId === null ? (
              <span className="muted small">via the family</span>
            ) : (
              <ConfirmButton
                confirmLabel={busy === rel.relationId ? 'Unlinking…' : 'Really unlink?'}
                onConfirm={() => void unlink(rel.relationId!)}
              >
                Unlink
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The label as read from *this* item's end.
 *
 * Only `requires` differs by direction, and getting it wrong is not a wording
 * nit — "Requires" on the core book's page is a false statement about what the
 * collection contains.
 */
function relationLabel(rel: RelatedItemRef): string {
  if (rel.relation === 'requires' && !rel.outgoing) return 'Needed by';
  return RELATION_LABEL[rel.relation];
}

/**
 * Standalone games that belong together — Dice Throne characters, Unmatched
 * fighters, standalone expansions that combine with a family. Each keeps its own
 * top-level entry in the collection; the link shows the connection without
 * nesting.
 *
 * The form that used to live here has moved into `AddRelatedPanel`, which the
 * expansions section opens too. It kept its own copy of the "link or nest"
 * dropdown and its own picker, and the owner's complaint was exactly that: two
 * menus asking one question in two vocabularies, neither of which could act on
 * the suggestions the other one showed. What is left here is the list.
 */
function RelatedGames({
  item,
  canEdit,
  adding,
  onAdd,
  onCancel,
  onSaved,
}: {
  item: ItemDetail;
  canEdit: boolean;
  /** Owned by the page, so opening this closes the expansions panel. */
  adding: boolean;
  onAdd: () => void;
  onCancel: () => void;
  onSaved: (note: string) => void;
}) {
  // `requires` is not shown here: it is a hard dependency, not a family
  // resemblance, and it already reads as a sentence at the top of the page.
  // Listing it in both places would say the same thing twice and, worse, would
  // say it without its direction.
  const linked = item.relatedItems.filter((r) => r.relation !== 'requires');

  // Don't show the section if there are no relations and the user can't edit.
  if (linked.length === 0 && !canEdit) return null;

  return (
    <section className="card">
      <div className="section-head">
        <h2>
          Related games
          {linked.length > 0 && <span className="count"> {linked.length}</span>}
        </h2>
        {canEdit && !adding && (
          <button type="button" className="btn btn-quiet" onClick={onAdd}>
            + Link
          </button>
        )}
      </div>

      {adding && (
        <AddRelatedPanel item={item} mode="link" onSaved={onSaved} onCancel={onCancel} />
      )}

      {linked.length === 0 && !adding ? (
        <p className="muted">
          No linked games
          {canEdit
            ? ' — link standalone games that play together, or file this one under the game it belongs to.'
            : '.'}
        </p>
      ) : (
        /* No unlink button here on purpose. Easy to add, hard to break: a
           stray tap on a × beside a game you were about to open should not
           quietly sever a link, and half of these rows are family by
           implication anyway and have no single row to remove. Unlinking lives
           on the edit form, where you have already said you are editing. */
        <ul className="child-list">
          {linked.map((rel) => (
            <li key={rel.itemId}>
              <Link to={`/items/${rel.itemId}`} className="child-link">
                {/* Lazy, and this is the list that made it necessary. A Dice
                    Throne hero's family runs to 55 rows, and the hero art is
                    served full-size from the publisher's own origin at 0.6–1.4
                    MB a PNG — about 8 MB of thumbnails on one page, over mobile
                    data. The URLs are deliberately not proxied; see the covers
                    section of the handoff. Same attribute ItemTree uses. */}
                {rel.thumbnailUrl && (
                  <img className="thumb thumb-sm" src={rel.thumbnailUrl} alt="" loading="lazy" />
                )}
                <span className="child-name">{rel.name}</span>
                <Badge tone="kind">{relationLabel(rel)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What this cannot be used without, and what cannot be used without it.
 *
 * A plain statement rather than a badge, because it is a fact about whether the
 * thing is usable at all: Auroboros is unplayable without the Player's Handbook,
 * and a page that says nothing about that is hiding the most important thing it
 * knows.
 *
 * **The direction is the whole point.** `requires` is stored from the supplement
 * to the core book, and `outgoing` says which end you are standing at. Rendering
 * both ends with one sentence would have the Player's Handbook — which eight
 * things depend on — announcing that it requires all eight of them. So the two
 * directions get two different sentences, and the incoming one deliberately does
 * not use the word "requires" at all.
 */
function Dependencies({ related }: { related: RelatedItemRef[] }) {
  const requires = related.filter((r) => r.relation === 'requires' && r.outgoing);
  const neededBy = related.filter((r) => r.relation === 'requires' && !r.outgoing);
  if (requires.length === 0 && neededBy.length === 0) return null;

  const list = (refs: RelatedItemRef[]) =>
    refs.map((r, i) => (
      <span key={r.itemId}>
        {i > 0 && ', '}
        <Link to={`/items/${r.itemId}`}>{r.name}</Link>
      </span>
    ));

  return (
    <p className="requires">
      {requires.length > 0 && (
        <span className="requires__line">
          <strong>Requires:</strong> {list(requires)}
        </span>
      )}
      {neededBy.length > 0 && (
        <span className="requires__line muted">
          Needed by {neededBy.length === 1 ? '' : `${neededBy.length} things: `}
          {list(neededBy)}
        </span>
      )}
    </p>
  );
}

/** "Kickstarter", "Gamefound", or just "Campaign" for anywhere else. */
function campaignLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('kickstarter.com')) return 'Kickstarter';
    if (host.endsWith('gamefound.com')) return 'Gamefound';
    if (host.endsWith('backerkit.com')) return 'BackerKit';
    return 'Campaign';
  } catch {
    return 'Campaign';
  }
}

/**
 * Where to read more about this game.
 *
 * BoardGameGeek is derived, not stored: a `bggId` is all you need, and building
 * the URL means a scanned game links out the moment it resolves, with no extra
 * column and nothing to keep in sync. `rel="noreferrer"` on both because there
 * is no reason to leak where the click came from.
 */
function ExternalLinks({ item }: { item: ItemDetail }) {
  const links: { href: string; label: string; title?: string }[] = [];
  const { publisherUrl, from } = resolvePublisher(item);

  if (item.bggId != null) {
    links.push({
      href: `https://boardgamegeek.com/boardgame/${item.bggId}`,
      label: 'BoardGameGeek',
    });
  }
  if (publisherUrl) {
    // Titled, not relabelled: it is still the publisher's site, and a link that
    // read "Publisher (from Dice Throne Vanguard)" would say in the busiest row
    // on the page what the subtitle already says one line above.
    links.push({
      href: publisherUrl,
      label: 'Publisher',
      ...(isBlank(item.publisherUrl) && from ? { title: `From ${from.fromName}` } : {}),
    });
  }
  /*
    Where this pledge came from, which is not where the publisher lives — an
    item can have both, and for two thirds of this catalog the campaign page is
    the only authoritative record the box ever had. Named after the host so the
    two links cannot be confused for each other at a glance.
  */
  if (item.sourceUrl) {
    links.push({ href: item.sourceUrl, label: campaignLabel(item.sourceUrl) });
  }

  if (links.length === 0) return null;

  return (
    <p className="external-links">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener" title={l.title}>
          {l.label} ↗
        </a>
      ))}
    </p>
  );
}
