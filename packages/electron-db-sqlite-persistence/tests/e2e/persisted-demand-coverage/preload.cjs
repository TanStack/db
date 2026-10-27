// Exposes the one IPC call the persisted demand coverage driver needs.
const { contextBridge, ipcRenderer } = require(`electron`)

contextBridge.exposeInMainWorld(`demandBridge`, {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
})
