import BetterSqlite3 from 'better-sqlite3'
import type { BrowserWASQLiteDatabase } from '../../src/browser-persistence'

const SQLITE_ROW = 100
const SQLITE_DONE = 101

type BetterSqliteStatement = ReturnType<BetterSqlite3.Database[`prepare`]>
type StatementBindings =
  | ReadonlyArray<unknown>
  | Readonly<Record<string, unknown>>

type StatementState = {
  statement: BetterSqliteStatement
  bindings: StatementBindings | undefined
  initialized: boolean
  rows: ReadonlyArray<Record<string, unknown>>
  columns: ReadonlyArray<string>
  nextRowIndex: number
  currentRowIndex: number
}

function readAllRows(
  statement: BetterSqliteStatement,
  bindings: StatementBindings | undefined,
): ReadonlyArray<Record<string, unknown>> {
  const statementWithVariadicAll = statement as BetterSqliteStatement & {
    all: (...params: ReadonlyArray<unknown>) => ReadonlyArray<unknown>
  }
  if (!bindings) {
    return statementWithVariadicAll.all() as ReadonlyArray<
      Record<string, unknown>
    >
  }

  if (Array.isArray(bindings)) {
    return statementWithVariadicAll.all(...bindings) as ReadonlyArray<
      Record<string, unknown>
    >
  }

  return statementWithVariadicAll.all(bindings) as ReadonlyArray<
    Record<string, unknown>
  >
}

function runWithBindings(
  statement: BetterSqliteStatement,
  bindings: StatementBindings | undefined,
): void {
  const statementWithVariadicRun = statement as BetterSqliteStatement & {
    run: (...params: ReadonlyArray<unknown>) => unknown
  }
  if (!bindings) {
    statementWithVariadicRun.run()
    return
  }

  if (Array.isArray(bindings)) {
    statementWithVariadicRun.run(...bindings)
    return
  }

  statementWithVariadicRun.run(bindings)
}

function executeReaderStatement(
  statement: BetterSqliteStatement,
  bindings: StatementBindings | undefined,
): ReadonlyArray<Record<string, unknown>> {
  return readAllRows(statement, bindings)
}

function executeMutationStatement(
  statement: BetterSqliteStatement,
  bindings: StatementBindings | undefined,
): void {
  runWithBindings(statement, bindings)
}

export function createWASQLiteTestDatabase(options: {
  filename: string
}): BrowserWASQLiteDatabase {
  const database = new BetterSqlite3(options.filename)
  const statementById = new Map<number, StatementState>()
  let nextStatementId = 1

  const sqlite3 = {
    statements: async function* (
      _db: number,
      sql: string,
    ): AsyncIterable<number> {
      const trimmedSql = sql.trim()
      if (trimmedSql.length === 0) {
        return
      }

      const statement = database.prepare(trimmedSql)
      const statementId = nextStatementId
      nextStatementId++
      statementById.set(statementId, {
        statement,
        bindings: undefined,
        initialized: false,
        rows: [],
        columns: [],
        nextRowIndex: 0,
        currentRowIndex: -1,
      })

      try {
        yield statementId
      } finally {
        statementById.delete(statementId)
      }
    },
    bind_collection: (
      statementId: number,
      bindings: StatementBindings,
    ): number => {
      const statementState = statementById.get(statementId)
      if (!statementState) {
        throw new Error(
          `Unknown wa-sqlite test statement ${String(statementId)}`,
        )
      }

      statementState.bindings = Array.isArray(bindings)
        ? [...bindings]
        : { ...bindings }
      statementState.initialized = false
      return 0
    },
    step: async (statementId: number): Promise<number> => {
      const statementState = statementById.get(statementId)
      if (!statementState) {
        throw new Error(
          `Unknown wa-sqlite test statement ${String(statementId)}`,
        )
      }

      if (!statementState.initialized) {
        statementState.initialized = true
        statementState.nextRowIndex = 0
        statementState.currentRowIndex = -1

        if (statementState.statement.reader) {
          statementState.rows = executeReaderStatement(
            statementState.statement,
            statementState.bindings,
          )
          statementState.columns =
            statementState.rows.length > 0
              ? Object.keys(statementState.rows[0]!)
              : statementState.statement.columns().map((column) => column.name)
        } else {
          executeMutationStatement(
            statementState.statement,
            statementState.bindings,
          )
          statementState.rows = []
          statementState.columns = []
        }
      }

      if (!statementState.statement.reader) {
        return SQLITE_DONE
      }

      if (statementState.nextRowIndex < statementState.rows.length) {
        statementState.currentRowIndex = statementState.nextRowIndex
        statementState.nextRowIndex++
        return SQLITE_ROW
      }

      return SQLITE_DONE
    },
    row: (statementId: number): ReadonlyArray<unknown> => {
      const statementState = statementById.get(statementId)
      if (!statementState) {
        throw new Error(
          `Unknown wa-sqlite test statement ${String(statementId)}`,
        )
      }

      const currentRow =
        statementState.rows[statementState.currentRowIndex] ?? {}
      return statementState.columns.map((columnName) => currentRow[columnName])
    },
    column_names: (statementId: number): ReadonlyArray<string> => {
      const statementState = statementById.get(statementId)
      if (!statementState) {
        throw new Error(
          `Unknown wa-sqlite test statement ${String(statementId)}`,
        )
      }

      return [...statementState.columns]
    },
    close: async (_db: number): Promise<number> => {
      database.close()
      return 0
    },
  }

  return {
    sqlite3,
    db: 1,
    close: () => {
      database.close()
    },
  }
}
