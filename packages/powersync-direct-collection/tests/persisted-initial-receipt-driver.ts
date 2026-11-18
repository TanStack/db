/**
 * Real persistence receives the initial-receipt cleanup law. Holding its first
 * row read queues a genuine source commit behind persisted restore. The SDK
 * sends its complete answer and the adapter receives the wrapper's actual
 * asynchronous receipt. Cleanup then cancels that pending work, or follows its
 * application in the neighboring schedule. This observer never replaces the
 * source receipt or supplies a synthetic rejection.
 *
 * The host provides storage, its row-read seam and native detached-error events.
 * Controlled storage, Node SQLite and Chromium worker/OPFS use this same driver
 * and the separate initial-receipt owner's model and comparison.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { directEagerClient } from './eager-reload-driver'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from './initial-receipt-oracle'

/** A completed receipt result survives teardown, with teardown kept separate. */
export async function retainInitialReceiptCleanup(
  run: () => Promise<InitialReceiptObservation>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<InitialReceiptObservation> {
  return retainOracleCleanupObservation(run, cleanups)
}

export async function observePersistedInitialReceipt(
  history: InitialReceiptHistory,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  id: string,
  detachedErrors: Array<string>,
): Promise<InitialReceiptObservation> {
  const hold = holdBaseline(id)
  const source = directEagerClient()
  const options = source.options(id)
  const originalSync = options.sync.sync
  let receiptCreated = false
  let receiptPending = false
  let receiptApplied = false
  let receiptRejected = false
  options.sync.sync = (params) =>
    originalSync({
      ...params,
      commit: (signal) => {
        const receipt = params.commit(signal)
        receiptCreated = receipt !== true
        receiptPending = receipt !== true
        receiptApplied = receipt === true
        if (receipt !== true)
          void receipt.then(
            () => {
              receiptPending = false
              receiptApplied = true
            },
            () => {
              receiptPending = false
              receiptRejected = true
            },
          )
        return receipt
      },
    })
  const collection = createCollection(
    persistedCollectionOptions({ ...options, persistence }),
  )
  return retainInitialReceiptCleanup(async () => {
    const preload = collection.preload()
    void preload.catch(() => {})
    await untilEagerProtocol(hold.isHeld, `real persisted row read held`)
    await source.service.rows(startupRows(history.rows, 2))
    await untilEagerProtocol(
      () => receiptCreated,
      `actual persisted source receipt returned`,
    )
    await source.propagate()
    if (history.cleanupAt === `after-application`) {
      hold.release()
      await preload
    }
    const receiptPendingAtCleanup = receiptPending
    const receiptAppliedBeforeCleanup = receiptApplied
    const cleanup = collection.cleanup()
    hold.release()
    await cleanup
    await untilEagerProtocol(
      () => !receiptPending,
      `persisted receipt settled after cleanup`,
    )
    // Native unhandled-rejection events occur after the rejecting microtask.
    // Keep that event boundary in every host before copying the observation.
    for (let turn = 0; turn < 8; turn++) await eagerProtocolTurn()
    return {
      receiptCreated,
      receiptPendingAtCleanup,
      receiptAppliedBeforeCleanup,
      receiptRejected,
      finalStatus: collection.status,
      finalRows: [...collection.values()],
      detachedErrors: [...detachedErrors],
    }
  }, [() => hold.uninstall(), () => collection.cleanup(), source.dispose])
}
