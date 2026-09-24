import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persistence-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persistence-core'

type OpSQLiteExecuteFn = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => unknown | Promise<unknown>

type OpSQLiteRowListLike = {
  length?: unknown
  item?: unknown
  _array?: unknown
}

const WRITE_RESULT_KEYS = new Set([
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
])

const STATEMENT_RESULT_KEYS = new Set([
  ...WRITE_RESULT_KEYS,
  `rows`,
  `resultRows`,
  `rawRows`,
  `columnNames`,
  `results`,
  `metadata`,
])

export type OpSQLiteDatabaseLike = {
  execute?: OpSQLiteExecuteFn
  executeAsync?: OpSQLiteExecuteFn
  executeRaw?: OpSQLiteExecuteFn
  execAsync?: OpSQLiteExecuteFn
  close?: () => Promise<void> | void
}

export type OpSQLiteArrayResultMode = `rows` | `statement-results`

type OpSQLiteResultOptions = {
  /**
   * Declares how to interpret a bare array when its first entry could be either
   * a data row or a statement-result envelope. Published op-sqlite methods
   * return object envelopes and do not need this option.
   */
  arrayResultMode?: OpSQLiteArrayResultMode
}

type OpSQLiteExistingDatabaseOptions = OpSQLiteResultOptions & {
  database: OpSQLiteDatabaseLike
}

type OpSQLiteOpenDatabaseOptions = OpSQLiteResultOptions & {
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

type DatabaseExecutionState = {
  queue: Promise<void>
  nextSavepointId: number
  transactionContextStoragePromise: Promise<AsyncLocalStorageLike<TransactionContextStore> | null> | null
}

const databaseExecutionStates = new WeakMap<
  OpSQLiteDatabaseLike,
  DatabaseExecutionState
>()

function getDatabaseExecutionState(
  database: OpSQLiteDatabaseLike,
): DatabaseExecutionState {
  const existing = databaseExecutionStates.get(database)
  if (existing) {
    return existing
  }

  const state: DatabaseExecutionState = {
    queue: Promise.resolve(),
    nextSavepointId: 1,
    transactionContextStoragePromise: null,
  }
  databaseExecutionStates.set(database, state)
  return state
}

let asyncLocalStorageCtorPromise: Promise<AsyncLocalStorageCtor | null> | null =
  null

function canAttemptNodeAsyncLocalStorageLoad(): boolean {
  if (typeof process === `undefined`) {
    return false
  }
  // In React Native, process is polyfilled but process.versions may not exist
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
      // Use Function constructor to hide the dynamic import from React Native
      // bundlers — Metro rejects non-literal dynamic import() at transform time.
      // On React Native this code path is never reached (guarded above).
      const importFn = new Function(`s`, `return import(s)`) as (
        specifier: string,
      ) => Promise<{
        AsyncLocalStorage?: AsyncLocalStorageCtor
      }>
      const asyncHooksModule = await importFn(getNodeAsyncHooksSpecifier())

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

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function rejectInheritedCarrierKeys(
  value: Record<string, unknown>,
  sql: string,
): void {
  for (const key of [
    `rows`,
    `resultRows`,
    `rawRows`,
    `columnNames`,
    `results`,
  ]) {
    if (!hasOwnKey(value, key) && key in value) {
      unsupportedQueryResult(sql, `inherited ${key} carrier`)
    }
  }
}

function hasWriteResultMarker(value: Record<string, unknown>): boolean {
  for (const key of WRITE_RESULT_KEYS) {
    if (hasOwnKey(value, key)) {
      return true
    }
  }
  return false
}

function isWriteResultEnvelope(value: Record<string, unknown>): boolean {
  return (
    hasWriteResultMarker(value) &&
    Object.keys(value).every((key) => WRITE_RESULT_KEYS.has(key))
  )
}

function unsupportedQueryResult(sql: string, details?: string): never {
  throw new InvalidPersistedCollectionConfigError(
    `Unsupported op-sqlite query result shape for SQL "${sql}"${
      details ? `: ${details}` : ``
    }`,
  )
}

function isValidRowList(
  rowsObject: OpSQLiteRowListLike,
): rowsObject is OpSQLiteRowListLike & {
  length: number
  item: (index: number) => unknown
} {
  return (
    typeof rowsObject.length === `number` &&
    Number.isSafeInteger(rowsObject.length) &&
    rowsObject.length >= 0 &&
    typeof rowsObject.item === `function`
  )
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

  if (isValidRowList(rowsObject)) {
    const rows: Array<unknown> = []
    for (let index = 0; index < rowsObject.length; index++) {
      rows.push(rowsObject.item(index))
    }
    return rows
  }

  return null
}

function isRowCarrier(rowsValue: unknown): boolean {
  if (Array.isArray(rowsValue)) {
    return true
  }

  if (!isObjectRecord(rowsValue)) {
    return false
  }

  const rowsObject = rowsValue as OpSQLiteRowListLike
  return Array.isArray(rowsObject._array) || isValidRowList(rowsObject)
}

function isStatementResultEnvelope(value: Record<string, unknown>): boolean {
  if (!Object.keys(value).every((key) => STATEMENT_RESULT_KEYS.has(key))) {
    return false
  }

  // Bare arrays are also a supported row carrier. A legitimate row can contain
  // only write-marker aliases, so markers alone cannot prove that an array is a
  // statement wrapper; wrappers need an actual row structure.
  const hasRowCarrier =
    isRowCarrier(value.rows) ||
    isRowCarrier(value.resultRows) ||
    Array.isArray(value.results)
  const hasStructuralCarrier =
    hasRowCarrier ||
    Array.isArray(value.rawRows) ||
    Array.isArray(value.columnNames)

  return (
    hasRowCarrier ||
    (hasWriteResultMarker(value) && hasStructuralCarrier) ||
    (Array.isArray(value.rawRows) && Array.isArray(value.columnNames))
  )
}

function decodeColumnarRows(
  value: Record<string, unknown>,
  sql: string,
): Array<Record<string, unknown>> | null {
  const hasRawRows = hasOwnKey(value, `rawRows`)
  const hasColumnNames = hasOwnKey(value, `columnNames`)
  if (!hasRawRows && !hasColumnNames) {
    return null
  }

  if (!hasRawRows || !hasColumnNames) {
    unsupportedQueryResult(
      sql,
      `columnar results require both rawRows and columnNames`,
    )
  }
  const rawRows = value.rawRows
  const columnNames = value.columnNames
  if (
    !Array.isArray(rawRows) ||
    !Array.isArray(columnNames) ||
    !columnNames.every((columnName) => typeof columnName === `string`)
  ) {
    unsupportedQueryResult(sql, `invalid columnar row or column metadata`)
  }

  if (rawRows.length > 0 && columnNames.length === 0) {
    unsupportedQueryResult(
      sql,
      `nonempty columnar results require at least one column name`,
    )
  }

  return rawRows.map((rawRow) => {
    if (!Array.isArray(rawRow) || rawRow.length !== columnNames.length) {
      unsupportedQueryResult(
        sql,
        `columnar row width does not match columnNames`,
      )
    }

    const row: Record<string, unknown> = {}
    for (let index = 0; index < columnNames.length; index++) {
      const columnName = columnNames[index]!
      if (columnName === `__proto__`) {
        Object.defineProperty(row, columnName, {
          configurable: true,
          enumerable: true,
          value: rawRow[index],
          writable: true,
        })
      } else {
        row[columnName] = rawRow[index]
      }
    }
    return row
  })
}

function rejectPositionalRows(
  rows: Array<unknown>,
  sql: string,
): Array<unknown> {
  if (rows.some((row) => Array.isArray(row))) {
    unsupportedQueryResult(sql, `positional rows require column metadata`)
  }
  return rows
}

function extractRowsFromStatementResult(
  record: Record<string, unknown>,
  sql: string,
  allowResultsWrapper: boolean,
): Array<unknown> {
  rejectInheritedCarrierKeys(record, sql)
  const rowCarrierKeys = [`rows`, `resultRows`].filter((key) =>
    hasOwnKey(record, key),
  )
  const rowCarrierKey = rowCarrierKeys[0]
  if (
    rowCarrierKeys.length > 1 ||
    (rowCarrierKeys.length > 0 &&
      (hasOwnKey(record, `results`) ||
        (rowCarrierKey === `resultRows` && hasOwnKey(record, `rawRows`))))
  ) {
    unsupportedQueryResult(sql, `query result contains conflicting carriers`)
  }

  if (rowCarrierKeys.length === 1) {
    const rows = toRowArray(record[rowCarrierKey!])
    if (!rows) {
      unsupportedQueryResult(sql, `invalid ${rowCarrierKey} carrier`)
    }
    return rejectPositionalRows(rows, sql)
  }

  if (
    (hasOwnKey(record, `rawRows`) || hasOwnKey(record, `columnNames`)) &&
    hasOwnKey(record, `results`)
  ) {
    unsupportedQueryResult(sql, `query result contains conflicting carriers`)
  }

  const columnarRows = decodeColumnarRows(record, sql)
  if (columnarRows) {
    return columnarRows
  }

  if (hasOwnKey(record, `results`)) {
    if (!allowResultsWrapper) {
      unsupportedQueryResult(sql, `unsupported nested results depth`)
    }
    const nestedResults = record.results
    if (
      !Array.isArray(nestedResults) ||
      nestedResults.length !== 1 ||
      !isObjectRecord(nestedResults[0])
    ) {
      unsupportedQueryResult(sql, `invalid nested results carrier`)
    }
    return extractRowsFromStatementResult(nestedResults[0], sql, false)
  }

  if (isWriteResultEnvelope(record)) {
    return []
  }

  return unsupportedQueryResult(sql)
}

function extractRowsFromExecuteResult(
  result: unknown,
  sql: string,
  arrayResultMode?: OpSQLiteArrayResultMode,
): Array<unknown> {
  if (result == null) {
    return unsupportedQueryResult(sql)
  }

  if (Array.isArray(result)) {
    if (result.length === 0) {
      if (arrayResultMode === `statement-results`) {
        return unsupportedQueryResult(
          sql,
          `statement-result arrays must contain exactly one result`,
        )
      }
      return []
    }

    if (arrayResultMode === `rows`) {
      return rejectPositionalRows(result, sql)
    }

    const firstEntry = result[0]
    const isStructuralStatementResult =
      isObjectRecord(firstEntry) && isStatementResultEnvelope(firstEntry)
    if (arrayResultMode === `statement-results`) {
      if (!isObjectRecord(firstEntry)) {
        return unsupportedQueryResult(
          sql,
          `statement-results mode requires an object statement envelope`,
        )
      }
      if (result.length !== 1) {
        return unsupportedQueryResult(
          sql,
          `statement-result arrays must contain exactly one result`,
        )
      }
      return extractRowsFromStatementResult(firstEntry, sql, false)
    }

    if (isStructuralStatementResult) {
      return unsupportedQueryResult(
        sql,
        `ambiguous bare result array; set arrayResultMode to "rows" or "statement-results"`,
      )
    }

    return rejectPositionalRows(result, sql)
  }

  if (isObjectRecord(result)) {
    return extractRowsFromStatementResult(result, sql, true)
  }

  return unsupportedQueryResult(sql)
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
  private readonly arrayResultMode: OpSQLiteArrayResultMode | undefined
  private readonly ownsDatabase: boolean
  private readonly executionState: DatabaseExecutionState

  constructor(options: OpSQLiteDriverOptions) {
    if (hasExistingDatabase(options)) {
      this.database = options.database
      this.ownsDatabase = false
    } else {
      this.database = options.openDatabase()
      this.ownsDatabase = true
    }

    this.executeMethod = resolveExecuteMethod(this.database)
    this.arrayResultMode = options.arrayResultMode
    this.executionState = getDatabaseExecutionState(this.database)
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
      return extractRowsFromExecuteResult(
        result,
        sql,
        this.arrayResultMode,
      ) as ReadonlyArray<T>
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

  getDatabase(): OpSQLiteDatabaseLike {
    return this.database
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
    const queuedOperation = this.executionState.queue.then(operation, operation)
    this.executionState.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private async getTransactionContextStorage(): Promise<AsyncLocalStorageLike<TransactionContextStore> | null> {
    if (this.executionState.transactionContextStoragePromise) {
      return this.executionState.transactionContextStoragePromise
    }

    this.executionState.transactionContextStoragePromise = (async () => {
      const asyncLocalStorageCtor = await resolveAsyncLocalStorageCtor()
      if (!asyncLocalStorageCtor) {
        return null
      }

      return new asyncLocalStorageCtor<TransactionContextStore>()
    })()

    return this.executionState.transactionContextStoragePromise
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
        return extractRowsFromExecuteResult(
          result,
          sql,
          this.arrayResultMode,
        ) as ReadonlyArray<T>
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
    const savepointName = `tsdb_sp_${this.executionState.nextSavepointId}`
    this.executionState.nextSavepointId++
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
