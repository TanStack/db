/** Real browser source SQLite and wrapper OPFS receive one receipt law. */
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { observeBrowserPowerSyncInitialReceipt } from '../../powersync-db-collection/tests/initial-receipt-browser'
import { observePowerSyncHooks } from '../../powersync-db-collection/tests/hook-lifecycle-driver'
import { observeNativeBatchDecode } from '../../powersync-db-collection/tests/batch-decode-driver'
import { observeNativeMutationRefusal } from '../../powersync-db-collection/tests/batch-decode-mutation-driver'
import { openBrowserReceivingDatabase } from '../../powersync-db-collection/tests/native-receiving-browser'
import { retainInitialReceiptCleanup } from '../../powersync-direct-db-collection/tests/persisted-initial-receipt-driver'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { InitialReceiptHistory } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'
import type { HookHistory } from '../../powersync-db-collection/tests/hook-lifecycle-oracle'
import type {
  NativeDecodeHistory,
  NativeMutationHistory,
} from '../../powersync-db-collection/tests/batch-decode-oracle'

let sequence = 0
async function runNativePowerSyncInitialReceipt(
  history: InitialReceiptHistory,
  id: string,
  teardownFault?: `cleanup-only` | `mismatch-and-cleanup`,
) {
  const databaseName = `native-powersync-receipt-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const detachedErrors: Array<string> = []
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    detachedErrors.push(describeOracleCleanupError(event.reason))
    event.preventDefault()
  }
  window.addEventListener(`unhandledrejection`, onUnhandledRejection)
  try {
    const completed = await retainInitialReceiptCleanup(
      () =>
        observeBrowserPowerSyncInitialReceipt(
          history,
          createBrowserWASQLitePersistence({ database }),
          inProcessSeams.holdFirstRowSnapshot,
          id,
          detachedErrors,
        ),
      [
        async () => {
          await database.close?.()
          if (teardownFault === `mismatch-and-cleanup`)
            void Promise.reject(
              new Error(`Injected native receipt storage rejection`),
            )
          if (teardownFault)
            throw new Error(`Injected native receipt storage close failure`)
        },
        () =>
          removeClosedArtifacts(
            () => removeStartupOPFSArtifacts(databaseName),
            (cut, value) => console.info(`native-powersync.opfs ${cut}`, value),
          ),
      ],
    )
    // Keep the live array until the finally block has drained native events.
    return { ...completed, detachedErrors }
  } finally {
    // Native rejection events may follow source or wrapper-storage disposal.
    // The listener remains active through teardown even when setup fails.
    for (let turn = 0; turn < 8; turn++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    window.removeEventListener(`unhandledrejection`, onUnhandledRejection)
  }
}

const runNativePowerSyncHooks = (history: HookHistory, id: string) =>
  observePowerSyncHooks(openBrowserReceivingDatabase, history, id)
const runNativePowerSyncBatchDecode = (
  history: NativeDecodeHistory,
  id: string,
) => observeNativeBatchDecode(openBrowserReceivingDatabase, history, id)
const runNativePowerSyncMutationRefusal = (
  history: NativeMutationHistory,
  id: string,
) => observeNativeMutationRefusal(openBrowserReceivingDatabase, history, id)

declare global {
  interface Window {
    runNativePowerSyncInitialReceipt: typeof runNativePowerSyncInitialReceipt
    runNativePowerSyncHooks: typeof runNativePowerSyncHooks
    runNativePowerSyncBatchDecode: typeof runNativePowerSyncBatchDecode
    runNativePowerSyncMutationRefusal: typeof runNativePowerSyncMutationRefusal
  }
}
window.runNativePowerSyncInitialReceipt = runNativePowerSyncInitialReceipt
window.runNativePowerSyncHooks = runNativePowerSyncHooks
window.runNativePowerSyncBatchDecode = runNativePowerSyncBatchDecode
window.runNativePowerSyncMutationRefusal = runNativePowerSyncMutationRefusal
