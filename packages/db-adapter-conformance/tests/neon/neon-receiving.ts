/** Browser entry records the same shared judgments and public observations. */
import { observeEagerLiveSourceHistory } from '../eager-live-source-framework-oracle'
import { observeEagerReload } from '../eager-reload-driver'
import { describeOracleCleanupError } from '../../../db/tests/oracle-cleanup'
import { neonSDKDriver } from './neon-sdk-driver'
import { neonReloadAdapter } from './neon-reload-driver'
import { observeNeonInitialReceipt } from './neon-initial-receipt-driver'
import { observeNeonSharedClient } from './neon-shared-client-driver'
import { observeNeonIdempotentRemoval } from './neon-idempotent-removal-driver'
import type { EagerLiveSourceHistory } from '../../src'
import type { EagerReloadHistory } from '../eager-reload-oracle'
import type { InitialReceiptHistory } from '../../../powersync-direct-db-collection/tests/initial-receipt-oracle'

export const runNeonEager = (
  history: EagerLiveSourceHistory,
  ordered: boolean,
) => observeEagerLiveSourceHistory(neonSDKDriver(ordered), history)
export const runNeonReload = (
  history: EagerReloadHistory,
  id: string,
  omitTruncate: boolean,
) =>
  observeEagerReload(
    neonReloadAdapter,
    history,
    id,
    undefined,
    false,
    omitTruncate,
  )
export const runNeonSharedClient = observeNeonSharedClient
export const runNeonIdempotentRemoval = observeNeonIdempotentRemoval
export const runNeonInitialReceipt = async (
  history: InitialReceiptHistory,
  fault?: `cleanup-only` | `mismatch-and-cleanup`,
) => {
  const errors: Array<string> = []
  const record = (event: PromiseRejectionEvent) => {
    errors.push(describeOracleCleanupError(event.reason))
    event.preventDefault()
  }
  window.addEventListener(`unhandledrejection`, record)
  try {
    return await observeNeonInitialReceipt(history, errors, fault)
  } finally {
    window.removeEventListener(`unhandledrejection`, record)
  }
}
Object.assign(window, {
  runNeonEager,
  runNeonReload,
  runNeonSharedClient,
  runNeonIdempotentRemoval,
  runNeonInitialReceipt,
})
