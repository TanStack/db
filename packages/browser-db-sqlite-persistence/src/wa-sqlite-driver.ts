import {
  InvalidPersistedCollectionConfigError,
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
} from '@tanstack/db-sqlite-persistence-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persistence-core'

export type BrowserWASQLiteDatabase = {
  execute: <TRow = unknown>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<TRow>>
  close?: () => Promise<void> | void
}

export type BrowserWASQLiteDriverOptions = {
  database: BrowserWASQLiteDatabase
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

function assertDatabaseShape(
  database: BrowserWASQLiteDatabase,
): asserts database is BrowserWASQLiteDatabase {
  if (typeof database.execute !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `Browser wa-sqlite database handle must provide execute(sql, params?)`,
    )
  }
}

export class BrowserWASQLiteDriver implements SQLiteDriver {
  readonly [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY] = {}
  private readonly database: BrowserWASQLiteDatabase
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1
  private closed = false

  constructor(options: BrowserWASQLiteDriverOptions) {
    assertDatabaseShape(options.database)
    this.database = options.database
  }

  exec(sql: string): Promise<void> {
    return this.enqueue(async () => {
      await this.database.execute(sql)
    })
  }

  query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.enqueue(() => this.database.execute<T>(sql, params))
  }

  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    return this.enqueue(async () => {
      await this.database.execute(sql, params)
    })
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    try {
      assertTransactionCallbackHasDriverArg(fn)
    } catch (error) {
      return Promise.reject(error)
    }

    return this.enqueue(async () => {
      await this.database.execute(`BEGIN IMMEDIATE`)
      try {
        const result = await fn(this.createTransactionDriver())
        await this.database.execute(`COMMIT`)
        return result
      } catch (error) {
        try {
          await this.database.execute(`ROLLBACK`)
        } catch {
          // Preserve original transaction error.
        }
        throw error
      }
    })
  }

  transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.transaction(fn)
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true

    if (typeof this.database.close === `function`) {
      await Promise.resolve(this.database.close())
    }
  }

  getDatabase(): BrowserWASQLiteDatabase {
    return this.database
  }

  private createTransactionDriver(): SQLiteDriver {
    return {
      exec: (sql) => this.database.execute(sql).then(() => undefined),
      query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
        this.database.execute<T>(sql, params),
      run: (sql: string, params: ReadonlyArray<unknown> = []) =>
        this.database.execute(sql, params).then(() => undefined),
      transaction: <T>(fn: (transactionDriver: SQLiteDriver) => Promise<T>) =>
        this.runNestedTransaction(fn),
      transactionWithDriver: <T>(
        fn: (transactionDriver: SQLiteDriver) => Promise<T>,
      ) => this.runNestedTransaction(fn),
    }
  }

  private async runNestedTransaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    assertTransactionCallbackHasDriverArg(fn)

    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    await this.database.execute(`SAVEPOINT ${savepointName}`)
    try {
      const result = await fn(this.createTransactionDriver())
      await this.database.execute(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await this.database.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      await this.database.execute(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    // Brand the exact Promise returned to callers. Transparent wrappers may
    // preserve this identity for late discovery; wrappers that create a new
    // Promise must forward the driver key before adapter construction.
    Object.defineProperty(
      queuedOperation,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      { value: this[SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY] },
    )
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}
