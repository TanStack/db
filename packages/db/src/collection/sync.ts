import {
  CollectionIsInErrorStateError,
  DuplicateKeySyncError,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SyncCleanupError,
  SyncTransactionAlreadyCommittedError,
  SyncTransactionAlreadyCommittedWriteError,
} from "../errors"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { ChangeMessage } from "../types"
import type { CollectionImpl } from "./index.js"

export class CollectionSyncManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  public preloadPromise: Promise<void> | null = null
  public syncCleanupFn: (() => void) | null = null

  /**
   * Creates a new CollectionSyncManager instance
   */
  constructor(
    public collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  ) {}

  /**
   * Start the sync process for this collection
   * This is called when the collection is first accessed or preloaded
   */
  public startSync(): void {
    const _state = this.collection._state
    if (
      this.collection.status !== `idle` &&
      this.collection.status !== `cleaned-up`
    ) {
      return // Already started or in progress
    }

    this.collection._lifecycle.setStatus(`loading`)

    try {
      const cleanupFn = this.collection.config.sync.sync({
        collection: this.collection,
        begin: () => {
          _state.pendingSyncedTransactions.push({
            committed: false,
            operations: [],
            deletedKeys: new Set(),
          })
        },
        write: (messageWithoutKey: Omit<ChangeMessage<TOutput>, `key`>) => {
          const pendingTransaction =
            _state.pendingSyncedTransactions[
              _state.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedWriteError()
          }
          const key = this.collection.getKeyFromItem(messageWithoutKey.value)

          // Check if an item with this key already exists when inserting
          if (messageWithoutKey.type === `insert`) {
            const insertingIntoExistingSynced = _state.syncedData.has(key)
            const hasPendingDeleteForKey =
              pendingTransaction.deletedKeys.has(key)
            const isTruncateTransaction = pendingTransaction.truncate === true
            // Allow insert after truncate in the same transaction even if it existed in syncedData
            if (
              insertingIntoExistingSynced &&
              !hasPendingDeleteForKey &&
              !isTruncateTransaction
            ) {
              throw new DuplicateKeySyncError(key, this.collection.id)
            }
          }

          const message: ChangeMessage<TOutput> = {
            ...messageWithoutKey,
            key,
          }
          pendingTransaction.operations.push(message)

          if (messageWithoutKey.type === `delete`) {
            pendingTransaction.deletedKeys.add(key)
          }
        },
        commit: () => {
          const pendingTransaction =
            _state.pendingSyncedTransactions[
              _state.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionCommitError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedError()
          }

          pendingTransaction.committed = true

          // Update status to initialCommit when transitioning from loading
          // This indicates we're in the process of committing the first transaction
          if (this.collection.status === `loading`) {
            this.collection._lifecycle.setStatus(`initialCommit`)
          }

          _state.commitPendingTransactions()
        },
        markReady: () => {
          this.collection._lifecycle.markReady()
        },
        truncate: () => {
          const pendingTransaction =
            _state.pendingSyncedTransactions[
              _state.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedWriteError()
          }

          // Clear all operations from the current transaction
          pendingTransaction.operations = []
          pendingTransaction.deletedKeys.clear()

          // Mark the transaction as a truncate operation. During commit, this triggers:
          // - Delete events for all previously synced keys (excluding optimistic-deleted keys)
          // - Clearing of syncedData/syncedMetadata
          // - Subsequent synced ops applied on the fresh base
          // - Finally, optimistic mutations re-applied on top (single batch)
          pendingTransaction.truncate = true
        },
      })

      // Store cleanup function if provided
      this.syncCleanupFn = typeof cleanupFn === `function` ? cleanupFn : null
    } catch (error) {
      this.collection._lifecycle.setStatus(`error`)
      throw error
    }
  }

  /**
   * Preload the collection data by starting sync if not already started
   * Multiple concurrent calls will share the same promise
   */
  public preload(): Promise<void> {
    if (this.preloadPromise) {
      return this.preloadPromise
    }

    this.preloadPromise = new Promise<void>((resolve, reject) => {
      if (this.collection.status === `ready`) {
        resolve()
        return
      }

      if (this.collection.status === `error`) {
        reject(new CollectionIsInErrorStateError())
        return
      }

      // Register callback BEFORE starting sync to avoid race condition
      this.collection.onFirstReady(() => {
        resolve()
      })

      // Start sync if collection hasn't started yet or was cleaned up
      if (
        this.collection.status === `idle` ||
        this.collection.status === `cleaned-up`
      ) {
        try {
          this.startSync()
        } catch (error) {
          reject(error)
          return
        }
      }
    })

    return this.preloadPromise
  }

  public cleanup(): void {
    try {
      if (this.syncCleanupFn) {
        this.syncCleanupFn()
        this.syncCleanupFn = null
      }
    } catch (error) {
      // Re-throw in a microtask to surface the error after cleanup completes
      queueMicrotask(() => {
        if (error instanceof Error) {
          // Preserve the original error and stack trace
          const wrappedError = new SyncCleanupError(this.collection.id, error)
          wrappedError.cause = error
          wrappedError.stack = error.stack
          throw wrappedError
        } else {
          throw new SyncCleanupError(
            this.collection.id,
            error as Error | string
          )
        }
      })
    }
    this.preloadPromise = null
  }
}
