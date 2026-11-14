import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { backend, isDesktop } from './data/backend'
import { seedDemo } from './notes/model'
import { seed } from './notes/seed'
import { installCaret } from './editor/caret'
import { controller } from './editor/controller'
import { initSync } from './store/sync'
import { initUpdates } from './store/updates'
import './styles/app.css'

async function boot(): Promise<void> {
  // PROTOTYPE (notes/): demo notes for a browser session, never in the Mac app.
  if (seedDemo && !isDesktop) await seed()
  await controller.init()
  initSync()
  initUpdates()
  const root = createRoot(document.getElementById('root')!)
  flushSync(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
  // Land with the caret on today's blank line so typing starts immediately.
  controller.focusDefault()
  installCaret()
  performance.mark('cue:interactive')
  backend.markInteractive()
}

void boot()
