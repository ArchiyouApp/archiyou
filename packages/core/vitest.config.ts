import { defineConfig } from 'vitest/config'

// Two groups, because they fail for different reasons and are debugged
// differently:
//
//   unit       - the kernel and runtime suites. Fast, hermetic, no I/O beyond
//                tests/fixtures. This is the suite to run while editing src/.
//   cadscripts - end-to-end runs of the CAD scripts in tests/cadscripts/scripts/
//                through the Runner, writing models to tests/outputs/. A red
//                test here usually means a script needs updating, not that the
//                kernel regressed.
//
// `pnpm test` is the unit project alone; `pnpm test:all` runs both, tagged
// [unit] / [cadscripts] in the output.
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['tests/unit/**/*.{test,spec}.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'cadscripts',
                    include: ['tests/cadscripts/**/*.{test,spec}.ts'],
                    // A single script run is whole-model geometry, not a unit assertion.
                    testTimeout: 60_000,
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: [],
        },
    },
})
