import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { InvalidPersistedCollectionConfigError } from '../../db-sqlite-persisted-collection-core/src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'

const activeCleanupFns: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    await Promise.resolve(cleanupFn?.())
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

it.each([`rows-array`, `rows-object`, `rows-list`, `statement-array`] as const)(
  `reads query rows across result shape: %s`,
  async (resultShape) => {
    const dbPath = createTempSqlitePath()
    const database = createOpSQLiteTestDatabase({
      filename: dbPath,
      resultShape,
    })
    activeCleanupFns.push(() => Promise.resolve(database.close()))

    const driver = new OpSQLiteDriver({ database })
    await driver.exec(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, score INTEGER NOT NULL)`,
    )
    await driver.run(`INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`, [
      `1`,
      `From test`,
      7,
    ])

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
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await expect(
    driver.transactionWithDriver(async (transactionDriver) => {
      await transactionDriver.run(
        `INSERT INTO tx_test (id, title) VALUES (?, ?)`,
        [`1`, `First`],
      )
      await transactionDriver.run(
        `INSERT INTO tx_test (missing_column) VALUES (?)`,
        [`x`],
      )
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
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE nested_tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await driver.transactionWithDriver(async (outerTransactionDriver) => {
    await outerTransactionDriver.run(
      `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
      [`1`, `Outer before`],
    )

    await expect(
      outerTransactionDriver.transaction(async (innerTransactionDriver) => {
        await innerTransactionDriver.run(
          `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
          [`2`, `Inner failing`],
        )
        throw new Error(`nested-failure`)
      }),
    ).rejects.toThrow(`nested-failure`)

    await outerTransactionDriver.run(
      `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
      [`3`, `Outer after`],
    )
  })

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM nested_tx_test ORDER BY id ASC`,
  )
  expect(rows).toEqual([
    { id: `1`, title: `Outer before` },
    { id: `3`, title: `Outer after` },
  ])
})

it(`supports transaction callbacks that use provided transaction driver`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(`CREATE TABLE closure_tx_test (value INTEGER NOT NULL)`)

  let resolveHold: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    resolveHold = resolve
  })
  let resolveEntered: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    resolveEntered = resolve
  })

  const txPromise = driver.transaction(async (transactionDriver) => {
    if (!resolveEntered) {
      throw new Error(`transaction entry signal missing`)
    }
    resolveEntered()
    await transactionDriver.run(
      `INSERT INTO closure_tx_test (value) VALUES (?)`,
      [1],
    )
    await hold
    await transactionDriver.run(
      `INSERT INTO closure_tx_test (value) VALUES (?)`,
      [2],
    )
  })

  await entered

  let outsideResolved = false
  const outsidePromise = driver
    .run(`INSERT INTO closure_tx_test (value) VALUES (?)`, [3])
    .then(() => {
      outsideResolved = true
    })

  await Promise.resolve()
  expect(outsideResolved).toBe(false)

  if (!resolveHold) {
    throw new Error(`transaction hold signal missing`)
  }
  resolveHold()

  await Promise.all([txPromise, outsidePromise])

  const rows = await driver.query<{ value: number }>(
    `SELECT value FROM closure_tx_test ORDER BY value ASC`,
  )
  expect(rows.map((row) => row.value)).toEqual([1, 2, 3])
})

it(`throws when transaction callback omits transaction driver argument`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })

  await expect(
    driver.transaction((async () => undefined) as never),
  ).rejects.toThrow(`transaction driver argument`)
})

it(`serializes unrelated operations behind an active transaction`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE tx_scope_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  let resolveOuterTransaction: (() => void) | undefined
  const outerTransactionGate = new Promise<void>((resolve) => {
    resolveOuterTransaction = resolve
  })

  let signalOuterInsertComplete: (() => void) | undefined
  const outerInsertComplete = new Promise<void>((resolve) => {
    signalOuterInsertComplete = resolve
  })

  const outerTransaction = driver.transactionWithDriver(
    async (transactionDriver) => {
      await transactionDriver.run(
        `INSERT INTO tx_scope_test (id, title) VALUES (?, ?)`,
        [`outer`, `Inside transaction`],
      )
      signalOuterInsertComplete?.()
      await outerTransactionGate
      throw new Error(`rollback-outer-transaction`)
    },
  )

  await outerInsertComplete

  let unrelatedWriteCompleted = false
  const unrelatedWrite = driver
    .run(`INSERT INTO tx_scope_test (id, title) VALUES (?, ?)`, [
      `outside`,
      `Outside transaction`,
    ])
    .then(() => {
      unrelatedWriteCompleted = true
    })
  await Promise.resolve()
  expect(unrelatedWriteCompleted).toBe(false)

  resolveOuterTransaction?.()

  await expect(outerTransaction).rejects.toThrow(`rollback-outer-transaction`)
  await unrelatedWrite

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM tx_scope_test ORDER BY id ASC`,
  )
  expect(rows).toEqual([{ id: `outside`, title: `Outside transaction` }])
})

it(`throws config error when db execute methods are missing`, () => {
  expect(() => new OpSQLiteDriver({ database: {} as never })).toThrowError(
    InvalidPersistedCollectionConfigError,
  )
})
