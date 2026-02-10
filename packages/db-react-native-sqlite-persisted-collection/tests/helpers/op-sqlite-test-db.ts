import BetterSqlite3 from 'better-sqlite3'
import type { OpSQLiteDatabaseLike } from '../../src/op-sqlite-driver'

const QUERY_SQL_PATTERN = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i

export type OpSQLiteTestResultShape =
  | `rows-array`
  | `rows-object`
  | `rows-list`
  | `statement-array`

type OpSQLiteRowsListLike<T> = {
  length: number
  item: (index: number) => T | null
  _array: Array<T>
}

export type OpSQLiteTestDatabase = OpSQLiteDatabaseLike & {
  close: () => void
  getNativeDatabase: () => InstanceType<typeof BetterSqlite3>
}

function createRowsList<T>(rows: Array<T>): OpSQLiteRowsListLike<T> {
  return {
    length: rows.length,
    item: (index) => rows[index] ?? null,
    _array: rows,
  }
}

function formatQueryRows<T>(
  rows: Array<T>,
  resultShape: OpSQLiteTestResultShape,
): unknown {
  switch (resultShape) {
    case `rows-array`:
      return rows
    case `rows-object`:
      return { rows }
    case `rows-list`:
      return {
        rows: createRowsList(rows),
      }
    case `statement-array`:
      return [{ rows }]
    default:
      return { rows }
  }
}

function formatWriteResult(
  rowsAffected: number,
  resultShape: OpSQLiteTestResultShape,
): unknown {
  switch (resultShape) {
    case `rows-array`:
      return []
    case `rows-object`:
      return {
        rows: [],
        rowsAffected,
      }
    case `rows-list`:
      return {
        rows: createRowsList([]),
        rowsAffected,
      }
    case `statement-array`:
      return [
        {
          rows: [],
          rowsAffected,
        },
      ]
    default:
      return {
        rows: [],
        rowsAffected,
      }
  }
}

export function createOpSQLiteTestDatabase(options: {
  filename: string
  resultShape?: OpSQLiteTestResultShape
}): OpSQLiteTestDatabase {
  const nativeDatabase = new BetterSqlite3(options.filename)
  const resultShape = options.resultShape ?? `rows-object`

  const execute = (sql: string, params: ReadonlyArray<unknown> = []) => {
    const statement = nativeDatabase.prepare(sql)
    const parameterValues = [...params]

    if (QUERY_SQL_PATTERN.test(sql)) {
      const rows =
        parameterValues.length > 0
          ? statement.all(...parameterValues)
          : statement.all()
      return formatQueryRows(rows, resultShape)
    }

    const runResult =
      parameterValues.length > 0
        ? statement.run(...parameterValues)
        : statement.run()
    return formatWriteResult(runResult.changes, resultShape)
  }

  return {
    execute,
    close: () => {
      nativeDatabase.close()
    },
    getNativeDatabase: () => nativeDatabase,
  }
}
