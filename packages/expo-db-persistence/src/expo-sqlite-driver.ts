import { InvalidPersistedCollectionConfigError } from '@tanstack/db-persistence-core'
import type { SQLiteDriver } from '@tanstack/db-persistence-core'

export type ExpoSQLiteBindParams =
  | ReadonlyArray<unknown>
  | Record<string, unknown>

export type ExpoSQLiteRunResult = {
  changes: number
  lastInsertRowId: number
}

export type ExpoSQLiteQueryable = {
  execAsync: (sql: string) => Promise<void>
  getAllAsync: <T>(
    sql: string,
    params?: ExpoSQLiteBindParams,
  ) => Promise<ReadonlyArray<T>>
  runAsync: (
    sql: string,
    params?: ExpoSQLiteBindParams,
  ) => Promise<ExpoSQLiteRunResult>
}

export type ExpoSQLiteTransaction = ExpoSQLiteQueryable

export type ExpoSQLiteDatabaseLike = ExpoSQLiteQueryable & {
  withExclusiveTransactionAsync: <T>(
    task: (transaction: ExpoSQLiteTransaction) => Promise<T>,
  ) => Promise<T>
  closeAsync?: () => Promise<void>
}

type ExpoSQLiteExistingDatabaseOptions = {
  database: ExpoSQLiteDatabaseLike
}

type ExpoSQLiteOpenDatabaseOptions = {
  openDatabase: () => Promise<ExpoSQLiteDatabaseLike> | ExpoSQLiteDatabaseLike
}

export type ExpoSQLiteDriverOptions =
  | ExpoSQLiteExistingDatabaseOptions
  | ExpoSQLiteOpenDatabaseOptions

function hasExistingDatabase(
  options: ExpoSQLiteDriverOptions,
): options is ExpoSQLiteExistingDatabaseOptions {
  return `database` in options
}

function assertTransactionCallbackHasDriverArg(
  fn: (transactionDriver: SQLiteDriver) => Promise<unknown>,
): void {
  if (fn.length > 0) {
    return
  }

  throw new InvalidPersistedCollectionConfigError(
    `SQLiteDriver.transaction callback must accept the transaction driver argument`,
  )
}

function isExpoSQLiteDatabaseLike(
  value: unknown,
): value is ExpoSQLiteDatabaseLike {
  return (
    typeof value === `object` &&
    value !== null &&
    typeof (value as ExpoSQLiteDatabaseLike).execAsync === `function` &&
    typeof (value as ExpoSQLiteDatabaseLike).getAllAsync === `function` &&
    typeof (value as ExpoSQLiteDatabaseLike).runAsync === `function` &&
    typeof (value as ExpoSQLiteDatabaseLike).withExclusiveTransactionAsync ===
      `function`
  )
}

export class ExpoSQLiteDriver implements SQLiteDriver {
  private readonly databasePromise: Promise<ExpoSQLiteDatabaseLike>
  private readonly ownsDatabase: boolean
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1

  constructor(options: ExpoSQLiteDriverOptions) {
    if (hasExistingDatabase(options)) {
      if (!isExpoSQLiteDatabaseLike(options.database)) {
        throw new InvalidPersistedCollectionConfigError(
          `Expo SQLite database must provide execAsync/getAllAsync/runAsync/withExclusiveTransactionAsync`,
        )
      }

      this.databasePromise = Promise.resolve(options.database)
      this.ownsDatabase = false
      return
    }

    this.databasePromise = Promise.resolve(options.openDatabase()).then(
      (database) => {
        if (!isExpoSQLiteDatabaseLike(database)) {
          throw new InvalidPersistedCollectionConfigError(
            `Expo SQLite openDatabase() must resolve a database with execAsync/getAllAsync/runAsync/withExclusiveTransactionAsync`,
          )
        }

        return database
      },
    )
    this.ownsDatabase = true
  }

  async exec(sql: string): Promise<void> {
    await this.enqueue(async () => {
      const database = await this.getDatabase()
      await database.execAsync(sql)
    })
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.enqueue(async () => {
      const database = await this.getDatabase()
      return database.getAllAsync<T>(sql, normalizeParams(params))
    })
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    await this.enqueue(async () => {
      const database = await this.getDatabase()
      await database.runAsync(sql, normalizeParams(params))
    })
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    assertTransactionCallbackHasDriverArg(fn)
    return this.transactionWithDriver(fn)
  }

  async transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const database = await this.getDatabase()
      return database.withExclusiveTransactionAsync(async (transaction) => {
        const transactionDriver = this.createTransactionDriver(transaction)
        return fn(transactionDriver)
      })
    })
  }

  async close(): Promise<void> {
    const database = await this.getDatabase()
    if (!this.ownsDatabase || typeof database.closeAsync !== `function`) {
      return
    }

    await database.closeAsync()
  }

  async getDatabase(): Promise<ExpoSQLiteDatabaseLike> {
    return this.databasePromise
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private createTransactionDriver(
    transaction: ExpoSQLiteTransaction,
  ): SQLiteDriver {
    const transactionDriver: SQLiteDriver = {
      exec: async (sql) => {
        await transaction.execAsync(sql)
      },
      query: async <T>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<T>> => {
        return transaction.getAllAsync<T>(sql, normalizeParams(params))
      },
      run: async (sql: string, params: ReadonlyArray<unknown> = []) => {
        await transaction.runAsync(sql, normalizeParams(params))
      },
      transaction: async <T>(
        fn: (nestedTransactionDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> => {
        assertTransactionCallbackHasDriverArg(fn)
        return this.runNestedTransaction(transaction, transactionDriver, fn)
      },
      transactionWithDriver: async <T>(
        fn: (nestedTransactionDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> =>
        this.runNestedTransaction(transaction, transactionDriver, fn),
    }

    return transactionDriver
  }

  private async runNestedTransaction<T>(
    transaction: ExpoSQLiteTransaction,
    transactionDriver: SQLiteDriver,
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    await transaction.execAsync(`SAVEPOINT ${savepointName}`)

    try {
      const result = await fn(transactionDriver)
      await transaction.execAsync(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await transaction.execAsync(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      await transaction.execAsync(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }
}

function normalizeParams(
  params: ReadonlyArray<unknown>,
): ExpoSQLiteBindParams | undefined {
  return params.length > 0 ? [...params] : undefined
}

export function createExpoSQLiteDriver(
  options: ExpoSQLiteDriverOptions,
): ExpoSQLiteDriver {
  return new ExpoSQLiteDriver(options)
}
