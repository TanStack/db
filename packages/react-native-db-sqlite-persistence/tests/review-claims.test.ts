/**
 * Red/green verification for external-review claim (#1499): op-sqlite v14's
 * `executeAsync` returns a columnar result ({ rowsAffected, rawRows,
 * columnNames }) that the driver misreads as an empty write result, silently
 * turning every SELECT into zero rows.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import type { OpSQLiteDatabaseLike } from '../src/op-sqlite-driver'

const activeCleanupFns: Array<() => void> = []

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    activeCleanupFns.pop()?.()
  }
})

const QUERY_SQL_PATTERN = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i

/**
 * Models an op-sqlite v14 database that only exposes `executeAsync`, whose
 * SELECT results come back columnar: rawRows (arrays) + columnNames.
 */
function createExecuteAsyncColumnarDatabase(): OpSQLiteDatabaseLike & {
  close: () => void
} {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-review-claims-`))
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  const nativeDb = new BetterSqlite3(join(tempDirectory, `state.sqlite`))

  return {
    executeAsync: (sql: string, params?: ReadonlyArray<unknown>) => {
      const bindParams = [...(params ?? [])] as Array<never>
      if (QUERY_SQL_PATTERN.test(sql)) {
        const statement = nativeDb.prepare(sql)
        const columnNames = statement.columns().map((column) => column.name)
        const rawRows = statement.raw(true).all(...bindParams) as Array<
          Array<unknown>
        >
        return Promise.resolve({ rowsAffected: 0, rawRows, columnNames })
      }
      const info = nativeDb.prepare(sql).run(...bindParams)
      return Promise.resolve({
        rowsAffected: info.changes,
        insertId: Number(info.lastInsertRowid),
      })
    },
    close: () => {
      nativeDb.close()
    },
  }
}

it(`returns SELECT rows (instead of silently returning none) for executeAsync columnar results`, async () => {
  const database = createExecuteAsyncColumnarDatabase()
  activeCleanupFns.push(() => database.close())

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )
  await driver.run(`INSERT INTO todos (id, title) VALUES (?, ?)`, [
    `1`,
    `From executeAsync`,
  ])

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM todos ORDER BY id ASC`,
  )

  // DESIRED INVARIANT: a valid SELECT must never silently become zero rows.
  // Current behavior: extractRowsFromStatementResult sees `rowsAffected`,
  // treats the result as a write, and returns [] — which upstream cascades
  // into "UNIQUE constraint failed: collection_registry..." at startup.
  expect(rows).toEqual([{ id: `1`, title: `From executeAsync` }])
})
