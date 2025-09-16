import { deepEquals } from "../utils"
import { SortedMap } from "../SortedMap"
import type { Transaction } from "../transactions"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { ChangeMessage, OptimisticChangeMessage } from "../types"
import type { CollectionImpl } from "../collection/index.js"

interface PendingSyncedTransaction<T extends object = Record<string, unknown>> {
  committed: boolean
  operations: Array<OptimisticChangeMessage<T>>
  truncate?: boolean
  deletedKeys: Set<string | number>
}

export class CollectionStateManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  public collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>

  // Core state - make public for testing
  public transactions: SortedMap<string, Transaction<any>>
  public pendingSyncedTransactions: Array<PendingSyncedTransaction<TOutput>> =
    []
  public syncedData: Map<TKey, TOutput> | SortedMap<TKey, TOutput>
  public syncedMetadata = new Map<TKey, unknown>()

  // Optimistic state tracking - make public for testing
  public optimisticUpserts = new Map<TKey, TOutput>()
  public optimisticDeletes = new Set<TKey>()

  // Cached size for performance
  public size = 0

  // State used for computing the change events
  public syncedKeys = new Set<TKey>()
  public preSyncVisibleState = new Map<TKey, TOutput>()
  public recentlySyncedKeys = new Set<TKey>()
  public hasReceivedFirstCommit = false
  public isCommittingSyncTransactions = false

  /**
   * Creates a new CollectionState manager
   */
  constructor(collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>) {
    this.collection = collection

    this.transactions = new SortedMap<string, Transaction<any>>((a, b) =>
      a.compareCreatedAt(b)
    )

    // Set up data storage with optional comparison function
    if (collection.config.compare) {
      this.syncedData = new SortedMap<TKey, TOutput>(collection.config.compare)
    } else {
      this.syncedData = new Map<TKey, TOutput>()
    }
  }

  /**
   * Recompute optimistic state from active transactions
   */
  public recomputeOptimisticState(
    triggeredByUserAction: boolean = false
  ): void {
    // Skip redundant recalculations when we're in the middle of committing sync transactions
    if (this.isCommittingSyncTransactions) {
      return
    }

    const previousState = new Map(this.optimisticUpserts)
    const previousDeletes = new Set(this.optimisticDeletes)

    // Clear current optimistic state
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()

    const activeTransactions: Array<Transaction<any>> = []

    for (const transaction of this.transactions.values()) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        activeTransactions.push(transaction)
      }
    }

    // Apply active transactions only (completed transactions are handled by sync operations)
    for (const transaction of activeTransactions) {
      for (const mutation of transaction.mutations) {
        if (mutation.collection === this.collection && mutation.optimistic) {
          switch (mutation.type) {
            case `insert`:
            case `update`:
              this.optimisticUpserts.set(
                mutation.key,
                mutation.modified as TOutput
              )
              this.optimisticDeletes.delete(mutation.key)
              break
            case `delete`:
              this.optimisticUpserts.delete(mutation.key)
              this.optimisticDeletes.add(mutation.key)
              break
          }
        }
      }
    }

    // Update cached size
    this.size = this.calculateSize()

    // Collect events for changes
    const events: Array<ChangeMessage<TOutput, TKey>> = []
    this.collectOptimisticChanges(previousState, previousDeletes, events)

    // Filter out events for recently synced keys to prevent duplicates
    // BUT: Only filter out events that are actually from sync operations
    // New user transactions should NOT be filtered even if the key was recently synced
    const filteredEventsBySyncStatus = events.filter((event) => {
      if (!this.recentlySyncedKeys.has(event.key)) {
        return true // Key not recently synced, allow event through
      }

      // Key was recently synced - allow if this is a user-triggered action
      if (triggeredByUserAction) {
        return true
      }

      // Otherwise filter out duplicate sync events
      return false
    })

    // Filter out redundant delete events if there are pending sync transactions
    // that will immediately restore the same data, but only for completed transactions
    // IMPORTANT: Skip complex filtering for user-triggered actions to prevent UI blocking
    if (this.pendingSyncedTransactions.length > 0 && !triggeredByUserAction) {
      const pendingSyncKeys = new Set<TKey>()

      // Collect keys from pending sync operations
      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          pendingSyncKeys.add(operation.key as TKey)
        }
      }

      // Only filter out delete events for keys that:
      // 1. Have pending sync operations AND
      // 2. Are from completed transactions (being cleaned up)
      const filteredEvents = filteredEventsBySyncStatus.filter((event) => {
        if (event.type === `delete` && pendingSyncKeys.has(event.key)) {
          // Check if this delete is from clearing optimistic state of completed transactions
          // We can infer this by checking if we have no remaining optimistic mutations for this key
          const hasActiveOptimisticMutation = activeTransactions.some((tx) =>
            tx.mutations.some(
              (m) => m.collection === this.collection && m.key === event.key
            )
          )

          if (!hasActiveOptimisticMutation) {
            return false // Skip this delete event as sync will restore the data
          }
        }
        return true
      })

      // Update indexes for the filtered events
      if (filteredEvents.length > 0) {
        this.collection._indexes.updateIndexes(filteredEvents)
      }
      this.collection._changes.emitEvents(filteredEvents, triggeredByUserAction)
    } else {
      // Update indexes for all events
      if (filteredEventsBySyncStatus.length > 0) {
        this.collection._indexes.updateIndexes(filteredEventsBySyncStatus)
      }
      // Emit all events if no pending sync transactions
      this.collection._changes.emitEvents(
        filteredEventsBySyncStatus,
        triggeredByUserAction
      )
    }
  }

  /**
   * Calculate the current size based on synced data and optimistic changes
   */
  private calculateSize(): number {
    const syncedSize = this.syncedData.size
    const deletesFromSynced = Array.from(this.optimisticDeletes).filter(
      (key) => this.syncedData.has(key) && !this.optimisticUpserts.has(key)
    ).length
    const upsertsNotInSynced = Array.from(this.optimisticUpserts.keys()).filter(
      (key) => !this.syncedData.has(key)
    ).length

    return syncedSize - deletesFromSynced + upsertsNotInSynced
  }

  /**
   * Collect events for optimistic changes
   */
  private collectOptimisticChanges(
    previousUpserts: Map<TKey, TOutput>,
    previousDeletes: Set<TKey>,
    events: Array<ChangeMessage<TOutput, TKey>>
  ): void {
    const allKeys = new Set([
      ...previousUpserts.keys(),
      ...this.optimisticUpserts.keys(),
      ...previousDeletes,
      ...this.optimisticDeletes,
    ])

    for (const key of allKeys) {
      const currentValue = this.collection.get(key)
      const previousValue = this.getPreviousValue(
        key,
        previousUpserts,
        previousDeletes
      )

      if (previousValue !== undefined && currentValue === undefined) {
        events.push({ type: `delete`, key, value: previousValue })
      } else if (previousValue === undefined && currentValue !== undefined) {
        events.push({ type: `insert`, key, value: currentValue })
      } else if (
        previousValue !== undefined &&
        currentValue !== undefined &&
        previousValue !== currentValue
      ) {
        events.push({
          type: `update`,
          key,
          value: currentValue,
          previousValue,
        })
      }
    }
  }

  /**
   * Get the previous value for a key given previous optimistic state
   */
  private getPreviousValue(
    key: TKey,
    previousUpserts: Map<TKey, TOutput>,
    previousDeletes: Set<TKey>
  ): TOutput | undefined {
    if (previousDeletes.has(key)) {
      return undefined
    }
    if (previousUpserts.has(key)) {
      return previousUpserts.get(key)
    }
    return this.syncedData.get(key)
  }

  /**
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
    // Check if there are any persisting transaction
    let hasPersistingTransaction = false
    for (const transaction of this.transactions.values()) {
      if (transaction.state === `persisting`) {
        hasPersistingTransaction = true
        break
      }
    }

    // pending synced transactions could be either `committed` or still open.
    // we only want to process `committed` transactions here
    const {
      committedSyncedTransactions,
      uncommittedSyncedTransactions,
      hasTruncateSync,
    } = this.pendingSyncedTransactions.reduce(
      (acc, t) => {
        if (t.committed) {
          acc.committedSyncedTransactions.push(t)
          if (t.truncate === true) {
            acc.hasTruncateSync = true
          }
        } else {
          acc.uncommittedSyncedTransactions.push(t)
        }
        return acc
      },
      {
        committedSyncedTransactions: [] as Array<
          PendingSyncedTransaction<TOutput>
        >,
        uncommittedSyncedTransactions: [] as Array<
          PendingSyncedTransaction<TOutput>
        >,
        hasTruncateSync: false,
      }
    )

    if (!hasPersistingTransaction || hasTruncateSync) {
      // Set flag to prevent redundant optimistic state recalculations
      this.isCommittingSyncTransactions = true

      // First collect all keys that will be affected by sync operations
      const changedKeys = new Set<TKey>()
      for (const transaction of committedSyncedTransactions) {
        for (const operation of transaction.operations) {
          changedKeys.add(operation.key as TKey)
        }
      }

      // Use pre-captured state if available (from optimistic scenarios),
      // otherwise capture current state (for pure sync scenarios)
      let currentVisibleState = this.preSyncVisibleState
      if (currentVisibleState.size === 0) {
        // No pre-captured state, capture it now for pure sync operations
        currentVisibleState = new Map<TKey, TOutput>()
        for (const key of changedKeys) {
          const currentValue = this.collection.get(key)
          if (currentValue !== undefined) {
            currentVisibleState.set(key, currentValue)
          }
        }
      }

      const events: Array<ChangeMessage<TOutput, TKey>> = []
      const rowUpdateMode =
        this.collection.config.sync.rowUpdateMode || `partial`

      for (const transaction of committedSyncedTransactions) {
        // Handle truncate operations first
        if (transaction.truncate) {
          // TRUNCATE PHASE
          // 1) Emit a delete for every currently-synced key so downstream listeners/indexes
          //    observe a clear-before-rebuild. We intentionally skip keys already in
          //    optimisticDeletes because their delete was previously emitted by the user.
          for (const key of this.syncedData.keys()) {
            if (this.optimisticDeletes.has(key)) continue
            const previousValue =
              this.optimisticUpserts.get(key) || this.syncedData.get(key)
            if (previousValue !== undefined) {
              events.push({ type: `delete`, key, value: previousValue })
            }
          }

          // 2) Clear the authoritative synced base. Subsequent server ops in this
          //    same commit will rebuild the base atomically.
          this.syncedData.clear()
          this.syncedMetadata.clear()
          this.syncedKeys.clear()

          // 3) Clear currentVisibleState for truncated keys to ensure subsequent operations
          //    are compared against the post-truncate state (undefined) rather than pre-truncate state
          //    This ensures that re-inserted keys are emitted as INSERT events, not UPDATE events
          for (const key of changedKeys) {
            currentVisibleState.delete(key)
          }
        }

        for (const operation of transaction.operations) {
          const key = operation.key as TKey
          this.syncedKeys.add(key)

          // Update metadata
          switch (operation.type) {
            case `insert`:
              this.syncedMetadata.set(key, operation.metadata)
              break
            case `update`:
              this.syncedMetadata.set(
                key,
                Object.assign(
                  {},
                  this.syncedMetadata.get(key),
                  operation.metadata
                )
              )
              break
            case `delete`:
              this.syncedMetadata.delete(key)
              break
          }

          // Update synced data
          switch (operation.type) {
            case `insert`:
              this.syncedData.set(key, operation.value)
              break
            case `update`: {
              if (rowUpdateMode === `partial`) {
                const updatedValue = Object.assign(
                  {},
                  this.syncedData.get(key),
                  operation.value
                )
                this.syncedData.set(key, updatedValue)
              } else {
                this.syncedData.set(key, operation.value)
              }
              break
            }
            case `delete`:
              this.syncedData.delete(key)
              break
          }
        }
      }

      // After applying synced operations, if this commit included a truncate,
      // re-apply optimistic mutations on top of the fresh synced base. This ensures
      // the UI preserves local intent while respecting server rebuild semantics.
      // Ordering: deletes (above) -> server ops (just applied) -> optimistic upserts.
      if (hasTruncateSync) {
        // Avoid duplicating keys that were inserted/updated by synced operations in this commit
        const syncedInsertedOrUpdatedKeys = new Set<TKey>()
        for (const t of committedSyncedTransactions) {
          for (const op of t.operations) {
            if (op.type === `insert` || op.type === `update`) {
              syncedInsertedOrUpdatedKeys.add(op.key as TKey)
            }
          }
        }

        // Build re-apply sets from ACTIVE optimistic transactions against the new synced base
        // We do not copy maps; we compute intent directly from transactions to avoid drift.
        const reapplyUpserts = new Map<TKey, TOutput>()
        const reapplyDeletes = new Set<TKey>()

        for (const tx of this.transactions.values()) {
          if ([`completed`, `failed`].includes(tx.state)) continue
          for (const mutation of tx.mutations) {
            if (mutation.collection !== this.collection || !mutation.optimistic)
              continue
            const key = mutation.key as TKey
            switch (mutation.type) {
              case `insert`:
                reapplyUpserts.set(key, mutation.modified as TOutput)
                reapplyDeletes.delete(key)
                break
              case `update`: {
                const base = this.syncedData.get(key)
                const next = base
                  ? (Object.assign({}, base, mutation.changes) as TOutput)
                  : (mutation.modified as TOutput)
                reapplyUpserts.set(key, next)
                reapplyDeletes.delete(key)
                break
              }
              case `delete`:
                reapplyUpserts.delete(key)
                reapplyDeletes.add(key)
                break
            }
          }
        }

        // Emit inserts for re-applied upserts, skipping any keys that have an optimistic delete.
        // If the server also inserted/updated the same key in this batch, override that value
        // with the optimistic value to preserve local intent.
        for (const [key, value] of reapplyUpserts) {
          if (reapplyDeletes.has(key)) continue
          if (syncedInsertedOrUpdatedKeys.has(key)) {
            let foundInsert = false
            for (let i = events.length - 1; i >= 0; i--) {
              const evt = events[i]!
              if (evt.key === key && evt.type === `insert`) {
                evt.value = value
                foundInsert = true
                break
              }
            }
            if (!foundInsert) {
              events.push({ type: `insert`, key, value })
            }
          } else {
            events.push({ type: `insert`, key, value })
          }
        }

        // Finally, ensure we do NOT insert keys that have an outstanding optimistic delete.
        if (events.length > 0 && reapplyDeletes.size > 0) {
          const filtered: Array<ChangeMessage<TOutput, TKey>> = []
          for (const evt of events) {
            if (evt.type === `insert` && reapplyDeletes.has(evt.key)) {
              continue
            }
            filtered.push(evt)
          }
          events.length = 0
          events.push(...filtered)
        }

        // Ensure listeners are active before emitting this critical batch
        if (!this.collection.isReady()) {
          this.collection._lifecycle.setStatus(`ready`)
        }
      }

      // Maintain optimistic state appropriately
      // Clear optimistic state since sync operations will now provide the authoritative data.
      // Any still-active user transactions will be re-applied below in recompute.
      this.optimisticUpserts.clear()
      this.optimisticDeletes.clear()

      // Reset flag and recompute optimistic state for any remaining active transactions
      this.isCommittingSyncTransactions = false
      for (const transaction of this.transactions.values()) {
        if (![`completed`, `failed`].includes(transaction.state)) {
          for (const mutation of transaction.mutations) {
            if (
              mutation.collection === this.collection &&
              mutation.optimistic
            ) {
              switch (mutation.type) {
                case `insert`:
                case `update`:
                  this.optimisticUpserts.set(
                    mutation.key,
                    mutation.modified as TOutput
                  )
                  this.optimisticDeletes.delete(mutation.key)
                  break
                case `delete`:
                  this.optimisticUpserts.delete(mutation.key)
                  this.optimisticDeletes.add(mutation.key)
                  break
              }
            }
          }
        }
      }

      // Check for redundant sync operations that match completed optimistic operations
      const completedOptimisticOps = new Map<TKey, any>()

      for (const transaction of this.transactions.values()) {
        if (transaction.state === `completed`) {
          for (const mutation of transaction.mutations) {
            if (
              mutation.collection === this.collection &&
              changedKeys.has(mutation.key)
            ) {
              completedOptimisticOps.set(mutation.key, {
                type: mutation.type,
                value: mutation.modified,
              })
            }
          }
        }
      }

      // Now check what actually changed in the final visible state
      for (const key of changedKeys) {
        const previousVisibleValue = currentVisibleState.get(key)
        const newVisibleValue = this.collection.get(key) // This returns the new derived state

        // Check if this sync operation is redundant with a completed optimistic operation
        const completedOp = completedOptimisticOps.get(key)
        const isRedundantSync =
          completedOp &&
          newVisibleValue !== undefined &&
          deepEquals(completedOp.value, newVisibleValue)

        if (!isRedundantSync) {
          if (
            previousVisibleValue === undefined &&
            newVisibleValue !== undefined
          ) {
            events.push({
              type: `insert`,
              key,
              value: newVisibleValue,
            })
          } else if (
            previousVisibleValue !== undefined &&
            newVisibleValue === undefined
          ) {
            events.push({
              type: `delete`,
              key,
              value: previousVisibleValue,
            })
          } else if (
            previousVisibleValue !== undefined &&
            newVisibleValue !== undefined &&
            !deepEquals(previousVisibleValue, newVisibleValue)
          ) {
            events.push({
              type: `update`,
              key,
              value: newVisibleValue,
              previousValue: previousVisibleValue,
            })
          }
        }
      }

      // Update cached size after synced data changes
      this.size = this.calculateSize()

      // Update indexes for all events before emitting
      if (events.length > 0) {
        this.collection._indexes.updateIndexes(events)
      }

      // End batching and emit all events (combines any batched events with sync events)
      this.collection._changes.emitEvents(events, true)

      this.pendingSyncedTransactions = uncommittedSyncedTransactions

      // Clear the pre-sync state since sync operations are complete
      this.preSyncVisibleState.clear()

      // Clear recently synced keys after a microtask to allow recomputeOptimisticState to see them
      Promise.resolve().then(() => {
        this.recentlySyncedKeys.clear()
      })

      // Call any registered one-time commit listeners
      if (!this.hasReceivedFirstCommit) {
        this.hasReceivedFirstCommit = true
        const callbacks = [...this.collection._lifecycle.onFirstReadyCallbacks]
        this.collection._lifecycle.onFirstReadyCallbacks = []
        callbacks.forEach((callback) => callback())
      }
    }
  }

  /**
   * Schedule cleanup of a transaction when it completes
   */
  public scheduleTransactionCleanup(transaction: Transaction<any>): void {
    // Only schedule cleanup for transactions that aren't already completed
    if (transaction.state === `completed`) {
      this.transactions.delete(transaction.id)
      return
    }

    // Schedule cleanup when the transaction completes
    transaction.isPersisted.promise
      .then(() => {
        // Transaction completed successfully, remove it immediately
        this.transactions.delete(transaction.id)
      })
      .catch(() => {
        // Transaction failed, but we want to keep failed transactions for reference
        // so don't remove it.
        // This empty catch block is necessary to prevent unhandled promise rejections.
      })
  }

  /**
   * Capture visible state for keys that will be affected by pending sync operations
   * This must be called BEFORE onTransactionStateChange clears optimistic state
   */
  public capturePreSyncVisibleState(): void {
    if (this.pendingSyncedTransactions.length === 0) return

    // Clear any previous capture
    this.preSyncVisibleState.clear()

    // Get all keys that will be affected by sync operations
    const syncedKeys = new Set<TKey>()
    for (const transaction of this.pendingSyncedTransactions) {
      for (const operation of transaction.operations) {
        syncedKeys.add(operation.key as TKey)
      }
    }

    // Mark keys as about to be synced to suppress intermediate events from recomputeOptimisticState
    for (const key of syncedKeys) {
      this.recentlySyncedKeys.add(key)
    }

    // Only capture current visible state for keys that will be affected by sync operations
    // This is much more efficient than capturing the entire collection state
    for (const key of syncedKeys) {
      const currentValue = this.collection.get(key)
      if (currentValue !== undefined) {
        this.preSyncVisibleState.set(key, currentValue)
      }
    }
  }

  /**
   * Trigger a recomputation when transactions change
   * This method should be called by the Transaction class when state changes
   */
  public onTransactionStateChange(): void {
    // Check if commitPendingTransactions will be called after this
    // by checking if there are pending sync transactions (same logic as in transactions.ts)
    this.collection._changes.shouldBatchEvents =
      this.pendingSyncedTransactions.length > 0

    // CRITICAL: Capture visible state BEFORE clearing optimistic state
    this.capturePreSyncVisibleState()

    this.recomputeOptimisticState(false)
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.syncedData.clear()
    this.syncedMetadata.clear()
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()
    this.size = 0
    this.pendingSyncedTransactions = []
    this.syncedKeys.clear()
    this.hasReceivedFirstCommit = false
  }
}
