/**
 * tests/unit/modules/sdkTypes.sync.test.ts
 *
 * The module contract is authored in packages/module-sdk (what a module repo compiles against)
 * and mirrored into src/modules/sdkTypes.ts (what core compiles and publishes). Core cannot
 * import the package by name: it is internal and never published, so the import would dangle in
 * everything core ships. See buildscripts/sync-sdk-types.ts.
 *
 * Two copies of one contract only stay one contract if something checks. Drift is silent and
 * nasty — the engine and the modules it loads would agree on names while disagreeing on shapes.
 */
import { describe, it, expect } from 'vitest'

import { expected, actual, MIRROR, SDK_TYPES } from '../../../buildscripts/sync-sdk-types'

describe('src/modules/sdkTypes.ts', () =>
{
    it(`is a current copy of ${SDK_TYPES.split('/').slice(-3).join('/')}`, () =>
    {
        expect(actual(), `${MIRROR} is stale — run: pnpm --filter @archiyou/core sync:sdk-types`)
            .toBe(expected())
    })
})
