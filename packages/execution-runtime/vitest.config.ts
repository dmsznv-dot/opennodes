import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test boots an embedded Postgres (PGlite); under a parallel monorepo run
    // that alone can approach the 5 s default.
    testTimeout: 20_000,
  },
});
