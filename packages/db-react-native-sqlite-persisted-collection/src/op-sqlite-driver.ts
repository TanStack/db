import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persisted-collection-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persisted-collection-core'

type OpSQLiteExecuteFn = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => unknown | Promise<unknown>

type OpSQLiteRowListLike = {
  length?: unknown
  item?: unknown
  _array?: unknown
}

type OpSQLiteStatementResultLike = {
  rows?: unknown
  resultRows?: unknown
  rowsAffected?: unknown
  changes?: unknown
  insertId?: unknown
  lastInsertRowId?: unknown
}

const WRITE_RESULT_KEYS = new Set([
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
])

export type OpSQLiteDatabaseLike = {
  execute?: OpSQLiteExecuteFn
  executeAsync?: OpSQLiteExecuteFn
  executeRaw?: OpSQLiteExecuteFn
  execAsync?: OpSQLiteExecuteFn
  close?: () => Promise<void> | void
}

type OpSQLiteExistingDatabaseOptions = {
  database: OpSQLiteDatabaseLike
}

type OpSQLiteOpenDatabaseOptions = {
  openDatabase: () => OpSQLiteDatabaseLike
}

export type OpSQLiteDriverOptions =
  | OpSQLiteExistingDatabaseOptions
  | OpSQLiteOpenDatabaseOptions

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
  return typeof process.versions.node === `string`
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function hasWriteResultMarker(value: Record<string, unknown>): boolean {
  for (const key of WRITE_RESULT_KEYS) {
    if (key in value) {
      return true
    }
  }
  return false
}

function toRowArray(rowsValue: unknown): Array<unknown> | null {
  if (Array.isArray(rowsValue)) {
    return rowsValue
  }

  if (!isObjectRecord(rowsValue)) {
    return null
  }

  const rowsObject = rowsValue as OpSQLiteRowListLike
  if (Array.isArray(rowsObject._array)) {
    return rowsObject._array
  }

  if (
    typeof rowsObject.length === `number` &&
    typeof rowsObject.item === `function`
  ) {
    const item = rowsObject.item as (index: number) => unknown
    const rows: Array<unknown> = []
    for (let index = 0; index < rowsObject.length; index++) {
      rows.push(item(index))
    }
    return rows
  }

  return null
}

function extractRowsFromStatementResult(
  value: OpSQLiteStatementResultLike,
): Array<unknown> | null {
  const rowsFromRows = toRowArray(value.rows)
  if (rowsFromRows) {
    return rowsFromRows
  }

  const rowsFromResultRows = toRowArray(value.resultRows)
  if (rowsFromResultRows) {
    return rowsFromResultRows
  }

  if (hasWriteResultMarker(value as Record<string, unknown>)) {
    return []
  }

  return null
}

function extractRowsFromExecuteResult(
  result: unknown,
  sql: string,
): Array<unknown> {
  if (result == null) {
    return []
  }

  if (Array.isArray(result)) {
    if (result.length === 0) {
      return []
    }

    const firstEntry = result[0]
    if (isObjectRecord(firstEntry)) {
      const rowsFromStatement = extractRowsFromStatementResult(firstEntry)
      if (rowsFromStatement) {
        return rowsFromStatement
      }
    }

    return result
  }

  if (isObjectRecord(result)) {
    const rowsFromStatement = extractRowsFromStatementResult(result)
    if (rowsFromStatement) {
      return rowsFromStatement
    }

    const nestedResults = result.results
    if (Array.isArray(nestedResults) && nestedResults.length > 0) {
      const firstResult = nestedResults[0]
      if (isObjectRecord(firstResult)) {
        const rowsFromNested = extractRowsFromStatementResult(firstResult)
        if (rowsFromNested) {
          return rowsFromNested
        }
      }
    }
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported op-sqlite query result shape for SQL "${sql}"`,
  )
}

function hasExistingDatabase(
  options: OpSQLiteDriverOptions,
): options is OpSQLiteExistingDatabaseOptions {
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

function resolveExecuteMethod(
  database: OpSQLiteDatabaseLike,
): OpSQLiteExecuteFn {
  const executeCandidates: Array<unknown> = [
    database.executeAsync,
    database.execute,
    database.executeRaw,
    database.execAsync,
  ]
  const executeMethod = executeCandidates.find(
    (candidate) => typeof candidate === `function`,
  )

  if (typeof executeMethod !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `op-sqlite database object must provide execute/executeAsync/executeRaw/execAsync`,
    )
  }

  return executeMethod as OpSQLiteExecuteFn
}

export class OpSQLiteDriver implements SQLiteDriver {
  private readonly database: OpSQLiteDatabaseLike
  private readonly executeMethod: OpSQLiteExecuteFn
  private readonly ownsDatabase: boolean
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1
  private transactionContextStoragePromise: Promise<AsyncLocalStorageLike<TransactionContextStore> | null> | null =
    null

  constructor(options: OpSQLiteDriverOptions) {
    if (hasExistingDatabase(options)) {
      this.database = options.database
      this.ownsDatabase = false
    } else {
      this.database = options.openDatabase()
      this.ownsDatabase = true
    }

    this.executeMethod = resolveExecuteMethod(this.database)
  }

  async exec(sql: string): Promise<void> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      await activeTransactionDriver.exec(sql)
      return
    }

    await this.enqueue(async () => {
      await this.execute(sql)
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
      const result = await this.execute(sql, params)
      return extractRowsFromExecuteResult(result, sql) as ReadonlyArray<T>
    })
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    const activeTransactionDriver = await this.getActiveTransactionDriver()
    if (activeTransactionDriver) {
      await activeTransactionDriver.run(sql, params)
      return
    }

    await this.enqueue(async () => {
      await this.execute(sql, params)
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
      await this.execute(`BEGIN IMMEDIATE`)
      const transactionDriver = this.createTransactionDriver()
      try {
        const result = await this.runWithTransactionContext(
          transactionDriver,
          async () => fn(transactionDriver),
        )
        await this.execute(`COMMIT`)
        return result
      } catch (error) {
        try {
          await this.execute(`ROLLBACK`)
        } catch {
          // Keep the original transaction failure as the primary error.
        }
        throw error
      }
    })
  }

  async close(): Promise<void> {
    if (!this.ownsDatabase || typeof this.database.close !== `function`) {
      return
    }

    await Promise.resolve(this.database.close())
  }

  private async execute(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<unknown> {
    const normalizedParams =
      params.length > 0
        ? [...params]
        : (undefined as ReadonlyArray<unknown> | undefined)
    const result = this.executeMethod.call(this.database, sql, normalizedParams)
    return Promise.resolve(result)
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

  private createTransactionDriver(): SQLiteDriver {
    const transactionDriver: SQLiteDriver = {
      exec: async (sql) => {
        await this.execute(sql)
      },
      query: async <T>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<T>> => {
        const result = await this.execute(sql, params)
        return extractRowsFromExecuteResult(result, sql) as ReadonlyArray<T>
      },
      run: async (sql, params = []) => {
        await this.execute(sql, params)
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
    await this.execute(`SAVEPOINT ${savepointName}`)

    try {
      const result = await fn(transactionDriver)
      await this.execute(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await this.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      await this.execute(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }
}

export function createOpSQLiteDriver(
  options: OpSQLiteDriverOptions,
): OpSQLiteDriver {
  return new OpSQLiteDriver(options)
}
