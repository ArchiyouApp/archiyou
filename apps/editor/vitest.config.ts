import { defineConfig } from 'vitest/config';

// Node environment: the suites here cover the pure logic in src/services
// (output-path expansion, output → file mapping), not components or the worker.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
