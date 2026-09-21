/**
 * Design tokens — single source of truth for colors, typography, spacing, and radius.
 *
 * Tokens are applied as CSS custom properties on :root and mapped to
 * Web Awesome's `--wa-*` variables so WA components automatically
 * pick up the brand palette.
 */


export const tokens = {
  // --- Brand colors ---
  colorPrimary: '#2447e6',       // ==> color-primary
  colorPrimaryLight: '#4f6ef2',  // blue-500
  colorPrimaryDark: '#1b35b0',   // blue-700

  colorSecondary: '#180c2d',     // ==> color-secondary
  colorSecondaryLight: '#1e3657',  // purple-500
  colorSecondaryDark: '#180c2d',   // purple-700

  colorAccent: '#ffe200',  
  colorAvatarBg: '#f5b82e',      // brand-mark amber; avatar chips sit on it
  colorSuccess: '#16a34a',
  colorWarning: '#f59e0b',
  colorAlert: '#f10827',
  colorDanger:  '#dc2626',

  colorWhite: '#ffffff',
  colorBlack: '#000000',
  colorGray: '#f3f3f3',
  colorGrayLight: '#EEE',
  colorGrayDark: '#666',

  // --- Neutral scale (slate) ---
  colorNeutral50:  '#f8fafc',
  colorNeutral100: '#f1f5f9',
  colorNeutral200: '#e2e8f0',
  colorNeutral300: '#cbd5e1',
  colorNeutral700: '#334155',
  colorNeutral800: '#1e293b',
  colorNeutral900: '#0f172a',

  // --- Surfaces ---
  colorBg:'#FFFFFF',
  colorBgDark: '#d9d9d9',
  colorText: '#414651',
  colorTextMuted: '#999',
  colorBorder: '#cfcfcf',
  /* One step darker than the viewer's background (VIEWER_BACKGROUND_COLOR,
     #f1f5f9) on the same slate ramp, so split-pane dividers read as a seam in
     the viewer rather than a foreign grey stripe. */
  colorDivider: '#e2e8f0',

  // --- Editor chrome surfaces ---
  // The panel stack (file tab → presets → parameters → code) layers by surface
  // colour rather than by borders, so each level needs its own token.
  colorBgElevated: '#ffffff',      // panels and panel headers on top of --color-bg
  colorSurfaceSubtle: '#f7f8fb',   // unit cells, count badges, param tab strip
  colorTabStrip: '#ebe7f3',        // file tab bar *behind* the active (white) tab
  colorBgCode: '#fcfcfe',          // code editor canvas + gutter
  colorPrimarySubtle: '#eef1fe',   // tinted fill for primary-coloured chrome
  colorOnPrimary: '#ffffff',       // text/icons on a --color-primary fill
  colorSuccessSubtle: '#e8f5ee',   // "ran OK" pill behind the execution time
  colorTextGray: '#6c7285',        // secondary label text

  // --- Code syntax palette ---
  // Drives the editor's highlight style. Kept here (not in the component) so
  // both themes define the same set; the dark values mirror One Dark, which is
  // what the editor still swaps to for its dark syntax colours.
  colorCodeComment: '#8a8fa0',
  colorCodeKeyword: '#7c3aed',
  colorCodeString:  '#c2410c',
  colorCodeNumber:  '#0f766e',
  colorCodeIdent:   '#1b1d29',   // callees, definitions, property names


  // --- Typography ---
  // See index.html to load the corresponding Google Fonts families
  fontDisplay: "'Outfit', system-ui, sans-serif", // headlines, display text
  fontSans: "'Plus Jakarta Sans', system-ui, sans-serif", // body text, UI (used to be Inter)
  fontMono: "monospace, 'Inconsolata', 'JetBrains Mono', 'Fira Code', monospace", // code, data
  fontSizeBase: '16px',
  lineHeightBase: '1.5',

  // --- Text sizing (Tailwind-inspired, rem) ---
  textXXs:   '0.625rem',  // 10px — every call site already wrote this as its fallback
  textXs:   '0.75rem',    // 12px
  textSm:   '0.875rem',   // 14px
  textBase: '1rem',       // 16px
  textLg:   '1.125rem',   // 18px
  textXl:   '1.25rem',    // 20px
  text2xl:  '1.5rem',     // 24px
  text3xl:  '1.875rem',   // 30px
  text4xl:  '2.25rem',    // 36px
  text5xl:  '3rem',       // 48px

  // --- Spacing scale (8-pt) ---
  spaceXs: '4px',
  spaceSm: '8px',
  spaceMd: '12px',
  spaceLg: '16px',
  spaceXl: '24px',
  space2xl: '32px', 
  space3xl: '48px',
  space4xl: '64px',
  space5xl: '96px',

  // --- Chrome sizing ---
  // Split-pane divider track. Wide enough that the 16px grip icon sits in its
  // own column instead of spilling over the panes either side of it.
  sizeDivider: '12px',

  // --- Radius ---
  radiusSm: '4px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusFull: '9999px',
} as const;

/** Convert camelCase token key to --kebab-case CSS var name. */
function toVar(key: string): string {
  return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Inject all tokens as CSS custom properties on :root. */
export function applyDesignTokens(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(toVar(key), value);
  }

  // ---------------------------------------------------------------------------
  // Map to Web Awesome design tokens
  // https://webawesome.com/docs/tokens/
  // ---------------------------------------------------------------------------

  // --- Brand color scale (--wa-color-brand-{tint}) ---
  // Map our primary color to the mid-range tints; WA uses 05 (dark) → 95 (light)
  root.style.setProperty('--wa-color-brand-95', tokens.colorPrimaryLight);
  root.style.setProperty('--wa-color-brand-70', tokens.colorPrimary);
  root.style.setProperty('--wa-color-brand-60', tokens.colorPrimary);
  root.style.setProperty('--wa-color-brand-50', tokens.colorPrimaryDark);
  root.style.setProperty('--wa-color-brand-30', tokens.colorSecondary);
  root.style.setProperty('--wa-color-brand-10', tokens.colorSecondaryDark);

  // --- Neutral color scale (--wa-color-neutral-{tint}) ---
  // WA scale: 05 = darkest → 95 = lightest
  root.style.setProperty('--wa-color-neutral-95', tokens.colorNeutral50);
  root.style.setProperty('--wa-color-neutral-80', tokens.colorNeutral100);
  root.style.setProperty('--wa-color-neutral-70', tokens.colorNeutral200);
  root.style.setProperty('--wa-color-neutral-60', tokens.colorNeutral300);
  root.style.setProperty('--wa-color-neutral-20', tokens.colorNeutral700);
  root.style.setProperty('--wa-color-neutral-10', tokens.colorNeutral800);
  root.style.setProperty('--wa-color-neutral-05', tokens.colorNeutral900);

  // --- Semantic status scales ---
  root.style.setProperty('--wa-color-success-60', tokens.colorSuccess);
  root.style.setProperty('--wa-color-success-50', tokens.colorSuccess);
  root.style.setProperty('--wa-color-warning-60', tokens.colorWarning);
  root.style.setProperty('--wa-color-warning-50', tokens.colorWarning);
  root.style.setProperty('--wa-color-danger-60',  tokens.colorDanger);
  root.style.setProperty('--wa-color-danger-50',  tokens.colorDanger);

  // --- Foundational surface colors ---
  root.style.setProperty('--wa-color-surface-raised',  tokens.colorBgDark);
  root.style.setProperty('--wa-color-surface-default', tokens.colorBg);
  root.style.setProperty('--wa-color-surface-lowered', tokens.colorBg);
  root.style.setProperty('--wa-color-surface-border',  tokens.colorBorder);

  // --- Text colors ---
  root.style.setProperty('--wa-color-text-normal', tokens.colorText);
  root.style.setProperty('--wa-color-text-quiet',  tokens.colorTextMuted);
  root.style.setProperty('--wa-color-text-link',   tokens.colorPrimary);

  // --- Typography ---
  root.style.setProperty('--wa-font-family-body',    tokens.fontSans);
  root.style.setProperty('--wa-font-family-heading', tokens.fontSans);
  root.style.setProperty('--wa-font-family-code',    tokens.fontMono);

  // --- Border radius ---
  root.style.setProperty('--wa-border-radius-s', tokens.radiusSm);
  root.style.setProperty('--wa-border-radius-m', tokens.radiusMd);
  root.style.setProperty('--wa-border-radius-l', tokens.radiusLg);
  root.style.setProperty('--wa-border-radius-pill', tokens.radiusFull);

  // --- Accent / highlight ---
  root.style.setProperty('--wa-color-focus', tokens.colorAccent);
}
