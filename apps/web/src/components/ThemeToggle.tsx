import { useEffect, useRef, useState } from 'react';
import {
  apply,
  readChoice,
  store,
  watchSystem,
  type ThemeChoice,
} from '../lib/theme';

/**
 * The cog in the top bar: light, dark, or match the device.
 *
 * *"give me a 3 way system swap thing put a cog in the top of the page or
 * something to control it"* — the owner.
 *
 * A menu rather than a cycling button. A single control that rotates through
 * three states makes you press it up to twice to find out what it does and
 * never shows which one is current — fine for two states, poor for three.
 *
 * ⚠️ **The theme is already applied before this mounts**, by the inline script
 * in `index.html`. This component does not set the initial theme; it reads back
 * the same stored choice so the menu can show a tick beside it. If it applied
 * on mount instead, the first paint would be unthemed and every dark-mode load
 * would flash cream.
 */

const OPTIONS: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: 'system', label: 'Match system', hint: 'Follow the device' },
  { id: 'light', label: 'Light', hint: 'Aged paper' },
  { id: 'dark', label: 'Dark', hint: 'Ink on board' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Follow the device, but only while that is what was asked for.
  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystem(() => apply('system'));
  }, [choice]);

  // Close on an outside press or on Escape. `mousedown`, not `click`: a press
  // that starts outside and releases inside should still close it, and waiting
  // for `click` leaves the menu open under the finger on a phone.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(next: ThemeChoice) {
    setChoice(next);
    store(next);
    apply(next);
    setOpen(false);
  }

  return (
    <div className="theme-toggle" ref={wrapRef}>
      <button
        type="button"
        className="theme-toggle__cog"
        aria-haspopup="menu"
        aria-expanded={open}
        // The icon is decorative, so the button needs words of its own —
        // otherwise this is an unlabelled control to anything not looking at it.
        aria-label={`Theme: ${OPTIONS.find((o) => o.id === choice)?.label}`}
        title="Theme"
        onClick={() => setOpen((o) => !o)}
      >
        <CogIcon />
      </button>

      {open && (
        <div className="theme-menu" role="menu">
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice === option.id}
              className={
                choice === option.id ? 'theme-menu__opt theme-menu__opt--on' : 'theme-menu__opt'
              }
              onClick={() => pick(option.id)}
            >
              {/* Always rendered, visible only when chosen — so the rows do not
                  shift sideways as the tick moves between them. */}
              <span className="theme-menu__tick" aria-hidden="true">
                {choice === option.id ? '✓' : ''}
              </span>
              <span className="theme-menu__label">
                {option.label}
                <span className="muted small">{option.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drawn rather than imported: one icon does not earn a dependency. */
function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
