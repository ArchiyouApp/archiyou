/**
 * state/browser.ts — browser (asset manager) UI state.
 *
 * The section is not here: it lives in the URL (/browser/{section}), so back/forward
 * and links work. What is here survives moving between sections and back from the
 * editor within a session: the search query and the sort.
 */

import { signal } from '@lit-labs/signals';

export type BrowserSortValue = 'modified' | 'name' | 'type';

export const browserSearch = signal<string>('');
export const browserSort   = signal<BrowserSortValue>('modified');

export function setBrowserSearch(q: string): void { browserSearch.set(q); }
export function setBrowserSort(sort: BrowserSortValue): void { browserSort.set(sort); }
