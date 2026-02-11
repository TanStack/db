import BetterSqlite3 from 'better-sqlite3'
import type { DurableObjectSqlStorageLike, DurableObjectStorageLike } from '../../src'

type BetterSqliteDoStorageHarness = {
  sql: DurableObjectSqlStorageLike
  storage: DurableObjectStorageLike
  close: () => void
}

type BetterSqliteStatement = ReturnType<BetterSqlite3.Database[`prepare`]>

function readRows(statement: BetterSqliteStatement, params: ReadonlyArray<unknown>) {
  const statementWithVariadicIterate = statement as BetterSqliteStatement & {
    iterate: (...params: ReadonlyArray<unknown>) => Iterable<unknown>
  }
  return statementWithVariadicIterate.iterate(
    ...params,
  ) as Iterable<Record<string, unknown>>
}

function runStatement(
  statement: BetterSqliteStatement,
  params: ReadonlyArray<unknown>,
): void {
  const statementWithVariadicRun = statement as BetterSqliteStatement & {
    run: (...params: ReadonlyArray<unknown>) => unknown
  }
  statementWithVariadicRun.run(...params)
}

export function createBetterSqliteDoStorageHarness(options: {
  filename: string
}): BetterSqliteDoStorageHarness {
  const database = new BetterSqlite3(options.filename)

  const sql: DurableObjectSqlStorageLike = {
    exec: (sqlText, ...params) => {
      const statement = database.prepare(sqlText)
      if (statement.reader) {
        return readRows(statement, params)
      }
      runStatement(statement, params)
      return []
    },
  }
  const storage: DurableObjectStorageLike = {
    sql,
  }

  return {
    sql,
    storage,
    close: () => {
      database.close()
    },
  }
}
