/** Real worker/OPFS storage closes and reopens for every cursor sync run. */
import {
  observeCursorPersistedDemand,
  retainCursorDemandCleanup,
} from '../../powersync-direct-db-collection/tests/cursor-persisted-demand-driver'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type { CursorDemandHistory } from '../../powersync-direct-db-collection/tests/cursor-persisted-demand-history-oracle'

let sequence = 0
async function runDirectCursorDemand(history: CursorDemandHistory, id: string) {
  const databaseName = `ps-direct-cursor-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  return retainCursorDemandCleanup(
    () =>
      observeCursorPersistedDemand(history, id, async () => {
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
    runDirectCursorDemand: typeof runDirectCursorDemand
  }
}
window.runDirectCursorDemand = runDirectCursorDemand
