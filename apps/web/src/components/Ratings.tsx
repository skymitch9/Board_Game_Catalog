import { useState } from 'react';
import type { Rating } from '@bgc/core';
import { api } from '../api';
import { ErrorBox } from './ui';

/**
 * Ratings are the one per-person thing in an otherwise jointly-owned
 * collection, so this shows everyone's side by side rather than averaging them
 * — "you gave it a 9, she gave it a 6" is the interesting fact, not a 7.5.
 */
export function Ratings({
  itemId,
  ratings,
  myEmail,
  canRate,
  onChanged,
}: {
  itemId: number;
  ratings: Rating[];
  myEmail: string;
  canRate: boolean;
  onChanged: () => void;
}) {
  const mine = ratings.find((r) => r.email === myEmail);
  const others = ratings.filter((r) => r.email !== myEmail);

  const [score, setScore] = useState<string>(mine?.rating?.toString() ?? '');
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.rate(itemId, {
        rating: score === '' ? null : Number(score),
        notes: notes.trim() || null,
      });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api.unrate(itemId);
      setScore('');
      setNotes('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Ratings</h2>
      {error ? <ErrorBox error={error} what="Could not save your rating" /> : null}

      {canRate && (
        <div className="rating-mine">
          <div className="rating-scale" role="group" aria-label="Your rating">
            {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
              <button
                key={n}
                type="button"
                className={`pip ${score === n ? 'pip-on' : ''}`}
                onClick={() => setScore(score === n ? '' : n)}
                aria-pressed={score === n}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            className="rating-note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why? (optional)"
          />
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : mine ? 'Update my rating' : 'Save my rating'}
            </button>
            {mine && (
              <button type="button" className="btn btn-quiet" onClick={clear} disabled={busy}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <ul className="rating-list">
          {others.map((r) => (
            <li key={r.userId}>
              <span className="rating-who">{r.displayName || r.email}</span>
              <span className="rating-score">{r.rating ?? '—'}</span>
              {r.notes && <span className="rating-why">{r.notes}</span>}
            </li>
          ))}
        </ul>
      )}

      {ratings.length === 0 && !canRate && <p className="muted">Nobody has rated this yet.</p>}
    </section>
  );
}
