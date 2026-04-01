import { createTauriSQLitePersistence } from '../../../src'
import { createTauriPersistedCollectionHarnessConfig } from '../../shared/tauri-persisted-collection-harness'
import { registerPersistedCollectionConformanceSuite } from '../../shared/register-persisted-collection-conformance-suite'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'
import type { TauriSQLiteDatabaseLike } from '../../../src'


export function registerTauriNativeE2ESuite(options: {
  suiteName: string
  database: TauriSQLiteDatabaseLike
  runId: string
}): void {
  registerPersistedCollectionConformanceSuite({
    suiteName: options.suiteName,
    createHarness: () =>
      createTauriPersistedCollectionHarnessConfig({
        database: options.database,
        suiteId: options.runId,
        createPersistence: (
          database: TauriSQLiteDatabaseLike,
        ): PersistedCollectionPersistence =>
          createTauriSQLitePersistence({
            database,
          }),
      }),
  })
}
