import { useState } from 'react';
import {
  COPY_FORMATS,
  COPY_STATUSES,
  COPY_STATUS_LABELS,
  DISPOSALS,
  DISPOSAL_LABELS,
  DISPOSED_STATUS,
  copyStateLabel,
  type Copy,
  type CopyFormat,
  type CopyStatus,
  type Disposal,
} from '@bgc/core';
import { api } from '../api';
import { formatDate } from '../lib/dates';
import { Badge, ConfirmButton, DigitalTag, ErrorBox, Field } from './ui';
import { STATUS_TONE } from './ItemTree';

/**
 * "Added 4 Aug 2026". The clock time a row was typed in is noise, so only the
 * date shows; `addedAt` is a UTC instant, so let the browser localise it.
 *
 * Through `formatDate` rather than `new Date(iso)`: SQLite's timestamps carry no
 * zone marker, and parsing one directly reads a UTC instant as local time.
 */
const formatAdded = (iso: string): string =>
  formatDate(iso, { year: 'numeric', month: 'short', day: 'numeric' });

/** "12.50" → 1250 cents; "" → null. Anything unparseable → null. */
function toCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
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
  /** Which flavour of "no longer ours". Only read when `status` is that. */
  disposal: Disposal;
  /** Event metadata — who and how much. Never stored on the copy itself. */
  counterpart: string;
  price: string;
  disposalNote: string;
}

function toForm(copy?: Copy, presetStatus?: CopyStatus): FormState {
  return {
    quantity: String(copy?.quantity ?? 1),
    status: presetStatus ?? copy?.status ?? 'owned',
    format: copy?.format ?? 'physical',
    isSleeved: copy?.isSleeved ?? false,
    isPunched: copy?.isPunched ?? false,
    lentTo: copy?.lentTo ?? '',
    completenessNotes: copy?.completenessNotes ?? '',
    notes: copy?.notes ?? '',
    // `given_away` is the default because it is the case the owner actually
    // has — item 303 was given away, and production holds zero sold copies.
    disposal: copy?.disposal ?? 'given_away',
    counterpart: '',
    price: '',
    disposalNote: '',
  };
}

export function CopyForm({
  itemId,
  existing,
  presetStatus,
  onDone,
  onCancel,
}: {
  itemId: number;
  existing?: Copy;
  /** Open with the status already chosen — the "No longer ours" shortcut. */
  presetStatus?: CopyStatus;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(existing, presetStatus));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const gone = form.status === DISPOSED_STATUS;
      const payload = {
        quantity: Math.max(1, Number(form.quantity) || 1),
        status: form.status,
        format: form.format,
        isSleeved: form.isSleeved,
        isPunched: form.isPunched,
        lentTo: form.lentTo.trim() || null,
        completenessNotes: form.completenessNotes.trim() || null,
        notes: form.notes.trim() || null,
        /*
          ⚠️ Sent as an explicit `null` when the copy is ours, never omitted.
          The server reads an ABSENT key as "leave it alone" and a null as "it
          is ours again" — so a copy flipped back from `sold` to `owned` with
          the key missing would be refused for carrying a stale reason, which
          reads to the user as the app breaking on a legitimate correction.
        */
        disposal: gone ? form.disposal : null,
      };

      if (existing) {
        await api.updateCopy(existing.id, {
          ...payload,
          // Only when something is leaving: on any other save these three are
          // blank, and an event carrying three nulls is noise in the history.
          ...(gone
            ? {
                disposalDetails: {
                  counterpart: form.counterpart.trim() || null,
                  priceCents: toCents(form.price),
                  note: form.disposalNote.trim() || null,
                },
              }
            : {}),
        });
      } else await api.createCopy(itemId, payload);
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
                {COPY_STATUS_LABELS[s]}
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

      {/* What happened, when a copy is leaving.
          ⚠️ The reason is REQUIRED — the server refuses a "no longer ours" copy
          with no disposal, because "gone, no idea why" is the outcome the design
          doc calls worse than doing nothing. The select has no blank option, so
          the form cannot produce that request in the first place; who and how
          much stay optional, since being unable to remember a friend's name must
          not stop the owner recording that the game is gone. */}
      {form.status === DISPOSED_STATUS && (
        <fieldset className="copy-disposal">
          <legend>What happened to it</legend>

          <div className="row-3">
            <Field label="Reason">
              <select
                value={form.disposal}
                onChange={(e) => set('disposal', e.target.value as Disposal)}
              >
                {DISPOSALS.map((d) => (
                  <option key={d} value={d}>
                    {DISPOSAL_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={form.disposal === 'sold' ? 'Sold to' : 'Given to'}
              hint="Optional"
            >
              <input
                value={form.counterpart}
                onChange={(e) => set('counterpart', e.target.value)}
                disabled={form.disposal === 'lost'}
              />
            </Field>

            <Field label="For" hint="Optional, e.g. 25">
              <input
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                disabled={form.disposal !== 'sold'}
              />
            </Field>
          </div>

          <Field label="Note" hint="Kept on the history entry, not on the copy">
            <input
              value={form.disposalNote}
              onChange={(e) => set('disposalNote', e.target.value)}
            />
          </Field>

          <p className="muted small">
            The copy stays in the catalog and stops counting as held. This save is
            recorded in the game&rsquo;s history, which nothing can edit or delete.
          </p>
        </fieldset>
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
  // `null` = not editing. `'edit'` = the ordinary form. `'dispose'` = the same
  // form opened with the status already set — see the button below.
  const [editing, setEditing] = useState<null | 'edit' | 'dispose'>(null);

  if (editing) {
    return (
      <li className="copy editing">
        <CopyForm
          itemId={copy.itemId}
          existing={copy}
          {...(editing === 'dispose' ? { presetStatus: DISPOSED_STATUS } : {})}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      </li>
    );
  }

  const gone = copy.status === DISPOSED_STATUS;

  // `Added` is last: it is always present, so leading with it would bury the
  // facts that vary from copy to copy.
  const facts = [
    copy.isSleeved ? 'sleeved' : null,
    copy.isPunched ? 'punched' : null,
    copy.lentTo ? `lent to ${copy.lentTo}` : null,
    `Added ${formatAdded(copy.addedAt)}`,
  ].filter(Boolean);

  // ⚠️ Through `copyStateLabel`, never `copy.status` directly: a copy the owner
  // gave away is stored as `sold`, and printing the raw value would tell him he
  // sold it. See migration 0029's header for why the storage looks like that.
  const label = copyStateLabel(copy.status, copy.disposal);

  return (
    <li className={gone ? 'copy copy--gone' : 'copy'}>
      <Badge tone={STATUS_TONE[copy.status]}>
        {copy.quantity > 1 ? `${copy.quantity} × ${label}` : label}
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
          <button type="button" className="btn btn-quiet" onClick={() => setEditing('edit')}>
            Edit
          </button>
          {/* ⚠️ The discoverability half of the feature, and possibly the whole
              of it: `sold` and `lent` have existed since migration 0001 and had
              been used ZERO times as of 2026-08-09, because the only way to
              reach them was a dropdown three fields into an edit form. The
              thought "I gave this away" happens while looking at the copy, so
              the action lives there. Hidden once the copy has already gone. */}
          {!gone && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setEditing('dispose')}
            >
              No longer ours
            </button>
          )}
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
