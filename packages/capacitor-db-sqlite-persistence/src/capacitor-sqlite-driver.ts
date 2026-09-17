import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persistence-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persistence-core'
import type {
  capSQLiteValues as CapacitorSQLiteValues,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite'

export type CapacitorSQLiteDatabaseLike = SQLiteDBConnection

type TransactionContextStore = {
  transactionDriver: SQLiteDriver
}

type AsyncLocalStorageLike<TStore> = {
  getStore: () => TStore | undefined
  run: <TResult>(store: TStore, callback: () => TResult) => TResult
}

type AsyncLocalStorageCtor = new <TStore>() => AsyncLocalStorageLike<TStore>

let asyncLocalStorageCtorPromise: Promise<AsyncLocalStorageCtor | null> | null =
  null

function canAttemptNodeAsyncLocalStorageLoad(): boolean {
  if (typeof process === `undefined`) {
    return false
  }

  // In Capacitor webviews, process may be polyfilled without versions.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return typeof process.versions?.node === `string`
}

function getNodeAsyncHooksSpecifier(): string {
  const moduleName = `async_hooks`
  return `node:${moduleName}`
}

async function resolveAsyncLocalStorageCtor(): Promise<AsyncLocalStorageCtor | null> {
  if (asyncLocalStorageCtorPromise) {
    return asyncLocalStorageCtorPromise
  }

  asyncLocalStorageCtorPromise = (async () => {
    if (!canAttemptNodeAsyncLocalStorageLoad()) {
      return null
    }

    try {
      const asyncHooksModule = (await import(getNodeAsyncHooksSpecifier())) as {
        AsyncLocalStorage?: AsyncLocalStorageCtor
      }

      return typeof asyncHooksModule.AsyncLocalStorage === `function`
        ? asyncHooksModule.AsyncLocalStorage
        : null
    } catch {
      return null
    }
  })()

  return asyncLocalStorageCtorPromise
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

function isCapacitorSQLiteDatabaseLike(
  value: unknown,
): value is CapacitorSQLiteDatabaseLike {
  const candidate = value as Partial<CapacitorSQLiteDatabaseLike>
  return (
    typeof value === `object` &&
    value !== null &&
    typeof candidate.execute === `function` &&
    typeof candidate.query === `function` &&
    typeof candidate.run === `function`
  )
}

function extractQueryRows<T>(
  result: CapacitorSQLiteValues,
  sql: string,
): ReadonlyArray<T> {
  if (Array.isArray(result.values)) {
    return result.values as ReadonlyArray<T>
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported Capacitor SQLite query result shape for SQL "${sql}"`,
  )
}

export type CapacitorSQLiteDriverOptions = {
  database: CapacitorSQLiteDatabaseLike
}

export class CapacitorSQLiteDriver implements SQLiteDriver {
  private readonly database: CapacitorSQLiteDatabaseLike
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1
  private transactionContextStoragePromise: Promise<AsyncLocalStorageLike<TransactionContextStore> | null> | null =
    null

  constructor(options: CapacitorSQLiteDriverOptions) {
    if (!isCapacitorSQLiteDatabaseLike(options.database)) {
      throw new InvalidPersistedCollectionConfigError(
        `Capacitor SQLite database object must provide execute/query/run methods`,
      )
    }

    this.database = options.database
  }

  async exec(sql: string): Promise<void> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      await activeTransactionDriver.exec(sql)
      return
    }

    await this.enqueue(async () => {
      await this.database.execute(sql, false)
    })
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      return activeTransactionDriver.query<T>(sql, params)
    }

    return this.enqueue(async () => {
      const result = await this.database.query(sql, [...params])
      return extractQueryRows<T>(result, sql)
    })
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      await activeTransactionDriver.run(sql, params)
      return
    }

    await this.enqueue(async () => {
      await this.database.run(sql, [...params], false)
    })
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    assertTransactionCallbackHasDriverArg(fn)

    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      return activeTransactionDriver.transaction(fn)
    }

    return this.transactionWithDriver((transactionDriver) =>
      fn(transactionDriver),
    )
  }

  async transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (
      activeTransactionDriver &&
      typeof activeTransactionDriver.transactionWithDriver === `function`
    ) {
      return activeTransactionDriver.transactionWithDriver(fn)
    }

    return this.enqueue(async () => {
      await this.beginTopLevelTransaction()
      const transactionDriver = this.createTransactionDriver()
      try {
        const result = await this.runWithTransactionContext(
          transactionDriver,
          async () => fn(transactionDriver),
        )
        await this.commitTopLevelTransaction()
        return result
      } catch (error) {
        try {
          await this.rollbackTopLevelTransaction()
        } catch {
          // Preserve the original transaction failure as the primary error.
        }
        throw error
      }
    })
  }

  async close(): Promise<void> {
    await this.database.close()
  }

  getDatabase(): CapacitorSQLiteDatabaseLike {
    return this.database
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private async getTransactionContextStorage(): Promise<AsyncLocalStorageLike<TransactionContextStore> | null> {
    if (this.transactionContextStoragePromise) {
      return this.transactionContextStoragePromise
    }

    this.transactionContextStoragePromise = (async () => {
      const asyncLocalStorageCtor = await resolveAsyncLocalStorageCtor()
      if (!asyncLocalStorageCtor) {
        return null
      }

      return new asyncLocalStorageCtor<TransactionContextStore>()
    })()

    return this.transactionContextStoragePromise
  }

  private async getActiveTransactionDriver(): Promise<SQLiteDriver | null> {
    const transactionContextStorage = await this.getTransactionContextStorage()
    const store = transactionContextStorage?.getStore()
    return store?.transactionDriver ?? null
  }

  private async runWithTransactionContext<TResult>(
    transactionDriver: SQLiteDriver,
    callback: () => Promise<TResult>,
  ): Promise<TResult> {
    const transactionContextStorage = await this.getTransactionContextStorage()
    if (!transactionContextStorage) {
      return callback()
    }

    return transactionContextStorage.run({ transactionDriver }, callback)
  }

  private async beginTopLevelTransaction(): Promise<void> {
    await this.database.execute(`BEGIN IMMEDIATE`, false)
  }

  private async commitTopLevelTransaction(): Promise<void> {
    await this.database.execute(`COMMIT`, false)
  }

  private async rollbackTopLevelTransaction(): Promise<void> {
    await this.database.execute(`ROLLBACK`, false)
  }

  private createTransactionDriver(): SQLiteDriver {
    const transactionDriver: SQLiteDriver = {
      exec: async (sql) => {
        await this.database.execute(sql, false)
      },
      query: async <T>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<T>> => {
        const result = await this.database.query(sql, [...params])
        return extractQueryRows<T>(result, sql)
      },
      run: async (sql, params = []) => {
        await this.database.run(sql, [...params], false)
      },
      transaction: async <T>(
        fn: (transactionDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> => {
        assertTransactionCallbackHasDriverArg(fn)
        return this.runNestedTransaction(transactionDriver, async (driver) => {
          return fn(driver)
        })
      },
      transactionWithDriver: async <T>(
        fn: (transactionDriver: SQLiteDriver) => Promise<T>,
      ): Promise<T> => this.runNestedTransaction(transactionDriver, fn),
    }

    return transactionDriver
  }

  private async runNestedTransaction<T>(
    transactionDriver: SQLiteDriver,
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    await this.database.execute(`SAVEPOINT ${savepointName}`, false)

    try {
      const result = await this.runWithTransactionContext(
        transactionDriver,
        async () => fn(transactionDriver),
      )
      await this.database.execute(`RELEASE SAVEPOINT ${savepointName}`, false)
      return result
    } catch (error) {
      await this.database.execute(
        `ROLLBACK TO SAVEPOINT ${savepointName}`,
        false,
      )
      await this.database.execute(`RELEASE SAVEPOINT ${savepointName}`, false)
      throw error
    }
  }
}

export function createCapacitorSQLiteDriver(
  options: CapacitorSQLiteDriverOptions,
): CapacitorSQLiteDriver {
  return new CapacitorSQLiteDriver(options)
}
