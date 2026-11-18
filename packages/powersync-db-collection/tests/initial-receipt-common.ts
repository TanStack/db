/**
 * A real PowerSync SQLite read receives the host-independent initial-receipt
 * cleanup law. Holding persisted restore queues the adapter's first commit
 * behind a real durable boundary. The persisted wrapper supplies the pending
 * receipt and its cancellation; this observer never replaces that receipt.
 *
 * Native eager readiness waits for acceptance, so an accepted core receipt
 * held by an optimistic transaction is a different boundary. This receiving
 * path deliberately tests deferred acceptance through persistence instead.
 * Source SQLite and persisted storage are separate databases. The host records
 * actual detached-error events and supplies its persisted row-read seam.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { retainInitialReceiptCleanup } from '../../powersync-direct-collection/tests/persisted-initial-receipt-driver'
import type { SyncAppliedReceipt } from '@tanstack/db'
import type { EagerReloadAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export async function observePowerSyncInitialReceipt(
  adapter: EagerReloadAdapter,
  history: InitialReceiptHistory,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  id: string,
  detachedErrors: Array<string>,
): Promise<InitialReceiptObservation> {
  const hold = holdBaseline(id)
  const source = await adapter.open(startupRows(history.rows, 2), id)
  const options = source.options
  const originalSync = options.sync.sync
  let receiptCreated = false
  let firstReceipt: SyncAppliedReceipt | undefined
  let receiptApplied = false
  let receiptRejected = false
  options.sync.sync = (params) =>
    originalSync({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        // Native startup can stream several SQL pages. The first genuine
        // receipt defines this law's continuation; later receipts remain real
        // and retain the adapter's own cancellation/error handling.
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
  return retainInitialReceiptCleanup(async () => {
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
    // The actual restore read is still held in this schedule. The wrapper
    // cannot accept this receipt until that read returns. Do not install a
    // rejection observer here: it would consume an unhandled source rejection.
    const receiptPendingAtCleanup =
      firstReceipt !== true && history.cleanupAt === `held-receipt`
    const receiptAppliedBeforeCleanup = receiptApplied
    const cleanup = collection.cleanup()
    hold.release()
    await cleanup
    // Native unhandled-rejection events follow the rejecting microtask turn.
    for (let turn = 0; turn < 8; turn++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    // Only inspect settlement after native rejection events had their turn.
    // Production must own the original promise before this late observer does.
    await Promise.resolve(firstReceipt).then(
      () => {
        receiptApplied = true
      },
      () => {
        receiptRejected = true
      },
    )
    return {
      receiptCreated,
      receiptPendingAtCleanup,
      receiptAppliedBeforeCleanup,
      receiptRejected,
      finalStatus: collection.status,
      finalRows: [...collection.values()],
      // Keep the live recorder through source and outer storage teardown.
      detachedErrors,
    }
  }, [() => hold.uninstall(), () => collection.cleanup(), source.dispose])
}
