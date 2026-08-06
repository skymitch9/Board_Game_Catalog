import { useState, type ReactNode } from 'react';
import { ApiError } from '../api';

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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
