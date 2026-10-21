/**
 * Real Electron main process for the reload class oracle's Electron app
 * driver. It serves the real Electron main handler over the real `ipcMain`,
 * with the real Node persistence over a `node:sqlite` connection. Electron's
 * ABI cannot load better-sqlite3's native module, so a small adapter gives
 * `node:sqlite` the better-sqlite3 surface the Node driver uses. Test-only
 * channels open a new app session (a fresh main-process persistence), record
 * statements, run raw SQL, and arm the oracle's hold seams in this process,
 * where the adapter runs.
 */
import { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createNodeSQLitePersistence } from '../../../../node-db-sqlite-persistence/src'
import { exposeElectronSQLitePersistence } from '../../../src/main'
import { inProcessSeams } from '../../../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type { BetterSqlite3Database } from '../../../../node-db-sqlite-persistence/src'
import type { HeldCall } from '../../../../db-sqlite-persistence-core/tests/reload-class-oracle'

export const RESULT_PREFIX = `__TANSTACK_DB_RELOAD_CLASS__:`

function binding(value: unknown): string | number | bigint | null {
  if (value == null) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  )
    return value
  return String(value)
}

// The better-sqlite3 surface that BetterSqlite3SQLiteDriver uses.
function betterSqliteSurface(
  database: DatabaseSync,
  record: (sql: string, params: ReadonlyArray<unknown>) => void,
): BetterSqlite3Database {
  return {
    prepare: (sql: string) => {
      const statement = database.prepare(sql)
      return {
        all: (...params: Array<unknown>) => {
          record(sql, params)
          return statement
            .all(...params.map(binding))
            .map((row) => ({ ...row }))
        },
        run: (...params: Array<unknown>) => {
          record(sql, params)
          return statement.run(...params.map(binding))
        },
      }
    },
    exec: (sql: string) => {
      record(sql, [])
      database.exec(sql)
    },
    close: () => database.close(),
  } as unknown as BetterSqlite3Database
}

let window: BrowserWindow | undefined
let recording = false
let session: { close: () => void } | undefined
const holds = new Map<string, HeldCall>()

const send = (channel: string, ...args: Array<unknown>) =>
  window?.webContents.send(channel, ...args)

ipcMain.handle(`reload:session`, (_event, filename: string) => {
  session?.close()
  const database = new DatabaseSync(filename)
  const dispose = exposeElectronSQLitePersistence({
    ipcMain,
    persistence: createNodeSQLitePersistence({
      database: betterSqliteSurface(database, (sql, params) => {
        if (recording) send(`reload:sql`, sql, params)
      }),
      schemaMismatchPolicy: `reset`,
    }),
  })
  session = {
    close: () => {
      dispose()
      database.close()
    },
  }
})
ipcMain.handle(`reload:close-session`, () => {
  session?.close()
  session = undefined
})
ipcMain.handle(`reload:record`, (_event, on: boolean) => {
  recording = on
})
ipcMain.handle(
  `reload:raw`,
  (_event, filename: string, sql: string, params: Array<unknown>) => {
    const database = new DatabaseSync(filename)
    try {
      const statement = database.prepare(sql)
      return statement.columns().length > 0
        ? statement.all(...params.map(binding)).map((row) => ({ ...row }))
        : (statement.run(...params.map(binding)), [])
    } finally {
      database.close()
    }
  },
)
ipcMain.handle(`reload:raw-exec`, (_event, filename: string, sql: string) => {
  const database = new DatabaseSync(filename)
  try {
    database.exec(sql)
  } finally {
    database.close()
  }
})
ipcMain.handle(
  `reload:hold`,
  (_event, token: string, kind: `row` | `write`, storageId: string) => {
    const held =
      kind === `row`
        ? inProcessSeams.holdFirstRowSnapshot(storageId)
        : inProcessSeams.holdFirstWrite(storageId)
    holds.set(token, held)
    // Tell the renderer once the held call arrives.
    const watch = () => {
      if (!holds.has(token)) return
      if (held.isHeld()) send(`reload:held`, token)
      else setImmediate(watch)
    }
    watch()
  },
)
ipcMain.handle(`reload:release`, (_event, token: string) => {
  holds.get(token)?.release()
})
ipcMain.handle(`reload:restore`, (_event, token: string) => {
  holds.get(token)?.restore()
  holds.delete(token)
})
ipcMain.handle(`reload:result`, (_event, result: string) => {
  process.stdout.write(`${RESULT_PREFIX}${result}\n`)
  app.quit()
})

void app.whenReady().then(() => {
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: process.env.RELOAD_CLASS_PRELOAD,
      contextIsolation: true,
      sandbox: false,
    },
  })
  void window.loadFile(process.env.RELOAD_CLASS_PAGE!, {
    query: { dir: process.env.RELOAD_CLASS_DB_DIR! },
  })
})
