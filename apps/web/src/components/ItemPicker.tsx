import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

/** How many suggestions to show. Enough to choose from, short enough to scan. */
const MAX_SUGGESTIONS = 8;

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

  // A pick made elsewhere — the form being reset, or a parent arriving with the
  // item being edited — has to show up in the box.
  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value?.id, value?.name]);

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

  const suggestions = useMemo(() => {
    if (!names) return [];
    const terms = normalise(query).split(' ').filter(Boolean);
    if (terms.length === 0) return [];
    return names
      .filter((i) => i.id !== excludeId && (!filter || filter(i)))
      .map((item) => ({ item, score: rank(item.name, terms) }))
      .filter((r): r is { item: PickedItem; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, MAX_SUGGESTIONS)
      .map((r) => r.item);
  }, [names, query, excludeId, filter]);

  function choose(item: PickedItem) {
    setQuery(item.name);
    setOpen(false);
    setActive(0);
    onPick(item);
  }

  function onType(next: string) {
    setQuery(next);
    setOpen(true);
    setActive(0);
    // Editing the text unmakes the choice. Leaving the old id attached to a
    // name that no longer matches it is how a picker links the wrong game.
    if (value) onPick(null);
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
              onPick(null);
            }}
            aria-label="Clear"
          >
            ×
          </button>
        </span>
      ) : query.trim() !== '' && names && suggestions.length === 0 ? (
        <span className="picker__none">Nothing in the catalog matches that.</span>
      ) : null}

      {open && suggestions.length > 0 && (
        <ul className="picker__list" id={listId} role="listbox">
          {suggestions.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? 'picker__opt picker__opt--active' : 'picker__opt'}
                // mousedown, not click: the input's blur would otherwise close
                // the list before the click landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="picker__opt-name">{item.name}</span>
                <span className="picker__kind">{KIND_LABEL[item.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
