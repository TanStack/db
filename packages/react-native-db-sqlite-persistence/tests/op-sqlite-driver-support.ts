/**
 * Shared helpers for the op-sqlite driver tests: temporary databases, columnar
 * test harnesses, and the exact-row checkers. The ordinary driver tests in
 * op-sqlite-driver.test.ts and the alias owner in op-sqlite-driver-oracle.test.ts
 * import them. The checkers compare with the rows their caller supplies, so
 * they state no expectation of their own.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import { oracleRuns } from '../../db/tests/oracle-config.js'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type { SQLiteDriverContractHarnessFactory } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'

export const activeCleanupFns: Array<() => void | Promise<void>> = []

export async function runActiveCleanupFns(): Promise<void> {
  const cleanupErrors: Array<unknown> = []
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    try {
      await Promise.resolve(cleanupFn?.())
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length === 1) {
    throw cleanupErrors[0]
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, `op-sqlite test cleanup failed`, {
      cause: cleanupErrors[0],
    })
  }
}

export function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-op-sqlite-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

export type ColumnarDriverHarness = {
  driver: OpSQLiteDriver
  queryExecutions: () => number
}

export async function withColumnarDriver<T>(
  fn: (harness: ColumnarDriverHarness) => Promise<T>,
): Promise<T> {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-rn-op-sqlite-alias-contract-`),
  )
  let database: ReturnType<typeof createOpSQLiteTestDatabase> | undefined
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    database = createOpSQLiteTestDatabase({
      filename: join(tempDirectory, `state.sqlite`),
      resultShape: `execute-async-columnar`,
    })
    const queryExecutions = trackQueryExecutions(database)
    const driver = new OpSQLiteDriver({ database })
    outcome = {
      ok: true,
      value: await fn({ driver, queryExecutions }),
    }
  } catch (error) {
    outcome = { ok: false, error }
  }

  const cleanupErrors: Array<unknown> = []
  if (database) {
    try {
      await Promise.resolve(database.close())
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    rmSync(tempDirectory, { recursive: true, force: true })
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (!outcome.ok) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [outcome.error, ...cleanupErrors],
        `op-sqlite alias law and cleanup failed`,
        { cause: outcome.error },
      )
    }
    throw outcome.error
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, `op-sqlite alias cleanup failed`, {
      cause: cleanupErrors[0],
    })
  }
  return outcome.value
}

export async function queryInjectedResult<T = unknown>(
  result: unknown,
  arrayResultMode?: `rows` | `statement-results`,
): Promise<ReadonlyArray<T>> {
  return new OpSQLiteDriver({
    database: {
      executeAsync: () => Promise.resolve(result),
    },
    ...(arrayResultMode ? { arrayResultMode } : {}),
  }).query<T>(`SELECT * FROM injected_result`)
}

export function expectExactRows<T>(
  actual: ReadonlyArray<T>,
  expected: ReadonlyArray<T>,
): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((row, rowIndex) => {
    if (isRecord(row)) {
      const actualRow = actual[rowIndex]
      expect(Object.keys(isRecord(actualRow) ? actualRow : {})).toEqual(
        Object.keys(row),
      )
    }
    expect(actual[rowIndex]).toEqual(row)
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

export function expectExactAliasRows(
  actual: ReadonlyArray<Record<string, unknown>>,
  expected: ReadonlyArray<Record<string, unknown>>,
): void {
  try {
    expect(actual).toHaveLength(expected.length)
    expected.forEach((row, rowIndex) => {
      expect(Object.keys(actual[rowIndex] ?? {})).toEqual(Object.keys(row))
      expect(actual[rowIndex]).toEqual(row)
    })
  } catch (cause) {
    throw new Error(`op-sqlite reserved-alias exact-row law violated`, {
      cause,
    })
  }
}

export const statementResultFieldNames = [
  `rows`,
  `resultRows`,
  `rawRows`,
  `columnNames`,
  `results`,
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
  `res`,
] as const

export const statementResultAliasNames = [
  ...statementResultFieldNames,
  `ordinary_name`,
  `another_value`,
] as const

export const writeResultFieldNames = [
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
] as const

export type AliasOracleEnvironment = Record<string, string | undefined>

export function readAliasOracleRuns(
  environment: AliasOracleEnvironment = process.env,
): number {
  // A run-count control, not a replay coordinate. Its default is the shared
  // base count, so TANSTACK_DB_ORACLE_RUNS_MULTIPLIER still scales it.
  const runsText =
    environment.TANSTACK_DB_OP_SQLITE_ORACLE_RUNS ?? String(oracleRuns(50))
  const runs = Number(runsText)
  if (runsText.trim() === `` || !Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(
      `TANSTACK_DB_OP_SQLITE_ORACLE_RUNS must be a positive integer`,
    )
  }
  return runs
}

export function trackQueryExecutions(
  database: ReturnType<typeof createOpSQLiteTestDatabase>,
): () => number {
  const executeAsync = database.executeAsync
  if (!executeAsync) {
    throw new Error(`columnar fixture must expose executeAsync`)
  }
  let queryExecutions = 0
  database.executeAsync = (sql, params) => {
    if (/^\s*SELECT\b/i.test(sql)) queryExecutions++
    return executeAsync.call(database, sql, params)
  }
  return () => queryExecutions
}

export function createColumnarDriverHarness(
  createDatabase: typeof createOpSQLiteTestDatabase = createOpSQLiteTestDatabase,
): ReturnType<SQLiteDriverContractHarnessFactory> {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-op-sqlite-contract-`))
  let database: ReturnType<typeof createOpSQLiteTestDatabase> | undefined
  try {
    const createdDatabase = createDatabase({
      filename: join(tempDirectory, `state.sqlite`),
      resultShape: `execute-async-columnar`,
    })
    database = createdDatabase
    const driver = new OpSQLiteDriver({ database: createdDatabase })

    return {
      driver,
      cleanup: async () => {
        const cleanupErrors: Array<unknown> = []
        try {
          await Promise.resolve(createdDatabase.close())
        } catch (error) {
          cleanupErrors.push(error)
        }
        try {
          rmSync(tempDirectory, { recursive: true, force: true })
        } catch (error) {
          cleanupErrors.push(error)
        }
        if (cleanupErrors.length === 1) throw cleanupErrors[0]
        if (cleanupErrors.length > 1) {
          throw new AggregateError(
            cleanupErrors,
            `op-sqlite contract cleanup failed`,
            { cause: cleanupErrors[0] },
          )
        }
      },
    }
  } catch (error) {
    const cleanupErrors: Array<unknown> = []
    try {
      database?.close()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    try {
      rmSync(tempDirectory, { recursive: true, force: true })
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `op-sqlite contract construction and cleanup failed`,
        { cause: error },
      )
    }
    throw error
  }
}
