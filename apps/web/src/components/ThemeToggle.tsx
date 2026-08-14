import { useEffect, useRef, useState } from 'react';
import {
  getThemeState,
  onThemeChange,
  setMode,
  setTheme,
  type EstateMode,
  type EstateTheme,
} from '../lib/theme';

/**
 * The cog in the top bar — now the estate settings cog: which THEME, and
 * light, dark, or match the device.
 *
 * *"give me a 3 way system swap thing put a cog in the top of the page or
 * something to control it"* — the owner, for the original mode control; the
 * theme dropdown joined it per the estate ask ("put that selector in the same
 * settings cog as darkmode"). Two labelled groups in one menu rather than a
 * second control: the cog was already where appearance decisions live.
 *
 * A menu rather than a cycling button, same reasoning as before: a control
 * that rotates through states never shows which one is current.
 *
 * ⚠️ **Theme and mode are already applied before this mounts**, by
 * /assets/theme.js in index.html's <head>. This component neither applies nor
 * stores anything itself — it calls window.estateTheme (via lib/theme) and
 * re-renders on `hg-themechange`, so the tick always reflects the one source
 * of truth. Defaults are identity: retro is stamped via data-default-theme,
 * and only a choice made here changes it.
 */

const THEME_OPTIONS: { id: EstateTheme; label: string; hint: string }[] = [
  { id: 'retro', label: 'Retro', hint: 'Aged paper & ink — the house look' },
  { id: 'apple', label: 'Apple', hint: 'Quiet monochrome' },
  { id: 'cyberpunk', label: 'Cyberpunk', hint: 'Neon on black' },
];

const MODE_OPTIONS: { id: EstateMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Match system', hint: 'Follow the device' },
  { id: 'light', label: 'Light', hint: 'Daytime' },
  { id: 'dark', label: 'Dark', hint: 'Evening' },
];

export function ThemeToggle() {
  const [state, setState] = useState(() => getThemeState());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The switcher is the source of truth; mirror every change it announces
  // (including OS flips while the mode is 'auto').
  useEffect(() => onThemeChange(() => setState(getThemeState())), []);

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

  const themeLabel = THEME_OPTIONS.find((o) => o.id === state.theme)?.label;
  const modeLabel = MODE_OPTIONS.find((o) => o.id === state.mode)?.label;

  return (
    <div className="theme-toggle" ref={wrapRef}>
      <button
        type="button"
        className="theme-toggle__cog"
        aria-haspopup="menu"
        aria-expanded={open}
        // The icon is decorative, so the button needs words of its own —
        // otherwise this is an unlabelled control to anything not looking at it.
        aria-label={`Appearance: ${themeLabel}, ${modeLabel}`}
        title="Appearance"
        onClick={() => setOpen((o) => !o)}
      >
        <CogIcon />
      </button>

      {open && (
        <div className="theme-menu" role="menu">
          <div className="theme-menu__head" aria-hidden="true">
            Theme
          </div>
          {THEME_OPTIONS.map((option) => (
            <MenuRow
              key={option.id}
              label={option.label}
              hint={option.hint}
              checked={state.theme === option.id}
              onPick={() => setTheme(option.id)}
            />
          ))}
          <div className="theme-menu__head" aria-hidden="true">
            Mode
          </div>
          {MODE_OPTIONS.map((option) => (
            <MenuRow
              key={option.id}
              label={option.label}
              hint={option.hint}
              checked={state.mode === option.id}
              onPick={() => {
                setMode(option.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One row of the menu. Picking a THEME keeps the menu open on purpose — the
 *  whole page just changed clothes and the natural next gesture is comparing;
 *  picking a mode closes it, as the old control did. */
function MenuRow(props: { label: string; hint: string; checked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.checked}
      className={props.checked ? 'theme-menu__opt theme-menu__opt--on' : 'theme-menu__opt'}
      onClick={props.onPick}
    >
      {/* Always rendered, visible only when chosen — so the rows do not
          shift sideways as the tick moves between them. */}
      <span className="theme-menu__tick" aria-hidden="true">
        {props.checked ? '✓' : ''}
      </span>
      <span className="theme-menu__label">
        {props.label}
        <span className="muted small">{props.hint}</span>
      </span>
    </button>
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
