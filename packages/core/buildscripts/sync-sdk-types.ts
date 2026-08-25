/**
 *  sync-sdk-types.ts
 *
 *  Copies the module contract from packages/module-sdk into core's own source as
 *  src/modules/sdkTypes.ts, and — with --check — asserts the copy is current.
 *
 *  Why a copy at all: the SDK package is internal and never published, while @archiyou/core is
 *  published and types its module surface against that contract. As long as core's sources said
 *
 *      import type { AyModuleCatalogEntry } from '@archiyou/module-sdk';
 *
 *  everything core ships — the emitted .d.ts AND the src/***.ts it publishes for Node users —
 *  named a package no consumer can install, and TypeScript quietly resolved those names to `any`.
 *  Owning the file removes the dangling name from every artifact, with no build step involved.
 *
 *  Why the SDK stays the source of truth: a module repository compiles against
 *  @archiyou/module-sdk alone and must not pull in the engine to typecheck (see the header of
 *  packages/module-sdk/src/types.ts). Inverting the direction would put core in every module
 *  repo's dependency graph. So the contract is authored there and mirrored here.
 *
 *  The copy is VERBATIM below a header, so the check is an exact comparison rather than a
 *  judgement call, and reviewing a contract change means reading one diff twice.
 *
 *    pnpm --filter @archiyou/core sync:sdk-types     # regenerate after editing the contract
 *    pnpm --filter @archiyou/core check:sdk-types    # fail if the mirror is stale
 *
 *  tests/unit/modules/sdkTypes.sync.test.ts runs the same check, so an edit to one file and not
 *  the other fails in the normal test loop; `prepublishOnly` runs it again before a release.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Authored contract, and the mirror core compiles against. Exported so the unit test asserts
 *  exactly what this script writes. */
export const SDK_TYPES = resolve(CORE, '../module-sdk/src/types.ts');
export const MIRROR = resolve(CORE, 'src/modules/sdkTypes.ts');

/** Deliberately spells the SDK by PATH, never as a package specifier: check-pack.ts fails the
 *  release if any published file mentions the unpublishable package name, and this file is
 *  published. */
const HEADER =
`/**
 *  sdkTypes.ts — GENERATED, do not edit.
 *
 *  A verbatim copy of packages/module-sdk/src/types.ts, which is where the module contract is
 *  authored. It is copied in because that package is internal to the Archiyou monorepo and is
 *  never published, while this one is: importing it by name would leave every published
 *  declaration pointing at a package no consumer can install.
 *
 *  Edit the original, then run:  pnpm --filter @archiyou/core sync:sdk-types
 */

`;

export function expected(): string
{
    return HEADER + readFileSync(SDK_TYPES, 'utf8');
}

export function actual(): string | null
{
    try { return readFileSync(MIRROR, 'utf8'); }
    catch { return null; }
}

// Run as a script, not imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    const want = expected();

    if (process.argv.includes('--check'))
    {
        const have = actual();
        if (have === want) { console.log('sync-sdk-types: src/modules/sdkTypes.ts is current'); }
        else
        {
            console.error(
                `sync-sdk-types: src/modules/sdkTypes.ts is ${have === null ? 'missing' : 'stale'}.\n`
                + `  The module contract in packages/module-sdk/src/types.ts changed without the copy core\n`
                + `  compiles and publishes being updated — the two would describe different modules.\n`
                + `  Fix: pnpm --filter @archiyou/core sync:sdk-types`);
            process.exit(1);
        }
    }
    else
    {
        writeFileSync(MIRROR, want);
        console.log('sync-sdk-types: wrote src/modules/sdkTypes.ts');
    }
}
