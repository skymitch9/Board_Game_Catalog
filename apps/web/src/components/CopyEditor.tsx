import { useState } from 'react';
import {
  CONDITIONS,
  COPY_STATUSES,
  formatMoney,
  type Condition,
  type Copy,
  type CopyStatus,
} from '@bgc/core';
import { api } from '../api';
import { Badge, ConfirmButton, ErrorBox, Field } from './ui';
import { STATUS_TONE } from './ItemTree';

const CONDITION_LABEL: Record<Condition, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

interface FormState {
  status: CopyStatus;
  location: string;
  acquiredOn: string;
  priceDollars: string;
  vendor: string;
  condition: string;
  isSleeved: boolean;
  isPunched: boolean;
  lentTo: string;
  completenessNotes: string;
  notes: string;
}

function toForm(copy?: Copy): FormState {
  return {
    status: copy?.status ?? 'owned',
    location: copy?.location ?? '',
    acquiredOn: copy?.acquiredOn ?? '',
    priceDollars: copy?.pricePaidCents != null ? (copy.pricePaidCents / 100).toFixed(2) : '',
    vendor: copy?.vendor ?? '',
    condition: copy?.condition ?? '',
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
  locations,
  onDone,
  onCancel,
}: {
  itemId: number;
  existing?: Copy;
  locations: string[];
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
      const dollars = form.priceDollars.trim();
      const payload = {
        status: form.status,
        location: form.location.trim() || null,
        acquiredOn: form.acquiredOn || null,
        pricePaidCents: dollars === '' ? null : Math.round(Number(dollars) * 100),
        currency: 'USD',
        vendor: form.vendor.trim() || null,
        condition: (form.condition || null) as Condition | null,
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
        <Field label="Status">
          <select value={form.status} onChange={(e) => set('status', e.target.value as CopyStatus)}>
            {COPY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Location" hint="Shelf, closet, box…">
          <input
            list="known-locations"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
          />
          <datalist id="known-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>

        <Field label="Condition">
          <select value={form.condition} onChange={(e) => set('condition', e.target.value)}>
            <option value="">—</option>
            {CONDITIONS.map((cnd) => (
              <option key={cnd} value={cnd}>
                {CONDITION_LABEL[cnd]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row-3">
        <Field label="Paid">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.priceDollars}
            onChange={(e) => set('priceDollars', e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Vendor">
          <input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} />
        </Field>
        <Field label="Acquired">
          <input
            type="date"
            value={form.acquiredOn}
            onChange={(e) => set('acquiredOn', e.target.value)}
          />
        </Field>
      </div>

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
  locations,
  onChanged,
}: {
  copy: Copy;
  canEdit: boolean;
  locations: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="copy editing">
        <CopyForm
          itemId={copy.itemId}
          existing={copy}
          locations={locations}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const facts = [
    copy.location,
    copy.condition ? CONDITION_LABEL[copy.condition] : null,
    copy.isSleeved ? 'sleeved' : null,
    copy.isPunched ? 'punched' : null,
    copy.pricePaidCents != null ? formatMoney(copy.pricePaidCents, copy.currency) : null,
    copy.vendor,
    copy.acquiredOn,
    copy.lentTo ? `lent to ${copy.lentTo}` : null,
  ].filter(Boolean);

  return (
    <li className="copy">
      <Badge tone={STATUS_TONE[copy.status]}>{copy.status}</Badge>
      <span className="copy-facts">{facts.join(' · ') || 'no details'}</span>
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
