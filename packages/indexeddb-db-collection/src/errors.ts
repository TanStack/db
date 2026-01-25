export class IndexedDBError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = `IndexedDBError`
  }
}

/**
 * Thrown when IndexedDB is not available in the environment.
 * This can happen in server-side rendering, older browsers,
 * or when running in contexts where IndexedDB is disabled.
 */
export class IndexedDBNotSupportedError extends IndexedDBError {
  constructor() {
    super(`IndexedDB is not supported in this environment`)
    this.name = `IndexedDBNotSupportedError`
  }
}

/**
 * Thrown when a database connection fails.
 * Includes the database name and the underlying error as cause.
 */
export class IndexedDBConnectionError extends IndexedDBError {
  databaseName: string

  constructor(databaseName: string, cause?: unknown) {
    super(`Failed to connect to IndexedDB database "${databaseName}"`, {
      cause,
    })
    this.name = `IndexedDBConnectionError`
    this.databaseName = databaseName
  }
}

/**
 * Thrown when a transaction fails.
 * Includes the transaction mode and store names for context.
 */
export class IndexedDBTransactionError extends IndexedDBError {
  mode: IDBTransactionMode
  storeNames: Array<string>

  constructor(
    mode: IDBTransactionMode,
    storeNames: Array<string>,
    cause?: unknown,
  ) {
    const storeNamesStr =
      storeNames.length === 1
        ? `store "${storeNames[0]}"`
        : `stores [${storeNames.map((s) => `"${s}"`).join(`, `)}]`
    super(`IndexedDB transaction failed in "${mode}" mode on ${storeNamesStr}`, {
      cause,
    })
    this.name = `IndexedDBTransactionError`
    this.mode = mode
    this.storeNames = storeNames
  }
}

/**
 * Thrown when a CRUD operation fails.
 * Includes the operation type and store name for context.
 */
export class IndexedDBOperationError extends IndexedDBError {
  operation: `get` | `put` | `delete` | `clear`
  storeName: string

  constructor(
    operation: `get` | `put` | `delete` | `clear`,
    storeName: string,
    cause?: unknown,
  ) {
    super(`IndexedDB "${operation}" operation failed on store "${storeName}"`, {
      cause,
    })
    this.name = `IndexedDBOperationError`
    this.operation = operation
    this.storeName = storeName
  }
}
