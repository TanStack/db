/**
 * Harness support for the SQLite core adapter tests. It holds the sqlite3 CLI
 * driver and the adapter harness that the shared contract suite and the oracle
 * file both construct. It is an ordinary module: it registers no tests.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SQLiteCorePersistenceAdapter } from '../src'
import type {
  PersistedStorageTarget,
  PersistenceAdapter,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '../src'

export type Todo = {
  id: string
  title: string
  createdAt: string
  score: number
}

const execFileAsync = promisify(execFile)

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `1` : `0`
  }

  if (typeof value === `bigint`) {
    return value.toString()
  }

  const textValue = typeof value === `string` ? value : String(value)
  return `'${textValue.replace(/'/g, `''`)}'`
}

function interpolateSql(sql: string, params: ReadonlyArray<unknown>): string {
  let parameterIndex = 0
  const renderedSql = sql.replace(/\?/g, () => {
    const currentParam = params[parameterIndex]
    parameterIndex++
    return toSqlLiteral(currentParam)
  })

  if (parameterIndex !== params.length) {
    throw new Error(
      `SQL interpolation mismatch: used ${parameterIndex} params, received ${params.length}`,
    )
  }

  return renderedSql
}

export class SqliteCliDriver implements SQLiteDriver {
  private readonly transactionDbPath = new AsyncLocalStorage<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async exec(sql: string): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [activeDbPath, sql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [this.dbPath, sql])
    })
  }

  async query<T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const queryActiveDbPath = activeDbPath ?? this.dbPath

    const runQuery = async () => {
      const { stdout } = await execFileAsync(`sqlite3`, [
        `-json`,
        queryActiveDbPath,
        ...(renderedSql.trimStart().startsWith(`EXPLAIN QUERY PLAN`)
          ? [`.explain off`]
          : []),
        renderedSql,
      ])
      const trimmedOutput = stdout.trim()
      if (!trimmedOutput) {
        return []
      }
      return JSON.parse(trimmedOutput) as Array<T>
    }

    if (activeDbPath) {
      return runQuery()
    }

    return this.enqueue(async () => runQuery())
  }

  async run(sql: string, params?: ReadonlyArray<unknown>): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const runActiveDbPath = activeDbPath ?? this.dbPath

    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
    })
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    if (fn.length === 0) {
      throw new Error(
        `SQLiteDriver.transaction callback must accept the transaction driver argument`,
      )
    }

    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      return fn(this)
    }

    return this.enqueue(async () => {
      const txDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-tx-`))
      const txDbPath = join(txDirectory, `state.sqlite`)

      if (existsSync(this.dbPath)) {
        copyFileSync(this.dbPath, txDbPath)
      }

      try {
        const txResult = await this.transactionDbPath.run(txDbPath, async () =>
          fn(this),
        )

        if (existsSync(txDbPath)) {
          copyFileSync(txDbPath, this.dbPath)
        }
        return txResult
      } finally {
        rmSync(txDirectory, { recursive: true, force: true })
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}

type AdapterHarness = {
  adapter: SQLiteCorePersistenceAdapter
  driver: SqliteCliDriver
  dbPath: string
  cleanup: () => void | Promise<void>
}

export type SQLiteCoreAdapterContractHarness = {
  adapter: PersistenceAdapter & {
    pullSince: (
      target: PersistedStorageTarget,
      fromRowVersion: number,
    ) => Promise<SQLitePullSinceResult<string | number>>
  }
  driver: SQLiteDriver
  cleanup: () => void | Promise<void>
}

export function createHarness(
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter>[0],
    `driver`
  >,
): AdapterHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new SqliteCliDriver(dbPath)
  const adapter = new SQLiteCorePersistenceAdapter({
    driver,
    ...options,
  })

  return {
    adapter,
    driver,
    dbPath,
    cleanup: () => {
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

export type SQLiteCoreAdapterHarnessFactory = (
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter>[0],
    `driver`
  >,
) => SQLiteCoreAdapterContractHarness
