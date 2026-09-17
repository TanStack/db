import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type TestDatabaseImplementation =
  | { type: 'better-sqlite3' }
  | { type: 'node:sqlite' }

function canLoadBetterSqlite3(): boolean {
  try {
    const Database = require(`better-sqlite3`) as new (path: string) => {
      close: () => void
    }
    const db = new Database(`:memory:`)
    db.close()
    return true
  } catch {
    return false
  }
}

function canUseNodeSqlite(): boolean {
  try {
    const { DatabaseSync } = require(`node:sqlite`) as {
      DatabaseSync: new (path: string) => {
        prepare: (query: string) => { setReturnArrays?: unknown }
        close: () => void
      }
    }
    const db = new DatabaseSync(`:memory:`)
    try {
      const stmt = db.prepare(`select 1`)
      return (
        typeof (stmt as { setReturnArrays?: unknown }).setReturnArrays ===
        `function`
      )
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

export const TEST_DATABASE_IMPLEMENTATION:
  | TestDatabaseImplementation
  | undefined = canLoadBetterSqlite3()
  ? { type: `better-sqlite3` }
  : canUseNodeSqlite()
    ? { type: `node:sqlite` }
    : undefined
