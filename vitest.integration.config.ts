import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Integration tests talk to the local stack (real Postgres + HTTP emulator).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    globalSetup: ['tests/integration/global-setup.ts'],
  },
});
