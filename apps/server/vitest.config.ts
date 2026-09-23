import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Each test file brings up its own PGlite database in its `beforeAll` — PostgreSQL
     * compiled to WASM, instantiated from scratch and then migrated. That is a couple of
     * seconds of real work per worker, and vitest runs the files in parallel, so on a
     * busy machine the 10s default is not enough and the suite fails with "Hook timed
     * out" rather than with anything to do with the code.
     *
     * It was fine when a `beforeAll` only had to open a SQLite file. The ceiling is
     * generous on purpose: it exists to stop a slow machine reporting a false failure,
     * not to let a genuinely hung hook sit there forever.
     */
    hookTimeout: 60_000,
  },
});
