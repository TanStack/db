// Exposes real ipcRenderer calls and main-process events to the oracle page.
const { contextBridge, ipcRenderer } = require(`electron`)

contextBridge.exposeInMainWorld(`reloadBridge`, {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) =>
    ipcRenderer.on(channel, (_event, ...args) => listener(...args)),
})
