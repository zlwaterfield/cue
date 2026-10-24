import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CueBridge, Item, SyncState } from '../shared/types'

/** The only surface the renderer has to the system: typed, narrow, no Node access. */

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const bridge: CueBridge = {
  platform: process.platform,
  loadDates: (dates) => ipcRenderer.invoke('items:load', dates),
  saveItems: (items) => ipcRenderer.invoke('items:save', items),
  saveItemsSync: (items) => {
    ipcRenderer.sendSync('items:saveSync', items)
  },
  search: (query, limit) => ipcRenderer.invoke('items:search', query, limit),
  datesWithItems: (from, to) => ipcRenderer.invoke('items:dates', from, to),
  datesWithOpenTodos: (from, to) => ipcRenderer.invoke('items:openTodoDates', from, to),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  exportMarkdown: () => ipcRenderer.invoke('export:markdown'),
  exportJSON: () => ipcRenderer.invoke('export:json'),
  importJSON: () => ipcRenderer.invoke('import:json'),
  revealDataFolder: () => ipcRenderer.invoke('app:revealData'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  linkPreview: (url) => ipcRenderer.invoke('links:preview', url),
  onLinkPreview: (callback) => subscribe('links:preview', callback),
  markInteractive: () => ipcRenderer.send('app:interactive'),
  onCommand: (callback) => subscribe<string>('command', callback),
  onItemsChanged: (callback) => subscribe<Item[]>('items:changed', callback),
  sync: {
    getState: () => ipcRenderer.invoke('sync:state'),
    onState: (callback) => subscribe<SyncState>('sync:state', callback),
    sendCode: (email) => ipcRenderer.invoke('sync:sendCode', email),
    verifyCode: (email, code) => ipcRenderer.invoke('sync:verifyCode', email, code),
    signInWithApple: () => ipcRenderer.invoke('sync:signInWithApple'),
    cancelSignIn: () => void ipcRenderer.invoke('sync:cancelSignIn'),
    syncNow: () => ipcRenderer.invoke('sync:now'),
    signOut: () => ipcRenderer.invoke('sync:signOut'),
    deleteAccount: () => ipcRenderer.invoke('sync:deleteAccount')
  }
}

contextBridge.exposeInMainWorld('cue', bridge)
