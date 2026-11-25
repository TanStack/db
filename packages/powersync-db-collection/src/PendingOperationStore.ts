import pDefer from 'p-defer'
import type { DiffTriggerOperation } from '@powersync/common'
import type { DeferredPromise } from 'p-defer'

export type PendingOperation = {
  tableName: string
  operation: DiffTriggerOperation
  id: string
  timestamp: string
}

/**
 * Native handlers fulfill after their own Collection stages the matching diff,
 * so core can drop optimistic state with those synced rows. A captured run
 * signal owns that confirmation and rejects it when the run ends.
 */
export class PendingOperationStore {
  private pendingOperations = new Map<
    PendingOperation,
    { deferred: DeferredPromise<void>; signal?: AbortSignal }
  >()

  /**
   * Globally accessible PendingOperationStore
   */
  static GLOBAL = new PendingOperationStore()

  /** Waits for the owning run's observation, or rejects when that run aborts. */
  waitFor(operation: PendingOperation, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const managedPromise = pDefer<void>()
    this.pendingOperations.set(operation, { deferred: managedPromise, signal })
    if (signal) {
      const abort = () => {
        this.pendingOperations.delete(operation)
        managedPromise.reject(signal.reason)
      }
      signal.addEventListener(`abort`, abort, { once: true })
      const release = () => signal.removeEventListener(`abort`, abort)
      void managedPromise.promise.then(release, release)
    }
    return managedPromise.promise
  }

  /**
   * Confirms operations staged by the observing run. A native waiter must own
   * that same signal; signal-less custom metadata keeps legacy confirmation.
   */
  resolvePendingFor(operations: Array<PendingOperation>, signal?: AbortSignal) {
    for (const operation of operations) {
      for (const [
        pendingOp,
        { deferred, signal: ownerSignal },
      ] of this.pendingOperations.entries()) {
        if (
          // Native success belongs to the Collection that staged the operation.
          // Signal-less custom metadata keeps its existing confirmation path.
          (!ownerSignal || ownerSignal === signal) &&
          pendingOp.tableName == operation.tableName &&
          pendingOp.operation == operation.operation &&
          pendingOp.id == operation.id &&
          pendingOp.timestamp == operation.timestamp
        ) {
          deferred.resolve()
          this.pendingOperations.delete(pendingOp)
        }
      }
    }
  }
}
