import { useState } from 'react';
import { COPY_FORMATS, COPY_STATUSES, type Copy, type CopyFormat, type CopyStatus } from '@bgc/core';
import { api } from '../api';
import { Badge, ConfirmButton, DigitalTag, ErrorBox, Field } from './ui';
import { STATUS_TONE } from './ItemTree';

/**
 * "Added 4 Aug 2026". The clock time a row was typed in is noise, so only the
 * date shows; `addedAt` is a UTC instant, so let the browser localise it.
 */
function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface FormState {
  quantity: string;
  status: CopyStatus;
  format: CopyFormat;
  isSleeved: boolean;
  isPunched: boolean;
  lentTo: string;
  completenessNotes: string;
  notes: string;
}

function toForm(copy?: Copy): FormState {
  return {
    quantity: String(copy?.quantity ?? 1),
    status: copy?.status ?? 'owned',
    format: copy?.format ?? 'physical',
    isSleeved: copy?.isSleeved ?? false,
    isPunched: copy?.isPunched ?? false,
    lentTo: copy?.lentTo ?? '',
    completenessNotes: copy?.completenessNotes ?? '',
    notes: copy?.notes ?? '',
  };
}

export function CopyForm({
  itemId,
  existing,
  onDone,
  onCancel,
}: {
  itemId: number;
  existing?: Copy;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        quantity: Math.max(1, Number(form.quantity) || 1),
        status: form.status,
        format: form.format,
        isSleeved: form.isSleeved,
        isPunched: form.isPunched,
        lentTo: form.lentTo.trim() || null,
        completenessNotes: form.completenessNotes.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (existing) await api.updateCopy(existing.id, payload);
      else await api.createCopy(itemId, payload);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="copy-form" onSubmit={submit}>
      {error ? <ErrorBox error={error} what="Could not save this copy" /> : null}

      <div className="row-3">
        <Field label="How many" hint="Identical copies">
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
        </Field>

        <Field label="Status">
          <select value={form.status} onChange={(e) => set('status', e.target.value as CopyStatus)}>
            {COPY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        {/* A licence is not an object. Defaults to physical, which is nearly
            everything — this exists so the D&D Beyond half of the shelf can say
            it cannot be handed across a table. */}
        <Field label="Format">
          <select value={form.format} onChange={(e) => set('format', e.target.value as CopyFormat)}>
            {COPY_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {existing && (
        // Read-only: the database stamps this on insert, so there is nothing
        // to edit — but it answers "when did we get this?" at a glance.
        <p className="muted small">Added {formatAdded(existing.addedAt)}</p>
      )}

      {form.status === 'lent' && (
        <Field label="Lent to">
          <input value={form.lentTo} onChange={(e) => set('lentTo', e.target.value)} />
        </Field>
      )}

      <div className="checks">
        <label>
          <input
            type="checkbox"
            checked={form.isSleeved}
            onChange={(e) => set('isSleeved', e.target.checked)}
          />
          Sleeved
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.isPunched}
            onChange={(e) => set('isPunched', e.target.checked)}
          />
          Punched
        </label>
      </div>

      <div className="row-2">
        <Field label="Completeness" hint="Missing pieces, damage…">
          <input
            value={form.completenessNotes}
            onChange={(e) => set('completenessNotes', e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save copy' : 'Add copy'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CopyRow({
  copy,
  canEdit,
  onChanged,
}: {
  copy: Copy;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="copy editing">
        <CopyForm
          itemId={copy.itemId}
          existing={copy}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  // `Added` is last: it is always present, so leading with it would bury the
  // facts that vary from copy to copy.
  const facts = [
    copy.isSleeved ? 'sleeved' : null,
    copy.isPunched ? 'punched' : null,
    copy.lentTo ? `lent to ${copy.lentTo}` : null,
    `Added ${formatAdded(copy.addedAt)}`,
  ].filter(Boolean);

  return (
    <li className="copy">
      <Badge tone={STATUS_TONE[copy.status]}>
        {copy.quantity > 1 ? `${copy.quantity} × ${copy.status}` : copy.status}
      </Badge>
      {/* Only the exception is labelled. 564 of 639 copies are physical, and a
          badge on every one of them would be a badge nobody reads — the same
          argument this codebase already makes about "owned". */}
      {copy.format === 'digital' && <DigitalTag />}
      <span className="copy-facts">{facts.join(' · ')}</span>
      {(copy.completenessNotes || copy.notes) && (
        <span className="copy-notes">{[copy.completenessNotes, copy.notes].filter(Boolean).join(' — ')}</span>
      )}
      {canEdit && (
        <span className="copy-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
            Edit
          </button>
          <ConfirmButton
            className="btn btn-quiet danger-text"
            onConfirm={async () => {
              await api.deleteCopy(copy.id);
              onChanged();
            }}
          >
            Delete
          </ConfirmButton>
        </span>
      )}
    </li>
  );
}
