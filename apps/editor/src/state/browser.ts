/**
 * state/browser.ts — browser (asset manager) UI state.
 *
 * Stub: the browser components currently keep this state component-local
 * (search query, active tab, sort). Signals are declared here so the
 * structure is in place; wiring the components to them is a follow-up.
 */

import { signal } from '@lit-labs/signals';

export const browserSearch    = signal<string>('');
export const browserActiveTab = signal<string>('all');
export const browserSort      = signal<string>('modified');

export function setBrowserSearch(q: string): void { browserSearch.set(q); }
export function setBrowserActiveTab(tab: string): void { browserActiveTab.set(tab); }
export function setBrowserSort(sort: string): void { browserSort.set(sort); }
