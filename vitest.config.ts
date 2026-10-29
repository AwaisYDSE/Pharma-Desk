import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], testTimeout: 30000, pool: 'forks', environment: 'node', setupFiles: ['tests/setup.ts'] } });
