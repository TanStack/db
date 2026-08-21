import { QueryClient } from '@tanstack/query-core'
import {
  BasicIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { expectAssertionFailure } from '../../db/tests/expected-failure.js'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { queryCollectionOptions } from '../src/query.js'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type { SyncMetadataApi } from '@tanstack/db'

type Row = {
  id: string
  group?: string
}

let collectionSequence = 0

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

async function expectInitialQueryFailureStatus(): Promise<void> {
  const error = new Error(`initial query failed`)
  const queryClient = createQueryClient()
  const id = `load-subset-error-status-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryFn = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce([{ id: `recovered` }])
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const preloadOutcomes = Promise.allSettled([
    collection.preload(),
    live.preload(),
  ])

  try {
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
      expect(collection.utils.isError).toBe(true)
    })
    expect(loggedError).toHaveBeenCalled()
    try {
      expect(collection.status).toBe(`error`)
      expect(live.status).toBe(`error`)
      expect((await preloadOutcomes).map(({ status }) => status)).toEqual([
        `rejected`,
        `rejected`,
      ])
    } catch (caught) {
      throw new TraceAssertionError(0, caught)
    }

    await collection.utils.clearError()
    await vi.waitFor(() => {
      expect(collection.status).toBe(`ready`)
      expect(collection.get(`recovered`)).toBeDefined()
      expect(live.status).toBe(`ready`)
      expect(live.get(`recovered`)).toBeDefined()
    })
    await expect(collection.preload()).resolves.toBeUndefined()
    await expect(live.preload()).resolves.toBeUndefined()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectLateDependentObservesInitialFailure(): Promise<void> {
  const error = new Error(`source failed before dependent construction`)
  const queryClient = createQueryClient()
  const id = `load-subset-late-dependent-error-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: vi.fn().mockRejectedValue(error),
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )

  await expect(collection.preload()).rejects.toBe(error)
  expect(collection.status).toBe(`error`)

  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const livePreload = live.preload()
  void livePreload.catch(() => undefined)

  try {
    expect(live.status).toBe(`error`)
    await expect(livePreload).rejects.toThrow()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    await Promise.allSettled([livePreload])
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectEveryFailedSourceToRecover(): Promise<void> {
  const createControlledSource = (id: string) => {
    let fail: () => void = () => {
      throw new Error(`Source '${id}' has not started`)
    }
    let recover: (row: Row) => void = (_row) => {
      throw new Error(`Source '${id}' has not started`)
    }
    const collection = createCollection<Row>({
      id,
      getKey: (row) => row.id,
      startSync: false,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ begin, write, commit, markReady, markError }) => {
          fail = markError
          recover = (row) => {
            begin()
            write({ type: `insert`, value: row })
            commit()
            markReady()
          }
        },
      },
    })
    return {
      collection,
      fail: () => fail(),
      recover: (row: Row) => recover(row),
    }
  }

  const left = createControlledSource(
    `load-subset-multi-error-left-${collectionSequence++}`,
  )
  const right = createControlledSource(
    `load-subset-multi-error-right-${collectionSequence++}`,
  )
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const live = createLiveQueryCollection((query) =>
    query
      .from({ left: left.collection })
      .join({ right: right.collection }, ({ left: leftRow, right: rightRow }) =>
        eq(leftRow.id, rightRow.id),
      )
      .select(({ left: row }) => ({ id: row.id })),
  )
  const preload = live.preload()
  void preload.catch(() => undefined)

  try {
    left.fail()
    right.fail()
    await expect(preload).rejects.toThrow()
    expect(live.status).toBe(`error`)

    left.recover({ id: `shared` })
    expect(left.collection.status).toBe(`ready`)
    expect(right.collection.status).toBe(`error`)
    expect(live.status).toBe(`error`)

    right.recover({ id: `shared` })
    await expect(live.preload()).resolves.toBeUndefined()
    expect(live.status).toBe(`ready`)
    expect(live.toArray.map((row) => row.id)).toEqual([`shared`])
  } finally {
    await live.cleanup()
    await left.collection.cleanup()
    await right.collection.cleanup()
    await Promise.allSettled([preload])
    loggedError.mockRestore()
  }
}

async function expectRefetchFailureKeepsReadySnapshot(): Promise<void> {
  const error = new Error(`refetch failed`)
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-status-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryFn = vi
    .fn()
    .mockResolvedValueOnce([{ id: `cached` }])
    .mockRejectedValueOnce(error)
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )

  try {
    await live.preload()
    await collection.utils.refetch()
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
    })
    expect(collection.status).toBe(`ready`)
    expect(live.status).toBe(`ready`)
    expect(collection.get(`cached`)).toBeDefined()
    expect(live.get(`cached`)).toBeDefined()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectDeferredStartupReadyDoesNotOverrideError(): Promise<void> {
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryClient = createQueryClient()
  const id = `load-subset-deferred-ready-${collectionSequence++}`
  const queryError = new Error(`cached observer failed`)
  const queryFn = vi.fn().mockRejectedValue(queryError)
  const baseOptions = queryCollectionOptions<Row>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey: (row) => row.id,
    startSync: true,
    syncMode: `on-demand`,
    retry: false,
  })
  const originalSync = baseOptions.sync
  let syncParams!: Parameters<typeof originalSync.sync>[0]
  const collection = createCollection({
    ...baseOptions,
    sync: {
      sync: (params) => {
        syncParams = params
        return originalSync.sync(params)
      },
    },
  })

  const firstLoad = collection._sync.loadSubset({})
  if (!(firstLoad instanceof Promise)) {
    throw new Error(`The failing query must be asynchronous`)
  }
  await expect(firstLoad).rejects.toBe(queryError)
  expect(collection.status).toBe(`ready`)

  let releaseScan!: () => void
  const scanReleased = new Promise<void>((resolve) => {
    releaseScan = resolve
  })
  let resolveMaintenanceDelete!: () => void
  const maintenanceDeleted = new Promise<void>((resolve) => {
    resolveMaintenanceDelete = resolve
  })
  const metadata = {
    row: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      scanPersisted: async () => {
        await scanReleased
        return []
      },
    },
    collection: {
      get: () => undefined,
      set: () => {},
      delete: () => {
        resolveMaintenanceDelete()
      },
      list: () => [
        {
          key: `queryCollection:gc:expired`,
          value: { queryHash: `expired`, mode: `ttl`, expiresAt: 0 },
        },
      ],
    },
  } as SyncMetadataApi<string | number>

  collection._lifecycle.setStatus(`cleaned-up`)
  collection._lifecycle.setStatus(`loading`)
  const secondSync = originalSync.sync({ ...syncParams, metadata })

  try {
    expect(collection.status).toBe(`error`)
    releaseScan()
    await maintenanceDeleted
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect(collection.status).toBe(`error`)
    expect(collection.utils.lastError).toBe(queryError)
  } finally {
    if (typeof secondSync === `function`) {
      await secondSync()
    } else {
      await secondSync?.cleanup?.()
    }
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectEquivalentPredicatesShareOneLoad(
  form: `commutative-and` | `reversed-equality`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-canonical-predicate-${collectionSequence++}`
  const queryFn = vi.fn().mockResolvedValue([{ id: `a`, group: `x` }])
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const firstComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`id`]),
    new IR.Value(`a`),
  ])
  const secondComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`x`),
  ])
  const first =
    form === `commutative-and`
      ? new IR.Func(`and`, [firstComparison, secondComparison])
      : firstComparison
  const second =
    form === `commutative-and`
      ? new IR.Func(`and`, [secondComparison, firstComparison])
      : new IR.Func<boolean>(`eq`, [new IR.Value(`a`), new IR.PropRef([`id`])])

  try {
    await collection._sync.loadSubset({ where: first })
    await collection._sync.loadSubset({ where: second })
    try {
      expect(queryFn.mock.calls.length).toBe(1)
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectFinalOwnerCleanupAbortsQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-cancel-final-owner-${collectionSequence++}`
  let capturedSignal: AbortSignal | undefined
  let resolveStarted!: () => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    capturedSignal = context.signal
    resolveStarted()
    return new Promise<Array<Row>>((_resolve, reject) => {
      context.signal.addEventListener(`abort`, () => {
        const error = new Error(`query aborted`)
        error.name = `AbortError`
        reject(error)
      })
    })
  })
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).select(({ row }) => ({ id: row.id })),
  )
  const preloadOutcome = live.preload().catch((error: unknown) => error)

  try {
    await started
    expect(queryFn).toHaveBeenCalledOnce()
    expect(capturedSignal?.aborted).toBe(false)

    await live.cleanup()
    expect(capturedSignal?.aborted).toBe(true)
  } finally {
    await live.cleanup()
    await source.cleanup()
    queryClient.clear()
    await preloadOutcome
  }
}

async function expectRemountAfterAbortStartsFreshQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-remount-after-abort-${collectionSequence++}`
  let resolveFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    resolveFirstStarted = resolve
  })
  const queryFn = vi
    .fn<(context: QueryFunctionContext) => Promise<Array<Row>>>()
    .mockImplementationOnce((context) => {
      resolveFirstStarted()
      return new Promise<Array<Row>>((_resolve, reject) => {
        context.signal.addEventListener(`abort`, () => {
          const error = new Error(`first query aborted`)
          error.name = `AbortError`
          reject(error)
        })
      })
    })
    .mockResolvedValueOnce([{ id: `fresh` }])
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const buildLive = () =>
    createLiveQueryCollection((query) =>
      query.from({ row: source }).select(({ row }) => ({ id: row.id })),
    )
  const first = buildLive()
  const firstOutcome = first.preload().catch((error: unknown) => error)
  let second: ReturnType<typeof buildLive> | undefined

  try {
    await firstStarted
    await first.cleanup()
    await firstOutcome

    second = buildLive()
    const rows = await second.toArrayWhenReady()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([`fresh`])
  } finally {
    await first.cleanup()
    await second?.cleanup()
    await source.cleanup()
    queryClient.clear()
  }
}

describe(`loadSubset lifecycle oracle`, () => {
  it(`reports an initial query failure and recovers after a successful refetch`, async () => {
    await expectInitialQueryFailureStatus()
  })

  it(`reports an initial failure to a dependent created after the source failed`, async () => {
    await expectLateDependentObservesInitialFailure()
  })

  it(`recovers a dependent only after every failed source recovers`, async () => {
    await expectEveryFailedSourceToRecover()
  })

  it(`keeps the last ready snapshot after a refetch failure`, async () => {
    await expectRefetchFailureKeepsReadySnapshot()
  })

  it(`does not let deferred startup readiness override a replayed error`, async () => {
    await expectDeferredStartupReadyDoesNotOverrideError()
  })

  it(`commutative predicate forms share one query-db transport load`, async () => {
    await expectAssertionFailure(expectEquivalentPredicatesShareOneLoad, {
      checkpoint: 0,
      classify: ({ actual, expected }) => actual === 2 && expected === 1,
    })(`commutative-and`)
  })

  it(`reversed equality operands share one query-db transport load`, async () => {
    await expectAssertionFailure(expectEquivalentPredicatesShareOneLoad, {
      checkpoint: 0,
      classify: ({ actual, expected }) => actual === 2 && expected === 1,
    })(`reversed-equality`)
  })

  it(`aborts an in-flight query when its final live-query owner cleans up`, async () => {
    await expectFinalOwnerCleanupAbortsQuery()
  })

  it(`starts a fresh query after an aborted owner immediately remounts`, async () => {
    await expectRemountAfterAbortStartsFreshQuery()
  })
})
