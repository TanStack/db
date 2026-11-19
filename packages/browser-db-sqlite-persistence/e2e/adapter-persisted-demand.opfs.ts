/** Same histories and recorder in actual Chromium over closed/reopened OPFS. */
import { createQueryPersistedDemandSource } from '../../query-db-collection/tests/persisted-demand-source'
import { createElectricPersistedDemandSource } from '../../electric-db-collection/tests/persisted-demand-source'
import { nativePowerSyncPersistedDemandSource } from '../../powersync-db-collection/tests/persisted-demand-source'
import { openBrowserReceivingDatabase } from '../../powersync-db-collection/tests/native-receiving-browser'
import { trailBasePersistedDemandSource } from '../../trailbase-db-collection/tests/persisted-demand-source'
import { convexPersistedDemandSource } from '../../convex-db-collection/tests/persisted-demand-source'
import { observePersistedDemandReceiving } from '../../db-adapter-conformance/tests/persisted-demand-receiving-driver'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type { DemandReceivingHistory } from '../../db-adapter-conformance/tests/persisted-demand-receiving-driver'

const factories = {
  query: createQueryPersistedDemandSource,
  electric: createElectricPersistedDemandSource,
  powersync: nativePowerSyncPersistedDemandSource(openBrowserReceivingDatabase),
  trailbase: trailBasePersistedDemandSource,
  convex: convexPersistedDemandSource,
}
export type DemandAdapterName = keyof typeof factories
let sequence = 0
async function runAdapterPersistedDemand(
  name: DemandAdapterName,
  history: DemandReceivingHistory,
  id: string,
) {
  const databaseName = `adapter-demand-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  return retainOracleCleanupObservation(
    () =>
      observePersistedDemandReceiving(
        history,
        id,
        factories[name],
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
    runAdapterPersistedDemand: typeof runAdapterPersistedDemand
  }
}
window.runAdapterPersistedDemand = runAdapterPersistedDemand
