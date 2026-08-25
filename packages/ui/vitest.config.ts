import { defineConfig } from 'vitest/config';

// Node environment: the suites here cover pure logic (parsing/sanitisation
// helpers), not Lit components, so no DOM is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
