import { ItemStore } from '@shared/itemStore'
import { backend } from '../data/backend'

export { ItemStore, PersistenceQueue, type SaveState } from '@shared/itemStore'

/** The renderer's store, writing behind to the repository in the main process. */
export const itemStore = new ItemStore(backend)
