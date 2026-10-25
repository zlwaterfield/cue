import { SYNC_OFF, type SyncState } from '@shared/types'
import { backend } from '../data/backend'
import { Store } from './ui'

/** Sync state pushed from the main process. The editor never reads it. */
export const syncState = new Store<SyncState>(SYNC_OFF)

export function initSync(): void {
  backend.sync.onState((state) => syncState.set(state))
  void backend.sync.getState().then((state) => syncState.set(state))
}

/** Re-read state (e.g. the pending count) when the settings open. */
export function refreshSync(): void {
  void backend.sync.getState().then((state) => syncState.set(state))
}
