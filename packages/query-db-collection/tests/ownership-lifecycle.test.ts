/**
 * Ordinary Query Collection ownership tests: fixed scenarios whose expected
 * values are written by hand. The ownership law and its generated histories
 * are owned by ownership-lifecycle.oracle.test.ts.
 */

import {
  CancelledError,
  QueryClient,
  QueryObserver,
  focusManager,
  hashKey,
  isCancelledError,
} from '@tanstack/query-core'
import {
  DbClient,
  IR,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeferred } from '../../db/src/deferred.js'

import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src/index.js'
import { createNodeSQLitePersistence } from '../../node-db-sqlite-persistence/src/index.js'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver.js'
import { SyncNotInitializedError } from '../src/errors.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  categoryIn,
  categorySubset,
  cleanups,
  createOwnershipFixture,
  createOwnershipStorage,
  createPersistedOwnershipFixture,
  createQueryClient,
  createSharedRowClient,
  detailOnly,
  expectColdOwnerRevalidation,
  expectMutationLifecycleSnapshot,
  expectMutationPublicationIntegrity,
  expectedDirectWriteAdmission,
  expectedDirectWriteReceipt,
  itemIds,
  listOnly,
  observeColdOwnerRevalidation,
  persistedOwners,
  publishedRowMetadata,
  readClaimedCacheRows,
  recordMetadata,
  recordRunCacheClaim,
  reportedError,
  rows,
  runCleanups,
  shared,
  storedItems,
  waitForRetention,
} from './ownership-lifecycle-support.js'
import type {
  Item,
  MetadataRecorder,
  MutationLifecycleSnapshot,
  MutationPublicationSnapshot,
} from './ownership-lifecycle-support.js'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { QueryFunctionContext } from '@tanstack/query-core'

import type { QueryCollectionUtils } from '../src/query.js'

describe(`query collection ownership lifecycle`, () => {
  afterEach(async () => {
    await runCleanups()
  })

  it(`starts the deferred replacement when the barrier resolves during a fetch`, async () => {
    const id = `deferred-result-in-flight`
    const barrier = createDeferred<void>()
    const inFlight = createDeferred<Array<Item>>()
    const initial = { ...shared, name: `Initial` }
    const replacement = { ...shared, name: `Replacement` }
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([initial])
      .mockImplementationOnce(() => inFlight.promise)
      .mockResolvedValue([replacement])
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      collection.deferDataRefresh = null
      barrier.resolve()
      inFlight.resolve([initial])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    collection.deferDataRefresh = barrier.promise
    void collection.utils.refetch().catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    collection.deferDataRefresh = null
    barrier.resolve()

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => {
      expect(collection.get(shared.id)?.name).toBe(replacement.name)
    })
  })

  /**
   * Error recovery law: a previous Query failure remains public while an
   * explicit retry is pending. A failed retry is another consecutive failure;
   * a successful retry clears the error. This follows the documented
   * `lastError`/`errorCount` reset-on-success contract. The model represents
   * only these three public error fields, not Collection status or row changes.
   *
   * The bounded history crosses a failed initial load, a failed background
   * refetch, or a failed Collection application with a held retry. One retry
   * holds Collection application after Query fetch success. A background
   * failure crosses an intermediate Query retry attempt before a held final
   * attempt. A repeated error at clock time zero distinguishes consecutive
   * failures from duplicate observer notifications. The real QueryClient and
   * `clearError()` are the driver.
   * The refinement check reads the public utils
   * when the retry starts but before its result settles, then after settlement.
   *
   * ORC-001: `query.ts` getter comments and the error-handling guide promise
   * reset on success. ORC-002/003/005: the three-state public model below is
   * separate from Query's timestamp and is checked at both named boundaries.
   * ORC-004/007: this is a bounded fixed matrix, not a generated property.
   * ORC-006: the original `clearError()` fails both initial pending cases;
   * an observer-success reset fails the application-error and held-application
   * cases; an unconditional error-result classifier recounts the old error
   * during a Query retry attempt; a zero timestamp sentinel fails the
   * epoch-zero repeated-error case.
   * ORC-008:
   * no model state is combined or removed. ORC-009: `retry pending` maps to
   * a held Query result; no new production concept is named. ORC-010: cleanup
   * settles the held result and retains primary assertion failures. ORC-011:
   * no plausible shared semantic helper needs a second formulation here.
   * The matrix does not cover concurrent retries for multiple tracked Queries,
   * mutation-handler fetch-boundary settlement, or deferred result application.
   */
  it.each([
    { priorFailure: `initial`, retryResult: `failure`, sameError: false },
    { priorFailure: `initial`, retryResult: `success`, sameError: false },
    { priorFailure: `background`, retryResult: `failure`, sameError: false },
    { priorFailure: `background`, retryResult: `success`, sameError: false },
    { priorFailure: `initial`, retryResult: `failure`, sameError: true },
  ] as const)(
    `keeps a $priorFailure error visible until a held retry $retryResult, same error $sameError`,
    async ({ priorFailure, retryResult, sameError }) => {
      const id = `held-error-retry-${priorFailure}-${retryResult}-${sameError}`
      const previousError = new Error(`previous failure`)
      const retryError = sameError ? previousError : new Error(`retry failure`)
      const heldResult = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const now = sameError ? vi.spyOn(Date, `now`).mockReturnValue(0) : null
      const queryFn = vi.fn<() => Promise<Array<Item>>>()
      if (priorFailure === `background`) {
        queryFn.mockResolvedValueOnce([shared])
      }
      queryFn.mockRejectedValueOnce(previousError)
      queryFn.mockImplementationOnce(() => heldResult.promise)
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `eager`,
          startSync: true,
          retry: false,
        }),
      )
      cleanups.push(async () => {
        consoleError.mockRestore()
        now?.mockRestore()
        heldResult.resolve([])
        await collection.cleanup()
        queryClient.clear()
      })

      if (priorFailure === `initial`) {
        await expect(collection.stateWhenReady()).rejects.toBe(previousError)
      } else {
        await collection.stateWhenReady()
        await expect(
          collection.utils.refetch({ throwOnError: true }),
        ).rejects.toBe(previousError)
      }

      const observeError = () => reportedError(collection)
      // An independent model. An initial error is final for its sync run, so
      // every later state reports it. After readiness, a pending retry keeps
      // the previous health error, a failed retry reports its own, and a
      // successful retry clears it.
      const expected =
        priorFailure === `initial`
          ? {
              pending: previousError,
              failure: previousError,
              success: previousError,
            }
          : { pending: previousError, failure: retryError, success: undefined }
      expect(observeError()).toEqual(expected.pending)

      const retry = collection.utils.refetch({ throwOnError: true }).then(
        () => ({ outcome: `fulfilled` as const }),
        (error: unknown) => ({ outcome: `rejected` as const, error }),
      )
      await vi.waitFor(() =>
        expect(queryFn).toHaveBeenCalledTimes(
          priorFailure === `initial` ? 2 : 3,
        ),
      )
      expect(observeError()).toEqual(expected.pending)

      if (retryResult === `failure`) {
        heldResult.reject(retryError)
        expect(await retry).toEqual({ outcome: `rejected`, error: retryError })
      } else {
        heldResult.resolve([shared])
        expect(await retry).toEqual({ outcome: `fulfilled` })
      }
      expect(observeError()).toEqual(expected[retryResult])
    },
  )

  it.each([`success`, `failure`] as const)(
    `retains an application error while a held retry reaches %s`,
    async (retryResult) => {
      const id = `held-application-error-retry-${retryResult}`
      const applicationError = new Error(`application failed`)
      const retryError = new Error(`retry failed`)
      const heldResult = createDeferred<Array<Item>>()
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockImplementationOnce(() => heldResult.promise)
      let failApplication = true
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => {
            if (failApplication) {
              failApplication = false
              throw applicationError
            }
            return item.id
          },
          syncMode: `eager`,
          startSync: true,
          retry: false,
        }),
      )
      cleanups.push(async () => {
        heldResult.resolve([shared])
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
          consoleError.mockRestore()
        }
      })
      let retry:
        | Promise<
            { outcome: `fulfilled` } | { outcome: `rejected`; error: unknown }
          >
        | undefined
      try {
        await expect(collection.stateWhenReady()).rejects.toBe(applicationError)
        expect(reportedError(collection)).toBe(applicationError)

        retry = collection.utils.refetch({ throwOnError: true }).then(
          () => ({ outcome: `fulfilled` as const }),
          (error: unknown) => ({ outcome: `rejected` as const, error }),
        )
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
        // Query still holds its old successful result, despite the failed
        // Collection application. A fetch-start success notification is not recovery.
        expect(reportedError(collection)).toBe(applicationError)

        if (retryResult === `failure`) {
          heldResult.reject(retryError)
          expect(await retry).toEqual({
            outcome: `rejected`,
            error: retryError,
          })
        } else {
          heldResult.resolve([shared])
          expect(await retry).toEqual({ outcome: `fulfilled` })
        }
        // The failed application was the initial load, so its error is final
        // for this sync run whatever the retry does.
        expect(reportedError(collection)).toBe(applicationError)
        expect(collection.status).toBe(`error`)
      } finally {
        heldResult.resolve([shared])
        await retry
      }
    },
  )

  it(`retains a Query error until a successful retry applies`, async () => {
    const id = `held-retry-application`
    const queryHash = hashKey([id])
    const previousError = new Error(`previous fetch failed`)
    const firstResult = createDeferred<Array<Item>>()
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [firstResult.promise, [shared]],
      syncMode: `on-demand`,
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    cleanups.push(() => {
      consoleError.mockRestore()
      return Promise.resolve()
    })

    try {
      const initialLoad = collection._sync.loadSubset({})
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      firstResult.reject(previousError)
      await expect(
        Promise.resolve(initialLoad === true ? undefined : initialLoad),
      ).rejects.toBe(previousError)
      expect(reportedError(collection)).toBe(previousError)
      expect(reportedError(collection)).toBeDefined()

      const retry = collection.utils.refetch({ throwOnError: true })
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(scanPersistedRows).toHaveBeenCalledOnce()
      })
      // Query has fetched successfully, but Collection application is held.
      expect(reportedError(collection)).toBe(previousError)
      expect(reportedError(collection)).toBeDefined()

      persistedScan.resolve([])
      await retry
      expect(reportedError(collection)).toBeUndefined()
    } finally {
      firstResult.resolve([])
      persistedScan.resolve([])
    }
  })

  /**
   * A completed failure remains visible until a later successful result
   * applies. The model counts terminal failures, including reuse of the same
   * Error object in one clock tick. The persisted scan holds the older success
   * between fetch completion and application; the public checkpoint is after
   * that scan is released. This does not exercise native SQLite persistence.
   */
  it.each([`clearError`, `reused-error`] as const)(
    `does not let an older held revalidation clear a newer Query error after %s`,
    async (retryMode) => {
      const id = `held-revalidation-newer-error`
      const queryHash = hashKey([id])
      const previousError = new Error(`initial fetch failed`)
      const newerError =
        retryMode === `reused-error`
          ? previousError
          : new Error(`later fetch failed`)
      const dateNow =
        retryMode === `reused-error`
          ? vi.spyOn(Date, `now`).mockReturnValue(1_000)
          : undefined
      const firstResult = createDeferred<Array<Item>>()
      const laterResult = createDeferred<Array<Item>>()
      const persistedScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const scanPersistedRows = vi.fn(() => persistedScan.promise)
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [firstResult.promise, [shared], laterResult.promise],
        syncMode: `on-demand`,
        scanPersistedRows,
        setupMetadata: (metadata) => {
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          })
        },
      })
      cleanups.push(() => {
        consoleError.mockRestore()
        dateNow?.mockRestore()
        return Promise.resolve()
      })

      try {
        const initialLoad = collection._sync.loadSubset({})
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
        firstResult.reject(previousError)
        await expect(
          Promise.resolve(initialLoad === true ? undefined : initialLoad),
        ).rejects.toBe(previousError)
        expect(reportedError(collection)).toBe(previousError)

        const firstRetry = (
          retryMode === `clearError`
            ? collection.utils.refetch({ throwOnError: true })
            : collection.utils.refetch({ throwOnError: true })
        ).then(
          () => ({ outcome: `fulfilled` as const }),
          (error: unknown) => ({ outcome: `rejected` as const, error }),
        )
        await vi.waitFor(() => {
          expect(queryFn).toHaveBeenCalledTimes(2)
          expect(scanPersistedRows).toHaveBeenCalledOnce()
        })
        expect(reportedError(collection)).toBe(previousError)

        const secondRetry = collection.utils.refetch({ throwOnError: true })
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
        laterResult.reject(newerError)
        await expect(secondRetry).rejects.toBe(newerError)
        expect(reportedError(collection)).toBe(newerError)
        expect(reportedError(collection)).toBeDefined()

        persistedScan.resolve([])
        expect(await firstRetry).toEqual({ outcome: `fulfilled` })
        expect(reportedError(collection)).toBe(newerError)
        expect(reportedError(collection)).toBeDefined()
      } finally {
        firstResult.resolve([])
        laterResult.resolve([])
        persistedScan.resolve([])
      }
    },
  )

  it.each([`success`, `failure`] as const)(
    `does not recount the previous error during a Query retry attempt ending in %s`,
    async (outcome) => {
      const id = `held-query-retry-attempt-${outcome}`
      const previousError = new Error(`previous fetch failed`)
      const attemptError = new Error(`retry attempt failed`)
      const finalError = new Error(`retry finally failed`)
      const heldResult = createDeferred<Array<Item>>()
      const queryFn = vi
        .fn<() => Promise<Array<Item>>>()
        .mockResolvedValueOnce([shared])
        .mockRejectedValueOnce(previousError)
        .mockRejectedValueOnce(attemptError)
        .mockImplementationOnce(() => heldResult.promise)
      const queryClient = createQueryClient()
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `eager`,
          startSync: true,
          retry: (count, error) => error === attemptError && count < 2,
          retryDelay: 0,
        }),
      )
      cleanups.push(async () => {
        heldResult.resolve([shared])
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
          consoleError.mockRestore()
        }
      })

      await collection.stateWhenReady()
      await expect(
        collection.utils.refetch({ throwOnError: true }),
      ).rejects.toBe(previousError)
      expect(reportedError(collection)).toBeDefined()
      const retry = collection.utils.refetch({ throwOnError: true }).then(
        () => ({ outcome: `fulfilled` as const }),
        (error: unknown) => ({ outcome: `rejected` as const, error }),
      )
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(4))
        // Query retains its old error while its first retry attempt has failed.
        expect(reportedError(collection)).toBe(previousError)
        expect(reportedError(collection)).toBeDefined()
        if (outcome === `success`) {
          heldResult.resolve([shared])
          expect(await retry).toEqual({ outcome: `fulfilled` })
          expect(reportedError(collection)).toBeUndefined()
        } else {
          heldResult.reject(finalError)
          expect(await retry).toEqual({
            outcome: `rejected`,
            error: finalError,
          })
          expect(reportedError(collection)).toBe(finalError)
          expect(reportedError(collection)).toBeDefined()
        }
      } finally {
        heldResult.resolve([shared])
        await retry
      }
    },
  )

  it(`starts an idle collection only when a direct write is invoked`, () => {
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `idle-direct-write-startup`,
        queryClient,
        queryKey: [`idle-direct-write-startup`],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    expect(collection.status).toBe(`idle`)
    expect(reportedError(collection)).toBeUndefined()
    expect(collection.status).toBe(`idle`)

    collection.utils.writeUpsert({
      id: `first`,
      category: `direct`,
      name: `First`,
    })

    expect(collection.status).toBe(`ready`)
    expect(rows(collection)).toEqual([`first`])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`fails fast when a direct write is attempted during deferred startup`, () => {
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id: `deferred-direct-write`,
        queryClient,
        queryKey: [`deferred-direct-write`],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    expect(collection._deferSyncStart()).toBe(true)
    for (const write of [
      () => collection.utils.writeInsert(shared),
      () => collection.utils.writeUpdate(shared),
      () => collection.utils.writeDelete(shared.id),
      () => collection.utils.writeUpsert(shared),
      () => collection.utils.writeBatch(() => {}),
    ]) {
      expect(write).toThrow(SyncNotInitializedError)
    }
    expect(collection.status).toBe(`idle`)
    expect(rows(collection)).toEqual([])

    collection._resumeSyncStart()
    expect(collection.status).toBe(`ready`)
    expect(rows(collection)).toEqual([])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`does not restart a cleaned-up idle collection for a direct write`, async () => {
    const id = `cleaned-idle-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn((): Promise<Array<Item>> => Promise.resolve([]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.cleanup()
    expect(() => collection.utils.writeUpsert(shared)).toThrow(
      SyncNotInitializedError,
    )
    expect(collection.status).toBe(`cleaned-up`)
    expect(rows(collection)).toEqual([])
    expect(queryFn).not.toHaveBeenCalled()
  })

  it(`rejects a late mutation write without restarting a cleaned-up collection`, async () => {
    const id = `late-mutation-after-cleanup`
    const queryKey = [id] as const
    const inserted = { id: `late`, category: `mutation`, name: `Late` }
    const serverRows: Array<Item> = []
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(serverRows)))
    let writeLate = (_item: Item) => {}
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onInsert: async ({ transaction }) => {
          handlerEntered.resolve()
          await releaseHandler.promise
          transaction.mutations.forEach(({ modified }) =>
            writeLate(structuredClone(modified)),
          )
        },
      }),
    )
    writeLate = (item) => collection.utils.writeUpsert(item)
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    expect(queryFn).toHaveBeenCalledOnce()

    const mutation = collection.insert(inserted)
    await handlerEntered.promise
    await collection.cleanup()
    releaseHandler.resolve()
    await expect(mutation.when('settled')).rejects.toBeInstanceOf(
      SyncNotInitializedError,
    )

    expect(collection.status).toBe(`cleaned-up`)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(itemIds(collection._state.syncedData.values())).toEqual([])
    expect(queryClient.getQueryData(queryKey)).toBeUndefined()
  })

  it.each([
    { ordered: false, settlementOrder: [0, 1] },
    { ordered: false, settlementOrder: [1, 0] },
    { ordered: true, settlementOrder: [0, 1] },
    { ordered: true, settlementOrder: [1, 0] },
  ] as const)(
    `publishes mutation refetches through source and downstream view: %j`,
    async ({ ordered, settlementOrder }) => {
      const id = `mutation-publication-${ordered ? `ordered` : `unordered`}-${settlementOrder.join(``)}`
      const queryClient = createQueryClient()
      const serverRows: Array<Item> = []
      const persistenceGates: Array<ReturnType<typeof createDeferred<void>>> =
        []
      const queryFn = vi.fn(() =>
        Promise.resolve(serverRows.map((item) => structuredClone(item))),
      )
      const collection = createCollection(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          startSync: true,
          onInsert: async ({ transaction, collection }) => {
            const gate = createDeferred<void>()
            persistenceGates.push(gate)
            await gate.promise
            serverRows.push(
              ...transaction.mutations.map(({ modified }) =>
                structuredClone(modified),
              ),
            )
            await collection.utils.refetch()
          },
        }),
      )
      const derived = createLiveQueryCollection((query) => {
        const source = query.from({ item: collection })
        const result = ordered
          ? source.orderBy(({ item }) => item.name, `asc`)
          : source
        return result.select(({ item }) => ({ ...item }))
      })
      const publications: Array<MutationPublicationSnapshot> = []
      let expectedPublication: Array<string> = []
      const subscription = derived.subscribeChanges(() => {
        publications.push({
          source: ordered
            ? [...collection.toArray]
                .sort((left, right) => left.name.localeCompare(right.name))
                .map(({ id: rowId }) => rowId)
            : rows(collection),
          derived: ordered
            ? derived.toArray.map(({ id: rowId }) => rowId)
            : rows(derived),
          expected: expectedPublication,
        })
      })
      cleanups.push(async () => {
        persistenceGates.forEach((gate) => gate.resolve())
        subscription.unsubscribe()
        await derived.cleanup()
        await collection.cleanup()
        queryClient.clear()
      })

      const firstItem = {
        id: `z-first`,
        category: `mutation`,
        name: `1-first`,
      }
      const secondItem = {
        id: `a-second`,
        category: `mutation`,
        name: `2-second`,
      }
      await derived.preload()
      expectedPublication = [firstItem.id]
      const first = collection.insert(firstItem)
      const visibleIds = [firstItem.id, secondItem.id]
      expectedPublication = ordered ? visibleIds : [...visibleIds].sort()
      const second = collection.insert(secondItem)
      const transactions = [first, second]
      const items = [firstItem, secondItem]
      const queryKey = [id] as const
      const capture = (): MutationLifecycleSnapshot => ({
        server: itemIds(serverRows),
        cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
        derived: ordered
          ? derived.toArray.map(({ id: rowId }) => rowId)
          : itemIds(derived.toArray),
      })

      expect(persistenceGates).toHaveLength(2)
      expect(queryFn).toHaveBeenCalledOnce()
      expectMutationLifecycleSnapshot(capture(), [], visibleIds, ordered)

      const settled = new Set<number>()
      for (const transactionIndex of settlementOrder) {
        persistenceGates[transactionIndex]!.resolve()
        await transactions[transactionIndex]!.when('settled')
        settled.add(transactionIndex)

        const authoritativeIds = [...settled].map((index) => items[index]!.id)
        expect(queryFn).toHaveBeenCalledTimes(1 + settled.size)
        const expectedSynced =
          settled.size === transactions.length ? authoritativeIds : []
        expect(capture()).toEqual({
          server: [...authoritativeIds].sort(),
          cache: [...authoritativeIds].sort(),
          synced: [...expectedSynced].sort(),
          source: [...visibleIds].sort(),
          derived: ordered ? visibleIds : [...visibleIds].sort(),
        })
        expectMutationPublicationIntegrity(publications)
        expect(publications.at(-1)?.derived).toEqual(
          ordered ? visibleIds : [...visibleIds].sort(),
        )
      }

      const thirdItem = {
        id: `m-third`,
        category: `mutation`,
        name: `3-third`,
      }
      const allVisibleIds = [...visibleIds, thirdItem.id]
      expectedPublication = ordered ? allVisibleIds : [...allVisibleIds].sort()
      const third = collection.insert(thirdItem)
      expect(persistenceGates).toHaveLength(3)
      expectMutationLifecycleSnapshot(
        capture(),
        visibleIds,
        allVisibleIds,
        ordered,
      )

      persistenceGates[2]!.resolve()
      await third.when('settled')

      expect(queryFn).toHaveBeenCalledTimes(4)
      expectMutationLifecycleSnapshot(
        capture(),
        allVisibleIds,
        allVisibleIds,
        ordered,
      )
      expectMutationPublicationIntegrity(publications)
      expect(publications.at(-1)?.derived).toEqual(
        ordered ? allVisibleIds : [...allVisibleIds].sort(),
      )
    },
  )

  it(`rejects incomplete and misordered mutation publication receipts`, () => {
    const visible = [`z-first`, `a-second`, `m-third`]
    const valid: MutationLifecycleSnapshot = {
      server: [...visible].sort(),
      cache: [...visible].sort(),
      synced: [...visible].sort(),
      source: [...visible].sort(),
      derived: visible,
    }

    expectMutationLifecycleSnapshot(valid, visible, visible, true)
    for (const mutant of [
      { ...valid, synced: [] },
      { ...valid, source: [] },
      { ...valid, derived: visible.slice(0, 2) },
      { ...valid, derived: [...visible].reverse() },
      { ...valid, source: [...valid.source, `stale`] },
    ]) {
      expect(() =>
        expectMutationLifecycleSnapshot(mutant, visible, visible, true),
      ).toThrow()
    }
  })

  it(`rejects a torn intermediate publication before a complete final snapshot`, () => {
    const first = [`z-first`]
    const firstAndSecond = [`z-first`, `a-second`]
    const allVisible = [`z-first`, `a-second`, `m-third`]
    const legitimateSequence: Array<MutationPublicationSnapshot> = [
      { source: first, derived: first, expected: first },
      {
        source: firstAndSecond,
        derived: firstAndSecond,
        expected: firstAndSecond,
      },
      { source: allVisible, derived: allVisible, expected: allVisible },
    ]

    expect(() =>
      expectMutationPublicationIntegrity(legitimateSequence),
    ).not.toThrow()
    expect(() =>
      expectMutationPublicationIntegrity([
        ...legitimateSequence.slice(0, 2),
        { source: [], derived: [], expected: allVisible },
        legitimateSequence[2]!,
      ]),
    ).toThrow()
  })

  it(`supersedes a stale focus result before publishing a newer mutation snapshot`, async () => {
    const id = `focus-result-supersession`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const retired = { id: `b`, category: `mutation`, name: `B` }
    const inserted = { id: `c`, category: `mutation`, name: `C` }
    const serverRows = [initial, retired]
    const firstFocus = createDeferred<Array<Item>>()
    const secondFocus = createDeferred<Array<Item>>()
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient(false, 0)
    let queryCalls = 0
    const queryFn = vi.fn(() => {
      queryCalls++
      if (queryCalls === 2) return firstFocus.promise
      if (queryCalls === 3) return secondFocus.promise
      return Promise.resolve(structuredClone(serverRows))
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
        staleTime: 0,
        refetchOnWindowFocus: true,
        onInsert: async ({ transaction }) => {
          serverRows.splice(
            0,
            serverRows.length,
            initial,
            ...transaction.mutations.map(({ modified }) =>
              structuredClone(modified),
            ),
          )
          handlerEntered.resolve()
          await releaseHandler.promise
        },
      }),
    )
    const derived = createLiveQueryCollection((query) =>
      query.from({ item: collection }).select(({ item }) => ({
        id: item.id,
        category: item.category,
        name: item.name,
      })),
    )
    const sourcePublications: Array<Array<string>> = []
    const derivedPublications: Array<MutationPublicationSnapshot> = []
    const sourceSubscription = collection.subscribeChanges(() => {
      sourcePublications.push(itemIds(collection.toArray))
    })
    const derivedSubscription = derived.subscribeChanges(() => {
      const source = itemIds(collection.toArray)
      derivedPublications.push({
        source,
        derived: itemIds(derived.toArray),
        expected: source,
      })
    })
    cleanups.push(async () => {
      releaseHandler.resolve()
      sourceSubscription.unsubscribe()
      derivedSubscription.unsubscribe()
      await derived.cleanup()
      await collection.cleanup()
      queryClient.clear()
      focusManager.setFocused(undefined)
    })

    await derived.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    sourcePublications.length = 0
    derivedPublications.length = 0

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    const mutation = collection.insert(inserted)
    await handlerEntered.promise
    firstFocus.resolve([structuredClone(initial)])
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(`idle`),
    )

    let waiterOutcome: `pending` | `resolved` | `rejected` = `pending`
    const waiter = Promise.resolve(collection._sync.loadSubset({})).then(
      () => {
        waiterOutcome = `resolved`
      },
      (error) => {
        waiterOutcome = `rejected`
        throw error
      },
    )

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    secondFocus.resolve(structuredClone(serverRows))
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(`idle`),
    )

    releaseHandler.resolve()
    await mutation.when('settled')
    await waiter
    await vi.waitFor(() =>
      expect(itemIds(derived.toArray)).toEqual([initial.id, inserted.id]),
    )

    expect(waiterOutcome).toBe(`resolved`)
    expect(sourcePublications).not.toContainEqual([initial.id])
    for (const publication of sourcePublications) {
      expect([
        [initial.id, inserted.id],
        [initial.id, retired.id, inserted.id].sort(),
      ]).toContainEqual(publication)
    }
    expectMutationPublicationIntegrity(derivedPublications)
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
      derived: itemIds(derived.toArray),
    }).toEqual({
      cache: [initial.id, inserted.id],
      synced: [initial.id, inserted.id],
      source: [initial.id, inserted.id],
      derived: [initial.id, inserted.id],
    })

    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => {
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
        derived: itemIds(derived.toArray),
      }).toEqual({ synced: [], source: [], derived: [] })
    })
  })

  it(`removes rows superseded while an older result is publishing`, async () => {
    const id = `reentrant-committed-result-supersession`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const updated = { ...initial, name: `A from server` }
    const orphaned = { id: `c`, category: `result`, name: `C` }
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const onUpdate = vi.fn(async () => {
      handlerEntered.resolve()
      await releaseHandler.promise
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onUpdate,
      }),
    )
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const mutation = collection.update(initial.id, (draft) => {
      draft.name = `A optimistic`
    })
    await handlerEntered.promise

    const publications: Array<Array<string>> = []
    let superseded = false
    const subscription = collection.subscribeChanges(() => {
      const ids = itemIds(collection.toArray)
      publications.push(ids)
      if (!superseded && ids.includes(orphaned.id)) {
        superseded = true
        queryClient.setQueryData(queryKey, [updated, sibling])
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    queryClient.setQueryData(queryKey, [updated, sibling, orphaned])
    expect(itemIds(collection._state.syncedData.values())).toEqual([
      initial.id,
      sibling.id,
    ])

    releaseHandler.resolve()
    await mutation.when('settled')
    await collection._sync.loadSubset({})

    expect(queryFn).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(superseded).toBe(true)
    expect(publications).toContainEqual([initial.id, sibling.id, orphaned.id])
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({
      cache: [initial.id, sibling.id],
      synced: [initial.id, sibling.id],
      source: [initial.id, sibling.id],
    })
    expect(
      persistedOwners(collection._state.syncedMetadata, orphaned.id),
    ).toEqual([])
  })

  it(`retains ownership after a publication listener throws`, async () => {
    const id = `failed-result-publication`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const transient = { id: `c`, category: `result`, name: `C` }
    const publicationError = new Error(`Publication failed`)
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    let threw = false
    const subscription = collection.subscribeChanges(() => {
      if (!threw && collection.has(transient.id)) {
        threw = true
        throw publicationError
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    queryClient.setQueryData(queryKey, [initial, sibling, transient])
    await vi.waitFor(() => expect(threw).toBe(true))
    queryClient.setQueryData(queryKey, [initial, sibling])
    await collection._sync.loadSubset({})

    expect(queryFn).toHaveBeenCalledOnce()
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({
      cache: [initial.id, sibling.id],
      synced: [initial.id, sibling.id],
      source: [initial.id, sibling.id],
    })
    expect(
      persistedOwners(collection._state.syncedMetadata, transient.id),
    ).toEqual([])
  })

  it(`reports a reentrant initial replacement failure before readiness`, async () => {
    const id = `failed-initial-result-replacement`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const invalid = { id: `invalid`, category: `result`, name: `Invalid` }
    const applicationError = new Error(`Replacement application failed`)
    const firstResult = createDeferred<Array<Item>>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => firstResult.promise)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => {
          if (item.id === invalid.id) throw applicationError
          return item.id
        },
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      firstResult.resolve([initial])
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    collection.startSyncImmediate()
    expect(collection.status).toBe(`loading`)
    let replaced = false
    const subscription = collection.subscribeChanges(() => {
      if (!replaced && collection.has(initial.id)) {
        replaced = true
        queryClient.setQueryData(queryKey, [invalid])
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    firstResult.resolve([initial])
    await vi.waitFor(() => expect(collection.status).toBe(`error`))

    expect(queryFn).toHaveBeenCalledOnce()
    expect(replaced).toBe(true)
    expect(reportedError(collection)).toBe(applicationError)
    expect(itemIds(collection.toArray)).toEqual([initial.id])
  })

  it(`releases provisional ownership when commit fails before publication`, async () => {
    const id = `failed-prepublication-commit`
    const detailSubset = { where: eq(new IR.PropRef([`category`]), `detail`) }
    const listSubset = { where: eq(new IR.PropRef([`category`]), `list`) }
    const detailKey = [id, getLoadSubsetDemandKey(detailSubset)] as const
    const detail = { id: `a`, category: `detail`, name: `A` }
    const list = { id: `c`, category: `list`, name: `C` }
    const commitError = new Error(`Commit failed before publication`)
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce([detail])
      .mockResolvedValueOnce([list])
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const baseOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
    })
    const originalSync = baseOptions.sync
    let failNextCommit = false
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            commit: (signal) => {
              if (failNextCommit) {
                failNextCommit = false
                throw commitError
              }
              return params.commit(signal)
            },
          }),
      },
    })
    cleanups.push(async () => {
      collection._sync.unloadSubset(detailSubset)
      collection._sync.unloadSubset(listSubset)
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset(detailSubset)
    expect(itemIds(collection.toArray)).toEqual([detail.id])

    failNextCommit = true
    queryClient.setQueryData(detailKey, [detail, list])
    await vi.waitFor(() => expect(reportedError(collection)).toBe(commitError))
    expect(itemIds(collection.toArray)).toEqual([detail.id])

    await collection._sync.loadSubset(listSubset)
    expect(itemIds(collection.toArray)).toEqual([detail.id, list.id])
    collection._sync.unloadSubset(listSubset)
    await vi.waitFor(() =>
      expect(itemIds(collection.toArray)).toEqual([detail.id]),
    )
  })

  it(`retires a publishing result when its final subset unloads`, async () => {
    const id = `reentrant-result-unload`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const updated = { ...initial, name: `A from server` }
    const orphaned = { id: `c`, category: `result`, name: `C` }
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([initial, sibling]))
    const onUpdate = vi.fn(async () => {
      handlerEntered.resolve()
      await releaseHandler.promise
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
        onUpdate,
      }),
    )
    cleanups.push(async () => {
      releaseHandler.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    let unloaded = false
    const subscription = collection.subscribeChanges(() => {
      if (!unloaded && collection.has(orphaned.id)) {
        unloaded = true
        collection._sync.unloadSubset({})
      }
    })
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))

    const mutation = collection.update(initial.id, (draft) => {
      draft.name = `A optimistic`
    })
    await handlerEntered.promise
    queryClient.setQueryData(queryKey, [updated, sibling, orphaned])
    expect(itemIds(collection._state.syncedData.values())).toEqual([
      initial.id,
      sibling.id,
    ])

    releaseHandler.resolve()
    await mutation.when('settled')
    await vi.waitFor(() => expect(unloaded).toBe(true))
    await vi.waitFor(() => {
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
      }).toEqual({ synced: [], source: [] })
    })

    expect(queryFn).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(
      persistedOwners(collection._state.syncedMetadata, orphaned.id),
    ).toEqual([])
  })

  /**
   * Releasing and then reacquiring one demand creates a new active claim. An
   * older release may publish later, but it cannot erase that newer claim. The
   * independent model removes the first claim, adds the second, and leaves the
   * shared row until the second release. The unrelated blocker only delays
   * publication.
   */
  it(`keeps a reacquired claim across an older release publication`, async () => {
    const id = `reacquired-claim-old-release`
    const detail = categorySubset(`detail`)
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared]],
      staleTime: Number.POSITIVE_INFINITY,
    })
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })

    await collection._sync.loadSubset(detail)
    mutation.mutate(() => collection.insert(blocker))
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
    })

    const pendingBefore = collection._state.pendingSyncedTransactions.length
    collection._sync.unloadSubset(detail)
    await vi.waitFor(() =>
      expect(
        collection._state.pendingSyncedTransactions.length,
      ).toBeGreaterThan(pendingBefore),
    )
    const pendingAfterRelease =
      collection._state.pendingSyncedTransactions.length
    const reacquired = Promise.resolve(collection._sync.loadSubset(detail))
    void reacquired.catch(() => undefined)
    await vi.waitFor(() =>
      expect(
        collection._state.pendingSyncedTransactions.length,
      ).toBeGreaterThan(pendingAfterRelease),
    )

    persistence.resolve()
    await mutation.when('settled')
    await reacquired
    await vi.waitFor(() => expect(rows(collection)).toEqual([shared.id]))

    collection._sync.unloadSubset(detail)
    await vi.waitFor(() => expect(rows(collection)).toEqual([]))
    expect(queryFn).toHaveBeenCalledOnce()
  })

  // Retention cleanup runs on a real 10 ms GC timer followed by a storage
  // scan and a sync transaction. A loaded CI runner can take longer than the
  // default 1 s wait, so these witnesses wait up to 5 s for it.
  const retentionWait = { timeout: 5_000 }
  // Longer than a wait, so a stuck wait reports its own observation.
  const retentionTestTimeout = 20_000

  /**
   * ## A claim made during a held retention cleanup does not publish the cleaned owner
   *
   * Law: each publication records only the observer leases that still own a
   * row. A persisted retention entry keeps its Query's owner edges until its
   * time-to-live expires. The expiry then removes those edges in a sync
   * transaction. That transaction is accepted but held behind an optimistic
   * blocker, so the edges stay applied while a claim of the same row runs. The
   * claim must not copy the removed owner back into its own publication. Its
   * owners come from the pending cleanup and the claimant's own edge, never
   * from an applied edge whose owner has already been retired.
   *
   * Authority: the published-owner law above, under which a released lease is
   * not an owner even while its release waits behind held publication, and
   * the retention rule that expiry releases the Query's owner edges.
   *
   * Reference: one row shared by a retained `detail` demand and a `list` demand
   * that claims it during the cleanup hold. After publication the row has one
   * owner, `list`.
   *
   * History: load `detail`, hold publication behind an optimistic blocker,
   * unload `detail` so that its retention is recorded, wait for the expiry to
   * start its cleanup transaction, load `list`, then publish. The checkpoint
   * reads the applied owners.
   *
   * Why it fails: the expiry's cleanup deletes the row, because `detail` was
   * its only owner, and retires the released Query's owner tracking when the
   * cleanup commits, before the cleanup applies. The claim is an insert of the
   * deleted row. Its owner read runs before its own insert, and the newest
   * transaction has no write for the row there. So the read takes the applied
   * edge for `detail`, and the released-owner filter, with no tracking entry,
   * keeps it. The published owners then include `detail`. The claim's insert
   * clear and the `??` fallback are not the trigger. Dropping the fallback alone
   * leaves this history failing, so it does not discriminate that repair. The
   * peer history below isolates the update path.
   *
   * Observation: this fixture has no DbClient, so the applied metadata is read
   * from `collection._state.syncedMetadata`.
   *
   * Limits: one row, one retained demand, one claimant, a 10 ms time-to-live
   * on real timers, and an in-memory baseline (the persisted scan returns no
   * rows). The history checks the applied owners after publication. It does
   * not model the hydrated client or a row that a claimant removes while the
   * cleanup is held.
   */
  it(
    `does not publish a retention-cleaned owner through a claim made during the cleanup hold`,
    async () => {
      const id = `retention-cleanup-hold-claim`
      const detail = categorySubset(`detail`)
      const list = categorySubset(`list`)
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const { collection } = createOwnershipFixture({
        id,
        results: [[shared], [shared]],
        persistedGcTime: 10,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        await mutation.when('settled').catch(() => undefined)
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      await collection._sync.loadSubset(detail)
      // Earlier result transactions apply first, so the count below grows only
      // with the expiry's held transaction.
      await waitForRetention(
        () =>
          expect(collection._state.pendingSyncedTransactions).toHaveLength(0),
        retentionWait,
      )
      mutation.mutate(() => collection.insert(blocker))
      collection._sync.unloadSubset(detail)
      const pendingBeforeExpiry =
        collection._state.pendingSyncedTransactions.length
      // The expiry's owner release is accepted but held behind the blocker.
      await waitForRetention(
        () =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(pendingBeforeExpiry),
        retentionWait,
      )
      const claimed = Promise.resolve(collection._sync.loadSubset(list))
      void claimed.catch(() => undefined)
      await settleTurn()
      persistence.resolve()
      await mutation.when('settled')
      await settleTurn()
      await claimed

      expect({
        rows: rows(collection),
        owners: persistedOwners(collection._state.syncedMetadata, shared.id)
          .length,
      }).toEqual({
        rows: [shared.id],
        owners: 1,
      })
    },
    retentionTestTimeout,
  )

  /**
   * ## A retention-cleaned owner does not keep its row after the claimant releases
   *
   * Law: a row stays public while a committed owner needs it. After the
   * retention cleanup, `list` is the row's only owner, and `detail` has been
   * released. Releasing `list` must therefore let the row go once its own
   * retention expires. A released demand's edge must not keep the row alive.
   *
   * Authority: the published-owner law above, under which a released lease is
   * not an owner, and the retention rule that expiry releases the Query's
   * owner edges. This is the identity observation for the count in the
   * claim-during-cleanup-hold history above. The count cannot say which owner
   * it is, so this sibling releases the claimant and watches the row.
   *
   * Reference: the same history as above, with the claim published. The
   * expected public rows after `list` releases and its retention expires are
   * none.
   *
   * History: the claim-during-cleanup-hold history, then unload `list` with no
   * further hold. The checkpoint waits for the row to leave the collection.
   *
   * Why it fails: the stale `detail` edge that the cleanup should have retired
   * stays in the applied owners, so the row survives the claimant's release.
   *
   * Limits: the same as the claim-during-cleanup-hold history. The row is
   * observed through the public collection rows, and the owner set is not
   * read.
   */
  it(
    `removes a retention-cleaned row once its claimant releases it`,
    async () => {
      const id = `retention-cleanup-hold-release`
      const detail = categorySubset(`detail`)
      const list = categorySubset(`list`)
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const { collection } = createOwnershipFixture({
        id,
        results: [[shared], [shared]],
        persistedGcTime: 10,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        await mutation.when('settled').catch(() => undefined)
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      await collection._sync.loadSubset(detail)
      // Earlier result transactions apply first, so the count below grows only
      // with the expiry's held transaction.
      await waitForRetention(
        () =>
          expect(collection._state.pendingSyncedTransactions).toHaveLength(0),
        retentionWait,
      )
      mutation.mutate(() => collection.insert(blocker))
      collection._sync.unloadSubset(detail)
      const pendingBeforeExpiry =
        collection._state.pendingSyncedTransactions.length
      await waitForRetention(
        () =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(pendingBeforeExpiry),
        retentionWait,
      )
      const claimed = Promise.resolve(collection._sync.loadSubset(list))
      void claimed.catch(() => undefined)
      await settleTurn()
      persistence.resolve()
      await mutation.when('settled')
      await settleTurn()
      await claimed

      collection._sync.unloadSubset(list)
      await waitForRetention(
        () => expect(rows(collection)).toEqual([]),
        retentionWait,
      )
    },
    retentionTestTimeout,
  )

  /**
   * ## A claimed row with no retention history is collected on release
   *
   * Law: a row whose only owner releases it leaves the collection once that
   * owner's retention expires. This control runs the release step of the
   * sibling above without a prior demand, so a failure there can be attributed
   * to the stale owner edge rather than to the release or expiry.
   *
   * Authority: the retention rule that expiry releases the Query's owner
   * edges, and the published-owner law (a released lease is not an owner).
   *
   * Reference: one row `shared` claimed by `list` alone. After `list` releases
   * and its retention expires, no rows remain.
   *
   * History: load `list`, unload it, and wait for the row to leave.
   *
   * Limits: one row, one demand, a 10 ms time-to-live on real timers, and an
   * in-memory baseline.
   */
  it(
    `collects a claimed row with no retention history once its claimant releases it`,
    async () => {
      const id = `retention-release-control`
      const list = categorySubset(`list`)
      const { collection } = createOwnershipFixture({
        id,
        results: [[shared]],
        persistedGcTime: 10,
        scanPersistedRows: () => Promise.resolve([]),
      })

      await collection._sync.loadSubset(list)
      expect(rows(collection)).toEqual([shared.id])

      collection._sync.unloadSubset(list)
      await waitForRetention(
        () => expect(rows(collection)).toEqual([]),
        retentionWait,
      )
    },
    retentionTestTimeout,
  )

  /**
   * ## A held cleanup does not publish a released owner beside a surviving peer
   *
   * Law: each publication records only the observer leases that still own a
   * row. When a retention expiry releases one owner of a row that another lease
   * still owns, the expiry removes only the released owner's edge, and the row
   * stays public. A claim made while that release is held reads the pending
   * release, so it publishes the peer and itself, and not the released owner.
   *
   * Authority: the published-owner law above, under which a released lease is
   * not an owner even while its release waits behind held publication, and the
   * retention rule that expiry releases the Query's owner edges.
   *
   * Reference: one row `shared`, owned by a retained `detail` demand and a
   * surviving `peer` demand. A `list` claim during the cleanup hold publishes
   * exactly two owners, `peer` and `list`, and not `detail`.
   *
   * History: load `detail`, load `peer`, hold publication behind an optimistic
   * blocker, unload `detail` so that its retention is recorded, wait for the
   * expiry to start its cleanup transaction, load `list`, then publish.
   *
   * Why it fails: the expiry's cleanup writes the row's owners as `{ peer }`,
   * but that write is in an older pending transaction. The claim's read sees
   * only its own newest transaction. The row is present, so the claim is an
   * update and the read has no write to find. The read takes the applied
   * `{ detail, peer }`. The cleanup has already retired `detail`'s tracking, so
   * the released-owner filter keeps `detail`. The claim is an update, so the
   * insert clear and the `??` fallback are not involved. This history therefore
   * fails with the fallback kept and with it removed, and passes only when the
   * read sees the pending owner set or the released tombstone outlives the
   * cleanup's commit.
   *
   * Observation: this fixture has no DbClient, so the applied metadata is read
   * from `collection._state.syncedMetadata`.
   *
   * Limits: one row, three demands, a 10 ms time-to-live on real timers, and an
   * in-memory baseline. It does not model a row that a claimant removes while
   * the cleanup is held.
   */
  it(
    `does not publish a released owner beside a surviving peer through a held cleanup`,
    async () => {
      const id = `retention-cleanup-peer-claim`
      const detail = categorySubset(`detail`)
      const peer = categorySubset(`peer`)
      const list = categorySubset(`list`)
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const { collection } = createOwnershipFixture({
        id,
        results: [[shared], [shared], [shared]],
        persistedGcTime: 10,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        await mutation.when('settled').catch(() => undefined)
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      await collection._sync.loadSubset(detail)
      await collection._sync.loadSubset(peer)
      // Earlier result transactions apply first, so the count below grows only
      // with the expiry's held transaction.
      await waitForRetention(
        () =>
          expect(collection._state.pendingSyncedTransactions).toHaveLength(0),
        retentionWait,
      )
      mutation.mutate(() => collection.insert(blocker))
      collection._sync.unloadSubset(detail)
      const pendingBeforeExpiry =
        collection._state.pendingSyncedTransactions.length
      // The expiry's owner release is accepted but held behind the blocker.
      await waitForRetention(
        () =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(pendingBeforeExpiry),
        retentionWait,
      )
      const claimed = Promise.resolve(collection._sync.loadSubset(list))
      void claimed.catch(() => undefined)
      await settleTurn()
      persistence.resolve()
      await mutation.when('settled')
      await settleTurn()
      await claimed

      expect({
        rows: rows(collection),
        owners: persistedOwners(collection._state.syncedMetadata, shared.id)
          .length,
      }).toEqual({
        rows: [shared.id],
        owners: 2,
      })
    },
    retentionTestTimeout,
  )

  /**
   * ## A hydrated release of a held-cleanup row needs a recorded owner to keep it
   *
   * Law: a row stays public while a committed owner needs it. In the surviving
   * peer history above, the released `detail` is not an owner, so its edge
   * must not keep the row alive after `peer` and `list` release. A live
   * collection cannot show this, because its applied owners are already
   * filtered. The stored owners do show it: a hydrated client trusts every
   * recorded owner.
   *
   * Authority: the published-owner law above, under which a released lease is
   * not an owner, and the hydration rule of the published-owner histories, a
   * hydrated row stays while any recorded owner remains. The count in the peer
   * history cannot name the owner, so this sibling reads the stored owners
   * through a hydrated release.
   *
   * Reference: the surviving-peer history, dehydrated after publication. A
   * browser client that loads and then releases `peer` and `list` has no
   * recorded owner left, so the row leaves.
   *
   * History: the surviving-peer history, with its stored metadata for `shared`
   * taken as the hydration input. A fresh browser DbClient hydrates it over the
   * same collection id. The browser loads and releases `peer` and `list`, and
   * the checkpoint reads its rows. The fixture is the server because it supplies
   * the persisted scan that retention needs, and a DbClient collection here does
   * not. The stored metadata is the owner set that `dehydrate` would publish.
   *
   * Why it fails: the stale `detail` edge stays in the stored owners, so the
   * hydrated row survives after its last real owners release.
   *
   * Limits: one row, three demands, a 10 ms server time-to-live, and a browser
   * with no retention. It does not model a browser that holds the release.
   */
  it(
    `hydrated clients drop a held-cleanup row once its peer and claimant release it`,
    async () => {
      const id = `retention-cleanup-peer-hydrated`
      const detail = categorySubset(`detail`)
      const peer = categorySubset(`peer`)
      const list = categorySubset(`list`)
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      // The fixture supplies the persisted scan that makes retention expire.
      const { collection } = createOwnershipFixture({
        id,
        results: [[shared], [shared], [shared]],
        persistedGcTime: 10,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        await mutation.when('settled').catch(() => undefined)
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      await collection._sync.loadSubset(detail)
      await collection._sync.loadSubset(peer)
      // Earlier result transactions apply first, so the count below grows only
      // with the expiry's held transaction.
      await waitForRetention(
        () =>
          expect(collection._state.pendingSyncedTransactions).toHaveLength(0),
        retentionWait,
      )
      mutation.mutate(() => collection.insert(blocker))
      collection._sync.unloadSubset(detail)
      const pendingBeforeExpiry =
        collection._state.pendingSyncedTransactions.length
      await waitForRetention(
        () =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(pendingBeforeExpiry),
        retentionWait,
      )
      const claimed = Promise.resolve(collection._sync.loadSubset(list))
      void claimed.catch(() => undefined)
      await settleTurn()
      persistence.resolve()
      await mutation.when('settled')
      await settleTurn()
      await claimed

      // The stored metadata of the row is the state that a dehydrate publishes.
      const state = {
        collections: [
          {
            collectionId: id,
            rows: [
              {
                key: shared.id,
                value: shared,
                metadata: collection._state.syncedMetadata.get(shared.id),
              },
            ],
          },
        ],
      }
      const browser = createSharedRowClient(id)
      cleanups.push(async () => {
        await browser.client.cleanup()
        browser.queryClient.clear()
      })
      browser.client.hydrate(state)
      const hydrated = browser.client.collection(browser.descriptor)
      await hydrated._sync.loadSubset(peer)
      await hydrated._sync.loadSubset(list)
      hydrated._sync.unloadSubset(peer)
      hydrated._sync.unloadSubset(list)
      await waitForRetention(
        () => expect(rows(hydrated)).toEqual([]),
        retentionWait,
      )
    },
    retentionTestTimeout,
  )

  /**
   * ## A held owner stays published beside a later claim of its row
   *
   * Law: each publication records every observer lease that still owns a row.
   * A lease whose result is held behind publication already owns its rows in
   * memory. A later lease that claims the same row while that result is held
   * must publish both leases as owners. It must not overwrite the held owner
   * with its own edge alone, because the held owner's edge is not yet visible
   * in the applied metadata.
   *
   * Authority: the published-owner law above (a row remains public while any
   * committed owner needs it, and publication records the owner set), and the
   * accepted-edge rule in the ownership read: accepted in-memory edges
   * supplement owners whose metadata has not published yet.
   *
   * Reference: one row `shared`. `detail` and `list` both need it. Publication
   * is held, so neither edge has published. After release, the published owners
   * are exactly `detail` and `list`.
   *
   * History: hold publication behind an optimistic blocker, load `detail` and
   * leave its result held, load `list` for the same row, release the blocker,
   * then publish. The checkpoint reads the applied owners.
   *
   * Why it fails when the in-memory supplement is ignored: the claim reads only
   * the applied metadata, which has no owner for the row. It publishes `{list}`
   * and drops the held `detail` edge.
   *
   * Observation: this fixture has no DbClient, so the applied metadata is read
   * from `collection._state.syncedMetadata`.
   *
   * Limits: one row, two demands, one blocker, in-memory on-demand loads, and no
   * persistence.
   */
  it(`publishes a held owner beside a later claim of its row`, async () => {
    const id = `held-owner-beside-claim`
    const detail = categorySubset(`detail`)
    const list = categorySubset(`list`)
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const { collection } = createOwnershipFixture({
      id,
      results: [[shared], [shared]],
    })
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
    })
    const settleTurn = async () => {
      for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    mutation.mutate(() => collection.insert(blocker))
    const held = Promise.resolve(collection._sync.loadSubset(detail))
    void held.catch(() => undefined)
    await settleTurn()
    const claimed = Promise.resolve(collection._sync.loadSubset(list))
    void claimed.catch(() => undefined)
    await settleTurn()
    persistence.resolve()
    await mutation.when('settled')
    await settleTurn()
    await Promise.all([held, claimed])

    expect({
      rows: rows(collection),
      owners: persistedOwners(collection._state.syncedMetadata, shared.id)
        .length,
    }).toEqual({
      rows: [shared.id],
      owners: 2,
    })
  })

  /**
   * ## A hydrated release keeps a held owner's row while the held owner is recorded
   *
   * Law: a row stays public while a committed owner needs it. In the held-owner
   * history above, `detail` and `list` both own the row, and publication
   * records both. A browser that hydrates the published state and releases
   * `list` must keep the row through the recorded `detail` owner.
   *
   * Authority: the published-owner law above (publication records the owner
   * set, and a row remains public while any committed owner needs it), and the
   * hydration rule that a hydrated row stays while any recorded owner remains.
   * The count in that history cannot name the owner. A live collection cannot
   * show the drop either, because its in-memory `detail` lease still holds the
   * row, so this sibling reads the stored owners through a hydrated release.
   *
   * Reference: the held-owner history, dehydrated after publication. A browser
   * that loads and releases `list` keeps `shared`, because `detail` is recorded.
   *
   * History: the held-owner history on a server DbClient, dehydrate it, and
   * hydrate a fresh browser DbClient over the same collection. The browser loads
   * and then releases `list`. The checkpoint reads its rows after the release
   * settles.
   *
   * Why it fails: publication dropped the held `detail` edge, so the stored
   * owners hold only `list`. Releasing `list` in the browser removes the row.
   *
   * Limits: one row, two demands, one blocker, and a browser with no retention.
   * The survival checkpoint waits three turns, so a release that is slower than
   * that would not be caught by this test.
   */
  it(`hydrated clients keep a held owner's row after its later claimant releases`, async () => {
    const id = `held-owner-hydrated-release`
    const detail = categorySubset(`detail`)
    const list = categorySubset(`list`)
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const server = createSharedRowClient(id)
    const collection = server.client.collection(server.descriptor)
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
      await server.client.cleanup()
      server.queryClient.clear()
    })
    const settleTurn = async () => {
      for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    mutation.mutate(() => collection.insert(blocker))
    const held = Promise.resolve(collection._sync.loadSubset(detail))
    void held.catch(() => undefined)
    await settleTurn()
    const claimed = Promise.resolve(collection._sync.loadSubset(list))
    void claimed.catch(() => undefined)
    await settleTurn()
    persistence.resolve()
    await mutation.when('settled')
    await settleTurn()
    await Promise.all([held, claimed])

    const state = server.client.dehydrate({
      shouldDehydrateCollection: () => true,
    })
    const browser = createSharedRowClient(id)
    cleanups.push(async () => {
      await browser.client.cleanup()
      browser.queryClient.clear()
    })
    browser.client.hydrate(state)
    const hydrated = browser.client.collection(browser.descriptor)
    await hydrated._sync.loadSubset(list)
    hydrated._sync.unloadSubset(list)
    await settleTurn()
    expect(rows(hydrated)).toEqual([shared.id])
  })

  /**
   * ## A claim that inserts a row replaces its applied metadata
   *
   * Law: an insert names the whole metadata of its row. An insert that names
   * none clears the row's previous metadata, and a later write in the same
   * session reads its own earlier writes. Query's claim of an absent row is a
   * source insert with no metadata. It stages its owners only after that
   * clear, so the published metadata contains the owner edge and nothing from
   * the applied metadata that the clear removed. Metadata written outside a
   * Query, here a plain metadata write with no row data, is not a hydration
   * seed. The source sees the row as absent, so the insert is not an update.
   *
   * Authority: the sync metadata session law (an insert without metadata
   * clears it, and a read includes the session's own earlier write), and the
   * insert comment in the result-application path ("An insert clears stale
   * metadata for its key").
   *
   * Reference: one absent row `shared` whose applied metadata carries a
   * non-owner field `user`. A claim of the row by `detail` publishes the owner
   * edge for `detail`, with no `user` field.
   *
   * History: seed the metadata through `setupMetadata` without any row data,
   * then load `detail`. The result inserts the row and stages the owner edge
   * in the same transaction. The checkpoint reads the published metadata.
   *
   * Why it fails: the owner write reads the row's metadata after the insert
   * has staged the clear. `metadata.row.get` returns the clear as `undefined`,
   * and `getRowMetadata` treats `undefined` as "no session value", falling
   * back with `??` to the applied `{ user }`. The owner write spreads that
   * fallback, so `user` survives the insert.
   *
   * Limits: one row, one claimant, no hold, and an in-memory baseline. The
   * history checks the published row metadata. It does not model persistence
   * or a row that already has data.
   */
  it(`does not keep applied row metadata when a claim inserts its row`, async () => {
    const id = `claim-insert-replaces-metadata`
    const detail = categorySubset(`detail`)
    const { collection } = createOwnershipFixture({
      id,
      results: [[shared]],
      setupMetadata: (metadata) => {
        metadata.row.set(shared.id, { user: `stale` })
      },
    })

    await collection._sync.loadSubset(detail)

    expect({
      rows: rows(collection),
      user: (
        collection._state.syncedMetadata.get(shared.id) as
          Record<string, unknown> | undefined
      )?.user,
      owners: persistedOwners(collection._state.syncedMetadata, shared.id)
        .length,
    }).toEqual({
      rows: [shared.id],
      user: undefined,
      owners: 1,
    })
  })

  /**
   * ## A persisted claim that inserts its row does not keep applied row metadata
   *
   * Law: the claim-insert law above also holds behind the persistence wrapper.
   * The insert of a row without metadata clears the row's metadata for the
   * session. The claim's owner write then reads its own session's metadata,
   * and that read sees the clear. It must not restore the applied `user` field.
   *
   * Authority: the same law as the in-memory claim-insert witness, applied to
   * the persisted sync API that a Query Collection receives when it is wrapped
   * by `persistedCollectionOptions`. The wrapper's staged metadata read is the
   * session's view, and core supplies only the applied metadata beneath it.
   *
   * Reference: applied row metadata `{ user: 'stale' }` with no row data. A
   * claim by `detail` inserts `shared`. The published metadata keeps only the
   * `queryCollection` key, and the owner set holds `detail`.
   *
   * History: a persisted Query Collection with an empty storage. Before the
   * first Query result, one metadata-only transaction stages the applied
   * metadata. Then a `detail` claim loads `shared`. The checkpoint reads the
   * applied metadata of the row after the claim settles.
   *
   * Why it fails: the insert stages a clear in the wrapper's open transaction.
   * The owner write then reads the row through the wrapper. Its
   * `readStagedMetadata` returns the staged clear as `undefined`. `getRowMetadata`
   * falls back with `??` to core's applied `{ user }`, and the owner write
   * spreads it. The wrapper's own fallback to applied metadata answers only the
   * earlier read, which runs before the insert stages its clear.
   *
   * Limits: one row, one claimant, no hold, and a controlled in-memory storage
   * adapter behind the wrapper.
   */
  it(`does not keep applied row metadata when a persisted claim inserts its row`, async () => {
    const id = `persisted-claim-insert-replaces-metadata`
    const detail = categorySubset(`detail`)
    const storage = createOwnershipStorage()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const baseOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      persistedGcTime: Number.POSITIVE_INFINITY,
      startSync: true,
    })
    const originalSync = baseOptions.sync
    let pendingSetup = true
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...baseOptions,
        sync: {
          sync: (params) => {
            if (!params.metadata) {
              throw new Error(`Sync metadata API is unavailable`)
            }
            if (pendingSetup) {
              pendingSetup = false
              params.begin()
              params.metadata.row.set(shared.id, { user: `stale` })
              params.commit()
            }
            return originalSync.sync(params)
          },
        },
        persistence: { adapter: storage.adapter },
      }),
    )
    cleanups.push(async () => {
      storage.release()
      try {
        await collection.cleanup()
      } finally {
        queryClient.clear()
      }
    })

    await collection._sync.loadSubset(detail)

    expect({
      rows: rows(collection),
      user: (
        collection._state.syncedMetadata.get(shared.id) as
          Record<string, unknown> | undefined
      )?.user,
      owners: persistedOwners(collection._state.syncedMetadata, shared.id)
        .length,
    }).toEqual({
      rows: [shared.id],
      user: undefined,
      owners: 1,
    })
  })

  /**
   * ## A persisted claim after a held removal does not restore the removed row's metadata
   *
   * Law: the held-removal law above, behind the persistence wrapper. A source
   * delete clears the row's metadata for the session. A source insert that
   * names no metadata clears it again. A claim reads its session's own earlier
   * writes, so the removal's delete stays in force while it is held.
   *
   * Authority: the same sync metadata session law as the in-memory held-removal
   * witness, and the published-owner law: a released lease is not an owner.
   *
   * Reference: a persisted row `shared` with applied metadata `{ user: 'seeded' }`
   * that `detail` owns. A held removal of `detail` deletes the row. A `list`
   * claim during the hold re-inserts it. The published metadata holds the `list`
   * owner edge and no `user` field.
   *
   * History: a persisted Query Collection over storage that holds `shared` with
   * metadata `{ user: 'seeded' }`, with `persistedGcTime: 0` so that a release
   * removes the row. That storage is a restored state. Restart and resume reads
   * belong to other owners, so this test uses the restored state only as a
   * legal starting point. Load `detail`. Hold publication behind an optimistic
   * blocker, unload `detail`, and wait for the removal to be accepted. Load
   * `list` during the hold, then publish. The checkpoint reads the applied
   * metadata of the row.
   *
   * Why it fails: the claim's insert stages a clear, and the owner write reads
   * it as `undefined` through the wrapper. `getRowMetadata` falls back to core's
   * applied `{ user: 'seeded' }`. The removal has not published, so core still
   * holds that value.
   *
   * Limits: one row, one removed demand, one claimant, a controlled in-memory
   * storage adapter behind the wrapper.
   */
  it(`does not restore a removed row's applied metadata when a persisted claim follows a held removal`, async () => {
    const id = `persisted-held-removal-claim-metadata`
    const detail = categorySubset(`detail`)
    const list = categorySubset(`list`)
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const storage = createOwnershipStorage({
      rows: new Map([[shared.id, shared]]),
      rowMetadata: new Map([[shared.id, { user: `seeded` }]]),
      collectionMetadata: new Map(),
    })
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `on-demand`,
          persistedGcTime: 0,
          startSync: true,
        }),
        persistence: { adapter: storage.adapter },
      }),
    )
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
      storage.release()
      try {
        await collection.cleanup()
      } finally {
        queryClient.clear()
      }
    })
    const settleTurn = async () => {
      for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    await collection._sync.loadSubset(detail)
    mutation.mutate(() => collection.insert(blocker))
    const pendingBeforeRemoval =
      collection._state.pendingSyncedTransactions.length
    collection._sync.unloadSubset(detail)
    // The removal's delete is accepted but held behind the blocker.
    await vi.waitFor(() =>
      expect(
        collection._state.pendingSyncedTransactions.length,
      ).toBeGreaterThan(pendingBeforeRemoval),
    )
    const claimed = Promise.resolve(collection._sync.loadSubset(list))
    void claimed.catch(() => undefined)
    await settleTurn()
    persistence.resolve()
    await mutation.when('settled')
    await settleTurn()
    await claimed

    expect({
      user: (
        collection._state.syncedMetadata.get(shared.id) as
          Record<string, unknown> | undefined
      )?.user,
      owners: persistedOwners(collection._state.syncedMetadata, shared.id)
        .length,
    }).toEqual({
      user: undefined,
      owners: 1,
    })
  })

  /**
   * ## A claim of a hydrated row keeps the seed's metadata
   *
   * Law: a hydration seed sits beneath every source write and supplies only
   * the objects that no source write has written. Query sees a hydrated row as
   * present, so a claim with an equal result writes no row; it writes only the
   * row's metadata, after reading the current metadata. At claim time no source
   * write has replaced the seed's metadata, so that read returns it, and the
   * claim keeps the seed's non-owner fields beside the claimant's owner edge.
   * The owner write is itself a source write to that metadata, so the law
   * afterwards is different: a later seed for the row must not replace it. The
   * late-seed witness below checks that. This control is the boundary of the
   * claim-insert history above, where the claim inserts an absent row and the
   * insert clears the metadata.
   *
   * Authority: decisions D4 and D5 recorded in the sync metadata session
   * oracle (a seed sits beneath source writes; a source insert replaces a
   * seeded row), and the read-your-writes law that the owner write's read
   * returns the current metadata.
   *
   * Reference: one row `shared` hydrated with metadata `{ user: 'seeded' }`.
   * A claim by `detail` keeps `user` and publishes one `detail` owner edge.
   *
   * History: create a DbClient, hydrate the row with its metadata, create the
   * Query Collection through that client, then load `detail`. The result
   * carries the same row. The checkpoint reads the published metadata.
   *
   * Why this is a control: it runs the same claim as the claim-insert history,
   * over a present hydrated row rather than an absent row. A repair that clears
   * metadata on every claim would pass the claim-insert history and fail this
   * one.
   *
   * Limits: one row, one claimant, no hold, and an in-memory client without
   * persistence.
   */
  it(`keeps a hydrated row's metadata when a claim reconciles the seeded row`, async () => {
    const id = `claim-hydrated-keeps-metadata`
    const detail = categorySubset(`detail`)
    const queryClient = createQueryClient()
    const descriptor = collectionOptions(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([shared]),
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const client = new DbClient({ queryClient })
    cleanups.push(async () => {
      await client.cleanup()
      queryClient.clear()
    })
    client.hydrate({
      collections: [
        {
          collectionId: id,
          rows: [
            {
              key: shared.id,
              value: shared,
              metadata: { user: `seeded` },
            },
          ],
        },
      ],
    })
    const collection = client.collection(descriptor)

    await collection._sync.loadSubset(detail)

    expect({
      rows: rows(collection),
      published: publishedRowMetadata(client, shared.id),
    }).toEqual({
      rows: [shared.id],
      published: { user: `seeded`, owners: 1 },
    })
  })

  /**
   * ## A late hydration seed does not erase a claim's owner edge
   *
   * Law: a hydration seed supplies only the objects that no source write has
   * written. Query's owner write is a source write to the row's metadata, so
   * once a claim has published that metadata, a later seed for the row must
   * not replace it. The claim's owner edge and the seed's `user` field both
   * stay published.
   *
   * Authority: decision D5 recorded in the sync metadata session oracle (a seed
   * sits beneath source writes, and row data and row metadata are separate
   * objects). The claim's own owner write is the source write in this history.
   *
   * Reference: one row `shared` hydrated with `{ user: 'seeded' }`. A `detail`
   * claim publishes `user: 'seeded'` and one owner. A late chunk for the same
   * row carries `{ user: 'late' }`. Its metadata is ignored, so the published
   * metadata is unchanged.
   *
   * History: the hydrated control's setup, then load `detail`, check the claim
   * checkpoint, and apply a chunk that seeds `shared` with `{ user: 'late' }`
   * through `DbClient.applyCollectionChunk`. The checkpoint after the chunk
   * reads the published metadata through the client.
   *
   * Why it fails: the late seed replaces the published metadata with
   * `{ user: 'late' }`. The `detail` owner edge is gone, and the seed's field
   * is the one that survives.
   *
   * Limits: one row, one claimant, no hold, and an in-memory client without
   * persistence. The chunk is applied while the claim is published and not
   * held. Held or persisted seeds are not covered here.
   */
  it(`ignores a late hydration seed for a row whose metadata a claim has published`, async () => {
    const id = `late-seed-after-claim`
    const detail = categorySubset(`detail`)
    const queryClient = createQueryClient()
    const descriptor = collectionOptions(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([shared]),
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const client = new DbClient({ queryClient })
    cleanups.push(async () => {
      await client.cleanup()
      queryClient.clear()
    })
    client.hydrate({
      collections: [
        {
          collectionId: id,
          rows: [
            { key: shared.id, value: shared, metadata: { user: `seeded` } },
          ],
        },
      ],
    })
    const collection = client.collection(descriptor)

    await collection._sync.loadSubset(detail)
    expect(publishedRowMetadata(client, shared.id)).toEqual({
      user: `seeded`,
      owners: 1,
    })

    client.applyCollectionChunk({
      collectionId: id,
      rows: [{ key: shared.id, value: shared, metadata: { user: `late` } }],
    })

    expect({
      rows: rows(collection),
      published: publishedRowMetadata(client, shared.id),
    }).toEqual({
      rows: [shared.id],
      published: { user: `seeded`, owners: 1 },
    })
  })

  /**
   * ## A held removal's cleared metadata is not restored by a later claim
   *
   * Law: a source delete clears the row's metadata for the session. A source
   * insert that names no metadata then clears it again. A claim reads its
   * session's own earlier writes, including a held removal that deleted the
   * row. Under the seed-ordering decision D5, a hydration seed supplies only
   * objects that no surviving source write has written. The held removal's
   * delete is such a write, so the seed's `user` field stays gone while the
   * removal is in the session.
   *
   * Authority: the sync metadata session law (a delete clears, an insert names
   * the whole metadata, a read includes the session's own earlier write), the
   * seed-ordering decision D5, and the published-owner law above, under which a
   * released lease is not an owner.
   *
   * Reference: a hydrated row `shared` with metadata `{ user: 'seeded' }` that
   * `detail` owns. A held removal of `detail` deletes the row. A `list` claim
   * during the hold re-inserts it. The published metadata holds the `list`
   * owner edge and no `user` field.
   *
   * History: create a DbClient and hydrate the row with its metadata. Load
   * `detail`. Hold publication behind an optimistic blocker, unload `detail`,
   * and wait for the removal to commit. Load `list` during the hold, then
   * publish. The checkpoint reads the published metadata through the client.
   *
   * Why it fails: the claim's owner write reads the row's metadata after its
   * own insert's clear. The newest transaction holds a delete for the row, so
   * the read returns `undefined` and falls back to the applied metadata. The
   * removal has not applied, so the applied metadata still has `user`, and the
   * owner write spreads it back.
   *
   * Reachability: the removal is a public unload and the claim is a public
   * load. The only hold is an optimistic blocker.
   *
   * Limits: one row, one removed demand, one claimant, an in-memory client, and
   * no persistence.
   */
  it(`does not restore a removed row's applied metadata when a claim follows a held removal`, async () => {
    const id = `held-removal-claim-metadata`
    const detail = categorySubset(`detail`)
    const list = categorySubset(`list`)
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const queryClient = createQueryClient()
    const descriptor = collectionOptions(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([shared]),
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const client = new DbClient({ queryClient })
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
      await client.cleanup()
      queryClient.clear()
    })
    client.hydrate({
      collections: [
        {
          collectionId: id,
          rows: [
            { key: shared.id, value: shared, metadata: { user: `seeded` } },
          ],
        },
      ],
    })
    const collection = client.collection(descriptor)
    const settleTurn = async () => {
      for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    await collection._sync.loadSubset(detail)
    mutation.mutate(() => collection.insert(blocker))
    const pendingBeforeRemoval =
      collection._state.pendingSyncedTransactions.length
    collection._sync.unloadSubset(detail)
    // The removal's delete is accepted but held behind the blocker.
    await vi.waitFor(() =>
      expect(
        collection._state.pendingSyncedTransactions.length,
      ).toBeGreaterThan(pendingBeforeRemoval),
    )
    const claimed = Promise.resolve(collection._sync.loadSubset(list))
    void claimed.catch(() => undefined)
    await settleTurn()
    persistence.resolve()
    await mutation.when('settled')
    await settleTurn()
    await claimed

    expect(publishedRowMetadata(client, shared.id)).toEqual({
      user: undefined,
      owners: 1,
    })
  })

  /**
   * ## A reacquired lease's cached rows receive accepted direct writes
   *
   * Law: in on-demand mode, an accepted direct write patches the cached rows
   * of each active Query in its Collection that may still apply them. A Query
   * whose lease has not yet applied a result may hold the written key, so it
   * is patched; only a resolved scope that does not own the key may be
   * skipped. The patched cache keeps a later replay of that cached result
   * from presenting the pre-write value as a server result.
   *
   * Authority: the opening direct-write law of this file. A released lease's
   * empty ownership entry, kept while its release is held, does not resolve a
   * later lease of the same Query.
   *
   * Reference: one row whose server value is Shared, then an accepted Manual
   * upsert. The model expects the public row and the reacquired Query's cache
   * to show Manual.
   *
   * History: hold publication behind an optimistic blocker, release the
   * demand, raise a refresh barrier (`deferDataRefresh`, as offline
   * transactions do while they replay), and reacquire. The barrier keeps the
   * cached result unapplied. The acquisition's own fetch fails, so Query
   * keeps its cached data and is idle when the upsert arrives. The checkpoint
   * is after publication and the barrier both end. Public rows alone cannot
   * distinguish the skip: the upsert keeps the row either way. The Query
   * cache, read through `QueryClient.getQueriesData`, does.
   */
  it(
    `patches a reacquired lease's cached rows while its result waits`,
    async () => {
      const id = `reacquired-lease-direct-patch`
      const detail = categorySubset(`detail`)
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const barrier = createDeferred<void>()
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        results: [[shared]],
      })
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      cleanups.push(async () => {
        collection.deferDataRefresh = null
        barrier.resolve()
        persistence.resolve()
        await mutation.when('settled').catch(() => undefined)
      })

      await collection._sync.loadSubset(detail)
      // Earlier result transactions apply first, so the count below grows only
      // with the expiry's held transaction.
      await waitForRetention(
        () =>
          expect(collection._state.pendingSyncedTransactions).toHaveLength(0),
        retentionWait,
      )
      mutation.mutate(() => collection.insert(blocker))
      collection._sync.unloadSubset(detail)
      await settleTurn()
      collection.deferDataRefresh = barrier.promise
      const reacquired = Promise.resolve(collection._sync.loadSubset(detail))
      void reacquired.catch(() => undefined)
      await settleTurn()
      const write = Promise.resolve(
        collection.utils.writeUpsert({ ...shared, name: `Manual` }),
      )
      void write.catch(() => undefined)
      await settleTurn()

      persistence.resolve()
      await mutation.when('settled')
      collection.deferDataRefresh = null
      barrier.resolve()
      await reacquired.catch(() => undefined)
      await write
      await settleTurn()

      expect({
        row: collection.get(shared.id)?.name,
        cache: queryClient
          .getQueriesData<Array<Item>>({ queryKey: [id] })
          .flatMap(([, data]) => data ?? [])
          .map((item) => item.name),
        queryCalls: queryFn.mock.calls.length,
      }).toEqual({ row: `Manual`, cache: [`Manual`], queryCalls: 2 })
    },
    retentionTestTimeout,
  )

  /**
   * ## A release whose durable commit fails is terminal for its sync run
   *
   * Law: a release is complete only when its commit is durable. If that
   * commit fails, the Collection reports the failure and enters `error`; the
   * released row stays public and stored, because the deletion never became
   * durable. A later acquisition in that run rejects with the same failure
   * instead of reading ownership the failed release left behind. Cleanup ends
   * the run; a restarted run starts with no ownership from the old run, so
   * its acquisition and release behave as in a fresh Collection.
   *
   * Authority: the Code Weight and Fail-Fast rules in AGENTS.md (a
   * contradictory collaborator signal rejects at the boundary instead of
   * recovering), the persisted direct-write receipt law in this file's opening
   * prose, and the glossary's cleanup definition (it ends the sync run and its
   * resources).
   *
   * Reference: the model owns one row through one demand. A failed release
   * is a local persistence failure, so it crashes the Collection and leaves
   * `{ rows: [shared], stored: [shared], status: crashed }`; a restarted
   * load and release give `[shared]` and then `{ rows: [], stored: [] }`. The
   * `durable` history is the control: the release succeeds and the restarted
   * run never refetches, because no demand remains.
   *
   * Limits: one on-demand row, no persisted retention (`persistedGcTime: 0`,
   * since retention intentionally keeps released rows), a controlled adapter
   * whose next commit throws, and a public `cleanup()` then `preload()`
   * restart. A failed commit that a host retries is outside this witness.
   */
  it.each([`durable`, `failed`, `failed-then-reacquired`] as const)(
    `keeps a released row and fails loudly when its release commit fails (%s)`,
    async (history) => {
      const id = `release-commit-${history}`
      const storage = createOwnershipStorage()
      const queryClient = createQueryClient()
      const queryFn = vi.fn(() => Promise.resolve([shared]))
      let failNextCommit = false
      const applyCommittedTx = storage.adapter.applyCommittedTx
      storage.adapter.applyCommittedTx = (...args) => {
        if (!failNextCommit) return applyCommittedTx(...args)
        failNextCommit = false
        return Promise.reject(new Error(`storage failed`))
      }
      const collection = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            persistedGcTime: 0,
            startSync: true,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      cleanups.push(async () => {
        await collection.cleanup().catch(() => undefined)
        queryClient.clear()
      })
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const observe = () => ({
        rows: rows(collection),
        stored: storedItems(storage).map((item) => item.id),
        status: collection.status,
      })
      const detail = categorySubset(`detail`)

      await collection._sync.loadSubset(detail)
      failNextCommit = history !== `durable`
      collection._sync.unloadSubset(detail)
      await settleTurn()
      const afterRelease = observe()

      let reacquisition: string | undefined
      if (history === `failed-then-reacquired`) {
        reacquisition = await Promise.resolve(
          collection._sync.loadSubset(detail),
        ).then(
          () => `fulfilled`,
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        )
      }

      await collection.cleanup()
      await collection.preload()
      await collection._sync.loadSubset(detail)
      const restartedLoad = rows(collection)
      collection._sync.unloadSubset(detail)
      await settleTurn()

      const failed = history !== `durable`
      expect({
        afterRelease,
        reacquisition,
        restartedLoad,
        restartedRelease: observe(),
        queryCalls: queryFn.mock.calls.length,
      }).toEqual({
        afterRelease: failed
          ? { rows: [shared.id], stored: [shared.id], status: `crashed` }
          : { rows: [], stored: [], status: `ready` },
        reacquisition:
          history === `failed-then-reacquired`
            ? `Failed to durably persist collection "${id}": storage failed`
            : undefined,
        restartedLoad: [shared.id],
        restartedRelease: { rows: [], stored: [], status: `ready` },
        queryCalls: failed ? 2 : 1,
      })
    },
  )

  /**
   * The same fail-loud law covers a reacquired lease whose own durable commit
   * fails. The release's commit is held at the persistence boundary while the
   * Query is reacquired; the reacquired application's commit then fails. The
   * release is durable, so the row leaves; the reacquired result never became
   * durable, so it cannot keep the row. The persistence failure crashes the
   * Collection, the
   * acquisition rejects with the persistence failure, and a restart serves and
   * releases the row normally. A history that keeps the row public after the
   * failure would report a result that storage never accepted.
   */
  it(`fails loudly when a reacquired lease's commit fails after a held release`, async () => {
    const id = `reacquired-commit-fails`
    const storage = createOwnershipStorage(undefined, 2)
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    let commits = 0
    const applyCommittedTx = storage.adapter.applyCommittedTx
    storage.adapter.applyCommittedTx = (...args) => {
      // Commit 1 loads the row, 2 is the held release, 3 is the reacquisition.
      if (++commits === 3) return Promise.reject(new Error(`storage failed`))
      return applyCommittedTx(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `on-demand`,
          persistedGcTime: 0,
          startSync: true,
        }),
        persistence: { adapter: storage.adapter },
      }),
    )
    cleanups.push(async () => {
      storage.release()
      await collection.cleanup().catch(() => undefined)
      queryClient.clear()
    })
    const settleTurn = async () => {
      for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const detail = categorySubset(`detail`)

    await collection._sync.loadSubset(detail)
    collection._sync.unloadSubset(detail)
    await storage.entered
    const reacquisition = Promise.resolve(
      collection._sync.loadSubset(detail),
    ).then(
      () => `fulfilled`,
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    )
    await settleTurn()
    const held = { rows: rows(collection), status: collection.status }

    storage.release()
    const reacquired = await reacquisition
    await settleTurn()
    const failed = { rows: rows(collection), status: collection.status }

    await collection.cleanup()
    await collection.preload()
    await collection._sync.loadSubset(detail)
    const restartedLoad = rows(collection)
    collection._sync.unloadSubset(detail)
    await settleTurn()

    expect({
      held,
      reacquired,
      failed,
      restartedLoad,
      restartedRelease: {
        rows: rows(collection),
        stored: storedItems(storage).map((item) => item.id),
      },
    }).toEqual({
      held: { rows: [shared.id], status: `ready` },
      reacquired: `Failed to durably persist collection "${id}": storage failed`,
      failed: { rows: [], status: `crashed` },
      restartedLoad: [shared.id],
      restartedRelease: { rows: [], stored: [] },
    })
  })

  /**
   * Accepted Query results update ownership in acceptance order even while
   * publication is held. The independent model stores each active Query's
   * latest complete result and exposes their union: after the detail and list
   * results become empty, the peer still exposes the row; after the peer is
   * released, the union is empty. Published metadata remains stale until the
   * hold ends, so it cannot be the model's source of truth.
   */
  it(`composes accepted owner retirements ahead of stale metadata`, async () => {
    const id = `accepted-owner-retirements`
    const detail = categorySubset(`detail`)
    const list = categorySubset(`list`)
    const peer: LoadSubsetOptions = {
      where: new IR.Func(`in`, [
        new IR.PropRef([`category`]),
        new IR.Value([`shared`, `peer`]),
      ]),
    }
    const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
    const persistence = createDeferred<void>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared], [shared], [shared], [], [], [shared]],
    })
    const mutation = createTransaction({
      mutationFn: () => persistence.promise,
    })

    await collection._sync.loadSubset(detail)
    await collection._sync.loadSubset(list)
    await collection._sync.loadSubset(peer)

    mutation.mutate(() => collection.insert(blocker))
    cleanups.push(async () => {
      persistence.resolve()
      await mutation.when('settled').catch(() => undefined)
    })
    expect(mutation.state).toBe(`persisting`)

    const pendingBefore = collection._state.pendingSyncedTransactions.length
    const refetch = collection.utils.refetch()
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(6))
    await vi.waitFor(() =>
      expect(
        collection._state.pendingSyncedTransactions.length,
      ).toBeGreaterThanOrEqual(pendingBefore + 2),
    )

    persistence.resolve()
    await mutation.when('settled')
    await refetch
    await vi.waitFor(() => expect(rows(collection)).toEqual([shared.id]))

    collection._sync.unloadSubset(peer)
    await vi.waitFor(() => expect(rows(collection)).toEqual([]))
    expect(queryFn).toHaveBeenCalledTimes(6)
  })

  // Law: once a result's sync transaction is accepted, the rows it owns stay
  // owned when a later result supersedes it. The later result diffs against
  // that ownership, so a row only the superseded result added is deleted, and
  // a later empty result deletes the rest. Model: the owned rows after each
  // result are exactly that result's rows. Checkpoint: visible and stored rows
  // after each refetch settles.
  // Law: once a result's sync transaction is accepted, the rows it owns stay
  // owned when a later result supersedes it, whether durable storage or a
  // persisting mutation holds it. The later result diffs against that
  // ownership, so a row only the superseded result added is deleted, and a
  // later empty result deletes the rest. Model: the owned rows after each
  // result are exactly that result's rows. Checkpoint: visible and stored rows
  // after each refetch settles. Before this law, every supersession test held
  // durable storage, where the result's core transaction had already applied,
  // so restoring the old ownership was a no-op and no test observed it.
  it.each([`storage`, `mutation`] as const)(
    `keeps an accepted superseded result's ownership for the next diff when %s holds it`,
    async (holder) => {
      const id = `superseded-accepted-ownership-${holder}`
      const row = (key: string): Item => ({
        id: key,
        category: `result`,
        name: key.toUpperCase(),
      })
      let server: Array<Item> = [row(`a`)]
      const storage = createOwnershipStorage()
      const apply = storage.adapter.applyCommittedTx.bind(storage.adapter)
      let holdStorage = false
      const entered = createDeferred<void>()
      const released = createDeferred<void>()
      storage.adapter.applyCommittedTx = async (...args) => {
        if (holdStorage && args[1].mutations.length > 0) {
          holdStorage = false
          entered.resolve()
          await released.promise
        }
        return apply(...args)
      }
      const queryClient = createQueryClient()
      const options = queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve(structuredClone(server)),
        getKey: (item) => item.id,
        startSync: true,
      })
      const collection = createCollection(
        holder === `storage`
          ? persistedCollectionOptions<
              Item,
              string | number,
              never,
              QueryCollectionUtils<Item, string | number, Item, unknown>
            >({ ...options, persistence: { adapter: storage.adapter } })
          : options,
      )
      const mutation = createTransaction({
        mutationFn: () => released.promise,
      })
      cleanups.push(async () => {
        released.resolve()
        if (holder === `mutation`)
          await mutation.when('settled').catch(() => undefined)
        try {
          await collection.cleanup()
        } finally {
          queryClient.clear()
        }
      })
      const observe = () => ({
        visible: [...collection.keys()].filter((key) => key !== `local`).sort(),
        stored:
          holder === `storage`
            ? storedItems(storage).map((item) => item.id)
            : [...collection._state.syncedData.keys()].sort(),
      })

      await collection.preload()
      expect(observe()).toEqual({ visible: [`a`], stored: [`a`] })

      // The first result is accepted and held before it can be stored or
      // published; a second result supersedes it.
      server = [row(`b`), row(`c`)]
      if (holder === `storage`) holdStorage = true
      else
        mutation.mutate(() =>
          collection.insert({ id: `local`, category: `local`, name: `L` }),
        )
      const first = collection.utils.refetch()
      if (holder === `storage`) await entered.promise
      else
        await vi.waitFor(() =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(0),
        )
      const queuedAfterFirst =
        collection._state.pendingSyncedTransactions.length
      server = [row(`b`)]
      const second = collection.utils.refetch()
      if (holder === `mutation`)
        await vi.waitFor(() =>
          expect(
            collection._state.pendingSyncedTransactions.length,
          ).toBeGreaterThan(queuedAfterFirst),
        )
      released.resolve()
      await Promise.all([first, second])
      if (holder === `mutation`)
        await mutation.when('settled').catch(() => undefined)
      await vi.waitFor(() =>
        expect(observe()).toEqual({ visible: [`b`], stored: [`b`] }),
      )

      server = []
      await collection.utils.refetch()
      await vi.waitFor(() =>
        expect(observe()).toEqual({ visible: [], stored: [] }),
      )
    },
  )

  /**
   * A fetched result can finish before its persisted baseline scan. Its
   * source rows retain their fetch-start position while that application is
   * queued. The reference overlays a later accepted direct write on those
   * rows, even if the scan returns that newly written row. Check public rows
   * when initial readiness settles, after the held scan is released.
   */
  it(`keeps a direct write made after fetch completion but before application`, async () => {
    const id = `queued-older-result-direct-write`
    const queryHash = hashKey([id])
    const older = { ...shared, name: `Older fetch` }
    const manual = { ...shared, name: `Manual` }
    const persistedScan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => persistedScan.promise)
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [[older]],
      scanPersistedRows,
      setupMetadata: (metadata) => {
        metadata.collection.set(`queryCollection:gc:${queryHash}`, {
          queryHash,
          mode: `until-revalidated`,
        })
      },
    })
    cleanups.push(() => {
      persistedScan.resolve([])
      return Promise.resolve()
    })

    const ready = collection.stateWhenReady()
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledOnce()
      expect(scanPersistedRows).toHaveBeenCalledOnce()
    })
    await collection.utils.writeInsert(manual)
    expect(collection.get(manual.id)?.name).toBe(`Manual`)
    persistedScan.resolve([
      {
        key: manual.id,
        value: manual,
        metadata: { queryCollection: { owners: { [queryHash]: true } } },
      },
    ])
    await ready
    expect(collection.get(manual.id)?.name).toBe(`Manual`)

    // The accepted result is settled. An unrelated Query state notification
    // must not re-enter its older-result merge and patch the cache again.
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    let stateNotifications = 0
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === `updated` &&
        event.query === query &&
        event.action.type === `setState`
      )
        stateNotifications++
    })
    try {
      query.setState({ isInvalidated: true })
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(stateNotifications).toBe(1)
      expect(query.state.isInvalidated).toBe(true)
    } finally {
      unsubscribe()
    }
  })

  it(`settles a direct write only after its persisted commit applies`, async () => {
    const id = `persisted-direct-write-receipt`
    const storage = createOwnershipStorage(undefined, 2)
    const { collection } = createPersistedOwnershipFixture(
      id,
      storage,
      [shared],
      `eager`,
    )
    await collection.stateWhenReady()

    let receipt: `pending` | `fulfilled` | `rejected` = `pending`
    const write = collection.utils.writeUpdate({ ...shared, name: `Updated` })
    void write.then(
      () => (receipt = `fulfilled`),
      () => (receipt = `rejected`),
    )
    const observe = () => ({
      receipt,
      storedName: storage.snapshot().rows.get(shared.id)?.name,
    })

    await storage.entered
    await Promise.resolve()
    expect(observe()).toEqual(expectedDirectWriteReceipt(false))

    storage.release()
    await write
    expect(observe()).toEqual(expectedDirectWriteReceipt(true))
    expect(collection.get(shared.id)?.name).toBe(`Updated`)
  })

  /**
   * A Query refetch may begin while a direct write waits for its persisted
   * commit. Starting that request repeats the old cached success to observers,
   * but no new provider row has arrived. The independent reference has three
   * row states in order: the first fetched Server row, the accepted Manual
   * write, and the later fetched Newer row. The old cached row cannot become
   * authoritative again at refetch start.
   *
   * The legal history holds the direct commit, starts a real QueryClient
   * refetch whose provider response is also held, then releases the commit.
   * At the write receipt, while the response is still held, compare public
   * and durable rows with Manual. After the provider responds, compare both
   * with Newer. These two cuts reject a design that treats a fetch-start
   * observer notification as a fresh result without forbidding a later
   * physical result from replacing the direct write.
   */
  it.each([`eager`, `on-demand`] as const)(
    `keeps an accepted persisted %s write through a refetch start until its result arrives`,
    async (syncMode) => {
      const id = `persisted-direct-write-refetch-start-${syncMode}`
      const storage = createOwnershipStorage(undefined, 2)
      const queryClient = createQueryClient()
      const newer = { ...shared, name: `Newer` }
      const manual = { ...shared, name: `Manual` }
      const heldResult = createDeferred<Array<Item>>()
      const requestStarted = createDeferred<void>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([shared])
        .mockImplementationOnce(() => {
          requestStarted.resolve()
          return heldResult.promise
        })
      const collection = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode,
            persistedGcTime: Number.POSITIVE_INFINITY,
            startSync: true,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      cleanups.push(async () => {
        storage.release()
        heldResult.resolve([newer])
        await collection.cleanup()
        queryClient.clear()
      })

      if (syncMode === `eager`) await collection.stateWhenReady()
      else await collection._sync.loadSubset({})
      expect(collection.get(shared.id)?.name).toBe(shared.name)
      expect(storedItems(storage)[0]?.name).toBe(shared.name)

      const write = collection.utils.writeUpdate(manual)
      await storage.entered
      const refetch = queryClient.refetchQueries({ queryKey: [id] })
      void refetch.catch(() => undefined)
      await requestStarted.promise
      expect(queryFn).toHaveBeenCalledTimes(2)

      storage.release()
      await write
      expect({
        public: collection.get(shared.id)?.name,
        durable: storedItems(storage)[0]?.name,
      }).toEqual({ public: manual.name, durable: manual.name })

      heldResult.resolve([newer])
      await refetch
      expect({
        public: collection.get(shared.id)?.name,
        durable: storedItems(storage)[0]?.name,
      }).toEqual({ public: newer.name, durable: newer.name })
    },
  )

  /**
   * The same law holds when the Query's current result is empty. An empty
   * result is a resolved scope that owns no rows; it is not an unapplied
   * result. The reference sequence is the first fetched result (no rows), the
   * accepted Manual insert, and the later fetched Newer row. Starting the
   * refetch repeats the empty cached success; it cannot remove the direct row
   * or claim it.
   *
   * This sibling exists because the reacquisition table above makes a
   * released lease's empty ownership entry distinguishable from an applied
   * one. A repair that instead treats every empty ownership entry as
   * unapplied passes that table and the non-empty history above. Here it
   * replays the empty cached result at refetch start: in on-demand mode the
   * insert disappears at its own receipt, and in eager mode the later Newer
   * result does not replace Manual. The checkpoints and holds match the
   * history above.
   */
  it.each([`eager`, `on-demand`] as const)(
    `keeps an accepted persisted %s insert through a refetch start of an empty result`,
    async (syncMode) => {
      const id = `persisted-direct-insert-empty-refetch-start-${syncMode}`
      const storage = createOwnershipStorage(undefined, 2)
      const queryClient = createQueryClient()
      const newer = { ...shared, name: `Newer` }
      const manual = { ...shared, name: `Manual` }
      const heldResult = createDeferred<Array<Item>>()
      const requestStarted = createDeferred<void>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => {
          requestStarted.resolve()
          return heldResult.promise
        })
      const collection = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode,
            persistedGcTime: Number.POSITIVE_INFINITY,
            startSync: true,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      cleanups.push(async () => {
        storage.release()
        heldResult.resolve([newer])
        await collection.cleanup()
        queryClient.clear()
      })
      const observe = () => ({
        public: collection.get(shared.id)?.name ?? null,
        durable: storedItems(storage)[0]?.name ?? null,
      })

      if (syncMode === `eager`) await collection.stateWhenReady()
      else await collection._sync.loadSubset({})
      expect(observe()).toEqual({ public: null, durable: null })

      const write = collection.utils.writeInsert(manual)
      await storage.entered
      const refetch = queryClient.refetchQueries({ queryKey: [id] })
      void refetch.catch(() => undefined)
      await requestStarted.promise
      expect(queryFn).toHaveBeenCalledTimes(2)

      storage.release()
      await write
      expect(observe()).toEqual({ public: manual.name, durable: manual.name })

      heldResult.resolve([newer])
      await refetch
      expect(observe()).toEqual({ public: newer.name, durable: newer.name })
    },
  )

  it(`rejects writes from an invalidated sync run and admits writes after restart`, async () => {
    const id = `direct-write-cleanup-admission`
    const storage = createOwnershipStorage()
    const { collection } = createPersistedOwnershipFixture(
      id,
      storage,
      [shared],
      `eager`,
    )
    await collection.stateWhenReady()

    const observe = async (write: () => Promise<void>) => {
      try {
        await write()
        return `fulfilled` as const
      } catch (error) {
        expect(error).toBeInstanceOf(SyncNotInitializedError)
        return `rejected` as const
      }
    }

    const before = { ...shared, name: `Before cleanup` }
    expect(await observe(() => collection.utils.writeUpdate(before))).toBe(
      expectedDirectWriteAdmission(`current`),
    )
    expect(storage.snapshot().rows.get(shared.id)?.name).toBe(before.name)

    const cleanup = collection.cleanup()
    const late = { id: `late`, category: `direct`, name: `Late` }
    const lateWrites = [
      () => collection.utils.writeInsert(late),
      () => collection.utils.writeUpdate({ ...shared, name: `Late update` }),
      () => collection.utils.writeDelete(shared.id),
      () => collection.utils.writeUpsert(late),
      () =>
        collection.utils.writeBatch(() => collection.utils.writeInsert(late)),
    ]
    for (const write of lateWrites) {
      expect(await observe(write)).toBe(
        expectedDirectWriteAdmission(`invalidated`),
      )
    }
    await cleanup
    expect(storage.snapshot().rows.has(late.id)).toBe(false)
    expect(storage.snapshot().rows.get(shared.id)?.name).toBe(before.name)

    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    await collection.stateWhenReady()
    const restarted = {
      id: `restarted`,
      category: `direct`,
      name: `Restarted`,
    }
    expect(await observe(() => collection.utils.writeInsert(restarted))).toBe(
      expectedDirectWriteAdmission(`current`),
    )
    expect(storage.snapshot().rows.get(restarted.id)).toEqual(restarted)
  })

  it(`retains post-publication ownership through durable persistence`, async () => {
    const id = `persisted-post-application-unload`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const sibling = { id: `b`, category: `result`, name: `B` }
    const transient = { id: `c`, category: `result`, name: `C` }
    const storage = createOwnershipStorage(undefined, 2)
    const { collection, queryClient, queryFn } =
      createPersistedOwnershipFixture(id, storage, [initial, sibling])
    const createDerived = () =>
      createLiveQueryCollection((query) =>
        query.from({ item: collection }).select(({ item }) => ({ ...item })),
      )
    const firstDerived = createDerived()
    let secondDerived: ReturnType<typeof createDerived> | undefined

    try {
      await firstDerived.preload()
      expect(queryFn).toHaveBeenCalledOnce()
      expect(itemIds(storage.snapshot().rows.values())).toEqual([
        initial.id,
        sibling.id,
      ])

      queryClient.setQueryData(queryKey, [initial, sibling, transient])
      await storage.entered
      expect({
        synced: itemIds(collection._state.syncedData.values()),
        derived: itemIds(firstDerived.toArray),
        stored: itemIds(storage.snapshot().rows.values()),
      }).toEqual({
        synced: [initial.id, sibling.id, transient.id],
        derived: [initial.id, sibling.id, transient.id],
        stored: [initial.id, sibling.id],
      })

      await firstDerived.cleanup()
      storage.release()
      await vi.waitFor(() =>
        expect(itemIds(storage.snapshot().rows.values())).toEqual([
          initial.id,
          sibling.id,
          transient.id,
        ]),
      )

      queryClient.removeQueries({ queryKey, exact: true })
      secondDerived = createDerived()
      await secondDerived.preload()
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => {
        expect({
          synced: itemIds(collection._state.syncedData.values()),
          source: itemIds(collection.toArray),
          derived: itemIds(secondDerived?.toArray ?? []),
          stored: itemIds(storage.snapshot().rows.values()),
        }).toEqual({
          synced: [initial.id, sibling.id],
          source: [initial.id, sibling.id],
          derived: [initial.id, sibling.id],
          stored: [initial.id, sibling.id],
        })
      })
      expect(
        persistedOwners(storage.snapshot().rowMetadata, transient.id),
      ).toEqual([])
    } finally {
      storage.release()
      await secondDerived?.cleanup()
      if (firstDerived.status !== `cleaned-up`) await firstDerived.cleanup()
    }
  })

  it(`keeps only the newest cache result when publication reenters application`, async () => {
    const id = `reentrant-result-application`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const outer = { id: `b`, category: `result`, name: `B` }
    const inner = { id: `c`, category: `result`, name: `C` }
    const queryClient = createQueryClient()
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn: () => Promise.resolve([initial]),
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const publications: Array<Array<string>> = []
    let injected = false
    const subscription = collection.subscribeChanges(() => {
      const ids = itemIds(collection.toArray)
      publications.push(ids)
      if (!injected && ids.includes(outer.id)) {
        injected = true
        queryClient.setQueryData(queryKey, [inner])
      }
    })
    cleanups.push(async () => subscription.unsubscribe())

    queryClient.setQueryData(queryKey, [outer])
    await vi.waitFor(() => expect(itemIds(collection.toArray)).toEqual([`c`]))

    expect(publications).toEqual([[`b`], [`c`]])
    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => expect(collection.toArray).toEqual([]))
  })

  it(`retains a reentrant newer application failure for subset settlement`, async () => {
    const id = `reentrant-result-failure`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `result`, name: `A` }
    const outer = { id: `b`, category: `result`, name: `B` }
    const invalid = { id: `invalid`, category: `result`, name: `Invalid` }
    const applicationError = new Error(`newest result application failed`)
    const queryClient = createQueryClient()
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn: () => Promise.resolve([initial]),
        getKey: (item) => {
          if (item.id === invalid.id) throw applicationError
          return item.id
        },
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      consoleError.mockRestore()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    let injected = false
    let pendingWaiter: Promise<void> | undefined
    const subscription = collection.subscribeChanges(() => {
      if (!injected && collection.has(outer.id)) {
        injected = true
        queryClient.setQueryData(queryKey, [invalid])
        pendingWaiter = expect(
          Promise.resolve(collection._sync.loadSubset({})),
        ).rejects.toBe(applicationError)
        void pendingWaiter.catch(() => {})
      }
    })
    cleanups.push(async () => subscription.unsubscribe())

    queryClient.setQueryData(queryKey, [outer])
    await vi.waitFor(() => expect(reportedError(collection)).toBeDefined())
    await pendingWaiter
    await expect(Promise.resolve(collection._sync.loadSubset({}))).rejects.toBe(
      applicationError,
    )
  })

  it(`retires mutation ownership when a later cache result is empty`, async () => {
    const id = `mutation-ownership-replacement`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const inserted = { id: `b`, category: `mutation`, name: `B` }
    const serverRows = [initial]
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(serverRows)))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (item) => item.id,
        startSync: true,
        onInsert: async ({ transaction, collection }) => {
          serverRows.push(
            ...transaction.mutations.map(({ modified }) =>
              structuredClone(modified),
            ),
          )
          await collection.utils.refetch()
        },
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.stateWhenReady()
    const mutation = collection.insert(inserted)
    await mutation.when('settled')
    expect({
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
    }).toEqual({ cache: [`a`, `b`], synced: [`a`, `b`], source: [`a`, `b`] })

    queryClient.setQueryData(queryKey, [])
    await vi.waitFor(() => {
      expect({
        cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
        synced: itemIds(collection._state.syncedData.values()),
        source: itemIds(collection.toArray),
      }).toEqual({ cache: [], synced: [], source: [] })
    })
  })

  it(`publishes an authoritative delete after its mutation refetch`, async () => {
    const id = `mutation-delete-publication`
    const queryKey = [id] as const
    const initial = { id: `a`, category: `mutation`, name: `A` }
    const serverRows = [initial]
    const queryClient = createQueryClient()
    const preexistingRefetchResult = createDeferred<Array<Item>>()
    const mutationRefetchResult = createDeferred<Array<Item>>()
    const persistenceGate = createDeferred<void>()
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    const commitRequests: Array<{
      writes: Array<string>
      receipt: `immediate` | `pending`
      outcome?: `applied` | `aborted` | `rejected`
    }> = []
    const queryFn = vi
      .fn<() => Promise<Array<Item>>>()
      .mockResolvedValueOnce(structuredClone(serverRows))
      .mockReturnValueOnce(preexistingRefetchResult.promise)
      .mockReturnValueOnce(mutationRefetchResult.promise)
    const baseOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (item) => item.id,
      startSync: true,
      onDelete: async ({ transaction, collection }) => {
        await persistenceGate.promise
        const deleted = new Set(
          transaction.mutations.map(({ original }) => original.id),
        )
        serverRows.splice(
          0,
          serverRows.length,
          ...serverRows.filter(({ id: rowId }) => !deleted.has(rowId)),
        )
        await collection.utils.refetch()
      },
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) => {
          let writes: Array<string> = []
          return originalSync.sync({
            ...params,
            metadata: recordMetadata(params.metadata!, metadata),
            begin: () => {
              writes = []
              return params.begin()
            },
            write: (change) => {
              writes.push(change.type)
              params.write(change)
            },
            commit: (signal) => {
              const result = params.commit(signal)
              const request: (typeof commitRequests)[number] = {
                writes: [...writes],
                receipt: result === true ? `immediate` : `pending`,
              }
              commitRequests.push(request)
              if (result === true) {
                request.outcome = `applied`
              } else {
                void result.then(
                  () => {
                    request.outcome = `applied`
                  },
                  (error) => {
                    request.outcome = isCancelledError(error)
                      ? `aborted`
                      : `rejected`
                  },
                )
              }
              return result
            },
          })
        },
      },
    })
    const derived = createLiveQueryCollection((query) =>
      query.from({ item: collection }).select(({ item }) => ({
        id: item.id,
        category: item.category,
        name: item.name,
      })),
    )
    const capture = (): MutationLifecycleSnapshot => ({
      server: itemIds(serverRows),
      cache: itemIds(queryClient.getQueryData<Array<Item>>(queryKey) ?? []),
      synced: itemIds(collection._state.syncedData.values()),
      source: itemIds(collection.toArray),
      derived: itemIds(derived.toArray),
    })
    const publications: Array<MutationLifecycleSnapshot> = []
    const subscription = derived.subscribeChanges(() => {
      publications.push(capture())
    })
    cleanups.push(async () => {
      persistenceGate.resolve()
      preexistingRefetchResult.resolve([])
      mutationRefetchResult.resolve([])
      subscription.unsubscribe()
      await derived.cleanup()
      await collection.cleanup()
      queryClient.clear()
    })

    await derived.preload()
    expectMutationLifecycleSnapshot(
      capture(),
      [initial.id],
      [initial.id],
      false,
    )

    const preexistingRefetch = collection.utils.refetch({ throwOnError: true })
    void preexistingRefetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    const mutation = collection.delete(initial.id)
    expect(itemIds(collection.toArray)).toEqual([])
    expect(itemIds(derived.toArray)).toEqual([])

    persistenceGate.resolve()
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    mutationRefetchResult.resolve([])
    await mutation.when('settled')

    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(commitRequests.some(({ writes }) => writes.includes(`delete`))).toBe(
      true,
    )
    expect(commitRequests.some(({ receipt }) => receipt === `pending`)).toBe(
      true,
    )
    expect(metadata.writes).toContainEqual({ type: `delete`, key: initial.id })
    await vi.waitFor(() =>
      expect(commitRequests.every(({ outcome }) => outcome !== undefined)).toBe(
        true,
      ),
    )
    expectMutationLifecycleSnapshot(capture(), [], [], false)
    expect(publications.at(-1)?.source).toEqual([])
    expect(publications.at(-1)?.derived).toEqual([])
  })

  it(`keeps cached rows until the final exact acquisition is released`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `shared-acquisition`,
      results: [[shared, detailOnly]],
    })
    const subset = { where: categoryIn(`shared`, `detail`) }

    await collection._sync.loadSubset(subset)
    await collection._sync.loadSubset(subset)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])

    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([])

    await collection._sync.loadSubset(subset)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
  })

  it(`removes only rows whose final query owner is released`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `overlapping-acquisitions`,
      results: [
        [shared, detailOnly],
        [shared, listOnly],
      ],
    })
    const detail = { where: categoryIn(`shared`, `detail`) }
    const list = { where: categoryIn(`shared`, `list`) }

    await collection._sync.loadSubset(detail)
    await collection._sync.loadSubset(list)
    expect(rows(collection)).toEqual([detailOnly.id, listOnly.id, shared.id])

    collection._sync.unloadSubset(detail)
    expect(rows(collection)).toEqual([listOnly.id, shared.id])
    await collection._sync.loadSubset(detail)
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual([detailOnly.id, listOnly.id, shared.id])

    collection._sync.unloadSubset(list)
    expect(rows(collection)).toEqual([detailOnly.id, shared.id])
  })

  it.each([`remount`, `refetch`] as const)(
    `keeps eager rows idle after cache removal and recovers on %s`,
    async (action) => {
      const id = `eager-lifetime-owner`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        syncMode: `eager`,
        results: [[shared], [{ ...shared, name: `Refetched` }]],
      })
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      queryClient.removeQueries({ queryKey: [id], exact: true })

      expect(rows(collection)).toEqual([shared.id])
      await Promise.resolve()
      expect(queryFn).toHaveBeenCalledOnce()

      const remounted =
        action === `remount` ? collection.subscribeChanges(() => {}) : undefined
      if (action === `refetch`) await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.get(shared.id)?.name).toBe(`Refetched`)
      })
      remounted?.unsubscribe()
    },
  )

  // Request data is reusable; each invocation still creates its own owner.
  // Cross startup with reference reuse and partial retirement, not only the
  // already-started observer path tested above.
  it.each(
    [2, 3].flatMap((owners) =>
      [false, true].flatMap((sharedReference) =>
        [0, 1, owners].map((retired) => ({
          owners,
          sharedReference,
          retired,
        })),
      ),
    ),
  )(
    `preserves startup ownership for $owners calls, shared reference $sharedReference, $retired retired`,
    async ({ owners, sharedReference, retired }) => {
      const id = `startup-owner-history`
      const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const queryHash = hashKey([id, getLoadSubsetDemandKey(subset)])
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[shared]],
        setupMetadata: (metadata) =>
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          }),
      })
      collection.startSyncImmediate()
      const requests = Array.from({ length: owners }, () =>
        sharedReference ? subset : { ...subset },
      )
      const results = Promise.allSettled(
        requests.map((request) => collection._sync.loadSubset(request)),
      )
      for (const request of requests.slice(0, retired)) {
        collection._sync.unloadSubset(request)
      }
      const outcomes = await results
      const live = owners - retired
      expect(
        outcomes.filter((outcome) => outcome.status === `fulfilled`),
      ).toHaveLength(live)
      const failures = outcomes.filter(
        (outcome) => outcome.status === `rejected`,
      )
      expect(failures).toHaveLength(retired)
      for (const failure of failures) {
        expect(failure.reason).toMatchObject({ name: `AbortError` })
      }
      expect(queryFn).toHaveBeenCalledTimes(live > 0 ? 1 : 0)
      const observedRows = () =>
        collection.toArray.map(({ id: rowId, category, name }) => ({
          id: rowId,
          category,
          name,
        }))
      expect(observedRows()).toEqual(live > 0 ? [shared] : [])
      for (let index = retired; index < owners; index++) {
        collection._sync.unloadSubset(requests[index]!)
        expect(observedRows()).toEqual(index + 1 < owners ? [shared] : [])
      }
    },
  )

  it.each([false, true])(
    `replaces an active eager cache entry with custom hash %s`,
    async (customHash) => {
      const id = `active-eager-custom-hash-${customHash}`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared], [{ ...shared, name: `Replaced` }]],
      })
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(() => {})
      try {
        queryClient.removeQueries({ queryKey: [id], exact: true })
        for (let turn = 0; turn < 20; turn++) await Promise.resolve()
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.get(shared.id)?.name).toBe(`Replaced`)
      } finally {
        subscription.unsubscribe()
      }
    },
  )

  it.each(
    [false, true].flatMap((mounted) =>
      [false, true].flatMap((customHash) =>
        [false, true].map((rejectOld) => ({ mounted, customHash, rejectOld })),
      ),
    ),
  )(
    `replaces a removed pending eager refetch without reviving idle demand: %j`,
    async ({ mounted, customHash, rejectOld }) => {
      const old = createDeferred<Array<Item>>()
      const next = createDeferred<Array<Item>>()
      const id = `pending-eager-removal`
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared], old.promise, next.promise],
      })
      await collection.stateWhenReady()
      let subscription = collection.subscribeChanges(() => {})
      if (!mounted) subscription.unsubscribe()
      let settled = false
      const refetch = collection.utils.refetch({ throwOnError: true }).then(
        () => {
          settled = true
        },
        (error: unknown) => {
          settled = true
          return error
        },
      )
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
        queryClient.removeQueries({ queryKey: [id], exact: true })
        for (let turn = 0; turn < 30; turn++) await Promise.resolve()
        expect(queryFn).toHaveBeenCalledTimes(mounted ? 3 : 2)
        expect(collection.get(shared.id)?.name).toBe(`Shared`)
        if (!mounted) subscription = collection.subscribeChanges(() => {})
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
        next.resolve([{ ...shared, name: `Current` }])
        await vi.waitFor(() =>
          expect(collection.get(shared.id)?.name).toBe(`Current`),
        )
        if (rejectOld) old.reject(new Error(`retired request failed`))
        else old.resolve([{ ...shared, name: `Obsolete` }])
        await vi.waitFor(() => expect(settled).toBe(true))
        expect(isCancelledError(await refetch)).toBe(true)
        expect(collection.get(shared.id)?.name).toBe(`Current`)
        expect(queryFn).toHaveBeenCalledTimes(3)
        expect(collection.status).toBe(`ready`)
      } finally {
        old.resolve([shared])
        next.resolve([shared])
        subscription.unsubscribe()
      }
    },
  )

  it.each(
    [0, Number.POSITIVE_INFINITY].flatMap((staleTime) =>
      [false, true].map((customHash) => ({ staleTime, customHash })),
    ),
  )(
    `starts only the requested fetch for an idle eager observer: %j`,
    async ({ staleTime, customHash }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `idle-explicit-refetch`,
        syncMode: `eager`,
        staleTime,
        customHash,
        results: [[shared]],
      })
      await collection.stateWhenReady()
      queryFn.mockResolvedValue([{ ...shared, name: `Refetched` }])
      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()
      const before = queryFn.mock.calls.length
      const [result] = await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(before + 1)
      expect(collection.subscriberCount).toBe(0)
      expect((result?.data as Array<Item>)[0]?.name).toBe(`Refetched`)
      expect(collection.get(shared.id)?.name).toBe(`Refetched`)
    },
  )

  it.each([`release`, `cleanup`, `retain`] as const)(
    `honors %s during startup retention maintenance`,
    async (action) => {
      const id = `released-startup-retention`
      const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
      const key = `queryCollection:gc:${hashKey([id, getLoadSubsetDemandKey(subset)])}`
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[shared]],
        setupMetadata: (metadata) =>
          metadata.collection.set(key, {
            queryHash: hashKey([id, getLoadSubsetDemandKey(subset)]),
            mode: `until-revalidated`,
          }),
      })
      collection.startSyncImmediate()
      const result = Promise.resolve(collection._sync.loadSubset(subset)).then(
        () => `ready`,
        (error: unknown) => error,
      )
      if (action === `release`) collection._sync.unloadSubset(subset)
      if (action === `cleanup`) await collection.cleanup()
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()
      if (action === `retain`) {
        expect(queryFn).toHaveBeenCalledTimes(1)
        await expect(result).resolves.toBe(`ready`)
        expect(collection.size).toBe(1)
      } else {
        expect(queryFn).not.toHaveBeenCalled()
        await expect(result).resolves.toMatchObject({ name: `AbortError` })
        expect(collection.size).toBe(0)
      }
    },
  )

  it.each([false, true])(
    `removes owned cache entries on cleanup with custom hash %s`,
    async (customHash) => {
      const id = `cleanup-custom-${customHash}`
      const { collection, queryClient } = createOwnershipFixture({
        id,
        customHash,
        syncMode: `eager`,
        results: [[shared]],
      })
      await collection.stateWhenReady()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
      await collection.cleanup()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    },
  )

  it(`settles an unfinished load when its final owner leaves`, async () => {
    const pending = createDeferred<Array<Item>>()
    const { collection } = createOwnershipFixture({
      id: `release-before-result`,
      results: [pending.promise],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    let outcome: unknown = `pending`
    const load = Promise.resolve(collection._sync.loadSubset(subset)).then(
      () => {
        outcome = `ready`
      },
      (error: unknown) => {
        outcome = error
      },
    )
    try {
      expect(collection.isLoadingSubset).toBe(true)
      collection._sync.unloadSubset(subset)
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(outcome).toMatchObject({ name: `AbortError` })
      expect(collection.isLoadingSubset).toBe(false)
      await load
    } finally {
      pending.resolve([shared])
    }
  })

  it(`keeps active on-demand rows when the Query cache entry departs`, async () => {
    const id = `active-cache-removal`
    const { collection, queryClient } = createOwnershipFixture({
      id,
      results: [[shared]],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection._sync.loadSubset(subset)

    queryClient.removeQueries({ queryKey: [id] })
    expect(rows(collection)).toEqual([shared.id])

    collection._sync.unloadSubset(subset)
    expect(rows(collection)).toEqual([])
  })

  it(`keeps an inactive scoped cache isolated from another scope's manual write`, async () => {
    const id = `inactive-scoped-cache-isolation`
    const queryClient = createQueryClient()
    const sourceRows = new Map<string, Item>([
      [`1`, { id: `1`, category: `A`, name: `Category A` }],
      [`2`, { id: `2`, category: `B`, name: `Category B` }],
    ])
    const expectedByCategory = new Map<string, Array<string>>()
    const providerCalls: Array<string> = []
    let manualWrites = 0
    let remountReached = false
    let comparisonCount = 0

    const recomputeCategory = (category: string): Array<string> =>
      Array.from(sourceRows.values())
        .filter((row) => row.category === category)
        .map((row) => row.id)
        .sort()

    expectedByCategory.set(`A`, recomputeCategory(`A`))
    expectedByCategory.set(`B`, recomputeCategory(`B`))

    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const operands = where?.type === `func` ? where.args : []
      const categoryRef = operands.find(
        (operand) =>
          operand.type === `ref` &&
          operand.path.length === 1 &&
          operand.path[0] === `category`,
      )
      const categoryValue = operands.find(
        (operand) =>
          operand.type === `val` && typeof operand.value === `string`,
      )
      if (
        where?.type !== `func` ||
        where.name !== `eq` ||
        operands.length !== 2 ||
        categoryRef?.type !== `ref` ||
        categoryValue?.type !== `val` ||
        typeof categoryValue.value !== `string`
      ) {
        throw new Error(`Category fixture received an unsupported request`)
      }

      const category = categoryValue.value
      providerCalls.push(category)
      return Promise.resolve(
        Array.from(sourceRows.values(), (row) => structuredClone(row)).filter(
          (row) => row.category === category,
        ),
      )
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const createCategoryQuery = (category: string) =>
      createLiveQueryCollection({
        query: (query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, category)),
      })

    type CategoryQuery = ReturnType<typeof createCategoryQuery>
    let inactiveCategoryA: CategoryQuery | undefined
    let activeCategoryB: CategoryQuery | undefined
    let remountedCategoryA: CategoryQuery | undefined

    try {
      inactiveCategoryA = createCategoryQuery(`A`)
      await inactiveCategoryA.preload()
      expect(rows(inactiveCategoryA)).toEqual(expectedByCategory.get(`A`))
      await inactiveCategoryA.cleanup()
      inactiveCategoryA = undefined

      activeCategoryB = createCategoryQuery(`B`)
      await activeCategoryB.preload()
      expect(rows(activeCategoryB)).toEqual(expectedByCategory.get(`B`))

      const added = { id: `3`, category: `B`, name: `New category B` }
      sourceRows.set(added.id, structuredClone(added))
      expectedByCategory.set(`B`, recomputeCategory(`B`))
      manualWrites++
      collection.utils.writeUpsert(structuredClone(added))
      const cacheEntriesAfterManualWrite = queryClient
        .getQueryCache()
        .findAll({ queryKey: [id] }).length

      remountedCategoryA = createCategoryQuery(`A`)
      await remountedCategoryA.preload()
      remountReached = true

      expect(providerCalls.slice(0, 2)).toEqual([`A`, `B`])
      expect(manualWrites).toBe(1)
      expect(remountReached).toBe(true)
      comparisonCount++
      expect(rows(remountedCategoryA)).toEqual(expectedByCategory.get(`A`))
      expect(comparisonCount).toBe(1)
      expect(cacheEntriesAfterManualWrite).toBe(1)
      expect(providerCalls.filter((category) => category === `A`)).toHaveLength(
        2,
      )
    } finally {
      await remountedCategoryA?.cleanup()
      await activeCategoryB?.cleanup()
      await inactiveCategoryA?.cleanup()
    }
  })

  /**
   * A direct insert changes the Collection independently of Query result
   * ownership. The previous direct-write contract permits this surgical
   * change even though the adapter cannot infer a subset owner for the row.
   * In this legal history, the fetched row belongs to one loaded subset and
   * the direct row belongs to no subset. The independent expected-key set
   * removes only the fetched row when that subset unloads. The production
   * driver uses the public write utilities and a real QueryClient; after the
   * accepted write, unload, and explicit delete, compare public Collection
   * keys and provider calls. This does not promise a bounded lifetime for an
   * unowned direct row that the caller never deletes.
   */
  it(`keeps a direct insert after its queried subset unloads`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `direct-insert-without-query-owner`,
      results: [[shared]],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    const inserted = { id: `direct`, category: `shared`, name: `Direct` }
    const expectedKeys = new Set([shared.id])

    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(inserted)
    expectedKeys.add(inserted.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())

    collection._sync.unloadSubset(subset)
    expectedKeys.delete(shared.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())
    expect(queryFn).toHaveBeenCalledOnce()

    await collection.utils.writeDelete(inserted.id)
    expectedKeys.delete(inserted.id)
    expect(rows(collection)).toEqual([...expectedKeys].sort())
  })

  /**
   * An explicit complete scoped result settles a directly inserted row in its
   * scope. The independent reference first accepts the surgical insert, then
   * replaces that scope with the empty server result at refetch settlement.
   * Ordinary subset unload above is distinct: it supplies no new server fact.
   */
  it(`removes an ownerless on-demand insert after an empty explicit refetch`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `on-demand-direct-insert-empty-refetch`,
      results: [[], []],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(shared)
    expect(rows(collection)).toEqual([shared.id])

    await collection.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual([])
  })

  /**
   * The reference treats only a successful, complete result for a row's
   * predicate as evidence that an omitted direct row is gone. A disjoint
   * predicate, a limited/offset/cursor window, and a failed request provide
   * no such fact.
   * Nonempty omission rejects an implementation that recognizes only empty
   * results. Each history compares public rows at refetch settlement.
   */
  it.each([
    {
      history: `complete-nonempty`,
      category: `shared`,
      window: {},
      removes: true,
    },
    { history: `disjoint`, category: `other`, window: {}, removes: false },
    {
      history: `limited`,
      category: `shared`,
      window: { limit: 1 },
      removes: false,
    },
    {
      history: `offset`,
      category: `shared`,
      window: { offset: 1 },
      removes: false,
    },
    {
      history: `cursor`,
      category: `shared`,
      window: {
        cursor: {
          whereFrom: eq(new IR.PropRef([`id`]), `other`),
          whereCurrent: eq(new IR.PropRef([`id`]), `other`),
          lastKey: `other`,
        },
      },
      removes: false,
    },
  ] as const)(
    `reconciles an ownerless direct row after a $history refetch`,
    async ({ history, category, window, removes }) => {
      const other = { id: `other`, category, name: `Other` }
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-refetch-${history}`,
        results: [[], [other]],
      })
      const subset = {
        where: eq(new IR.PropRef([`category`]), category),
        ...window,
      }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual(
        removes ? [other.id] : [other.id, shared.id],
      )
    },
  )

  /**
   * An empty provider response is not evidence of global absence. The
   * reference keeps an ownerless direct row when the complete predicate is
   * disjoint or the request covers only a window. The provider has no server
   * rows, so each empty response is a legal result for its request. Compare
   * public keys when the explicit refetch has applied.
   */
  it.each([
    {
      history: `disjoint-empty`,
      where: eq(new IR.PropRef([`category`]), `other`),
      window: {},
    },
    {
      history: `offset-empty`,
      where: eq(new IR.PropRef([`category`]), `shared`),
      window: { offset: 1 },
    },
    {
      history: `cursor-empty`,
      where: eq(new IR.PropRef([`category`]), `shared`),
      window: {
        cursor: {
          whereFrom: eq(new IR.PropRef([`id`]), `other`),
          whereCurrent: eq(new IR.PropRef([`id`]), `other`),
          lastKey: `other`,
        },
      },
    },
  ] as const)(
    `keeps an ownerless direct row after a $history refetch`,
    async ({ history, where, window }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-${history}`,
        results: [[], []],
      })
      const subset = { where, ...window }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual([shared.id])
    },
  )

  /**
   * A compound predicate remains a scope boundary. The independent rule
   * evaluates both conjuncts on the accepted direct row before deciding
   * whether a complete empty result can retire it.
   */
  it.each([
    { history: `matching`, id: shared.id, removes: true },
    { history: `disjoint`, id: `other`, removes: false },
  ] as const)(
    `reconciles a direct row after a $history compound-scope refetch`,
    async ({ history, id, removes }) => {
      const { collection, queryFn } = createOwnershipFixture({
        id: `ownerless-compound-${history}`,
        results: [[], []],
      })
      const subset = {
        where: new IR.Func(`and`, [
          eq(new IR.PropRef([`category`]), `shared`),
          eq(new IR.PropRef([`id`]), id),
        ]),
      }
      await collection._sync.loadSubset(subset)
      await collection.utils.writeInsert(shared)
      await collection.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(rows(collection)).toEqual(removes ? [] : [shared.id])
    },
  )

  /** A failed response provides no complete scope and cannot retire a row. */
  it(`keeps an ownerless direct row when explicit refetch fails`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `ownerless-failed-refetch`,
      results: [[]],
    })
    const subset = { where: eq(new IR.PropRef([`category`]), `shared`) }
    await collection._sync.loadSubset(subset)
    await collection.utils.writeInsert(shared)
    queryFn.mockRejectedValueOnce(new Error(`source unavailable`))
    await expect(
      collection.utils.refetch({ throwOnError: true }),
    ).rejects.toThrow(`source unavailable`)
    expect(rows(collection)).toEqual([shared.id])
  })

  /**
   * An eager refetch is a complete source snapshot. A direct insert changes
   * the public row set without fetching, but a later explicit refetch with an
   * empty server result removes that key. The independent reference replaces
   * its full row set with the returned snapshot at refetch settlement. This
   * crosses the public write/refetch path and compares both rows and requests.
   */
  it(`reconciles an eager direct insert against a later empty refetch`, async () => {
    const { collection, queryFn } = createOwnershipFixture({
      id: `eager-direct-insert-refetch`,
      results: [[], []],
      syncMode: `eager`,
    })
    await collection.preload()
    expect(rows(collection)).toEqual([])
    await collection.utils.writeInsert(shared)
    expect(rows(collection)).toEqual([shared.id])
    await collection.utils.refetch()
    expect(rows(collection)).toEqual([])
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A direct eager insert need not inherit the prior fetched result's owner.
   * The next complete provider snapshot can claim that same key and replace
   * its value; a following empty snapshot removes it. The independent eager
   * reference replaces its full row set at each explicit refetch settlement.
   */
  it(`claims and later removes an eager direct insert through server snapshots`, async () => {
    const server = { ...shared, name: `Server` }
    const { collection, queryFn } = createOwnershipFixture({
      id: `eager-direct-insert-later-claim`,
      results: [[], [server], []],
      syncMode: `eager`,
    })
    await collection.preload()
    await collection.utils.writeInsert({ ...shared, name: `Direct` })
    expect(collection.get(shared.id)?.name).toBe(`Direct`)
    await collection.utils.refetch()
    expect(collection.get(shared.id)?.name).toBe(`Server`)
    await collection.utils.refetch()
    expect(collection.has(shared.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  /**
   * A direct update preserves both subset claims in durable metadata. A fresh
   * Collection over those stored rows can retire one claim after an empty
   * result without losing the peer's row, then retire the final claim and the
   * row. The reference is the authored set of two demand identities; each
   * empty result removes only its own identity. Cloning the durable snapshot
   * represents a new process without asking cleanup to retire the old run's
   * active demands. Compare exact stored owners and public rows after each
   * revalidation, not just their cardinality.
   */
  it(`retires overlapping persisted owners after a direct update and restart`, async () => {
    const id = `direct-update-overlap-persisted-restart`
    const first = categorySubset(`detail`)
    const second = categorySubset(`list`)
    const firstHash = hashKey([id, getLoadSubsetDemandKey(first)])
    const secondHash = hashKey([id, getLoadSubsetDemandKey(second)])
    const hotStorage = createOwnershipStorage()
    const hot = createPersistedOwnershipFixture(id, hotStorage, [shared])

    await hot.collection._sync.loadSubset(first)
    await hot.collection._sync.loadSubset(second)
    await hot.collection.utils.writeUpdate({ id: shared.id, name: `Updated` })
    const durable = hotStorage.snapshot()
    expect(durable.rows.get(shared.id)?.name).toBe(`Updated`)
    expect(persistedOwners(durable.rowMetadata, shared.id)).toEqual(
      [firstHash, secondHash].sort(),
    )

    const coldStorage = createOwnershipStorage(durable)
    const cold = createPersistedOwnershipFixture(id, coldStorage, [])
    await cold.collection._sync.loadSubset(first)
    expect(cold.collection.get(shared.id)?.name).toBe(`Updated`)
    expect(
      persistedOwners(coldStorage.snapshot().rowMetadata, shared.id),
    ).toEqual([secondHash])

    await cold.collection._sync.loadSubset(second)
    expect(cold.collection.has(shared.id)).toBe(false)
    const settled = coldStorage.snapshot()
    expect(settled.rows.has(shared.id)).toBe(false)
    expect(persistedOwners(settled.rowMetadata, shared.id)).toEqual([])
    expect(hot.queryFn).toHaveBeenCalledTimes(2)
    expect(cold.queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * SQLite is the receiving boundary for the row-lifetime rule. A fetched
   * lifetime ends at direct deletion; reinserting the key creates a durable
   * unowned row. Releasing both old subset leases and restarting the Collection
   * must not turn their retired claims into a deletion of that row.
   */
  it(`keeps a reinserted direct row across SQLite subset release and restart`, async () => {
    const id = `direct-row-lifetime-sqlite-restart`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const makeCollection = (client: QueryClient, source: typeof queryFn) =>
      createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient: client,
            queryKey: [id],
            queryFn: source,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
          persistence: managed,
        }),
      )
    const collection = makeCollection(queryClient, queryFn)
    const first = { limit: 1 }
    const second = { limit: 2 }
    const replacement = { ...shared, name: `Reinserted` }
    const restart: {
      collection?: ReturnType<typeof makeCollection>
      client?: QueryClient
    } = {}
    cleanups.push(async () => {
      await restart.collection?.cleanup()
      await collection.cleanup()
      queryClient.clear()
      restart.client?.clear()
      driver.close()
    })

    await collection._sync.loadSubset(first)
    await collection._sync.loadSubset(second)
    await collection.utils.writeDelete(shared.id)
    await collection.utils.writeInsert(replacement)
    collection._sync.unloadSubset(first)
    collection._sync.unloadSubset(second)
    expect(collection.get(shared.id)?.name).toBe(replacement.name)

    await collection.cleanup()
    restart.client = createQueryClient()
    restart.collection = makeCollection(
      restart.client,
      vi.fn(() => Promise.resolve([])),
    )
    await restart.collection._sync.loadSubset(first)
    expect(restart.collection.get(shared.id)?.name).toBe(replacement.name)
  })

  /**
   * A fresh persisted run no longer has the writer's in-memory position, but
   * an explicit complete source result still settles an omitted direct row.
   * The reference has a durable insert followed by an empty complete-scope fetch:
   * the row exists before that fetch and is absent when it applies. This is
   * separate from the limited-window restart above, whose omission proves
   * nothing about a row outside its window. A disjoint durable row remains
   * stored because the filtered result says nothing about it. Its public
   * visibility requires acquiring its own on-demand scope after restart.
   */
  it(`retires a persisted ownerless row after a complete empty result`, async () => {
    const id = `persisted-ownerless-complete-result`
    const disjoint = {
      id: `persisted-disjoint`,
      category: `other`,
      name: `Other`,
    }
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Item>))
    const makeCollection = (client: QueryClient) =>
      createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item, string | number, Item, unknown>
        >({
          ...queryCollectionOptions<Item>({
            id,
            queryClient: client,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
          persistence: managed,
        }),
      )
    const first = makeCollection(queryClient)
    const restart: { collection?: ReturnType<typeof makeCollection> } = {}
    const secondClient = createQueryClient()
    cleanups.push(async () => {
      await restart.collection?.cleanup()
      await first.cleanup()
      queryClient.clear()
      secondClient.clear()
      driver.close()
    })
    await vi.waitFor(() => expect(first.status).toBe(`ready`))
    await first.utils.writeInsert(shared)
    await first.utils.writeInsert(disjoint)
    expect(first.has(shared.id)).toBe(true)
    expect(first.has(disjoint.id)).toBe(true)
    await first.cleanup()
    const claim = await managed.adapter.claimCacheGeneration!(id)
    try {
      const durable = await managed.adapter.loadResumeSnapshot({
        kind: `managed`,
        storageCollectionId: claim.storageCollectionId,
        claimId: claim.claimId,
      })
      expect(durable.rows.find((row) => row.key === shared.id)?.value).toEqual(
        shared,
      )
      expect(
        durable.rows.find((row) => row.key === disjoint.id)?.value,
      ).toEqual(disjoint)
    } finally {
      await managed.adapter.releaseCacheGenerationClaim!(claim.claimId)
    }
    restart.collection = makeCollection(secondClient)
    await restart.collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `shared`),
    })
    expect(queryFn).toHaveBeenCalledOnce()
    expect(restart.collection.has(shared.id)).toBe(false)
    const settledClaim = await managed.adapter.claimCacheGeneration!(id)
    try {
      const durable = await managed.adapter.loadResumeSnapshot({
        kind: `managed`,
        storageCollectionId: settledClaim.storageCollectionId,
        claimId: settledClaim.claimId,
      })
      expect(durable.rows.some((row) => row.key === shared.id)).toBe(false)
      expect(
        durable.rows.find((row) => row.key === disjoint.id)?.value,
      ).toEqual(disjoint)
    } finally {
      await managed.adapter.releaseCacheGenerationClaim!(settledClaim.claimId)
    }
  })

  /**
   * Direct writes previously promised to change the synced rows without an
   * automatic Query refetch. The pre-#1826 user guide and QueryCollectionUtils
   * API comments stated that promise. It lets a caller apply one server event
   * without requesting every active subset again. A later, independently
   * scheduled queryFn result may still replace the write.
   *
   * The independent reference filters the event-updated rows by category.
   * The legal history loads ten disjoint live queries, then upserts, updates,
   * deletes, inserts, and batches rows across their scopes. The production
   * driver records real queryFn requests. After each accepted write, public
   * rows must reflect the event and no new provider request may have started
   * because of the write. This does not promise that direct writes
   * maintain exact Query cache entries for arbitrary scoped or windowed
   * requests; the caller controls that lower-level consistency risk.
   */
  it(`direct write changes one row without requesting active subsets`, async () => {
    const id = `scoped-direct-write-work`
    const queryClient = createQueryClient()
    const categories = Array.from(
      { length: 10 },
      (_, index) => `category-${index}`,
    )
    const providerRows = new Map<string, Item>(
      categories.map((category) => [
        category,
        { id: category, category, name: `Before` },
      ]),
    )
    const providerCalls: Array<string> = []
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const category =
        where?.type === `func`
          ? where.args.find((arg) => arg.type === `val`)?.value
          : undefined
      if (typeof category !== `string`) {
        throw new Error(`Expected an equality subset with a category`)
      }
      providerCalls.push(category)
      return Promise.resolve(
        [...providerRows.values()]
          .filter((row) => row.category === category)
          .map((row) => structuredClone(row)),
      )
    })
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const liveQueries = categories.map((category) =>
      createLiveQueryCollection({
        query: (query) =>
          query
            .from({ item: collection })
            .where(({ item }) => eq(item.category, category)),
      }),
    )
    cleanups.push(async () => {
      await Promise.all(liveQueries.map((query) => query.cleanup()))
      await collection.cleanup()
      queryClient.clear()
    })

    await Promise.all(liveQueries.map((query) => query.preload()))
    expect(providerCalls).toHaveLength(categories.length)

    const expectDirectWrite = async (write: () => Promise<void>) => {
      const callsBeforeWrite = providerCalls.length
      await write()
      for (const [index, category] of categories.entries()) {
        const expectedRows = [...providerRows.values()].filter(
          (row) => row.category === category,
        )
        expect(
          liveQueries[index]!.toArray.map((row) => row.name).sort(),
        ).toEqual(expectedRows.map((row) => row.name).sort())
      }
      expect(providerCalls.slice(callsBeforeWrite)).toEqual([])
    }

    const changed = {
      ...providerRows.get(categories[3]!)!,
      name: `After`,
    }
    providerRows.set(changed.id, changed)
    await expectDirectWrite(() =>
      collection.utils.writeUpsert(structuredClone(changed)),
    )

    const updated = { ...changed, name: `Updated` }
    providerRows.set(updated.id, updated)
    await expectDirectWrite(() =>
      collection.utils.writeUpdate({ id: updated.id, name: updated.name }),
    )

    providerRows.delete(updated.id)
    await expectDirectWrite(() => collection.utils.writeDelete(updated.id))

    const inserted = {
      id: `inserted`,
      category: categories[3]!,
      name: `Inserted`,
    }
    providerRows.set(inserted.id, inserted)
    await expectDirectWrite(() => collection.utils.writeInsert(inserted))

    const batched = {
      id: `batched`,
      category: categories[4]!,
      name: `Batched`,
    }
    const batchUpdated = {
      ...providerRows.get(categories[4]!)!,
      name: `Batch updated`,
    }
    providerRows.set(batched.id, batched)
    providerRows.set(batchUpdated.id, batchUpdated)
    await expectDirectWrite(() =>
      collection.utils.writeBatch(() => {
        collection.utils.writeInsert(batched)
        collection.utils.writeUpdate({
          id: batchUpdated.id,
          name: batchUpdated.name,
        })
      }),
    )
  })

  /**
   * A direct delete cannot infer the row that fills a limited provider window.
   * The independent source model slices eleven ordered rows to ten. Deleting
   * the first row leaves nine cached rows under infinite stale time, even after
   * reacquisition; an explicit refetch returns the next ten-row source slice.
   * The public checkpoint is the row set and request count after each load and
   * after refetch. This documents the lower-level API's exactness boundary.
   */
  it(`refills a directly shortened window only after explicit refetch`, async () => {
    type Row = { id: string; rank: number }
    const id = `direct-delete-window-refill`
    const queryClient = createQueryClient()
    const source = Array.from({ length: 11 }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const queryFn = vi.fn((context: QueryFunctionContext) =>
      Promise.resolve(
        source
          .slice(0, context.meta?.loadSubsetOptions?.limit ?? source.length)
          .map((row) => ({ ...row })),
      ),
    )
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const demand = { limit: 10 }
    await collection._sync.loadSubset(demand)
    expect(rows(collection)).toEqual(
      source
        .slice(0, 10)
        .map((row) => row.id)
        .sort(),
    )
    source.shift()
    await collection.utils.writeDelete(`0`)
    expect(rows(collection)).toHaveLength(9)
    collection._sync.unloadSubset(demand)
    await collection._sync.loadSubset(demand)
    expect(queryFn).toHaveBeenCalledOnce()
    expect(rows(collection)).toHaveLength(9)
    await collection.utils.refetch()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows(collection)).toEqual(
      source
        .slice(0, 10)
        .map((row) => row.id)
        .sort(),
    )
  })

  /**
   * A deferred refresh barrier is legal during offline replay. It delays
   * application of fetched data, but it does not turn a direct write into a
   * request. No Query request is in flight in this history, so the independent
   * reference keeps the accepted event row. The history loads one on-demand
   * Query, holds the barrier, writes, then releases it. It observes public
   * rows and real queryFn calls after the accepted write and barrier release;
   * it does not model the full OfflineExecutor.
   */
  it(`does not refetch a direct write after a deferred refresh barrier`, async () => {
    const id = `deferred-direct-write-no-refetch`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([structuredClone(initial)]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const barrier = createDeferred<void>()
    const release = barrier.promise.finally(() => {
      collection.deferDataRefresh = null
    })
    cleanups.push(async () => {
      barrier.resolve()
      await release
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    expect(queryFn).toHaveBeenCalledTimes(1)
    collection.deferDataRefresh = barrier.promise
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)

    barrier.resolve()
    await release
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(collection.get(initial.id)?.name).toBe(`After`)
  })

  /**
   * A directly selected array is a writable part of the Query response.
   * Unlike a derived projection, replacing this property preserves the
   * envelope. The authored response predicts both the changed row and the
   * unchanged metadata after an accepted on-demand direct write.
   */
  it(`patches a directly selected on-demand cache array without refetching`, async () => {
    const id = `direct-select-direct-write`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const response = { items: [initial], pageInfo: { hasNextPage: false } }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) => value.items,
        getKey: (item: Item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })

    expect(queryClient.getQueryData([id])).toEqual({
      items: [{ ...initial, name: `After` }],
      pageInfo: response.pageInfo,
    })
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A derived select reads rows from an envelope but gives no inverse for a
   * direct cache write. The documented edges-to-nodes projection is legal.
   * A direct write may leave its Query cache row stale, but the cached value
   * must remain a valid response for select. The response shape is the
   * independent reference; the driver loads it through a real QueryClient,
   * then checks the cache, public Collection row, and request count after the
   * accepted write. This does not require an inverse projection.
   */
  it(`keeps a derived selected cache response valid after a direct write`, async () => {
    const id = `derived-select-direct-write`
    const initial = { id: `row`, category: `A`, name: `Before` }
    const response = {
      edges: [{ cursor: `cursor-1`, node: initial }],
      pageInfo: { hasNextPage: false },
    }
    const select = (value: typeof response) =>
      value.edges.map((edge) => edge.node)
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select,
        getKey: (item: Item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    expect(queryClient.getQueryData([id])).toEqual(response)
    await collection.utils.writeUpdate({ id: initial.id, name: `After` })

    const cached = queryClient.getQueryData<typeof response>([id])!
    expect(cached.edges).toEqual([
      expect.objectContaining({
        cursor: `cursor-1`,
        node: expect.objectContaining({ id: initial.id }),
      }),
    ])
    expect(select(cached)).toEqual([
      expect.objectContaining({ id: initial.id }),
    ])
    expect(collection.get(initial.id)?.name).toBe(`After`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A direct write is local to its Collection until a provider result says
   * otherwise. Two Collections may own one physical Query, but that shared
   * cache cannot carry A's accepted local row into B. The reference has one
   * server row and two Collection row sets: writing A changes only A. Compare
   * both public rows and the shared cache immediately after the write, before
   * any newer provider result can legitimately update B.
   */
  it.each(
    ([`update`, `delete`, `upsert`] as const).flatMap((operation) =>
      ([`A-first`, `B-first`] as const).map((loadOrder) => ({
        operation,
        loadOrder,
      })),
    ),
  )(
    `keeps a $operation out of another Collection sharing its Query ($loadOrder)`,
    async ({ operation, loadOrder }) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-direct-write-isolation`]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([{ ...server }]))
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const ownerA = makeCollection(`shared-direct-write-owner-a`)
      const ownerB = makeCollection(`shared-direct-write-owner-b`)
      cleanups.push(async () => {
        await ownerA.cleanup()
        await ownerB.cleanup()
        queryClient.clear()
      })

      const first = loadOrder === `A-first` ? ownerA : ownerB
      const second = loadOrder === `A-first` ? ownerB : ownerA
      await first._sync.loadSubset({})
      await second._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledTimes(1)
      if (operation === `delete`) await ownerA.utils.writeDelete(server.id)
      else if (operation === `upsert`)
        await ownerA.utils.writeUpsert({ id: server.id, name: `Manual` })
      else await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(ownerA.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(ownerB.get(server.id)?.name).toBe(`Server`)
      expect(queryClient.getQueryData(queryKey)).toEqual([server])
      expect(queryFn).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * Eager Collections project one shared Query cache. A direct cache write
   * changes that projection for both Collections without starting a request.
   * The independent reference applies each write to the shared row set, then
   * compares both public Collections and the Query cache at write settlement.
   */
  it.each([`update`, `delete`, `upsert`] as const)(
    `projects an eager $0 through a Query shared by two Collections`,
    async (operation) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-eager-direct-${operation}`]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([server]))
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `shared-eager-direct-${operation}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `eager`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await Promise.all([a.preload(), b.preload()])
      expect(queryFn).toHaveBeenCalledOnce()
      if (operation === `delete`) await a.utils.writeDelete(server.id)
      else if (operation === `upsert`)
        await a.utils.writeUpsert({ id: server.id, name: `Manual` })
      else await a.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(a.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(b.get(server.id)?.name).toBe(
        operation === `delete` ? undefined : `Manual`,
      )
      expect(queryClient.getQueryData(queryKey)).toEqual(
        operation === `delete` ? [] : [{ id: server.id, name: `Manual` }],
      )
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * A new direct key joins the shared eager cache and both projections. A
   * later complete server response that omits the key retires it in both.
   */
  it(`projects an eager new-key insert until a later complete fetch`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-new-key`]
    const server = { id: `x`, name: `Server` }
    const queryFn = vi.fn(() => Promise.resolve([server]))
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `shared-eager-new-key-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    expect(queryFn).toHaveBeenCalledOnce()
    await a.utils.writeInsert({ id: `y`, name: `Manual` })
    expect(a.get(`y`)?.name).toBe(`Manual`)
    expect(b.get(`y`)?.name).toBe(`Manual`)
    expect(queryClient.getQueryData(queryKey)).toEqual([
      server,
      { id: `y`, name: `Manual` },
    ])
    expect(queryFn).toHaveBeenCalledOnce()

    await b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(a.has(`y`)).toBe(false)
    expect(b.has(`y`)).toBe(false)
    expect(a.get(`x`)?.name).toBe(server.name)
    expect(b.get(`x`)?.name).toBe(server.name)
  })

  /**
   * A shared eager cache projects A's direct write to both Collections. The
   * older request must not undo that accepted value in either projection;
   * a later-started complete fetch can replace it in both.
   */
  it(`preserves an eager direct write across an older shared fetch`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-older-fetch`]
    const server = { id: `x`, name: `Server` }
    const older = { id: `x`, name: `Older` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        started.resolve()
        return held.promise
      })
      .mockResolvedValue([newer])
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `shared-eager-older-fetch-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      held.resolve([older])
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    const refetch = b.utils.refetch({ throwOnError: true })
    await started.promise
    await a.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(b.get(server.id)?.name).toBe(`Manual`)
    held.resolve([older])
    await refetch
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(b.get(server.id)?.name).toBe(`Manual`)

    await b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(a.get(server.id)?.name).toBe(newer.name)
    expect(b.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * A later eager Collection projects the shared cache's direct edit without
   * requiring a new fetch. A subsequent explicit fetch replaces that cached
   * value in both Collections. The reference keeps cache projection separate
   * from server freshness and compares both rows and request count.
   */
  it(`projects an eager cache patch on later acquisition`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`late-eager-direct-patch`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `late-eager-direct-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve([newer])
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a.preload()
    await a.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    peer.collection = makeCollection(`b`)
    const b = peer.collection
    await b.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    expect(b.get(server.id)?.name).toBe(`Manual`)
    expect(a.get(server.id)?.name).toBe(`Manual`)
    const refetch = b.utils.refetch({ throwOnError: true })
    await requestStarted.promise
    expect(b.get(server.id)?.name).toBe(`Manual`)
    held.resolve([newer])
    await refetch
    expect(b.get(server.id)?.name).toBe(newer.name)
    expect(a.get(server.id)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A disabled Query never starts its own request. Eager B can project the
   * shared cache edit immediately; on-demand B still waits for server
   * authority under its separate subset ownership law, including after an
   * outside setQueryData edit. Explicit refetch remains available in both
   * modes and later replaces the cached value.
   */
  it.each([
    { syncMode: `eager`, externalCacheEdit: false },
    { syncMode: `on-demand`, externalCacheEdit: false },
    { syncMode: `on-demand`, externalCacheEdit: true },
  ] as const)(
    `respects disabled $syncMode acquisition of a shared Query with external cache edit=$externalCacheEdit`,
    async ({ syncMode, externalCacheEdit }) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`disabled-late-peer-${syncMode}-${externalCacheEdit}`]
      const server = { id: `x`, name: `Server` }
      const newer = { id: `x`, name: `Newer` }
      const held = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([server])
        .mockImplementationOnce(() => held.promise)
      const makeCollection = (suffix: string, enabled: boolean) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `disabled-late-peer-${syncMode}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode,
            enabled,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`, true)
      const peer: { collection?: ReturnType<typeof makeCollection> } = {}
      cleanups.push(async () => {
        held.resolve([newer])
        await a.cleanup()
        await peer.collection?.cleanup()
        queryClient.clear()
      })

      if (syncMode === `eager`) await a.preload()
      else await a._sync.loadSubset({})
      await a.utils.writeUpdate({ id: server.id, name: `Manual` })
      if (externalCacheEdit)
        queryClient.setQueryData(queryKey, [{ ...server, name: `Manual` }])
      peer.collection = makeCollection(`b`, false)
      const b = peer.collection
      const load =
        syncMode === `eager`
          ? b.preload()
          : Promise.resolve(b._sync.loadSubset({}))
      let loadState: `pending` | `fulfilled` | `rejected` = `pending`
      void load.then(
        () => (loadState = `fulfilled`),
        () => (loadState = `rejected`),
      )
      for (let turn = 0; turn < 4; turn++) await Promise.resolve()
      expect(queryFn).toHaveBeenCalledOnce()
      expect(b.get(server.id)?.name).toBe(
        syncMode === `eager` ? `Manual` : undefined,
      )
      expect(loadState).toBe(syncMode === `eager` ? `fulfilled` : `pending`)

      const refetch = b.utils.refetch({ throwOnError: true })
      held.resolve([newer])
      await Promise.all([load, refetch])
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(b.get(server.id)?.name).toBe(newer.name)
      expect(a.get(server.id)?.name).toBe(newer.name)
    },
  )

  /**
   * An eager direct write can seed an idle shared Query before any provider
   * fetch. A disabled B projects that seed without starting a request. The
   * next explicit refetch can replace it with the server row.
   */
  it(`projects an eager direct cache seed to a disabled peer`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`disabled-eager-seed-peer`]
    const direct = { id: `x`, name: `Manual` }
    const server = { id: `x`, name: `Server` }
    const held = createDeferred<Array<Row>>()
    const queryFn = vi.fn(() => held.promise)
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `disabled-eager-seed-peer-${suffix}`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `eager`,
          enabled: false,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve([server])
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a.utils.writeInsert(direct)
    expect(a.get(direct.id)?.name).toBe(direct.name)
    expect(queryClient.getQueryData(queryKey)).toEqual([direct])
    peer.collection = makeCollection(`b`)
    const b = peer.collection
    const load = b.preload()
    for (let turn = 0; turn < 4; turn++) await Promise.resolve()
    expect(queryFn).not.toHaveBeenCalled()
    await load
    expect(b.get(direct.id)?.name).toBe(direct.name)

    const refetch = b.utils.refetch({ throwOnError: true })
    expect(queryFn).toHaveBeenCalledOnce()
    held.resolve([server])
    await refetch
    expect(b.get(direct.id)?.name).toBe(server.name)
    expect(a.get(direct.id)?.name).toBe(server.name)
  })

  /**
   * An eager Query is one keyed cache document projected by both Collections.
   * A direct write changes its authored key in that document; a peer's later
   * direct write changes only its own authored key, even if that peer has not
   * yet applied the first cache notification. The independent reference folds
   * A's write then B's write over the two server rows. Holding B's result
   * application keeps its accepted rows stale at B's write, distinguishing a
   * surgical cache edit from replacing the cache with B's whole row snapshot.
   * The same-key neighbor requires the later accepted write to win. Compare
   * the shared cache and unblocked A projection after B's accepted write, while
   * B's result application remains held. Neither write starts a request.
   */
  it.each([`disjoint`, `same-key`] as const)(
    `composes $0 eager direct writes through one shared Query`,
    async (writeOrder) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-eager-write-composition`, writeOrder]
      const server = [
        { id: `x`, name: `Server X` },
        { id: `y`, name: `Server Y` },
      ]
      const queryFn = vi.fn(() => Promise.resolve(server))
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `shared-eager-write-composition-${writeOrder}-${suffix}`,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `eager`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      const barrier = createDeferred<void>()
      cleanups.push(async () => {
        b.deferDataRefresh = null
        barrier.resolve()
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await Promise.all([a.preload(), b.preload()])
      expect(queryFn).toHaveBeenCalledOnce()
      b.deferDataRefresh = barrier.promise
      await a.utils.writeUpdate({ id: `x`, name: `A` })
      expect(b.get(`x`)?.name).toBe(`Server X`)
      const bKey = writeOrder === `disjoint` ? `y` : `x`
      await b.utils.writeUpdate({ id: bKey, name: `B` })
      expect(b.get(bKey)?.name).toBe(`B`)
      if (writeOrder === `disjoint`) expect(b.get(`x`)?.name).toBe(`Server X`)

      const expected = [
        { id: `x`, name: writeOrder === `disjoint` ? `A` : `B` },
        { id: `y`, name: writeOrder === `disjoint` ? `B` : `Server Y` },
      ]
      expect(queryClient.getQueryData(queryKey)).toEqual(expected)
      expect(queryFn).toHaveBeenCalledOnce()
      await vi.waitFor(() => {
        expect([a.get(`x`)?.name, a.get(`y`)?.name]).toEqual(
          expected.map((row) => row.name),
        )
      })
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * Directly selected response arrays carry the same shared-Query law as raw
   * arrays. The response envelope is part of the cache contract, while each
   * Collection's accepted rows can lag behind a held notification. Folding
   * two disjoint writes over the response checks both row composition and
   * preservation of unrelated envelope metadata without a provider request.
   */
  it(`composes eager peer writes inside a selected response array`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-eager-wrapped-composition`]
    const server = [
      { id: `x`, name: `Server X` },
      { id: `y`, name: `Server Y` },
    ]
    const queryFn = vi.fn(() => Promise.resolve({ items: server, tag: `keep` }))
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey,
          queryFn,
          select: (response) => response.items,
          getKey: (row: Row) => row.id,
          syncMode: `eager`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`shared-eager-wrapped-a`)
    const b = makeCollection(`shared-eager-wrapped-b`)
    const barrier = createDeferred<void>()
    cleanups.push(async () => {
      b.deferDataRefresh = null
      barrier.resolve()
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await Promise.all([a.preload(), b.preload()])
    b.deferDataRefresh = barrier.promise
    await a.utils.writeUpdate({ id: `x`, name: `A` })
    await b.utils.writeUpdate({ id: `y`, name: `B` })
    const expected = [
      { id: `x`, name: `A` },
      { id: `y`, name: `B` },
    ]
    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: expected,
      tag: `keep`,
    })
    await vi.waitFor(() => {
      expect([a.get(`x`)?.name, a.get(`y`)?.name]).toEqual([`A`, `B`])
    })
    expect(queryFn).toHaveBeenCalledOnce()
  })

  /**
   * B owns a shared on-demand Query while A has no subset owner. The Query
   * Collection guide's on-demand cache rule protects another Collection's
   * owned Query: A's direct insert changes only A's accepted row and starts
   * no provider request. A later physical fetch may replace that row when A
   * acquires the cached result, as the guide's shared-key rule permits.
   *
   * The reference is the authored server row, A-only insert, and newer server
   * row in that order. The first public-row and cache checkpoint rejects a
   * shared-cache guard that runs only when the writing Collection owns a row.
   * The final checkpoint distinguishes that guard from a rule that refuses
   * all later server authority.
   */
  it(`keeps an unacquired direct insert out of another Collection's shared Query`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-unacquired-direct-insert`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockResolvedValue([newer])
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const ownerA = makeCollection(`shared-unacquired-insert-a`)
    const ownerB = makeCollection(`shared-unacquired-insert-b`)
    cleanups.push(async () => {
      await ownerA.cleanup()
      await ownerB.cleanup()
      queryClient.clear()
    })

    await ownerB._sync.loadSubset({})
    expect(ownerB.get(server.id)?.name).toBe(server.name)
    expect(ownerA.has(server.id)).toBe(false)
    await ownerA.utils.writeInsert({ id: server.id, name: `Manual` })
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(server.name)
    expect(queryClient.getQueryData(queryKey)).toEqual([server])
    expect(queryFn).toHaveBeenCalledOnce()

    await ownerB.utils.refetch({ throwOnError: true })
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(newer.name)
    await ownerA._sync.loadSubset({})
    expect(ownerA.get(server.id)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A Collection that acquires a Query after another Collection's direct
   * cache patch must not mistake that local edit for a server result. The
   * reference starts with one server row, then gives only A the direct update.
   * B's first acquisition may request a new result; while that request is
   * held, B has no server-confirmed copy of A's value. A post-write result
   * may then replace A's write in both Collections. Constructing B before or
   * after the write varies registration without changing this authority law.
   * The driver checks public rows, cache data, and provider calls at each cut.
   */
  it.each([`registered`, `later-created`] as const)(
    `does not adopt another Collection's cached direct edit on later acquisition: %s`,
    async (peerTiming) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`late-shared-direct-edit-${peerTiming}`]
      const server = { id: `x`, name: `Server` }
      const newer = { id: `x`, name: `Newer` }
      const held = createDeferred<Array<Row>>()
      const requestStarted = createDeferred<void>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([server])
        .mockImplementationOnce(() => {
          requestStarted.resolve()
          return held.promise
        })
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const ownerA = makeCollection(`late-shared-a-${peerTiming}`)
      let ownerB =
        peerTiming === `registered`
          ? makeCollection(`late-shared-b-${peerTiming}`)
          : undefined
      cleanups.push(async () => {
        held.resolve([newer])
        await ownerA.cleanup()
        await ownerB?.cleanup()
        queryClient.clear()
      })

      await ownerA._sync.loadSubset({})
      expect(ownerA.get(server.id)?.name).toBe(server.name)
      await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
      expect(ownerA.get(server.id)?.name).toBe(`Manual`)
      expect(queryClient.getQueryData(queryKey)).toEqual([
        { id: server.id, name: `Manual` },
      ])
      expect(queryFn).toHaveBeenCalledOnce()

      ownerB ??= makeCollection(`late-shared-b-${peerTiming}`)
      const load = Promise.resolve(ownerB._sync.loadSubset({}))
      void load.catch(() => undefined)
      const first = await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ])
      expect(first).toBe(`request-started`)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(ownerB.has(server.id)).toBe(false)
      held.resolve([newer])
      await load
      expect(ownerB.get(server.id)?.name).toBe(newer.name)
      expect(ownerA.get(server.id)?.name).toBe(newer.name)
    },
  )

  /**
   * Query Core may assign a Collection key the physical Query created for a
   * different stored key when a custom hash aliases them. The cache is the
   * source of that Query's rows; a direct write to a different row cannot
   * evict the foreign stored key or turn its old row into a fresh fetch. The
   * reference keeps the ownerless direct y across subset release and keeps
   * the foreign physical Query. Its cached x has not been verified by a
   * physical fetch for this Collection, so disabled reacquisition waits until
   * an explicit refetch returns the server row. This distinguishes retaining
   * the cache entry from incorrectly treating it as fresh authority.
   */
  it(`retains a foreign stored key under a custom Query hash after a direct write`, async () => {
    type Row = { id: string; name: string }
    const foreignKey = [`foreign-stored-key`]
    const baseKey = [`collection-stored-key`]
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: () => `shared-hash`,
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
        },
      },
    })
    queryClient.setQueryData(foreignKey, [{ id: `x`, name: `Cached` }])
    const physicalQuery = queryClient.getQueryCache().getAll()[0]!
    const queryFn = vi.fn(() => Promise.resolve([{ id: `x`, name: `Server` }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id: `foreign-stored-key-collection`,
        queryClient,
        queryKey: () => baseKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        enabled: false,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    expect(collection.get(`x`)?.name).toBe(`Cached`)
    await collection.utils.writeInsert({ id: `y`, name: `Manual` })
    collection._sync.unloadSubset({})
    const reacquisition = Promise.resolve(collection._sync.loadSubset({}))
    let settled = false
    void reacquisition.then(() => (settled = true))
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(collection.get(`y`)?.name).toBe(`Manual`)
    expect(queryClient.getQueryCache().getAll()).toContain(physicalQuery)
    expect(physicalQuery.queryKey).toEqual(foreignKey)
    expect(queryFn).not.toHaveBeenCalled()
    await collection.utils.refetch({ throwOnError: true })
    await reacquisition
    expect(collection.get(`x`)?.name).toBe(`Server`)
    expect(collection.has(`y`)).toBe(false)
    expect(queryFn).toHaveBeenCalledOnce()
  })

  /**
   * A reset may reuse a Query's numeric data-update count. The independent
   * authority rule distinguishes the physical provider result from A's local
   * cache patch: B must ignore the patch while waiting, then apply the new
   * provider row even when reset gives it the patch's old count. The driver
   * observes B's pending load before the result and its settlement afterward.
   */
  it.each([`new-response`, `same-reference`] as const)(
    `settles a shared Query acquisition after reset reuses a cache edit version: %s`,
    async (responseIdentity) => {
      type Row = { id: string; name: string }
      const queryKey = [`shared-reset-cache-version`]
      const queryClient = createQueryClient()
      const replacement = createDeferred<Array<Row>>()
      const abandoned = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Initial` }])
        .mockImplementationOnce(() => abandoned.promise)
        .mockImplementationOnce(() => replacement.promise)
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`shared-reset-a`)
      const b = makeCollection(`shared-reset-b`)
      cleanups.push(async () => {
        abandoned.resolve([])
        replacement.resolve([])
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await a._sync.loadSubset({})
      await a.utils.writeUpdate({ id: `x`, name: `Manual` })
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })!
      const editedCacheData = query.state.data as Array<Row>
      expect(query.state.dataUpdateCount).toBe(1)
      const acquisition = Promise.resolve(b._sync.loadSubset({}))
      void acquisition.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      expect(b.has(`x`)).toBe(false)

      const reset = queryClient.resetQueries({ queryKey, exact: true })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
      const expected =
        responseIdentity === `same-reference`
          ? editedCacheData
          : [{ id: `x`, name: `After reset` }]
      replacement.resolve(expected)
      await reset
      await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(expected[0]?.name))
      await acquisition
      expect(query.state.dataUpdateCount).toBe(1)
    },
  )

  /**
   * Query Core notifies observers before its cache success listener. A direct
   * write made by a foreign observer in that gap is still a local cache edit,
   * not part of the successful provider response. The independent account
   * gives A the direct value and leaves B without a confirmed row until a
   * third physical request settles. The held B request distinguishes fetched
   * response identity from the mutable Query state seen by the cache listener.
   */
  it(`does not certify a reentrant direct cache edit as a fetched result`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`reentrant-success-direct-edit`]
    const server = { id: `x`, name: `Server` }
    const older = { id: `x`, name: `Older` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockResolvedValueOnce([older])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`reentrant-success-a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      notifyOnChangeProps: `all`,
    })
    let directWrite: Promise<unknown> | undefined
    const unsubscribe = outside.subscribe((result) => {
      if (
        result.isSuccess &&
        !result.isFetching &&
        result.data?.[0]?.name === older.name &&
        !directWrite
      ) {
        directWrite = Promise.resolve(
          a.utils.writeUpdate({ id: server.id, name: `Manual` }),
        )
      }
    })
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribe()
      await a.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await a._sync.loadSubset({})
    await a.utils.refetch({ throwOnError: true })
    await directWrite
    expect(a.get(server.id)?.name).toBe(`Manual`)
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    peer.collection = makeCollection(`reentrant-success-b`)
    const load = Promise.resolve(peer.collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(peer.collection.has(server.id)).toBe(false)
    held.resolve([newer])
    await load
    expect(peer.collection.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * A directly selected response property has the same provenance rule as a
   * raw array. A's direct edit can patch its Query envelope, but a later B
   * cannot treat that envelope as a server fetch. The reference gives B no
   * row until the held replacement response, then gives it the server row.
   * This distinguishes the rule from a patch marker set only for raw arrays.
   */
  it(`withholds a directly selected cache edit from a later Collection`, async () => {
    type Row = { id: string; name: string }
    type Response = { items: Array<Row> }
    const queryClient = createQueryClient()
    const queryKey = [`late-shared-wrapped-direct-edit`]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Response>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ items: [server] })
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey,
          queryFn,
          select: (response: Response) => response.items,
          getKey: (row: Row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const ownerA = makeCollection(`late-wrapped-a`)
    const peer: { collection?: ReturnType<typeof makeCollection> } = {}
    cleanups.push(async () => {
      held.resolve({ items: [newer] })
      await ownerA.cleanup()
      await peer.collection?.cleanup()
      queryClient.clear()
    })

    await ownerA._sync.loadSubset({})
    await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: [{ id: server.id, name: `Manual` }],
    })
    peer.collection = makeCollection(`late-wrapped-b`)
    const ownerB = peer.collection
    const load = Promise.resolve(ownerB._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(ownerB.has(server.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(2)
    held.resolve({ items: [newer] })
    await load
    expect(ownerB.get(server.id)?.name).toBe(newer.name)
    expect(ownerA.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * The late peer must withhold A's local cache edit while its replacement
   * fetch runs. If that fetch fails, it still reports the new Query error:
   * withholding an old success cannot suppress a terminal failure. The
   * independent reference has no B-owned row and one failed B request, so the
   * public checkpoint is B's error state and absence of A's direct value.
   * The successful sibling above distinguishes this from withholding every
   * result. Registration on either side of the write is a legal history.
   */
  it.each([`registered`, `later-created`] as const)(
    `reports a failed fetch while withholding another Collection's cached edit: %s`,
    async (peerTiming) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`late-shared-direct-error-${peerTiming}`]
      const failure = new Error(`replacement failed`)
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
        .mockRejectedValueOnce(failure)
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const ownerA = makeCollection(`late-error-a-${peerTiming}`)
      let ownerB =
        peerTiming === `registered`
          ? makeCollection(`late-error-b-${peerTiming}`)
          : undefined
      cleanups.push(async () => {
        await ownerA.cleanup()
        await ownerB?.cleanup()
        queryClient.clear()
      })

      await ownerA._sync.loadSubset({})
      await ownerA.utils.writeUpdate({ id: `x`, name: `Manual` })
      ownerB ??= makeCollection(`late-error-b-${peerTiming}`)
      await expect(ownerB._sync.loadSubset({})).rejects.toBe(failure)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(ownerB.has(`x`)).toBe(false)
      expect(reportedError(ownerB)).toBe(failure)
      expect(reportedError(ownerB)).toBeDefined()
      expect(ownerA.get(`x`)?.name).toBe(`Manual`)
    },
  )

  /**
   * A shared request started before A's local write remains a server result
   * for B. A's later accepted value wins only in A. The reference keeps two
   * Collection row sets over the one provider response. B releases and
   * reacquires its subset while the fetch is held. After settlement, B sees
   * the provider row and A sees its direct write. This tests the result-merge
   * and remount paths as well as the immediate cache patch path above.
   */
  it(`keeps an older shared fetch from carrying A's direct write into B`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-older-fetch-isolation`]
    const older = createDeferred<Array<Row>>()
    const server = { id: `x`, name: `Server` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => older.promise)
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const ownerA = makeCollection(`shared-older-fetch-a`)
    const ownerB = makeCollection(`shared-older-fetch-b`)
    cleanups.push(async () => {
      older.resolve([server])
      await ownerA.cleanup()
      await ownerB.cleanup()
      queryClient.clear()
    })

    await Promise.all([
      ownerA._sync.loadSubset({}),
      ownerB._sync.loadSubset({}),
    ])
    const refresh = ownerA.utils.refetch({ throwOnError: true })
    void refresh.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await ownerA.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(ownerB.get(server.id)?.name).toBe(`Server`)
    ownerB._sync.unloadSubset({})
    expect(ownerB.has(server.id)).toBe(false)
    const reacquire = Promise.resolve(ownerB._sync.loadSubset({}))
    void reacquire.catch(() => undefined)
    older.resolve([{ id: server.id, name: `Older` }])
    await Promise.all([refresh, reacquire])
    expect(ownerA.get(server.id)?.name).toBe(`Manual`)
    expect(ownerB.get(server.id)?.name).toBe(`Older`)
  })

  /**
   * An explicit refetch after a direct write needs a post-write provider
   * request, even if another Collection started the shared empty-cache fetch.
   * The independent reference orders provider starts and accepted writes; the
   * physical Query's initiating Collection does not change that order. The
   * two legal start orders distinguish a local fetch clock from a shared one.
   * At refetch settlement, observe request count and A's public row.
   */
  it.each([`A-first`, `B-first`] as const)(
    `starts a post-write refetch of a shared empty-cache Query ($startOrder)`,
    async (startOrder) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-empty-cache-post-write-${startOrder}`]
      const first = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce([])
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
        )
      const a = makeCollection(`shared-refetch-a-${startOrder}`)
      const b = makeCollection(`shared-refetch-b-${startOrder}`)
      cleanups.push(async () => {
        first.resolve([])
        await Promise.all([a.cleanup(), b.cleanup()])
        queryClient.clear()
      })
      const initial = startOrder === `A-first` ? a : b
      const second = startOrder === `A-first` ? b : a
      const firstLoad = Promise.resolve(initial._sync.loadSubset({}))
      void firstLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      const secondLoad = Promise.resolve(second._sync.loadSubset({}))
      void secondLoad.catch(() => undefined)
      await a.utils.writeInsert({ id: `x`, name: `Written` })
      await a.utils.writeDelete(`x`)
      const refetch = a.utils.refetch({ throwOnError: true })
      void refetch.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      first.resolve([{ id: `x`, name: `Stale` }])
      await refetch
      expect(a.has(`x`)).toBe(false)
      await Promise.allSettled([firstLoad, secondLoad])
    },
  )

  /**
   * The neighboring order is different: a shared empty-cache request begun
   * after A's direct write is already post-write authority. A's explicit
   * refetch may join it. The independent request-order reference predicts one
   * provider call and both Collections receiving that result at settlement.
   * This rejects a blanket rule that cancels every shared in-flight request.
   */
  it(`reuses a shared empty-cache request started after the direct write`, async () => {
    type Row = { id: string; name: string }
    const queryClient = createQueryClient()
    const queryKey = [`shared-newer-empty-cache-request`]
    const response = createDeferred<Array<Row>>()
    const server = { id: `x`, name: `Server` }
    const queryFn = vi.fn(() => response.promise)
    const makeCollection = (id: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          startSync: true,
        }),
      )
    const a = makeCollection(`shared-newer-a`)
    const b = makeCollection(`shared-newer-b`)
    cleanups.push(async () => {
      response.resolve([server])
      await Promise.all([a.cleanup(), b.cleanup()])
      queryClient.clear()
    })
    await a.utils.writeInsert({ id: `x`, name: `Written` })
    const bLoad = Promise.resolve(b._sync.loadSubset({}))
    void bLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const aLoad = Promise.resolve(a._sync.loadSubset({}))
    void aLoad.catch(() => undefined)
    const refetch = a.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    expect(queryFn).toHaveBeenCalledOnce()
    response.resolve([server])
    await Promise.all([aLoad, bLoad, refetch])
    expect(queryFn).toHaveBeenCalledOnce()
    expect(a.get(`x`)?.name).toBe(`Server`)
    expect(b.get(`x`)?.name).toBe(`Server`)
  })

  /**
   * A's sync restart cannot move an already-running physical Query request
   * past its earlier direct write. The reference order is B's request start,
   * A's accepted insert/delete, A's sync restart, then A's explicit refetch.
   * A post-write request must start and settle without reviving x. This is
   * the same request-order law as the two-Collection histories above, with
   * one added sync-run boundary.
   */
  it.each([false, true] as const)(
    `keeps a shared pre-write fetch older across Collection sync restart with explicit refetch=%s`,
    async (explicitRefetch) => {
      type Row = { id: string; name: string }
      const queryClient = createQueryClient()
      const queryKey = [`shared-fetch-across-sync-restart`, explicitRefetch]
      const first = createDeferred<Array<Row>>()
      const queryFn = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue([])
      const makeCollection = (id: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
        )
      const a = makeCollection(`shared-fetch-restart-a`)
      const b = makeCollection(`shared-fetch-restart-b`)
      cleanups.push(async () => {
        first.resolve([])
        await Promise.all([a.cleanup(), b.cleanup()])
        queryClient.clear()
      })
      const bLoad = Promise.resolve(b._sync.loadSubset({}))
      void bLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      await a.utils.writeInsert({ id: `x`, name: `Written` })
      await a.utils.writeDelete(`x`)
      await a.cleanup()
      const subscription = a.subscribeChanges(() => {})
      cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
      const aLoad = Promise.resolve(a._sync.loadSubset({}))
      void aLoad.catch(() => undefined)
      const refetch = explicitRefetch
        ? a.utils.refetch({ throwOnError: true })
        : undefined
      void refetch?.catch(() => undefined)
      if (explicitRefetch)
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      first.resolve([{ id: `x`, name: `Stale` }])
      await refetch
      await aLoad
      expect(a.has(`x`)).toBe(false)
      await Promise.allSettled([aLoad, bLoad])
    },
  )

  /**
   * Cleanup ends one sync run and discards its memory-only direct rows. A
   * direct-row position from that run cannot veto a valid cached Query row
   * when the same Collection starts a new run. The independent reference has
   * one server row, one optional accepted direct row, and a run boundary that
   * removes the direct row. B retains the physical Query throughout.
   *
   * Both histories insert directly; one explicitly deletes before cleanup.
   * The real QueryClient and public Collection are checked after restart and
   * cached acquisition. One provider call proves the cached path was used.
   */
  it.each([false, true] as const)(
    `does not carry an old direct-row position into a restarted sync run, deleted=%s`,
    async (deleteBeforeCleanup) => {
      type Row = { id: string; name: string }
      const id = `direct-position-restart-${deleteBeforeCleanup}`
      const queryClient = createQueryClient()
      const queryKey = [id]
      const server = { id: `x`, name: `Server` }
      const queryFn = vi.fn(() => Promise.resolve([server]))
      const makeCollection = (name: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: name,
            queryClient,
            queryKey,
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`${id}-a`)
      const b = makeCollection(`${id}-b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })
      await b._sync.loadSubset({})
      expect(b.get(`x`)?.name).toBe(server.name)
      await a.utils.writeInsert({ id: `x`, name: `Direct` })
      expect(a.get(`x`)?.name).toBe(`Direct`)
      if (deleteBeforeCleanup) await a.utils.writeDelete(`x`)
      await a.cleanup()

      const subscription = a.subscribeChanges(() => {})
      cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
      await a._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledOnce()
      expect(a.get(`x`)?.name).toBe(server.name)
      expect(b.get(`x`)?.name).toBe(server.name)
    },
  )

  /**
   * A direct cache patch belongs to the sync run that accepted it. An outside
   * Query observer can retain that physical cache through A's cleanup, but
   * A's next run cannot treat its own old local edit as a fetched result.
   * The independent reference discards A's memory-only row at cleanup and
   * waits for a new server response. The held-request cut rejects a cache
   * provenance rule that compares Collection identity but ignores sync run.
   */
  it(`does not replay its own direct cache patch after sync restart`, async () => {
    type Row = { id: string; name: string }
    const id = `direct-cache-patch-restart`
    const queryClient = createQueryClient()
    const queryKey = [id]
    const server = { id: `x`, name: `Server` }
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([server])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      staleTime: Infinity,
    })
    const unsubscribeOutside = outside.subscribe(() => {})
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribeOutside()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: server.id, name: `Manual` })
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    await collection.cleanup()
    expect(queryClient.getQueryData(queryKey)).toEqual([
      { id: server.id, name: `Manual` },
    ])
    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(collection.has(server.id)).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(2)
    held.resolve([newer])
    await load
    expect(collection.get(server.id)?.name).toBe(newer.name)
  })

  /**
   * A fresh Collection instance is a separate receiving boundary for the
   * same authority law. The persisted direct row was accepted before B's
   * physical fetch, and B keeps that exact Query alive while A restarts.
   * The reference order makes the server row authoritative at A's next load.
   * A restart may issue another request if it cannot recover that order from
   * storage; it may not silently keep the older direct value at settlement.
   */
  it.each([false, true] as const)(
    `adopts a newer shared server result after persisted Collection restart with cache edit=%s`,
    async (cacheEdit) => {
      type Row = { id: string; name: string }
      const id = `shared-newer-after-persisted-restart-${cacheEdit}`
      const queryKey = [id]
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const persistence = createNodeSQLitePersistence({
        database: driver.getDatabase(),
      })
      const managed = persistence.resolvePersistenceForCollection!({
        collectionId: id,
        mode: `sync-present`,
      })
      const queryClient = createQueryClient()
      const server = { id: `x`, name: `Server` }
      let aRequests = 0
      const aQueryFn = vi.fn(() =>
        Promise.resolve(++aRequests === 1 ? [] : [server]),
      )
      const bQueryFn = vi.fn(() => Promise.resolve([server]))
      const makeA = () =>
        createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row, string | number, Row, unknown>
          >({
            ...queryCollectionOptions<Row>({
              id,
              queryClient,
              queryKey,
              queryFn: aQueryFn,
              getKey: (row) => row.id,
              syncMode: `on-demand`,
              staleTime: Infinity,
              startSync: true,
            }),
            persistence: managed,
          }),
        )
      const firstA = makeA()
      const b = createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-b`,
          queryClient,
          queryKey,
          queryFn: bQueryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
      const restart: { collection?: ReturnType<typeof makeA> } = {}
      cleanups.push(async () => {
        await restart.collection?.cleanup()
        await firstA.cleanup()
        await b.cleanup()
        queryClient.clear()
        driver.close()
      })
      await firstA._sync.loadSubset({})
      firstA._sync.unloadSubset({})
      const callsBeforeWrite =
        aQueryFn.mock.calls.length + bQueryFn.mock.calls.length
      await firstA.utils.writeInsert({ id: `x`, name: `Direct` })
      expect(firstA.get(`x`)?.name).toBe(`Direct`)
      expect(aQueryFn.mock.calls.length + bQueryFn.mock.calls.length).toBe(
        callsBeforeWrite,
      )
      await b._sync.loadSubset({})
      await b.utils.refetch({ throwOnError: true })
      expect(b.get(`x`)?.name).toBe(`Server`)
      if (cacheEdit)
        queryClient.setQueryData(queryKey, [
          { id: `x`, name: `Local cache edit` },
        ])
      await firstA.cleanup()

      restart.collection = makeA()
      const callsBeforeRestartLoad =
        aQueryFn.mock.calls.length + bQueryFn.mock.calls.length
      await restart.collection._sync.loadSubset({})
      expect(aQueryFn.mock.calls.length + bQueryFn.mock.calls.length).toBe(
        callsBeforeRestartLoad + 1,
      )
      expect(restart.collection.get(`x`)?.name).toBe(`Server`)
    },
  )

  /**
   * A fresh persisted Collection can meet a Query cache entry fetched before
   * its accepted direct write. The shared physical Query stays unchanged
   * while B owns it: letting A patch that cache would publish A's local row
   * into B. A's SQLite row nevertheless survives cleanup. Its owner may be
   * absent (direct insert before A acquired the subset) or retained (direct
   * update after A acquired it); neither makes the old cache a new fetch.
   *
   * The independent reference orders B's server result, A's accepted write,
   * A's cleanup, and A's next acquisition. The retained cache cannot order
   * its row against the durable write, so acquisition must request a new
   * result; that result may replace the durable value. The driver uses a real QueryClient
   * shared by both Collections and a managed SQLite cache. It checks A and B,
   * the unchanged Query cache, durable storage after cleanup, request count,
   * and A's public row when the new acquisition settles. The two histories
   * distinguish the ownerless-row ambiguity guard from an owned direct
   * update whose cached Query is equally old.
   */
  it.each([`ownerless-insert`, `owned-update`] as const)(
    `keeps a persisted %s direct row ahead of an older shared Query after restart`,
    async (rowLifetime) => {
      type Row = { id: string; name: string }
      const id = `persisted-old-shared-cache-${rowLifetime}`
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const persistence = createNodeSQLitePersistence({
        database: driver.getDatabase(),
      })
      const managed = persistence.resolvePersistenceForCollection!({
        collectionId: id,
        mode: `sync-present`,
      })
      const queryClient = createQueryClient()
      const queryKey = [id]
      const server = { id: `x`, name: `Server` }
      const direct = { id: `x`, name: `Direct` }
      const newer = { id: `x`, name: `Newer` }
      const queryFn = vi
        .fn(() => Promise.resolve([newer]))
        .mockResolvedValueOnce([server])
      const makeA = () =>
        createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row, string | number, Row, unknown>
          >({
            ...queryCollectionOptions<Row>({
              id,
              queryClient,
              queryKey,
              queryFn,
              getKey: (row) => row.id,
              syncMode: `on-demand`,
              staleTime: Infinity,
              startSync: true,
            }),
            persistence: managed,
          }),
        )
      const a = makeA()
      const b = createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-b`,
          queryClient,
          queryKey,
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
      let restarted: ReturnType<typeof makeA> | undefined
      try {
        await b._sync.loadSubset({})
        if (rowLifetime === `owned-update`) await a._sync.loadSubset({})
        else await vi.waitFor(() => expect(a.status).toBe(`ready`))
        expect(a.get(`x`)?.name).toBe(
          rowLifetime === `owned-update` ? server.name : undefined,
        )
        if (rowLifetime === `owned-update`) await a.utils.writeUpdate(direct)
        else await a.utils.writeInsert(direct)
        expect(a.get(`x`)?.name).toBe(direct.name)
        expect(b.get(`x`)?.name).toBe(server.name)
        expect(queryClient.getQueryData(queryKey)).toEqual([server])
        expect(queryFn).toHaveBeenCalledOnce()

        await a.cleanup()
        const claim = await managed.adapter.claimCacheGeneration!(id)
        try {
          const durable = await managed.adapter.loadResumeSnapshot({
            kind: `managed`,
            storageCollectionId: claim.storageCollectionId,
            claimId: claim.claimId,
          })
          expect(durable.rows.find((row) => row.key === `x`)?.value).toEqual(
            direct,
          )
        } finally {
          await managed.adapter.releaseCacheGenerationClaim!(claim.claimId)
        }

        restarted = makeA()
        const callsBeforeAcquisition = queryFn.mock.calls.length
        await restarted._sync.loadSubset({})
        const newRequests = queryFn.mock.calls.length - callsBeforeAcquisition
        expect(newRequests).toBe(1)
        expect(restarted.get(`x`)?.name).toBe(newer.name)
      } finally {
        await restarted?.cleanup()
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
        driver.close()
      }
    },
  )

  /**
   * A direct write is an accepted Collection row, not completion of an
   * unfinished Query request. With a held first fetch, the independent Query
   * state still has no fetched data after the write. The public Collection
   * has the accepted row; Query Core must not treat that row as a successful
   * response to ensureQueryData before the provider answers.
   */
  it(`does not turn a pending eager Query into cached fetched data`, async () => {
    const id = `pending-query-direct-write`
    const first = createDeferred<Array<Item>>()
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [first.promise],
    })
    cleanups.push(() => {
      first.resolve([])
      return Promise.resolve()
    })
    const preload = collection.preload()
    void preload.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.state.status).toBe(`pending`)
    await collection.utils.writeInsert(shared)
    expect(collection.has(shared.id)).toBe(true)
    expect(query.state.data).toBeUndefined()
    expect(query.state.status).toBe(`pending`)
    first.resolve([])
    await preload
  })

  /**
   * Disabling the eager Query leaves a valid pending, idle cache entry. The
   * existing eager cache-seeding contract applies without an in-flight
   * request: the accepted row enters the raw-row cache. Query must then be
   * coherent for consumers, while its untouched timestamp still says that
   * no provider fetch has established freshness. This distinguishes the
   * legal idle seed from an unfinished request, which cannot be completed by
   * a direct write. Collection readiness still waits for a provider result.
   */
  it(`seeds an idle pending eager Query coherently without marking it fresh`, async () => {
    type Row = { id: string; name: string }
    const id = `pending-idle-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Row>))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `eager`,
        enabled: false,
        staleTime: 1_000,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.state.status).toBe(`pending`)
    expect(query.state.fetchStatus).toBe(`idle`)
    await collection.utils.writeInsert({ id: `x`, name: `Manual` })
    expect(collection.get(`x`)?.name).toBe(`Manual`)
    expect(query.state.status).toBe(`success`)
    expect(query.state.data).toEqual([{ id: `x`, name: `Manual` }])
    expect(query.state.dataUpdatedAt).toBe(0)
    expect(query.isStaleByTime(1_000)).toBe(true)
    expect(queryFn).not.toHaveBeenCalled()
    expect(collection.status).toBe(`loading`)
  })

  /**
   * A direct write may leave a derived response envelope stale, but a later
   * subset load cannot resolve successfully with no rows when both its cache
   * and provider contain one. The history loads one row, writes it, retires
   * its only subset lease, then reacquires the same Query. The independent
   * response model has one row at load settlement; the Collection must too.
   */
  it(`restores a derived selected subset from its cached result after reacquisition`, async () => {
    const id = `derived-select-reacquisition`
    const before = { id: `x`, name: `Before` }
    const response = { edges: [{ node: before }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) =>
          value.edges.map((edge) => edge.node),
        getKey: (row: typeof before) => row.id,
        syncMode: `on-demand`,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: before.id, name: `After` })
    collection._sync.unloadSubset({})
    expect(collection.has(before.id)).toBe(false)
    await collection._sync.loadSubset({})
    expect(collection.has(before.id)).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * Restarted eager sync has the same readiness obligation as a reacquired
   * subset. A derived cache envelope may remain untouched by a direct write,
   * but a new sync session must establish its source rows before reporting
   * ready. The provider returns one row and no post-write refetch is caused by
   * the write itself; restart may fetch to regain result authority.
   */
  it(`restores a derived selected eager result after sync restart`, async () => {
    const id = `derived-select-eager-restart`
    const row = { id: `x`, name: `Server` }
    const response = { edges: [{ node: row }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) =>
          value.edges.map((edge) => edge.node),
        getKey: (value: typeof row) => value.id,
        syncMode: `eager`,
        staleTime: Infinity,
        gcTime: Infinity,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    await collection.preload()
    await collection.utils.writeUpdate({ id: row.id, name: `Manual` })
    expect(queryFn).toHaveBeenCalledTimes(1)
    await collection.cleanup()
    const subscription = collection.subscribeChanges(() => {})
    cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    await collection.stateWhenReady()
    expect(collection.has(row.id)).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A fetched source snapshot still owns every row it returned when a direct
   * write lands during its request. The reference overlays the accepted write
   * on that snapshot. A derived `select` has no inverse into the cached
   * envelope, so this checks public rows and initial readiness after the held
   * fetch settles without requiring a rewritten Query cache response.
   */
  it.each([`eager`, `on-demand`] as const)(
    `applies a derived selected %s fetch that began before a direct write`,
    async (syncMode) => {
      type Row = { id: string; name: string }
      const id = `derived-select-older-fetch-${syncMode}`
      const fetched = { edges: [{ node: { id: `server`, name: `Fetched` } }] }
      const gate = createDeferred<typeof fetched>()
      const queryClient = createQueryClient()
      const queryFn = vi.fn(() => gate.promise)
      const collection = createCollection(
        queryCollectionOptions({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          select: (response: typeof fetched) =>
            response.edges.map((edge) => edge.node),
          getKey: (row: Row) => row.id,
          syncMode,
          startSync: true,
        }),
      )
      cleanups.push(async () => {
        gate.resolve(fetched)
        await collection.cleanup()
        queryClient.clear()
      })

      const ready =
        syncMode === `eager`
          ? collection.preload()
          : Promise.resolve(collection._sync.loadSubset({}))
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
      await collection.utils.writeInsert({ id: `manual`, name: `Written` })
      gate.resolve(fetched)
      await vi.waitFor(() =>
        expect(collection.get(`server`)?.name).toBe(`Fetched`),
      )
      await ready
      expect(
        Object.fromEntries(
          Array.from(collection.values(), (row) => [row.id, row.name]),
        ),
      ).toEqual({ server: `Fetched`, manual: `Written` })
      expect(queryFn).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * A deferred refresh barrier prevents a fetched row from becoming public
   * while an optimistic mutation persists. A direct write to another key
   * cannot bypass that boundary merely because a derived select has no cache
   * inverse. The authored response adds a new server row; the independent
   * public snapshot contains only the direct-written row until release.
   */
  it(`holds a derived selected older result behind the refresh barrier`, async () => {
    const id = `derived-select-held-refresh`
    const initial = { id: `x`, name: `Before` }
    const server = { id: `y`, name: `Server` }
    const response = (rows: Array<typeof initial>) => ({
      edges: rows.map((node) => ({ node })),
    })
    const held = createDeferred<ReturnType<typeof response>>()
    const barrier = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce(response([initial]))
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(response([server]))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: ReturnType<typeof response>) =>
          value.edges.map((edge) => edge.node),
        getKey: (row: typeof initial) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      held.resolve(response([server]))
      collection.deferDataRefresh = null
      barrier.resolve()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.preload()
    collection.deferDataRefresh = barrier.promise
    const refetch = collection.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await collection.utils.writeUpdate({ id: initial.id, name: `Manual` })
    held.resolve(response([{ ...initial, name: `Older` }, server]))
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    await vi.waitFor(() => expect(query.state.fetchStatus).toBe(`idle`))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(collection.get(initial.id)?.name).toBe(`Manual`)
    expect(collection.has(server.id)).toBe(false)
    collection.deferDataRefresh = null
    barrier.resolve()
    await refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(collection.has(server.id)).toBe(true))
  })

  /**
   * A silent cancellation that replaces a Query fetch lets public Collection
   * refetch callers follow the successor, as Query Core does for its own
   * `cancelRefetch` path. The reference is the successor's applied row at
   * both public refetch settlements. A raw QueryClient `fetchQuery` waiter
   * holds the retryer promise instead and may receive `CancelledError`; that
   * is Query Core's separate boundary. Holding the first fetch distinguishes
   * a synchronous replacement from a cancellation awaited before replacement.
   */
  it(`settles overlapping explicit refetch callers on the replacement`, async () => {
    type Row = { id: string; name: string }
    const id = `overlapping-post-write-refetch`
    const first = createDeferred<Array<Row>>()
    const replacement = createDeferred<Array<Row>>()
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Initial` }])
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(() => replacement.promise)
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      first.resolve([{ id: `x`, name: `Old` }])
      replacement.resolve([{ id: `x`, name: `Server` }])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.preload()
    let earlierOutcome = `pending`
    const earlier = collection.utils.refetch({ throwOnError: true }).then(
      () => {
        earlierOutcome = `resolved`
        return { outcome: earlierOutcome, row: collection.get(`x`)?.name }
      },
      (error) => {
        earlierOutcome = isCancelledError(error) ? `cancelled` : `rejected`
        return { outcome: earlierOutcome, row: collection.get(`x`)?.name }
      },
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    let externalOutcome = `pending`
    const external = queryClient
      .fetchQuery({ queryKey: [id], queryFn, staleTime: 0 })
      .then(
        (rows) => {
          externalOutcome = `resolved`
          return { outcome: externalOutcome, row: rows[0]?.name }
        },
        (error) => {
          externalOutcome = isCancelledError(error) ? `cancelled` : `rejected`
          return { outcome: externalOutcome, row: undefined }
        },
      )
    await collection.utils.writeUpdate({ id: `x`, name: `Written` })
    const later = collection.utils.refetch({ throwOnError: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    expect(earlierOutcome).toBe(`pending`)
    expect(externalOutcome).toBe(`pending`)
    replacement.resolve([{ id: `x`, name: `Server` }])
    await later
    expect(await earlier).toEqual({ outcome: `resolved`, row: `Server` })
    expect(await external).toEqual({ outcome: `cancelled`, row: undefined })
    expect(collection.get(`x`)?.name).toBe(`Server`)
  })

  /**
   * A derived selected response has no safe inverse for a direct cache edit.
   * Its old cached envelope may remain, but remounting a live query without
   * a new provider result must not replay that envelope over an accepted
   * direct write. The independent reference keeps the accepted row until a
   * later fetch; this history observes both the public row and request count
   * after the live-query subscriber returns.
   */
  it(`does not replay an unpatchable eager cache response on resubscribe`, async () => {
    type Row = { id: string; name: string }
    const id = `derived-eager-resubscribe`
    const response = { data: [{ id: `x`, name: `before` }] }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(response)))
    const collection = createCollection(
      queryCollectionOptions({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        select: (value: typeof response) => value.data.filter(Boolean),
        getKey: (row: Row) => row.id,
        syncMode: `eager`,
        startSync: true,
      }),
    )
    const createLive = () =>
      createLiveQueryCollection({
        query: (query) => query.from({ row: collection }),
      })
    const first = createLive()
    const liveQueries = [first]
    cleanups.push(async () => {
      await Promise.all(liveQueries.map((query) => query.cleanup()))
      await collection.cleanup()
      queryClient.clear()
    })

    await first.preload()
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    expect(queryClient.getQueryData<typeof response>([id])).toEqual(response)
    await first.cleanup()
    const second = createLive()
    liveQueries.push(second)
    await second.preload()
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * An outside Query observer may retain an inactive A cache with an older
   * row. The Collection row is independently held by active subset B. A
   * direct update changes that public row; remounting A and then releasing B
   * must not restore the old value. The retained cache is allowed to stay
   * stale, so this checks the ownership boundary rather than requiring a
   * cache patch the Collection cannot safely infer.
   */
  it(`keeps a direct row when a foreign-retained subset remounts`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `foreign-retained-subset-remount`
    const queryClient = createQueryClient()
    const initial = { id: `x`, name: `before`, category: `A` }
    const queryFn = vi.fn(() => Promise.resolve([{ ...initial }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const a = { where: eq(new IR.PropRef([`category`]), `A`) }
    const b = { where: eq(new IR.PropRef([`id`]), `x`) }
    let unsubscribe = () => {}
    cleanups.push(async () => {
      unsubscribe()
      await collection.cleanup()
      queryClient.clear()
    })
    await collection._sync.loadSubset(a)
    const aQuery = queryClient.getQueryCache().findAll({ queryKey: [id] })[0]!
    await collection._sync.loadSubset(b)
    const foreign = new QueryObserver(queryClient, {
      queryKey: aQuery.queryKey,
      queryFn,
      staleTime: Infinity,
      retry: false,
    })
    unsubscribe = foreign.subscribe(() => {})
    collection._sync.unloadSubset(a)
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    expect(
      queryClient.getQueryData<Array<Row>>(aQuery.queryKey)?.[0]?.name,
    ).toBe(`before`)
    await collection._sync.loadSubset(a)
    collection._sync.unloadSubset(b)
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A Query observer can retain a listener after its last subset lease ends.
   * The independent row rule is that an accepted direct update wins until a
   * newer provider result arrives. Keep that observer alive, update the row,
   * then reacquire the subset without a new request. Both its cached and
   * public row must reflect the write at that checkpoint.
   */
  it(`patches a zero-lease observer retained by a listener`, async () => {
    type Row = { id: string; name: string }
    const id = `listener-retained-direct-write`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([{ id: `x`, name: `before` }]))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        staleTime: Number.POSITIVE_INFINITY,
      }),
    )
    let releaseListener = () => {}
    cleanups.push(async () => {
      releaseListener()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    const observer = query.observers[0]!
    releaseListener = observer.subscribe(() => {})
    collection._sync.unloadSubset({})
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    expect(query.state.data).toEqual([{ id: `x`, name: `after` }])
    await collection._sync.loadSubset({})
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * A fetched result may have reached the Query cache while its persisted
   * baseline scan still holds Collection application. Its new row has no
   * committed owner yet. A direct write to that row must patch the provisional
   * cache entry before any later cache replay; the independent reference
   * overlays the accepted write on the fetched row at this held checkpoint.
   */
  it(`patches a provisional cached row while its result application waits`, async () => {
    const id = `pending-result-cache-patch`
    const queryHash = hashKey([id])
    const before = { ...shared, name: `Before` }
    const provisional = { id: `new`, category: `shared`, name: `Older` }
    const manual = { ...provisional, name: `Manual` }
    const scan =
      createDeferred<
        Array<{ key: string | number; value: Item; metadata?: unknown }>
      >()
    const scanPersistedRows = vi.fn(() => scan.promise)
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      results: [[before], [provisional]],
      scanPersistedRows,
    })
    cleanups.push(() => {
      scan.resolve([])
      return Promise.resolve()
    })
    await collection._sync.loadSubset({})
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    const foreign = new QueryObserver(queryClient, {
      queryKey: [id],
      queryFn,
      staleTime: Infinity,
    })
    const release = foreign.subscribe(() => {})
    cleanups.push(() => Promise.resolve(release()))
    collection._sync.unloadSubset({})
    await collection.utils.writeDelete(before.id)
    collection._state.syncedCollectionMetadata.set(
      `queryCollection:gc:${queryHash}`,
      {
        queryHash,
        mode: `until-revalidated`,
      },
    )
    const load = Promise.resolve(collection._sync.loadSubset({ refetch: true }))
    void load.catch(() => undefined)
    await vi.waitFor(() => expect(query.state.data).toEqual([provisional]))
    expect(scanPersistedRows).toHaveBeenCalled()
    await collection.utils.writeUpsert(manual)
    expect(query.state.data).toEqual([manual])
    scan.resolve([])
    await load
    expect(collection.get(manual.id)?.name).toBe(`Manual`)
  })

  /**
   * A fetch-start position is needed only while its subset observer remains
   * live. The reference count after retiring eight distinct subset leases is
   * zero. Instrument maps receiving this fixture's unique Query hashes,
   * distinguish fetch positions by their distinct values across eight
   * requests, then compare retained entries after every subset unloads.
   */
  it(`retires fetch-start positions with their subset observers`, async () => {
    type Row = { id: string }
    const id = `fetch-start-retirement`
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve([] as Array<Row>))
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const originals = Map.prototype.set
    const stamped = new Set<Map<unknown, unknown>>()
    const setSpy = vi.spyOn(Map.prototype, `set`).mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
      value: unknown,
    ) {
      if (
        typeof key === `string` &&
        key.includes(id) &&
        typeof value === `number`
      ) {
        stamped.add(this)
      }
      return originals.call(this, key, value)
    })
    const demands = Array.from({ length: 8 }, (_, index) => ({
      where: eq(new IR.PropRef([`id`]), String(index)),
    }))
    try {
      for (const demand of demands) await collection._sync.loadSubset(demand)
    } finally {
      setSpy.mockRestore()
    }
    const fetchStarts = [...stamped].find((map) => {
      const positions = demands.map((demand) =>
        map.get(hashKey([id, getLoadSubsetDemandKey(demand)])),
      )
      return (
        positions.every((position) => typeof position === `number`) &&
        new Set(positions).size === demands.length
      )
    })
    expect(fetchStarts).toBeDefined()
    expect(
      [...fetchStarts!.keys()].filter((key) => String(key).includes(id)),
    ).toHaveLength(8)
    for (const demand of demands) collection._sync.unloadSubset(demand)
    expect(
      [...fetchStarts!.keys()].filter((key) => String(key).includes(id)),
    ).toHaveLength(0)
  })

  /**
   * Persisted retention may keep an unfinished Query after its final observer
   * lease ends. Its fetch-start position must survive that interval so a later
   * lease can compare the request with a direct write. Once the detached fetch
   * settles or its Query leaves the cache, no request can reuse that position.
   * The reference holds one position at unload and zero at either terminal
   * checkpoint. The driver records the same map as the retirement witness.
   */
  it.each([`settlement`, `cache removal`] as const)(
    `retires a persisted Query's fetch-start position after detached %s`,
    async (ending) => {
      const id = `retained-fetch-start-retirement`
      const queryHash = hashKey([id])
      const pending = createDeferred<Array<Item>>()
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        results: [pending.promise],
        persistedGcTime: Number.POSITIVE_INFINITY,
        scanPersistedRows: () => Promise.resolve([]),
      })
      const originalSet = Map.prototype.set
      const stamped = new Set<Map<unknown, unknown>>()
      const setSpy = vi
        .spyOn(Map.prototype, `set`)
        .mockImplementation(function (
          this: Map<unknown, unknown>,
          key: unknown,
          value: unknown,
        ) {
          if (key === queryHash && typeof value === `number`) stamped.add(this)
          return originalSet.call(this, key, value)
        })
      const load = Promise.resolve(collection._sync.loadSubset({}))
      void load.catch(() => undefined)
      try {
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      } finally {
        setSpy.mockRestore()
      }
      const query = queryClient.getQueryCache().find({ queryKey: [id] })!
      collection._sync.unloadSubset({})
      expect(query.state.fetchStatus).toBe(`fetching`)
      const fetchStarts = [...stamped].find(
        (map) =>
          typeof map.get(queryHash) === `number` &&
          Number.isFinite(map.get(queryHash)) &&
          map.get(queryHash) !== 0,
      )
      expect(fetchStarts).toBeDefined()
      expect(fetchStarts!.has(queryHash)).toBe(true)
      if (ending === `settlement`) {
        pending.resolve([])
        await vi.waitFor(() => expect(query.state.fetchStatus).toBe(`idle`))
      } else {
        queryClient.removeQueries({ queryKey: [id], exact: true })
      }
      expect(fetchStarts!.has(queryHash)).toBe(false)
      pending.resolve([])
      await load.catch(() => undefined)
    },
  )

  /**
   * An explicit refetch after a direct write asks the provider for a result
   * newer than that write. The reference is request order: a request begun
   * before the write cannot discharge the later refetch, even when Query Core
   * has no cached data and would normally reuse the pending request. The
   * legal history holds the initial request, writes a row, deletes it, then
   * refetches. At settlement, the public row set must equal the second
   * provider response and the provider must have received two requests.
   */
  it(`starts a post-write request for explicit refetch during an empty-cache fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `post-write-explicit-refetch`
    const first = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => {
      if (queryFn.mock.calls.length === 1) {
        started.resolve()
        return first.promise
      }
      return Promise.resolve([] as Array<Row>)
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      first.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection.utils.writeInsert({ id: `x`, name: `local` })
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    await started.promise
    await collection.utils.writeDelete(`x`)
    const refetch = collection.utils.refetch({ throwOnError: true })
    first.resolve([{ id: `x`, name: `stale` }])
    await refetch
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.has(`x`)).toBe(false)
    await load.catch(() => undefined)
  })

  /**
   * An explicit subset refetch has the same post-write request-order promise
   * as utils.refetch. The first empty-cache request begins before a direct
   * delete; a second load with `refetch: true` must start a newer request.
   * At that load's settlement, the public row reflects the newer response.
   */
  it(`starts a post-write request for an explicit subset refetch`, async () => {
    const id = `subset-post-write-refetch`
    const first = createDeferred<Array<Item>>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [first.promise, []],
    })
    await collection.utils.writeInsert(shared)
    const initialLoad = Promise.resolve(collection._sync.loadSubset({}))
    void initialLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    await collection.utils.writeDelete(shared.id)
    const refetchLoad = Promise.resolve(
      collection._sync.loadSubset({ refetch: true }),
    )
    first.resolve([{ ...shared, name: `Stale` }])
    await refetchLoad
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.has(shared.id)).toBe(false)
    await initialLoad.catch(() => undefined)
  })

  /**
   * A deferred refresh is scheduled when a successful cached result is
   * refetching while the barrier is held. After a direct delete, releasing the
   * barrier starts a newer request. The independent request-order rule needs
   * that third provider call before the older refetch is allowed to settle.
   */
  it(`starts a post-write request when a deferred refresh barrier releases`, async () => {
    const id = `deferred-post-write-refetch`
    const older = createDeferred<Array<Item>>()
    const barrier = createDeferred<void>()
    const { collection, queryFn } = createOwnershipFixture({
      id,
      results: [[shared], older.promise, []],
    })
    const release = barrier.promise.then(() => {
      collection.deferDataRefresh = null
    })
    cleanups.push(() => {
      older.resolve([])
      barrier.resolve()
      return Promise.resolve()
    })
    await collection._sync.loadSubset({})
    collection.deferDataRefresh = barrier.promise
    const refetch = collection.utils.refetch({ throwOnError: true })
    void refetch.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await collection.utils.writeDelete(shared.id)
    barrier.resolve()
    await release
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    older.resolve([{ ...shared, name: `Stale` }])
    await refetch.catch(() => undefined)
    expect(collection.has(shared.id)).toBe(false)
  })

  /**
   * Retiring a subset can retain its persisted rows while Query Core keeps an
   * unfinished, empty-cache request. Reacquiring that subset does not make the
   * old request newer. The reference is request order: after an accepted direct
   * delete, an explicit refetch must start a post-write request, and its public
   * settlement must observe that request's rows. Without a later write, the
   * refetch may reuse the request. Hold it across unload and reacquisition in
   * both histories to distinguish this from an ordinary active fetch. This
   * controlled Query Core driver does not model a native SQLite adapter.
   */
  it.each([
    {
      name: `starts a post-write refetch after reacquiring a retained in-flight Query`,
      writeAfterStart: true,
      requestCount: 2,
    },
    {
      name: `reuses a retained in-flight Query without a later write`,
      writeAfterStart: false,
      requestCount: 1,
    },
  ])(`$name`, async ({ writeAfterStart, requestCount }) => {
    const id = `retained-post-write-refetch`
    const stale = { ...shared, name: `Stale` }
    const first = createDeferred<Array<Item>>()
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id,
      results: [first.promise, []],
      persistedGcTime: Number.POSITIVE_INFINITY,
      scanPersistedRows: () => Promise.resolve([]),
    })

    await collection.utils.writeInsert(shared)
    const initialLoad = Promise.resolve(collection._sync.loadSubset({}))
    void initialLoad.catch(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    collection._sync.unloadSubset({})
    expect(query.state.fetchStatus).toBe(`fetching`)
    expect(query.getObserversCount()).toBe(0)

    const reacquiredLoad = Promise.resolve(collection._sync.loadSubset({}))
    void reacquiredLoad.catch(() => undefined)
    expect(queryClient.getQueryCache().find({ queryKey: [id] })).toBe(query)
    expect(queryFn).toHaveBeenCalledTimes(1)
    if (writeAfterStart) await collection.utils.writeDelete(shared.id)
    const refetch = collection.utils.refetch({ throwOnError: true })
    first.resolve([stale])
    await refetch
    expect(queryFn).toHaveBeenCalledTimes(requestCount)
    if (writeAfterStart) expect(collection.has(shared.id)).toBe(false)
    await Promise.allSettled([initialLoad, reacquiredLoad])
  })

  /**
   * A Query can keep fetching after ordinary subset cleanup when an outside
   * observer still owns it. That request began before a later direct delete.
   * Reacquisition cannot promote it above the delete. The request-order model
   * keeps the deletion when the old result settles; an explicit refetch must
   * instead start a new request. Both histories observe the public row at
   * their load or refetch settlement checkpoint.
   */
  it.each([`old result`, `explicit refetch`] as const)(
    `preserves a direct delete across ordinary unload and reacquisition: %s`,
    async (ending) => {
      const id = `ordinary-unload-post-write-${ending}`
      const stale = { ...shared, name: `Stale` }
      const first = createDeferred<Array<Item>>()
      const { collection, queryClient, queryFn } = createOwnershipFixture({
        id,
        results: [first.promise, []],
      })
      await collection.utils.writeInsert(shared)
      const initialLoad = Promise.resolve(collection._sync.loadSubset({}))
      void initialLoad.catch(() => undefined)
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
      const query = queryClient.getQueryCache().find({ queryKey: [id] })!
      const foreign = new QueryObserver(queryClient, {
        queryKey: [id],
        queryFn,
        staleTime: Number.POSITIVE_INFINITY,
      })
      const unsubscribe = foreign.subscribe(() => {})
      cleanups.push(() => {
        unsubscribe()
        return Promise.resolve()
      })
      collection._sync.unloadSubset({})
      expect(query.state.fetchStatus).toBe(`fetching`)
      expect(query.getObserversCount()).toBe(1)
      await collection.utils.writeDelete(shared.id)
      const reacquiredLoad = Promise.resolve(collection._sync.loadSubset({}))
      void reacquiredLoad.catch(() => undefined)
      expect(queryClient.getQueryCache().find({ queryKey: [id] })).toBe(query)

      if (ending === `explicit refetch`) {
        const refetch = collection.utils.refetch({ throwOnError: true })
        first.resolve([stale])
        await refetch
        expect(queryFn).toHaveBeenCalledTimes(2)
      } else {
        first.resolve([stale])
      }
      await reacquiredLoad
      expect(collection.has(shared.id)).toBe(false)
      await initialLoad.catch(() => undefined)
    },
  )

  /**
   * A fetched result and accepted direct writes form a per-key ordered merge.
   * The independent reference overlays writes accepted after fetch start onto
   * fetched rows, but does not add unrelated keys to an on-demand scope. This
   * history covers a previously owned row, a held explicit refetch, a later
   * direct update, and an unrelated direct insert. The Collection rows and Query cache are compared when
   * the refetch settles; the eager sibling above covers the other sync mode.
   */
  it(`keeps a later on-demand direct update over an older refetch row`, async () => {
    type Row = { id: string; name: string }
    const id = `on-demand-older-fetch-write`
    const held = createDeferred<Array<Row>>()
    const started = createDeferred<void>()
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => {
      if (queryFn.mock.calls.length === 1)
        return Promise.resolve([{ id: `x`, name: `before` }])
      started.resolve()
      return held.promise
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      held.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    const refetch = collection.utils.refetch({ throwOnError: true })
    await started.promise
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    await collection.utils.writeInsert({ id: `y`, name: `outside scope` })
    held.resolve([{ id: `x`, name: `before` }])
    await refetch
    expect(collection.get(`x`)?.name).toBe(`after`)
    expect(collection.get(`y`)?.name).toBe(`outside scope`)
    expect(queryClient.getQueryData<Array<Row>>([id])).toEqual([
      { id: `x`, name: `after` },
    ])
  })

  /**
   * A cached row with a subset owner does not give a later local cache edit
   * server authority over an accepted direct update. The independent order
   * has four values: fetched Server, A's Manual write, a QueryClient-only
   * cache edit, then a new provider fetch. The edit is visible to B through
   * its Query observer, but A keeps Manual until the final fetch starts after
   * the write and returns Newer. This crosses the owned-row state omitted by
   * the ownerless shared-cache histories. The real QueryClient drives both
   * Collections; public rows and provider calls are checked after the edit
   * and after the optional fetch. The neighboring fetch history rejects a
   * repair that permanently shields A from server results.
   */
  it.each([
    { history: `local-cache-edit`, fetchAfterEdit: false },
    { history: `newer-provider-fetch`, fetchAfterEdit: true },
  ])(
    `keeps owned direct-row authority across $history`,
    async ({ fetchAfterEdit }) => {
      type Row = { id: string; name: string }
      const id = `owned-direct-cache-edit-${fetchAfterEdit}`
      const queryClient = createQueryClient()
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
        .mockResolvedValue([{ id: `x`, name: `Newer` }])
      const makeCollection = (suffix: string) =>
        createCollection(
          queryCollectionOptions<Row>({
            id: `${id}-${suffix}`,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            staleTime: Infinity,
            startSync: true,
          }),
        )
      const a = makeCollection(`a`)
      const b = makeCollection(`b`)
      cleanups.push(async () => {
        await a.cleanup()
        await b.cleanup()
        queryClient.clear()
      })

      await a._sync.loadSubset({})
      await b._sync.loadSubset({})
      expect(queryFn).toHaveBeenCalledOnce()
      await a.utils.writeUpdate({ id: `x`, name: `Manual` })
      expect(a.get(`x`)?.name).toBe(`Manual`)
      expect(b.get(`x`)?.name).toBe(`Server`)

      queryClient.setQueryData([id], [{ id: `x`, name: `Local edit` }])
      await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(`Local edit`))
      expect(queryFn).toHaveBeenCalledOnce()
      if (!fetchAfterEdit) {
        expect(a.get(`x`)?.name).toBe(`Manual`)
        return
      }

      await b.utils.refetch({ throwOnError: true })
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(a.get(`x`)?.name).toBe(`Newer`)
      expect(b.get(`x`)?.name).toBe(`Newer`)
    },
  )

  /**
   * Starting a newer physical fetch does not publish its answer. While that
   * request is held, a manual Query cache edit remains local and cannot
   * replace A's accepted direct row. The independent reference orders the
   * direct write, fetch start, local edit, and fetch result separately. The
   * held cut distinguishes fetch-start authority from result authority; the
   * final cut admits the actual newer server row.
   */
  it(`keeps an owned direct row through a local cache edit during a held fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `owned-direct-held-fetch-cache-edit`
    const queryClient = createQueryClient()
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const makeCollection = (suffix: string) =>
      createCollection(
        queryCollectionOptions<Row>({
          id: `${id}-${suffix}`,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          staleTime: Infinity,
          startSync: true,
        }),
      )
    const a = makeCollection(`a`)
    const b = makeCollection(`b`)
    cleanups.push(async () => {
      held.resolve([{ id: `x`, name: `Newer` }])
      await a.cleanup()
      await b.cleanup()
      queryClient.clear()
    })

    await a._sync.loadSubset({})
    await b._sync.loadSubset({})
    await a.utils.writeUpdate({ id: `x`, name: `Manual` })
    const refetch = b.utils.refetch({ throwOnError: true })
    await requestStarted.promise
    queryClient.setQueryData([id], [{ id: `x`, name: `Local edit` }])
    await vi.waitFor(() => expect(b.get(`x`)?.name).toBe(`Local edit`))
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(a.get(`x`)?.name).toBe(`Manual`)

    held.resolve([{ id: `x`, name: `Newer` }])
    await refetch
    expect(a.get(`x`)?.name).toBe(`Newer`)
    expect(b.get(`x`)?.name).toBe(`Newer`)
  })

  /**
   * A local cache edit still lacks server authority after A releases and
   * reacquires its sole subset. The direct update owned that subset, so its
   * row retires on unload; the retained Query cache then contains a manual
   * edit that cannot establish a new owned row. The independent reference
   * requires a physical result before load settlement. An outside Query
   * observer keeps the cache alive, and the held-request checkpoint rejects
   * treating the manual edit as a successful fetch.
   */
  it(`revalidates a sole owner's manually edited cache on reacquisition`, async () => {
    type Row = { id: string; name: string }
    const id = `owned-direct-manual-cache-reacquisition`
    const queryClient = createQueryClient()
    const queryKey = [id]
    const newer = { id: `x`, name: `Newer` }
    const held = createDeferred<Array<Row>>()
    const requestStarted = createDeferred<void>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `x`, name: `Server` }])
      .mockImplementationOnce(() => {
        requestStarted.resolve()
        return held.promise
      })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
    const outside = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      enabled: false,
      staleTime: Infinity,
    })
    const unsubscribeOutside = outside.subscribe(() => {})
    cleanups.push(async () => {
      held.resolve([newer])
      unsubscribeOutside()
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    await collection.utils.writeUpdate({ id: `x`, name: `Manual` })
    queryClient.setQueryData(queryKey, [{ id: `x`, name: `Local edit` }])
    expect(collection.get(`x`)?.name).toBe(`Manual`)
    collection._sync.unloadSubset({})
    expect(collection.has(`x`)).toBe(false)
    const load = Promise.resolve(collection._sync.loadSubset({}))
    void load.catch(() => undefined)
    expect(
      await Promise.race([
        load.then(
          () => `settled`,
          () => `rejected`,
        ),
        requestStarted.promise.then(() => `request-started`),
      ]),
    ).toBe(`request-started`)
    expect(collection.has(`x`)).toBe(false)
    held.resolve([newer])
    await load
    expect(collection.get(`x`)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  /**
   * A direct cache edit is a notification, not a Query result. Its independent
   * reference keeps the last fetch error and Query's invalidation/freshness
   * metadata while replacing only an already cached row. The grammar here
   * covers an error, a pending invalidation, and an expired timestamp; the checkpoints are
   * Collection utilities, Query cache state, and the accepted Collection row.
   */
  it.each(
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`error`, `invalidation`, `stale`] as const).map((cut) => ({
        syncMode,
        cut,
      })),
    ),
  )(
    `preserves Query $cut state across a $syncMode direct cache patch`,
    async ({ syncMode, cut }) => {
      type Row = { id: string; name: string }
      const id = `direct-cache-${cut}`
      const queryClient = createQueryClient(false, 1000)
      const fetchError = new Error(`fetch failed`)
      const queryFn = vi
        .fn()
        .mockResolvedValueOnce([{ id: `x`, name: `before` }])
        .mockRejectedValueOnce(fetchError)
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (row) => row.id,
          syncMode,
          startSync: true,
        }),
      )
      cleanups.push(async () => {
        await collection.cleanup()
        queryClient.clear()
      })
      if (syncMode === `eager`) await collection.preload()
      else await collection._sync.loadSubset({})
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: [id], exact: true })!
      if (cut === `error`) {
        await collection.utils.refetch()
        expect(reportedError(collection)).toBe(fetchError)
      } else {
        if (cut === `invalidation`) {
          await queryClient.invalidateQueries({
            queryKey: [id],
            exact: true,
            refetchType: `none`,
          })
          expect(query.state.isInvalidated).toBe(true)
        } else {
          query.setState({ dataUpdatedAt: Date.now() - 60_000 })
          expect(query.isStale()).toBe(true)
        }
      }
      const updatedAt = query.state.dataUpdatedAt
      await collection.utils.writeUpdate({ id: `x`, name: `after` })
      expect(collection.get(`x`)?.name).toBe(`after`)
      expect(query.state.dataUpdatedAt).toBe(updatedAt)
      if (cut === `error`) {
        expect(reportedError(collection)).toBe(fetchError)
        expect(reportedError(collection)).toBeDefined()
      } else if (cut === `invalidation`) {
        expect(query.state.isInvalidated).toBe(true)
      } else {
        expect(query.isStale()).toBe(true)
      }
    },
  )

  /**
   * A Query Core hash may coalesce equivalent subset predicates into one
   * physical Query while DB retains two logical subset demands. A response
   * from a fetch started before an accepted direct write cannot undo that
   * write's key, whichever logical demand observed the fetch. A response from
   * a later fetch may replace it. The reference is the order of the authored
   * fetches and write, independent of the Query cache's chosen first key.
   *
   * The legal history uses `id = x` and `id IN [x]`, which have equal row
   * meaning but distinct demand keys. The real QueryClient coalesces them by
   * a custom hash. The public row is compared after the write, after the held
   * older result applies, and after a post-write result applies. The provider
   * call count proves each requested fetch ran.
   */
  it(`preserves a direct write across an older aliased Query fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-fetch-write-order`
    const older = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `equivalent-subset-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue([newer])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`x`])]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(a)
    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(collection.get(`x`)?.name).toBe(before.name)
    const held = collection._sync.loadSubset({ ...b, refetch: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    older.resolve([{ id: `x`, name: `Older` }])
    await held
    expect(collection.get(`x`)?.name).toBe(manual.name)

    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(queryFn).toHaveBeenCalledTimes(4)
    expect(collection.get(`x`)?.name).toBe(newer.name)
  })

  /**
   * The physical Query may start fetching before a second equivalent logical
   * demand attaches. That demand did not observe the fetch event, but its
   * result is still older than a later accepted direct write. The independent
   * reference orders the held fetch before the write and preserves `Manual`
   * for both demands at result settlement. A later fetch remains authoritative.
   * This history distinguishes joining an in-flight Query from observing a
   * fetch that starts after both logical demands are attached.
   */
  it(`preserves a direct write when an aliased demand joins an in-flight fetch`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-join-in-flight-fetch`
    const older = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-join-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue([newer])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`x`])]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(a)
    expect(collection.get(`x`)?.name).toBe(before.name)
    const held = collection._sync.loadSubset({ ...a, refetch: true })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    const joining = collection._sync.loadSubset(b)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    await vi.waitFor(() => expect(query.getObserversCount()).toBe(2))
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    older.resolve([{ id: `x`, name: `Older` }])
    await Promise.all([held, joining])
    expect(collection.get(`x`)?.name).toBe(manual.name)
    expect(queryFn).toHaveBeenCalledTimes(2)

    await collection._sync.loadSubset({ ...b, refetch: true })
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(collection.get(`x`)?.name).toBe(newer.name)
  })

  /**
   * Two equivalent demands share a physical Query. A direct write lands while
   * its first refetch is held. A later physical refetch starts after the write,
   * then the demand whose key Query Core uses retires. The remaining demand
   * did not run the Query function, but the new fetch is authoritative for
   * its row. The independent reference uses the authored fetch/write order:
   * `Newer` must replace `Manual` when the replacement result applies. This
   * distinguishes fetch-event propagation from attach-time initialization.
   */
  it(`applies a post-write fetch to an aliased demand after its peer retires`, async () => {
    type Row = { id: string; name: string }
    const id = `aliased-peer-retires-after-fetch-start`
    const older = createDeferred<Array<Row>>()
    const replacement = createDeferred<Array<Row>>()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-peer-retirement-query`,
        },
      },
    })
    const before = { id: `x`, name: `Before` }
    const manual = { id: `x`, name: `Manual` }
    const newer = { id: `x`, name: `Newer` }
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([before])
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => replacement.promise)
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      older.resolve([])
      replacement.resolve([])
      await collection.cleanup()
      queryClient.clear()
    })
    const a = { where: eq(new IR.PropRef([`id`]), `x`) }
    const b = {
      where: new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`x`])]),
    }
    expect(getLoadSubsetDemandKey(a)).not.toBe(getLoadSubsetDemandKey(b))

    await collection._sync.loadSubset(b)
    await collection._sync.loadSubset(a)
    expect(collection.get(`x`)?.name).toBe(before.name)
    const query = queryClient.getQueryCache().find({ queryKey: [id] })!
    expect(query.getObserversCount()).toBe(2)
    const held = queryClient.refetchQueries({
      predicate: (candidate) => candidate === query,
    })
    void held.catch(() => {})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    expect(query.state.fetchStatus).toBe(`fetching`)
    await collection.utils.writeUpdate(manual)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    const postWrite = queryClient.refetchQueries({
      predicate: (candidate) => candidate === query,
    })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3))
    collection._sync.unloadSubset(b)
    expect(query.getObserversCount()).toBe(1)
    expect(collection.get(`x`)?.name).toBe(manual.name)

    replacement.resolve([newer])
    await postWrite
    await vi.waitFor(() => expect(collection.get(`x`)?.name).toBe(newer.name))
    older.resolve([{ id: `x`, name: `Older` }])
    await held.catch(() => {})
    expect(collection.get(`x`)?.name).toBe(newer.name)
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  /**
   * One physical Query has one cache-patch obligation per direct write. Two
   * distinct subset demands may alias the same Query under a custom Query
   * hash. The model counts physical Queries, not logical demand hashes. The
   * driver observes Query cache notifications and the public row after one write.
   */
  it(`patches a shared physical Query once per direct write`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `shared-physical-query-write`
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `shared-physical-query`,
        },
      },
    })
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `x`, name: `before`, category: `A` }]),
    )
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`category`]), `A`),
    })
    await collection._sync.loadSubset({
      where: eq(new IR.PropRef([`id`]), `x`),
    })
    const queries = queryClient.getQueryCache().getAll()
    expect(queries).toHaveLength(1)
    let notifications = 0
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === `updated` && event.query === queries[0])
        notifications++
    })
    await collection.utils.writeUpdate({ id: `x`, name: `after` })
    unsubscribe()
    expect(notifications).toBe(1)
    expect(collection.get(`x`)?.name).toBe(`after`)
  })

  /**
   * A zero-lease logical scope can keep its observer through an outside
   * listener after its Collection handler is removed. A second logical scope
   * may share that physical Query under a custom hash and become the owner of
   * a newer row. The independent cache rule requires one patch through the
   * owning scope even when the disjoint observer is visited first.
   */
  it(`patches an aliased Query through its owning observer`, async () => {
    type Row = { id: string; name: string; category: string }
    const id = `aliased-owner-cache-patch`
    const a = { id: `a`, name: `A`, category: `A` }
    const b = { id: `b`, name: `Before`, category: `B` }
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
          queryKeyHashFn: () => `aliased-owner`,
        },
      },
    })
    const queryFn = vi.fn().mockResolvedValueOnce([a]).mockResolvedValue([b])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    const demandA = { where: eq(new IR.PropRef([`category`]), `A`) }
    const demandB = { where: eq(new IR.PropRef([`category`]), `B`) }
    await collection._sync.loadSubset(demandA)
    const query = queryClient.getQueryCache().getAll()[0]!
    const observerA = query.observers[0]!
    const releaseOutsideListener = observerA.subscribe(() => {})
    cleanups.push(() => Promise.resolve(releaseOutsideListener()))
    collection._sync.unloadSubset(demandA)
    await collection._sync.loadSubset({ ...demandB, refetch: true })
    expect(collection.has(b.id)).toBe(true)
    expect(query.state.data).toEqual([b])
    await collection.utils.writeUpdate({ id: b.id, name: `After` })
    expect(query.state.data).toEqual([{ ...b, name: `After` }])
  })

  /**
   * A direct update to an owned row needs work in its owner's cached scope,
   * not in every disjoint scope. The independent category partition has ten
   * scopes of 1,000 rows and exactly one owner for the changed key. After
   * preload, a counted getKey boundary bounds one write to three owner-sized
   * passes plus fixed overhead. This counts actual adapter key extraction,
   * rather than timing or provider work.
   */
  it(`bounds direct cache patch work by the changed row's owners`, async () => {
    type Row = { id: string; category: string; name: string }
    const id = `direct-cache-owner-work`
    const queryClient = createQueryClient()
    let getKeyCalls = 0
    const source = Array.from({ length: 10 }, (_, category) =>
      Array.from({ length: 1000 }, (_, index) => ({
        id: `${category}-${index}`,
        category: String(category),
        name: `before`,
      })),
    ).flat()
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      const where = context.meta?.loadSubsetOptions?.where
      const lastArg = where?.type === `func` ? where.args.at(-1) : undefined
      const category = lastArg?.type === `val` ? lastArg.value : undefined
      return Promise.resolve(source.filter((row) => row.category === category))
    })
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => {
          getKeyCalls++
          return row.id
        },
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    for (let category = 0; category < 10; category++)
      await collection._sync.loadSubset({
        where: eq(new IR.PropRef([`category`]), String(category)),
      })
    getKeyCalls = 0
    await collection.utils.writeUpdate({ id: `3-0`, name: `after` })
    expect(collection.get(`3-0`)?.name).toBe(`after`)
    expect(queryFn).toHaveBeenCalledTimes(10)
    expect(getKeyCalls).toBeLessThanOrEqual(3010)
  })

  /**
   * A current complete Query result replaces its cold persisted result. The
   * independent model starts with `{kept, omitted}` and replaces it with
   * `{kept}`. Persisted row order cannot change that result, so both scan
   * orders must expose the survivor and delete the omission.
   */
  it.each([
    { scanOrder: [`kept`, `omitted`] },
    { scanOrder: [`omitted`, `kept`] },
  ] as const)(
    `replaces a cold two-row result in scan order $scanOrder`,
    async ({ scanOrder }) => {
      const id = `cold-multi-row-owner-${scanOrder.join(`-`)}`
      const queryHash = hashKey([id])
      const kept: Item = { id: `kept`, category: `shared`, name: `Kept` }
      const omitted: Item = {
        id: `omitted`,
        category: `shared`,
        name: `Omitted`,
      }
      const byId = new Map([
        [kept.id, kept],
        [omitted.id, omitted],
      ])
      const ownerMetadata = {
        queryCollection: { owners: { [queryHash]: true } },
      }
      const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
      const scanPersistedRows = vi.fn(() =>
        Promise.resolve(
          scanOrder.map((rowId) => ({
            key: rowId,
            value: byId.get(rowId)!,
            metadata: ownerMetadata,
          })),
        ),
      )
      const { collection } = createOwnershipFixture({
        id,
        results: [[kept]],
        metadataRecorder: metadata,
        scanPersistedRows,
        setupMetadata: (syncMetadata) =>
          syncMetadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          }),
      })

      await collection._sync.loadSubset({})

      expect(rows(collection)).toEqual([kept.id])
      expect(metadata.writes).toContainEqual({
        type: `delete`,
        key: omitted.id,
      })
    },
  )

  /**
   * Hydrated rows obey the same complete-result replacement law. The public
   * Collection begins with `{kept, omitted}` and the Query returns `{kept}`.
   * Hydration order cannot change the public result or keep the survivor alive
   * after its demand is released.
   */
  it.each([
    { hydrationOrder: [`kept`, `omitted`] },
    { hydrationOrder: [`omitted`, `kept`] },
  ] as const)(
    `replaces a hydrated two-row result in order $hydrationOrder`,
    async ({ hydrationOrder }) => {
      const id = `hydrated-multi-row-owner-${hydrationOrder.join(`-`)}`
      const queryHash = hashKey([id])
      const kept: Item = { id: `kept`, category: `shared`, name: `Kept` }
      const omitted: Item = {
        id: `omitted`,
        category: `shared`,
        name: `Omitted`,
      }
      const byId = new Map([
        [kept.id, kept],
        [omitted.id, omitted],
      ])
      const queryClient = createQueryClient()
      const queryFn = vi.fn(() => Promise.resolve([kept]))
      const descriptor = collectionOptions(
        queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `on-demand`,
          startSync: true,
        }),
      )
      const client = new DbClient({ queryClient })
      client.hydrate({
        collections: [
          {
            collectionId: id,
            rows: hydrationOrder.map((rowId) => ({
              key: rowId,
              value: byId.get(rowId)!,
              metadata: {
                queryCollection: { owners: { [queryHash]: true } },
              },
            })),
          },
        ],
      })
      const collection = client.collection(descriptor)
      cleanups.push(async () => {
        await client.cleanup()
        queryClient.clear()
      })

      await collection._sync.loadSubset({})
      expect(rows(collection)).toEqual([kept.id])

      collection._sync.unloadSubset({})
      await vi.waitFor(() => expect(rows(collection)).toEqual([]))
      expect(queryFn).toHaveBeenCalledOnce()
    },
  )

  /**
   * A retained subset owner cannot be settled by acquiring a different Query
   * key. The independent source model has one `detail` row in durable storage;
   * the current complete source keeps, omits, or moves it out of that subset.
   * After a full-source result applies, acquiring the retained subset must
   * reconcile its old owner and remove its revalidation marker. Compare public
   * and durable rows at that acquisition's settlement, before any explicit
   * refetch. The unchanged and moved cases guard against deleting a row still
   * owned by the full source.
   */
  it.each([{ name: `omitted` }, { name: `unchanged` }, { name: `moved` }])(
    `settles a retained $name subset after a complete full-source result`,
    async ({ name }) => {
      const id = `retained-subset-after-full-${name}`
      const oldRow: Item = {
        id: `detail-row`,
        category: `detail`,
        name: `Original`,
      }
      const subset = categorySubset(`detail`)
      const subsetHash = hashKey([id, getLoadSubsetDemandKey(subset)])
      const retentionKey = `queryCollection:gc:${subsetHash}`
      const storage = createOwnershipStorage({
        rows: new Map([[oldRow.id, oldRow]]),
        rowMetadata: new Map([
          [oldRow.id, { queryCollection: { owners: { [subsetHash]: true } } }],
        ]),
        collectionMetadata: new Map([
          [retentionKey, { queryHash: subsetHash, mode: `until-revalidated` }],
        ]),
      })
      const currentSource: Array<Item> =
        name === `omitted`
          ? []
          : name === `unchanged`
            ? [oldRow]
            : [{ ...oldRow, category: `list`, name: `Moved` }]
      const { collection } = createPersistedOwnershipFixture(
        id,
        storage,
        currentSource,
      )

      await collection.stateWhenReady()
      await collection._sync.loadSubset({})
      await collection._sync.loadSubset(subset)

      expect({
        publicRows: collection.toArray.map(
          ({ id: rowId, category, name: rowName }) => ({
            id: rowId,
            category,
            name: rowName,
          }),
        ),
        durableRows: storedItems(storage),
        retentionPending: storage
          .snapshot()
          .collectionMetadata.has(retentionKey),
      }).toEqual({
        publicRows: currentSource,
        durableRows: currentSource,
        retentionPending: false,
      })
      if (name === `moved`) {
        expect(
          persistedOwners(storage.snapshot().rowMetadata, oldRow.id),
        ).toEqual([hashKey([id])])
      }
      if (name === `unchanged`) {
        collection._sync.unloadSubset({})
        expect(rows(collection)).toEqual([oldRow.id])
      }
    },
  )

  it(`emits metadata for every owner of rows shared by overlapping queries`, async () => {
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    const { collection } = createOwnershipFixture({
      id: `persisted-overlap`,
      results: [[shared], [shared, listOnly]],
      metadataRecorder: metadata,
    })
    const detail = { where: categoryIn(`shared`, `detail`) }
    const list = { where: categoryIn(`shared`, `list`) }

    await collection._sync.loadSubset(detail)
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(1)

    await collection._sync.loadSubset(list)
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(2)
    expect(persistedOwners(metadata.rows, listOnly.id)).toHaveLength(1)

    collection._sync.unloadSubset(list)
    expect(rows(collection)).toEqual([shared.id])
    expect(persistedOwners(metadata.rows, shared.id)).toHaveLength(1)
  })

  it(`preserves committed peer ownership through a cold revalidation`, async () => {
    expectColdOwnerRevalidation(await observeColdOwnerRevalidation())
  })

  it(`rejects emitted ownership that is absent from cold storage`, async () => {
    const observations = await observeColdOwnerRevalidation(true)
    expect(() => expectColdOwnerRevalidation(observations)).toThrow()
  })

  it(`restages a persisted owner when its absent row arrives`, async () => {
    const id = `persisted-owner-before-row`
    const queryHash = hashKey([id])
    const result = createDeferred<Array<Item>>()
    const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
    let setupCalls = 0
    const { collection, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [result.promise, [{ ...shared, name: `Restarted` }]],
      metadataRecorder: metadata,
      setupMetadata: (api) => {
        setupCalls++
        api.row.set(shared.id, {
          queryCollection: { owners: { [queryHash]: true } },
        })
      },
    })

    expect(rows(collection)).toEqual([])
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])
    result.resolve([shared])
    await collection.stateWhenReady()
    expect(rows(collection)).toEqual([shared.id])
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])

    await collection.cleanup()
    await collection.preload()
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.get(shared.id)?.name).toBe(`Restarted`)
    })
    expect(setupCalls).toBe(1)
    expect(persistedOwners(metadata.rows, shared.id)).toEqual([queryHash])
  })

  it(`uses the replacement Query when the cache is cleared before an explicit refetch`, async () => {
    const barrier = createDeferred<void>()
    const thirdFetch = createDeferred<Array<Item>>()
    const authoritative = { ...shared, name: `Authoritative` }
    const { collection, queryClient, queryFn } = createOwnershipFixture({
      id: `clear-before-explicit-refetch`,
      results: [[shared], [authoritative], thirdFetch.promise],
    })
    const barrierCompletion = barrier.promise.then(() => {
      collection.deferDataRefresh = null
    })

    try {
      await collection._sync.loadSubset({})
      collection.deferDataRefresh = barrier.promise
      collection.utils.writeUpdate({ ...shared, name: `Manual` })
      queryClient.clear()

      barrier.resolve()
      await barrierCompletion
      const refresh = collection.utils.refetch({ throwOnError: true })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await refresh
      for (let turn = 0; turn < 30; turn++) await Promise.resolve()

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.get(shared.id)?.name).toBe(`Authoritative`)
    } finally {
      barrier.resolve()
      collection.deferDataRefresh = null
      thirdFetch.resolve([])
    }
  })

  it(`removes unobserved sibling scopes without scanning or snapshots`, async () => {
    const id = `unobserved-sibling-manual-write`
    const queryClient = createQueryClient()
    const siblingKey = [id, `prefetched-sibling`]
    queryClient.setQueryData(siblingKey, [shared])
    const queryFn = vi.fn(() => Promise.resolve([shared]))
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })

    await collection._sync.loadSubset({})
    const findAll = vi.spyOn(queryClient.getQueryCache(), `findAll`)
    const values = vi.spyOn(collection._state.syncedData, `values`)

    collection.utils.writeDelete(shared.id)

    expect(queryClient.getQueryData(siblingKey)).toBeUndefined()
    expect(findAll).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
  })
})

it.each([false, true])(
  `evicts sibling caches created before sync starts, restart=%s`,
  async (restart) => {
    const queryClient = createQueryClient()
    const id = `delayed-sync-cache`
    const collection = createCollection(
      queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([shared]),
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: false,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
    })
    if (restart) {
      collection.startSyncImmediate()
      await collection._sync.loadSubset({})
      await collection.cleanup()
    }
    const siblingKey = [id, `prefetched-sibling`]
    queryClient.setQueryData(siblingKey, [shared])
    collection.startSyncImmediate()
    await collection._sync.loadSubset({})
    collection.utils.writeDelete(shared.id)
    expect(queryClient.getQueryData(siblingKey)).toBeUndefined()
  },
)

// Law: when a persisted cache claim expires, an on-demand Query Collection
// reacquires only active demands from a fetch that starts after rotation.
// Model: the provider's current rows replace the expired cache's rows for the
// active subset. The QueryClient may still contain the old success, but that
// success has no authority over the new persisted cache generation. This real
// SQLite/QueryClient driver checks public and durable rows when reacquisition
// settles.
it(`reacquires an active Query subset after its SQLite cache claim expires`, async () => {
  const id = `query-cache-claim-recovery`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const currentClaim = recordRunCacheClaim(managed.adapter)
  const queryClient = createQueryClient()
  let activeRows: Array<Item> = [
    { id: `active-old`, category: `active`, name: `Old` },
  ]
  const triggeringRows: Array<Item> = [
    { id: `trigger-fresh`, category: `active`, name: `Trigger` },
  ]
  const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      structuredClone(
        context.queryKey[1] === activeDemandKey ? activeRows : triggeringRows,
      ),
    ),
  )
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`active-old`])
  expect(queryFn).toHaveBeenCalledTimes(1)
  const oldStorageId = currentClaim().storageCollectionId

  now += 10_001
  activeRows = [{ id: `active-fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  await vi.waitFor(() =>
    expect(new Set(itemIds(collection.toArray))).toEqual(
      new Set([`active-fresh`, `trigger-fresh`]),
    ),
  )
  expect(
    queryFn.mock.calls.filter(
      ([context]) => context.queryKey[1] === activeDemandKey,
    ),
  ).toHaveLength(2)
  expect(currentClaim().storageCollectionId).not.toBe(oldStorageId)
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `active-fresh`, name: `Fresh` },
    { key: `trigger-fresh`, name: `Trigger` },
  ])
})

// Distinct Query keys are independent documents even when one key is a
// prefix of the other and both Collections share one QueryClient. The model
// has two claims: A expires at 11000 and B, acquired later, expires at 15000.
// At 11001 only A may replace its persisted cache generation and source row.
// The real QueryClient uses prefix matching, so B's cache entry is deliberately
// inside A's base-key search. Public rows, B's Query entry, its durable rows,
// its current storage ID, and its fetch count are compared after A reloads.
it(`keeps a warm Query Collection independent when a prefix-sharing peer rotates`, async () => {
  const firstId = `query-prefix-rotation-a`
  const secondId = `query-prefix-rotation-b`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const firstManaged = persistence.resolvePersistenceForCollection!({
    collectionId: firstId,
    mode: `sync-present`,
  })
  const secondManaged = persistence.resolvePersistenceForCollection!({
    collectionId: secondId,
    mode: `sync-present`,
  })
  const queryClient = createQueryClient()
  const firstDemand = { limit: 1 }
  const secondDemand = { limit: 2 }
  const firstKey = [`shared-prefix`, getLoadSubsetDemandKey(firstDemand)]
  const secondKey = [
    `shared-prefix`,
    `peer`,
    getLoadSubsetDemandKey(firstDemand),
  ]
  let firstRows: Array<Item> = [
    { id: `first-old`, category: `active`, name: `Old` },
  ]
  const firstQueryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      structuredClone(
        context.queryKey[1] === getLoadSubsetDemandKey(firstDemand)
          ? firstRows
          : [{ id: `trigger`, category: `active`, name: `Trigger` }],
      ),
    ),
  )
  const secondRow: Item = {
    id: `second-warm`,
    category: `peer`,
    name: `Warm`,
  }
  const secondQueryFn = vi.fn(() => Promise.resolve([secondRow]))
  const first = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id: firstId,
        queryClient,
        queryKey: [`shared-prefix`],
        queryFn: firstQueryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: firstManaged,
    }),
  )
  const mounted = [first]
  cleanups.push(async () => {
    for (const collection of mounted.reverse()) await collection.cleanup()
    queryClient.clear()
    driver.close()
  })
  await first._sync.loadSubset(firstDemand)
  expect(itemIds(first.toArray)).toEqual([`first-old`])
  expect(queryClient.getQueryData(firstKey)).toHaveLength(1)

  now = 5_000
  const peer = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id: secondId,
        queryClient,
        queryKey: [`shared-prefix`, `peer`],
        queryFn: secondQueryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: secondManaged,
    }),
  )
  mounted.push(peer)
  await peer._sync.loadSubset(firstDemand)
  expect(itemIds(peer.toArray)).toEqual([`second-warm`])
  expect(secondQueryFn).toHaveBeenCalledTimes(1)
  const secondHead = driver
    .getDatabase()
    .prepare(
      `SELECT physical_id FROM cache_generation
       WHERE logical_id = ? AND retired = 0`,
    )
    .get(secondId) as { physical_id: string }
  const secondClaim = driver
    .getDatabase()
    .prepare(`SELECT claim_id FROM cache_generation_claim WHERE logical_id = ?`)
    .get(secondId) as { claim_id: string }
  expect(
    await secondManaged.adapter.loadSubset(
      {
        kind: `managed`,
        storageCollectionId: secondHead.physical_id,
        claimId: secondClaim.claim_id,
      },
      {},
      {
        cacheGenerationClaimId: secondClaim.claim_id,
      },
    ),
  ).toMatchObject([{ value: secondRow }])

  now = 11_001
  firstRows = [{ id: `first-fresh`, category: `active`, name: `Fresh` }]
  await first._sync.loadSubset(secondDemand)
  await vi.waitFor(() =>
    expect(new Set(itemIds(first.toArray))).toEqual(
      new Set([`first-fresh`, `trigger`]),
    ),
  )
  expect(itemIds(peer.toArray)).toEqual([`second-warm`])
  expect(queryClient.getQueryData(secondKey)).toEqual([secondRow])
  expect(secondQueryFn).toHaveBeenCalledTimes(1)
  expect(
    driver
      .getDatabase()
      .prepare(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
      )
      .get(secondId),
  ).toMatchObject(secondHead)
  expect(
    await secondManaged.adapter.loadSubset(
      {
        kind: `managed`,
        storageCollectionId: secondHead.physical_id,
        claimId: secondClaim.claim_id,
      },
      {},
      {
        cacheGenerationClaimId: secondClaim.claim_id,
      },
    ),
  ).toMatchObject([{ value: secondRow }])
})

// A claim can expire while persisted startup is reading metadata, before the
// Query source enters its sync run. The wrapper rotates the cache privately at
// that boundary. The old QueryClient success is not a source snapshot for the
// replacement generation: the first demand must fetch and publish fresh rows.
// With no rotation, an existing QueryClient success remains reusable. This
// real SQLite driver checks both sides of that boundary at demand settlement.
it.each([false, true])(
  `uses cached QueryClient data according to private startup rotation: %s`,
  async (rotateAtStartup) => {
    const id = `query-cache-startup-rotation`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    let now = 1_000
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const claim = managed.adapter.claimCacheGeneration!.bind(managed.adapter)
    const rotate = managed.adapter.rotateCacheGeneration!.bind(managed.adapter)
    let rotations = 0
    if (rotateAtStartup) {
      managed.adapter.claimCacheGeneration = async (...args) => {
        const acquired = await claim(...args)
        now = 12_000
        return acquired
      }
    }
    managed.adapter.rotateCacheGeneration = async (...args) => {
      rotations++
      return rotate(...args)
    }
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      [id, getLoadSubsetDemandKey({ limit: 1 })],
      [{ id: `old`, category: `active`, name: `Old` }],
    )
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `fresh`, category: `active`, name: `Fresh` }]),
    )
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryCollectionOptions<Item>({
          id,
          queryClient,
          queryKey: [id],
          queryFn,
          getKey: (item) => item.id,
          syncMode: `on-demand`,
          startSync: true,
        }),
        persistence: managed,
      }),
    )
    cleanups.push(async () => {
      await collection.cleanup()
      queryClient.clear()
      driver.close()
    })

    await collection.stateWhenReady()
    await collection._sync.loadSubset({ limit: 1 })
    expect(rotations).toBe(rotateAtStartup ? 1 : 0)
    expect(queryFn).toHaveBeenCalledTimes(rotateAtStartup ? 1 : 0)
    expect(itemIds(collection.toArray)).toEqual([
      rotateAtStartup ? `fresh` : `old`,
    ])
  },
)

// Two rotations may be queued before the first reaches its source restart.
// The latest rotation alone owns reacquisition. At the held second-rotation
// checkpoint the model still has no authoritative source row, so neither the
// old Query observer nor the first recovery may start another provider fetch.
// After the final rotation, the active demand must fetch and apply a new row.
it(`waits for the final SQLite rotation before reacquiring a Query subset`, async () => {
  const id = `query-cache-overlapping-rotations`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => 1_000,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const rotate = managed.adapter.rotateCacheGeneration?.bind(managed.adapter)
  if (!rotate) throw new Error(`Expected managed SQLite rotation`)
  const secondRotationEntered = createDeferred<void>()
  const releaseSecondRotation = createDeferred<void>()
  let rotations = 0
  managed.adapter.rotateCacheGeneration = async (...args) => {
    if (++rotations === 2) {
      secondRotationEntered.resolve()
      await releaseSecondRotation.promise
    }
    return rotate(...args)
  }
  const queryClient = createQueryClient()
  let fetches = 0
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () =>
      Promise.resolve([
        { id: `r${++fetches}`, category: `active`, name: `source` },
      ]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const sourceSync = queryOptions.sync.sync
  let recover!: () => Promise<void>
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          recover = params.metadata!.persistence!.startScopedRecovery!
          return sourceSync(params)
        },
      },
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    releaseSecondRotation.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  const demand = { limit: 1 }
  await collection._sync.loadSubset(demand)
  expect(itemIds(collection.toArray)).toEqual([`r1`])
  const first = recover()
  const second = recover()
  await secondRotationEntered.promise
  await first
  expect(rotations).toBe(2)
  expect(fetches, `before the final cache rotation`).toBe(1)
  expect(itemIds(collection.toArray)).toEqual([])

  releaseSecondRotation.resolve()
  await second
  await vi.waitFor(() => expect(collection.size).toBe(1))
  expect(collection.has(`r1`)).toBe(false)
  expect(fetches).toBeGreaterThan(1)
})

// The old Query fetch can outlive a cache rotation even when its observer is
// released. A late success has no authority to republish a row into the new
// generation. The provider snapshot is captured before the held fetch, so the
// old and fresh rows are distinguishable in both public and durable state at
// the settlement and stale-fetch-release checkpoints.
it(`does not publish a Query result started before SQLite cache rotation`, async () => {
  const id = `query-cache-claim-late-fetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const currentClaim = recordRunCacheClaim(managed.adapter)
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  let holdNextFetch = false
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  const queryFn = vi.fn(async () => {
    const snapshot = structuredClone(providerRows)
    if (holdNextFetch) {
      holdNextFetch = false
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  const oldStorageId = currentClaim().storageCollectionId
  holdNextFetch = true
  const oldLoad = Promise.resolve(
    collection._sync.loadSubset({ limit: 1, refetch: true }),
  )
  void oldLoad.catch(() => undefined)
  await oldFetchEntered.promise

  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  expect(currentClaim().storageCollectionId).not.toBe(oldStorageId)
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `fresh`, name: `Fresh` },
  ])

  releaseOldFetch.resolve()
  await Promise.allSettled([oldLoad])
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  expect(await readClaimedCacheRows(managed.adapter, currentClaim())).toEqual([
    { key: `fresh`, name: `Fresh` },
  ])
})

// A peer Query observer may already have a fetch in flight when persistence
// rotates its startup cache. With no cached Query result, the first Collection
// demand joins that old fetch. Neither its success nor its error establishes
// the replacement generation. The demand must start another fetch and apply
// the fresh source row. The provider outcome is an independent history axis.
it.each([`success`, `error`] as const)(
  `reacquires after a pre-start Query fetch ends with %s`,
  async (oldOutcome) => {
    const id = `query-cache-pre-start-fetch-${oldOutcome}`
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    let now = 1_000
    const persistence = createNodeSQLitePersistence({
      database: driver.getDatabase(),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const managed = persistence.resolvePersistenceForCollection!({
      collectionId: id,
      mode: `sync-present`,
    })
    const claim = managed.adapter.claimCacheGeneration!.bind(managed.adapter)
    managed.adapter.claimCacheGeneration = async (...args) => {
      const acquired = await claim(...args)
      now = 12_000
      return acquired
    }
    const queryClient = createQueryClient()
    const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
    const oldFetchEntered = createDeferred<void>()
    const releaseOldFetch = createDeferred<void>()
    const peer = new QueryObserver(queryClient, {
      queryKey: [id, activeDemandKey],
      queryFn: async () => {
        oldFetchEntered.resolve()
        await releaseOldFetch.promise
        if (oldOutcome === `error`) throw new Error(`retired fetch failed`)
        return [{ id: `old`, category: `active`, name: `Old` }]
      },
      retry: false,
    })
    const releasePeer = peer.subscribe(() => {})
    await oldFetchEntered.promise
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `fresh`, category: `active`, name: `Fresh` }]),
    )
    const sourceLoadEntered = createDeferred<void>()
    const queryOptions = queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        QueryCollectionUtils<Item, string | number, Item, unknown>
      >({
        ...queryOptions,
        sync: {
          ...queryOptions.sync,
          sync: (params) => {
            const source = queryOptions.sync.sync(params)
            if (!source || typeof source === `function` || !source.loadSubset) {
              throw new Error(`Expected on-demand Query source`)
            }
            return {
              ...source,
              loadSubset: (options) => {
                const work = source.loadSubset!(options)
                sourceLoadEntered.resolve()
                return work
              },
            }
          },
        },
        persistence: managed,
      }),
    )
    cleanups.push(async () => {
      releaseOldFetch.resolve()
      releasePeer()
      await collection.cleanup()
      queryClient.clear()
      driver.close()
    })

    await collection.stateWhenReady()
    const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    void load.catch(() => undefined)
    await sourceLoadEntered.promise
    expect(queryFn).not.toHaveBeenCalled()
    expect(collection.size).toBe(0)
    releaseOldFetch.resolve()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        load,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`fresh Query demand remained pending`)),
            500,
          )
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(itemIds(collection.toArray)).toEqual([`fresh`])
  },
)

// A later demand is a separate ownership node. A previous QueryClient success
// for that key remains an ordinary cache hit, but it cannot establish rows in
// the replacement SQLite generation. The held provider fetch gives this
// history a checkpoint before fresh rows are available: the old cached row
// must stay absent, and the demand may settle only after fresh application.
it(`refetches a later Query demand with old client data after cache rotation`, async () => {
  const id = `query-cache-claim-later-demand`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const laterProviderRows: Array<Item> = [
    { id: `later`, category: `active`, name: `Later` },
  ]
  let holdFetch = false
  const freshFetchEntered = createDeferred<void>()
  const releaseFreshFetch = createDeferred<void>()
  const queryFn = vi.fn(async (context: QueryFunctionContext) => {
    if (holdFetch) {
      freshFetchEntered.resolve()
      await releaseFreshFetch.promise
    }
    return structuredClone(
      context.queryKey[1] === getLoadSubsetDemandKey({ limit: 2 })
        ? laterProviderRows
        : providerRows,
    )
  })
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseFreshFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 1, refetch: true })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])

  const laterDemand = { limit: 2 }
  queryClient.setQueryData(
    [id, getLoadSubsetDemandKey(laterDemand)],
    [{ id: `stale`, category: `active`, name: `Stale` }],
  )
  holdFetch = true
  const load = Promise.resolve(collection._sync.loadSubset(laterDemand))
  void load.catch(() => undefined)
  await freshFetchEntered.promise
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
  releaseFreshFetch.resolve()
  await load
  expect(itemIds(collection.toArray)).toEqual([`fresh`, `later`])
})

// A new key has no fetch from the retired cache generation. The generation
// boundary requires a fresh provider result, but its first fetch already
// supplies that result. The request log is the observation: a cancelled first
// fetch followed by a second one would return the right rows while wasting
// one transport for every new key after recovery.
it(`fetches a new Query key once after cache rotation`, async () => {
  const id = `query-cache-new-key-after-rotation`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve([
      {
        id: `row-${String(context.queryKey[1])}`,
        category: `active`,
        name: `source`,
      },
    ]),
  )
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  now += 10_001
  await collection._sync.loadSubset({ limit: 1, refetch: true })
  const beforeNewKey = queryFn.mock.calls.length
  await collection._sync.loadSubset({ limit: 2 })
  expect(queryFn.mock.calls.length - beforeNewKey).toBe(1)

  const laterDemand = { limit: 3 }
  queryClient.setQueryData(
    [id, getLoadSubsetDemandKey(laterDemand)],
    [{ id: `stale`, category: `active`, name: `Stale` }],
  )
  const beforeSeededKey = queryFn.mock.calls.length
  await collection._sync.loadSubset(laterDemand)
  expect(queryFn.mock.calls.length - beforeSeededKey).toBe(1)
})

// Rotation is a durable authority boundary. If SQLite refuses it, the current
// sync run cannot resume its old observers as if the cache were still valid.
// The public Collection status and later demand rejection make this fail-stop
// visible; a pending internal recovery flag alone is not a silent freeze.
it(`reports a failed Query cache rotation as a terminal Collection error`, async () => {
  const id = `query-cache-failed-rotation`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    now: () => 1_000,
  })
  const managed = persistence.resolvePersistenceForCollection!({
    collectionId: id,
    mode: `sync-present`,
  })
  const failure = new Error(`rotation refused`)
  const rotationEntered = createDeferred<void>()
  managed.adapter.rotateCacheGeneration = async () => {
    rotationEntered.resolve()
    throw failure
  }
  const queryClient = createQueryClient()
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () =>
      Promise.resolve([{ id: `old`, category: `active`, name: `Old` }]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const sourceSync = queryOptions.sync.sync
  let recover!: () => Promise<void>
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          recover = params.metadata!.persistence!.startScopedRecovery!
          return sourceSync(params)
        },
      },
      persistence: managed,
    }),
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(collection.status).toBe(`ready`)
  const outcome = recover()
  await rotationEntered.promise
  await expect(outcome).rejects.toBe(failure)
  // A refused rotation is a persistence failure, so the Collection crashes
  // even after Collection readiness, and later demand rejects with its cause.
  expect(collection.status).toBe(`crashed`)
  await expect(collection._sync.loadSubset({ limit: 2 })).rejects.toBe(failure)
})

// A public refetch returns a Query result only if that result still belongs to
// the current persisted cache generation. This provider captures the old row
// before a held fetch, then recovery rotates SQLite and applies the fresh row.
// The old result may complete in QueryClient, but the utility must report its
// invalidated operation as canceled instead of fulfilling with unapplied data.
it(`cancels a Query utility refetch whose result crosses cache rotation`, async () => {
  const id = `query-cache-claim-held-utility-refetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  let fetches = 0
  const queryFn = vi.fn(async () => {
    const snapshot = structuredClone(providerRows)
    if (++fetches === 2) {
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  expect(itemIds(collection.toArray)).toEqual([`old`])
  const oldRefetch = collection.utils.refetch({ throwOnError: true })
  void oldRefetch.catch(() => undefined)
  await oldFetchEntered.promise
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  expect(itemIds(collection.toArray)).toEqual([`fresh`])

  releaseOldFetch.resolve()
  await expect(oldRefetch).rejects.toBeInstanceOf(CancelledError)
  expect(itemIds(collection.toArray)).toEqual([`fresh`])
})

// A released acquisition cannot schedule another provider fetch. In this
// history a refetch has joined an old, held Query fetch; cache rotation
// invalidates that result, and unload retires its final observer lease. When
// the old fetch completes, the call count must stay fixed at the release cut.
it(`does not restart a released Query acquisition after cache rotation`, async () => {
  const id = `query-cache-claim-released-refetch`
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  let providerRows: Array<Item> = [
    { id: `old`, category: `active`, name: `Old` },
  ]
  const oldFetchEntered = createDeferred<void>()
  const releaseOldFetch = createDeferred<void>()
  const activeDemandKey = getLoadSubsetDemandKey({ limit: 1 })
  let activeFetches = 0
  const queryFn = vi.fn(async (context: QueryFunctionContext) => {
    const snapshot = structuredClone(providerRows)
    if (context.queryKey[1] === activeDemandKey && ++activeFetches === 2) {
      oldFetchEntered.resolve()
      await releaseOldFetch.promise
    }
    return snapshot
  })
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
      persistence,
    }),
  )
  cleanups.push(async () => {
    releaseOldFetch.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection._sync.loadSubset({ limit: 1 })
  const oldLoad = Promise.resolve(
    collection._sync.loadSubset({ limit: 1, refetch: true }),
  )
  void oldLoad.catch(() => undefined)
  await oldFetchEntered.promise
  now += 10_001
  providerRows = [{ id: `fresh`, category: `active`, name: `Fresh` }]
  await collection._sync.loadSubset({ limit: 2 })
  collection._sync.unloadSubset({ limit: 1 })
  collection._sync.unloadSubset({ limit: 1 })
  const fetchesAtRelease = activeFetches
  releaseOldFetch.resolve()
  await Promise.allSettled([oldLoad])
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(activeFetches).toBe(fetchesAtRelease)
  expect(collection.get(`old`)).toBeUndefined()
})

// Retention maintenance reads old persisted ownership before deciding what to
// delete. A scan returned by the old SQLite generation has no authority after
// rotation, even if a fresh provider result uses the same row key. The wrapper
// holds the completed real-adapter scan so the check observes the fresh row
// both before and after the stale maintenance continuation is released.
it(`does not delete a fresh Query row from an old retention scan`, async () => {
  // The old retention scan must start after the Collection is ready, however
  // long startup takes. Startup cleans up an entry that has already expired,
  // and that would hold the scan inside startup. So the entry expires a minute
  // out on a fake clock that advances with real time, and the test moves the
  // clock past it only after readiness.
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `Date`],
    shouldAdvanceTime: true,
  })
  const id = `query-cache-claim-held-retention`
  const oldRow: Item = { id: `same`, category: `active`, name: `Old` }
  const freshRow: Item = { ...oldRow, name: `Fresh` }
  const subset = { limit: 1 }
  const queryHash = hashKey([id, getLoadSubsetDemandKey(subset)])
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  let now = 1_000
  const persistence = createNodeSQLitePersistence({
    database: driver.getDatabase(),
    cacheGenerationClaimTtlMs: 10_000,
    now: () => now,
  })
  const queryClient = createQueryClient()
  const scanEntered = createDeferred<void>()
  const releaseOldScan = createDeferred<void>()
  let scans = 0
  const queryOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn: () => Promise.resolve([freshRow]),
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    startSync: true,
  })
  const originalSync = queryOptions.sync.sync
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryOptions,
      sync: {
        ...queryOptions.sync,
        sync: (params) => {
          const metadata = params.metadata!
          const capability = metadata.persistence!
          const scan = capability.scanPersistedRows
          params.begin()
          params.write({ type: `insert`, value: oldRow })
          metadata.row.set(oldRow.id, {
            queryCollection: { owners: { [queryHash]: true } },
          })
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `ttl`,
            expiresAt: Date.now() + 60_000,
          })
          params.commit()
          return originalSync({
            ...params,
            metadata: {
              ...metadata,
              persistence: {
                ...capability,
                scanPersistedRows: async (...args) => {
                  const snapshot = await scan(...args)
                  if (++scans === 1) {
                    scanEntered.resolve()
                    await releaseOldScan.promise
                  }
                  return snapshot
                },
              },
            },
          })
        },
      },
      persistence,
    }),
  )
  cleanups.push(async () => {
    vi.useRealTimers()
    releaseOldScan.resolve()
    await collection.cleanup()
    queryClient.clear()
    driver.close()
  })

  await collection.stateWhenReady()
  expect(scans).toBe(0)
  await vi.advanceTimersByTimeAsync(60_001)
  await scanEntered.promise
  now += 10_001
  await collection._sync.loadSubset(subset)
  expect(collection.get(`same`)?.name).toBe(`Fresh`)
  releaseOldScan.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(collection.get(`same`)?.name).toBe(`Fresh`)
  expect(collection.status).toBe(`ready`)
})
