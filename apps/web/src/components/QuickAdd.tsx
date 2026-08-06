import { useRef, useState } from 'react';
import {
  COPY_STATUSES,
  ITEM_KINDS,
  type BarcodeCandidate,
  type CopyStatus,
  type ItemKind,
} from '@bgc/core';
import { api } from '../api';
import { useAsync, useDebounced } from '../hooks';
import { Link } from '../router';
import { ErrorBox, Field } from './ui';
import { EMPTY_DETAILS, ItemDetailFields, detailsToInput, type ItemDetails } from './ItemForm';
import { KIND_LABEL } from './ItemTree';

/**
 * How much of a name is worth searching on. Two characters match half the
 * shelf, and the endpoint refuses anything shorter than two anyway; three is
 * where a result starts to mean something.
 */
const MIN_LOOKUP_CHARS = 3;

/**
 * Long enough that a whole word lands before the request goes out, short enough
 * that the suggestion is there by the time you look up from the box.
 */
const LOOKUP_DEBOUNCE_MS = 550;

/**
 * Rapid entry for cataloguing a shelf.
 *
 * The full form is the right shape for one careful record; it is the wrong
 * shape for two hundred. This does game and copy in a single submit, keeps
 * focus in the name field, and holds status and quantity steady between saves
 * — when you're working along a shelf the name is the thing that changes and
 * everything else stays put.
 *
 * Everything the full form can record is here too, behind "All fields", so
 * pausing to fill in a publisher never means starting again on another page.
 */
export function QuickAdd({
  parentId,
  parentName,
  onAdded,
  onClose,
}: {
  parentId?: number | null;
  parentName?: string | null;
  /** Called after each save, for hosts showing a list that just went stale. */
  onAdded?: () => void;
  /** Omitted where the host has its own way out; the Done button is then hidden. */
  onClose?: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>(parentId ? 'expansion' : 'base');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<CopyStatus>('owned');
  const [quantity, setQuantity] = useState('1');
  const [recordCopy, setRecordCopy] = useState(true);
  const [details, setDetails] = useState<ItemDetails>(EMPTY_DETAILS);
  const [showAll, setShowAll] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<{ id: number; name: string }[]>([]);

  const nameRef = useRef<HTMLInputElement>(null);

  const suggestion = useSuggestion(name);
  /** The suggestion already applied, so the offer doesn't nag once taken. */
  const [usedSuggestion, setUsedSuggestion] = useState<string | null>(null);

  /**
   * Take what the lookup found — but only into fields that are still empty.
   * Anything typed by hand outranks anything a database guessed, and the name
   * is never touched at all: that field belongs to the keyboard.
   */
  function applySuggestion(c: BarcodeCandidate) {
    if (c.yearPublished != null) setYear((y) => (y.trim() === '' ? String(c.yearPublished) : y));
    setDetails((d) => ({
      ...d,
      publisher: d.publisher || c.publisher || '',
      minPlayers: d.minPlayers || (c.minPlayers != null ? String(c.minPlayers) : ''),
      maxPlayers: d.maxPlayers || (c.maxPlayers != null ? String(c.maxPlayers) : ''),
      playtimeMin: d.playtimeMin || (c.playtimeMin != null ? String(c.playtimeMin) : ''),
      thumbnailUrl: d.thumbnailUrl || c.thumbnailUrl || '',
      description: d.description || c.description || '',
    }));
    // Open the expander rather than fill fields out of sight — what landed in
    // the record has to be visible before it is saved.
    setShowAll(true);
    setUsedSuggestion(c.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      const { item } = await api.createItem({
        name: trimmed,
        kind,
        parentItemId: kind === 'base' ? null : (parentId ?? null),
        yearPublished: year.trim() === '' ? null : Number(year),
        ...detailsToInput(details),
      });

      if (recordCopy) {
        await api.createCopy(item.id, {
          quantity: Math.max(1, Number(quantity) || 1),
          status,
          // Typing along a shelf means a box in your hand. A licence is edited
          // in afterwards on the item page rather than asked about here.
          format: 'physical',
          isSleeved: false,
          isPunched: false,
        });
      }

      setAdded((prev) => [{ id: item.id, name: item.name }, ...prev].slice(0, 8));
      // Keep status and quantity; everything describing the game itself is
      // cleared, or the last box's publisher would be stamped on the next one.
      setName('');
      setYear('');
      setDetails(EMPTY_DETAILS);
      setUsedSuggestion(null);
      nameRef.current?.focus();
      onAdded?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card quickadd" onSubmit={submit}>
      <div className="section-head">
        <h2>Quick add{parentName ? ` to ${parentName}` : ''}</h2>
        {onClose && (
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Done
          </button>
        )}
      </div>

      {error ? <ErrorBox error={error} what="Could not add that one" /> : null}

      <div className="quickadd-row">
        <Field label="Name">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type a name, press Enter"
            autoFocus
            required
          />
        </Field>
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
            {ITEM_KINDS.filter((k) => (parentId ? k !== 'base' : true)).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="—"
          />
        </Field>
      </div>

      {suggestion && (
        <Suggestion
          candidate={suggestion}
          used={usedSuggestion === suggestion.name}
          onUse={() => applySuggestion(suggestion)}
        />
      )}

      <div className="quickadd-row">
        <label className="check-inline">
          <input
            type="checkbox"
            checked={recordCopy}
            onChange={(e) => setRecordCopy(e.target.checked)}
          />
          Record a copy
        </label>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CopyStatus)}
            disabled={!recordCopy}
          >
            {COPY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How many" hint="2+ if you own duplicates">
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={!recordCopy}
          />
        </Field>
      </div>

      <details
        className="quickadd-more"
        open={showAll}
        onToggle={(e) => setShowAll(e.currentTarget.open)}
      >
        <summary>All fields</summary>
        <div className="quickadd-more__body">
          <ItemDetailFields
            value={details}
            onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
          />
        </div>
      </details>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add and keep going'}
        </button>
        <span className="muted small">
          {added.length > 0
            ? `${added.length} added this session`
            : 'The form stays open so you can work along a shelf.'}
        </span>
      </div>

      {added.length > 0 && (
        <ul className="quickadd-recent">
          {added.map((a) => (
            <li key={a.id}>
              <Link to={`/items/${a.id}`}>{a.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/**
 * Look the half-typed name up in the background.
 *
 * Everything about this is arranged around not getting in the way. It is
 * debounced so it never fires per keystroke, it returns nothing until the name
 * is long enough to mean something, and a failure resolves to null rather than
 * an error — a lookup that quietly finds nothing is the correct outcome for a
 * game no free database has heard of, and an error box over the keyboard is
 * not.
 */
function useSuggestion(name: string): BarcodeCandidate | null {
  const query = useDebounced(name.trim(), LOOKUP_DEBOUNCE_MS);

  const [result] = useAsync(
    () =>
      query.length < MIN_LOOKUP_CHARS
        ? Promise.resolve(null)
        : api
            .lookup(query)
            .then((r) => r.candidates[0] ?? null)
            .catch(() => null),
    [query],
  );

  return result.state === 'ok' ? result.data : null;
}

/**
 * The offer, never the act.
 *
 * A suggestion that filled the form by itself would be a trap: you would have
 * to check every save to see what a search engine decided your game was. So it
 * sits below the name, out of the tab order's way, and does nothing at all
 * until it is tapped.
 */
function Suggestion({
  candidate,
  used,
  onUse,
}: {
  candidate: BarcodeCandidate;
  used: boolean;
  onUse: () => void;
}) {
  const facts = [candidate.publisher, candidate.yearPublished].filter(Boolean).join(' · ');

  return (
    <div className="quickadd-hint">
      {candidate.thumbnailUrl && (
        <img src={candidate.thumbnailUrl} alt="" className="quickadd-hint__thumb" />
      )}
      <span className="quickadd-hint__body">
        <strong>{candidate.name}</strong>
        {facts && <span className="muted small">{facts}</span>}
      </span>
      {used ? (
        <span className="muted small">Filled in</span>
      ) : (
        <button type="button" className="btn btn-quiet" onClick={onUse}>
          Use this
        </button>
      )}
    </div>
  );
}

/** Download buttons for the JSON and CSV exports. */
export function ExportLinks() {
  const [meta] = useAsync(() => api.meta(), []);
  const empty = meta.state === 'ok' && meta.data.stats.totalItems === 0;

  if (empty) return null;

  return (
    <span className="export-links">
      <a href="/api/export.json" download>
        Backup (JSON)
      </a>
      <a href="/api/export.csv" download>
        Spreadsheet (CSV)
      </a>
    </span>
  );
}
