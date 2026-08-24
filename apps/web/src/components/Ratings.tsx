import { useState } from 'react';
import { RATING_STEPS, type Rating } from '@bgc/core';
import { api } from '../api';
import { ErrorBox } from './ui';

/**
 * Ratings are the one per-person thing in an otherwise jointly-owned
 * collection, so this shows everyone's side by side rather than averaging them
 * — "you gave it a 4.5, she gave it a 3" is the interesting fact, not a 3.75.
 *
 * The scale is 0.5–5 half-stars, matching the audiobook catalog so a rating
 * reads the same on both sites (owner request, 2026-08-24). See RATING_* in
 * packages/core. Selection is a row of half-step chips; every stored rating —
 * yours and everyone else's — renders as stars.
 */

/**
 * A 0.5–5 rating as five stars, half steps included. Ported from the audiobook
 * site's `renderStars` (and the library's `Reviews.tsx`) so a rating looks the
 * same everywhere: an empty star underneath, CSS overlays a clipped filled half
 * on `.star.half`. A half star that rendered as a full one would make 4.5 and 5
 * indistinguishable — the whole reason the scale is halves.
 */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" aria-label={`Rating: ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) =>
        rating >= i ? (
          <span key={i} className="star full">★</span>
        ) : rating >= i - 0.5 ? (
          <span key={i} className="star half">☆</span>
        ) : (
          <span key={i} className="star empty">☆</span>
        ),
      )}
    </span>
  );
}
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
            {RATING_STEPS.map((v) => {
              const n = String(v);
              return (
                <button
                  key={n}
                  type="button"
                  className={`pip ${score === n ? 'pip-on' : ''}`}
                  onClick={() => setScore(score === n ? '' : n)}
                  aria-pressed={score === n}
                  aria-label={`${v} out of 5`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          {score !== '' && (
            <p className="rating-preview">
              <Stars rating={Number(score)} />
              <span className="muted"> {score} out of 5</span>
            </p>
          )}
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
              <span className="rating-score">
                {r.rating === null ? '—' : <Stars rating={r.rating} />}
              </span>
              {r.notes && <span className="rating-why">{r.notes}</span>}
            </li>
          ))}
        </ul>
      )}

      {ratings.length === 0 && !canRate && <p className="muted">Nobody has rated this yet.</p>}
    </section>
  );
}
