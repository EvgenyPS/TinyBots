import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Исходники схем, чтобы тесты не зависели от предварительной сборки dist.
const schemaEntry = fileURLToPath(new URL('./packages/schema/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@tinybots/schema': schemaEntry,
      // Тот же объект, что страница получает плагином Vite из схемы.
      'virtual:llm-preset-base-url': schemaEntry,
    },
  },
  test: {
    environment: 'node',
    include: [
      'apps/server/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'packages/schema/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
