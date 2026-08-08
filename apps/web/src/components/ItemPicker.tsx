import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ItemKind } from '@bgc/core';
import { api } from '../api';
import { KIND_LABEL } from './ItemTree';

/** What the picker hands back. The id is the point; the rest is for the label. */
export interface PickedItem {
  id: number;
  name: string;
  kind: ItemKind;
}

/**
 * Where a suggestion came from, and how much it is worth.
 *
 * Three sources of wildly different trustworthiness end up in one list, and
 * they must not look identical on screen. This is the same instinct the item
 * page already has when it prints "publisher, from Dice Throne Vanguard"
 * rather than showing a borrowed fact as a native one.
 *
 * - `catalog` — a row we hold. Certain: it has an id.
 * - `component` — BoardGameGeek's own list of what exists for this game.
 *   Trustworthy, and the only source that knows about a thing nobody has
 *   catalogued yet.
 * - `lookup` — the free title search. **Confidently wrong on a single shared
 *   word**; the handoff records an ISBN coming back as *Labyrinth*. Shown, but
 *   never shown as a fact.
 */
export type SuggestionSource = 'catalog' | 'component' | 'lookup';

/** How each source is named beside its suggestions. */
const SOURCE_LABEL: Record<SuggestionSource, string> = {
  catalog: 'in the catalog',
  component: 'BoardGameGeek',
  lookup: 'guess',
};

/** Certain, then trustworthy, then guessed — used only to break a tie. */
const SOURCE_ORDER: Record<SuggestionSource, number> = {
  catalog: 0,
  component: 1,
  lookup: 2,
};

/**
 * A suggestion the host supplies, from somewhere other than the catalog.
 *
 * It carries no id, because the thing it names may not exist here yet — that is
 * the whole reason for offering it. Everything past `name` rides along so a
 * host that goes on to create the row does not have to look the same facts up
 * a second time.
 */
export interface OfferedItem {
  /** Unique within one call's `offered` list, and the React key. */
  key: string;
  name: string;
  /** For the label only. What a nested row *becomes* is the host's decision. */
  kind: ItemKind;
  source: Exclude<SuggestionSource, 'catalog'>;
  bggId?: number | null;
  yearPublished?: number | null;
  publisher?: string | null;
  thumbnailUrl?: string | null;
  /**
   * The catalog row this suggestion is already known to be, when the source
   * worked it out. `completeness` matches components by BoardGameGeek id, which
   * is a stronger answer than any name comparison, so it is passed on rather
   * than thrown away and rediscovered.
   */
  matchedItemId?: number | null;
}

/**
 * Every item's id, name and kind — fetched once per page load, not per picker.
 *
 * `/api/item-names` is ~41 KB for 640 rows, which is cheap once and silly three
 * times: the edit form and both directions of the related-games section can all
 * be mounted at the same moment. The promise itself is cached rather than its
 * result, so two pickers mounting together share one request instead of racing.
 *
 * Deliberately not invalidated. A picker is open for seconds, and the worst a
 * stale list can do is omit a game added in another tab since the page loaded —
 * reloading fixes it, and paying for a refetch on every keystroke would not.
 */
let namesPromise: Promise<PickedItem[]> | null = null;

function loadNames(): Promise<PickedItem[]> {
  namesPromise ??= api
    .itemNames()
    .then((r) => r.items as PickedItem[])
    .catch((err) => {
      // A failed fetch must not be cached as the answer, or the picker stays
      // empty for the rest of the session with nothing to say about why.
      namesPromise = null;
      throw err;
    });
  return namesPromise;
}

/**
 * Throw the cached list away, because something was just added to the catalog.
 *
 * The comment above says a stale list can only omit a game added *in another
 * tab*, and that reloading fixes it. That stopped being the whole truth when
 * adding became something a picker's own host does: create an expansion from
 * `AddRelatedPanel`, reopen it, and the row you just made was missing from its
 * own suggestions — while the resolve step, which asks the server, knew about
 * it perfectly well. The two disagreeing is worse than either being wrong.
 *
 * Only the promise is cleared. A picker that is already mounted keeps what it
 * has; the next one to mount refetches, and the panel unmounts on save.
 */
export function forgetItemNames(): void {
  namesPromise = null;
}

/** How many suggestions to show. Enough to choose from, short enough to scan. */
const MAX_SUGGESTIONS = 8;

/**
 * How many host suggestions to show before anything is typed.
 *
 * Larger than `MAX_SUGGESTIONS` because this list is the answer to a question
 * nobody typed — *what exists for this game* — and cutting BoardGameGeek's
 * thirteen expansions down to eight would hide five of them behind a search
 * term the owner would have to guess. The list scrolls, so length is cheap.
 */
const MAX_OFFERED = 20;

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One line in the list, whichever of the three sources produced it. */
interface Row {
  key: string;
  name: string;
  kind: ItemKind;
  source: SuggestionSource;
  /** Set for a catalog row, and null for everything else. */
  item: PickedItem | null;
  offered: OfferedItem | null;
}

/**
 * Rank one candidate against the typed terms.
 *
 * Every term must appear, so "dice druid" finds the Druid accessory pack
 * without the whole Dice Throne line coming with it. Beyond that the ordering
 * is deliberately dull: a name that *starts* with what was typed first, then
 * the shorter name. Typing "Wingspan" should offer Wingspan before
 * "Wingspan: Oceania", and no cleverer scoring is needed for 640 rows.
 */
function rank(name: string, terms: string[]): number | null {
  const hay = normalise(name);
  for (const term of terms) {
    if (!hay.includes(term)) return null;
  }
  const joined = terms.join(' ');
  return (hay.startsWith(joined) ? 0 : 1) * 1000 + hay.length;
}

/**
 * Find an item by typing its name.
 *
 * Built because the only way to link one item to another was to type its
 * numeric id, and nobody knows an id — the owner had to go and look one up,
 * which made linking painful enough to avoid entirely. The id still does the
 * work; it just stops being something a person has to hold.
 *
 * **The kind is shown beside every suggestion on purpose.** This catalog has
 * several near-identical names — a hero's box and that hero's accessory pack,
 * two printings of one game — and the kind is usually the only thing on screen
 * that tells them apart at the moment of choosing.
 */
export function ItemPicker({
  value,
  onPick,
  excludeId,
  placeholder = 'Start typing a name…',
  autoFocus,
  disabled,
  /** Narrow the list, e.g. to the things that can hold children. */
  filter,
  onQueryChange,
  emptyHint,
  offered,
  onPickOffered,
  offerWhenEmpty = false,
}: {
  /** The currently chosen item, or null. The input mirrors it. */
  value: PickedItem | null;
  onPick: (item: PickedItem | null) => void;
  /** Never offer this one — an item cannot be linked or filed under itself. */
  excludeId?: number;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  filter?: (item: PickedItem) => boolean;
  /**
   * The raw text, for a host that can do something with a name the catalog does
   * not hold.
   *
   * The picker's own answer to "no match" is to say so and stop, which is right
   * when the only valid outcome is an existing row — linking two items, choosing
   * a parent. The wishlist is the case where it is not: *not in the catalog* is
   * the normal state of a thing you want and have not bought, and the next step
   * is to create it. Reporting the text lets that host offer the step without a
   * second search box beside this one.
   */
  onQueryChange?: (query: string) => void;
  /**
   * What to show instead of "Nothing in the catalog matches that."
   *
   * The default is a dead end stated politely. A host with somewhere to go from
   * there puts the way out here, so the message and the action are one thing
   * rather than a sentence followed by an unexplained button.
   */
  emptyHint?: ReactNode;
  /**
   * Suggestions from outside the catalog, ranked and labelled alongside it.
   *
   * One field rather than a second list beside this one, because the question
   * — *which thing?* — is the same whether the answer is already on the shelf
   * or has never been recorded, and two boxes asking it would put the burden of
   * knowing which one to use on the person typing.
   */
  offered?: OfferedItem[];
  /**
   * Null clears, exactly as `onPick` does. Typing over a chosen suggestion has
   * to unmake it, or the host acts on a name that is no longer on screen.
   */
  onPickOffered?: (offered: OfferedItem | null) => void;
  /**
   * Show `offered` on focus, before a single character is typed.
   *
   * Only ever the host's suggestions — 806 catalog rows are a database, not a
   * list. This is what turns "here are the expansions that exist" from a
   * paragraph into something you can click.
   */
  offerWhenEmpty?: boolean;
}) {
  const [names, setNames] = useState<PickedItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadNames().then(
      (items) => live && setNames(items),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  /**
   * True while the box shows a suggestion that has no catalog row behind it.
   *
   * `value` being null normally means "nothing is chosen", and the effect below
   * blanks the box on it. A suggestion from BoardGameGeek or the title lookup
   * is *also* a null `value` — there is no id to hold — so without this flag,
   * clicking one straight after a catalog pick would empty the box the instant
   * it was filled.
   */
  const offeredRef = useRef(false);

  // A pick made elsewhere — the form being reset, or a parent arriving with the
  // item being edited — has to show up in the box.
  useEffect(() => {
    if (value == null && offeredRef.current) return;
    setQuery(value?.name ?? '');
  }, [value?.id, value?.name]);

  // Reported from one place rather than from each of the four things that
  // change the text — typing, choosing, clearing, and the effect above — so a
  // host can never be told a stale query by a path somebody forgot to update.
  // Through a ref because the callback is usually an inline lambda: in the
  // dependency list it would be a new function every render and this would loop.
  const notifyRef = useRef(onQueryChange);
  notifyRef.current = onQueryChange;
  useEffect(() => {
    notifyRef.current?.(query);
  }, [query]);

  // Clicking away is a dismissal, not a choice. Without this the list stays
  // open over whatever the user actually reached for.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const suggestions = useMemo((): Row[] => {
    if (!names) return [];

    const catalogRows: Row[] = names
      .filter((i) => i.id !== excludeId && (!filter || filter(i)))
      .map((item) => ({
        key: `catalog:${item.id}`,
        name: item.name,
        kind: item.kind,
        source: 'catalog' as const,
        item,
        offered: null,
      }));

    // A suggestion whose name is already a catalog row is that row, and showing
    // both would offer the same thing twice with two different levels of
    // certainty beside it. The catalog wins: it is the one with an id.
    const known = new Set(catalogRows.map((r) => normalise(r.name)));
    const offeredRows: Row[] = (offered ?? [])
      .filter((o) => !known.has(normalise(o.name)))
      .map((o) => ({
        key: o.key,
        name: o.name,
        kind: o.kind,
        source: o.source,
        item: null,
        offered: o,
      }));

    const terms = normalise(query).split(' ').filter(Boolean);
    if (terms.length === 0) {
      return offerWhenEmpty ? offeredRows.slice(0, MAX_OFFERED) : [];
    }

    return [...catalogRows, ...offeredRows]
      .map((row) => ({ row, score: rank(row.name, terms) }))
      .filter((r): r is { row: Row; score: number } => r.score !== null)
      // Source breaks a tie and nothing more. A guess that matches what was
      // typed better than a catalog row still comes first — the label is what
      // says how much it is worth, not the position.
      .sort(
        (a, b) =>
          a.score - b.score ||
          SOURCE_ORDER[a.row.source] - SOURCE_ORDER[b.row.source] ||
          a.row.name.localeCompare(b.row.name),
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((r) => r.row);
  }, [names, query, excludeId, filter, offered, offerWhenEmpty]);

  function choose(row: Row) {
    setQuery(row.name);
    setOpen(false);
    setActive(0);
    // Both callbacks fire on every choice, and **the clear always goes first**.
    // A host that reduces the two into one piece of state would otherwise have
    // the trailing null wipe the choice that had just been made — an id from
    // one click and a name from the next is the bug this ordering prevents.
    if (row.item) {
      offeredRef.current = false;
      onPickOffered?.(null);
      onPick(row.item);
    } else if (row.offered) {
      offeredRef.current = true;
      onPick(null);
      onPickOffered?.(row.offered);
    }
  }

  function onType(next: string) {
    setQuery(next);
    setOpen(true);
    setActive(0);
    offeredRef.current = false;
    // Editing the text unmakes the choice. Leaving the old id attached to a
    // name that no longer matches it is how a picker links the wrong game.
    if (value) onPick(null);
    onPickOffered?.(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      // Only when a suggestion is highlighted, and then it is a choice rather
      // than a submit — pressing Enter over an open list must not send a form
      // carrying whatever was picked a moment ago.
      const picked = suggestions[active];
      if (!picked) return;
      e.preventDefault();
      choose(picked);
    }
  }

  return (
    <div className="picker" ref={wrapRef}>
      <input
        className="picker__input"
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={names ? placeholder : failed ? 'Could not load the catalog' : 'Loading…'}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        disabled={disabled || failed}
      />

      {/* What is actually chosen, said in words. The text in the box is only
          text until it resolves to a row, and the difference decides whether
          the button does anything — so it is stated rather than implied. */}
      {value ? (
        <span className="picker__chosen">
          <span className="picker__kind">{KIND_LABEL[value.kind]}</span>
          {value.name}
          <button
            type="button"
            className="picker__clear"
            onClick={() => {
              setQuery('');
              offeredRef.current = false;
              onPick(null);
              onPickOffered?.(null);
            }}
            aria-label="Clear"
          >
            ×
          </button>
        </span>
      ) : query.trim() !== '' && names && suggestions.length === 0 ? (
        <span className="picker__none">
          {emptyHint ?? 'Nothing in the catalog matches that.'}
        </span>
      ) : null}

      {open && suggestions.length > 0 && (
        <ul className="picker__list" id={listId} role="listbox">
          {suggestions.map((row, i) => (
            <li key={row.key}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? 'picker__opt picker__opt--active' : 'picker__opt'}
                // mousedown, not click: the input's blur would otherwise close
                // the list before the click landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(row);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="picker__opt-name">{row.name}</span>
                <span className="picker__kind">{KIND_LABEL[row.kind]}</span>
                {/* Every row says where it came from, including the certain
                    ones. Labelling only the doubtful sources would leave an
                    unlabelled row meaning "trustworthy" by omission, which is
                    exactly the reading a wrong guess would benefit from. */}
                <span className={`picker__src picker__src--${row.source}`}>
                  {SOURCE_LABEL[row.source]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
