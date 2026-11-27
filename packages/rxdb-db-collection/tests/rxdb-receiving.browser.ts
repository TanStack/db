/** Actual Chromium supplies detached-error events for the shared comparison. */
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { observeEagerGateFailure } from '../../db-adapter-conformance/tests/eager-reload-driver'
import { observeRxdbInitialReceipt } from './initial-receipt-driver'
import { observeRxdbSharedClient } from './shared-client-driver'
import { rxdbEagerGateAdapter } from './eager-gate-driver'
import { observeRxdbMutation } from './mutation-driver'
import type { InitialReceiptHistory } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'

const target = window as unknown as {
  runRxdbInitialReceipt: typeof observeRxdbInitialReceipt
  runRxdbSharedClient: typeof observeRxdbSharedClient
  runRxdbMutation: typeof observeRxdbMutation
  runRxdbEagerGate: (
    history: Parameters<typeof observeEagerGateFailure>[1],
    id: string,
  ) => ReturnType<typeof observeEagerGateFailure>
}
target.runRxdbInitialReceipt = async (history: InitialReceiptHistory) => {
  const errors: Array<string> = []
  const record = (event: PromiseRejectionEvent) => {
    errors.push(describeOracleCleanupError(event.reason))
  }
  window.addEventListener(`unhandledrejection`, record)
  try {
    return await observeRxdbInitialReceipt(history, errors)
  } finally {
    window.removeEventListener(`unhandledrejection`, record)
  }
}
target.runRxdbSharedClient = observeRxdbSharedClient
target.runRxdbMutation = observeRxdbMutation
target.runRxdbEagerGate = (history, id) =>
  observeEagerGateFailure(rxdbEagerGateAdapter, history, id)
