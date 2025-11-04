import pDefer from "p-defer"
import type { DiffTriggerOperation } from "@powersync/common"
import type { DeferredPromise } from "p-defer"

export type PendingOperation = {
  tableName: string
  operation: DiffTriggerOperation
  id: string
  timestamp: string
}

/**
 * Optimistic mutations have their optimistic state discarded once transactions have
 * been applied.
 * We need to ensure that an applied transaction has been observed by the sync diff trigger
 * before resolving the transaction application call.
 * This store allows registering a wait for a pending operation to have been observed.
 */
export class PendingOperationStore {
  private pendingOperations = new Map<PendingOperation, DeferredPromise<void>>()

  /**
   * Globally accessible PendingOperationStore
   */
  static GLOBAL = new PendingOperationStore()

  /**
   * @returns A promise which will resolve once the specified operation has been seen.
   */
  waitFor(operation: PendingOperation): Promise<void> {
    const managedPromise = pDefer<void>()
    this.pendingOperations.set(operation, managedPromise)
    return managedPromise.promise
  }

  /**
   * Marks a set of operations as seen. This will resolve any pending promises.
   */
  resolvePendingFor(operations: Array<PendingOperation>) {
    for (const operation of operations) {
      for (const [pendingOp, deferred] of this.pendingOperations.entries()) {
        if (
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
