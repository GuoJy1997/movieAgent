import { defineConfig } from 'vitest/config';

// Mounted renderer tests use a local headless Chromium, without launching Electron.
export default defineConfig({
  test: { include: ['tests/renderer/**/*.test.ts'], testTimeout: 10_000, hookTimeout: 30_000, fileParallelism: false },
});
