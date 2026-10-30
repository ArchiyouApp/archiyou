/**
 * tests/brand-colors.test.ts — the design tokens an embedded configurator takes from the colours
 * in its link (styles/brand-colors), and the text colour that reads on each of them.
 */

import { describe, it, expect } from 'vitest';

import { brandColorProperties, onColor } from '../src/styles/brand-colors.js';

const NONE = { primary: null, secondary: null, accent: null, alert: null };

describe('onColor', () =>
{
  it('puts white on a dark fill and ink on a light one', () =>
  {
    expect(onColor('#1a659e')).toBe('#ffffff');
    expect(onColor('#180c2d')).toBe('#ffffff');
    expect(onColor('#f1c232')).toBe('#0f172a');
    expect(onColor('#ffffff')).toBe('#0f172a');
  });
});

describe('brandColorProperties', () =>
{
  it('sets nothing without colours', () =>
  {
    expect(brandColorProperties(NONE)).toEqual({});
  });

  it('paints the primary tokens, their text colour and the Web Awesome brand scale', () =>
  {
    const props = brandColorProperties({ ...NONE, primary: '#f1c232' });
    expect(props['--color-primary']).toBe('#f1c232');
    expect(props['--color-on-primary']).toBe('#0f172a');
    expect(props['--wa-color-brand-60']).toBe('#f1c232');
    expect(props['--wa-color-brand-on-loud']).toBe('#0f172a');
    expect(props['--wa-color-focus']).toBe('#f1c232');
    expect(props['--color-primary-light']).toContain('#f1c232');
    expect(props['--configurator-secondary']).toBeUndefined();
    expect(props['--color-alert']).toBeUndefined();
  });

  it('gives secondary, accent and alert their own roles', () =>
  {
    const props = brandColorProperties({ primary: '#1a659e', secondary: '#180c2d', accent: '#f1c232', alert: '#dc2626' });
    expect(props['--configurator-secondary']).toBe('#180c2d');
    expect(props['--configurator-on-secondary']).toBe('#ffffff');
    expect(props['--configurator-accent']).toBe('#f1c232');
    // The accent takes the focus ring over the primary.
    expect(props['--wa-color-focus']).toBe('#f1c232');
    expect(props['--color-alert']).toBe('#dc2626');
    expect(props['--color-danger']).toBe('#dc2626');
    expect(props['--configurator-on-alert']).toBe('#ffffff');
  });
});
