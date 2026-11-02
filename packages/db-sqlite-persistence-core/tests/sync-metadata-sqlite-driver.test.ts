// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'

it.each([false, true])(
  `rolls back only a failed nested scope (root reentry: %s)`,
  async (rootReentry) => {
    const database = new DatabaseSync(`:memory:`)
    const { driver, drained } = createMetadataSQLiteDriver(database)
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
        await (rootReentry ? driver : scoped).run(`INSERT INTO rows VALUES (4)`)
      })
      expect(await driver.query(`SELECT id FROM rows ORDER BY id`)).toEqual([
        { id: 1 },
        { id: 3 },
        { id: 4 },
      ])
    } finally {
      await drained()
      database.close()
    }
  },
)

it(`keeps another adapter's root reads and writes outside a rolled-back transaction`, async () => {
  const database = new DatabaseSync(`:memory:`)
  const { driver, drained } = createMetadataSQLiteDriver(database)
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
    await drained()
    database.close()
  }
})
