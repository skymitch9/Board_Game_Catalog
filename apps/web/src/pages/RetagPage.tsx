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
 * Filing games that got in as base games when they belong to something else.
 *
 * A bulk scan produces this in bulk — a shelf photo can put a dozen expansions
 * in as standalone games at once — and fixing it one item page at a time is
 * enough work that it does not get done. So it is one list, one pass.
 *
 * Nothing is applied without a tick. The rows whose name says "expansion"
 * outright start ticked because there is no judgement in them; the rest are
 * left for you, because "CATAN: Starfarers" reads exactly like an expansion
 * and is a game in its own right, and filing it under Catan would bury it.
 */
export function RetagPage({ me }: { me: MeResponse }) {
  const [state, refresh] = useAsync(() => api.retagSuggestions(), []);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [kinds, setKinds] = useState<Record<number, ItemKind>>({});
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<Record<number, 'ok' | string>>({});
  const [relKinds, setRelKinds] = useState<Record<number, RelationType>>({});
  const [linked, setLinked] = useState<Record<number, 'ok' | string>>({});
  const [error, setError] = useState<unknown>(null);

  if (!me.capabilities.includes('editCatalog')) {
    return <p className="muted">Only editors can change how games are filed.</p>;
  }
  if (state.state === 'loading') return <Spinner label="Looking for misfiled games..." />;
  if (state.state === 'error') {
    return <ErrorBox error={state.error} what="Could not load suggestions" />;
  }

  const suggestions = state.data.suggestions;
  const relations = state.data.relations;

  // Ticked on arrival: only the ones that need no judgement.
  if (chosen === null) {
    setChosen(new Set(suggestions.filter((s) => s.confident).map((s) => s.itemId)));
    return <Spinner />;
  }

  const kindOf = (s: RetagSuggestion): ItemKind => kinds[s.itemId] ?? 'expansion';
  const pending = suggestions.filter((s) => chosen.has(s.itemId) && !done[s.itemId]);

  const toggle = (id: number) =>
    setChosen((prev) => {
      const next = new Set(prev!);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function applyChosen() {
    setApplying(true);
    setError(null);

    for (const s of pending) {
      try {
        await api.updateItem(s.itemId, {
          kind: kindOf(s),
          parentItemId: s.proposedParentId,
        });
        setDone((d) => ({ ...d, [s.itemId]: 'ok' }));
      } catch (err) {
        setDone((d) => ({
          ...d,
          [s.itemId]: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    setApplying(false);
    refresh();
    setChosen(null);
  }

  async function link(s: (typeof relations)[number]) {
    try {
      await api.addRelation(s.fromItemId, {
        toItemId: s.toItemId,
        relation: relKinds[s.fromItemId] ?? 'works_with',
      });
      setLinked((l) => ({ ...l, [s.fromItemId]: 'ok' }));
    } catch (err) {
      setLinked((l) => ({
        ...l,
        [s.fromItemId]: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return (
    <div className="retag-page">
      <header className="page-head">
        <div>
          <h1>Tidy up filing</h1>
          <p className="subtitle">
            Games whose name mentions another game you own. Each one either belongs
            inside it or beside it — and only you know which.
          </p>
        </div>
        <Link to="/" className="btn btn-quiet">Collection</Link>
      </header>

      {error != null && <ErrorBox error={error} what="Could not re-file" />}

      {suggestions.length === 0 ? (
        <section className="card">
          <p className="muted">
            Nothing looks misfiled. Every game whose name mentions another one is already
            filed under it.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="shelf-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={applying || pending.length === 0}
              onClick={applyChosen}
            >
              {applying
                ? 'Filing…'
                : pending.length === 0
                  ? 'Nothing ticked'
                  : `File ${pending.length} game${pending.length === 1 ? '' : 's'}`}
            </button>
            <span className="muted small">
              {suggestions.filter((s) => s.confident).length} of {suggestions.length} say
              &quot;expansion&quot; outright and are ticked for you.
            </span>
          </div>

          <ul className="candidate-list">
            {suggestions.map((s) => {
              const outcome = done[s.itemId];
              return (
                <li key={s.itemId} className="candidate">
                  {outcome ? (
                    <span className="shelf-outcome" aria-hidden="true">
                      {outcome === 'ok' ? '✓' : '!'}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      className="shelf-check"
                      checked={chosen.has(s.itemId)}
                      disabled={applying}
                      onChange={() => toggle(s.itemId)}
                      aria-label={`File ${s.name} under ${s.proposedParentName}`}
                    />
                  )}

                  <div className="candidate__body">
                    <strong>{s.name}</strong>
                    <span className="muted">
                      → file under <strong>{s.proposedParentName}</strong>
                    </span>
                    <span className={s.confident ? 'muted small' : 'candidate__doubt'}>
                      {s.reason}
                    </span>

                    {!outcome && (
                      <div className="shelf-classify__controls">
                        <select
                          value={kindOf(s)}
                          onChange={(e) =>
                            setKinds((k) => ({ ...k, [s.itemId]: e.target.value as ItemKind }))
                          }
                          disabled={applying}
                          aria-label="Type"
                        >
                          {ITEM_KINDS.filter((k) => k !== 'base').map((k) => (
                            <option key={k} value={k}>{KIND_LABEL[k]}</option>
                          ))}
                        </select>
                        <Link to={`/items/${s.itemId}`} className="muted small">
                          open it instead
                        </Link>
                      </div>
                    )}

                    {outcome && outcome !== 'ok' && (
                      <span className="muted candidate__note">{outcome}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/*
        The other reading of the same rows. A game that plays on its own does
        not belong inside the one it shares a name with — it belongs beside it,
        linked. Catan and CATAN: Starfarers are the case: nesting Starfarers
        hides a whole game, and leaving them unconnected loses the fact that
        they are family. Same list, second answer.
      */}
      {relations.length > 0 && (
        <section className="card">
          <h2>Games from the same family</h2>
          <p className="muted small">
            These play on their own, so they stay where they are — but they can be
            linked, and the link shows on both games.
          </p>

          <ul className="candidate-list">
            {relations.map((s) => {
              const outcome = linked[s.fromItemId];
              return (
                <li key={s.fromItemId} className="candidate">
                  {outcome && (
                    <span className="shelf-outcome" aria-hidden="true">
                      {outcome === 'ok' ? '✓' : '!'}
                    </span>
                  )}
                  <div className="candidate__body">
                    <strong>{s.fromName}</strong>
                    <span className="muted">
                      &amp; <strong>{s.toName}</strong>
                    </span>
                    <span className="muted small">{s.reason}</span>

                    {outcome === 'ok' ? (
                      <span className="muted small">Linked.</span>
                    ) : (
                      <div className="shelf-classify__controls">
                        <select
                          value={relKinds[s.fromItemId] ?? 'works_with'}
                          onChange={(e) =>
                            setRelKinds((r) => ({
                              ...r,
                              [s.fromItemId]: e.target.value as RelationType,
                            }))
                          }
                          aria-label="How they relate"
                        >
                          {RELATION_TYPES.map((r) => (
                            <option key={r} value={r}>{RELATION_LABEL[r]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-quiet btn-xs"
                          onClick={() => link(s)}
                        >
                          Link them
                        </button>
                      </div>
                    )}

                    {outcome && outcome !== 'ok' && (
                      <span className="muted candidate__note">{outcome}</span>
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
