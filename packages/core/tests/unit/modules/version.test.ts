/**
 * tests/unit/modules/version.test.ts
 *
 * ARCHIYOU_CORE_VERSION is what every module manifest's `engine` range is checked
 * against, but it is hand-copied from package.json (core is consumed as raw TS by
 * several bundlers, so a JSON import would need extra config in each). If the two
 * drift, every module in existence is validated against a version that is not the
 * one running — silently. Hence this test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { ARCHIYOU_CORE_VERSION } from '../../../src/constants'

describe('ARCHIYOU_CORE_VERSION', () =>
{
    it('matches the version in package.json', () =>
    {
        const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'))
        expect(ARCHIYOU_CORE_VERSION).toBe(pkg.version)
    })
})
