import {
  CollectionConfigurationError,
  CollectionIsInErrorStateError,
  CollectionPreloadAbortedError,
  DuplicateKeySyncError,
  LoadSubsetOperationAbortedError,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SyncCleanupError,
  SyncTransactionAlreadyCommittedError,
  SyncTransactionAlreadyCommittedWriteError,
} from '../errors'
import { createDeferred } from '../deferred'
import { deepEquals } from '../utils'
import { isPromiseLike } from '../utils/type-guards'
import { LIVE_QUERY_INTERNAL } from '../query/live/internal.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ChangeMessageOrDeleteKeyMessage,
  CleanupFn,
  CollectionConfig,
  LoadSubsetFn,
  LoadSubsetOptions,
  LoadSubsetRequestResult,
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
  pending: Set<Promise<unknown>>
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
  private config!: CollectionConfig<TOutput, TKey, TSchema, any>
  private id: string
  private syncMode: `eager` | `on-demand`

  public preloadPromise: Promise<void> | null = null
  private rejectPreload?: (error: unknown) => void
  public syncCleanupFn: CleanupFn | null = null
  public syncLoadSubsetFn: LoadSubsetFn | null = null
  public syncUnloadSubsetFn: ((options: LoadSubsetOptions) => void) | null =
    null

  private pendingLoadSubsetPromises: Set<Promise<unknown>> = new Set()
  private activeLoadSubsetOperation: LoadSubsetOperation | undefined
  private loadSubsetOperations = new Set<LoadSubsetOperation>()
  private syncStartDeferred = false
  private syncStartRequested = false
  private deferredLoadSubsets: Array<DeferredLoadSubset> = []
  // Fences callbacks retained across reentrant sync entry and cleanup. This
  // changes at both boundaries; syncRunGeneration changes only at cleanup.
  private syncCallbackEpoch = 0
  private syncRunGeneration = 0
  private syncEntryActive = false
  private pendingSyncEntryCleanup:
    | {
        tasks: Array<Promise<void>>
        failure?: { error: unknown }
        onSettled?: (failure?: { error: unknown }) => void
        completion?: Deferred<void>
      }
    | undefined

  /**
   * Creates a new CollectionSyncManager instance
   */
  constructor(
    config: CollectionConfig<TOutput, TKey, TSchema, any>,
    id: string,
  ) {
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
    this.lifecycle.assertCanStartSync()
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

    const syncCallbackEpoch = ++this.syncCallbackEpoch
    const isCurrentSync = () => syncCallbackEpoch === this.syncCallbackEpoch
    this.lifecycle.setStatus(`loading`)
    if (!isCurrentSync()) return
    let syncEntryActive = true
    let readyEffectFailure: { error: unknown } | undefined

    this.syncEntryActive = true
    try {
      const syncRes = normalizeSyncFnResult(
        this.config.sync.sync({
          collection: this.collection,
          begin: (options?: { immediate?: boolean }) => {
            if (!isCurrentSync()) return
            const applied = createDeferred<void>()
            // A source may ignore a stream receipt. Keep cancellation from
            // becoming an unhandled rejection while preserving the original
            // promise's rejection for callers that do await it.
            void applied.promise.catch(() => undefined)
            this.state.pendingSyncedTransactions.push({
              committed: false,
              applicationStarted: false,
              layoutChanged: false,
              operations: [],
              deletedKeys: new Set(),
              rowMetadataWrites: new Map(),
              collectionMetadataWrites: new Map(),
              immediate: options?.immediate,
              applied,
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
          commit: (signal?: AbortSignal) => {
            if (!isCurrentSync()) return true
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

            if (signal?.aborted) {
              this.state.cancelPendingSyncedTransaction(pendingTransaction)
              return pendingTransaction.applied.promise
            }

            pendingTransaction.committed = true

            const cancel = () => {
              this.state.cancelPendingSyncedTransaction(pendingTransaction)
            }
            signal?.addEventListener(`abort`, cancel, { once: true })

            this.state.commitPendingTransactions()
            if (!pendingTransaction.applied.isPending()) {
              signal?.removeEventListener(`abort`, cancel)
              return true
            }

            const receipt = pendingTransaction.applied.promise
            if (signal) {
              const removeAbortListener = () => {
                signal.removeEventListener(`abort`, cancel)
              }
              void receipt.then(removeAbortListener, removeAbortListener)
            }
            return receipt
          },
          markReady: () => {
            if (!isCurrentSync()) return
            if (syncEntryActive) {
              readyEffectFailure ??= this.lifecycle.markReadyDuringSyncStart()
            } else {
              this.lifecycle.markReady()
            }
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

            pendingTransaction.optimisticSnapshot =
              this.state.captureTruncateOptimisticSnapshot()
          },
          metadata: this.createSyncMetadataApi(isCurrentSync),
        }),
      )
      this.syncEntryActive = false
      syncEntryActive = false

      if (!isCurrentSync()) {
        if (syncRes?.cleanup) {
          this.registerPendingSyncEntryCleanup(syncRes.cleanup)
        }
        this.completePendingSyncEntryCleanup()
        if (readyEffectFailure) throw readyEffectFailure.error
        return
      }

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

      // Every route into sync passes through here, so it is the one place
      // that sees sync start ahead of the subscriber that would justify it.
      // `addSubscriber` counts itself in before calling us, so a subscription
      // starting sync leaves the timer alone.
      this.lifecycle.startGCTimerIfUnsubscribed()
    } catch (error) {
      this.syncEntryActive = false
      this.completePendingSyncEntryCleanup()
      syncEntryActive = false
      if (isCurrentSync()) this.lifecycle.markError(error)
      throw error
    }
    if (readyEffectFailure) throw readyEffectFailure.error
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
    const syncRunGeneration = this.syncRunGeneration

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
      const loadSubset = this.syncLoadSubsetFn
      try {
        if (
          syncRunGeneration !== this.syncRunGeneration ||
          options.signal?.aborted
        ) {
          throw new LoadSubsetOperationAbortedError()
        }
        const result = loadSubset?.(options) ?? true
        if (result instanceof Promise) {
          void result.then(
            (sourceResult) => deferred.resolve(sourceResult),
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
      persistence: null,
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

  /** Whether a caller is still waiting for the initial sync to finish. */
  public get hasPendingPreload(): boolean {
    return this.rejectPreload !== undefined
  }

  /**
   * Preload the collection data by starting sync if not already started
   * Multiple concurrent calls will share the same promise
   */
  public preload(): Promise<void> {
    try {
      this.lifecycle.assertCanStartSync()
    } catch (error) {
      return Promise.reject(error)
    }
    // Warm preloads need the same handoff time as a load that just finished,
    // including when the previous GC deadline already queued idle cleanup.
    if (this.lifecycle.status === `ready`) {
      this.lifecycle.cancelGCTimer()
      this.lifecycle.startGCTimerIfUnsubscribed()
    }
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
      const syncStartState = { active: false, ready: false }
      let unsubscribeError = () => {}
      let unsubscribeReady = () => {}
      const finishPreload = () => {
        settled = true
        unsubscribeError()
        unsubscribeReady()
        if (this.rejectPreload === rejectError) this.rejectPreload = undefined
        this.lifecycle.startGCTimerIfUnsubscribed()
      }
      const resolveReady = () => {
        if (syncStartState.active) {
          syncStartState.ready = true
          return
        }
        if (settled) return
        finishPreload()
        resolve()
      }
      const rejectError = (error: unknown) => {
        if (settled) return
        finishPreload()
        reject(error)
      }

      // Register callback BEFORE starting sync to avoid race condition
      this.rejectPreload = rejectError
      // An awaited preload owns this sync run until it settles, including
      // when GC has already queued the destructive idle callback.
      this.lifecycle.cancelGCTimer()
      unsubscribeReady = this.lifecycle.onFirstReady(resolveReady)
      unsubscribeError = this.collection.on(`status:error`, () => {
        if (syncStartState.active) {
          return
        }
        rejectError(this.getPreloadError())
      })

      // Start sync if collection hasn't started yet or was cleaned up
      if (
        this.lifecycle.status === `idle` ||
        this.lifecycle.status === `cleaned-up`
      ) {
        syncStartState.active = true
        let startFailure: { error: unknown } | undefined
        try {
          this.startSync()
        } catch (error) {
          startFailure = { error }
        } finally {
          syncStartState.active = false
        }
        if (this.collection.status === `error`) {
          rejectError(this.getPreloadError())
        } else if (syncStartState.ready) {
          // A first-ready listener can throw after readiness is established.
          // That failure still escapes direct startSync(), but preload follows
          // the final collection state after synchronous adapter entry.
          resolveReady()
        } else if (startFailure) {
          rejectError(startFailure.error)
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

  /** @internal Observe subset requests caused by one imperative operation. */
  public beginLoadSubsetOperation(): {
    wait: () => true | Promise<void>
    cancel: () => void
  } {
    const previousOperation = this.activeLoadSubsetOperation
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
    this.loadSubsetOperations.add(operation)
    return {
      wait: () => this.waitForLoadSubsetOperation(operation),
      cancel: () => {
        operation.completed = true
        this.loadSubsetOperations.delete(operation)
        if (this.activeLoadSubsetOperation === operation) {
          this.activeLoadSubsetOperation = previousOperation?.completed
            ? undefined
            : previousOperation
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
      this.loadSubsetOperations.delete(operation)
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
    promise: Promise<unknown>,
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
      this.loadSubsetOperations.delete(operation)
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
  public trackLoadSubsetOperationPromise(promise: Promise<unknown>): void {
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

  /**
   * Tracks a load promise for isLoadingSubset state.
   * @internal This is for internal coordination (e.g., live-query glue code), not for general use.
   */
  public trackLoadPromise(promise: Promise<unknown>): void {
    const syncRunGeneration = this.syncRunGeneration
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
      if (syncRunGeneration !== this.syncRunGeneration) return

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

  /** @internal Generation fence for subscription-owned async work. */
  public getSyncRunGeneration(): number {
    return this.syncRunGeneration
  }

  /**
   * Requests the sync layer to load more data.
   * @param options Options to control what data is being loaded
   * @returns If data loading is asynchronous, this method returns a promise that resolves when the data is loaded.
   *          Returns true if no sync function is configured, if syncMode is 'eager', or if there is no work to do.
   */
  public loadSubset(options: LoadSubsetOptions): LoadSubsetRequestResult {
    if (options.signal?.aborted) {
      return Promise.reject(new LoadSubsetOperationAbortedError())
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
    // Eager loading bypasses subset acquisition, so there is no lease to release.
    if (this.syncMode === `eager`) return

    if (this.syncStartDeferred) {
      this.deferredLoadSubsets = this.deferredLoadSubsets.filter((request) => {
        if (request.options !== options) {
          return true
        }

        request.deferred.reject(new LoadSubsetOperationAbortedError())
        return false
      })
      return
    }

    if (this.syncUnloadSubsetFn) {
      this.syncUnloadSubsetFn(options)
    }
  }

  private wrapCleanupError(error: unknown): SyncCleanupError {
    const wrappedError = new SyncCleanupError(this.id, error as Error | string)
    wrappedError.cause = error
    if (error instanceof Error) wrappedError.stack = error.stack
    return wrappedError
  }

  private invokeCleanup(cleanup: CleanupFn | null): true | Promise<void> {
    if (!cleanup) return true

    try {
      const result = cleanup()
      if (!isPromiseLike(result)) return true
      return Promise.resolve(result).then(
        () => undefined,
        (error: unknown) => {
          throw this.wrapCleanupError(error)
        },
      )
    } catch (error) {
      throw this.wrapCleanupError(error)
    }
  }

  private registerPendingSyncEntryCleanup(cleanup: CleanupFn): void {
    const pending = this.pendingSyncEntryCleanup
    if (!pending) return

    try {
      const result = this.invokeCleanup(cleanup)
      if (result !== true) {
        pending.tasks.push(result)
        void result.catch(() => undefined)
      }
    } catch (error) {
      pending.failure ??= { error }
    }
  }

  private completePendingSyncEntryCleanup(): void {
    const pending = this.pendingSyncEntryCleanup
    if (!pending) return
    this.pendingSyncEntryCleanup = undefined

    const settle = (failure?: { error: unknown }) => {
      const outcome = pending.failure ?? failure
      pending.onSettled?.(outcome)
      if (outcome) pending.completion?.reject(outcome.error)
      else pending.completion?.resolve()
    }

    if (pending.tasks.length === 0) {
      settle()
      return
    }

    void Promise.allSettled(pending.tasks).then((outcomes) => {
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === `rejected`,
      )
      settle(rejected ? { error: rejected.reason } : undefined)
    })
  }

  public cleanup(): true | Promise<void>
  public cleanup(onSettled: (failure?: { error: unknown }) => void): boolean
  public cleanup(
    onSettled?: (failure?: { error: unknown }) => void,
  ): boolean | Promise<void> {
    // Invalidate callbacks retained by asynchronous work from this sync run
    // before invoking adapter cleanup or allowing a new sync run to start.
    ++this.syncCallbackEpoch
    this.syncRunGeneration++
    this.rejectPreload?.(new CollectionPreloadAbortedError())
    const cleanup = this.syncCleanupFn
    this.syncCleanupFn = null
    this.syncLoadSubsetFn = null
    this.syncUnloadSubsetFn = null

    let cleanupResult: true | Promise<void> = true
    let cleanupFailure: { error: unknown } | undefined
    try {
      cleanupResult = this.invokeCleanup(cleanup)
    } catch (error) {
      cleanupFailure = { error }
    }

    this.preloadPromise = null
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
    this.activeLoadSubsetOperation = undefined
    for (const operation of this.loadSubsetOperations) {
      if (!operation.completed) {
        operation.completed = true
        operation.pending.clear()
        operation.hasError = true
        operation.error = new LoadSubsetOperationAbortedError()
        operation.deferred?.reject(operation.error)
      }
    }
    this.loadSubsetOperations.clear()
    const deferredLoadSubsets = this.deferredLoadSubsets
    this.deferredLoadSubsets = []
    for (const request of deferredLoadSubsets) {
      request.deferred.reject(new LoadSubsetOperationAbortedError())
    }

    if (this.syncEntryActive) {
      const completion = onSettled ? undefined : createDeferred<void>()
      const pending = {
        tasks: [] as Array<Promise<void>>,
        failure: cleanupFailure,
        onSettled,
        completion,
      }
      if (cleanupResult !== true) {
        pending.tasks.push(cleanupResult)
        void cleanupResult.catch(() => undefined)
      }
      this.pendingSyncEntryCleanup = pending
      return onSettled ? false : completion!.promise
    }

    if (cleanupFailure) throw cleanupFailure.error
    if (cleanupResult === true) return true

    if (!onSettled) return cleanupResult
    void cleanupResult.then(
      () => onSettled(),
      (error: unknown) => onSettled({ error }),
    )
    return false
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
