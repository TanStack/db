import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapacitorSQLiteTestDatabase } from '../tests/helpers/capacitor-sqlite-test-db'
import { createCapacitorPersistedCollectionHarnessConfig } from './shared/capacitor-persisted-collection-harness'
import { registerPersistedCollectionConformanceSuite } from './shared/register-persisted-collection-conformance-suite'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'

type CapacitorPersistenceFactory = <T extends { id: string }>(
  database: ReturnType<typeof createCapacitorSQLiteTestDatabase>,
) => PersistedCollectionPersistence<T, string | number>

export function runCapacitorPersistedCollectionConformanceSuite(
  suiteName: string,
  createPersistence: CapacitorPersistenceFactory,
): void {
  registerPersistedCollectionConformanceSuite({
    suiteName,
    createHarness: async () => {
      const tempDirectory = mkdtempSync(
        join(tmpdir(), `db-capacitor-persisted-conformance-`),
      )
      const dbPath = join(tempDirectory, `state.sqlite`)
      const suiteId = Date.now().toString(36)
      const database = createCapacitorSQLiteTestDatabase({
        filename: dbPath,
      })

      const harness = await createCapacitorPersistedCollectionHarnessConfig({
        database,
        createPersistence,
        suiteId,
        cleanup: () => {
          rmSync(tempDirectory, { recursive: true, force: true })
          return Promise.resolve()
        },
      })
      return harness
    },
  })
}
