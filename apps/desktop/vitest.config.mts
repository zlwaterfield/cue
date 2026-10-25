import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, '../../core') },
    // As in electron.vite.config.mts: the packages the shared core imports come from the
    // copies installed for this app, not from next to the core.
    dedupe: ['@supabase/supabase-js', 'fractional-indexing']
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // The slowest tests here take about a second on a developer's Mac, which leaves little
    // room under vitest's 5s default on a shared CI runner: whichever test is unlucky when
    // the runner is busy fails on the clock rather than on its behaviour. How fast the
    // machine is isn't a property of the code, so give CI room and keep the short default
    // where the tests are being written.
    testTimeout: process.env.CI ? 30_000 : 5_000
  }
})
