import { AsyncLocalStorage } from 'node:async_hooks'
import BetterSqlite3 from 'better-sqlite3'
import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persisted-collection-core'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persisted-collection-core'

const DEFAULT_PRAGMAS = [
  `journal_mode = WAL`,
  `synchronous = NORMAL`,
  `foreign_keys = ON`,
] as const

const INVALID_PRAGMA_PATTERN = /(;|--|\/\*)/

export type BetterSqlite3Database = InstanceType<typeof BetterSqlite3>
export type BetterSqlite3OpenOptions = ConstructorParameters<
  typeof BetterSqlite3
>[1]

type BetterSqlite3ExistingDatabaseOptions = {
  database: BetterSqlite3Database
  pragmas?: ReadonlyArray<string>
}

type BetterSqlite3OpenFileOptions = {
  filename: string
  options?: BetterSqlite3OpenOptions
  pragmas?: ReadonlyArray<string>
}

export type BetterSqlite3DriverOptions =
  | BetterSqlite3ExistingDatabaseOptions
  | BetterSqlite3OpenFileOptions

type TransactionContext = {
  depth: number
}

function hasExistingDatabase(
  options: BetterSqlite3DriverOptions,
): options is BetterSqlite3ExistingDatabaseOptions {
  return `database` in options
}

export class BetterSqlite3SQLiteDriver implements SQLiteDriver {
  private readonly database: BetterSqlite3Database
  private readonly ownsDatabase: boolean
  private readonly transactionContext =
    new AsyncLocalStorage<TransactionContext>()
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1

  constructor(options: BetterSqlite3DriverOptions) {
    if (hasExistingDatabase(options)) {
      this.database = options.database
      this.ownsDatabase = false
      this.applyPragmas(options.pragmas ?? DEFAULT_PRAGMAS)
      return
    }

    if (options.filename.trim().length === 0) {
      throw new InvalidPersistedCollectionConfigError(
        `Node SQLite driver filename cannot be empty`,
      )
    }

    this.database = new BetterSqlite3(options.filename, options.options)
    this.ownsDatabase = true
    this.applyPragmas(options.pragmas ?? DEFAULT_PRAGMAS)
  }

  async exec(sql: string): Promise<void> {
    if (this.isInsideTransaction()) {
      this.database.exec(sql)
      return
    }

    await this.enqueue(() => {
      this.database.exec(sql)
    })
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    if (this.isInsideTransaction()) {
      return this.executeQuery<T>(sql, params)
    }

    return this.enqueue(() => this.executeQuery<T>(sql, params))
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    if (this.isInsideTransaction()) {
      this.executeRun(sql, params)
      return
    }

    await this.enqueue(() => {
      this.executeRun(sql, params)
    })
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isInsideTransaction()) {
      return this.runNestedTransaction(fn)
    }

    return this.enqueue(async () => {
      this.database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await this.transactionContext.run(
          { depth: 1 },
          async () => fn(),
        )
        this.database.exec(`COMMIT`)
        return result
      } catch (error) {
        try {
          this.database.exec(`ROLLBACK`)
        } catch {
          // Keep the original transaction error as the primary failure.
        }
        throw error
      }
    })
  }

  close(): void {
    if (!this.ownsDatabase) {
      return
    }

    this.database.close()
  }

  getDatabase(): BetterSqlite3Database {
    return this.database
  }

  private applyPragmas(pragmas: ReadonlyArray<string>): void {
    for (const pragma of pragmas) {
      const trimmedPragma = pragma.trim()
      if (trimmedPragma.length === 0) {
        continue
      }

      if (INVALID_PRAGMA_PATTERN.test(trimmedPragma)) {
        throw new InvalidPersistedCollectionConfigError(
          `Invalid SQLite PRAGMA: "${pragma}"`,
        )
      }

      this.database.exec(`PRAGMA ${trimmedPragma}`)
    }
  }

  private isInsideTransaction(): boolean {
    return this.transactionContext.getStore() !== undefined
  }

  private executeQuery<T>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): ReadonlyArray<T> {
    const statement = this.database.prepare(sql)
    if (params.length === 0) {
      return statement.all() as ReadonlyArray<T>
    }

    return statement.all(...params) as ReadonlyArray<T>
  }

  private executeRun(sql: string, params: ReadonlyArray<unknown>): void {
    const statement = this.database.prepare(sql)
    if (params.length === 0) {
      statement.run()
      return
    }

    statement.run(...params)
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private async runNestedTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const context = this.transactionContext.getStore()
    if (!context) {
      return fn()
    }

    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    this.database.exec(`SAVEPOINT ${savepointName}`)

    try {
      const result = await this.transactionContext.run(
        { depth: context.depth + 1 },
        async () => fn(),
      )
      this.database.exec(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      this.database.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      this.database.exec(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }
}

export function createBetterSqlite3Driver(
  options: BetterSqlite3DriverOptions,
): BetterSqlite3SQLiteDriver {
  return new BetterSqlite3SQLiteDriver(options)
}
