import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { setupFiles: ['./test/env.ts'], testTimeout: 30000, hookTimeout: 60000 } });
