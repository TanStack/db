import { InvalidPersistedCollectionConfigError } from '@tanstack/db-persistence-core'
import type { SQLiteDriver } from '@tanstack/db-persistence-core'
import type Database from '@tauri-apps/plugin-sql'

export type TauriSQLiteDatabaseLike = Pick<
  Database,
  `execute` | `select` | `close` | `path`
>

export type TauriSQLiteDriverOptions = {
  database: TauriSQLiteDatabaseLike
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

function isTauriSQLiteDatabaseLike(
  value: unknown,
): value is TauriSQLiteDatabaseLike {
  const candidate = value as Partial<TauriSQLiteDatabaseLike>
  return (
    typeof value === `object` &&
    value !== null &&
    typeof candidate.path === `string` &&
    typeof candidate.execute === `function` &&
    typeof candidate.select === `function`
  )
}

function normalizeQueryRows<TRow>(
  rows: unknown,
  sql: string,
): ReadonlyArray<TRow> {
  if (Array.isArray(rows)) {
    return rows as ReadonlyArray<TRow>
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported Tauri SQL query result shape for SQL "${sql}"`,
  )
}

function convertSqlitePlaceholdersToTauri(sql: string): string {
  let result = ``
  let parameterIndex = 1
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index++) {
    const currentChar = sql[index]
    const nextChar = sql[index + 1]

    if (inLineComment) {
      result += currentChar
      if (currentChar === `\n`) {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      result += currentChar
      if (currentChar === `*` && nextChar === `/`) {
        result += `/`
        index++
        inBlockComment = false
      }
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (currentChar === `-` && nextChar === `-`) {
        result += `--`
        index++
        inLineComment = true
        continue
      }

      if (currentChar === `/` && nextChar === `*`) {
        result += `/*`
        index++
        inBlockComment = true
        continue
      }
    }

    if (currentChar === `'` && !inDoubleQuote) {
      result += currentChar
      if (inSingleQuote && nextChar === `'`) {
        result += `'`
        index++
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (currentChar === `"` && !inSingleQuote) {
      result += currentChar
      if (inDoubleQuote && nextChar === `"`) {
        result += `"`
        index++
        continue
      }
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (currentChar === `?` && !inSingleQuote && !inDoubleQuote) {
      result += `$${String(parameterIndex)}`
      parameterIndex++
      continue
    }

    result += currentChar
  }

  return result
}

export class TauriSQLiteDriver implements SQLiteDriver {
  private readonly database: TauriSQLiteDatabaseLike
  private queue: Promise<void> = Promise.resolve()
  private nextSavepointId = 1

  constructor(options: TauriSQLiteDriverOptions) {
    if (!isTauriSQLiteDatabaseLike(options.database)) {
      throw new InvalidPersistedCollectionConfigError(
        `Tauri SQLite database object must provide execute/select methods`,
      )
    }

    this.database = options.database
  }

  async exec(sql: string): Promise<void> {
    await this.enqueue(async () => {
      await this.executeStatement(sql)
    })
  }

  async query<TRow>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<TRow>> {
    return this.enqueue(async () => {
      const rows = await this.database.select<ReadonlyArray<TRow>>(
        convertSqlitePlaceholdersToTauri(sql),
        params.length > 0 ? [...params] : undefined,
      )
      return normalizeQueryRows<TRow>(rows, sql)
    })
  }

  async run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    await this.enqueue(async () => {
      await this.executeStatement(sql, params)
    })
  }

  async transaction<TReturn>(
    fn: (transactionDriver: SQLiteDriver) => Promise<TReturn>,
  ): Promise<TReturn> {
    assertTransactionCallbackHasDriverArg(fn)
    return this.transactionWithDriver(fn)
  }

  async transactionWithDriver<TReturn>(
    fn: (transactionDriver: SQLiteDriver) => Promise<TReturn>,
  ): Promise<TReturn> {
    return this.enqueue(async () => {
      await this.executeStatement(`BEGIN IMMEDIATE`)
      const transactionDriver = this.createTransactionDriver()

      try {
        const result = await fn(transactionDriver)
        await this.executeStatement(`COMMIT`)
        return result
      } catch (error) {
        try {
          await this.executeStatement(`ROLLBACK`)
        } catch {
          // Keep the original transaction error as the primary failure.
        }
        throw error
      }
    })
  }

  async close(): Promise<void> {
    if (typeof this.database.close !== `function`) {
      return
    }

    await Promise.resolve(this.database.close(this.database.path))
  }

  getDatabase(): TauriSQLiteDatabaseLike {
    return this.database
  }

  private async executeStatement(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<void> {
    await this.database.execute(
      convertSqlitePlaceholdersToTauri(sql),
      params.length > 0 ? [...params] : undefined,
    )
  }

  private enqueue<TReturn>(
    operation: () => Promise<TReturn>,
  ): Promise<TReturn> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  private createTransactionDriver(): SQLiteDriver {
    const transactionDriver: SQLiteDriver = {
      exec: async (sql) => {
        await this.executeStatement(sql)
      },
      query: async <TRow>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<TRow>> => {
        const rows = await this.database.select<ReadonlyArray<TRow>>(
          convertSqlitePlaceholdersToTauri(sql),
          params.length > 0 ? [...params] : undefined,
        )
        return normalizeQueryRows<TRow>(rows, sql)
      },
      run: async (sql, params = []) => {
        await this.executeStatement(sql, params)
      },
      transaction: async <TReturn>(
        fn: (transactionDriver: SQLiteDriver) => Promise<TReturn>,
      ): Promise<TReturn> => {
        assertTransactionCallbackHasDriverArg(fn)
        return this.runNestedTransaction(transactionDriver, fn)
      },
      transactionWithDriver: async <TReturn>(
        fn: (transactionDriver: SQLiteDriver) => Promise<TReturn>,
      ): Promise<TReturn> => this.runNestedTransaction(transactionDriver, fn),
    }

    return transactionDriver
  }

  private async runNestedTransaction<TReturn>(
    transactionDriver: SQLiteDriver,
    fn: (transactionDriver: SQLiteDriver) => Promise<TReturn>,
  ): Promise<TReturn> {
    const savepointName = `tsdb_sp_${this.nextSavepointId}`
    this.nextSavepointId++
    await this.executeStatement(`SAVEPOINT ${savepointName}`)

    try {
      const result = await fn(transactionDriver)
      await this.executeStatement(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await this.executeStatement(`ROLLBACK TO SAVEPOINT ${savepointName}`)
      await this.executeStatement(`RELEASE SAVEPOINT ${savepointName}`)
      throw error
    }
  }
}

export function createTauriSQLiteDriver(
  options: TauriSQLiteDriverOptions,
): TauriSQLiteDriver {
  return new TauriSQLiteDriver(options)
}
