import { useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { Link } from '../router';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted pad">{label}</p>;
}

export function ErrorBox({ error, what }: { error: unknown; what?: string }) {
  const message =
    error instanceof ApiError
      ? error.detail
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div className="errorbox">
      <strong>{what ?? 'Something went wrong'}</strong>
      <span>{message}</span>
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'owned' | 'wanted' | 'preordered' | 'lent' | 'sold' | 'kind';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/**
 * A licence, not an object.
 *
 * Deliberately a small tag rather than a full status badge: it qualifies a copy
 * that already carries one ("owned · digital"), and competing with the status
 * for attention would make the common word harder to read, not the rare one
 * easier. `physical` is never labelled — it is 564 of 639 rows, and a label on
 * the majority is a label nobody reads.
 */
export function DigitalTag() {
  return (
    <span className="digital-tag" title="A licence — nothing to hand across the table">
      digital
    </span>
  );
}

/**
 * The box a thing lives in, named and linked, beside the thing itself.
 *
 * "Scarlet Witch" is not an answer on its own — the owner's next question is
 * always *which box do I pull off the shelf*, and everywhere a child appears
 * away from its parent (search results, the wishlist) that context is missing.
 * Renaming the item to carry it was considered and rejected: the label costs
 * nothing and a rename is lossy and permanent.
 *
 * Muted, and the second half is a link to the parent — clicking "Marvel Dice
 * Throne" opens the box rather than the hero.
 */
export function ParentLabel({ id, name }: { id: number | null; name: string | null }) {
  if (!name) return null;
  return (
    <span className="parent-label">
      {' — '}
      {id != null ? <Link to={`/items/${id}`}>{name}</Link> : name}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Two-click delete. Deliberately not window.confirm — a native dialog blocks
 * the page and reads as heavier than the action deserves.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Really delete?',
  className = 'btn btn-danger',
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }

  return (
    <span className="confirm-group">
      <button type="button" className="btn btn-danger" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/**
 * The page controls. Rendered twice — once above the list, once below it.
 *
 * Twice, because the owner's complaint was having to scroll the whole page down
 * to reach "Next" and then straight back up to read the result. One component,
 * because two copies of this markup would drift: the first divergence would be
 * a fix applied to the bottom set and not the top, and nobody would notice until
 * the two disagreed about which page they were on.
 *
 * `position` is not decoration. Two identically-labelled navs are a maze to a
 * screen reader — "navigation, Collection pages" twice, with no way to tell
 * which one the cursor is in — so the nav and both buttons say which set they
 * belong to.
 *
 * Renders nothing at all when there is one page. Controls that can only be
 * pressed to no effect are worse than absent ones.
 */
export function Pager({
  page,
  pageSize,
  pageCount,
  total,
  onPage,
  position,
}: {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  onPage: (next: number) => void;
  position: 'top' | 'bottom';
}) {
  if (pageCount <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className={`pager pager--${position}`} aria-label={`Pagination, ${position} of list`}>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={page <= 1}
        aria-label={`Previous page (${position} pagination)`}
        onClick={() => onPage(page - 1)}
      >
        ← Previous
      </button>
      <span className="pager__where">
        {from}–{to} of {total}
      </span>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={page >= pageCount}
        aria-label={`Next page (${position} pagination)`}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
