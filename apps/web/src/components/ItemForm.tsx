import { useState } from 'react';
import { ITEM_KINDS, type CreateItemInput, type Item, type ItemKind } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { navigate } from '../router';
import { ErrorBox, Field, Spinner } from './ui';
import { KIND_LABEL } from './ItemTree';

interface Props {
  /** Present when editing; absent when creating. */
  existing?: Item;
  /** Pre-selected parent when adding into a known game. */
  parentId?: number | null;
  parentName?: string | null;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

type FormState = {
  name: string;
  kind: ItemKind;
  yearPublished: string;
  publisher: string;
  designers: string;
  minPlayers: string;
  maxPlayers: string;
  playtimeMin: string;
  weight: string;
  thumbnailUrl: string;
  description: string;
};

function toForm(item?: Item, parentId?: number | null): FormState {
  return {
    name: item?.name ?? '',
    // Arriving with a parent means "add something to this game", so default to
    // expansion rather than base — defaulting to base would quietly create an
    // unrelated top-level game if the type dropdown went unnoticed.
    kind: item?.kind ?? (parentId ? 'expansion' : 'base'),
    yearPublished: item?.yearPublished?.toString() ?? '',
    publisher: item?.publisher ?? '',
    designers: item?.designers ?? '',
    minPlayers: item?.minPlayers?.toString() ?? '',
    maxPlayers: item?.maxPlayers?.toString() ?? '',
    playtimeMin: item?.playtimeMin?.toString() ?? '',
    weight: item?.weight?.toString() ?? '',
    thumbnailUrl: item?.thumbnailUrl ?? '',
    description: item?.description ?? '',
  };
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function ItemForm({ existing, parentId, parentName, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(existing, parentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // A child item's kind can't be "base", and a base game has no parent.
  const effectiveParent = form.kind === 'base' ? null : (existing?.parentItemId ?? parentId ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: CreateItemInput = {
        name: form.name.trim(),
        kind: form.kind,
        parentItemId: effectiveParent,
        yearPublished: num(form.yearPublished),
        publisher: form.publisher.trim() || null,
        designers: form.designers.trim() || null,
        minPlayers: num(form.minPlayers),
        maxPlayers: num(form.maxPlayers),
        playtimeMin: num(form.playtimeMin),
        weight: num(form.weight),
        thumbnailUrl: form.thumbnailUrl.trim() || null,
        description: form.description.trim() || null,
      };

      const res = existing
        ? await api.updateItem(existing.id, payload)
        : await api.createItem(payload);
      onSaved(res.item);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{existing ? `Edit ${existing.name}` : 'Add to the catalog'}</h2>

      {error ? <ErrorBox error={error} what="Could not save" /> : null}

      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Gloomhaven"
          required
          autoFocus
        />
      </Field>

      <div className="row-2">
        <Field
          label="Type"
          hint={
            form.kind === 'base'
              ? 'A base game sits at the top of its own tree.'
              : parentName
                ? `Will be filed under ${parentName}.`
                : 'Needs a parent game — open a game and use "Add to this game".'
          }
        >
          <select
            value={form.kind}
            onChange={(e) => set('kind', e.target.value as ItemKind)}
            disabled={Boolean(existing)}
          >
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Year">
          <input
            type="number"
            value={form.yearPublished}
            onChange={(e) => set('yearPublished', e.target.value)}
            placeholder="2017"
          />
        </Field>
      </div>

      <div className="row-2">
        <Field label="Publisher">
          <input value={form.publisher} onChange={(e) => set('publisher', e.target.value)} />
        </Field>
        <Field label="Designers">
          <input value={form.designers} onChange={(e) => set('designers', e.target.value)} />
        </Field>
      </div>

      <div className="row-4">
        <Field label="Min players">
          <input
            type="number"
            value={form.minPlayers}
            onChange={(e) => set('minPlayers', e.target.value)}
          />
        </Field>
        <Field label="Max players">
          <input
            type="number"
            value={form.maxPlayers}
            onChange={(e) => set('maxPlayers', e.target.value)}
          />
        </Field>
        <Field label="Minutes">
          <input
            type="number"
            value={form.playtimeMin}
            onChange={(e) => set('playtimeMin', e.target.value)}
          />
        </Field>
        <Field label="Weight" hint="1–5">
          <input
            type="number"
            step="0.1"
            value={form.weight}
            onChange={(e) => set('weight', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Image URL">
        <input
          type="url"
          value={form.thumbnailUrl}
          onChange={(e) => set('thumbnailUrl', e.target.value)}
          placeholder="https://…"
        />
      </Field>

      <Field label="Notes">
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !form.name.trim()}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Add to catalog'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function NewItemPage({ parentId }: { parentId: number | null }) {
  // Load the parent so the form can name it — "Will be filed under Gloomhaven"
  // is the confirmation that you're adding in the right place.
  const [parent] = useAsync(
    () => (parentId ? api.item(parentId).then((r) => r.item) : Promise.resolve(null)),
    [parentId],
  );

  if (parentId && parent.state === 'loading') return <Spinner />;

  const parentItem = parent.state === 'ok' ? parent.data : null;

  return (
    <ItemForm
      parentId={parentId}
      parentName={parentItem?.name ?? null}
      onSaved={(item) => navigate(`/items/${item.id}`)}
      onCancel={() => navigate(parentId ? `/items/${parentId}` : '/')}
    />
  );
}
