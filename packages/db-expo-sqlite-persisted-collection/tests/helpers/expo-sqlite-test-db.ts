import BetterSqlite3 from 'better-sqlite3'
import type {
  ExpoSQLiteBindParams,
  ExpoSQLiteDatabaseLike,
  ExpoSQLiteRunResult,
  ExpoSQLiteTransaction,
} from '../../src'

export type ExpoSQLiteTestDatabase = ExpoSQLiteDatabaseLike & {
  closeAsync: () => Promise<void>
  getNativeDatabase?: () => InstanceType<typeof BetterSqlite3>
}

export type ExpoSQLiteTestDatabaseFactory = (options: {
  filename: string
}) => ExpoSQLiteTestDatabase

declare global {
  var __tanstackDbCreateMobileSQLiteTestDatabase:
    | ExpoSQLiteTestDatabaseFactory
    | undefined
}

function normalizeRunResult(
  result: BetterSqlite3.RunResult,
): ExpoSQLiteRunResult {
  return {
    changes: result.changes,
    lastInsertRowId:
      typeof result.lastInsertRowid === `bigint`
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid,
  }
}

function hasNamedParameters(
  params: ExpoSQLiteBindParams | undefined,
): params is Record<string, unknown> {
  return params !== undefined && !Array.isArray(params)
}

function executeAll<T>(
  database: InstanceType<typeof BetterSqlite3>,
  sql: string,
  params?: ExpoSQLiteBindParams,
): ReadonlyArray<T> {
  const statement = database.prepare(sql)

  if (params === undefined) {
    return statement.all() as ReadonlyArray<T>
  }

  if (hasNamedParameters(params)) {
    return statement.all(params) as ReadonlyArray<T>
  }

  return statement.all(...params) as ReadonlyArray<T>
}

function executeRun(
  database: InstanceType<typeof BetterSqlite3>,
  sql: string,
  params?: ExpoSQLiteBindParams,
): ExpoSQLiteRunResult {
  const statement = database.prepare(sql)
  const result =
    params === undefined
      ? statement.run()
      : hasNamedParameters(params)
        ? statement.run(params)
        : statement.run(...params)

  return normalizeRunResult(result)
}

function createTransactionHandle(
  database: InstanceType<typeof BetterSqlite3>,
): ExpoSQLiteTransaction {
  return {
    execAsync: (sql: string) => {
      database.exec(sql)
      return Promise.resolve()
    },
    getAllAsync: <T>(
      sql: string,
      params?: ExpoSQLiteBindParams,
    ): Promise<ReadonlyArray<T>> => Promise.resolve(executeAll<T>(database, sql, params)),
    runAsync: (
      sql: string,
      params?: ExpoSQLiteBindParams,
    ): Promise<ExpoSQLiteRunResult> => Promise.resolve(executeRun(database, sql, params)),
  }
}

export function createExpoSQLiteTestDatabase(options: {
  filename: string
}): ExpoSQLiteTestDatabase {
  if (
    typeof globalThis.__tanstackDbCreateMobileSQLiteTestDatabase === `function`
  ) {
    return globalThis.__tanstackDbCreateMobileSQLiteTestDatabase(options)
  }

  const nativeDatabase = new BetterSqlite3(options.filename)
  let queue: Promise<void> = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const queuedOperation = queue.then(operation, operation)
    queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  return {
    execAsync: async (sql: string) => {
      await enqueue(() => {
        nativeDatabase.exec(sql)
      })
    },
    getAllAsync: async <T>(
      sql: string,
      params?: ExpoSQLiteBindParams,
    ): Promise<ReadonlyArray<T>> =>
      enqueue(() => executeAll<T>(nativeDatabase, sql, params)),
    runAsync: async (
      sql: string,
      params?: ExpoSQLiteBindParams,
    ): Promise<ExpoSQLiteRunResult> =>
      enqueue(() => executeRun(nativeDatabase, sql, params)),
    withExclusiveTransactionAsync: async <T>(
      task: (transaction: ExpoSQLiteTransaction) => Promise<T>,
    ): Promise<T> =>
      enqueue(async () => {
        nativeDatabase.exec(`BEGIN IMMEDIATE`)
        const transaction = createTransactionHandle(nativeDatabase)
        try {
          const result = await task(transaction)
          nativeDatabase.exec(`COMMIT`)
          return result
        } catch (error) {
          try {
            nativeDatabase.exec(`ROLLBACK`)
          } catch {
            // Keep the original failure as the primary error.
          }
          throw error
        }
      }),
    closeAsync: () => {
      nativeDatabase.close()
      return Promise.resolve()
    },
    getNativeDatabase: () => nativeDatabase,
  }
}
