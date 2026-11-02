// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'

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
