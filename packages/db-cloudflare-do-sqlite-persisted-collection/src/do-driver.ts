import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persisted-collection-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persisted-collection-core'

type DurableObjectSqlRow = Record<string, unknown>

type DurableObjectSqlCursorLike = Iterable<DurableObjectSqlRow> & {
  toArray?: () => Array<DurableObjectSqlRow>
}

export type DurableObjectSqlStorageLike = {
  exec: (
    sql: string,
    ...params: ReadonlyArray<unknown>
  ) => DurableObjectSqlCursorLike | ReadonlyArray<DurableObjectSqlRow> | null
}

export type DurableObjectTransactionExecutor = <T>(
  fn: () => Promise<T>,
) => Promise<T>

export type DurableObjectStorageLike = {
  sql: DurableObjectSqlStorageLike
  transaction?: DurableObjectTransactionExecutor
}

type CloudflareDOProvidedSqlOptions = {
  sql: DurableObjectSqlStorageLike
  transaction?: DurableObjectTransactionExecutor
}

type CloudflareDOProvidedStorageOptions = {
  storage: DurableObjectStorageLike
}

export type CloudflareDOSQLiteDriverOptions =
  | CloudflareDOProvidedSqlOptions
  | CloudflareDOProvidedStorageOptions

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

function isIterableRecord(value: unknown): value is Iterable<DurableObjectSqlRow> {
  if (!value || typeof value !== `object`) {
    return false
  }

  const iterator = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator]
  return typeof iterator === `function`
}

function toRowArray<T>(
  result: ReturnType<DurableObjectSqlStorageLike[`exec`]>,
  sql: string,
): ReadonlyArray<T> {
  if (result == null) {
    return []
  }

  if (Array.isArray(result)) {
    return result as ReadonlyArray<T>
  }

  const cursorResult = result as DurableObjectSqlCursorLike
  if (typeof cursorResult.toArray === `function`) {
    return cursorResult.toArray() as ReadonlyArray<T>
  }

  if (isIterableRecord(cursorResult)) {
    return Array.from(cursorResult as Iterable<T>)
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported Durable Object SQL result shape for query "${sql}"`,
  )
}

export class CloudflareDOSQLiteDriver implements SQLiteDriver {
  private readonly sqlStorage: DurableObjectSqlStorageLike
  private readonly transactionExecutor: DurableObjectTransactionExecutor | null
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1

  constructor(options: CloudflareDOSQLiteDriverOptions) {
    const resolvedSqlStorage = `storage` in options ? options.storage.sql : options.sql
    if (typeof resolvedSqlStorage.exec !== `function`) {
      throw new InvalidPersistedCollectionConfigError(
        `Cloudflare DO SQL driver requires a sql.exec function`,
      )
    }
    this.sqlStorage = resolvedSqlStorage
    if (`storage` in options && typeof options.storage.transaction === `function`) {
      const transactionMethod = options.storage.transaction
      this.transactionExecutor = <T>(fn: () => Promise<T>) =>
        Promise.resolve(
          transactionMethod.call(options.storage, fn) as Promise<T> | T,
        )
    } else if (
      `transaction` in options &&
      typeof options.transaction === `function`
    ) {
      const transactionMethod = options.transaction
      this.transactionExecutor = <T>(fn: () => Promise<T>) =>
        Promise.resolve(transactionMethod(fn))
    } else {
      this.transactionExecutor = null
    }
  }

  async exec(sql: string): Promise<void> {
    await this.enqueue(() => {
      this.execute(sql)
    })
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.enqueue(() => this.executeQuery<T>(sql, params))
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    await this.enqueue(() => {
      this.execute(sql, params)
    })
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    assertTransactionCallbackHasDriverArg(fn)

    return this.enqueue(async () => {
      const transactionDriver = this.createTransactionDriver()
      if (this.transactionExecutor) {
        return this.transactionExecutor(() => fn(transactionDriver))
      }

      this.execute(`BEGIN IMMEDIATE`)
      try {
        const result = await fn(transactionDriver)
        this.execute(`COMMIT`)
        return result
      } catch (error) {
        try {
          this.execute(`ROLLBACK`)
        } catch {
          // Keep the original transaction error as the primary failure.
        }
        throw error
      }
    })
  }

  async transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.transaction(fn)
  }

  private execute(sql: string, params: ReadonlyArray<unknown> = []): unknown {
    return this.sqlStorage.exec(sql, ...params)
  }

  private executeQuery<T>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): ReadonlyArray<T> {
    const result = this.execute(sql, params)
    return toRowArray<T>(
      result as ReturnType<DurableObjectSqlStorageLike[`exec`]>,
      sql,
    )
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private createTransactionDriver(): SQLiteDriver {
    const transactionDriver: SQLiteDriver = {
      exec: (sql) => {
        this.execute(sql)
        return Promise.resolve()
      },
      query: <T>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<T>> =>
        Promise.resolve(this.executeQuery<T>(sql, params)),
      run: (sql, params = []) => {
        this.execute(sql, params)
        return Promise.resolve()
      },
      transaction: <T>(
        fn: (nestedDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> => {
        assertTransactionCallbackHasDriverArg(fn)
        return this.runNestedTransaction(transactionDriver, fn)
      },
      transactionWithDriver: <T>(
        fn: (nestedDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> => this.runNestedTransaction(transactionDriver, fn),
    }

    return transactionDriver
  }

  private async runNestedTransaction<T>(
    transactionDriver: SQLiteDriver,
    fn: (nestedDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    if (this.transactionExecutor) {
      throw new InvalidPersistedCollectionConfigError(
        `Nested SQL savepoints are not supported when using Durable Object transaction API`,
      )
    }

    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    this.execute(`SAVEPOINT ${savepointName}`)

    try {
      const result = await fn(transactionDriver)
      this.execute(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      this.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      this.execute(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }
}

export function createCloudflareDOSQLiteDriver(
  options: CloudflareDOSQLiteDriverOptions,
): CloudflareDOSQLiteDriver {
  return new CloudflareDOSQLiteDriver(options)
}
