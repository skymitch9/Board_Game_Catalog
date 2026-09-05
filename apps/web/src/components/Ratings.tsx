import { useState } from 'react';
import {
  RATING_STEPS,
  isFamilyScoreWorthShowing,
  type FamilyScore,
  type Rating,
} from '@bgc/core';
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
/**
 * The family's one number, above everyone's individual ones.
 *
 * Decided by the owner 2026-09-05: the **base-weighted mean** (option (a) of
 * `docs/info/design-decisions.md`). The base game counts for six times what a
 * playmat does, so the tail is visible without being able to sink the box. The
 * weights, and the arithmetic that justifies them, are in `@bgc/core`'s
 * `family-score.ts` — this only renders what the wire carries.
 *
 * ⚠️ It says **what it was computed over**, not just the number. "4.4 across 6
 * of 19" and "4.4 across 19 of 19" are different claims, and a bare 4.4 makes
 * the weaker one look like the stronger. Hidden entirely below two rated rows
 * (`isFamilyScoreWorthShowing`), where it would only restate a single rating
 * under a grander heading.
 */
function FamilyRow({ family }: { family: FamilyScore }) {
  if (!isFamilyScoreWorthShowing(family) || family.score === null) return null;

  return (
    <p className="rating-family">
      <span className="rating-who">This family</span>
      <Stars rating={family.score} />
      <span className="rating-score">{family.score.toFixed(1)}</span>
      <span className="muted">
        across {family.rated} rated of {family.members} in the family
        {!family.hasBase && ' — no base game among them'}
      </span>
    </p>
  );
}

export function Ratings({
  itemId,
  ratings,
  familyScore,
  myEmail,
  canRate,
  onChanged,
}: {
  itemId: number;
  ratings: Rating[];
  familyScore: FamilyScore;
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

      <FamilyRow family={familyScore} />

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
