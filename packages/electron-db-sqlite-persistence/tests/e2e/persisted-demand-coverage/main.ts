/**
 * Real Electron main process for the persisted demand coverage witness
 * (`tests/persisted-demand-coverage.electron.e2e.test.ts`). It serves the real
 * `exposeElectronSQLitePersistence` handler over the real `ipcMain`, with the
 * real Node persistence over a `node:sqlite` connection. Electron's ABI cannot
 * load better-sqlite3's native module, so a small adapter gives `node:sqlite`
 * the better-sqlite3 surface the Node driver uses (the same adapter the reload
 * class fixture uses). The renderer asks for one database file per history
 * (`demand:session`), so each history reads and writes its own file.
 */
import { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createNodeSQLitePersistence } from '../../../../node-db-sqlite-persistence/src'
import { exposeElectronSQLitePersistence } from '../../../src/main'
import type { BetterSqlite3Database } from '../../../../node-db-sqlite-persistence/src'

export const RESULT_PREFIX = `__TANSTACK_DB_DEMAND_COVERAGE__:`

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
function betterSqliteSurface(database: DatabaseSync): BetterSqlite3Database {
  return {
    prepare: (sql: string) => {
      const statement = database.prepare(sql)
      return {
        all: (...params: Array<unknown>) =>
          statement.all(...params.map(binding)).map((row) => ({ ...row })),
        run: (...params: Array<unknown>) =>
          statement.run(...params.map(binding)),
      }
    },
    exec: (sql: string) => {
      database.exec(sql)
    },
    close: () => database.close(),
  } as unknown as BetterSqlite3Database
}

let window: BrowserWindow | undefined
let session: { close: () => void } | undefined

// One session per history file: the previous session closes first, so the
// renderer's next session is a fresh main-process persistence over that file.
ipcMain.handle(`demand:session`, (_event, filename: string) => {
  session?.close()
  const database = new DatabaseSync(filename)
  const dispose = exposeElectronSQLitePersistence({
    ipcMain,
    persistence: createNodeSQLitePersistence({
      database: betterSqliteSurface(database),
    }),
  })
  session = {
    close: () => {
      dispose()
      database.close()
    },
  }
})
ipcMain.handle(`demand:close-session`, () => {
  session?.close()
  session = undefined
})
ipcMain.handle(`demand:result`, (_event, result: string) => {
  process.stdout.write(`${RESULT_PREFIX}${result}\n`)
  app.quit()
})

void app.whenReady().then(() => {
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: process.env.DEMAND_COVERAGE_PRELOAD,
      contextIsolation: true,
      sandbox: false,
    },
  })
  void window.loadFile(process.env.DEMAND_COVERAGE_PAGE!, {
    query: {
      phase: process.env.DEMAND_COVERAGE_PHASE!,
      dir: process.env.DEMAND_COVERAGE_DIR!,
    },
  })
})
