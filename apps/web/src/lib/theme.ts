/**
 * The React side of the estate theme contract.
 *
 * The heavy lifting moved to /assets/theme.js (the estate switcher, loaded
 * synchronously in index.html's <head> so the persisted theme and mode land
 * on <html> BEFORE first paint — the same no-flash guarantee the old inline
 * script gave, now covering theme as well as mode). That script owns:
 *
 *  - localStorage `hg_theme` (site default: 'classic'|'apple'|'cyberpunk'|
 *    'retro'), `hg_theme_page` (v2: per-page overrides, JSON keyed by
 *    normalised pathname) and `hg_mode` ('auto'|'light'|'dark') — the
 *    estate-wide keys. The legacy `bgc-theme` key is migrated once by an
 *    inline script in index.html and never written again;
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

/** Canonical order (theme.js's THEMES) — the cogs render it verbatim so the
 *  estate's menus agree. Retro stays this site's DEFAULT via
 *  data-default-theme; ordering is presentation, not identity. */
export const ESTATE_THEMES = ['classic', 'apple', 'cyberpunk', 'retro'] as const;
export type EstateTheme = (typeof ESTATE_THEMES)[number];

export const ESTATE_MODES = ['auto', 'light', 'dark'] as const;
export type EstateMode = (typeof ESTATE_MODES)[number];

/** v2: where the current theme comes from — 'page' when this page carries its
 *  own override, 'site' otherwise. Mode has no scope; it is always site-wide. */
export type EstateScope = 'page' | 'site';

export interface EstateThemeState {
  theme: EstateTheme;
  mode: EstateMode;
  resolvedMode: 'light' | 'dark';
  scope: EstateScope;
  siteTheme: EstateTheme;
}

interface EstateThemeApi {
  themes: string[];
  modes: string[];
  get(): EstateThemeState;
  setTheme(theme: string): void;
  setSiteTheme(theme: string): void;
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
const FALLBACK: EstateThemeState = {
  theme: 'retro',
  mode: 'auto',
  resolvedMode: 'light',
  scope: 'site',
  siteTheme: 'retro',
};

export function getThemeState(): EstateThemeState {
  return window.estateTheme ? window.estateTheme.get() : FALLBACK;
}

/** Theme for THIS PAGE (v2 default — writes the per-path override). */
export function setTheme(theme: EstateTheme): void {
  window.estateTheme?.setTheme(theme);
}

/** Theme for ALL pages — writes the site default and clears every page
 *  override. "All pages" means all pages (estate-themes.md §2a). */
export function setSiteTheme(theme: EstateTheme): void {
  window.estateTheme?.setSiteTheme(theme);
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
