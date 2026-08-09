/**
 * Light, dark, or whatever the device says.
 *
 * ## Three, not two
 *
 * A two-state toggle cannot express *"follow my phone"*, which is what most
 * people want and what this app did before the control existed — and it is the
 * right default for a tool used in a shop in the evening. So the stored value
 * is a **choice** of three, and what lands on `<html>` is the **resolved** two.
 * Those are different things and conflating them is what makes a toggle forget
 * the user's intent the first time the OS flips at sunset.
 *
 * ## The contract with `index.html`
 *
 * ⚠️ The key and the three values are duplicated in the inline script at the
 * top of `apps/web/index.html`, and they have to stay in step. That script is
 * inline and blocking on purpose: run this after React mounts and every load in
 * dark mode flashes cream for a frame. There is no way to share a constant with
 * it without shipping a module before first paint, which is the cost the flash
 * exists to avoid — so it is written twice and said so in both places.
 */

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** What actually gets painted. `system` is never this. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'bgc-theme';

/** The page background per theme, for the browser-chrome colour on a phone. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f2e8d5',
  dark: '#1b1814',
};

/**
 * Reads the stored choice. Anything unrecognised — absent, corrupted, or from a
 * future version — falls back to `system` rather than to a fixed theme, so a
 * bad value degrades to the sensible default instead of overriding the device.
 */
export function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (THEME_CHOICES as readonly string[]).includes(raw ?? '')
      ? (raw as ThemeChoice)
      : 'system';
  } catch {
    // Safari in private mode throws on localStorage rather than returning null.
    return 'system';
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Paint it. Sets three things, and all three matter:
 *
 * - `data-theme`, which every colour in `styles.css` hangs off;
 * - `color-scheme`, without which the *browser's* own furniture — form
 *   controls, scrollbars, the caret — stays in the other theme and the page
 *   ends up half-converted;
 * - the `theme-color` meta, which on a phone is a visible band of colour above
 *   the page. A `media` attribute cannot see `data-theme`, so it is set here.
 */
export function apply(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolve(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);
  return resolved;
}

export function store(choice: ThemeChoice): void {
  try {
    // `system` is stored rather than cleared, so it survives as a deliberate
    // answer. A missing key and a chosen "follow the device" resolve the same
    // way today, and would stop doing so the moment the default changed.
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Nothing to do. The choice still applies for this session.
  }
}

/**
 * Follow the device while — and only while — the choice is `system`.
 *
 * Without this, picking "Match system" and then having the phone flip to dark
 * at sunset leaves the app in whatever it was, which reads as the setting not
 * working. Returns its own unsubscribe.
 */
export function watchSystem(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
