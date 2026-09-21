/**
 * Dark theme token overrides.
 *
 * Applied when:
 *  - <html data-theme="dark"> is set (manual toggle), OR
 *  - prefers-color-scheme: dark media query matches
 *
 * Call `applyDarkTheme()` on the manual toggle and
 * `removeDarkTheme()` to revert to light.
 */

import { applyDesignTokens } from './design-tokens.js';

/** Fired on <window> whenever the theme is toggled, so non-CSS consumers
 *  (e.g. the WebGL viewer) can react. `detail.dark` is the new state. */
export const THEME_CHANGE_EVENT = 'ay-theme-change';

const darkOverrides: Record<string, string> = {
  // --- Surfaces & chrome (our own --color-* tokens) ---
  '--color-bg':          '#0f172a',  // neutral-900
  '--color-bg-dark':     '#1e293b',  // was light-grey #d9d9d9 (dialogs/raised)
  '--color-bg-elevated': '#1e293b',  // neutral-800
  '--color-bg-code':     '#161f2f',  // one step under the panels, as in light
  '--color-surface-subtle': '#273548',
  '--color-tab-strip':      '#172033',  // recedes behind the active (elevated) tab
  '--color-text-gray':      '#94a3b8',
  // Brand mark: the same amber in both themes, it is an identity colour.
  '--color-avatar-bg':      '#f5b82e',

  // --- Code syntax palette (One Dark's, so the tokens stay truthful in both
  //     themes even though dark mode applies oneDark's own highlight style) ---
  '--color-code-comment': '#7d8799',
  '--color-code-keyword': '#c678dd',
  '--color-code-string':  '#98c379',
  '--color-code-number':  '#d19a66',
  '--color-code-ident':   '#61afef',
  '--color-gray':        '#1e293b',  // was #f3f3f3 — panel headers / title-bars
  '--color-gray-light':  '#273548',  // was #EEE — tab bars
  '--color-gray-dark':   '#94a3b8',  // was #666 — icon / muted text (must be light here)
  // Stays lighter than both the dark viewer (#0f172a) and the panels (#1e293b),
  // so the seam reads against either; the light-mode "darker than the viewer"
  // rule would land on near-black here.
  '--color-divider':     '#334155',  // was #e0e0e0
  '--color-border':      '#334155',  // neutral-700

  // --- Text ---
  '--color-text':        '#f8fafc',  // neutral-50
  '--color-text-muted':  '#94a3b8',  // neutral-400

  // --- Accent / links — a lighter blue so "blue letters" read on dark ---
  '--color-primary':        '#7c9bff',  // lightened #2447e6 — reads on dark
  '--color-primary-subtle': '#1e2d5c',
  // The dark-mode primary is lightened so blue *text* reads on a dark ground,
  // which leaves it too pale to carry white text when used as a *fill*.
  '--color-on-primary':     '#0f172a',
  '--color-success-subtle': '#12312a',

  // --- Web Awesome surface tokens (dialogs, popovers, dropdowns, inputs) ---
  '--wa-color-surface-default': '#0f172a',
  '--wa-color-surface-raised':  '#1e293b',
  '--wa-color-surface-lowered': '#0b1220',
  '--wa-color-surface-border':  '#334155',
  '--wa-color-text-normal':     '#f8fafc',
  '--wa-color-text-quiet':      '#94a3b8',
  '--wa-color-text-link':       '#60a5fa',

  // --- Web Awesome neutral scale (05 darkest → 95 lightest in light mode).
  //     Inverted here so WA-derived fills/borders/hovers are dark. ---
  '--wa-color-neutral-95': '#1e293b',
  '--wa-color-neutral-80': '#273548',
  '--wa-color-neutral-70': '#334155',
  '--wa-color-neutral-60': '#475569',
  '--wa-color-neutral-20': '#cbd5e1',
  '--wa-color-neutral-10': '#e2e8f0',
  '--wa-color-neutral-05': '#f8fafc',
};

export function applyDarkTheme(root: HTMLElement = document.documentElement): void {
  for (const [prop, value] of Object.entries(darkOverrides)) {
    root.style.setProperty(prop, value);
  }
  root.setAttribute('data-theme', 'dark');
  _emitThemeChange(true);
}

export function removeDarkTheme(root: HTMLElement = document.documentElement): void {
  for (const prop of Object.keys(darkOverrides)) {
    root.style.removeProperty(prop);
  }
  // Explicit 'light' rather than removing the attribute: consumers (the code
  // editor, the 3D viewer) read data-theme to decide, and an absent attribute
  // used to leave them falling back to prefers-color-scheme — so picking Light
  // on a dark OS gave a light UI with a dark editor.
  root.setAttribute('data-theme', 'light');
  // Re-apply light defaults for the overridden vars
  applyDesignTokens(root);
  _emitThemeChange(false);
}

/** Returns true if dark mode is currently active. */
export function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ── Theme preference ─────────────────────────────────────────────────────────
// Three states, as the user menu offers: an explicit Light or Dark, or System,
// which follows the OS and keeps following it while the preference stands.

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'archiyou:theme';

/** The stored preference; 'system' when never set or unreadable. */
export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  }
  catch { /* storage blocked (private window, embedded frame) — fall through */ }
  return 'system';
}

/** Store a preference and apply it immediately. */
export function setThemePreference(preference: ThemePreference): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, preference); }
  catch { /* not persisting is survivable; still apply it for this session */ }
  _applyPreference(preference);
}

function _systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function _applyPreference(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && _systemPrefersDark());
  if (dark) applyDarkTheme();
  else removeDarkTheme();
}

let _systemWatcher: MediaQueryList | null = null;

/** Startup: apply the stored preference, and keep 'system' tracking the OS. */
export function applyStoredTheme(): void {
  _applyPreference(getThemePreference());

  if (!_systemWatcher) {
    _systemWatcher = window.matchMedia('(prefers-color-scheme: dark)');
    _systemWatcher.addEventListener('change', () => {
      // Only 'system' follows the OS; an explicit choice stands.
      if (getThemePreference() === 'system') _applyPreference('system');
    });
  }
}

function _emitThemeChange(dark: boolean): void {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { dark } }));
}
