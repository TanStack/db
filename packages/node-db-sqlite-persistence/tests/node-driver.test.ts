import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })

  return {
    driver,
    cleanup: () => {
      try {
        driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`better-sqlite3 node driver`, createDriverHarness)

type SharedDatabaseHarness = {
  firstDriver: BetterSqlite3SQLiteDriver
  secondDriver: BetterSqlite3SQLiteDriver
}

async function withSharedDatabaseHandle<T>(
  fn: (harness: SharedDatabaseHarness) => Promise<T>,
): Promise<T> {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-shared-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = new BetterSqlite3(dbPath)

  try {
    return await fn({
      firstDriver: new BetterSqlite3SQLiteDriver({ database }),
      secondDriver: new BetterSqlite3SQLiteDriver({ database }),
    })
  } finally {
    database.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

/**
 * The shared contract owns one driver wrapper. This provider-specific law also
 * covers the supported case where several persistence instances wrap one
 * better-sqlite3 database handle.
 *
 * Known omission: distinct better-sqlite3 connection objects rely on SQLite's
 * own lock admission and are not modeled as one in-process scheduling queue.
 */
describe(`better-sqlite3 shared database handle`, () => {
  it(`serializes transactions across driver wrappers`, async () => {
    await withSharedDatabaseHandle(async ({ firstDriver, secondDriver }) => {
      await firstDriver.exec(`CREATE TABLE events (value INTEGER NOT NULL)`)

      let releaseHold!: () => void
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve
      })
      let signalEntered!: () => void
      const entered = new Promise<void>((resolve) => {
        signalEntered = resolve
      })
      const firstTransaction = firstDriver.transaction(
        async (transactionDriver) => {
          await transactionDriver.run(
            `INSERT INTO events (value) VALUES (?)`,
            [1],
          )
          signalEntered()
          await hold
          await transactionDriver.run(
            `INSERT INTO events (value) VALUES (?)`,
            [2],
          )
        },
      )

      await entered
      let secondSettled = false
      const secondTransaction = secondDriver
        .transaction(async (transactionDriver) => {
          await transactionDriver.run(
            `INSERT INTO events (value) VALUES (?)`,
            [3],
          )
        })
        .then(() => {
          secondSettled = true
        })
      const observed = Promise.allSettled([firstTransaction, secondTransaction])

      try {
        await Promise.resolve()
        expect(secondSettled).toBe(false)
        releaseHold()
        await Promise.all([firstTransaction, secondTransaction])
      } finally {
        releaseHold()
        await observed
      }

      const rows = await firstDriver.query<{ value: number }>(
        `SELECT value FROM events ORDER BY rowid ASC`,
      )
      expect(rows.map((row) => row.value)).toEqual([1, 2, 3])
    })
  })

  it(`uses savepoints for transactions nested through another wrapper`, async () => {
    await withSharedDatabaseHandle(async ({ firstDriver, secondDriver }) => {
      await firstDriver.exec(`CREATE TABLE events (value INTEGER NOT NULL)`)

      await firstDriver.transaction(async (outerTransactionDriver) => {
        await outerTransactionDriver.run(
          `INSERT INTO events (value) VALUES (?)`,
          [1],
        )

        await expect(
          secondDriver.transaction(async (innerTransactionDriver) => {
            await innerTransactionDriver.run(
              `INSERT INTO events (value) VALUES (?)`,
              [2],
            )
            throw new Error(`inner failure`)
          }),
        ).rejects.toThrow(`inner failure`)

        await outerTransactionDriver.run(
          `INSERT INTO events (value) VALUES (?)`,
          [3],
        )
      })

      const rows = await firstDriver.query<{ value: number }>(
        `SELECT value FROM events ORDER BY rowid ASC`,
      )
      expect(rows.map((row) => row.value)).toEqual([1, 3])
    })
  })
})
