import { createCapacitorSQLitePersistence } from '../../../src'
import { createCapacitorPersistedCollectionHarnessConfig } from '../../shared/capacitor-persisted-collection-harness'
import { registerPersistedCollectionConformanceSuite } from '../../shared/register-persisted-collection-conformance-suite'
import type { NativeCapacitorSQLiteTestDatabase } from './native-capacitor-sqlite-test-db'

export function registerCapacitorNativeE2ESuite(options: {
  suiteName: string
  createDatabase: (databaseOptions: { filename: string }) => NativeCapacitorSQLiteTestDatabase
}): void {
  const { suiteName, createDatabase } = options
  registerPersistedCollectionConformanceSuite({
    suiteName,
    createHarness: async () => {
      const suiteId = Date.now().toString(36)
      const database = createDatabase({
        filename: `capacitor-native-e2e-${suiteId}.sqlite`,
      })

      return createCapacitorPersistedCollectionHarnessConfig({
        database,
        createPersistence: (persistedDatabase) =>
          createCapacitorSQLitePersistence({
            database: persistedDatabase,
          }),
        suiteId,
      })
    },
  })
}
