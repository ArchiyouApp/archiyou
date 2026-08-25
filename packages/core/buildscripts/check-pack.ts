/**
 *  check-pack.ts
 *
 *  Asserts the shape of the tarball `pnpm pack` would produce. Nothing in the monorepo
 *  imports the built `dist` entry — the workspace resolves @archiyou/core to src/ — so this
 *  script is the only coverage the published artifact gets.
 *
 *  What it is guarding against, all of which have bitten this package or meshup before:
 *
 *    - `publishConfig` silently not applying. The workspace manifest points `exports` at
 *      ./src/index.ts so apps/editor can import core without a build step; only pnpm's
 *      publishConfig swap re-points it at ./dist. If pnpm ever stops honouring
 *      publishConfig.exports the tarball ships raw TypeScript as its entry and every
 *      consumer breaks at import time.
 *    - a workspace package that is not published coming back as a `dependency`, which makes
 *      every `npm install @archiyou/core` 404. @archiyou/collada-wasm and @archiyou/gdrr2bp-wasm
 *      were that case until they were published; @archiyou/module-sdk still is.
 *    - tsup `splitting` getting turned off, which inlines the base64 WASM blobs and the brep
 *      kernel into the entry — several MB that consumers who never touch them still download.
 *    - the two build-time asset trees going missing. src/materials/MaterialManager.ts and
 *      src/modeler/brep/OcLoader.js both resolve `new URL(..., import.meta.url)` against
 *      dist/, and consumer bundlers resolve those at BUILD time. A missing file is a
 *      "Module not found" in the consumer's build that no runtime fallback can rescue.
 *    - the worker entry still pointing at ./runner.worker.ts (see tsup.config.ts onSuccess).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_PACKED_MB = 60;

/** dist/index.js is ~7 KB with the lazy chunks split out, multiple MB with them inlined.
 *  Anything near the upper number means tsup `splitting` got turned off. */
const MAX_ENTRY_KB = 512;

const MUST_INCLUDE = [
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/dist/runner.worker.js',
    'package/dist/wasm/archiyou-opencascade.wasm',
    // The module contract core owns a copy of — see buildscripts/sync-sdk-types.ts.
    'package/src/modules/sdkTypes.ts',
    // OCCT ships in this tarball (dist/wasm/archiyou-opencascade.wasm) under LGPL-2.1, which
    // obliges its license text to travel with it. `files` admits these through src/**/*.txt —
    // drop that pattern and the tarball is out of compliance with nothing else to notice.
    'package/src/modeler/brep/wasm/LICENSE_LGPL_21.txt',
    'package/src/modeler/brep/wasm/OCCT_LGPL_EXCEPTION.txt',
    'package/src/index.ts',
    'package/LICENSE',
    'package/NOTICE',
    'package/ATTRIBUTION.md',
    // `files` lists it, so a missing README is silent — and an npm page with no readme is
    // the first thing anyone sees of the package.
    'package/README.md',
];

const MUST_EXCLUDE = [
    'package/tests/',
    'package/examples/',
    'package/vite.config.ts',
    'package/vitest.config.ts',
    'package/tsup.config.ts',
];

/** Unpublished workspace packages. Must never be runtime dependencies. */
const MUST_NOT_BE_DEPS = ['@archiyou/module-sdk'];

/** Published workspace packages core depends on. A `workspace:` protocol left in the packed
 *  manifest means pnpm did not rewrite it to a real version, and the tarball is uninstallable. */
const MUST_BE_REAL_DEPS = ['@archiyou/meshup', '@archiyou/collada-wasm', '@archiyou/gdrr2bp-wasm'];

/** @archiyou/module-sdk is internal to the monorepo and never published, so nothing in the
 *  tarball may name it: an import of it resolves to nothing for a consumer, and every module
 *  type in core's public surface then quietly degrades to `any`. Core owns a copy of the
 *  contract instead (src/modules/sdkTypes.ts, kept in sync by buildscripts/sync-sdk-types.ts),
 *  so a hit here means an import slipped back in. Tests keep using the package name — they are
 *  not published, which is why this looks at the tarball rather than the working tree. */
const MUST_NOT_BE_NAMED = '@archiyou/module-sdk';

const fail: string[] = [];
const out = mkdtempSync(join(tmpdir(), 'ay-core-pack-'));

try
{
    const packed = execFileSync('pnpm', ['pack', '--pack-destination', out], { encoding: 'utf8' })
        .trim().split('\n').filter(l => l.endsWith('.tgz')).pop();
    if (!packed) { throw new Error('could not find the .tgz path in `pnpm pack` output'); }

    const files = execFileSync('tar', ['-tzf', packed], { encoding: 'utf8' }).split('\n');
    const sizeMB = execFileSync('stat', ['-c', '%s', packed], { encoding: 'utf8' }).trim();

    for (const f of MUST_INCLUDE)
    {
        if (!files.includes(f)) { fail.push(`missing from tarball: ${f}`); }
    }
    for (const p of MUST_EXCLUDE)
    {
        const hit = files.find(f => f.startsWith(p));
        if (hit) { fail.push(`should not be published: ${hit}`); }
    }
    if (!files.some(f => f.startsWith('package/dist/textures/') && f.endsWith('.jpg')))
    {
        fail.push('no material textures under dist/textures/ — MaterialManager cannot resolve them');
    }

    const mb = Number(sizeMB) / 1024 / 1024;
    if (mb > MAX_PACKED_MB) { fail.push(`tarball is ${mb.toFixed(1)} MB, over the ${MAX_PACKED_MB} MB budget`); }

    // Unpack just the manifest and the entry to check their contents.
    execFileSync('tar', ['-xzf', packed, '-C', out, 'package/package.json', 'package/dist/index.js']);
    const m = JSON.parse(readFileSync(join(out, 'package/package.json'), 'utf8'));

    if (m.exports?.['.']?.default !== './dist/index.js')
    {
        fail.push(`packed exports["."] is ${JSON.stringify(m.exports?.['.'])}, expected ./dist/index.js `
            + `— publishConfig did not apply, so the tarball ships TypeScript as its entry`);
    }
    if (m.exports?.['./src/*'] !== './src/*.ts')
    {
        fail.push(`packed exports["./src/*"] is ${m.exports?.['./src/*']}, expected ./src/*.ts`);
    }
    for (const d of MUST_NOT_BE_DEPS)
    {
        if (m.dependencies?.[d]) { fail.push(`${d} is unpublished and must not be a dependency (keep it a devDependency so it gets bundled)`); }
    }
    for (const d of MUST_BE_REAL_DEPS)
    {
        const range = m.dependencies?.[d];
        if (!range) { fail.push(`${d} is missing from dependencies — core imports it and does not bundle it`); }
        else if (range.startsWith('workspace:')) { fail.push(`${d} is still "${range}" in the packed manifest; pnpm did not substitute a version`); }
    }

    // Both halves of what core ships as code — the emitted declarations and the TypeScript
    // sources published for Node users — are checked, since either can carry the import.
    const sources = files.filter(f => f.endsWith('.ts'));
    if (sources.length)
    {
        execFileSync('tar', ['-xzf', packed, '-C', out, ...sources]);
        const leaked = sources.filter(f => readFileSync(join(out, f), 'utf8').includes(MUST_NOT_BE_NAMED));
        if (leaked.length)
        {
            fail.push(`${leaked.length} published file(s) name ${MUST_NOT_BE_NAMED}, which is not published `
                + `(import from src/modules/sdkTypes instead): ${leaked.slice(0, 5).join(', ')}`);
        }
    }

    const entry = readFileSync(join(out, 'package/dist/index.js'), 'utf8');
    const entryKB = Buffer.byteLength(entry) / 1024;
    if (entryKB > MAX_ENTRY_KB) { fail.push(`dist/index.js is ${entryKB.toFixed(0)} KB, over ${MAX_ENTRY_KB} KB — tsup splitting is probably off`); }
    if (entry.includes('./runner.worker.ts')) { fail.push('dist/index.js still points at ./runner.worker.ts; the onSuccess rewrite in tsup.config.ts did not run'); }

    console.log(`packed ${mb.toFixed(1)} MB, ${files.filter(Boolean).length} files, entry ${entryKB.toFixed(1)} KB`);
}
finally
{
    rmSync(out, { recursive: true, force: true });
}

if (fail.length)
{
    console.error('\ncheck-pack FAILED:');
    for (const f of fail) { console.error(`  - ${f}`); }
    process.exit(1);
}
console.log('check-pack OK');
