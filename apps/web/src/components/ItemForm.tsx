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
  /** Pre-filled data from the expansion picker. */
  prefill?: Partial<{
    name: string;
    yearPublished: string;
    publisher: string;
    thumbnailUrl: string;
    description: string;
  }> | null;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

/**
 * Everything about a game past its name, type and year.
 *
 * Split out of the form body because Quick add borrows it wholesale: "All
 * fields" there reveals *these* inputs rather than a second set that would
 * quietly drift out of step with this one. Held as strings because that is what
 * an `<input>` deals in — the null/number conversion happens once, on submit.
 */
export type ItemDetails = {
  publisher: string;
  publisherUrl: string;
  designers: string;
  bggId: string;
  minPlayers: string;
  maxPlayers: string;
  playtimeMin: string;
  weight: string;
  thumbnailUrl: string;
  description: string;
};

export const EMPTY_DETAILS: ItemDetails = {
  publisher: '',
  publisherUrl: '',
  designers: '',
  bggId: '',
  minPlayers: '',
  maxPlayers: '',
  playtimeMin: '',
  weight: '',
  thumbnailUrl: '',
  description: '',
};

type FormState = {
  name: string;
  kind: ItemKind;
  yearPublished: string;
} & ItemDetails;

function toForm(item?: Item, parentId?: number | null): FormState {
  return {
    name: item?.name ?? '',
    // Arriving with a parent means "add something to this game", so default to
    // expansion rather than base — defaulting to base would quietly create an
    // unrelated top-level game if the type dropdown went unnoticed.
    kind: item?.kind ?? (parentId ? 'expansion' : 'base'),
    yearPublished: item?.yearPublished?.toString() ?? '',
    publisher: item?.publisher ?? '',
    publisherUrl: item?.publisherUrl ?? '',
    designers: item?.designers ?? '',
    bggId: item?.bggId?.toString() ?? '',
    minPlayers: item?.minPlayers?.toString() ?? '',
    maxPlayers: item?.maxPlayers?.toString() ?? '',
    playtimeMin: item?.playtimeMin?.toString() ?? '',
    weight: item?.weight?.toString() ?? '',
    thumbnailUrl: item?.thumbnailUrl ?? '',
    description: item?.description ?? '',
  };
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** The detail half of a create/update payload, blanks normalised to null. */
export function detailsToInput(
  d: ItemDetails,
): Pick<
  CreateItemInput,
  | 'publisher'
  | 'publisherUrl'
  | 'designers'
  | 'bggId'
  | 'minPlayers'
  | 'maxPlayers'
  | 'playtimeMin'
  | 'weight'
  | 'thumbnailUrl'
  | 'description'
> {
  return {
    publisher: d.publisher.trim() || null,
    publisherUrl: d.publisherUrl.trim() || null,
    designers: d.designers.trim() || null,
    bggId: num(d.bggId),
    minPlayers: num(d.minPlayers),
    maxPlayers: num(d.maxPlayers),
    playtimeMin: num(d.playtimeMin),
    weight: num(d.weight),
    thumbnailUrl: d.thumbnailUrl.trim() || null,
    description: d.description.trim() || null,
  };
}

/** The inputs themselves, so both forms render the same controls. */
export function ItemDetailFields({
  value,
  onChange,
}: {
  value: ItemDetails;
  onChange: (patch: Partial<ItemDetails>) => void;
}) {
  return (
    <>
      <div className="row-2">
        <Field label="Publisher">
          <input
            value={value.publisher}
            onChange={(e) => onChange({ publisher: e.target.value })}
          />
        </Field>
        <Field label="Designers">
          <input
            value={value.designers}
            onChange={(e) => onChange({ designers: e.target.value })}
          />
        </Field>
      </div>

      <div className="row-2">
        <Field label="Publisher URL">
          <input
            type="url"
            value={value.publisherUrl}
            onChange={(e) => onChange({ publisherUrl: e.target.value })}
            placeholder="https://…"
          />
        </Field>
        <Field label="BGG ID" hint="From boardgamegeek.com/boardgame/ID">
          <input
            type="number"
            value={value.bggId}
            onChange={(e) => onChange({ bggId: e.target.value })}
            placeholder="e.g. 13"
          />
        </Field>
      </div>

      <div className="row-4">
        <Field label="Min players">
          <input
            type="number"
            value={value.minPlayers}
            onChange={(e) => onChange({ minPlayers: e.target.value })}
          />
        </Field>
        <Field label="Max players">
          <input
            type="number"
            value={value.maxPlayers}
            onChange={(e) => onChange({ maxPlayers: e.target.value })}
          />
        </Field>
        <Field label="Minutes">
          <input
            type="number"
            value={value.playtimeMin}
            onChange={(e) => onChange({ playtimeMin: e.target.value })}
          />
        </Field>
        <Field label="Weight" hint="1–5">
          <input
            type="number"
            step="0.1"
            value={value.weight}
            onChange={(e) => onChange({ weight: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Image URL">
        <input
          type="url"
          value={value.thumbnailUrl}
          onChange={(e) => onChange({ thumbnailUrl: e.target.value })}
          placeholder="https://…"
        />
      </Field>

      <Field label="Notes">
        <textarea
          rows={3}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </>
  );
}

export function ItemForm({ existing, parentId, parentName, prefill, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => {
    const base = toForm(existing, parentId);
    if (prefill) {
      return {
        ...base,
        name: prefill.name ?? base.name,
        yearPublished: prefill.yearPublished ?? base.yearPublished,
        publisher: prefill.publisher ?? base.publisher,
        thumbnailUrl: prefill.thumbnailUrl ?? base.thumbnailUrl,
        description: prefill.description ?? base.description,
      };
    }
    return base;
  });
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
        ...detailsToInput(form),
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

      <ItemDetailFields
        value={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
      />

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
    <>
      {parentItem && (
        <ExpansionPicker
          parentName={parentItem.name}
          onPick={(c) => navigate(`/items/new?parent=${parentId}&prefill=${encodeURIComponent(JSON.stringify(c))}`)}
        />
      )}
      <ItemForm
        parentId={parentId}
        parentName={parentItem?.name ?? null}
        prefill={parsePrefill()}
        onSaved={(item) => navigate(`/items/${item.id}`)}
        onCancel={() => navigate(parentId ? `/items/${parentId}` : '/')}
      />
    </>
  );
}

/** Parse prefill data from the URL if present. */
function parsePrefill(): Partial<{
  name: string;
  yearPublished: string;
  publisher: string;
  thumbnailUrl: string;
  description: string;
}> | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('prefill');
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * A picker showing known expansions for this parent game.
 *
 * Searches by the parent's name to find related titles from the free lookup
 * services. When BGG token arrives, this will use the BGG expansion links
 * for definitive results.
 */
function ExpansionPicker({
  parentName,
  onPick,
}: {
  parentName: string;
  onPick: (data: { name: string; yearPublished?: number; publisher?: string; thumbnailUrl?: string }) => void;
}) {
  const [results] = useAsync(
    () => api.lookup(parentName).then((r) => r.candidates).catch(() => []),
    [parentName],
  );

  // Don't show if no results or still loading.
  if (results.state !== 'ok' || results.data.length === 0) return null;

  return (
    <div className="card expansion-picker">
      <h3>Known in this series</h3>
      <p className="muted small">Pick one to pre-fill the form, or type your own below.</p>
      <div className="expansion-picker__list">
        {results.data.map((c, i) => (
          <button
            key={i}
            type="button"
            className="expansion-picker__item"
            onClick={() => onPick({
              name: c.name,
              yearPublished: c.yearPublished ?? undefined,
              publisher: c.publisher ?? undefined,
              thumbnailUrl: c.thumbnailUrl ?? undefined,
            })}
          >
            {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="thumb thumb-sm" />}
            <span>{c.name}</span>
            {c.yearPublished && <span className="muted">({c.yearPublished})</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
