/** Actual Chromium, fresh SDKs and closed/reopened worker/OPFS connections. */
import {
  observeDirectPersistedDemand,
  retainDirectDemandCleanup,
} from '../../powersync-direct-collection/tests/persisted-demand-driver'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type { DirectDemandHistory } from '../../powersync-direct-collection/tests/persisted-demand-history-oracle'

let sequence = 0
async function runDirectPersistedDemand(
  history: DirectDemandHistory,
  id: string,
) {
  const databaseName = `ps-direct-demand-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  return retainDirectDemandCleanup(
    () =>
      observeDirectPersistedDemand(history, id, async () => {
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
    runDirectPersistedDemand: typeof runDirectPersistedDemand
  }
}
window.runDirectPersistedDemand = runDirectPersistedDemand
