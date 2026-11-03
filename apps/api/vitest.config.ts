import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test boots an embedded Postgres (PGlite); under a parallel monorepo run
    // that alone can approach the 5 s default.
    testTimeout: 20_000,
    // Servers boot an in-memory Postgres in beforeAll; slow CI machines need more than 10 s.
    hookTimeout: 60_000,
  },
});
