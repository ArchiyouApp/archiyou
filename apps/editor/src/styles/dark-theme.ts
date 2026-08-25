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
  '--color-bg-code':     '#1e293b',
  '--color-gray':        '#1e293b',  // was #f3f3f3 — panel headers / title-bars
  '--color-gray-light':  '#273548',  // was #EEE — tab bars
  '--color-gray-dark':   '#94a3b8',  // was #666 — icon / muted text (must be light here)
  '--color-divider':     '#334155',  // was #e0e0e0
  '--color-border':      '#334155',  // neutral-700

  // --- Text ---
  '--color-text':        '#f8fafc',  // neutral-50
  '--color-text-muted':  '#94a3b8',  // neutral-400

  // --- Accent / links — a lighter blue so "blue letters" read on dark ---
  '--color-primary':        '#60a5fa',  // blue-400 (was #103eaa, too dark on dark)
  '--color-primary-subtle': '#1e3a5f',

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
  root.removeAttribute('data-theme');
  // Re-apply light defaults for the overridden vars
  applyDesignTokens(root);
  _emitThemeChange(false);
}

/** Returns true if dark mode is currently active. */
export function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** Apply dark theme if OS prefers dark and no explicit override is set. */
export function applySystemTheme(): void {
  if (!document.documentElement.hasAttribute('data-theme')) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      applyDarkTheme();
    }
  }
}

function _emitThemeChange(dark: boolean): void {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { dark } }));
}
