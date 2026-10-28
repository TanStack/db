// Fixed-scenario tests for loadSubset application, cancellation, and cleanup.
// Each test runs one hand-written history and checks literal rows, counts, or
// error names, so these are unit tests. The generated demand-identity laws are
// owned by load-subset-oracle.property.test.ts. The applied-receipt contract is
// in packages/db/src/query/live/ARCHITECTURE.md (Source cancellation and applied
// settlement).
//
// The application law: provider completion is not enough. A successful
// loadSubset result waits for its establishing applied receipt, and its loaded
// rows must cross the source Collection publication boundary before initial-query
// readiness. An abort before that boundary rejects and suppresses the rows. An
// abort after publication is too late, and the applied rows stay visible.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import {
  LoadSubsetOperationAbortedError,
  SyncQueueInvariantError,
} from '../../src/errors.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { createTransaction } from '../../src/transactions.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { TraceAssertionError } from '../trace-runner.js'
import {
  exactDemandAxisPairs,
  toLoadSubsetOptions,
} from './load-subset-support.js'
import type {
  LoadSubsetRequestResult,
  SyncAppliedReceipt,
} from '../../src/types.js'

type PersistedLoadRow = {
  id: string
  projectId: string
}

type OptimisticDerivedRow = {
  id: string
  value: string
}

// A load result may include delivery before it awaits the establishing applied
// receipt. Only commit() returns that receipt.
function requirePendingLoadSubsetResult(
  loadResult: LoadSubsetRequestResult,
): Promise<void> {
  if (loadResult === true) {
    throw new Error(`Expected an asynchronous subset load`)
  }
  return loadResult
}

let collectionSequence = 0

type OracleCleanupStep = {
  label: string
  run: () => void | Promise<void>
}

// A failed law remains the cause even if one or more releases also fail. Run
// every release so an earlier cleanup failure cannot strand later resources.
async function runOracleCleanup(
  law: string,
  primaryFailure: { error: unknown } | undefined,
  steps: ReadonlyArray<OracleCleanupStep>,
): Promise<void> {
  const cleanupFailures: Array<Error> = []
  for (const { label, run } of steps) {
    try {
      await run()
    } catch (error) {
      cleanupFailures.push(
        new Error(`${label} cleanup failed`, { cause: error }),
      )
    }
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `${law}: cleanup failed`, {
      cause: primaryFailure?.error,
    })
  }
}

function releasePersistingMutation(
  persistence: ReturnType<typeof createDeferred<void>>,
  settlement?: Promise<unknown>,
): void {
  persistence.resolve()
  // A broken applied-settlement path can leave optimistic transaction
  // settlement pending forever. Collection teardown must proceed; observing
  // rejection prevents an abandoned promise from becoming an unrelated error.
  void settlement?.catch(() => undefined)
}

async function expectPersistingLoadIsApplied(
  persisting: boolean,
  delivery: `synchronous` | `asynchronous` = `synchronous`,
  transactionStart: `during-load` | `before-load` = `during-load`,
) {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let loadCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-oracle-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        if (transactionStart === `before-load`) begin()
        markReady()
        return {
          loadSubset: () => {
            loadCalls += 1
            const applyRows = () => {
              if (transactionStart === `during-load`) begin()
              for (const row of rows) {
                write({ type: `insert`, value: { ...row } })
              }
              return commit()
            }
            if (delivery === `synchronous`) {
              return applyRows()
            }
            return Promise.resolve().then(async () => {
              const applied = applyRows()
              if (applied !== true) await applied
            })
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let cleanupLive: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    if (persisting) {
      transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    }
    const live = createLiveQueryCollection((query) =>
      query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    cleanupLive = () => live.cleanup()
    if (persisting) expect(transaction.state).toBe(`persisting`)
    const ready = live.toArrayWhenReady()
    if (persisting) {
      let fulfilled = false
      void ready.then(
        () => {
          fulfilled = true
        },
        () => undefined,
      )
      await Promise.resolve()
      await Promise.resolve()

      expect(fulfilled).toBe(false)
      expect(source.get(`r1`)).toBeUndefined()
      expect(source.get(`r2`)).toBeUndefined()

      persistence.resolve()
      await transaction.isPersisted.promise
    }

    const result = await ready
    expect(loadCalls).toBe(1)
    try {
      expect(result.map(({ id }) => id).sort()).toEqual([`r1`, `r2`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `applied load reaches live-query readiness`,
      primaryFailure,
      [
        {
          label: `optimistic persistence`,
          run: () => {
            if (persisting) {
              releasePersistingMutation(persistence, settlement)
            }
          },
        },
        { label: `live query`, run: () => cleanupLive?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectAppliedReceiptTiming(
  gate: `free` | `parked`,
  delivery: `synchronous` | `asynchronous`,
): Promise<void> {
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-timing-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            const applyRow = () => {
              begin()
              write({
                type: `insert`,
                value: { id: `remote`, projectId: `p1` },
              })
              return commit()
            }

            return delivery === `synchronous`
              ? applyRow()
              : Promise.resolve().then(async () => {
                  const applied = applyRow()
                  if (applied !== true) await applied
                })
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    if (gate === `parked`) {
      transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    }
    if (gate === `parked`) expect(transaction.state).toBe(`persisting`)
    const loadResult = source._sync.loadSubset({})
    if (gate === `free` && delivery === `synchronous`) {
      expect(loadResult).toBe(true)
      expect(source.get(`remote`)).toEqual(
        expect.objectContaining({ id: `remote`, projectId: `p1` }),
      )
      return
    }

    const pending = requirePendingLoadSubsetResult(loadResult)
    let fulfilled = false
    let visibleWhenFulfilled = false
    void pending
      .then(
        () => {
          fulfilled = true
          visibleWhenFulfilled = source.get(`remote`)?.id === `remote`
        },
        () => undefined,
      )
      .catch(() => undefined)

    expect(fulfilled).toBe(false)
    expect(source.get(`remote`)).toBeUndefined()
    await Promise.resolve()
    await Promise.resolve()

    if (gate === `parked`) {
      expect(fulfilled).toBe(false)
      expect(source.get(`remote`)).toBeUndefined()
      persistence.resolve()
      await transaction.isPersisted.promise
    }

    await pending
    expect(fulfilled).toBe(true)
    expect(visibleWhenFulfilled).toBe(true)
    expect(source.get(`remote`)).toEqual(
      expect.objectContaining({ id: `remote`, projectId: `p1` }),
    )
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `subset load fulfillment follows application`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectAppliedLoadDoesNotFlushEarlierParkedSync() {
  const rows: Array<PersistedLoadRow> = [
    { id: `r1`, projectId: `p1` },
    { id: `r2`, projectId: `p1` },
  ]
  let publishUnrelated!: () => void
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-order-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () => {
            begin()
            for (const row of rows) {
              write({ type: `insert`, value: { ...row } })
            }
            return commit()
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let cleanupLive: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    publishUnrelated()
    const live = createLiveQueryCollection((query) =>
      query.from({ row: source }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    cleanupLive = () => live.cleanup()
    expect(transaction.state).toBe(`persisting`)
    const ready = live.toArrayWhenReady()
    let fulfilled = false
    void ready.then(
      () => {
        fulfilled = true
      },
      () => undefined,
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(fulfilled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(ready).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `r1` }),
        expect.objectContaining({ id: `r2` }),
      ]),
    )
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `parked stream remains behind applied subset`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `live query`, run: () => cleanupLive?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectCompletionWaitsForAppliedRows() {
  let publishUnrelated!: () => void
  let transportCalls = 0
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-coverage-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        const deduplicated = new DeduplicatedLoadSubset({
          loadSubset: () => {
            transportCalls += 1
            begin()
            write({
              type: `insert`,
              value: { id: `r1`, projectId: `p1` },
            })
            return commit()
          },
        })
        markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    publishUnrelated()
    const first = source._sync.loadSubset({})
    expect(first).toBeInstanceOf(Promise)
    await Promise.resolve()
    await Promise.resolve()

    const concurrent = source._sync.loadSubset({})
    expect(concurrent).toBe(first)
    expect(transportCalls).toBe(1)
    expect(source.get(`r1`)).toBeUndefined()

    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.all([first, concurrent])
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
    expect(source._sync.loadSubset({})).toBe(true)
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `subset completion follows applied rows`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectConcurrentStreamCommitStaysParked(
  cancelBeforePersistence = false,
) {
  let publishUnrelated!: () => void
  let publishSubset!: () => void
  let rejectPendingSubset: ((reason: unknown) => void) | undefined
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-concurrent-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publishUnrelated = () => {
          begin()
          write({
            type: `insert`,
            value: { id: `unrelated`, projectId: `p2` },
          })
          commit()
        }
        markReady()
        return {
          loadSubset: () =>
            new Promise<void>((resolve, reject) => {
              const fulfill = () => {
                rejectPendingSubset = undefined
                resolve()
              }
              const fail = (reason: unknown) => {
                rejectPendingSubset = undefined
                reject(reason)
              }
              rejectPendingSubset = fail
              publishSubset = () => {
                try {
                  begin()
                  write({
                    type: `insert`,
                    value: { id: `r1`, projectId: `p1` },
                  })
                  const applied = commit()
                  if (applied === true) {
                    fulfill()
                  } else {
                    void applied.then(fulfill, fail)
                  }
                } catch (error) {
                  fail(error)
                }
              }
            }),
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `other`, projectId: `p2` }))
    const load = requirePendingLoadSubsetResult(source._sync.loadSubset({}))
    void load.catch(() => undefined)
    publishUnrelated()
    publishSubset()
    let fulfilled = false
    void load.then(
      () => {
        fulfilled = true
      },
      () => undefined,
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(fulfilled).toBe(false)
    expect(source.get(`unrelated`)).toBeUndefined()
    expect(source.get(`r1`)).toBeUndefined()
    if (cancelBeforePersistence) {
      await source.cleanup()
      await expect(load).rejects.toMatchObject({ name: `AbortError` })
      return
    }
    persistence.resolve()
    await transaction.isPersisted.promise
    await load
    expect(source.get(`unrelated`)).toEqual(
      expect.objectContaining({ id: `unrelated`, projectId: `p2` }),
    )
    expect(source.get(`r1`)).toEqual(
      expect.objectContaining({ id: `r1`, projectId: `p1` }),
    )
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `concurrent stream commit remains parked`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        {
          label: `controlled subset transport`,
          run: () =>
            rejectPendingSubset?.(
              new DOMException(`Oracle fixture released`, `AbortError`),
            ),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectAbortedReceiptDoesNotSettleDemand(
  abortPhase: `before-commit` | `while-parked`,
) {
  let transportCalls = 0
  const committed = createDeferred<void>()
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async ({ signal }) => {
      transportCalls += 1
      if (abortPhase === `before-commit`) {
        // Give cancellation a chance to revoke this request before its
        // request-scoped rows enter the collection transaction.
        await Promise.resolve()
        if (signal?.aborted) {
          return
        }
      }
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit(signal)
      committed.resolve()
      if (applied !== true) await applied
      // Source contract: accepted rows apply, but a caller that aborted sees
      // `AbortError`.
      if (signal?.aborted) throw new LoadSubsetOperationAbortedError()
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return { loadSubset: deduplicated.loadSubset }
      },
    },
  })
  const persistence = createDeferred<void>()
  const controller = new AbortController()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    const first = requirePendingLoadSubsetResult(
      source._sync.loadSubset({ signal: controller.signal }),
    )
    if (abortPhase === `while-parked`) {
      await committed.promise
    }
    controller.abort()
    persistence.resolve()
    await transaction.isPersisted.promise
    // An accepted transaction always applies, so the row publishes when the
    // mutation settles. A caller that aborted still sees `AbortError`.
    if (abortPhase === `while-parked`)
      await expect(first).rejects.toMatchObject({ name: `AbortError` })
    else await first
    expect(transportCalls).toBe(1)
    if (abortPhase === `while-parked`)
      expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
    else expect(source.get(`row`)).toBeUndefined()

    const retry = source._sync.loadSubset({})
    if (retry !== true) await retry
    expect(transportCalls).toBe(2)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `aborted receipt remains retryable`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectAbortDuringPublicationDoesNotCancelReceipt() {
  const controller = new AbortController()
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-publication-abort-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: ({ signal }) => {
            begin()
            write({
              type: `insert`,
              value: { id: `row`, projectId: `p1` },
            })
            return commit(signal)
          },
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let unsubscribe: (() => void) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() =>
      source.insert({ id: `local`, projectId: `pending` }),
    )
    const subscription = source.subscribeChanges((changes) => {
      if (changes.some((change) => change.key === `row`)) {
        controller.abort()
      }
    })
    unsubscribe = () => subscription.unsubscribe()
    const load = requirePendingLoadSubsetResult(
      source._sync.loadSubset({ signal: controller.signal }),
    )
    persistence.resolve()
    await transaction.isPersisted.promise
    await expect(load).resolves.toBeUndefined()
    expect(controller.signal.aborted).toBe(true)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `abort during publication retains applied rows`,
      primaryFailure,
      [
        { label: `change subscription`, run: () => unsubscribe?.() },
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectCanceledReceiptReleasesOnlyItsSuppression() {
  let begin!: () => void
  let write!: (message: { type: `update`; value: PersistedLoadRow }) => void
  let commit!: (signal?: AbortSignal) => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-cancel-suppression-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `update`, value: { id: `first`, projectId: `old` } })
        write({ type: `update`, value: { id: `second`, projectId: `old` } })
        commit()
        params.markReady()
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    await source.preload()
    await Promise.resolve()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() =>
      source.insert({ id: `local`, projectId: `pending` }),
    )
    expect(transaction.state).toBe(`persisting`)
    begin()
    write({ type: `update`, value: { id: `first`, projectId: `new` } })
    const accepted = commit()
    const acceptedTransaction = source._state.pendingSyncedTransactions.at(-1)!
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    begin()
    write({ type: `update`, value: { id: `second`, projectId: `new` } })
    expect(source._state.pendingSyncedTransactions).toHaveLength(2)

    // Only the accepted transaction publishes in a drain, so only its key is
    // suppressed; the open one holds no suppression to release.
    source._state.capturePreSyncVisibleState()
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`first`]))

    // Only the open last transaction can be canceled.
    expect(() =>
      source._state.cancelPendingSyncedTransaction(acceptedTransaction),
    ).toThrow(SyncQueueInvariantError)
    const controller = new AbortController()
    controller.abort()
    const canceled = commit(controller.signal)
    expect(source._state.pendingSyncedTransactions).toHaveLength(1)
    expect(source._state.recentlySyncedKeys).toEqual(new Set([`first`]))
    expect(source._state.preSyncVisibleState.has(`second`)).toBe(false)
    expect(source._state.preSyncVisibleState.has(`first`)).toBe(true)
    await expect(canceled).rejects.toMatchObject({ name: `AbortError` })
    expect(accepted).not.toBe(true)
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `canceled receipt releases only its suppression`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectCleanupRejectsDemandOnce() {
  let receipt!: Promise<void>
  let transportCalls = 0
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: () => {
      transportCalls += 1
      begin()
      write({
        type: `insert`,
        value: { id: `row`, projectId: `p1` },
      })
      const applied = commit()
      if (transportCalls === 1) {
        if (applied === true) {
          throw new Error(`Expected the subset transaction to remain parked`)
        }
        receipt = applied
      }
      return applied
    },
  })
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PersistedLoadRow }) => void
  let commit!: () => SyncAppliedReceipt
  const source = createCollection<PersistedLoadRow>({
    id: `load-subset-applied-cleanup-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          cleanup: () => deduplicated.reset(),
        }
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let settlements = 0

  let primaryFailure: { error: unknown } | undefined
  try {
    source.startSyncImmediate()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    settlement = transaction.isPersisted.promise
    transaction.mutate(() => source.insert({ id: `local`, projectId: `p2` }))
    const load = requirePendingLoadSubsetResult(source._sync.loadSubset({}))
    void load.catch(() => undefined)
    void receipt.then(
      () => {
        settlements += 1
      },
      () => {
        settlements += 1
      },
    )
    await source.cleanup()
    await expect(load).rejects.toMatchObject({ name: `AbortError` })
    await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
    expect(settlements).toBe(1)

    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    await Promise.resolve()
    expect(settlements).toBe(1)

    // Restarting installs fresh sync controls. Reacquisition must both perform
    // transport work and publish its rows; stale callbacks cannot prove either.
    source.startSyncImmediate()
    const retry = source._sync.loadSubset({})
    if (retry !== true) await retry
    expect(transportCalls).toBe(2)
    expect(source.get(`row`)).toEqual(expect.objectContaining({ id: `row` }))
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `cleanup rejects abandoned demand once`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

async function expectDerivedSyncDuringOptimisticMutation(): Promise<void> {
  let begin!: () => void
  let write!: (message: { type: `insert`; value: OptimisticDerivedRow }) => void
  let commit!: () => void
  const source = createCollection<OptimisticDerivedRow>({
    id: `optimistic-derived-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
      },
    },
  })
  const persistence = createDeferred<void>()
  let settlement: Promise<unknown> | undefined
  let cleanupDerived: (() => Promise<void>) | undefined
  let primaryFailure: { error: unknown } | undefined
  try {
    const derived = createLiveQueryCollection({
      query: (query) =>
        query
          .from({ row: source })
          .select(({ row }) => ({ id: row.id, value: row.value })),
      getKey: (row) => row.id,
      startSync: true,
    })
    cleanupDerived = () => derived.cleanup()
    // Query collections currently expose read-side virtual properties in their
    // insert input type even though the runtime accepts the plain selected row.
    const insertDerived = derived.insert.bind(derived) as unknown as (
      row: OptimisticDerivedRow,
    ) => ReturnType<typeof derived.insert>
    const insertOptimistically = createOptimisticAction<OptimisticDerivedRow>({
      onMutate: insertDerived,
      mutationFn: () => persistence.promise,
    })
    await derived.preload()
    const transaction = insertOptimistically({
      id: `optimistic`,
      value: `optimistic`,
    })
    settlement = transaction.isPersisted.promise
    begin()
    write({ type: `insert`, value: { id: `synced`, value: `synced` } })
    commit()

    try {
      expect([...derived.keys()].sort()).toEqual([`optimistic`, `synced`])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    await runOracleCleanup(
      `derived sync during optimistic mutation`,
      primaryFailure,
      [
        {
          label: `persistence gate`,
          run: () => releasePersistingMutation(persistence, settlement),
        },
        { label: `derived collection`, run: () => cleanupDerived?.() },
        { label: `source collection`, run: () => source.cleanup() },
      ],
    )
  }
}

describe(`exact loadSubset demand oracle`, () => {
  it(`refetch starts fresh work for the same exact demand`, () => {
    let starts = 0
    const dedupe = new DeduplicatedLoadSubset({
      loadSubset: () => {
        starts++
        return true
      },
    })
    const options = toLoadSubsetOptions(exactDemandAxisPairs[0]![1])

    expect(dedupe.loadSubset(options)).toBe(true)
    expect(dedupe.loadSubset(options)).toBe(true)
    expect(starts).toBe(1)

    expect(dedupe.loadSubset({ ...options, refetch: true })).toBe(true)
    expect(starts).toBe(2)
    expect(dedupe.loadSubset(options)).toBe(true)
    expect(starts).toBe(2)
  })

  it(`starts separate acquisitions for independently cancelable exact demands`, async () => {
    const acquisitions: Array<ReturnType<typeof createDeferred<void>>> = []
    const dedupe = new DeduplicatedLoadSubset({
      loadSubset: () => {
        const acquisition = createDeferred<void>()
        acquisitions.push(acquisition)
        return acquisition.promise
      },
    })
    const options = toLoadSubsetOptions(exactDemandAxisPairs[0]![1])
    const first = dedupe.loadSubset({
      ...options,
      signal: new AbortController().signal,
    })
    const second = dedupe.loadSubset({
      ...options,
      signal: new AbortController().signal,
    })

    expect(acquisitions).toHaveLength(2)
    expect(first).not.toBe(second)
    for (const acquisition of acquisitions) acquisition.resolve()
    await Promise.all([first, second])
  })
})

describe(`loadSubset application and cancellation`, () => {
  it(`releases a pending mutation and source despite a cleanup fault`, async () => {
    const primary = new TraceAssertionError(
      4,
      new Error(`subset load fulfilled before application`),
    )
    const persistence = createDeferred<void>()
    const stillPending = createDeferred<void>()
    const cleanupFault = new Error(`subscription release failed`)
    const released: Array<string> = []
    let cleanupWaitFulfilled = false
    let cleanupWaitFulfilledAtCleanup = false
    void stillPending.promise.then(
      () => {
        cleanupWaitFulfilled = true
      },
      () => undefined,
    )

    let failure: unknown
    try {
      await runOracleCleanup(
        `subset load fulfillment follows application`,
        { error: primary },
        [
          {
            label: `persistence gate`,
            run: () => {
              released.push(`persistence gate`)
              releasePersistingMutation(persistence, stillPending.promise)
            },
          },
          {
            label: `subscription`,
            run: () => {
              released.push(`subscription`)
              throw cleanupFault
            },
          },
          {
            label: `source collection`,
            run: () => {
              released.push(`source collection`)
            },
          },
        ],
      )
    } catch (error) {
      failure = error
    } finally {
      cleanupWaitFulfilledAtCleanup = cleanupWaitFulfilled
      stillPending.resolve()
    }

    await persistence.promise
    expect(released).toEqual([
      `persistence gate`,
      `subscription`,
      `source collection`,
    ])
    expect(cleanupWaitFulfilledAtCleanup).toBe(false)
    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.cause).toBe(primary)
    expect(primary.checkpoint).toBe(4)
    expect(aggregate.errors).toEqual([
      new Error(`subscription cleanup failed`, { cause: cleanupFault }),
    ])
  })

  it(`keeps the violated law and checkpoint when two cleanup steps fail`, async () => {
    const primary = new TraceAssertionError(
      3,
      new Error(`loaded row absent at readiness`),
    )
    const firstCleanup = new Error(`release failed`)
    const secondCleanup = new Error(`collection cleanup failed`)
    const releases: Array<string> = []

    let failure: unknown
    try {
      await runOracleCleanup(
        `applied load reaches live-query readiness`,
        { error: primary },
        [
          {
            label: `acquisition`,
            run: () => {
              releases.push(`acquisition`)
              throw firstCleanup
            },
          },
          {
            label: `live query`,
            run: () => {
              releases.push(`live query`)
              throw secondCleanup
            },
          },
          {
            label: `source collection`,
            run: () => {
              releases.push(`source collection`)
            },
          },
        ],
      )
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.message).toContain(
      `applied load reaches live-query readiness`,
    )
    expect(aggregate.cause).toBe(primary)
    expect(primary.checkpoint).toBe(3)
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0]).toMatchObject({
      message: `acquisition cleanup failed`,
      cause: firstCleanup,
    })
    expect(aggregate.errors[1]).toMatchObject({
      message: `live query cleanup failed`,
      cause: secondCleanup,
    })
    expect(releases).toEqual([`acquisition`, `live query`, `source collection`])
  })

  it(`applies loaded rows when no mutation is persisting`, async () => {
    await expectPersistingLoadIsApplied(false)
  })

  it(`applies loaded rows before resolving readiness behind a persisting mutation`, async () => {
    await expectPersistingLoadIsApplied(true)
  })

  it(`applies asynchronously delivered rows before resolving readiness`, async () => {
    await expectPersistingLoadIsApplied(true, `asynchronous`)
  })

  it(`applies a transaction opened before its subset demand`, async () => {
    await expectPersistingLoadIsApplied(true, `synchronous`, `before-load`)
  })

  it.each([
    [`free`, `synchronous`],
    [`free`, `asynchronous`],
    [`parked`, `synchronous`],
    [`parked`, `asynchronous`],
  ] as const)(
    `preserves applied-receipt timing with a %s gate and %s delivery`,
    expectAppliedReceiptTiming,
  )

  it(`does not flush earlier parked sync work to apply a subset load`, async () => {
    await expectAppliedLoadDoesNotFlushEarlierParkedSync()
  })

  it(`fulfills a subset load only after its rows apply`, async () => {
    await expectCompletionWaitsForAppliedRows()
  })

  it(`keeps an unrelated stream commit parked during a subset acquisition`, async () => {
    await expectConcurrentStreamCommitStaysParked()
  })

  it(`rejects the controlled subset transport when its applied receipt is canceled`, async () => {
    await expectConcurrentStreamCommitStaysParked(true)
  })

  it.each([`before-commit`, `while-parked`] as const)(
    `rejects an aborted demand and keeps its accepted rows when aborted %s`,
    expectAbortedReceiptDoesNotSettleDemand,
  )

  it(`ignores an abort raised after application starts publishing`, async () => {
    await expectAbortDuringPublicationDoesNotCancelReceipt()
  })

  it(`releases only a canceled receipt's event suppression`, async () => {
    await expectCanceledReceiptReleasesOnlyItsSuppression()
  })

  it(`rejects an abandoned demand once`, async () => {
    await expectCleanupRejectsDemandOnce()
  })

  it(`publishes synced source rows while a derived mutation persists`, async () => {
    await expectAssertionFailure(expectDerivedSyncDuringOptimisticMutation, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.join(`,`) === `optimistic` &&
        Array.isArray(expected) &&
        expected.join(`,`) === `optimistic,synced`,
    })()
  })
})
