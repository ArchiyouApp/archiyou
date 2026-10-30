/**
 * brand-colors.ts — an embedded configurator in the colours of the site around it.
 *
 * The link that opens a published configurator can name four colours (`ui.primary`,
 * `ui.secondary`, `ui.accent`, `ui.alert`; state/configurator-display). They become the design
 * tokens the configurator chrome is painted with (design-tokens.ts), set on the configurator
 * page's own element rather than on :root: from there they cascade into every shadow root below,
 * win over the root tokens, and stay when the theme switches (applyDesignTokens writes :root
 * again then). What a colour needs around it is derived here (the text colour on it, white or
 * ink, whichever reads; lighter and darker steps and the Web Awesome brand scale for primary),
 * so a site gives colours and nothing else.
 *
 *   primary    buttons, links, focus and active states: --color-primary, as everywhere
 *   secondary  the author mark in the header and the metric icons: --configurator-secondary
 *   accent     the slider thumb, the parameter tab indicator and preset buttons:
 *              --configurator-accent, and the Web Awesome focus ring
 *   alert      errors: --color-alert and --color-danger
 *
 * The --configurator-* tokens exist only when a site gives that colour; the components fall back
 * to --color-primary, so the configurator looks as it always did without them.
 */

import type { BrandColors } from '../state/configurator-display.js';

/** Ink for text on a light fill: the dark theme's text-on-primary (dark-theme.ts). */
const INK = '#0f172a';
const WHITE = '#ffffff';

/** Relative luminance of `#rrggbb` (WCAG 2). */
function luminance(hex: string): number
{
  const channel = (i: number) =>
  {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** White or ink, whichever contrasts more with `fill`. */
export function onColor(fill: string): string
{
  const l = luminance(fill);
  const white = 1.05 / (l + 0.05);
  const ink = (l + 0.05) / (luminance(INK) + 0.05);
  return white >= ink ? WHITE : INK;
}

const mix = (color: string, other: string, keep: number) => `color-mix(in oklab, ${color} ${keep}%, ${other})`;

/** The custom properties for `colors`; nothing for a colour that is not given. */
export function brandColorProperties(colors: BrandColors): Record<string, string>
{
  const { primary, secondary, accent, alert } = colors;
  return {
    ...(primary ? {
      '--color-primary':        primary,
      '--color-on-primary':     onColor(primary),
      '--color-primary-light':  mix(primary, 'white', 70),
      '--color-primary-dark':   mix(primary, 'black', 80),
      '--color-primary-subtle': mix(primary, 'var(--color-bg)', 10),
      // Web Awesome's brand scale as design-tokens.ts maps it: 95 light → 10 dark.
      '--wa-color-brand-95':      mix(primary, 'white', 70),
      '--wa-color-brand-70':      primary,
      '--wa-color-brand-60':      primary,
      '--wa-color-brand-50':      mix(primary, 'black', 80),
      '--wa-color-brand-30':      mix(primary, 'black', 60),
      '--wa-color-brand-10':      mix(primary, 'black', 40),
      '--wa-color-brand-on-loud': onColor(primary),
      '--wa-color-text-link':     primary,
      '--wa-color-focus':         primary,
    } : {}),
    ...(secondary ? {
      '--color-secondary':             secondary,
      '--configurator-secondary':      secondary,
      '--configurator-on-secondary':   onColor(secondary),
    } : {}),
    ...(accent ? {
      '--color-accent':         accent,
      '--configurator-accent':  accent,
      '--wa-color-focus':       accent,
    } : {}),
    ...(alert ? {
      '--color-alert':           alert,
      '--color-danger':          alert,
      '--configurator-on-alert': onColor(alert),
    } : {}),
  };
}

/** Every property this module may set, so removing them needs no record of what was given. */
const ALL_PROPERTIES = Object.keys(brandColorProperties({ primary: '#000000', secondary: '#000000', accent: '#000000', alert: '#000000' }));

/** Paint `host` and everything below it in `colors`; a colour not given stays Archiyou's own. */
export function applyBrandColors(host: HTMLElement, colors: BrandColors): void
{
  removeBrandColors(host);
  Object.entries(brandColorProperties(colors)).forEach(([name, value]) => host.style.setProperty(name, value));
}

/** Back to Archiyou's own colours. */
export function removeBrandColors(host: HTMLElement): void
{
  ALL_PROPERTIES.forEach(name => host.style.removeProperty(name));
}
