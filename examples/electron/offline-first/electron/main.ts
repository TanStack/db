import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { createNodeSQLitePersistence } from '@tanstack/node-db-persistence'
import { exposeElectronSQLitePersistence } from '@tanstack/electron-db-persistence'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Open SQLite database in Electron's user data directory
const dbPath = path.join(app.getPath('userData'), 'todos.sqlite')
console.log(`[Main] SQLite database path: ${dbPath}`)

const database = new Database(dbPath)

// Create persistence adapter from better-sqlite3 database
const persistence = createNodeSQLitePersistence({ database })

// Expose persistence over IPC so the renderer can use it
exposeElectronSQLitePersistence({ ipcMain, persistence })

// ── Key-value store for offline transaction outbox ──
// Uses a simple SQLite table so pending mutations survive app restarts.
database.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)

ipcMain.handle('kv:get', (_e, key: string) => {
  const row = database
    .prepare('SELECT value FROM kv_store WHERE key = ?')
    .get(key) as { value: string } | undefined
  console.log(
    `[KV] get "${key}" → ${row ? `found (${row.value.length} chars)` : 'null'}`,
  )
  return row?.value ?? null
})

ipcMain.handle('kv:set', (_e, key: string, value: string) => {
  console.log(`[KV] set "${key}" (${value.length} chars)`)
  database
    .prepare(
      'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value)
})

ipcMain.handle('kv:delete', (_e, key: string) => {
  console.log(`[KV] delete "${key}"`)
  database.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
})

ipcMain.handle('kv:keys', () => {
  const rows = database.prepare('SELECT key FROM kv_store').all() as Array<{
    key: string
  }>
  console.log(`[KV] keys → [${rows.map((r) => `"${r.key}"`).join(', ')}]`)
  return rows.map((r) => r.key)
})

ipcMain.handle('kv:clear', () => {
  database.exec('DELETE FROM kv_store')
})

// Reset: drop all tables from the SQLite database
ipcMain.handle('tanstack-db:reset-database', () => {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>
  for (const { name } of tables) {
    database.prepare(`DROP TABLE IF EXISTS "${name}"`).run()
  }
  console.log('[Main] Database reset — all tables dropped')
})

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })

  // Dev: load Vite dev server. Prod: load built files.
  if (process.env.NODE_ENV !== 'production') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  // Add a menu with "New Window" so cross-window sync can be tested.
  // BroadcastChannel only works between windows in the same Electron process,
  // so opening a second `electron .` process won't sync — use this menu instead.
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { role: 'close' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (_item, win) => win?.webContents.toggleDevTools(),
        },
        { role: 'reload' },
        { role: 'forceReload' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  database.close()
})
