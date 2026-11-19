/**
 * RxDB's real storage query supplies the initial complete result. Holding the
 * persisted wrapper's baseline read defers the first source transaction and
 * returns a genuine asynchronous applied receipt. This driver records that
 * receipt, then cleans up either before or after its application. It never
 * replaces the receipt or adds an AbortSignal to the adapter's commit call.
 *
 * The shared initial-receipt owner supplies the grammar and judgment. Hosts
 * supply persistence and native detached-error events. This path establishes
 * receipt continuation handling, not offline completeness or remote sync.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { rxdbEagerReloadAdapter } from './eager-reload-driver'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export async function observeRxdbPersistedInitialReceipt(
  history: InitialReceiptHistory,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  id: string,
  detachedErrors: Array<string>,
  injectDetachedRejection = false,
): Promise<InitialReceiptObservation> {
  const hold = holdBaseline(id)
  const source = await rxdbEagerReloadAdapter.open(
    startupRows(history.rows, 2),
    id,
  )
  const options = source.options
  const originalSync = options.sync.sync
  let receiptCreated = false
  let firstReceipt: true | Promise<void> | undefined
  let receiptApplied = false
  let receiptRejected = false
  options.sync.sync = (params) =>
    originalSync({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        // Only the first source receipt defines the suspended continuation.
        // Later source transactions retain their actual adapter behavior.
        if (!receiptCreated) {
          receiptCreated = true
          firstReceipt = receipt
          receiptApplied = receipt === true
        }
        return receipt
      },
    })
  const collection = createCollection(
    persistedCollectionOptions({ ...options, persistence }),
  )
  return retainOracleCleanupObservation<InitialReceiptObservation>(async () => {
    const preload = collection.preload()
    void preload.catch(() => {})
    await untilStartup(hold.isHeld)
    await untilStartup(() => receiptCreated)
    if (history.cleanupAt === `after-application`) {
      hold.release()
      await preload
      await firstReceipt
      receiptApplied = true
    }
    // The held persisted read precedes admission of this exact transaction.
    // Do not inspect a held promise with .then/.catch: that would consume a
    // rejection that production might wrongly leave detached after retirement.
    const receiptPendingAtCleanup = firstReceipt !== true && hold.isHeld()
    const receiptAppliedBeforeCleanup = receiptApplied
    const cleanup = collection.cleanup()
    hold.release()
    await cleanup
    // Node and browser detached-rejection events follow the rejecting task.
    for (let turn = 0; turn < 8; turn++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
      await firstReceipt
    } catch {
      receiptRejected = true
    }
    return {
      receiptCreated,
      receiptPendingAtCleanup,
      receiptAppliedBeforeCleanup,
      receiptRejected,
      receiptSettled: true,
      finalStatus: collection.status,
      finalRows: [...collection.values()],
      // Hosts retain this live recorder through source and storage teardown,
      // then drain native event turns and take the final immutable snapshot.
      detachedErrors,
    }
  }, [
    () => hold.uninstall(),
    () => collection.cleanup(),
    source.dispose,
    () => {
      // Recorder calibration only: emit the native event after raw recording
      // and fixture disposal, so an early copy would falsely accept it.
      if (injectDetachedRejection)
        setTimeout(() => {
          void Promise.reject(
            new Error(`Injected detached receipt continuation`),
          )
        }, 0)
    },
  ])
}
