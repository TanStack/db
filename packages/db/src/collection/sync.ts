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
import type { ChangeMessage, CollectionConfig } from "../types"
import type { CollectionImpl } from "./index.js"
import type { CollectionStateManager } from "./state"
import type { CollectionLifecycleManager } from "./lifecycle"

export class CollectionSyncManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private collection!: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private config!: CollectionConfig<TOutput, TKey, TSchema>
  private id: string

  public preloadPromise: Promise<void> | null = null
  public syncCleanupFn: (() => void) | null = null

  /**
   * Creates a new CollectionSyncManager instance
   */
  constructor(config: CollectionConfig<TOutput, TKey, TSchema>, id: string) {
    this.config = config
    this.id = id
  }

  setDeps(deps: {
    collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  }) {
    this.collection = deps.collection
    this.state = deps.state
    this.lifecycle = deps.lifecycle
  }

  /**
   * Start the sync process for this collection
   * This is called when the collection is first accessed or preloaded
   */
  public startSync(): void {
    const state = this.state
    if (
      this.lifecycle.status !== `idle` &&
      this.lifecycle.status !== `cleaned-up`
    ) {
      return // Already started or in progress
    }

    this.lifecycle.setStatus(`loading`)

    try {
      const cleanupFn = this.config.sync.sync({
        collection: this.collection,
        begin: () => {
          state.pendingSyncedTransactions.push({
            committed: false,
            operations: [],
            deletedKeys: new Set(),
          })
        },
        write: (messageWithoutKey: Omit<ChangeMessage<TOutput>, `key`>) => {
          const pendingTransaction =
            state.pendingSyncedTransactions[
              state.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedWriteError()
          }
          const key = this.config.getKey(messageWithoutKey.value)

          // Check if an item with this key already exists when inserting
          if (messageWithoutKey.type === `insert`) {
            const insertingIntoExistingSynced = state.syncedData.has(key)
            const hasPendingDeleteForKey =
              pendingTransaction.deletedKeys.has(key)
            const isTruncateTransaction = pendingTransaction.truncate === true
            // Allow insert after truncate in the same transaction even if it existed in syncedData
            if (
              insertingIntoExistingSynced &&
              !hasPendingDeleteForKey &&
              !isTruncateTransaction
            ) {
              throw new DuplicateKeySyncError(key, this.id)
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
            state.pendingSyncedTransactions[
              state.pendingSyncedTransactions.length - 1
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
          if (this.lifecycle.status === `loading`) {
            this.lifecycle.setStatus(`initialCommit`)
          }

          state.commitPendingTransactions()
        },
        markReady: () => {
          this.lifecycle.markReady()
        },
        truncate: () => {
          const pendingTransaction =
            state.pendingSyncedTransactions[
              state.pendingSyncedTransactions.length - 1
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
      this.lifecycle.setStatus(`error`)
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
      if (this.lifecycle.status === `ready`) {
        resolve()
        return
      }

      if (this.lifecycle.status === `error`) {
        reject(new CollectionIsInErrorStateError())
        return
      }

      // Register callback BEFORE starting sync to avoid race condition
      this.lifecycle.onFirstReady(() => {
        resolve()
      })

      // Start sync if collection hasn't started yet or was cleaned up
      if (
        this.lifecycle.status === `idle` ||
        this.lifecycle.status === `cleaned-up`
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
          const wrappedError = new SyncCleanupError(this.id, error)
          wrappedError.cause = error
          wrappedError.stack = error.stack
          throw wrappedError
        } else {
          throw new SyncCleanupError(this.id, error as Error | string)
        }
      })
    }
    this.preloadPromise = null
  }
}
