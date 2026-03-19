import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { InvalidPersistedCollectionConfigError } from '../../db-sqlite-persisted-collection-core/src'
import { TauriSQLiteDriver } from '../src/tauri-sql-driver'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'

const activeCleanupFns: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    await Promise.resolve(cleanupFn?.())
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

it(`keeps literal question marks untouched while binding positional parameters`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => {
    database.close()
  })

  const driver = new TauriSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE prompts (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL)`,
  )
  await driver.run(
    `INSERT INTO prompts (id, title, notes) VALUES (?, ?, 'literal ? kept in SQL')`,
    [`1`, `Why?`],
  )

  const rows = await driver.query<{ title: string; notes: string }>(
    `SELECT title, notes
     FROM prompts
     WHERE title = ?`,
    [`Why?`],
  )

  expect(rows).toEqual([
    {
      title: `Why?`,
      notes: `literal ? kept in SQL`,
    },
  ])
})

it(`does not convert question marks inside line comments`, async () => {
  let capturedSql = ``
  const driver = new TauriSQLiteDriver({
    database: {
      path: `sqlite:test.db`,
      execute: async (sql) => {
        capturedSql = sql
        return { rowsAffected: 0 }
      },
      select: async <TRow>() => [] as unknown as TRow,
      close: async () => true,
    },
  })

  await driver.run(
    `UPDATE prompts
     SET notes = 'changed'
     -- keep this literal ? untouched
     WHERE id = ?`,
    [`1`],
  )

  expect(capturedSql).toContain(`-- keep this literal ? untouched`)
  expect(capturedSql).toContain(`WHERE id = $1`)
})

it(`does not convert question marks inside block comments`, async () => {
  let capturedSql = ``
  const driver = new TauriSQLiteDriver({
    database: {
      path: `sqlite:test.db`,
      execute: async () => ({ rowsAffected: 0 }),
      select: async <TRow>(sql: string) => {
        capturedSql = sql
        return [] as unknown as TRow
      },
      close: async () => true,
    },
  })

  await driver.query(
    `SELECT title
     FROM prompts
     /* keep this literal ? untouched */
     WHERE id = ?`,
    [`1`],
  )

  expect(capturedSql).toContain(`/* keep this literal ? untouched */`)
  expect(capturedSql).toContain(`WHERE id = $1`)
})

it(`keeps escaped single-quote literals unchanged while converting bindings`, async () => {
  let capturedSql = ``
  const driver = new TauriSQLiteDriver({
    database: {
      path: `sqlite:test.db`,
      execute: async (sql) => {
        capturedSql = sql
        return { rowsAffected: 0 }
      },
      select: async <TRow>() => [] as unknown as TRow,
      close: async () => true,
    },
  })

  await driver.run(
    `INSERT INTO prompts (id, title, notes)
     VALUES (?, 'it''s still a literal ?', ?)`,
    [`1`, `note`],
  )

  expect(capturedSql).toContain(`VALUES ($1, 'it''s still a literal ?', $2)`)
})

it(`closes the underlying database when close is available`, async () => {
  let closeCount = 0
  const driver = new TauriSQLiteDriver({
    database: {
      path: `sqlite:test.db`,
      execute: async () => ({ rowsAffected: 0 }),
      select: async <TRow>() => [] as unknown as TRow,
      close: async () => {
        closeCount++
        return true
      },
    },
  })

  await driver.close()

  expect(closeCount).toBe(1)
})

it(`throws config error when execute/select methods are missing`, () => {
  expect(() => new TauriSQLiteDriver({ database: {} as never })).toThrowError(
    InvalidPersistedCollectionConfigError,
  )
})
