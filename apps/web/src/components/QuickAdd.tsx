import { useRef, useState } from 'react';
import { COPY_STATUSES, ITEM_KINDS, type CopyStatus, type ItemKind } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Link } from '../router';
import { ErrorBox, Field } from './ui';
import { KIND_LABEL } from './ItemTree';

/**
 * Rapid entry for cataloguing a shelf.
 *
 * The full form is the right shape for one careful record; it is the wrong
 * shape for two hundred. This does game and copy in a single submit, keeps
 * focus in the name field, and remembers the location between saves — because
 * when you're working along a shelf, the location is the thing that stays the
 * same and the name is the thing that changes.
 */
export function QuickAdd({
  parentId,
  parentName,
  locations,
  onAdded,
  onClose,
}: {
  parentId?: number | null;
  parentName?: string | null;
  locations: string[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>(parentId ? 'expansion' : 'base');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<CopyStatus>('owned');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [recordCopy, setRecordCopy] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<{ id: number; name: string }[]>([]);

  const nameRef = useRef<HTMLInputElement>(null);

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
      });

      if (recordCopy) {
        await api.createCopy(item.id, {
          quantity: Math.max(1, Number(quantity) || 1),
          status,
          location: location.trim() || null,
          currency: 'USD',
          isSleeved: false,
          isPunched: false,
        });
      }

      setAdded((prev) => [{ id: item.id, name: item.name }, ...prev].slice(0, 8));
      // Keep location and status; they're the shelf you're standing at.
      setName('');
      setYear('');
      nameRef.current?.focus();
      onAdded();
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
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Done
        </button>
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
        <Field label="Location" hint="Kept between entries">
          <input
            list="quickadd-locations"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={!recordCopy}
            placeholder="Shelf A"
          />
          <datalist id="quickadd-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
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
