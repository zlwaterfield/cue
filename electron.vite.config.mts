import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'electron-vite'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { externalizeDeps: true }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: true,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } }
    }
  },
  renderer: {
    resolve: { alias: shared },
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { target: 'chrome140', minify: true }
  }
})
