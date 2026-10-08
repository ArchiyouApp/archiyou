import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        // every test runs the CLI as a subprocess, with a cold kernel start of a few seconds
        testTimeout: 60_000,
    },
});
