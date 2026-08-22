import {
  CollectionConfigurationError,
  CollectionIsInErrorStateError,
  DuplicateKeySyncError,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SyncCleanupError,
  SyncTransactionAlreadyCommittedError,
  SyncTransactionAlreadyCommittedWriteError,
} from '../errors'
import { createDeferred } from '../deferred'
import { deepEquals } from '../utils'
import { LIVE_QUERY_INTERNAL } from '../query/live/internal.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ChangeMessageOrDeleteKeyMessage,
  CleanupFn,
  CollectionConfig,
  LoadSubsetOptions,
  OptimisticChangeMessage,
  SyncConfigRes,
  SyncMetadataApi,
} from '../types'
import type { CollectionImpl } from './index.js'
import type { CollectionStateManager } from './state'
import type { CollectionLifecycleManager } from './lifecycle'
import type { CollectionEventsManager } from './events.js'
import type { LiveQueryCollectionUtils } from '../query/live/collection-config-builder.js'
import type { Deferred } from '../deferred'

type DeferredLoadSubset = {
  options: LoadSubsetOptions
  deferred: Deferred<void>
}

type LoadSubsetOperation = {
  pending: Set<Promise<void>>
  waiting: boolean
  completed: boolean
  hasError: boolean
  error?: unknown
  deferred?: Deferred<void>
}

export class CollectionSyncManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private collection!: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private _events!: CollectionEventsManager
  private config!: CollectionConfig<TOutput, TKey, TSchema>
  private id: string
  private syncMode: `eager` | `on-demand`

  public preloadPromise: Promise<void> | null = null
  public syncCleanupFn: (() => void) | null = null
  public syncLoadSubsetFn:
    | ((options: LoadSubsetOptions) => true | Promise<void>)
    | null = null
  public syncUnloadSubsetFn: ((options: LoadSubsetOptions) => void) | null =
    null

  private pendingLoadSubsetPromises: Set<Promise<void>> = new Set()
  private activeLoadSubsetOperation: LoadSubsetOperation | undefined
  private syncStartDeferred = false
  private syncStartRequested = false
  private deferredLoadSubsets: Array<DeferredLoadSubset> = []
  private syncEpoch = 0
  private loadSubsetSession = 0

  /**
   * Creates a new CollectionSyncManager instance
   */
  constructor(config: CollectionConfig<TOutput, TKey, TSchema>, id: string) {
    this.config = config
    this.id = id
    this.syncMode = config.syncMode ?? `eager`
  }

  setDeps(deps: {
    collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    events: CollectionEventsManager
  }) {
    this.collection = deps.collection
    this.state = deps.state
    this.lifecycle = deps.lifecycle
    this._events = deps.events
  }

  /** Mark the active sync transaction as changing collection layout. */
  public markLayoutChange(): void {
    this.getActivePendingSyncTransaction().layoutChanged = true
  }

  /**
   * Start the sync process for this collection
   * This is called when the collection is first accessed or preloaded
   */
  public startSync(): void {
    if (
      this.lifecycle.status !== `idle` &&
      this.lifecycle.status !== `cleaned-up`
    ) {
      return // Already started or in progress
    }

    if (this.syncStartDeferred) {
      this.syncStartRequested = true
      return
    }

    const syncEpoch = ++this.syncEpoch
    const isCurrentSync = () => syncEpoch === this.syncEpoch
    this.lifecycle.setStatus(`loading`)

    try {
      const syncRes = normalizeSyncFnResult(
        this.config.sync.sync({
          collection: this.collection,
          begin: (options?: { immediate?: boolean }) => {
            if (!isCurrentSync()) return
            this.state.pendingSyncedTransactions.push({
              committed: false,
              layoutChanged: false,
              operations: [],
              deletedKeys: new Set(),
              rowMetadataWrites: new Map(),
              collectionMetadataWrites: new Map(),
              immediate: options?.immediate,
            })
          },
          write: (
            messageWithOptionalKey: ChangeMessageOrDeleteKeyMessage<
              TOutput,
              TKey
            >,
          ) => {
            if (!isCurrentSync()) return
            const pendingTransaction =
              this.state.pendingSyncedTransactions[
                this.state.pendingSyncedTransactions.length - 1
              ]
            if (!pendingTransaction) {
              throw new NoPendingSyncTransactionWriteError()
            }
            if (pendingTransaction.committed) {
              throw new SyncTransactionAlreadyCommittedWriteError()
            }

            let key: TKey | undefined = undefined
            if (`key` in messageWithOptionalKey) {
              key = messageWithOptionalKey.key
            } else {
              key = this.config.getKey(messageWithOptionalKey.value)
            }

            if (this.state.pendingLocalChanges.has(key)) {
              this.state.pendingLocalOrigins.add(key)
            }

            let messageType = messageWithOptionalKey.type

            // Check if an item with this key already exists when inserting
            if (messageWithOptionalKey.type === `insert`) {
              const insertingIntoExistingSynced = this.state.syncedData.has(key)
              const hasPendingDeleteForKey =
                pendingTransaction.deletedKeys.has(key)
              const isTruncateTransaction = pendingTransaction.truncate === true
              // Allow insert after truncate in the same transaction even if it existed in syncedData
              if (
                insertingIntoExistingSynced &&
                !hasPendingDeleteForKey &&
                !isTruncateTransaction
              ) {
                const existingValue = this.state.syncedData.get(key)
                const valuesEqual =
                  existingValue !== undefined &&
                  deepEquals(existingValue, messageWithOptionalKey.value)
                if (valuesEqual || this.state.hydrationSeedKeys.has(key)) {
                  // The "insert" is an echo of a value we already have locally.
                  // Hydration and initialData are also provisional base state, so
                  // accept the adapter's first authoritative value as an update
                  // using the configured rowUpdateMode semantics.
                  messageType = `update`
                } else {
                  const utils = this.config.utils as
                    | Partial<LiveQueryCollectionUtils>
                    | undefined
                  const internal = utils?.[LIVE_QUERY_INTERNAL]
                  throw new DuplicateKeySyncError(key, this.id, {
                    hasCustomGetKey: internal?.hasCustomGetKey ?? false,
                    hasJoins: internal?.hasJoins ?? false,
                    hasDistinct: internal?.hasDistinct ?? false,
                  })
                }
              }
            }

            const message = {
              ...messageWithOptionalKey,
              type: messageType,
              key,
            } as OptimisticChangeMessage<TOutput, TKey>
            pendingTransaction.operations.push(message)

            if (messageType === `delete`) {
              pendingTransaction.deletedKeys.add(key)
              pendingTransaction.rowMetadataWrites.set(key, { type: `delete` })
            } else if (messageType === `insert`) {
              if (message.metadata !== undefined) {
                pendingTransaction.rowMetadataWrites.set(key, {
                  type: `set`,
                  value: message.metadata,
                })
              } else {
                pendingTransaction.rowMetadataWrites.set(key, {
                  type: `delete`,
                })
              }
            } else if (message.metadata !== undefined) {
              pendingTransaction.rowMetadataWrites.set(key, {
                type: `set`,
                value: message.metadata,
              })
            }
          },
          commit: () => {
            if (!isCurrentSync()) return
            const pendingTransaction =
              this.state.pendingSyncedTransactions[
                this.state.pendingSyncedTransactions.length - 1
              ]
            if (!pendingTransaction) {
              throw new NoPendingSyncTransactionCommitError()
            }
            if (pendingTransaction.committed) {
              throw new SyncTransactionAlreadyCommittedError()
            }

            pendingTransaction.committed = true

            this.state.commitPendingTransactions()
          },
          markReady: () => {
            if (isCurrentSync()) this.lifecycle.markReady()
          },
          markError: (error?: unknown) => {
            if (isCurrentSync()) this.lifecycle.markError(error)
          },
          truncate: () => {
            if (!isCurrentSync()) return
            const pendingTransaction =
              this.state.pendingSyncedTransactions[
                this.state.pendingSyncedTransactions.length - 1
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
            pendingTransaction.rowMetadataWrites.clear()
            // Intentionally preserve collectionMetadataWrites across truncate.
            // Collection-scoped metadata (for example persisted resume/reset
            // state) can be staged before truncate and should commit atomically
            // with the truncate transaction.

            // Mark the transaction as a truncate operation. During commit, this triggers:
            // - Delete events for all previously synced keys (excluding optimistic-deleted keys)
            // - Clearing of syncedData/syncedMetadata
            // - Subsequent synced ops applied on the fresh base
            // - Finally, optimistic mutations re-applied on top (single batch)
            pendingTransaction.truncate = true

            // Capture optimistic state NOW to preserve it even if transactions complete
            // before this truncate transaction is committed
            pendingTransaction.optimisticSnapshot = {
              upserts: new Map(this.state.optimisticUpserts),
              deletes: new Set(this.state.optimisticDeletes),
            }
          },
          metadata: this.createSyncMetadataApi(isCurrentSync),
        }),
      )

      // Store cleanup function if provided
      this.syncCleanupFn = syncRes?.cleanup ?? null

      // Store loadSubset function if provided
      this.syncLoadSubsetFn = syncRes?.loadSubset ?? null

      // Store unloadSubset function if provided
      this.syncUnloadSubsetFn = syncRes?.unloadSubset ?? null

      // Validate: on-demand mode requires a loadSubset function
      if (this.syncMode === `on-demand` && !this.syncLoadSubsetFn) {
        throw new CollectionConfigurationError(
          `Collection "${this.id}" is configured with syncMode "on-demand" but the sync function did not return a loadSubset handler. ` +
            `Either provide a loadSubset handler or use syncMode "eager".`,
        )
      }
    } catch (error) {
      this.lifecycle.markError(error)
      throw error
    }
  }

  public deferStart(): boolean {
    if (
      this.lifecycle.status !== `idle` &&
      this.lifecycle.status !== `cleaned-up`
    ) {
      return false
    }

    this.syncStartDeferred = true
    return true
  }

  public resumeStart(): void {
    if (!this.syncStartDeferred) {
      return
    }

    this.syncStartDeferred = false
    const shouldStart =
      this.syncStartRequested || this.deferredLoadSubsets.length > 0
    this.syncStartRequested = false
    const deferredLoadSubsets = this.deferredLoadSubsets
    this.deferredLoadSubsets = []

    try {
      if (shouldStart) {
        this.startSync()
      }
    } catch (error) {
      for (const { deferred } of deferredLoadSubsets) {
        deferred.reject(error)
      }
      throw error
    }

    for (const { options, deferred } of deferredLoadSubsets) {
      try {
        const result = this.syncLoadSubsetFn?.(options) ?? true
        if (result instanceof Promise) {
          void result.then(
            () => deferred.resolve(undefined),
            (error: unknown) => deferred.reject(error),
          )
        } else {
          deferred.resolve(undefined)
        }
      } catch (error) {
        deferred.reject(error)
      }
    }
  }

  private getActivePendingSyncTransaction() {
    const pendingTransaction =
      this.state.pendingSyncedTransactions[
        this.state.pendingSyncedTransactions.length - 1
      ]

    if (!pendingTransaction) {
      throw new NoPendingSyncTransactionWriteError()
    }
    if (pendingTransaction.committed) {
      throw new SyncTransactionAlreadyCommittedWriteError()
    }

    return pendingTransaction
  }

  private createSyncMetadataApi(
    isCurrentSync: () => boolean,
  ): SyncMetadataApi<TKey> {
    return {
      row: {
        get: (key) => {
          if (!isCurrentSync()) return undefined
          const pendingTransaction =
            this.state.pendingSyncedTransactions[
              this.state.pendingSyncedTransactions.length - 1
            ]
          const pendingWrite = pendingTransaction?.rowMetadataWrites.get(key)
          if (pendingWrite) {
            return pendingWrite.type === `delete`
              ? undefined
              : pendingWrite.value
          }
          if (pendingTransaction?.truncate) {
            return undefined
          }
          return this.state.syncedMetadata.get(key)
        },
        set: (key, metadata) => {
          if (!isCurrentSync()) return
          const pendingTransaction = this.getActivePendingSyncTransaction()
          pendingTransaction.rowMetadataWrites.set(key, {
            type: `set`,
            value: metadata,
          })
        },
        delete: (key) => {
          if (!isCurrentSync()) return
          const pendingTransaction = this.getActivePendingSyncTransaction()
          pendingTransaction.rowMetadataWrites.set(key, {
            type: `delete`,
          })
        },
      },
      collection: {
        get: (key) => {
          if (!isCurrentSync()) return undefined
          const pendingTransaction =
            this.state.pendingSyncedTransactions[
              this.state.pendingSyncedTransactions.length - 1
            ]
          const pendingWrite =
            pendingTransaction?.collectionMetadataWrites.get(key)
          if (pendingWrite) {
            return pendingWrite.type === `delete`
              ? undefined
              : pendingWrite.value
          }
          return this.state.syncedCollectionMetadata.get(key)
        },
        set: (key, value) => {
          if (!isCurrentSync()) return
          const pendingTransaction = this.getActivePendingSyncTransaction()
          pendingTransaction.collectionMetadataWrites.set(key, {
            type: `set`,
            value,
          })
        },
        delete: (key) => {
          if (!isCurrentSync()) return
          const pendingTransaction = this.getActivePendingSyncTransaction()
          pendingTransaction.collectionMetadataWrites.set(key, {
            type: `delete`,
          })
        },
        list: (prefix) => {
          if (!isCurrentSync()) return []
          const merged = new Map(this.state.syncedCollectionMetadata)
          const pendingTransaction =
            this.state.pendingSyncedTransactions[
              this.state.pendingSyncedTransactions.length - 1
            ]
          if (pendingTransaction) {
            for (const [
              key,
              pendingWrite,
            ] of pendingTransaction.collectionMetadataWrites) {
              if (pendingWrite.type === `delete`) {
                merged.delete(key)
              } else {
                merged.set(key, pendingWrite.value)
              }
            }
          }

          return Array.from(merged.entries())
            .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
            .map(([key, value]) => ({
              key,
              value,
            }))
        },
      },
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

    // Warn when calling preload on an on-demand collection
    if (this.syncMode === `on-demand`) {
      console.warn(
        `${this.id ? `[${this.id}] ` : ``}Calling .preload() on a collection with syncMode "on-demand" is a no-op. ` +
          `In on-demand mode, data is only loaded when queries request it. ` +
          `Instead, create a live query and call .preload() on that to load the specific data you need. ` +
          `See https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync for more details.`,
      )
    }

    const attempt = new Promise<void>((resolve, reject) => {
      if (this.lifecycle.status === `ready`) {
        resolve()
        return
      }

      if (this.lifecycle.status === `error`) {
        reject(this.getPreloadError())
        return
      }

      let settled = false
      let startingSync = false
      let unsubscribeError = () => {}
      let unsubscribeReady = () => {}
      const resolveReady = () => {
        if (settled) return
        settled = true
        unsubscribeError()
        unsubscribeReady()
        resolve()
      }
      const rejectError = (error: unknown) => {
        if (settled) return
        settled = true
        unsubscribeError()
        unsubscribeReady()
        reject(error)
      }

      // Register callback BEFORE starting sync to avoid race condition
      unsubscribeReady = this.lifecycle.onFirstReady(resolveReady)
      unsubscribeError = this.collection.on(`status:error`, () => {
        if (startingSync) {
          return
        }
        rejectError(this.getPreloadError())
      })

      // Start sync if collection hasn't started yet or was cleaned up
      if (
        this.lifecycle.status === `idle` ||
        this.lifecycle.status === `cleaned-up`
      ) {
        startingSync = true
        try {
          this.startSync()
        } catch (error) {
          rejectError(error)
          return
        } finally {
          startingSync = false
        }
        if (this.collection.status === `error`) {
          rejectError(this.getPreloadError())
        }
      }
    })

    this.preloadPromise = attempt
    void attempt.then(undefined, () => {
      if (this.preloadPromise === attempt) {
        this.preloadPromise = null
      }
    })
    return attempt
  }

  private getPreloadError(): unknown {
    const syncError = this.lifecycle.getSyncError()
    return syncError === undefined
      ? new CollectionIsInErrorStateError()
      : syncError
  }

  /**
   * Gets whether the collection is currently loading more data
   */
  public get isLoadingSubset(): boolean {
    return this.pendingLoadSubsetPromises.size > 0
  }

  /** Wait for the subset loads that are active during the current operation. */
  public waitForCurrentLoadSubset(): true | Promise<void> {
    if (this.pendingLoadSubsetPromises.size === 0) return true
    return this.waitForPendingLoadSubset()
  }

  /** @internal Observe subset requests caused by one imperative operation. */
  public beginLoadSubsetOperation(): {
    wait: () => true | Promise<void>
    cancel: () => void
  } {
    const operation: LoadSubsetOperation = {
      pending: new Set(),
      waiting: false,
      completed: false,
      hasError: false,
    }
    // A new imperative operation owns future requests. Older operations keep
    // waiting for the promises they already acquired, but cannot absorb work
    // caused by a superseding physical window.
    this.activeLoadSubsetOperation = operation
    return {
      wait: () => this.waitForLoadSubsetOperation(operation),
      cancel: () => {
        operation.completed = true
        if (this.activeLoadSubsetOperation === operation) {
          this.activeLoadSubsetOperation = undefined
        }
      },
    }
  }

  private waitForLoadSubsetOperation(
    operation: LoadSubsetOperation,
  ): true | Promise<void> {
    operation.waiting = true
    if (operation.pending.size === 0) {
      operation.completed = true
      if (this.activeLoadSubsetOperation === operation) {
        this.activeLoadSubsetOperation = undefined
      }
      return operation.hasError ? Promise.reject(operation.error) : true
    }
    operation.deferred = createDeferred<void>()
    return operation.deferred.promise
  }

  private settleLoadSubsetOperation(
    operation: LoadSubsetOperation,
    promise: Promise<void>,
    outcome: { ok: true } | { ok: false; error: unknown },
  ): void {
    if (operation.completed) return
    operation.pending.delete(promise)
    if (!outcome.ok && !operation.hasError) {
      operation.hasError = true
      operation.error = outcome.error
    }
    if (!operation.waiting || operation.pending.size > 0) return

    // A resolved request can synchronously publish source rows that register
    // follow-up loads. Let those registrations join this operation before it
    // is considered complete.
    queueMicrotask(() => {
      if (operation.completed || operation.pending.size > 0) return
      operation.completed = true
      if (this.activeLoadSubsetOperation === operation) {
        this.activeLoadSubsetOperation = undefined
      }
      if (operation.hasError) {
        operation.deferred!.reject(operation.error)
      } else {
        operation.deferred!.resolve()
      }
    })
  }

  /** @internal Attach a relevant existing request to the active operation. */
  public trackLoadSubsetOperationPromise(promise: Promise<void>): void {
    const operation = this.activeLoadSubsetOperation
    if (!operation || operation.pending.has(promise)) return

    operation.pending.add(promise)
    void promise.then(
      () => this.settleLoadSubsetOperation(operation, promise, { ok: true }),
      (error) =>
        this.settleLoadSubsetOperation(operation, promise, {
          ok: false,
          error,
        }),
    )
  }

  private async waitForPendingLoadSubset(): Promise<void> {
    do {
      await Promise.all([...this.pendingLoadSubsetPromises])
    } while (this.pendingLoadSubsetPromises.size > 0)
  }

  /**
   * Tracks a load promise for isLoadingSubset state.
   * @internal This is for internal coordination (e.g., live-query glue code), not for general use.
   */
  public trackLoadPromise(promise: Promise<void>): void {
    const loadSubsetSession = this.loadSubsetSession
    const loadingStarting = !this.isLoadingSubset
    this.pendingLoadSubsetPromises.add(promise)
    this.trackLoadSubsetOperationPromise(promise)

    if (loadingStarting) {
      this._events.emit(`loadingSubset:change`, {
        type: `loadingSubset:change`,
        collection: this.collection,
        isLoadingSubset: true,
        previousIsLoadingSubset: false,
        loadingSubsetTransition: `start`,
      })
    }

    const finish = () => {
      if (loadSubsetSession !== this.loadSubsetSession) return

      const loadingEnding =
        this.pendingLoadSubsetPromises.size === 1 &&
        this.pendingLoadSubsetPromises.has(promise)
      this.pendingLoadSubsetPromises.delete(promise)

      if (loadingEnding) {
        this._events.emit(`loadingSubset:change`, {
          type: `loadingSubset:change`,
          collection: this.collection,
          isLoadingSubset: false,
          previousIsLoadingSubset: true,
          loadingSubsetTransition: `end`,
        })
      }
    }
    void promise.then(finish, finish)
  }

  /**
   * Requests the sync layer to load more data.
   * @param options Options to control what data is being loaded
   * @returns If data loading is asynchronous, this method returns a promise that resolves when the data is loaded.
   *          Returns true if no sync function is configured, if syncMode is 'eager', or if there is no work to do.
   */
  public loadSubset(options: LoadSubsetOptions): Promise<void> | true {
    if (options.signal?.aborted) {
      return true
    }

    // Bypass loadSubset when syncMode is 'eager'
    if (this.syncMode === `eager`) {
      return true
    }

    if (this.syncStartDeferred) {
      this.syncStartRequested = true
      const deferred = createDeferred<void>()
      this.deferredLoadSubsets.push({ options, deferred })
      this.trackLoadPromise(deferred.promise)
      return deferred.promise
    }

    if (this.syncLoadSubsetFn) {
      const result = this.syncLoadSubsetFn(options)
      // If the result is a promise, track it
      if (result instanceof Promise) {
        this.trackLoadPromise(result)
        return result
      }
    }

    return true
  }

  /**
   * Notifies the sync layer that a subset is no longer needed.
   * @param options Options that identify what data is being unloaded
   */
  public unloadSubset(options: LoadSubsetOptions): void {
    if (this.syncStartDeferred) {
      this.deferredLoadSubsets = this.deferredLoadSubsets.filter((request) => {
        if (request.options !== options) {
          return true
        }

        request.deferred.resolve(undefined)
        return false
      })
      return
    }

    if (this.syncUnloadSubsetFn) {
      this.syncUnloadSubsetFn(options)
    }
  }

  public cleanup(): void {
    // Invalidate callbacks retained by asynchronous work from this session
    // before invoking adapter cleanup or allowing a new session to start.
    this.syncEpoch++
    this.loadSubsetSession++
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
    this.syncLoadSubsetFn = null
    this.syncUnloadSubsetFn = null
    this.syncStartDeferred = false
    this.syncStartRequested = false
    const wasLoadingSubset = this.pendingLoadSubsetPromises.size > 0
    this.pendingLoadSubsetPromises.clear()
    if (wasLoadingSubset) {
      this._events.emit(`loadingSubset:change`, {
        type: `loadingSubset:change`,
        collection: this.collection,
        isLoadingSubset: false,
        previousIsLoadingSubset: true,
        loadingSubsetTransition: `end`,
      })
    }
    const activeOperation = this.activeLoadSubsetOperation
    this.activeLoadSubsetOperation = undefined
    if (activeOperation && !activeOperation.completed) {
      activeOperation.completed = true
      activeOperation.pending.clear()
      activeOperation.deferred?.resolve()
    }
    const deferredLoadSubsets = this.deferredLoadSubsets
    this.deferredLoadSubsets = []
    for (const { deferred } of deferredLoadSubsets) {
      deferred.resolve(undefined)
    }
  }
}

function normalizeSyncFnResult(result: void | CleanupFn | SyncConfigRes) {
  if (typeof result === `function`) {
    return { cleanup: result }
  }

  if (typeof result === `object`) {
    return result
  }

  return undefined
}
