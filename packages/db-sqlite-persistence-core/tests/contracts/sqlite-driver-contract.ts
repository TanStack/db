import { describe, expect, it } from 'vitest'
import { expectAdmissionHistory } from './driver-admission-laws'
import type { SQLiteDriver } from '../../src'

export type SQLiteDriverContractHarness = {
  driver: SQLiteDriver
  cleanup: () => void | Promise<void>
}

export type SQLiteDriverContractHarnessFactory =
  () => SQLiteDriverContractHarness

async function withHarness<T>(
  createHarness: SQLiteDriverContractHarnessFactory,
  fn: (harness: SQLiteDriverContractHarness) => Promise<T>,
): Promise<T> {
  const harness = createHarness()
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await fn(harness) }
  } catch (error) {
    outcome = { ok: false, error }
  }

  let cleanupOutcome: { ok: true } | { ok: false; error: unknown } = {
    ok: true,
  }
  try {
    await Promise.resolve(harness.cleanup())
  } catch (error) {
    cleanupOutcome = { ok: false, error }
  }

  if (!outcome.ok) {
    if (!cleanupOutcome.ok) {
      throw new AggregateError(
        [outcome.error, cleanupOutcome.error],
        `SQLite driver contract and cleanup failed`,
        { cause: outcome.error },
      )
    }
    throw outcome.error
  }
  if (!cleanupOutcome.ok) {
    throw cleanupOutcome.error
  }
  return outcome.value
}

export function runSQLiteDriverContractSuite(
  suiteName: string,
  createHarness: SQLiteDriverContractHarnessFactory,
): void {
  describe(suiteName, () => {
    it(`executes run/query with parameter binding`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(
          `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, score INTEGER NOT NULL)`,
        )
        await driver.run(
          `INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`,
          [`1`, `First`, 10],
        )
        await driver.run(
          `INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`,
          [`2`, `Second`, 20],
        )

        const rows = await driver.query<{ id: string; title: string }>(
          `SELECT id, title
           FROM todos
           WHERE score >= ?
           ORDER BY score ASC`,
          [10],
        )
        expect(rows).toEqual([
          { id: `1`, title: `First` },
          { id: `2`, title: `Second` },
        ])
      })
    })

    it(`preserves exact query rows after exec and run write results`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(
          `CREATE TABLE write_then_read (
             id TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             score INTEGER NOT NULL
           )`,
        )
        await driver.run(
          `INSERT INTO write_then_read (id, title, score) VALUES (?, ?, ?)`,
          [`run-row`, `Inserted by run`, 17],
        )
        await driver.exec(
          `INSERT INTO write_then_read (id, title, score)
           VALUES ('exec-row', 'Inserted by exec', 29)`,
        )

        expect(
          await driver.query<{ id: string; title: string; score: number }>(
            `SELECT title, id, score
             FROM write_then_read
             ORDER BY score DESC`,
          ),
        ).toEqual([
          { title: `Inserted by exec`, id: `exec-row`, score: 29 },
          { title: `Inserted by run`, id: `run-row`, score: 17 },
        ])
      })
    })

    it(`preserves SQL aliases that match statement-result field names`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        const rows = await driver.query<{
          rows: string
          resultRows: string
          rawRows: string
          columnNames: string
          results: string
          rowsAffected: number
          changes: number
          insertId: number
          lastInsertRowId: number
        }>(
          `SELECT
             'rows-value' AS "rows",
             'resultRows-value' AS "resultRows",
             'rawRows-value' AS "rawRows",
             'columnNames-value' AS "columnNames",
             'results-value' AS "results",
             7 AS "rowsAffected",
             8 AS "changes",
             9 AS "insertId",
             10 AS "lastInsertRowId"`,
        )

        expect(rows).toEqual([
          {
            rows: `rows-value`,
            resultRows: `resultRows-value`,
            rawRows: `rawRows-value`,
            columnNames: `columnNames-value`,
            results: `results-value`,
            rowsAffected: 7,
            changes: 8,
            insertId: 9,
            lastInsertRowId: 10,
          },
        ])
        expect(Object.keys(rows[0] ?? {})).toEqual([
          `rows`,
          `resultRows`,
          `rawRows`,
          `columnNames`,
          `results`,
          `rowsAffected`,
          `changes`,
          `insertId`,
          `lastInsertRowId`,
        ])
      })
    })

    it(`rolls back transaction when callback throws`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(
          `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
        )

        await expect(
          driver.transaction(async (transactionDriver) => {
            await transactionDriver.run(
              `INSERT INTO todos (id, title) VALUES (?, ?)`,
              [`1`, `Should rollback`],
            )
            throw new Error(`boom`)
          }),
        ).rejects.toThrow(`boom`)

        const countRows = await driver.query<{ count: number }>(
          `SELECT COUNT(*) AS count FROM todos`,
        )
        expect(countRows[0]?.count).toBe(0)
      })
    })

    it(`serializes operations while a transaction is in progress`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(`CREATE TABLE events (value INTEGER NOT NULL)`)

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
            `INSERT INTO events (value) VALUES (?)`,
            [1],
          )
          await hold
          await transactionDriver.run(
            `INSERT INTO events (value) VALUES (?)`,
            [2],
          )
        })
        const observed = [Promise.allSettled([txPromise])]
        try {
          await entered

          let outsideResolved = false
          const outsidePromise = driver
            .run(`INSERT INTO events (value) VALUES (?)`, [3])
            .then(() => {
              outsideResolved = true
            })
          observed.push(Promise.allSettled([outsidePromise]))

          await Promise.resolve()
          expect(outsideResolved).toBe(false)

          if (!resolveHold) {
            throw new Error(`transaction hold signal missing`)
          }
          resolveHold()
          await Promise.all([txPromise, outsidePromise])
        } finally {
          resolveHold?.()
          await Promise.all(observed)
        }

        const rows = await driver.query<{ value: number }>(
          `SELECT value
           FROM events
           ORDER BY value ASC`,
        )
        expect(rows.map((row) => row.value)).toEqual([1, 2, 3])
        // Sorting by value masks an outside write admitted between 1 and 2.
        expectAdmissionHistory(
          await driver.query<{ value: number }>(
            `SELECT value FROM events ORDER BY rowid ASC`,
          ),
          [1, 2, 3],
        )
      })
    })

    it(`admits an outside write after a held transaction rolls back`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(`CREATE TABLE events (value INTEGER NOT NULL)`)
        let releaseHold!: () => void
        const hold = new Promise<void>((resolve) => {
          releaseHold = resolve
        })
        let signalEntered!: () => void
        const entered = new Promise<void>((resolve) => {
          signalEntered = resolve
        })
        const failure = new Error(`held transaction rollback`)
        const transaction = driver.transaction(async (transactionDriver) => {
          await transactionDriver.run(
            `INSERT INTO events (value) VALUES (?)`,
            [1],
          )
          signalEntered()
          await hold
          throw failure
        })
        const outcome = Promise.allSettled([transaction])
        let outside: Promise<unknown> | undefined
        try {
          await entered
          outside = driver.run(`INSERT INTO events (value) VALUES (?)`, [3])
          // Observe rejection before any assertion or gate release.
          const outsideOutcome = Promise.allSettled([outside])
          releaseHold()
          const result = (await outcome)[0]
          expect(result.status).toBe(`rejected`)
          if (result.status === `rejected`) expect(result.reason).toBe(failure)
          await outside
          await outsideOutcome
          expectAdmissionHistory(
            await driver.query<{ value: number }>(
              `SELECT value FROM events ORDER BY rowid ASC`,
            ),
            [3],
          )
        } finally {
          releaseHold()
          await Promise.allSettled([transaction, outside])
        }
      })
    })

    it(`uses savepoints for nested transactions`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await driver.exec(`CREATE TABLE nested_events (value INTEGER NOT NULL)`)

        await driver.transaction(async (outerTransactionDriver) => {
          await outerTransactionDriver.run(
            `INSERT INTO nested_events (value) VALUES (?)`,
            [1],
          )

          await expect(
            outerTransactionDriver.transaction(
              async (innerTransactionDriver) => {
                await innerTransactionDriver.run(
                  `INSERT INTO nested_events (value) VALUES (?)`,
                  [2],
                )
                throw new Error(`inner failure`)
              },
            ),
          ).rejects.toThrow(`inner failure`)

          await outerTransactionDriver.run(
            `INSERT INTO nested_events (value) VALUES (?)`,
            [3],
          )
        })

        const rows = await driver.query<{ value: number }>(
          `SELECT value
           FROM nested_events
           ORDER BY value ASC`,
        )
        expect(rows.map((row) => row.value)).toEqual([1, 3])
      })
    })

    it(`requires transaction callbacks to accept a driver argument`, async () => {
      await withHarness(createHarness, async ({ driver }) => {
        await expect(
          driver.transaction((() => Promise.resolve()) as unknown as (
            transactionDriver: SQLiteDriver,
          ) => Promise<void>),
        ).rejects.toThrow(`transaction driver argument`)
      })
    })
  })
}
