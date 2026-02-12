import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persisted-collection-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persisted-collection-core'

const SQLITE_ROW = 100
const SQLITE_DONE = 101

type BrowserWASQLiteBindCollection =
  | ReadonlyArray<BrowserWASQLiteBindingValue>
  | Readonly<Record<string, BrowserWASQLiteBindingValue>>

type BrowserWASQLiteBindingValue =
  | null
  | string
  | number
  | bigint
  | Uint8Array
  | ReadonlyArray<number>

export interface BrowserWASQLiteAPI {
  statements: (db: number, sql: string) => AsyncIterable<number>
  bind_collection: (
    statement: number,
    bindings: BrowserWASQLiteBindCollection,
  ) => number
  step: (statement: number) => Promise<number>
  row: (statement: number) => ReadonlyArray<unknown>
  column_names: (statement: number) => ReadonlyArray<string>
  open_v2?: (
    filename: string,
    flags?: number,
    vfsName?: string,
  ) => Promise<number>
  vfs_register?: (vfs: unknown, makeDefault?: boolean) => number
  close?: (db: number) => Promise<number> | number
}

export type BrowserWASQLiteDatabase = {
  sqlite3: BrowserWASQLiteAPI
  db: number
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

function toBindableValue(value: unknown): BrowserWASQLiteBindingValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === `string`) {
    return value
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === `bigint`) {
    return value
  }

  if (typeof value === `boolean`) {
    return value ? 1 : 0
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === `number` && Number.isFinite(entry))
  ) {
    return value
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported parameter type for wa-sqlite binding`,
  )
}

function assertDatabaseShape(
  database: BrowserWASQLiteDatabase,
): asserts database is BrowserWASQLiteDatabase {
  if (typeof database.db !== `number`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite database handle must include a numeric db pointer`,
    )
  }

  if (typeof database.sqlite3.statements !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite sqlite3 API must provide statements(db, sql)`,
    )
  }

  if (typeof database.sqlite3.bind_collection !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite sqlite3 API must provide bind_collection(statement, bindings)`,
    )
  }

  if (typeof database.sqlite3.step !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite sqlite3 API must provide step(statement)`,
    )
  }

  if (typeof database.sqlite3.row !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite sqlite3 API must provide row(statement)`,
    )
  }

  if (typeof database.sqlite3.column_names !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite sqlite3 API must provide column_names(statement)`,
    )
  }
}

export class BrowserWASQLiteDriver implements SQLiteDriver {
  private readonly database: BrowserWASQLiteDatabase
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1
  private closed = false

  constructor(options: BrowserWASQLiteDriverOptions) {
    assertDatabaseShape(options.database)
    this.database = options.database
  }

  async exec(sql: string): Promise<void> {
    await this.enqueue(() => this.executeRunDirect(sql))
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.enqueue(() => this.executeQueryDirect<T>(sql, params))
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    await this.enqueue(() => this.executeRunDirect(sql, params))
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    assertTransactionCallbackHasDriverArg(fn)

    return this.enqueue(async () => {
      await this.executeRunDirect(`BEGIN IMMEDIATE`)
      try {
        const result = await fn(this.createTransactionDriver())
        await this.executeRunDirect(`COMMIT`)
        return result
      } catch (error) {
        try {
          await this.executeRunDirect(`ROLLBACK`)
        } catch {
          // Preserve original transaction error.
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

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true

    if (typeof this.database.close === `function`) {
      await Promise.resolve(this.database.close())
      return
    }

    if (typeof this.database.sqlite3.close === `function`) {
      await Promise.resolve(this.database.sqlite3.close(this.database.db))
    }
  }

  getDatabase(): BrowserWASQLiteDatabase {
    return this.database
  }

  private createTransactionDriver(): SQLiteDriver {
    return {
      exec: (sql) => this.executeRunDirect(sql),
      query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
        this.executeQueryDirect<T>(sql, params),
      run: (sql: string, params: ReadonlyArray<unknown> = []) =>
        this.executeRunDirect(sql, params),
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
    await this.executeRunDirect(`SAVEPOINT ${savepointName}`)
    try {
      const result = await fn(this.createTransactionDriver())
      await this.executeRunDirect(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await this.executeRunDirect(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      await this.executeRunDirect(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }

  private async executeRunDirect(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<void> {
    await this.executeSqlStatements(sql, params, false)
  }

  private async executeQueryDirect<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.executeSqlStatements<T>(sql, params, true)
  }

  private async executeSqlStatements<T>(
    sql: string,
    params: ReadonlyArray<unknown>,
    collectRows: boolean,
  ): Promise<ReadonlyArray<T>> {
    const rows = new Array<T>()
    let parametersBound = false

    for await (const statement of this.database.sqlite3.statements(
      this.database.db,
      sql,
    )) {
      if (params.length > 0) {
        if (parametersBound) {
          throw new InvalidPersistedCollectionConfigError(
            `wa-sqlite driver only supports parameter binding for a single SQL statement`,
          )
        }

        this.database.sqlite3.bind_collection(
          statement,
          params.map((param) => toBindableValue(param)),
        )
        parametersBound = true
      }

      let columns = collectRows
        ? [...this.database.sqlite3.column_names(statement)]
        : []
      for (;;) {
        const stepResult = await this.database.sqlite3.step(statement)

        if (stepResult === SQLITE_ROW) {
          if (collectRows) {
            if (columns.length === 0) {
              columns = [...this.database.sqlite3.column_names(statement)]
            }
            const values = this.database.sqlite3.row(statement)
            rows.push(this.materializeRow<T>(columns, values))
          }
          continue
        }

        if (stepResult === SQLITE_DONE) {
          break
        }

        throw new InvalidPersistedCollectionConfigError(
          `wa-sqlite step returned unexpected result code: ${String(stepResult)}`,
        )
      }
    }

    if (params.length > 0 && !parametersBound) {
      throw new InvalidPersistedCollectionConfigError(
        `SQL query parameters were provided but no statement accepted bindings`,
      )
    }

    return rows
  }

  private materializeRow<T>(
    columns: ReadonlyArray<string>,
    values: ReadonlyArray<unknown>,
  ): T {
    const row: Record<string, unknown> = {}
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const columnName = columns[columnIndex]
      if (!columnName) {
        continue
      }
      row[columnName] = values[columnIndex]
    }
    return row as T
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}
