import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Исходники схем, чтобы тесты не зависели от предварительной сборки dist.
const schemaEntry = fileURLToPath(new URL('./packages/schema/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@tinybots/schema': schemaEntry,
    },
  },
  test: {
    environment: 'node',
    include: [
      'apps/server/src/**/*.test.ts',
      'packages/schema/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
