import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    viewport: { width: 1440, height: 900 },
  },
})
