import { expect, it } from 'vitest'
import type { SQLiteDriver } from '../src'

/** Reusable fixture checks. The factory owns its database and resource cleanup.
 * These supplement product oracles: their expected values describe SQL scope,
 * rollback and admission, not metadata policy.
 */
export function registerSQLiteFixtureConformance(
  createFixture: () => Promise<{
    driver: SQLiteDriver
    cleanup: () => Promise<void>
  }>,
) {
  it(`queues a detached caller after its original transaction has ended`, async () => {
    const { driver, cleanup } = await createFixture()
    let releaseLate!: () => void
    const lateGate = new Promise<void>((resolve) => {
      releaseLate = resolve
    })
    let submitted!: () => void
    const lateSubmitted = new Promise<void>((resolve) => {
      submitted = resolve
    })
    let late: Promise<unknown> | undefined
    let releaseCurrent!: () => void
    const currentGate = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    let entered!: () => void
    const currentEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    try {
      await driver.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY)`)
      await driver.transaction(async (scoped) => {
        await scoped.run(`INSERT INTO rows VALUES (1)`)
        // This callback inherits the first transaction's async context, but
        // invokes root SQL only after that transaction has completed.
        late = lateGate.then(() => {
          const read = driver.query(`SELECT id FROM rows ORDER BY id`)
          const write = driver.run(`INSERT INTO rows VALUES (3)`)
          submitted()
          return Promise.all([read, write])
        })
      })
      const current = driver.transaction(async (scoped) => {
        await scoped.run(`INSERT INTO rows VALUES (2)`)
        entered()
        await currentGate
        throw new Error(`rollback current scope`)
      })
      const rejected = expect(current).rejects.toThrow(`rollback current scope`)
      await currentEntered
      releaseLate()
      await lateSubmitted
      releaseCurrent()
      await rejected
      expect(await late).toEqual([[{ id: 1 }], undefined])
      expect(await driver.query(`SELECT id FROM rows ORDER BY id`)).toEqual([
        { id: 1 },
        { id: 3 },
      ])
    } finally {
      releaseLate()
      releaseCurrent()
      await late?.catch(() => undefined)
      await cleanup()
    }
  })
  it.each([false, true])(
    `rolls back only a failed nested scope (root reentry: %s)`,
    async (rootReentry) => {
      const { driver, cleanup } = await createFixture()
      try {
        await driver.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY)`)
        await driver.transaction(async (scoped) => {
          await scoped.run(`INSERT INTO rows VALUES (1)`)
          const nested = rootReentry ? driver : scoped
          await expect(
            nested.transaction(async (inner) => {
              await inner.run(`INSERT INTO rows VALUES (2)`)
              throw new Error(`rollback the inner scope`)
            }),
          ).rejects.toThrow(`rollback the inner scope`)
          await nested.transaction(async (inner) => {
            await inner.run(`INSERT INTO rows VALUES (3)`)
          })
          // Root calls in this async transaction must use its scope, rather than
          // queue behind the callback that is awaiting them.
          await (rootReentry ? driver : scoped).run(
            `INSERT INTO rows VALUES (4)`,
          )
        })
        expect(await driver.query(`SELECT id FROM rows ORDER BY id`)).toEqual([
          { id: 1 },
          { id: 3 },
          { id: 4 },
        ])
      } finally {
        await cleanup()
      }
    },
  )

  it(`keeps another adapter's root reads and writes outside a rolled-back transaction`, async () => {
    const { driver, cleanup } = await createFixture()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await driver.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY)`)
      const failed = driver.transaction(async (scoped) => {
        await scoped.run(`INSERT INTO rows VALUES (1)`)
        entered()
        await gate
        throw new Error(`rollback this transaction only`)
      })
      const rejected = expect(failed).rejects.toThrow(
        `rollback this transaction only`,
      )
      await started
      const read = driver.query(`SELECT id FROM rows ORDER BY id`)
      const write = driver.run(`INSERT INTO rows VALUES (2)`)
      release()
      await rejected
      expect(await read).toEqual([])
      await write
      expect(await driver.query(`SELECT id FROM rows ORDER BY id`)).toEqual([
        { id: 2 },
      ])
    } finally {
      release()
      await cleanup()
    }
  })

  it(`rolls back a successful nested scope when the outer scope fails`, async () => {
    const { driver, cleanup } = await createFixture()
    const error = new Error(`outer rollback`)
    try {
      await driver.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY)`)
      await expect(
        driver.transaction(async (outer) => {
          await outer.run(`INSERT INTO rows VALUES (1)`)
          await outer.transaction(async (inner) => {
            await inner.run(`INSERT INTO rows VALUES (2)`)
            await inner.transaction(async (deepest) => {
              await deepest.run(`INSERT INTO rows VALUES (3)`)
            })
          })
          throw error
        }),
      ).rejects.toBe(error)
      expect(await driver.query(`SELECT id FROM rows`)).toEqual([])
      await driver.run(`INSERT INTO rows VALUES (4)`)
      expect(await driver.query(`SELECT id FROM rows`)).toEqual([{ id: 4 }])
    } finally {
      await cleanup()
    }
  })
}
