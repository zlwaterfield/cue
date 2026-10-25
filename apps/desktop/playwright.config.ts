import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: 3,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
