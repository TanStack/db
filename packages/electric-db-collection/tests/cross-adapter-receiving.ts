/** Browser entry supplies only the real host production path and observations. */
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import {
  observeEagerGateFailure,
  observeEagerReload,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../../browser-db-sqlite-persistence/src'
import { removeStartupOPFSArtifacts } from '../../browser-db-sqlite-persistence/e2e/persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from '../../browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-cleanup'
import { observeEagerLiveSourceHistory } from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'
import { crossElectricReloadAdapter } from './cross-adapter-reload-driver'
import { crossElectricGateAdapter } from './cross-adapter-gate-driver'
import { observeDecoder } from './sdk-decoder-driver'
import { observeSDKSnapshotDelivery } from './sdk-snapshot-delivery-oracle'
import { electricConformanceDriver } from './conformance-driver'
import {
  observeElectricMutation,
  transportElectricMutation,
} from './cross-adapter-mutation-driver'
import {
  observePersistedInitialReceipt,
  retainInitialReceiptCleanup,
} from './cross-adapter-receipt-driver'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'
import type { MutationConfirmationHistory } from '../../db/tests/mutation-confirmation-oracle'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'
import type {
  EagerGateHistory,
  EagerReloadHistory,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'

export const runElectricEagerReload = (
  history: EagerReloadHistory,
  id: string,
  omitTruncate: boolean,
) =>
  observeEagerReload(
    crossElectricReloadAdapter,
    history,
    id,
    undefined,
    false,
    omitTruncate,
  )

export const runElectricEagerGate = (history: EagerGateHistory, id: string) =>
  observeEagerGateFailure(crossElectricGateAdapter, history, id)

let receiptSequence = 0
export async function runElectricInitialReceipt(
  history: InitialReceiptHistory,
  id: string,
  heldReceiptOutcome: `rejected` | `applied` = `rejected`,
) {
  const databaseName = `electric-receipt-${receiptSequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const detachedErrors: Array<string> = []
  const recordRejection = (event: PromiseRejectionEvent) => {
    detachedErrors.push(describeOracleCleanupError(event.reason))
    event.preventDefault()
  }
  window.addEventListener(`unhandledrejection`, recordRejection)
  return retainInitialReceiptCleanup(
    () =>
      observePersistedInitialReceipt(
        history,
        createBrowserWASQLitePersistence({ database }),
        id,
        detachedErrors,
        heldReceiptOutcome,
      ),
    [
      () => window.removeEventListener(`unhandledrejection`, recordRejection),
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`electric.opfs ${cut}`, value),
        ),
    ],
  )
}

Object.assign(window, {
  runElectricSDKSnapshot: observeSDKSnapshotDelivery,
  runElectricEager: (
    history: EagerLiveSourceHistory,
    appOnError: boolean,
    corruption?: `values`,
  ) =>
    observeEagerLiveSourceHistory(
      electricConformanceDriver({ appOnError }),
      history,
      corruption,
    ),
  runElectricDecoder: observeDecoder,
  runElectricEagerReload,
  runElectricEagerGate,
  runElectricInitialReceipt,
  runElectricMutation: async (
    history: MutationConfirmationHistory,
    fault?: `cleanup-only` | `mismatch-and-cleanup`,
  ) => transportElectricMutation(await observeElectricMutation(history, fault)),
})
