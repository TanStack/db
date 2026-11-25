/** Actual Chromium SDK/worker/OPFS receiving path for the shared acceptance law. */
import { observePersistedAcceptance } from '../../convex-db-collection/tests/lazy-persisted-acceptance-driver'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type { DeferredBaselineHistory } from '../../convex-db-collection/tests/lazy-deferred-baseline-oracle'

let sequence = 0
async function runAdapterPersistedAcceptance(
  history: DeferredBaselineHistory,
  id: string,
) {
  const databaseName = `adapter-demand-acceptance-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  return retainOracleCleanupObservation(
    () =>
      observePersistedAcceptance(history, id, async () => {
        const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
        return {
          persistence: createBrowserWASQLitePersistence({ database }),
          close: () => database.close?.(),
        }
      }),
    [() => removeStartupOPFSArtifacts(databaseName)],
  )
}
declare global {
  interface Window {
    runAdapterPersistedAcceptance: typeof runAdapterPersistedAcceptance
  }
}
window.runAdapterPersistedAcceptance = runAdapterPersistedAcceptance
