import { useEffect, useRef, useState } from 'react';
import {
  ESTATE_MODES,
  ESTATE_THEMES,
  getThemeState,
  onThemeChange,
  setMode,
  setTheme,
  type EstateMode,
  type EstateTheme,
} from '../lib/theme';

/**
 * The cog in the top bar — the estate settings cog: which THEME, and light,
 * dark, or match the device.
 *
 * v2, aligned to the LIBRARY cog's presentation (owner: the two menus should
 * be a "semi consistent view"): a Theme dropdown over a Mode button row, in
 * that order, with the same labels — while wearing this app's own ink-and-
 * paper clothes. Structure is shared; skin is identity.
 *
 * Theme choice is SITE-WIDE — one look per site (owner clarification,
 * 2026-08-14; a per-page variant was built and reverted the same day).
 *
 * ⚠️ **Theme and mode are already applied before this mounts**, by
 * /assets/theme.js in index.html's <head>. This component neither applies nor
 * stores anything itself — it calls window.estateTheme (via lib/theme) and
 * re-renders on `hg-themechange`, so the panel always reflects the one source
 * of truth. Defaults are identity: retro is stamped via data-default-theme,
 * and only a choice made here changes it.
 */

const THEME_LABELS: Record<EstateTheme, string> = {
  classic: 'Classic',
  apple: 'Apple',
  cyberpunk: 'Cyberpunk',
  retro: 'Retro',
};

const MODE_LABELS: Record<EstateMode, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

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

  const themeLabel = THEME_LABELS[state.theme] ?? state.theme;
  const modeLabel = MODE_LABELS[state.mode] ?? state.mode;

  return (
    <div className="theme-toggle" ref={wrapRef}>
      <button
        type="button"
        className="theme-toggle__cog"
        aria-haspopup="true"
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
        <div className="theme-menu" role="group" aria-label="Appearance">
          <div className="theme-menu__row">
            <label className="theme-menu__head" htmlFor="bgc-theme-select">
              Theme
            </label>
            {/* A select, matching the library cog. Picking a theme keeps the
                menu open on purpose — the whole site just changed clothes and
                the natural next gesture is comparing. */}
            <select
              id="bgc-theme-select"
              className="theme-menu__select"
              value={state.theme}
              onChange={(e) => setTheme(e.currentTarget.value as EstateTheme)}
            >
              {ESTATE_THEMES.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="theme-menu__row">
            <span className="theme-menu__head" id="bgc-mode-label">
              Mode
            </span>
            <div className="theme-menu__modes" role="group" aria-labelledby="bgc-mode-label">
              {ESTATE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={state.mode === m}
                  onClick={() => {
                    setMode(m);
                    setOpen(false);
                  }}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          <p className="theme-menu__note muted small">Remembered on this site only.</p>
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
