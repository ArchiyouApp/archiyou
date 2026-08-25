/**
 * Every <wa-icon> must name a library.
 *
 * Regression: Web Awesome's DEFAULT icon library resolves to
 * `https://ka-f.fontawesome.com/…/svgs/solid/<name>.svg`, and the production CSP only
 * allows `connect-src 'self' blob: data: https://cdn.jsdelivr.net https://www.gstatic.com`.
 * So a bare `<wa-icon name="eye">` fetched fine on a localhost dev server (no CSP) and
 * rendered an EMPTY <svg> on the deployed app — the scene-graph visibility toggles, the
 * split-panel grips and the param-type icons all silently vanished, with the buttons
 * still there and clickable.
 *
 * `library="lucide"` (registered in apps/editor/src/icons.ts, served from jsdelivr) is
 * the only allowed source. A `src=` icon points at its own file and needs no library.
 */

import { describe, it, expect } from 'vitest';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOTS = ['packages/ui/src', 'apps/editor/src'];

function tsFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesIn(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('wa-icon usage', () => {
  it('never falls back to the default (Font Awesome) icon library', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of tsFilesIn(join(REPO_ROOT, root))) {
        const source = readFileSync(file, 'utf8');
        for (const tag of source.match(/<wa-icon[^>]*>/g) ?? []) {
          if (tag.includes('library=') || tag.includes('src=')) continue;
          offenders.push(`${relative(REPO_ROOT, file)}: ${tag}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
