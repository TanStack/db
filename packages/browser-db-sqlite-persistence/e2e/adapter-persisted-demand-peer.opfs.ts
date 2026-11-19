/** The peer recorder runs in real Chromium over closed/reopened worker/OPFS. */
import { convexPersistedDemandSource } from '../../convex-db-collection/tests/persisted-demand-source'
import { observePersistedDemandPeer } from '../../db-adapter-conformance/tests/persisted-demand-peer-driver'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type { DemandPeerHistory } from '../../db-adapter-conformance/tests/persisted-demand-peer-driver'

let sequence = 0
async function runAdapterPersistedDemandPeer(
  history: DemandPeerHistory,
  id: string,
) {
  const databaseName = `adapter-demand-peer-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  return retainOracleCleanupObservation(
    () =>
      observePersistedDemandPeer(
        history,
        id,
        convexPersistedDemandSource,
        async () => {
          const database = await openBrowserWASQLiteOPFSDatabase({
            databaseName,
          })
          return {
            persistence: createBrowserWASQLitePersistence({ database }),
            close: () => database.close?.(),
          }
        },
      ),
    [() => removeStartupOPFSArtifacts(databaseName)],
  )
}
declare global {
  interface Window {
    runAdapterPersistedDemandPeer: typeof runAdapterPersistedDemandPeer
  }
}
window.runAdapterPersistedDemandPeer = runAdapterPersistedDemandPeer
