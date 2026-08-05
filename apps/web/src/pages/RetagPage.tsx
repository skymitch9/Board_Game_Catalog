import { useState } from 'react';
import {
  ITEM_KINDS,
  RELATION_TYPES,
  type ItemKind,
  type MeResponse,
  type RelationType,
} from '@bgc/core';
import { api, type RetagSuggestion } from '../api';
import { useAsync } from '../hooks';
import { KIND_LABEL } from '../components/ItemTree';
import { RELATION_LABEL } from './ItemPage';
import { ErrorBox, Spinner } from '../components/ui';
import { Link } from '../router';

/**
 * One question, asked once per game: can you play this without the other box?
 *
 * Every row here is a game whose name contains another game you own, which is
 * the only clue a name gives — and it is not enough. "Scythe: Invaders from
 * Afar" cannot be played without Scythe and belongs inside it. "CATAN:
 * Starfarers" is a whole game that happens to wear the Catan name and belongs
 * beside it. Structurally identical, opposite answers.
 *
 * So the screen does not guess. It states what it noticed and offers the two
 * answers: **Standalone** links the two and leaves the game where it is;
 * **File under** nests it. Both are one tap, and neither happens on its own.
 */
export function RetagPage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.retagSuggestions(), []);
  const [kinds, setKinds] = useState<Record<number, ItemKind>>({});
  const [relKinds, setRelKinds] = useState<Record<number, RelationType>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);

  if (!me.capabilities.includes('editCatalog')) {
    return <p className="muted">Only editors can change how games are filed.</p>;
  }
  if (state.state === 'loading') return <Spinner label="Looking for related games..." />;
  if (state.state === 'error') {
    return <ErrorBox error={state.error} what="Could not load suggestions" />;
  }

  const suggestions = state.data.suggestions;
  const kindOf = (s: RetagSuggestion): ItemKind => kinds[s.itemId] ?? 'expansion';
  const relOf = (s: RetagSuggestion): RelationType => relKinds[s.itemId] ?? 'works_with';

  /** Plays on its own: keep it where it is, and record that they are family. */
  async function markStandalone(s: RetagSuggestion) {
    setBusy(s.itemId);
    setError(null);
    try {
      await api.addRelation(s.itemId, { toItemId: s.proposedParentId, relation: relOf(s) });
      setDone((d) => ({ ...d, [s.itemId]: `Standalone — linked to ${s.proposedParentName}.` }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  /** Needs the other box: nest it, and it stops being a game in its own right. */
  async function fileUnder(s: RetagSuggestion) {
    setBusy(s.itemId);
    setError(null);
    try {
      await api.updateItem(s.itemId, {
        kind: kindOf(s),
        parentItemId: s.proposedParentId,
      });
      setDone((d) => ({ ...d, [s.itemId]: `Filed under ${s.proposedParentName}.` }));
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="retag-page">
      <header className="page-head">
        <div>
          <h1>Related games</h1>
          <p className="subtitle">
            These share a name with something else you own. For each one: can you play
            it without the other box?
          </p>
        </div>
        <Link to="/" className="btn btn-quiet">Collection</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Could not apply that" />}

      {suggestions.length === 0 ? (
        <section className="card">
          <p className="muted">
            Nothing to sort out. Every game that shares a name with another is already
            either filed under it or linked to it.
          </p>
        </section>
      ) : (
        <section className="card">
          <ul className="candidate-list">
            {suggestions.map((s) => {
              const outcome = done[s.itemId];
              const working = busy === s.itemId;

              return (
                <li key={s.itemId} className="candidate">
                  <div className="candidate__body">
                    <strong>{s.name}</strong>
                    <span className="muted">
                      alongside <strong>{s.proposedParentName}</strong>
                    </span>
                    <span className={s.confident ? 'muted small' : 'candidate__doubt'}>
                      {s.reason}
                    </span>
                    {s.alreadyLinked && (
                      <span className="muted small">Already linked as family.</span>
                    )}

                    {outcome ? (
                      <span className="muted small">{outcome}</span>
                    ) : (
                      <div className="retag-choice">
                        <div className="retag-choice__option">
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={working || s.alreadyLinked}
                            onClick={() => markStandalone(s)}
                          >
                            Standalone
                          </button>
                          <select
                            value={relOf(s)}
                            onChange={(e) =>
                              setRelKinds((r) => ({
                                ...r,
                                [s.itemId]: e.target.value as RelationType,
                              }))
                            }
                            disabled={working || s.alreadyLinked}
                            aria-label="How they relate"
                          >
                            {RELATION_TYPES.map((r) => (
                              <option key={r} value={r}>{RELATION_LABEL[r]}</option>
                            ))}
                          </select>
                          <span className="muted small">
                            Plays on its own. Stays where it is, linked to{' '}
                            {s.proposedParentName}.
                          </span>
                        </div>

                        <div className="retag-choice__option">
                          <button
                            type="button"
                            className={s.confident ? 'btn btn-primary' : 'btn btn-quiet'}
                            disabled={working}
                            onClick={() => fileUnder(s)}
                          >
                            File under
                          </button>
                          <select
                            value={kindOf(s)}
                            onChange={(e) =>
                              setKinds((k) => ({ ...k, [s.itemId]: e.target.value as ItemKind }))
                            }
                            disabled={working}
                            aria-label="Type"
                          >
                            {ITEM_KINDS.filter((k) => k !== 'base').map((k) => (
                              <option key={k} value={k}>{KIND_LABEL[k]}</option>
                            ))}
                          </select>
                          <span className="muted small">
                            Needs {s.proposedParentName}. Nests inside it.
                          </span>
                        </div>

                        <Link to={`/items/${s.itemId}`} className="muted small">
                          open the game instead
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
