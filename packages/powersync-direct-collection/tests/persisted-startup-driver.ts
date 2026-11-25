/**
 * The real standalone SDK receives the shared persisted-startup law. Controlled
 * NDJSON supplies a complete table checkpoint; persistence supplies the saved
 * baseline. Public source receipts and readiness determine the first-result
 * cut, before refresh can conceal a lost or stale durable result.
 *
 * This production driver is shared by controlled storage, Node SQLite and
 * Chromium worker/OPFS. It supplies no expected rows and has no test-runner or
 * Node imports. The shared owner retains the model, histories and comparison.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  startupInitialRender,
  trackStartupSync,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { directEagerClient } from './eager-reload-driver'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const directPowerSyncStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    create(persistence, history, id, metadataTransform) {
      const source = directEagerClient()
      const options = source.options(id)
      const startup = trackStartupSync(options.sync, metadataTransform)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(history),
          persistence,
        }),
      )
      let available = false
      const rows = startupRows(history.next, 2)
      const deliver = async () => {
        await source.service.rows(rows)
        await source.propagate()
        available = true
      }
      return {
        collection,
        initialResult: startup.initialResult,
        firstSubmission: startup.firstSubmission,
        waitForRestore: startup.waitForRestore,
        sourceTransactions: startup.sourceTransactions,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable: () => available,
        refresh: async () => {
          source.service.stageRows(rows)
          await collection.reload()
        },
        dispose: () =>
          withOracleCleanup(() => collection.cleanup(), [source.dispose]),
      }
    },
  }
