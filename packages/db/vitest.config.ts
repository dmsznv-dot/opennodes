import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Each test starts an in-memory Postgres (PGlite); on a busy CI machine that alone can
    // take over 10 s, vitest's default for hooks.
    hookTimeout: 60000,
  },
});
