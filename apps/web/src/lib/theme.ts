/**
 * The React side of the estate theme contract.
 *
 * The heavy lifting moved to /assets/theme.js (the estate switcher, loaded
 * synchronously in index.html's <head> so the persisted theme and mode land
 * on <html> BEFORE first paint — the same no-flash guarantee the old inline
 * script gave, now covering theme as well as mode). That script owns:
 *
 *  - localStorage `hg_theme` ('apple'|'cyberpunk'|'retro') and `hg_mode`
 *    ('auto'|'light'|'dark') — the estate-wide keys. The legacy `bgc-theme`
 *    key is migrated once by an inline script in index.html and never
 *    written again;
 *  - stamping <html data-theme data-mode> (data-mode always RESOLVED;
 *    'auto' follows the OS live);
 *  - the `hg-themechange` event on document, fired on every change;
 *  - the theme-color meta, synced to the active theme's --et-bg by another
 *    inline script in index.html.
 *
 * This module is only the typed doorway React components use — read state,
 * write a choice, subscribe. It deliberately holds no state of its own:
 * window.estateTheme is the single source of truth, so an update from
 * anywhere (another tab's storage event does not travel, but a future second
 * control would) is one subscription away.
 */

export const ESTATE_THEMES = ['retro', 'apple', 'cyberpunk'] as const;
export type EstateTheme = (typeof ESTATE_THEMES)[number];

export const ESTATE_MODES = ['auto', 'light', 'dark'] as const;
export type EstateMode = (typeof ESTATE_MODES)[number];

export interface EstateThemeState {
  theme: EstateTheme;
  mode: EstateMode;
  resolvedMode: 'light' | 'dark';
}

interface EstateThemeApi {
  themes: string[];
  modes: string[];
  get(): EstateThemeState;
  setTheme(theme: string): void;
  setMode(mode: string): void;
}

declare global {
  interface Window {
    /** Installed by /assets/theme.js before any module runs. Optional only
     *  so a unit-test DOM without the script cannot crash the app. */
    estateTheme?: EstateThemeApi;
  }
}

/** What the app believes with no switcher present: its own identity. */
const FALLBACK: EstateThemeState = { theme: 'retro', mode: 'auto', resolvedMode: 'light' };

export function getThemeState(): EstateThemeState {
  return window.estateTheme ? window.estateTheme.get() : FALLBACK;
}

export function setTheme(theme: EstateTheme): void {
  window.estateTheme?.setTheme(theme);
}

export function setMode(mode: EstateMode): void {
  window.estateTheme?.setMode(mode);
}

/** Subscribe to any theme/mode change (user, other control, OS flip while on
 *  'auto'). Returns its own unsubscribe. */
export function onThemeChange(listener: () => void): () => void {
  document.addEventListener('hg-themechange', listener);
  return () => document.removeEventListener('hg-themechange', listener);
}
