import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/media/**/*.test.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 120000, hookTimeout: 120000 } });
