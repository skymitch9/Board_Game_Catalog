import { useState } from 'react';
import {
  ITEM_KINDS,
  RELATION_TYPES,
  foldSearchText,
  type ComponentStatus,
  type Item,
  type ItemDetail,
  type ItemKind,
  type ItemNode,
  type RelationType,
} from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link } from '../router';
import { ItemPicker, forgetItemNames, type OfferedItem, type PickedItem } from './ItemPicker';
import { KIND_LABEL } from './ItemTree';
import { ConfirmButton, ErrorBox } from './ui';

export const RELATION_LABEL: Record<RelationType, string> = {
  same_family: 'Same family',
  works_with: 'Works with',
  reimplements: 'Reimplements',
  integrates_with: 'Integrates with',
  requires: 'Requires',
};

/** Anything with a parent is by definition not a base game. */
const CHILD_KINDS = ITEM_KINDS.filter((k) => k !== 'base');

/**
 * What the dropdown is asking, in one value.
 *
 * `nest:expansion` writes `parent_item_id` and moves a row into this game's
 * tree; a bare relation writes an `item_relation` row and moves nothing. They
 * share one control because the owner asked them to — *"combine the related
 * menu and expansion menu so you can just select expansion as an option"* —
 * and because to the person typing they answer one question: what is this
 * thing's connection to the game I am looking at.
 */
type Action = `nest:${ItemKind}` | RelationType;

const isNest = (a: Action): a is `nest:${ItemKind}` => a.startsWith('nest:');
const nestKind = (a: Action): ItemKind => a.slice('nest:'.length) as ItemKind;

/**
 * Where a chosen thing came from. `typed` is the fourth: a name that answers to
 * nothing in any list, which is the ordinary state of an expansion nobody has
 * catalogued and BoardGameGeek has never heard of.
 */
type ChosenSource = 'catalog' | 'component' | 'lookup' | 'typed';

/** The thing the panel is about to do something with, whatever named it. */
interface Chosen {
  name: string;
  source: ChosenSource;
  /** Known only when the catalog itself supplied it, or a component matched. */
  itemId: number | null;
  bggId: number | null;
  yearPublished: number | null;
  publisher: string | null;
  thumbnailUrl: string | null;
}

/**
 * What the catalog already knows about the chosen thing — the four answers.
 *
 * This is the point of the whole panel. Clicking a suggestion for something
 * already owned used to create a second row for it silently; that is how the
 * catalog ended up holding both *Catan* and *The Settlers of Catan*, and it
 * cost a morning to unpick. So nothing is written until this has been asked.
 */
type Resolution =
  | { state: 'new' }
  | { state: 'here'; row: Item }
  | { state: 'root'; row: Item }
  | { state: 'elsewhere'; row: Item; parentName: string };

/**
 * Find the catalog row a name refers to, using the collection search.
 *
 * **Deliberately not a new matching rule.** The search folds apostrophes and
 * dashes on both sides and reads `item_alias`, so it already answers "is
 * *Player's Handbook* the same thing as *Player’s Handbook*" — and it is the
 * only matcher in the app that has been measured against the real catalog. What
 * is added here is the last step it cannot take: the search returns whole game
 * *trees*, and this picks the row inside one whose name is the name asked for,
 * compared with `foldSearchText`, the same fold the SQL uses.
 *
 * Only the first page of results is walked. Every search term has to match
 * somewhere in a tree, so a full title narrows the collection to a handful of
 * trees long before paging can hide one; a bare word would not, and a bare word
 * is not what gets passed here.
 */
async function findByName(
  name: string,
): Promise<{ row: Item; parentName: string | null } | null> {
  const wanted = foldSearchText(name).trim();
  if (wanted === '') return null;

  const page = await api.items({ q: name });
  const hits: { row: ItemNode; parentName: string | null }[] = [];

  const walk = (node: ItemNode, parentName: string | null) => {
    if (foldSearchText(node.name).trim() === wanted) hits.push({ row: node, parentName });
    for (const child of node.children) walk(child, node.name);
  };
  for (const entry of page.entries) {
    // Searching never groups — see `shouldGroup` in packages/db — so every
    // entry here is a tree. The check is a type guard, not a doubt.
    if (entry.kind === 'tree') walk(entry.tree, null);
  }

  return hits[0] ?? null;
}

async function resolve(chosen: Chosen, parentId: number): Promise<Resolution> {
  let row: Item | null = null;
  let parentName: string | null = null;

  if (chosen.itemId != null) {
    // A component match by BoardGameGeek id, or a row picked from the catalog
    // itself. Both already know which row they mean, and re-deriving it from
    // the name would be a weaker answer than the one in hand.
    const detail = await api.item(chosen.itemId).then((r) => r.item);
    row = detail;
    parentName = detail.parent?.name ?? null;
  } else {
    const found = await findByName(chosen.name);
    if (found) {
      row = found.row;
      parentName = found.parentName;
    }
  }

  if (!row) return { state: 'new' };
  if (row.parentItemId === parentId) return { state: 'here', row };
  if (row.parentItemId == null) return { state: 'root', row };
  return { state: 'elsewhere', row, parentName: parentName ?? `item ${row.parentItemId}` };
}

/** Everything the picker can offer beyond the catalog, and why it is thin. */
interface Offers {
  items: OfferedItem[];
  /** Said out loud when BoardGameGeek contributed nothing, rather than hidden. */
  componentNote: string | null;
}

function componentToOffer(c: ComponentStatus): OfferedItem {
  return {
    key: `component:${c.id}`,
    name: c.name,
    kind: c.kind,
    source: 'component',
    bggId: c.bggId,
    yearPublished: c.yearPublished,
    publisher: c.publishers?.[0]?.name ?? null,
    thumbnailUrl: c.thumbnailUrl,
    matchedItemId: c.matchedItemId,
  };
}

/**
 * What BoardGameGeek says exists for this game, and nothing it does not.
 *
 * Reads the cached `game_component` rows through the completeness report — no
 * BoardGameGeek call is made from here, for the same reason the report itself
 * never makes one.
 *
 * ⚠️ **`game_component` is empty catalog-wide today**, so this is usually the
 * silent half of the list. Every reason it can be empty gets its own sentence:
 * a picker that simply showed nothing would be indistinguishable from a game
 * that genuinely has no expansions, which is the misreading this feature exists
 * to prevent everywhere else.
 *
 * Third-party components — inserts, sleeves, upgrade kits by other publishers —
 * are left out, and so are promos and collectibles. Both are long tails that
 * would bury the official list, and "What else exists" already shows each
 * behind its own disclosure. Neither is filtered here: reading `outstanding`
 * gets both exclusions for free, which is the point of the report being the one
 * place that decides what counts.
 */
async function loadComponents(itemId: number): Promise<Offers> {
  let report;
  try {
    report = await api.completeness(itemId);
  } catch {
    return { items: [], componentNote: 'BoardGameGeek’s list could not be read just now.' };
  }

  if (report.state === 'not_on_bgg') {
    return {
      items: [],
      componentNote:
        'This game has no BoardGameGeek id, so there is no official list of what exists for it.',
    };
  }
  if (report.state === 'never_checked') {
    return {
      items: [],
      componentNote:
        'BoardGameGeek has not been asked what exists for this game yet — “What else exists” on the base game’s page has a Check now button.',
    };
  }
  if (report.state === 'not_found') {
    return {
      items: [],
      componentNote: `BoardGameGeek returned nothing for id ${report.bggId}, so there is no list to offer.`,
    };
  }

  const outstanding = [...report.expansions.outstanding, ...report.accessories.outstanding];
  if (outstanding.length === 0) {
    return {
      items: [],
      componentNote:
        'BoardGameGeek lists nothing official and buyable for this game that you do not already have — promos and third-party items are on the game’s page, under “What else exists”.',
    };
  }
  return { items: outstanding.map(componentToOffer), componentNote: null };
}

/**
 * The free title search, offered as guesses and labelled as guesses.
 *
 * These are the same rungs the scanner uses, and on a single shared word they
 * are confidently wrong — a textbook's ISBN once came back as *Labyrinth*. They
 * earn their place because they are the only source that says anything at all
 * about the 806-item majority with no component rows, and they cost nothing;
 * they earn their label for the same reason the item page writes "publisher,
 * from Dice Throne Vanguard" rather than printing a borrowed fact plain.
 *
 * The game's own name is dropped from the results: searching "Here to Slay"
 * returns *Here to Slay* first, and offering to file a game under itself is not
 * a suggestion.
 */
async function loadGuesses(name: string): Promise<OfferedItem[]> {
  let candidates;
  try {
    ({ candidates } = await api.lookup(name));
  } catch {
    return [];
  }
  const own = foldSearchText(name).trim();
  return candidates
    .filter((c) => foldSearchText(c.name).trim() !== own)
    .map((c, i) => ({
      key: `lookup:${i}:${c.name}`,
      name: c.name,
      kind: c.kind,
      source: 'lookup' as const,
      bggId: c.bggId,
      yearPublished: c.yearPublished,
      publisher: c.publisher,
      thumbnailUrl: c.thumbnailUrl,
    }));
}

async function loadOffers(item: ItemDetail): Promise<Offers> {
  const [components, guesses] = await Promise.all([
    loadComponents(item.id),
    loadGuesses(item.name),
  ]);
  return { items: [...components.items, ...guesses], componentNote: components.componentNote };
}

/**
 * One way to attach one thing to another, reached from two buttons.
 *
 * *"The nested menu is a bit confusing to figure out, as is the add expansion.
 * The add expansion suggests expansions but you can't click them to add… We
 * should also combine the related menu and expansion menu so you can just
 * select expansion as an option."* — the owner.
 *
 * It replaces three surfaces that overlapped: a link out to a blank form, a
 * suggestion list whose clicks only refilled the form you were already standing
 * on, and a second dropdown pair on the related-games section. `mode` decides
 * only which row of the dropdown starts selected — the panel is the same one
 * either way, so there is nothing to learn twice.
 *
 * ⚠️ **Filing *this* item under another game is no longer offered here**, and
 * that is a removal rather than an oversight. It was the `Files under` half of
 * the old dropdown, and it is the same act as nesting seen from the other end:
 * open the game it belongs to, type this one's name, and the "already in the
 * catalog as a game of its own" outcome files it with no new row. `RetagPage`
 * still proposes those moves in bulk. Keeping both directions here would have
 * meant a second dropdown appearing conditionally, which is precisely the
 * confusion this was opened to remove.
 */
export function AddRelatedPanel({
  item,
  mode,
  onSaved,
  onCancel,
}: {
  item: ItemDetail;
  /** Which half of the dropdown starts selected. Nothing else differs. */
  mode: 'nest' | 'link';
  /** The report of what changed, which has to outlive the reload that proves it. */
  onSaved: (note: string) => void;
  onCancel: () => void;
}) {
  const [offers] = useAsync(() => loadOffers(item), [item.id]);
  const [action, setAction] = useState<Action>(mode === 'nest' ? 'nest:expansion' : 'works_with');
  /** The picker's own chip, which only a catalog row can fill. */
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The raw text, so a name in no list can still be the thing you meant. */
  const [typed, setTyped] = useState('');
  /** Only offered for a brand-new row — an existing one already has its copies. */
  const [markOwned, setMarkOwned] = useState(true);

  const offered = offers.state === 'ok' ? offers.data.items : [];
  const componentNote = offers.state === 'ok' ? offers.data.componentNote : null;

  /** Choosing is what triggers the catalog check; nothing else does. */
  function pick(next: Chosen | null) {
    setChosen(next);
    setResolution(null);
    setError(null);
    if (!next) return;
    setResolving(true);
    resolve(next, item.id)
      .then(setResolution)
      .catch(setError)
      .finally(() => setResolving(false));
  }

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const note = await work();
      // Every path through here has changed the catalog, so the picker's cached
      // name list is now out of date by exactly the row this panel just touched.
      forgetItemNames();
      onSaved(note);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /** Nothing here yet: create it, under this game or beside it. */
  const createNew = (c: Chosen) =>
    run(async () => {
      const nesting = isNest(action);
      // `createItemSchema` refuses a non-base row with neither a parent nor a
      // name to wait for. Nesting always has a real parent, and a link always
      // creates a base game, so both halves satisfy it — and neither ever sends
      // a base game *with* a parent, which the item guard now rejects outright.
      const { item: created } = await api.createItem({
        name: c.name,
        kind: nesting ? nestKind(action) : 'base',
        parentItemId: nesting ? item.id : null,
        bggId: c.bggId,
        yearPublished: c.yearPublished,
        publisher: c.publisher,
        thumbnailUrl: c.thumbnailUrl,
      });
      if (markOwned) {
        await api.createCopy(created.id, {
          status: 'owned',
          quantity: 1,
          format: 'physical',
          isSleeved: false,
          isPunched: false,
        });
      }
      if (!nesting) {
        await api.addRelation(item.id, { toItemId: created.id, relation: action });
      }
      return nesting
        ? `Added “${created.name}” as ${aOrAn(nestKind(action))} of ${item.name}.`
        : `Added “${created.name}” and linked it — ${RELATION_LABEL[action].toLowerCase()}.`;
    });

  /** It exists already: move the row rather than making a second one. */
  const nestExisting = (row: Item, from: string | null) =>
    run(async () => {
      await api.updateItem(row.id, { kind: nestKind(action), parentItemId: item.id });
      return from
        ? `Moved “${row.name}” out of ${from} and filed it under ${item.name}.`
        : `Filed “${row.name}” under ${item.name}. Nothing new was created.`;
    });

  const linkExisting = (row: Item) =>
    run(async () => {
      await api.addRelation(item.id, { toItemId: row.id, relation: action as RelationType });
      return `Linked “${row.name}” — ${RELATION_LABEL[action as RelationType].toLowerCase()}.`;
    });

  /** The catalog row the outcome is about, or null when there isn't one yet. */
  const row = resolution && resolution.state !== 'new' ? resolution.row : null;
  const alreadyLinked = row
    ? (item.relatedItems.find((r) => r.itemId === row.id) ?? null)
    : null;

  return (
    <form className="relation-add add-related" onSubmit={(e) => e.preventDefault()}>
      <div className="relation-add__row">
        <ItemPicker
          value={picked}
          onPick={(p) => {
            setPicked(p);
            pick(
              p
                ? {
                    name: p.name,
                    source: 'catalog',
                    itemId: p.id,
                    bggId: null,
                    yearPublished: null,
                    publisher: null,
                    thumbnailUrl: null,
                  }
                : null,
            );
          }}
          onPickOffered={(o) =>
            pick(
              o
                ? {
                    name: o.name,
                    source: o.source,
                    // A component matched by BoardGameGeek id already knows
                    // which row it is; that beats anything a name can prove.
                    itemId: o.matchedItemId ?? null,
                    bggId: o.bggId ?? null,
                    yearPublished: o.yearPublished ?? null,
                    publisher: o.publisher ?? null,
                    thumbnailUrl: o.thumbnailUrl ?? null,
                  }
                : null,
            )
          }
          offered={offered}
          offerWhenEmpty
          onQueryChange={setTyped}
          excludeId={item.id}
          placeholder={
            offers.state === 'loading'
              ? 'Looking up what exists…'
              : 'Which one? Click here for suggestions, or type a name'
          }
          autoFocus
          emptyHint={
            <>
              Nothing known answers to that.
              <button
                type="button"
                className="btn btn-quiet btn-inline"
                onClick={() => {
                  setPicked(null);
                  pick({
                    name: typed.trim(),
                    source: 'typed',
                    itemId: null,
                    bggId: null,
                    yearPublished: null,
                    publisher: null,
                    thumbnailUrl: null,
                  });
                }}
              >
                Use “{typed.trim()}” anyway
              </button>
            </>
          }
        />

        <select
          className="relation-add__what"
          value={action}
          onChange={(e) => setAction(e.target.value as Action)}
          aria-label="How it is connected"
        >
          {/* Grouped because the two halves do genuinely different things, and a
              flat list of nine options would hide that half of them take a game
              off the collection's top level. */}
          <optgroup label="Nest — it becomes part of this game">
            {CHILD_KINDS.map((k) => (
              <option key={k} value={`nest:${k}`}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Link — both stay separate games">
            {RELATION_TYPES.map((r) => (
              <option key={r} value={r}>
                {r === 'requires' ? 'Requires — this needs it' : RELATION_LABEL[r]}
              </option>
            ))}
          </optgroup>
        </select>

        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      {/* Said even when it is bad news. An empty suggestion list and a game with
          no expansions look identical, and only one of them is true. */}
      {componentNote && <p className="muted small add-related__source">{componentNote}</p>}

      {error != null && <ErrorBox error={error} what="Could not do that" />}

      {resolving && <p className="muted small">Checking the catalog…</p>}

      {chosen && resolution && (
        <Outcome
          chosen={chosen}
          resolution={resolution}
          action={action}
          gameName={item.name}
          alreadyLinkedAs={alreadyLinked ? RELATION_LABEL[alreadyLinked.relation] : null}
          busy={busy}
          markOwned={markOwned}
          onMarkOwned={setMarkOwned}
          onCreate={() => void createNew(chosen)}
          onNest={(from) => row && void nestExisting(row, from)}
          onLink={() => row && void linkExisting(row)}
        />
      )}
    </form>
  );
}

/** "an accessory" / "a promo" — a sentence, not a field value. */
function aOrAn(kind: ItemKind): string {
  const word = KIND_LABEL[kind].toLowerCase();
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

/**
 * What is about to happen, said before it happens.
 *
 * Each of the four catalog answers gets its own sentence and its own button,
 * because they are four different acts wearing one gesture: creating a row,
 * doing nothing, moving an existing row in, and taking a row away from another
 * game. Only the last is destructive, and only the last asks twice.
 */
function Outcome({
  chosen,
  resolution,
  action,
  gameName,
  alreadyLinkedAs,
  busy,
  markOwned,
  onMarkOwned,
  onCreate,
  onNest,
  onLink,
}: {
  chosen: Chosen;
  resolution: Resolution;
  action: Action;
  gameName: string;
  alreadyLinkedAs: string | null;
  busy: boolean;
  markOwned: boolean;
  onMarkOwned: (next: boolean) => void;
  onCreate: () => void;
  onNest: (from: string | null) => void;
  onLink: () => void;
}) {
  const nesting = isNest(action);

  if (resolution.state === 'new') {
    return (
      <div className="add-related__outcome">
        <p className="relation-add__note muted small">
          <strong>“{chosen.name}”</strong> is not in the catalog
          {chosen.source === 'lookup' && ' — and this name came from a title search, so check it reads right before adding it'}
          .{' '}
          {nesting ? (
            <>
              It will be created as {aOrAn(nestKind(action))} of <strong>{gameName}</strong>.
            </>
          ) : (
            <>
              It will be created as a game of its own and linked to{' '}
              <strong>{gameName}</strong>.
            </>
          )}
        </p>
        <label className="add-related__owned">
          <input
            type="checkbox"
            checked={markOwned}
            onChange={(e) => onMarkOwned(e.target.checked)}
          />
          <span>We have it — record a copy as owned</span>
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onCreate}>
          {busy ? 'Adding…' : nesting ? 'Add it' : 'Add and link'}
        </button>
      </div>
    );
  }

  const row = resolution.row;
  const link = <Link to={`/items/${row.id}`}>{row.name}</Link>;

  // Linking is answered first, because where a row sits in the tree does not
  // change what a sideways link does — it is the same act for all three of the
  // remaining catalog answers, and only the wording differs.
  if (!nesting) {
    return (
      <div className="add-related__outcome">
        <p className="relation-add__note muted small">
          {link} is already in the catalog
          {resolution.state === 'here' && <> — and already filed inside <strong>{gameName}</strong>, so a sideways link would say the same thing twice</>}
          {resolution.state === 'elsewhere' && <> under <strong>{resolution.parentName}</strong></>}
          .{' '}
          {alreadyLinkedAs
            ? `It is already linked — ${alreadyLinkedAs.toLowerCase()}.`
            : 'Both stay where they are; only the link is added.'}
        </p>
        {!alreadyLinkedAs && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onLink}>
            {busy ? 'Linking…' : 'Link them'}
          </button>
        )}
      </div>
    );
  }

  // Not an error, and deliberately not styled as one. Clicking a suggestion for
  // something you have already filed here is a reasonable thing to do, and being
  // told off for it is how a person learns to distrust the panel.
  if (resolution.state === 'here') {
    return (
      <div className="add-related__outcome">
        {/* A div around it, not the class on the paragraph itself: the outcome
            box is a flex column, and a flex parent puts every inline child of a
            sentence — the link, the game's name — on a line of its own. */}
        <p className="relation-add__note muted small">
          {link} is already filed under <strong>{gameName}</strong> as{' '}
          {KIND_LABEL[row.kind].toLowerCase()}. Nothing to do.
        </p>
      </div>
    );
  }

  if (resolution.state === 'root') {
    return (
      <div className="add-related__outcome">
        <p className="relation-add__note muted small">
          {link} is already in the catalog as a game of its own.{' '}
          <strong>No new row is created</strong> — the existing one moves in and becomes{' '}
          {aOrAn(nestKind(action))} of <strong>{gameName}</strong>.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onNest(null)}
        >
          {busy ? 'Filing…' : `File it under ${gameName}`}
        </button>
      </div>
    );
  }

  /*
    The one path that takes something away from somewhere else.

    Unlinking was deliberately kept off this section so that a stray tap could
    not sever a connection; moving a row between parents is more destructive
    than that, because it changes what two different games claim to contain. So
    it asks twice, names the game being emptied in the confirmation, and never
    shares a button position with the harmless outcomes above.
  */
  return (
    <div className="add-related__outcome add-related__outcome--warn">
      <p className="relation-add__note small">
        ⚠️ {link} is already in the catalog, filed under{' '}
        <strong>{resolution.parentName}</strong>. Filing it here <strong>moves</strong> it —{' '}
        {resolution.parentName} stops containing it, and nothing new is created.
      </p>
      <ConfirmButton
        className="btn"
        confirmLabel={busy ? 'Moving…' : `Really move it out of ${resolution.parentName}?`}
        onConfirm={() => onNest(resolution.parentName)}
      >
        Move it here
      </ConfirmButton>
    </div>
  );
}
