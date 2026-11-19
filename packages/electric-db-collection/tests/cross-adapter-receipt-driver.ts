/**
 * Real persistence receives the initial-receipt cleanup law. Holding its first
 * source durable write queues a genuine source commit after persisted restore. The SDK
 * sends its complete answer and the adapter receives the wrapper's actual
 * asynchronous receipt. Cleanup then cancels that pending work, or follows its
 * application in the neighboring schedule. This observer never replaces the
 * source receipt or supplies a synthetic rejection.
 *
 * Electric certifies persisted keys before processing a source result, so a
 * held restore cannot reach this receipt. The public storage adapter's durable
 * write supplies the hold instead. In the held schedule, that storage method
 * rejects after cleanup starts. The wrapper creates the rejected receipt; this
 * driver returns that exact receipt to Electric. Cleanup alone can legally let
 * an admitted signal-less Electric transaction fulfill. The host provides
 * native detached errors. No claim transfers that cleanup cancels all commits.
 * Controlled storage, Node SQLite and Chromium worker/OPFS use this same driver
 * and the separate initial-receipt owner's model and comparison.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { crossElectricReloadAdapter } from './cross-adapter-reload-driver'
import { electricTurn, untilElectric } from './cross-adapter-http'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

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
  id: string,
  detachedErrors: Array<string>,
  heldReceiptOutcome: `rejected` | `applied` = `rejected`,
): Promise<InitialReceiptObservation> {
  // Browser persistence selects its adapter by Collection mode. Resolve that
  // public configuration before installing the storage fault on its real path.
  persistence =
    persistence.resolvePersistenceForCollection?.({
      collectionId: id,
      mode: `sync-present`,
    }) ??
    persistence.resolvePersistenceForMode?.(`sync-present`) ??
    persistence
  const originalApply = persistence.adapter.applyCommittedTx.bind(
    persistence.adapter,
  )
  let held = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  persistence.adapter.applyCommittedTx = async (...args) => {
    held = true
    await gate
    if (
      history.cleanupAt === `held-receipt` &&
      heldReceiptOutcome === `rejected`
    )
      throw new Error(`Injected durable write rejection ${history.reason}`)
    return originalApply(...args)
  }
  const source = await crossElectricReloadAdapter.open(
    startupRows(history.rows, 2),
    id,
  )
  const options = source.options
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
    await untilElectric(
      () => receiptCreated && held,
      `actual persisted source receipt returned while durability held`,
    )
    for (let turn = 0; turn < 4; turn++) await electricTurn()
    if (history.cleanupAt === `after-application`) {
      release()
      await preload
      // Electric readiness follows acceptance. The neighboring history names
      // applied settlement, which can occur in a later microtask.
      await untilElectric(() => receiptApplied, `actual source receipt applied`)
    }
    const receiptPendingAtCleanup = receiptPending
    const receiptAppliedBeforeCleanup = receiptApplied
    const cleanup = collection.cleanup()
    release()
    await cleanup
    await untilElectric(
      () => !receiptPending,
      `persisted receipt settled after cleanup`,
    )
    // Native unhandled-rejection events occur after the rejecting microtask.
    // Keep that event boundary in every host before copying the observation.
    for (let turn = 0; turn < 8; turn++) await electricTurn()
    return {
      receiptCreated,
      receiptPendingAtCleanup,
      receiptAppliedBeforeCleanup,
      receiptRejected,
      receiptSettled: !receiptPending,
      finalStatus: collection.status,
      finalRows: [...collection.values()],
      detachedErrors: [...detachedErrors],
    }
  }, [
    () => {
      release()
      persistence.adapter.applyCommittedTx = originalApply
    },
    () => collection.cleanup(),
    source.dispose,
  ])
}
