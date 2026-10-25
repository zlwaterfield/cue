import { UPDATES_OFF, type UpdateState } from '@shared/types'
import { backend } from '../data/backend'
import { showToast, Store } from './ui'

/** The Mac app's own updates, pushed from the main process (src/main/updates.ts). */
export const updateState = new Store<UpdateState>(UPDATES_OFF)

export function initUpdates(): void {
  backend.updates.onState((state) => {
    const before = updateState.get()
    updateState.set(state)
    // Said once, when the download finishes. It installs on quit either way.
    if (state.status === 'ready' && before.status !== 'ready') showReady(state)
  })
  void backend.updates.getState().then((state) => updateState.set(state))
}

function showReady(state: UpdateState): void {
  showToast(`Cue ${state.version} is ready. It installs when you quit.`, {
    action: { label: 'Restart Now', run: () => backend.updates.install() },
    duration: 10_000
  })
}

/** Check for Updates…: checks now and says what it found. */
export async function checkForUpdates(): Promise<void> {
  if (updateState.get().status === 'ready') {
    showReady(updateState.get())
    return
  }
  showToast('Checking for updates…')
  const state = await backend.updates.check()
  if (state.status === 'downloading') showToast(`Downloading Cue ${state.version}…`)
  else if (state.status === 'error' && state.message) showToast(state.message)
  else if (state.status === 'idle') showToast(`Cue ${__APP_VERSION__} is the latest version.`)
}
