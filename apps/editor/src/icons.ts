/**
 * icons.ts
 *   Register the Lucide icon library with Web Awesome.
 *   Import this module once, early in each app entry-point (before any
 *   component that uses <wa-icon library="lucide"> is rendered).
 */

import { registerIconLibrary } from '@awesome.me/webawesome/dist/webawesome.js';

registerIconLibrary('lucide', {
  resolver: (name: string) =>
    `https://cdn.jsdelivr.net/npm/lucide-static@1.16.0/icons/${name}.svg`,
});
