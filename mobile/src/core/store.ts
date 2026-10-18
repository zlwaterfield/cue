import { useSyncExternalStore } from 'react'

/** Small observable store + hook; enough for app-level state. Same shape as the Mac app's. */
export class Store<T> {
  private listeners = new Set<() => void>()

  constructor(private state: T) {}

  get(): T {
    return this.state
  }

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    let changed = false
    for (const key in next) {
      if (!Object.is(next[key], this.state[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}
