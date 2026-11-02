// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe } from 'vitest'
import { registerSQLiteFixtureConformance } from './sqlite-fixture-conformance'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'

describe.each([`transaction`, `transactionWithDriver`] as const)(
  `SQLite fixture admission through %s`,
  (entry) => {
    registerSQLiteFixtureConformance(() => {
      const database = new DatabaseSync(`:memory:`)
      const { driver, drained } = createMetadataSQLiteDriver(database)
      if (entry === `transactionWithDriver`)
        driver.transaction = driver.transactionWithDriver!
      return Promise.resolve({
        driver,
        cleanup: async () => {
          await drained()
          database.close()
        },
      })
    })
  },
)
