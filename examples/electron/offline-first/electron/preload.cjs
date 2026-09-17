const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  resetDatabase: () => ipcRenderer.invoke('tanstack-db:reset-database'),
  kv: {
    get: (key) => ipcRenderer.invoke('kv:get', key),
    set: (key, value) => ipcRenderer.invoke('kv:set', key, value),
    delete: (key) => ipcRenderer.invoke('kv:delete', key),
    keys: () => ipcRenderer.invoke('kv:keys'),
    clear: () => ipcRenderer.invoke('kv:clear'),
  },
})
