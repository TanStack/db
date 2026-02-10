import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  InvalidPersistedCollectionConfigError,
  createOpSQLiteDriver,
} from '../src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'

const activeCleanupFns: Array<() => void> = []

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    cleanupFn?.()
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-op-sqlite-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

it.each([
  `rows-array`,
  `rows-object`,
  `rows-list`,
  `statement-array`,
] as const)(
  `reads query rows across result shape: %s`,
  async (resultShape) => {
    const dbPath = createTempSqlitePath()
    const database = createOpSQLiteTestDatabase({
      filename: dbPath,
      resultShape,
    })
    activeCleanupFns.push(() => {
      database.close()
    })

    const driver = createOpSQLiteDriver({ database })
    await driver.exec(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, score INTEGER NOT NULL)`,
    )
    await driver.run(
      `INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`,
      [`1`, `From test`, 7],
    )

    const rows = await driver.query<{
      id: string
      title: string
      score: number
    }>(`SELECT id, title, score FROM todos ORDER BY id ASC`)
    expect(rows).toEqual([
      {
        id: `1`,
        title: `From test`,
        score: 7,
      },
    ])
  },
)

it(`rolls back transaction on failure`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => {
    database.close()
  })

  const driver = createOpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await expect(
    driver.transaction(async () => {
      await driver.run(`INSERT INTO tx_test (id, title) VALUES (?, ?)`, [
        `1`,
        `First`,
      ])
      await driver.run(`INSERT INTO tx_test (missing_column) VALUES (?)`, [`x`])
    }),
  ).rejects.toThrow()

  const rows = await driver.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM tx_test`,
  )
  expect(rows[0]?.count).toBe(0)
})

it(`supports nested savepoint rollback without losing outer transaction`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => {
    database.close()
  })

  const driver = createOpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE nested_tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await driver.transaction(async () => {
    await driver.run(`INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`, [
      `1`,
      `Outer before`,
    ])

    await expect(
      driver.transaction(async () => {
        await driver.run(
          `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
          [`2`, `Inner failing`],
        )
        throw new Error(`nested-failure`)
      }),
    ).rejects.toThrow(`nested-failure`)

    await driver.run(`INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`, [
      `3`,
      `Outer after`,
    ])
  })

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM nested_tx_test ORDER BY id ASC`,
  )
  expect(rows).toEqual([
    { id: `1`, title: `Outer before` },
    { id: `3`, title: `Outer after` },
  ])
})

it(`throws config error when db execute methods are missing`, () => {
  expect(() =>
    createOpSQLiteDriver({ database: {} as never }),
  ).toThrowError(InvalidPersistedCollectionConfigError)
})
