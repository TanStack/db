/** Real Chromium worker/OPFS supplies the persisted receipt boundary. */
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../../browser-db-sqlite-persistence/src'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { removeStartupOPFSArtifacts } from '../../browser-db-sqlite-persistence/e2e/persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from '../../browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-cleanup'
import {
  describeOracleCleanupError,
  retainOracleCleanupObservation,
} from '../../db/tests/oracle-cleanup'
import { observeRxdbPersistedInitialReceipt } from './persisted-initial-receipt-driver'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

let sequence = 0
async function runRxdbPersistedInitialReceipt(
  history: InitialReceiptHistory,
  id: string,
  injectDetachedRejection = false,
) {
  const databaseName = `rxdb-persisted-receipt-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const detachedErrors: Array<string> = []
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    detachedErrors.push(describeOracleCleanupError(event.reason))
    event.preventDefault()
  }
  window.addEventListener(`unhandledrejection`, onUnhandledRejection)
  const observed = await retainOracleCleanupObservation(
    () =>
      observeRxdbPersistedInitialReceipt(
        history,
        createBrowserWASQLitePersistence({ database }),
        inProcessSeams.holdFirstRowSnapshot,
        id,
        detachedErrors,
        injectDetachedRejection,
      ),
    [
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`rxdb.receipt.opfs ${cut}`, value),
        ),
      async () => {
        for (let turn = 0; turn < 8; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      },
      () =>
        window.removeEventListener(`unhandledrejection`, onUnhandledRejection),
    ],
  )
  return { ...observed, detachedErrors: [...detachedErrors] }
}

declare global {
  interface Window {
    runRxdbPersistedInitialReceipt: typeof runRxdbPersistedInitialReceipt
  }
}
window.runRxdbPersistedInitialReceipt = runRxdbPersistedInitialReceipt
