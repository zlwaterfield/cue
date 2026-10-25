import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'electron-vite'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

const shared = { '@shared': resolve(import.meta.dirname, '../../core') }

// The shared core sits outside this app's folder, so the packages it imports would otherwise
// be looked for next to it and not found. Resolving them from here means one copy in the
// bundle, the one installed for this app — the same rule apps/mobile/metro.config.js follows.
const sharedDeps = ['@supabase/supabase-js', 'fractional-indexing']

export default defineConfig(({ mode }) => {
  // The sync server is optional. Set CUE_SUPABASE_URL and CUE_SUPABASE_KEY in the
  // environment or in .env.<mode>.local to build a Cue that offers sync: `pnpm dev` is
  // development, `pnpm dist` is production, and the e2e tests build as test (docs/SYNC.md).
  const env = { ...loadEnv(mode, import.meta.dirname, 'CUE_'), ...process.env }
  return {
    main: {
      resolve: { alias: shared, dedupe: sharedDeps },
      define: {
        __CUE_SUPABASE_URL__: JSON.stringify(env.CUE_SUPABASE_URL ?? ''),
        __CUE_SUPABASE_KEY__: JSON.stringify(env.CUE_SUPABASE_KEY ?? '')
      },
      build: { externalizeDeps: true }
    },
    preload: {
      resolve: { alias: shared, dedupe: sharedDeps },
      build: {
        externalizeDeps: true,
        rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } }
      }
    },
    renderer: {
      resolve: { alias: shared, dedupe: sharedDeps },
      plugins: [react()],
      define: { __APP_VERSION__: JSON.stringify(version) },
      build: { target: 'chrome140', minify: true }
    }
  }
})
