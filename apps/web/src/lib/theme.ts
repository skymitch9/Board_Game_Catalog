/**
 * The React side of the estate theme contract.
 *
 * The heavy lifting moved to /assets/theme.js (the estate switcher, loaded
 * synchronously in index.html's <head> so the persisted theme and mode land
 * on <html> BEFORE first paint — the same no-flash guarantee the old inline
 * script gave, now covering theme as well as mode). That script owns:
 *
 *  - THE THEME REGISTRY ITSELF (`themes`, `labels`, `label()`) — the list of
 *    themes and their human names. Since 2026-08-17 that list is read from
 *    the switcher at render time and is deliberately NOT written down here;
 *  - localStorage `hg_theme` (the site's ONE theme, owner 2026-08-14) and
 *    `hg_mode` ('auto'|'light'|'dark') — the estate-wide keys. The legacy
 *    `bgc-theme` key is migrated once, by theme.js itself since 2026-08-17
 *    (it was an inline script in index.html), and never written again;
 *  - stamping <html data-theme data-mode> (data-mode always RESOLVED;
 *    'auto' follows the OS live);
 *  - the `hg-themechange` event on document, fired on every change;
 *  - the theme-color meta, synced to the active theme's --et-bg — also
 *    theme.js's job since 2026-08-17, for the same reason.
 *
 * This module is only the typed doorway React components use — read state,
 * write a choice, subscribe. It deliberately holds no state of its own:
 * window.estateTheme is the single source of truth, so an update from
 * anywhere (another tab's storage event does not travel, but a future second
 * control would) is one subscription away.
 */

/**
 * ⚠️ NOT the theme list. This is what to offer when /assets/theme.js is
 * ABSENT — a unit-test DOM, or a load where the script 404'd — and nothing
 * else. Call `estateThemes()` instead.
 *
 * It used to BE the list, and that is exactly how this cog came to offer four
 * themes for a whole day after `hearts` shipped upstream on 2026-08-16: the
 * vendored asset was the thing anyone thought to re-copy, this constant was
 * not, and no test could tell because a written-down list is always
 * self-consistent. Owner order 2026-08-17: "when a theme is added all sites
 * get it". A list kept here is a list somebody has to remember.
 */
const FALLBACK_THEMES: readonly string[] = ['classic', 'apple', 'cyberpunk', 'retro', 'hearts'];

/**
 * A theme id. Deliberately `string`, not a union over a local array: the
 * registry lives in theme.js, and this app must be able to name and offer a
 * theme it has not heard of. A union here would make "offer whatever the
 * switcher offers" untypeable, which is what pushed the list into this file
 * in the first place.
 */
export type EstateTheme = string;

/**
 * The themes to offer, in canonical order, read from the switcher at call
 * time. THIS is the mechanism by which a new theme reaches this cog with no
 * change to this repo.
 */
export function estateThemes(): readonly string[] {
  const api = typeof window === 'undefined' ? undefined : window.estateTheme;
  return api && Array.isArray(api.themes) && api.themes.length > 0 ? api.themes : FALLBACK_THEMES;
}

/**
 * The human name for a theme id, likewise from the switcher — which degrades
 * an id it does not know to a capitalised id, so an older asset meeting a
 * newer name looks plain rather than blank.
 */
export function estateThemeLabel(theme: string): string {
  const api = typeof window === 'undefined' ? undefined : window.estateTheme;
  if (api && typeof api.label === 'function') return api.label(theme);
  return theme ? theme.charAt(0).toUpperCase() + theme.slice(1) : theme;
}

export const ESTATE_MODES = ['auto', 'light', 'dark'] as const;
export type EstateMode = (typeof ESTATE_MODES)[number];

export interface EstateThemeState {
  theme: EstateTheme;
  mode: EstateMode;
  resolvedMode: 'light' | 'dark';
}

interface EstateThemeApi {
  /** The registry, in canonical order. The reason this module has no copy. */
  themes: string[];
  modes: string[];
  /** Human names, added to canonical 2026-08-17 alongside `label()`. Optional
   *  here because an older vendored theme.js will not have them. */
  labels?: Record<string, string>;
  label?: (theme: string) => string;
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

/** Theme for the whole site — one look per site (owner, 2026-08-14). */
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
