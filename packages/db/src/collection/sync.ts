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
import {
  createAppliedLoadSubsetOutcome,
  isAppliedLoadSubsetOutcome,
  isLoadSubsetPromiseForDemand,
} from '../query/load-subset-outcome.js'
import {
  cloneLoadSubsetOptions,
  snapshotLoadSubsetDemand,
} from '../query/load-subset-options.js'
import { createLoadSubsetCoverageRegistry } from '../query/coverage-registry.js'
import { getLoadSubsetDemandKey } from '../query/ir-stable-identity.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  AppliedLoadSubsetOutcome,
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
import type {
  AcquisitionToken,
  AppliedLoadSubsetCoverage,
  DemandLease,
} from '../query/coverage-registry.js'

type DeferredLoadSubset = {
  ownerOptions: LoadSubsetOptions
  options: LoadSubsetOptions
  demand: LoadSubsetOptions
  generation: number
  deferred: Deferred<AppliedLoadSubsetOutcome>
}

type SharedCoverageAcquisition = {
  demandKey: string | undefined
  acquisition: AcquisitionToken
}

type LoadSubsetOperation = {
  pending: Set<Promise<unknown>>
  outcomes: Map<
    string | undefined,
    Map<string, Map<number, AppliedLoadSubsetOutcome>>
  >
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
  public syncLoadSubsetFn: LoadSubsetFn | null = null
  public syncUnloadSubsetFn: ((options: LoadSubsetOptions) => void) | null =
    null

  private pendingLoadSubsetPromises: Set<Promise<unknown>> = new Set()
  private activeLoadSubsetOperation: LoadSubsetOperation | undefined
  private loadSubsetOperations = new Set<LoadSubsetOperation>()
  private syncStartDeferred = false
  private syncStartRequested = false
  private deferredLoadSubsets: Array<DeferredLoadSubset> = []
  private deferredAdapterOptions = new Map<
    LoadSubsetOptions,
    Array<LoadSubsetOptions>
  >()
  private syncEpoch = 0
  private loadSubsetSession = 0
  private loadSubsetGeneration = 0
  private readonly coverageRegistry = createLoadSubsetCoverageRegistry<TKey>()
  private coverageLeasesByOwner = new WeakMap<
    LoadSubsetOptions,
    Array<DemandLease<LoadSubsetOptions>>
  >()
  private coverageAcquisitionsByPromise = new WeakMap<
    Promise<unknown>,
    SharedCoverageAcquisition
  >()

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

    for (const {
      ownerOptions,
      options,
      demand,
      generation,
      deferred,
    } of deferredLoadSubsets) {
      try {
        const result = this.syncLoadSubsetFn?.(options) ?? true
        if (this.syncLoadSubsetFn) {
          const adapterOptions = this.deferredAdapterOptions.get(ownerOptions)
          if (adapterOptions) {
            adapterOptions.push(options)
          } else {
            this.deferredAdapterOptions.set(ownerOptions, [options])
          }
        }
        if (result instanceof Promise) {
          const { lease, acquisition } = this.addCoverageOwnership(
            ownerOptions,
            demand,
            generation,
            result,
          )
          void result.then(
            (sourceResult) => {
              const outcome = createAppliedLoadSubsetOutcome(
                this.id,
                demand,
                generation,
                isLoadSubsetPromiseForDemand(result, options)
                  ? sourceResult
                  : undefined,
              )
              this.publishCoverageOutcome(acquisition, outcome)
              deferred.resolve(outcome)
            },
            (error: unknown) => {
              this.discardCoverageLease(ownerOptions, lease)
              deferred.reject(error)
            },
          )
        } else {
          const outcome = createAppliedLoadSubsetOutcome(
            this.id,
            demand,
            generation,
            undefined,
          )
          deferred.resolve(outcome)
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
    getOutcomes: () => ReadonlyArray<AppliedLoadSubsetOutcome>
  } {
    const operation: LoadSubsetOperation = {
      pending: new Set(),
      outcomes: new Map(),
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
          this.activeLoadSubsetOperation = undefined
        }
      },
      getOutcomes: () =>
        [...operation.outcomes.values()].flatMap((byCollection) =>
          [...byCollection.values()].flatMap((byGeneration) => [
            ...byGeneration.values(),
          ]),
        ),
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
    outcome: { ok: true; result: unknown } | { ok: false; error: unknown },
  ): void {
    if (operation.completed) return
    operation.pending.delete(promise)
    if (!outcome.ok && !operation.hasError) {
      operation.hasError = true
      operation.error = outcome.error
    } else if (outcome.ok) {
      const results = Array.isArray(outcome.result)
        ? outcome.result.filter(isAppliedLoadSubsetOutcome)
        : isAppliedLoadSubsetOutcome(outcome.result)
          ? [outcome.result]
          : []
      for (const result of results) {
        let byCollection = operation.outcomes.get(result.sourceId)
        if (!byCollection) {
          byCollection = new Map()
          operation.outcomes.set(result.sourceId, byCollection)
        }
        let byGeneration = byCollection.get(result.collectionId)
        if (!byGeneration) {
          byGeneration = new Map()
          byCollection.set(result.collectionId, byGeneration)
        }
        byGeneration.set(result.generation, result)
      }
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
      (result) =>
        this.settleLoadSubsetOperation(operation, promise, {
          ok: true,
          result,
        }),
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
  public trackLoadPromise(promise: Promise<unknown>): void {
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
  public loadSubset(options: LoadSubsetOptions): LoadSubsetRequestResult {
    if (options.signal?.aborted) {
      return true
    }

    // Bypass loadSubset when syncMode is 'eager'
    if (this.syncMode === `eager`) {
      return true
    }

    if (this.syncStartDeferred) {
      this.syncStartRequested = true
      const deferred = createDeferred<AppliedLoadSubsetOutcome>()
      const loadOptions = cloneLoadSubsetOptions(options)
      const demand = snapshotLoadSubsetDemand(loadOptions)
      // Demand identity is part of acquisition scope. Reject unsupported
      // values before an adapter can perform irreversible work.
      getLoadSubsetDemandKey(demand)
      const generation = ++this.loadSubsetGeneration
      this.deferredLoadSubsets.push({
        ownerOptions: options,
        options: loadOptions,
        demand,
        generation,
        deferred,
      })
      this.trackLoadPromise(deferred.promise)
      return deferred.promise
    }

    if (this.syncLoadSubsetFn) {
      const demand = snapshotLoadSubsetDemand(options)
      // Validate and hash the retained scope before starting adapter work.
      getLoadSubsetDemandKey(demand)
      const generation = ++this.loadSubsetGeneration
      const result: ReturnType<LoadSubsetFn> = this.syncLoadSubsetFn(options)
      // If the result is a promise, track it
      if (result instanceof Promise) {
        const { lease, acquisition } = this.addCoverageOwnership(
          options,
          demand,
          generation,
          result,
        )
        const outcome = result.then(
          (sourceResult) => {
            const appliedOutcome = createAppliedLoadSubsetOutcome(
              this.id,
              demand,
              generation,
              isLoadSubsetPromiseForDemand(result, options)
                ? sourceResult
                : undefined,
            )
            this.publishCoverageOutcome(acquisition, appliedOutcome)
            return appliedOutcome
          },
          (error: unknown) => {
            this.discardCoverageLease(options, lease)
            throw error
          },
        )
        this.trackLoadPromise(outcome)
        return outcome
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
        if (request.ownerOptions !== options) {
          return true
        }

        request.deferred.resolve(
          createAppliedLoadSubsetOutcome(
            this.id,
            request.demand,
            request.generation,
            undefined,
          ),
        )
        return false
      })
      return
    }

    if (this.syncUnloadSubsetFn) {
      const adapterOptions = this.deferredAdapterOptions.get(options)
      const acquiredOptions = adapterOptions?.[0] ?? options
      this.syncUnloadSubsetFn(acquiredOptions)
      adapterOptions?.shift()
      if (adapterOptions?.length === 0) {
        this.deferredAdapterOptions.delete(options)
      }
    }
    this.releaseCoverageLease(options)
  }

  /** @internal Applied source coverage retained by active subset owners. */
  public getLoadSubsetCoverage(): ReadonlyArray<
    AppliedLoadSubsetCoverage<TKey>
  > {
    return this.coverageRegistry.coverageAntichain()
  }

  private addCoverageOwnership(
    ownerOptions: LoadSubsetOptions,
    demand: LoadSubsetOptions,
    generation: number,
    physicalPromise: Promise<unknown>,
  ): {
    lease: DemandLease<LoadSubsetOptions>
    acquisition: AcquisitionToken
  } {
    const lease = this.coverageRegistry.addLease(demand)
    const demandKey = getLoadSubsetDemandKey(demand)
    const shared = this.coverageAcquisitionsByPromise.get(physicalPromise)
    let acquisition: AcquisitionToken
    if (
      shared?.demandKey === demandKey &&
      this.coverageRegistry.isAcquisitionAttachable(shared.acquisition)
    ) {
      acquisition = shared.acquisition
      this.coverageRegistry.attachLease(lease, acquisition)
    } else {
      acquisition = this.coverageRegistry.addAcquisition({
        generation,
        scope: { collectionId: this.id, demand },
        leases: [lease],
        // Adapter resource release remains owned by unloadSubset. The registry
        // tracks the same lifetime without duplicating that side effect.
        release: () => {},
      })
      this.coverageAcquisitionsByPromise.set(physicalPromise, {
        demandKey,
        acquisition,
      })
    }
    const leases = this.coverageLeasesByOwner.get(ownerOptions) ?? []
    leases.push(lease)
    this.coverageLeasesByOwner.set(ownerOptions, leases)
    return { lease, acquisition }
  }

  private publishCoverageOutcome(
    acquisition: AcquisitionToken,
    outcome: AppliedLoadSubsetOutcome,
  ): void {
    if (outcome.appliedRowKeys === undefined) return
    this.removeCoverageRows(
      this.coverageRegistry.publishOutcome(acquisition, outcome).rowsToRemove,
    )
  }

  private releaseCoverageLease(options: LoadSubsetOptions): void {
    const leases = this.coverageLeasesByOwner.get(options)
    const lease = leases?.shift()
    if (!lease) return
    if (leases?.length === 0) this.coverageLeasesByOwner.delete(options)
    this.removeCoverageRows(
      this.coverageRegistry.releaseLease(lease).rowsToRemove,
    )
  }

  private discardCoverageLease(
    options: LoadSubsetOptions,
    lease: DemandLease<LoadSubsetOptions>,
  ): void {
    const leases = this.coverageLeasesByOwner.get(options)
    if (leases) {
      const index = leases.indexOf(lease)
      if (index >= 0) leases.splice(index, 1)
      if (leases.length === 0) this.coverageLeasesByOwner.delete(options)
    }
    this.removeCoverageRows(
      this.coverageRegistry.releaseLease(lease).rowsToRemove,
    )
  }

  private removeCoverageRows(rows: ReadonlyArray<TKey>): void {
    const unownedRows = rows.filter(
      (row) => this.coverageRegistry.rowOwnerCount(row) === 0,
    )
    if (unownedRows.length === 0) return
    this.state.deleteSyncedRows(unownedRows)
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
    this.deferredAdapterOptions.clear()
    this.removeCoverageRows(this.coverageRegistry.dispose().rowsToRemove)
    this.coverageLeasesByOwner = new WeakMap()
    this.coverageAcquisitionsByPromise = new WeakMap()
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
        operation.deferred?.resolve()
      }
    }
    this.loadSubsetOperations.clear()
    const deferredLoadSubsets = this.deferredLoadSubsets
    this.deferredLoadSubsets = []
    for (const request of deferredLoadSubsets) {
      request.deferred.resolve(
        createAppliedLoadSubsetOutcome(
          this.id,
          request.demand,
          request.generation,
          undefined,
        ),
      )
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
