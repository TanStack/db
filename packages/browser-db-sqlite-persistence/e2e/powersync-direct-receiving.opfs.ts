/**
 * Actual Chromium and the OPFS worker supply this receiving path. The direct
 * adapter driver still uses the installed PowerSync SDK over controlled NDJSON.
 * It reuses the startup owner's composition and immediate public/durable cuts;
 * no polyfill changes the browser's native feature support.
 */
import {
  isStartupRowRead,
  observePersistedStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { startupReachedStates } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { directPowerSyncStartupAdapter } from '../../powersync-direct-collection/tests/persisted-startup-driver'
import {
  directEagerGateAdapter,
  directEagerReloadAdapter,
} from '../../powersync-direct-collection/tests/eager-reload-driver'
import {
  observeEagerGateFailure,
  observeEagerReload,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import { observeOnDemandStreams } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import { failingStreams } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import { directOnDemandStreamsAdapter } from '../../powersync-direct-collection/tests/on-demand-streams-driver'
import { persistedDirectOnDemandStreamsAdapter } from '../../powersync-direct-collection/tests/on-demand-streams-persisted-driver'
import {
  observePersistedInitialReceipt,
  retainInitialReceiptCleanup,
} from '../../powersync-direct-collection/tests/persisted-initial-receipt-driver'
import { observeDirectSharedClient } from '../../powersync-direct-collection/tests/shared-client-driver'
import { directConformanceDriver } from '../../powersync-direct-collection/tests/conformance-driver'
import { observeEagerLiveSourceHistory } from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'
import type { EagerSourceCorruption } from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'
import type {
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../../db-adapter-conformance/src'
import {
  runDirectMutationConfirmation as receiveMutationConfirmation,
  transportMutationTrace,
} from '../../powersync-direct-collection/tests/mutation-confirmation-driver'
import { observeDecodeRefusal } from '../../db-adapter-conformance/tests/decode-refusal-driver'
import { directDecodeAdapter } from '../../powersync-direct-collection/tests/decode-refusal-driver'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import {
  describeOracleCleanupError,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { recordQueryHistory } from './query-ownership-browser-support'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type {
  EagerGateHistory,
  EagerReloadHistory,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'
import type { OnDemandStreamsHistory } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import type { DirectMutationHistory } from '../../powersync-direct-collection/tests/mutation-confirmation-driver'
import type { DecodeHistory } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'
import type { SharedClientHistory } from '../../db-adapter-conformance/tests/shared-client-oracle'

let sequence = 0
async function runDirectPersistedStartup(
  history: PersistedStartupHistory,
  id: string,
) {
  return recordQueryHistory(async (observe) => {
    const databaseName = `ps-direct-${sequence++}.sqlite`
    await removeStartupOPFSArtifacts(databaseName)
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
    await withOracleCleanup(async () => {
      let rowReads = 0
      const execute = database.execute.bind(database)
      database.execute = (sql, params) => {
        if (isStartupRowRead(sql)) rowReads++
        return execute(sql, params)
      }
      const result = await observePersistedStartup(
        directPowerSyncStartupAdapter,
        createBrowserWASQLitePersistence({ database }),
        inProcessSeams.holdFirstRowSnapshot,
        history,
        id,
        () => rowReads,
        () => {
          for (const state of startupReachedStates(history))
            observe(`reach`, state)
        },
        (violations) => observe(`cut failure`, violations),
      )
      observe(`completed`, result)
    }, [
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`powersync-direct.opfs ${cut}`, value),
        ),
    ])
    observe(`artifacts`, await startupOPFSArtifacts())
  })
}

const runDirectEagerReload = (
  history: EagerReloadHistory,
  id: string,
  omitTruncate = false,
) =>
  observeEagerReload(
    directEagerReloadAdapter,
    history,
    id,
    undefined,
    false,
    omitTruncate,
  )
const runDirectEagerGateFailure = (history: EagerGateHistory, id: string) =>
  observeEagerGateFailure(directEagerGateAdapter, history, id)
const runDirectOnDemandStreams = (
  history: OnDemandStreamsHistory,
  id: string,
) =>
  observeOnDemandStreams(
    directOnDemandStreamsAdapter(),
    history,
    id,
    failingStreams(history),
  )
const runDirectPersistedOnDemandStreams = (
  history: OnDemandStreamsHistory,
  id: string,
) =>
  observeOnDemandStreams(
    persistedDirectOnDemandStreamsAdapter(async () => {
      const databaseName = `ps-direct-subsets-${sequence++}.sqlite`
      await removeStartupOPFSArtifacts(databaseName)
      const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
      return {
        persistence: createBrowserWASQLitePersistence({ database }),
        close: () =>
          withOracleCleanup(
            () => database.close?.(),
            [
              () =>
                removeClosedArtifacts(
                  () => removeStartupOPFSArtifacts(databaseName),
                  (cut, value) =>
                    console.info(`powersync-direct.opfs ${cut}`, value),
                ),
            ],
          ),
      }
    }),
    history,
    id,
    failingStreams(history),
  )
async function runDirectPersistedInitialReceipt(
  history: InitialReceiptHistory,
  id: string,
) {
  const databaseName = `ps-direct-receipt-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const detachedErrors: Array<string> = []
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    detachedErrors.push(describeOracleCleanupError(event.reason))
    event.preventDefault()
  }
  window.addEventListener(`unhandledrejection`, onUnhandledRejection)
  return retainInitialReceiptCleanup(
    () =>
      observePersistedInitialReceipt(
        history,
        createBrowserWASQLitePersistence({ database }),
        inProcessSeams.holdFirstRowSnapshot,
        id,
        detachedErrors,
      ),
    [
      () =>
        window.removeEventListener(`unhandledrejection`, onUnhandledRejection),
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`powersync-direct.opfs ${cut}`, value),
        ),
    ],
  )
}
const runDirectMutationConfirmation = async (history: DirectMutationHistory) =>
  transportMutationTrace(await receiveMutationConfirmation(history))
const runDirectDecodeRefusal = (history: DecodeHistory, id: string) =>
  observeDecodeRefusal(directDecodeAdapter, history, id)
const runDirectSharedClient = (history: SharedClientHistory, id: string) =>
  observeDirectSharedClient(history, id)
const runDirectEagerSource = (
  history: EagerLiveSourceHistory,
  corruption?: EagerSourceCorruption,
  states?: ReadonlyArray<EagerLiveSourceReachState>,
) =>
  observeEagerLiveSourceHistory(
    directConformanceDriver(),
    history,
    corruption,
    states,
  )

declare global {
  interface Window {
    runDirectPersistedStartup: typeof runDirectPersistedStartup
    runDirectEagerReload: typeof runDirectEagerReload
    runDirectEagerGateFailure: typeof runDirectEagerGateFailure
    runDirectOnDemandStreams: typeof runDirectOnDemandStreams
    runDirectPersistedOnDemandStreams: typeof runDirectPersistedOnDemandStreams
    runDirectPersistedInitialReceipt: typeof runDirectPersistedInitialReceipt
    runDirectMutationConfirmation: typeof runDirectMutationConfirmation
    runDirectDecodeRefusal: typeof runDirectDecodeRefusal
    runDirectSharedClient: typeof runDirectSharedClient
    runDirectEagerSource: typeof runDirectEagerSource
  }
}
window.runDirectPersistedStartup = runDirectPersistedStartup
window.runDirectEagerReload = runDirectEagerReload
window.runDirectEagerGateFailure = runDirectEagerGateFailure
window.runDirectOnDemandStreams = runDirectOnDemandStreams
window.runDirectPersistedOnDemandStreams = runDirectPersistedOnDemandStreams
window.runDirectPersistedInitialReceipt = runDirectPersistedInitialReceipt
window.runDirectMutationConfirmation = runDirectMutationConfirmation
window.runDirectDecodeRefusal = runDirectDecodeRefusal
window.runDirectSharedClient = runDirectSharedClient
window.runDirectEagerSource = runDirectEagerSource
