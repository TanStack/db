import BetterSqlite3 from 'better-sqlite3'
import type { BrowserWASQLiteDatabase } from '../../src/browser-persistence'

type BetterSqliteStatement = ReturnType<BetterSqlite3.Database[`prepare`]>

function executeWithBindings<TRow>(
  statement: BetterSqliteStatement,
  params: ReadonlyArray<unknown>,
): ReadonlyArray<TRow> {
  const statementWithVariadicMethods = statement as BetterSqliteStatement & {
    all: (...values: ReadonlyArray<unknown>) => ReadonlyArray<unknown>
    run: (...values: ReadonlyArray<unknown>) => unknown
  }

  if (statement.reader) {
    return statementWithVariadicMethods.all(...params) as ReadonlyArray<TRow>
  }

  statementWithVariadicMethods.run(...params)
  return []
}

export function createWASQLiteTestDatabase(options: {
  filename: string
}): BrowserWASQLiteDatabase {
  const database = new BetterSqlite3(options.filename)

  return {
    execute: <TRow = unknown>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<ReadonlyArray<TRow>> => {
      const trimmedSql = sql.trim()
      if (trimmedSql.length === 0) {
        return Promise.resolve([])
      }

      const statement = database.prepare(trimmedSql)
      return Promise.resolve(executeWithBindings<TRow>(statement, params))
    },
    close: () => {
      database.close()
    },
  }
}
