import {
  BasicIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type { LoadSubsetOptions, SyncMetadataApi } from '@tanstack/db'

/**
 * # Does Query-backed loadSubset preserve identity and lifecycle?
 *
 * Canonically equal demands share one Query transport. An applied full-source
 * result can also serve a later narrower demand while the full Query stays
 * active. Query Core success before Collection application is insufficient,
 * including when an older full result was applied. Otherwise distinct
 * predicates, values, order, cursor, and scope remain distinct. The final
 * live-query owner controls cancellation, and a replacement owner starts fresh
 * after abort.
 * Initial failure reaches existing and late dependents; recovery becomes public
 * only after every failed source recovers. A refetch stays pending while result
 * application is deferred, including for existing and cached demands. After a
 * direct write, an explicit subset refetch waits for a request that started
 * later than that write, even if an empty-cache request was already running.
 * A later refetch failure retains the last ready snapshot.
 *
 * Small identity forms and lifecycle histories drive a real QueryClient and
 * Collection. The oracle records query calls, values, request options, abort
 * signals, metadata, source and dependent status, exact errors, and cleanup.
 * Fault cases prove correct call counts cannot hide wrong returned values or a
 * stale replacement snapshot.
 *
 * The exact demand-identity API in docs/reference/functions/getLoadSubsetDemandKey.md
 * and the Collection sync-adapter contract in docs/guides/collection-options-creator.md
 * authorize the identity, request-scoped release, and applied-settlement laws.
 * The query-collection guide's on-demand reuse and cancellation sections and
 * the 0.5 query-driven-sync post authorize the bounded full-source refinement
 * below. They do not make an incomplete or failed request authoritative for a
 * broader scope. The guide also permits an ignored-signal provider to finish
 * after final observer removal and supports metadata request signals. A
 * shared Query's later fetch must use a live signal when its original
 * acquisition has released; reading that signal eagerly would change the
 * ignored-signal behavior. If a peer joins after a fetch starts, an abort from
 * the original acquisition can end the provider call while the Query remains
 * owned. One replacement call gives that peer a live transport. The controlled
 * fixture covers exact abort reasons and fresh AbortErrors; a fresh unrelated
 * AbortError after the same abort has no distinguishable provider provenance.
 * Each direct load below represents one acquisition lease; the small reference
 * history keeps a shared Query transport active while any lease remains. The
 * held provider checks the abort signal at each release checkpoint. The
 * two-Collection witness reaches Query Core's last-set queryFn path at the
 * installed version. These controlled histories do not establish real network
 * cancellation, arbitrary Query scheduling, or native persistence behavior.
 */

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

/**
 * The model has two provider categories. The full response proves both; a
 * filtered demand adds no source need while that completed full Query stays
 * owned. The fixed history keeps that Query alive after its first logical
 * owner leaves, then invalidates it to prove the dependent still receives new
 * rows with a live provider signal. An explicit refetch is a fresh exact
 * request and must call the provider with the filter. The production path
 * uses real live-query subscriptions, Query observers, and Collection
 * acquisition leases; the public checks are fetch arguments and filtered
 * rows after each settled action. This does not claim arbitrary predicate
 * implication or provider freshness without invalidation.
 */
async function expectActiveFullSourceServesFilteredDemand(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `full-source-subset-reuse-${collectionSequence++}`
  const filter = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`a`),
  ])
  const refetchRequest: LoadSubsetOptions = { where: filter, refetch: true }
  let providerRows: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `b1`, group: `b` },
  ]
  const requests: Array<`full` | `filtered`> = []
  let originalFullSignal: AbortSignal | undefined
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const requestSignal = context.meta?.loadSubsetOptions?.signal
    requestSignal?.throwIfAborted()
    const where = context.meta?.loadSubsetOptions?.where
    const scope = where === undefined ? `full` : `filtered`
    if (scope === `full` && originalFullSignal === undefined)
      originalFullSignal = requestSignal
    requests.push(scope)
    return Promise.resolve(
      providerRows.filter((row) => scope === `full` || row.group === `a`),
    )
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const full = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const filtered = createLiveQueryCollection((query) =>
    query
      .from({ row: collection })
      .where(({ row }) => eq(row.group, `a`))
      .select(({ row }) => ({ id: row.id })),
  )
  const filteredPeer = createLiveQueryCollection((query) =>
    query
      .from({ row: collection })
      .where(({ row }) => eq(row.group, `a`))
      .select(({ row }) => ({ id: row.id })),
  )
  try {
    await full.preload()
    expect(collection.toArray.map(({ id: rowId }) => rowId).sort()).toEqual([
      `a1`,
      `b1`,
    ])
    expect(requests).toEqual([`full`])

    await filtered.preload()
    await filteredPeer.preload()
    expect(requests).toEqual([`full`])
    expect(filtered.toArray.map(({ id: rowId }) => rowId)).toEqual([`a1`])
    // The dependent retains the full Query's observer lease. Releasing the
    // original owner cannot make its rows or freshness disappear.
    await full.cleanup()
    await filtered.cleanup()
    expect(originalFullSignal?.aborted).toBe(true)
    expect(collection.has(`a1`)).toBe(true)
    expect(collection.has(`b1`)).toBe(true)

    providerRows = [
      { id: `a1`, group: `a` },
      { id: `a2`, group: `a` },
      { id: `b1`, group: `b` },
    ]
    await queryClient.invalidateQueries({ queryKey: [id], exact: true })
    await vi.waitFor(() => expect(collection.has(`a2`)).toBe(true))
    expect(requests).toEqual([`full`, `full`])
    expect(filteredPeer.toArray.map(({ id: rowId }) => rowId).sort()).toEqual([
      `a1`,
      `a2`,
    ])

    await collection._sync.loadSubset(refetchRequest)
    expect(requests).toEqual([`full`, `full`, `filtered`])
    await filteredPeer.cleanup()
    expect(collection.toArray.map(({ id: rowId }) => rowId).sort()).toEqual([
      `a1`,
      `a2`,
    ])
    collection._sync.unloadSubset(refetchRequest)
    await vi.waitFor(() => expect(collection.size).toBe(0))
  } finally {
    await full.cleanup()
    await filtered.cleanup()
    await filteredPeer.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * An in-flight full request has not established complete source coverage.
 * The filtered view may request its exact scope or wait for the full result;
 * without its own result it cannot settle before the full rows apply. This is
 * the negative case for the reuse law above.
 */
async function expectPendingFullSourceNeedsAppliedEvidence(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `pending-full-source-${collectionSequence++}`
  const fullRows: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `b1`, group: `b` },
  ]
  let resolveFull: ((rows: Array<Row>) => void) | undefined
  const requests: Array<`full` | `filtered`> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    if (context.meta?.loadSubsetOptions?.where !== undefined) {
      requests.push(`filtered`)
      return Promise.resolve(fullRows.filter((row) => row.group === `a`))
    }
    requests.push(`full`)
    return new Promise<Array<Row>>((resolve) => {
      resolveFull = resolve
    })
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const full = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const filtered = createLiveQueryCollection((query) =>
    query
      .from({ row: collection })
      .where(({ row }) => eq(row.group, `a`))
      .select(({ row }) => ({ id: row.id })),
  )
  try {
    const fullPreload = full.preload()
    await vi.waitFor(() => expect(requests).toEqual([`full`]))
    let filteredSettled = false
    const filteredPreload = filtered.preload()
    void filteredPreload.then(() => {
      filteredSettled = true
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (!requests.includes(`filtered`)) {
      expect(filteredSettled).toBe(false)
      expect(filtered.has(`a1`)).toBe(false)
    }
    resolveFull?.(fullRows)
    await Promise.all([fullPreload, filteredPreload])
    expect(filtered.toArray.map(({ id: rowId }) => rowId)).toEqual([`a1`])
    expect(collection.toArray.map(({ id: rowId }) => rowId).sort()).toEqual([
      `a1`,
      `b1`,
    ])
  } finally {
    resolveFull?.(fullRows)
    await full.cleanup()
    await filtered.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * Query Core can publish a successful full result before the Collection has
 * applied its rows. The model's full-source coverage begins at applied
 * settlement, not at Query success. A filtered acquisition made in that gap
 * may start its own request or wait for the full application; it cannot report
 * success while the promised new filtered row is absent. The history varies
 * whether an older full result was already applied; that distinction rejects
 * a gate based only on previous ownership. A prior direct write causes the
 * result handler to wait for Query's physical-success notification, making
 * this legal interleaving deterministic with a real QueryClient.
 */
async function expectFullSourceReuseWaitsForApplication(
  previousFullResult: boolean,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `full-source-application-${collectionSequence++}`
  const fullRows: Array<Row> = [
    { id: `a2`, group: `a` },
    { id: `b1`, group: `b` },
  ]
  const filter = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`a`),
  ])
  const filteredDemand: LoadSubsetOptions = { where: filter }
  const response = createDeferred<Array<Row>>()
  const requests: Array<`full` | `filtered`> = []
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: (context) => {
        if (context.meta?.loadSubsetOptions?.where === undefined) {
          requests.push(`full`)
          if (previousFullResult && requests.length === 1)
            return Promise.resolve([
              { id: `a1`, group: `a` },
              { id: `b1`, group: `b` },
            ] satisfies Array<Row>)
          return response.promise
        }
        requests.push(`filtered`)
        return Promise.resolve(fullRows.filter((row) => row.group === `a`))
      },
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  let observed:
    | {
        acquisition: true | Promise<void>
        rowApplied: boolean
      }
    | undefined
  let unsubscribe = () => {}
  let fullAcquisition: true | Promise<void> | undefined
  let revalidation: Promise<void> | undefined
  try {
    if (previousFullResult) {
      fullAcquisition = collection._sync.loadSubset({})
      if (fullAcquisition !== true) await fullAcquisition
      expect(collection.has(`a1`)).toBe(true)
      await collection.utils.writeUpdate({ id: `b1`, group: `b` })
    } else {
      await collection.utils.writeUpsert({ id: `local`, group: `b` })
    }
    unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === `updated` &&
        event.action.type === `success` &&
        !event.action.manual &&
        event.query.queryHash === JSON.stringify([id])
      ) {
        observed = {
          acquisition: collection._sync.loadSubset(filteredDemand),
          rowApplied: collection.has(`a2`),
        }
      }
    })
    if (previousFullResult) {
      revalidation = queryClient.invalidateQueries({
        queryKey: [id],
        exact: true,
      })
    } else {
      fullAcquisition = collection._sync.loadSubset({})
    }
    await vi.waitFor(() =>
      expect(requests.filter((request) => request === `full`).length).toBe(
        previousFullResult ? 2 : 1,
      ),
    )
    response.resolve(fullRows)
    await vi.waitFor(() => expect(observed).toBeDefined())
    expect(observed?.rowApplied).toBe(false)
    expect(observed?.acquisition).not.toBe(true)
    if (observed?.acquisition !== true) await observed?.acquisition
    if (fullAcquisition !== true) await fullAcquisition
    await revalidation
    expect(collection.has(`a2`)).toBe(true)
  } finally {
    response.resolve(fullRows)
    unsubscribe()
    collection._sync.unloadSubset(filteredDemand)
    collection._sync.unloadSubset({})
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * An accepted direct write changes the Collection's full-source rows. The
 * independent reference changes only that row, then filters the resulting
 * two rows. A later filtered acquisition may reuse those rows or fetch its
 * exact scope once; it must not cause a redundant full-source request. The
 * observation is provider scope and public rows after filtered preload, with
 * the full view still owning its Query. This bounded witness does not promise
 * that every newly acquired on-demand scope avoids provider work.
 */
async function expectFilteredDemandAfterDirectWriteAvoidsRedundantFetch(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `direct-write-full-source-${collectionSequence++}`
  const requests: Array<`full` | `filtered`> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const scope =
      context.meta?.loadSubsetOptions?.where === undefined ? `full` : `filtered`
    requests.push(scope)
    const rows: Array<Row> = [
      { id: `a1`, group: `a` },
      { id: `b1`, group: `b` },
    ]
    return Promise.resolve(
      scope === `full` ? rows : rows.filter((row) => row.group === `b`),
    )
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const full = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const filtered = createLiveQueryCollection((query) =>
    query
      .from({ row: collection })
      .where(({ row }) => eq(row.group, `b`))
      .select(({ row }) => ({ id: row.id })),
  )
  try {
    await full.preload()
    expect(requests).toEqual([`full`])
    const fullQuery = queryClient.getQueryCache().find({
      queryKey: [id],
      exact: true,
    })!
    await collection.utils.writeUpdate({ id: `a1`, group: `b` })
    expect(
      (fullQuery.state.data as Array<Row>).find((row) => row.id === `a1`)
        ?.group,
    ).toBe(`b`)
    await filtered.preload()
    // Either source reuse or one exact-scope request satisfies this law.
    expect([[`full`], [`full`, `filtered`]]).toContainEqual(requests)
    expect(filtered.toArray.map(({ id: rowId }) => rowId).sort()).toEqual([
      `a1`,
      `b1`,
    ])
  } finally {
    await full.cleanup()
    await filtered.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * A narrower lease can outlive the full view, but it is still the final owner
 * of that Query. Releasing it during a held revalidation must abort the Query
 * fetch and retire the old rows. Late provider settlement cannot republish.
 */
async function expectFinalFullSourceDependentCancelsFetch(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `full-source-final-dependent-${collectionSequence++}`
  let resolveHeldFetch: ((rows: Array<Row>) => void) | undefined
  let heldSignal: AbortSignal | undefined
  let requests = 0
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    requests++
    if (requests === 1) {
      return Promise.resolve([
        { id: `a1`, group: `a` },
        { id: `b1`, group: `b` },
      ])
    }
    heldSignal = context.meta?.loadSubsetOptions?.signal
    expect(heldSignal).toBe(context.signal)
    return new Promise<Array<Row>>((resolve) => {
      resolveHeldFetch = resolve
    })
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const full = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const filtered = createLiveQueryCollection((query) =>
    query
      .from({ row: collection })
      .where(({ row }) => eq(row.group, `a`))
      .select(({ row }) => ({ id: row.id })),
  )
  try {
    await full.preload()
    await filtered.preload()
    expect(requests).toBe(1)
    await full.cleanup()
    const invalidation = queryClient.invalidateQueries({
      queryKey: [id],
      exact: true,
    })
    await vi.waitFor(() => expect(resolveHeldFetch).toBeDefined())
    expect(heldSignal?.aborted).toBe(false)
    await filtered.cleanup()
    expect(heldSignal?.aborted).toBe(true)
    expect(collection.size).toBe(0)
    resolveHeldFetch?.([{ id: `late`, group: `a` }])
    await invalidation
    expect(collection.size).toBe(0)
    expect(collection.has(`late`)).toBe(false)
  } finally {
    resolveHeldFetch?.([])
    await full.cleanup()
    await filtered.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * The Query Collection cancellation contract says an on-demand unload only
 * removes its observer. Query Core may let a request finish when the provider
 * ignores its signal. The model keeps the in-flight Query transport alive
 * after both logical owners release and expects its settled data in Query's
 * cache. Full-source/subset and equal filtered owners cross the distinct
 * sharing branches. This checks signal-consumption semantics at the real
 * QueryClient boundary; Collection rows need not survive their final owner.
 */
async function expectIgnoredSignalLetsSharedFetchFinish(
  scope: `full-source` | `equal-filtered`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `ignored-${scope}-signal-${collectionSequence++}`
  const response = createDeferred<Array<Row>>()
  const initial: Array<Row> = [{ id: `a1`, group: `a` }]
  const replacement: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `a2`, group: `a` },
  ]
  let requests = 0
  // This provider never reads either the Query or request metadata signal.
  const queryFn = vi.fn(() => {
    requests++
    return requests === 1 ? Promise.resolve(initial) : response.promise
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const filter = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`a`),
  ])
  const filteredDemand: LoadSubsetOptions = { where: filter }
  const firstDemand: LoadSubsetOptions =
    scope === `full-source` ? {} : { where: filter }
  let invalidation: Promise<void> | undefined
  try {
    await collection._sync.loadSubset(firstDemand)
    await collection._sync.loadSubset(filteredDemand)
    expect(requests).toBe(1)
    const ownedQueries = queryClient.getQueryCache().findAll({ queryKey: [id] })
    expect(ownedQueries).toHaveLength(1)
    const sharedKey = ownedQueries[0]!.queryKey
    invalidation = queryClient.invalidateQueries({
      queryKey: [id],
    })
    await vi.waitFor(() => expect(requests).toBe(2))
    collection._sync.unloadSubset(firstDemand)
    collection._sync.unloadSubset(filteredDemand)
    response.resolve(replacement)
    await invalidation
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(sharedKey)).toEqual(replacement),
    )
    expect(collection.size).toBe(0)
  } finally {
    response.resolve(replacement)
    await invalidation?.catch(() => undefined)
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * A late peer can keep a physical Query alive after the first provider rejects
 * on its acquisition signal. The replacement provider ignores all signals.
 * Once the peer releases, Query Core may still finish that provider into its
 * cache because no provider consumed the replacement transport signal. The
 * model checks cached rows after the held replacement settles and expects no
 * Collection rows after final release. This rejects a recovery guard that
 * reads Query Core's lazy signal only to check whether it is aborted.
 */
async function expectRecoveredIgnoredSignalFetchFinishes(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `recovered-ignored-signal-${collectionSequence++}`
  const firstController = new AbortController()
  const peerController = new AbortController()
  const filter = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`a`),
  ])
  const firstDemand: LoadSubsetOptions = {
    where: filter,
    signal: firstController.signal,
  }
  const peerDemand: LoadSubsetOptions = {
    where: filter,
    signal: peerController.signal,
  }
  const firstResponse = createDeferred<Array<Row>>()
  const replacementResponse = createDeferred<Array<Row>>()
  const rows: Array<Row> = [{ id: `a1`, group: `a` }]
  let calls = 0
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    calls++
    if (calls > 1) return replacementResponse.promise
    const requestSignal = context.meta?.loadSubsetOptions?.signal
    requestSignal?.addEventListener(
      `abort`,
      () => firstResponse.reject(requestSignal.reason),
      { once: true },
    )
    return firstResponse.promise
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
      retry: false,
    }),
  )
  let firstLoad: true | Promise<void> | undefined
  let peerLoad: true | Promise<void> | undefined
  try {
    firstLoad = collection._sync.loadSubset(firstDemand)
    void Promise.resolve(firstLoad).catch(() => undefined)
    await vi.waitFor(() => expect(calls).toBe(1))
    const sharedKey = queryClient
      .getQueryCache()
      .find({ queryKey: [id], exact: false })?.queryKey
    expect(sharedKey).toBeDefined()
    peerLoad = collection._sync.loadSubset(peerDemand)
    void Promise.resolve(peerLoad).catch(() => undefined)
    firstController.abort()
    collection._sync.unloadSubset(firstDemand)
    await vi.waitFor(() => expect(calls).toBe(2))
    peerController.abort()
    collection._sync.unloadSubset(peerDemand)
    replacementResponse.resolve(rows)
    await Promise.allSettled([
      Promise.resolve(firstLoad),
      Promise.resolve(peerLoad),
    ])
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(sharedKey!)).toEqual(rows),
    )
    expect(collection.size).toBe(0)
  } finally {
    firstResponse.resolve(rows)
    replacementResponse.resolve(rows)
    await Promise.allSettled([
      Promise.resolve(firstLoad),
      Promise.resolve(peerLoad),
    ])
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * Two equal live queries share one Query transport but own separate acquisition
 * signals. After the first owner releases, its signal is stale. The remaining
 * owner may still invalidate and receive a new snapshot. This history crosses
 * both full and filtered Query keys; the latter cannot rely on the full-source
 * dependent map. The provider reads the documented request metadata signal
 * and rejects an already-aborted signal. The public checkpoint is the peer's
 * new row after invalidation, not a particular signal object identity.
 */
async function expectEqualQueryPeerGetsLiveSignal(
  scope: `full` | `filtered`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `equal-${scope}-signal-${collectionSequence++}`
  let rows: Array<Row> = [{ id: `a1`, group: `a` }]
  let firstSignal: AbortSignal | undefined
  const observedScopes: Array<boolean> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const requestSignal = context.meta?.loadSubsetOptions?.signal
    firstSignal ??= requestSignal
    observedScopes.push(context.meta?.loadSubsetOptions?.where !== undefined)
    requestSignal?.throwIfAborted()
    return Promise.resolve(rows)
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const makeView = () =>
    scope === `full`
      ? createLiveQueryCollection((query) =>
          query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
        )
      : createLiveQueryCollection((query) =>
          query
            .from({ row: collection })
            .where(({ row }) => eq(row.group, `a`))
            .select(({ row }) => ({ id: row.id })),
        )
  const first = makeView()
  const peer = makeView()
  try {
    await first.preload()
    await peer.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    await first.cleanup()
    expect(firstSignal?.aborted).toBe(true)
    rows = [
      { id: `a1`, group: `a` },
      { id: `a2`, group: `a` },
    ]
    await queryClient.invalidateQueries({ queryKey: [id] })
    await vi.waitFor(() => expect(peer.has(`a2`)).toBe(true))
    expect(observedScopes.length).toBeGreaterThan(1)
    expect(
      observedScopes.every(
        (isFiltered) => isFiltered === (scope === `filtered`),
      ),
    ).toBe(true)
  } finally {
    await first.cleanup()
    await peer.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * A second equal filtered owner can already exist when invalidation starts a
 * new provider request. If the first owner releases during that request, its
 * acquisition signal aborts, but the physical Query remains owned. The model
 * keeps the pending provider result and adds `a2` after it resolves. The
 * provider listens to the metadata signal, so this checkpoint distinguishes
 * a request-scoped signal captured at fetch start from the live Query signal.
 * It does not cover a peer that joins only after the fetch starts.
 */
async function expectEqualFilteredPeerKeepsInFlightSignal(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `equal-filtered-in-flight-${collectionSequence++}`
  const response = createDeferred<Array<Row>>()
  const replacement: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `a2`, group: `a` },
  ]
  let requestSignal: AbortSignal | undefined
  let transportSignal: AbortSignal | undefined
  let calls = 0
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    calls++
    if (calls === 1) return Promise.resolve([{ id: `a1`, group: `a` }])
    requestSignal = context.meta?.loadSubsetOptions?.signal
    transportSignal = context.signal
    requestSignal?.throwIfAborted()
    requestSignal?.addEventListener(
      `abort`,
      () => response.reject(requestSignal?.reason),
      { once: true },
    )
    return response.promise
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
    }),
  )
  const makeView = () =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: collection })
        .where(({ row }) => eq(row.group, `a`))
        .select(({ row }) => ({ id: row.id })),
    )
  const first = makeView()
  const peer = makeView()
  let invalidation: Promise<void> | undefined
  try {
    await first.preload()
    await peer.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    invalidation = queryClient.invalidateQueries({ queryKey: [id] })
    await vi.waitFor(() => expect(calls).toBe(2))
    await first.cleanup()
    expect({
      requestAborted: requestSignal?.aborted,
      transportAborted: transportSignal?.aborted,
    }).toEqual({ requestAborted: false, transportAborted: false })
    response.resolve(replacement)
    await invalidation
    await vi.waitFor(() => expect(peer.has(`a2`)).toBe(true))
  } finally {
    response.resolve(replacement)
    await invalidation?.catch(() => undefined)
    await first.cleanup()
    await peer.cleanup()
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * A peer may acquire an equal demand after a sole-owner fetch has started,
 * during either the initial load or a later refetch.
 * The provider already holds the first acquisition's exact signal, which
 * aborts when that owner releases. With a peer, the physical Query remains
 * live and its current source result must reach the peer; with no peer, release
 * must not start another provider request. This controlled provider rejects
 * with its signal's AbortError, then returns the current rows if retried.
 * Compare provider calls, peer settlement, and public rows after the held
 * request ends. A custom reason and a fresh AbortError caused by the signal
 * must have the same result. An ordinary unrelated provider error after
 * signal abort must not be retried; the no-peer history also rejects an
 * unconditional retry design. A fresh unrelated AbortError after the same
 * signal abort is indistinguishable without provider provenance and may get
 * one retry.
 */
async function expectPeerJoiningHeldFetchRecovers(
  phase: `initial` | `refetch`,
  peerJoins: boolean,
  failure: `signal` | `custom-signal` | `fresh-abort` | `unrelated` = `signal`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `join-held-filtered-${phase}-${peerJoins}-${collectionSequence++}`
  const firstSignal = new AbortController()
  const peerSignal = new AbortController()
  const filter = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`a`),
  ])
  const firstDemand: LoadSubsetOptions = {
    where: filter,
    signal: firstSignal.signal,
  }
  const peerDemand: LoadSubsetOptions = {
    where: filter,
    signal: peerSignal.signal,
  }
  const replacement: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `a2`, group: `a` },
  ]
  const held = createDeferred<Array<Row>>()
  const unrelatedError = new Error(`server failed independently`)
  let heldStarted = false
  let requestSignal: AbortSignal | undefined
  let transportSignal: AbortSignal | undefined
  let calls = 0
  const heldCall = phase === `initial` ? 1 : 2
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    calls++
    if (calls < heldCall) return Promise.resolve([{ id: `a1`, group: `a` }])
    if (calls > heldCall) return Promise.resolve(replacement)
    heldStarted = true
    requestSignal = context.meta?.loadSubsetOptions?.signal
    transportSignal = context.signal
    if (failure !== `unrelated`)
      requestSignal?.addEventListener(
        `abort`,
        () =>
          held.reject(
            failure === `fresh-abort`
              ? new DOMException(`provider aborted`, `AbortError`)
              : requestSignal?.reason,
          ),
        { once: true },
      )
    return held.promise
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      staleTime: 5 * 60 * 1000,
      retry: false,
    }),
  )
  let invalidation: Promise<void> | undefined
  let firstLoad: true | Promise<void> | undefined
  let peerLoad: true | Promise<void> | undefined
  let firstReleased = false
  try {
    firstLoad = collection._sync.loadSubset(firstDemand)
    void Promise.resolve(firstLoad).catch(() => undefined)
    if (phase === `refetch`) {
      await firstLoad
      invalidation = queryClient.invalidateQueries({ queryKey: [id] })
    }
    await vi.waitFor(() => expect(heldStarted).toBe(true))
    if (peerJoins) {
      peerLoad = collection._sync.loadSubset(peerDemand)
      void Promise.resolve(peerLoad).catch(() => undefined)
    }
    firstSignal.abort(
      failure === `custom-signal`
        ? new Error(`custom cancellation`)
        : undefined,
    )
    collection._sync.unloadSubset(firstDemand)
    firstReleased = true
    const signalState = {
      requestAborted: requestSignal?.aborted,
      transportAborted: transportSignal?.aborted,
    }
    if (failure === `unrelated`) held.reject(unrelatedError)
    else held.resolve(replacement)
    await invalidation
    const peerOutcome = peerJoins
      ? await Promise.resolve(peerLoad).then(
          () => `fulfilled`,
          () => `rejected`,
        )
      : `not-started`
    const expectNewRow = peerJoins && failure !== `unrelated`
    if (expectNewRow) {
      await vi.waitFor(() => expect(collection.has(`a2`)).toBe(true))
    }
    expect({
      ...signalState,
      hasNew: collection.has(`a2`),
    }).toEqual({
      requestAborted: true,
      transportAborted: !peerJoins,
      hasNew: expectNewRow,
    })
    if (expectNewRow) expect(peerOutcome).toBe(`fulfilled`)
    if (!peerJoins) expect(peerOutcome).toBe(`not-started`)
    if (failure === `unrelated`) {
      expect(collection.utils.lastError).toBe(unrelatedError)
      expect(peerOutcome).toBe(phase === `initial` ? `rejected` : `fulfilled`)
    }
    if (!peerJoins || failure === `unrelated`) expect(calls).toBe(heldCall)
  } finally {
    held.resolve(replacement)
    await invalidation?.catch(() => undefined)
    await Promise.resolve(firstLoad).catch(() => undefined)
    await Promise.resolve(peerLoad).catch(() => undefined)
    if (!firstReleased) {
      firstSignal.abort()
      collection._sync.unloadSubset(firstDemand)
    }
    if (peerLoad !== undefined) {
      peerSignal.abort()
      collection._sync.unloadSubset(peerDemand)
    }
    await collection.cleanup()
    queryClient.clear()
  }
}

/**
 * Query Core may run a shared Query using the queryFn installed by another
 * Collection's observer. The model has one full snapshot and one remaining
 * filtered owner, regardless of which Collection's queryFn handles the later
 * fetch. The foreign full acquisition has released its request signal. With
 * both providers returning the same rows, the filtered owner's public view
 * must receive the new row after invalidation. The provider log confirms the
 * foreign closure was the actual production path at this checkpoint.
 */
async function expectForeignQueryFnUsesLiveSharedSignal(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `foreign-full-signal-${collectionSequence++}`
  let rows: Array<Row> = [{ id: `a1`, group: `a` }]
  const providerCalls: Array<{ owner: `A` | `B`; aborted: boolean }> = []
  const createSource = (owner: `A` | `B`) =>
    createCollection(
      queryCollectionOptions<Row>({
        id: `${id}-${owner}`,
        queryClient,
        queryKey: [id],
        queryFn: (context) => {
          const signal = context.meta?.loadSubsetOptions?.signal
          providerCalls.push({ owner, aborted: signal?.aborted ?? false })
          signal?.throwIfAborted()
          return Promise.resolve(rows)
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        staleTime: 5 * 60 * 1000,
      }),
    )
  const sourceA = createSource(`A`)
  const fullA = createLiveQueryCollection((query) =>
    query.from({ row: sourceA }).select(({ row }) => ({ id: row.id })),
  )
  const filteredA = createLiveQueryCollection((query) =>
    query
      .from({ row: sourceA })
      .where(({ row }) => eq(row.group, `a`))
      .select(({ row }) => ({ id: row.id })),
  )
  let sourceB: ReturnType<typeof createSource> | undefined
  let fullB: ReturnType<typeof createLiveQueryCollection> | undefined
  try {
    await fullA.preload()
    await filteredA.preload()
    sourceB = createSource(`B`)
    fullB = createLiveQueryCollection((query) =>
      query.from({ row: sourceB! }).select(({ row }) => ({ id: row.id })),
    )
    await fullB.preload()
    await fullA.cleanup()
    await fullB.cleanup()
    rows = [
      { id: `a1`, group: `a` },
      { id: `a2`, group: `a` },
    ]
    await queryClient.invalidateQueries({ queryKey: [id], exact: true })
    expect(providerCalls.at(-1)).toEqual({ owner: `B`, aborted: false })
    await vi.waitFor(() => expect(filteredA.has(`a2`)).toBe(true))
  } finally {
    await fullA.cleanup()
    await filteredA.cleanup()
    await fullB?.cleanup()
    await sourceA.cleanup()
    await sourceB?.cleanup()
    queryClient.clear()
  }
}

/**
 * Two Collections can observe the same physical Query. Query Core runs the
 * queryFn last installed by B while A still owns the Query. B then releases
 * during the fetch. The independent ownership rule keeps the transport alive
 * for A, so its public rows must include the held result. The provider listens
 * to metadata signal and the driver records Query's transport signal; this
 * distinguishes physical observer sharing from one Collection's refcount.
 */
async function expectForeignOwnerReleaseKeepsInFlightSignal(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `foreign-in-flight-signal-${collectionSequence++}`
  const firstSignal = new AbortController()
  const secondSignal = new AbortController()
  const initial: Array<Row> = [{ id: `a1`, group: `a` }]
  const replacement: Array<Row> = [
    { id: `a1`, group: `a` },
    { id: `a2`, group: `a` },
  ]
  const response = createDeferred<Array<Row>>()
  const providerCalls: Array<`A` | `B`> = []
  let requestSignal: AbortSignal | undefined
  let transportSignal: AbortSignal | undefined
  const makeSource = (owner: `A` | `B`) =>
    createCollection(
      queryCollectionOptions<Row>({
        id: `${id}-${owner}`,
        queryClient,
        queryKey: [id],
        queryFn: (context) => {
          providerCalls.push(owner)
          if (owner === `A`) return Promise.resolve(initial)
          requestSignal = context.meta?.loadSubsetOptions?.signal
          transportSignal = context.signal
          requestSignal?.throwIfAborted()
          requestSignal?.addEventListener(
            `abort`,
            () => response.reject(requestSignal?.reason),
            { once: true },
          )
          return response.promise
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        staleTime: 5 * 60 * 1000,
      }),
    )
  const sourceA = makeSource(`A`)
  let sourceB: ReturnType<typeof makeSource> | undefined
  let invalidation: Promise<void> | undefined
  let releasedB = false
  try {
    await sourceA._sync.loadSubset({ signal: firstSignal.signal })
    sourceB = makeSource(`B`)
    await sourceB._sync.loadSubset({ signal: secondSignal.signal })
    invalidation = queryClient.invalidateQueries({
      queryKey: [id],
      exact: true,
    })
    await vi.waitFor(() => expect(providerCalls.at(-1)).toBe(`B`))
    secondSignal.abort()
    sourceB._sync.unloadSubset({ signal: secondSignal.signal })
    releasedB = true
    expect({
      requestAborted: requestSignal?.aborted,
      transportAborted: transportSignal?.aborted,
    }).toEqual({ requestAborted: false, transportAborted: false })
    response.resolve(replacement)
    await invalidation
    await vi.waitFor(() => expect(sourceA.has(`a2`)).toBe(true))
  } finally {
    response.resolve(replacement)
    await invalidation?.catch(() => undefined)
    if (sourceB && !releasedB) {
      secondSignal.abort()
      sourceB._sync.unloadSubset({ signal: secondSignal.signal })
    }
    firstSignal.abort()
    sourceA._sync.unloadSubset({ signal: firstSignal.signal })
    await sourceA.cleanup()
    await sourceB?.cleanup()
    queryClient.clear()
  }
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
  // Internal ordering seam: this deliberately reuses old sync controls and
  // observers. It does not establish a public cleanup/restart path; real
  // cleanup clears those observers before a new sync run starts.
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
  const scanPersistedRows = vi.fn(async () => {
    await scanReleased
    return []
  })
  const metadata: SyncMetadataApi<string | number> = {
    row: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
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
    persistence: {
      protocol: `@tanstack/db/sync-persistence`,
      version: 1,
      hydrateBaseline: async () => {},
      reserveCommitTurn: () => {},
      scanPersistedRows,
      resumeSnapshot: {
        certify: async () => {},
        getKeySetEvidence: () => ({ status: `consistent` }),
        expectCurrentCommit: () => {},
      },
    },
  }

  collection._lifecycle.setStatus(`cleaned-up`)
  collection._lifecycle.setStatus(`loading`)
  const secondSync = originalSync.sync({ ...syncParams, metadata })

  try {
    expect(collection.status).toBe(`error`)
    await vi.waitFor(() => expect(scanPersistedRows).toHaveBeenCalledOnce())
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
  form: `commutative-and` | `commutative-or` | `reversed-equality`,
): Promise<void> {
  const { queryClient, collection, queryFn } = createOnDemandCollection(
    `load-subset-canonical-predicate`,
    [{ id: `a`, group: `x` }],
  )
  const firstComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`id`]),
    new IR.Value(`a`),
  ])
  const secondComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`x`),
  ])
  let first: IR.BasicExpression<boolean>
  let second: IR.BasicExpression<boolean>
  switch (form) {
    case `commutative-and`:
      first = new IR.Func(`and`, [firstComparison, secondComparison])
      second = new IR.Func(`and`, [secondComparison, firstComparison])
      break
    case `commutative-or`:
      first = new IR.Func(`or`, [firstComparison, secondComparison])
      second = new IR.Func(`or`, [secondComparison, firstComparison])
      break
    case `reversed-equality`:
      first = firstComparison
      second = new IR.Func(`eq`, [new IR.Value(`a`), new IR.PropRef([`id`])])
      break
  }

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

async function expectEquivalentComparisonValuesShareOneLoad(
  firstValue: unknown,
  secondValue: unknown,
): Promise<void> {
  const { queryClient, collection, queryFn } = createOnDemandCollection(
    `load-subset-comparison-value`,
    [{ id: `a` }],
  )
  const value = new IR.PropRef([`value`])

  try {
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(firstValue)]),
    })
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(secondValue)]),
    })
    expect(queryFn).toHaveBeenCalledOnce()
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

function createOnDemandCollection(idPrefix: string, rows: Array<Row>) {
  const queryClient = createQueryClient()
  const id = `${idPrefix}-${collectionSequence++}`
  const queryFn = vi.fn().mockResolvedValue(rows)
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
  return { queryClient, collection, queryFn }
}

async function expectRefetchRevalidatesExistingDemand(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-existing-${collectionSequence++}`
  let rows: Array<Row> = [{ id: `initial` }]
  const queryKeyInputs: Array<LoadSubsetOptions> = []
  const queryFnInputs: Array<LoadSubsetOptions> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    queryFnInputs.push(context.meta?.loadSubsetOptions ?? {})
    return Promise.resolve(rows.map((row) => ({ ...row })))
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: (options) => {
        queryKeyInputs.push(options)
        return [id, getLoadSubsetDemandKey(options)]
      },
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )

  try {
    await collection._sync.loadSubset({})
    expect(collection.has(`initial`)).toBe(true)

    rows = [{ id: `refetched` }]
    await collection._sync.loadSubset({ refetch: true })

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.has(`initial`)).toBe(false)
    expect(collection.has(`refetched`)).toBe(true)
    expect(
      queryKeyInputs.every(
        (options) => !Object.prototype.hasOwnProperty.call(options, `refetch`),
      ),
    ).toBe(true)
    expect(
      queryFnInputs.every(
        (options) => !Object.prototype.hasOwnProperty.call(options, `refetch`),
      ),
    ).toBe(true)
    expect(
      queryClient.getQueryCache().findAll({ queryKey: [id] }),
    ).toHaveLength(1)
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectRefetchRevalidatesCachedDemand(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-cached-${collectionSequence++}`
  const queryKey = [id]
  queryClient.setQueryData(queryKey, [{ id: `cached` } satisfies Row])
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    expect(
      Object.prototype.hasOwnProperty.call(
        context.meta?.loadSubsetOptions ?? {},
        `refetch`,
      ),
    ).toBe(false)
    return Promise.resolve([{ id: `fresh` } satisfies Row])
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )

  try {
    await collection._sync.loadSubset({ refetch: true })
    expect(queryFn).toHaveBeenCalledOnce()
    expect(collection.has(`cached`)).toBe(false)
    expect(collection.has(`fresh`)).toBe(true)
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectDeferredRefetchWaitsForApplication(
  demand: `existing` | `cached`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-deferred-refetch-${demand}-${collectionSequence++}`
  const queryKey = [id]
  let rows: Array<Row> = [{ id: `old` }]
  if (demand === `cached`) queryClient.setQueryData(queryKey, rows)
  const queryFn = vi.fn(() => Promise.resolve(structuredClone(rows)))
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const barrier = createDeferred<void>()
  let refetch: Promise<void> | undefined

  try {
    if (demand === `existing`) {
      await collection._sync.loadSubset({})
      expect(collection.has(`old`)).toBe(true)
    }

    collection.deferDataRefresh = barrier.promise
    rows = [{ id: `fresh` }]
    const result = collection._sync.loadSubset({ refetch: true })
    expect(result).not.toBe(true)
    refetch = result as Promise<void>
    let fulfilled = false
    void refetch.then(() => {
      fulfilled = true
    })

    const callsBeforeBarrier = demand === `existing` ? 2 : 1
    await vi.waitFor(() =>
      expect(queryFn).toHaveBeenCalledTimes(callsBeforeBarrier),
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(fulfilled).toBe(false)
    expect(collection.has(`fresh`)).toBe(false)

    collection.deferDataRefresh = null
    barrier.resolve()
    await refetch
    await vi.waitFor(() => expect(collection.has(`fresh`)).toBe(true))
  } finally {
    collection.deferDataRefresh = null
    barrier.resolve()
    await refetch?.catch(() => undefined)
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectRefetchWaitsForPostWriteAuthority(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-authority-${collectionSequence++}`
  const initialResult = createDeferred<Array<Row>>()
  const authoritativeResult = createDeferred<Array<Row>>()
  const initialStarted = createDeferred<void>()
  let calls = 0
  const queryFn = vi.fn(() => {
    calls++
    if (calls === 1) {
      initialStarted.resolve()
      return initialResult.promise
    }
    return authoritativeResult.promise
  })
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
  let initialDemand: Promise<void> | undefined
  let refetchDemand: Promise<void> | undefined

  try {
    collection.utils.writeInsert({ id: `optimistic` })
    initialDemand = collection._sync.loadSubset({}) as Promise<void>
    await initialStarted.promise

    collection.utils.writeDelete(`optimistic`)
    refetchDemand = collection._sync.loadSubset({
      refetch: true,
    }) as Promise<void>
    let refetchFulfilled = false
    void refetchDemand.then(() => {
      refetchFulfilled = true
    })

    initialResult.resolve([{ id: `stale` }])
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(refetchFulfilled).toBe(false)
    expect(collection.has(`stale`)).toBe(false)

    authoritativeResult.resolve([{ id: `authoritative` }])
    await Promise.all([initialDemand, refetchDemand])
    expect(collection.has(`authoritative`)).toBe(true)
  } finally {
    initialResult.resolve([])
    authoritativeResult.resolve([])
    await Promise.allSettled([
      initialDemand ?? Promise.resolve(),
      refetchDemand ?? Promise.resolve(),
    ])
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectReleasedRefetchRejects(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-release-${collectionSequence++}`
  const queryKey = [id]
  queryClient.setQueryData(queryKey, [{ id: `cached` } satisfies Row])
  const started = createDeferred<void>()
  let signal: AbortSignal | undefined
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    signal = context.signal
    started.resolve()
    return new Promise<Array<Row>>((_resolve, reject) => {
      context.signal.addEventListener(
        `abort`,
        () => reject(new DOMException(`refetch released`, `AbortError`)),
        { once: true },
      )
    })
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey,
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const request: LoadSubsetOptions = { refetch: true }
  let refetch: Promise<void> | undefined

  try {
    refetch = collection._sync.loadSubset(request) as Promise<void>
    await started.promise
    expect(signal?.aborted).toBe(false)

    collection._sync.unloadSubset(request)

    expect(signal?.aborted).toBe(true)
    await expect(refetch).rejects.toMatchObject({ name: `AbortError` })
  } finally {
    await collection.cleanup()
    queryClient.clear()
    await refetch?.catch(() => undefined)
  }
}

type IdentityForm =
  | `commutative-and`
  | `commutative-or`
  | `reversed-equality`
  | `valid Date`
  | `invalid Date`

type IdentityRow = { id: string; group: string; value: Date }
type IdentityCheckpoint = {
  stage: string
  calls: number
  requests: Array<LoadSubsetOptions>
  rows: Array<IdentityRow>
}

function identityDemandFixture(form: IdentityForm) {
  const firstDate =
    form === `invalid Date`
      ? new Date(Number.NaN)
      : new Date(`2024-01-15T00:00:00Z`)
  const secondDate = new Date(`2024-01-16T00:00:00Z`)
  const rows: Array<IdentityRow> = [
    { id: `a`, group: `x`, value: firstDate },
    { id: `b`, group: `y`, value: secondDate },
  ]
  const comparison = (field: string, value: unknown, reversed = false) => {
    const operands = [new IR.PropRef([field]), new IR.Value(value)]
    return new IR.Func<boolean>(`eq`, reversed ? operands.reverse() : operands)
  }
  const predicate = (index: number, reversed = false) => {
    const row = rows[index]!
    if (form === `valid Date` || form === `invalid Date`) {
      return comparison(`value`, new Date(row.value.getTime()), reversed)
    }
    const id = comparison(`id`, row.id, reversed)
    if (form === `reversed-equality`) return id
    const group = comparison(`group`, row.group)
    const operands = reversed ? [group, id] : [id, group]
    return new IR.Func<boolean>(
      form === `commutative-and` ? `and` : `or`,
      operands,
    )
  }
  return {
    rows,
    first: { where: predicate(0) },
    equivalent: { where: predicate(0, true) },
    distinct: { where: predicate(1) },
  }
}

function validateIdentityRequest(options: LoadSubsetOptions): void {
  if (
    options.orderBy !== undefined ||
    options.limit !== undefined ||
    options.offset !== undefined ||
    options.cursor !== undefined
  ) {
    throw new Error(`Identity fixture does not support ordering or windows`)
  }
  const validate = (expression: IR.BasicExpression): void => {
    if (expression.type !== `func` || expression.args.length !== 2) {
      throw new Error(`Unsupported identity fixture predicate`)
    }
    if (expression.name === `and` || expression.name === `or`) {
      // Validation traverses both branches, even when evaluation short-circuits
      // or there are no provider rows to evaluate.
      expression.args.forEach(validate)
      return
    }
    if (expression.name !== `eq`) {
      throw new Error(`Unsupported identity fixture operator`)
    }
    const [left, right] = expression.args
    const ref = left?.type === `ref` ? left : right
    const constant = left?.type === `val` ? left : right
    if (
      ref?.type !== `ref` ||
      ref.path.length !== 1 ||
      constant?.type !== `val`
    ) {
      throw new Error(
        `Identity fixture equality requires one field and one constant`,
      )
    }
    const field = ref.path[0]
    if (
      ((field === `id` || field === `group`) &&
        typeof constant.value === `string`) ||
      (field === `value` && constant.value instanceof Date)
    )
      return
    throw new Error(`Unsupported identity fixture field or value`)
  }
  if (!options.where) throw new Error(`Identity fixture requires a predicate`)
  validate(options.where)
}

function selectIdentityRows(
  options: LoadSubsetOptions,
  rows: ReadonlyArray<IdentityRow>,
): Array<IdentityRow> {
  // This fixture accepts only eq/and/or over its three declared fields. It is
  // not a SQL server and does not use the production evaluator or demand key.
  validateIdentityRequest(options)
  const operand = (
    expression: IR.BasicExpression,
    row: IdentityRow,
  ): unknown => {
    if (expression.type === `val`) return expression.value
    if (expression.type === `ref` && expression.path.length === 1) {
      const field = expression.path[0]
      if (field === `id` || field === `group` || field === `value`) {
        return row[field]
      }
    }
    throw new Error(`Unsupported identity fixture operand`)
  }
  const matches = (
    expression: IR.BasicExpression,
    row: IdentityRow,
  ): boolean => {
    if (expression.type !== `func` || expression.args.length !== 2) {
      throw new Error(`Unsupported identity fixture predicate`)
    }
    const [left, right] = expression.args as [
      IR.BasicExpression,
      IR.BasicExpression,
    ]
    if (expression.name === `and`)
      return matches(left, row) && matches(right, row)
    if (expression.name === `or`)
      return matches(left, row) || matches(right, row)
    if (expression.name !== `eq`) {
      throw new Error(`Unsupported identity fixture operator`)
    }
    const a = operand(left, row)
    const b = operand(right, row)
    // The existing comparison contract treats invalid Dates as equal. Native
    // Object.is on timestamps gives this fixture that declared finite relation.
    return a instanceof Date && b instanceof Date
      ? Object.is(a.getTime(), b.getTime())
      : a === b
  }
  return rows
    .filter((row) => matches(options.where!, row))
    .map((row) => structuredClone(row))
}

async function observeDemandIdentity(
  form: IdentityForm,
  fault?: `constant key` | `wrong value`,
): Promise<Array<IdentityCheckpoint>> {
  const fixture = identityDemandFixture(form)
  const providerRows = structuredClone(fixture.rows)
  const queryClient = createQueryClient()
  const id = `distinct-demand-${collectionSequence++}`
  const requests: Array<LoadSubsetOptions> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const options = context.meta?.loadSubsetOptions ?? {}
    // Direct calls in this fixture supply only immutable request data, not a
    // signal/subscription. Capture the complete received request before checks.
    requests.push(structuredClone(options))
    const result = selectIdentityRows(options, providerRows)
    return Promise.resolve(
      fault === `wrong value`
        ? result.map((row) => ({ ...row, group: `wrong` }))
        : result,
    )
  })
  const collection = createCollection(
    queryCollectionOptions<IdentityRow>({
      id,
      queryClient,
      queryKey: fault === `constant key` ? () => [id] : [id],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    }),
  )
  const observations: Array<IdentityCheckpoint> = []
  const capture = (stage: string): void => {
    observations.push({
      stage,
      calls: queryFn.mock.calls.length,
      requests: structuredClone(requests),
      // Compare every provider field, excluding Collection's virtual metadata.
      rows: collection.toArray
        .map(({ id: rowId, group, value }) => ({
          id: rowId,
          group,
          value: new Date(value.getTime()),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
  }
  try {
    await collection._sync.loadSubset(fixture.first)
    capture(`first`)
    await collection._sync.loadSubset(fixture.equivalent)
    capture(`equivalent`)
    await collection._sync.loadSubset(fixture.distinct)
    capture(`distinct`)
    collection._sync.unloadSubset(fixture.first)
    capture(`one equivalent owner leaves`)
    collection._sync.unloadSubset(fixture.equivalent)
    capture(`final equivalent owner leaves`)
    collection._sync.unloadSubset(fixture.distinct)
    capture(`final distinct owner leaves`)
    return observations
  } finally {
    try {
      await collection.cleanup()
    } finally {
      queryClient.clear()
    }
  }
}

function expectDemandIdentity(
  observations: Array<IdentityCheckpoint>,
  form: IdentityForm,
): void {
  // Literal result sets are the authority; do not run the provider predicate
  // against expected data or derive expected membership from collection keys.
  const fixture = identityDemandFixture(form)
  const [first, second] = fixture.rows
  const initialRequests = [structuredClone(fixture.first)]
  const bothRequests = [...initialRequests, structuredClone(fixture.distinct)]
  expect(observations).toEqual([
    { stage: `first`, calls: 1, requests: initialRequests, rows: [first] },
    { stage: `equivalent`, calls: 1, requests: initialRequests, rows: [first] },
    {
      stage: `distinct`,
      calls: 2,
      requests: bothRequests,
      rows: [first, second],
    },
    {
      stage: `one equivalent owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [first, second],
    },
    {
      stage: `final equivalent owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [second],
    },
    {
      stage: `final distinct owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [],
    },
  ])
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

type SharedQueryCancellationSnapshot = {
  remainingAcquisitionLeases: 2 | 1 | 0
  queryCalls: number
  aborted: boolean
}

async function observeSharedInFlightQueryCancellation(): Promise<
  Array<SharedQueryCancellationSnapshot>
> {
  const queryClient = createQueryClient()
  const id = `load-subset-shared-cancellation-${collectionSequence++}`
  const started = createDeferred<void>()
  const providerResult = createDeferred<Array<Row>>()
  let signal: AbortSignal | undefined
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    signal = context.signal
    signal.addEventListener(
      `abort`,
      () => providerResult.reject(new DOMException(`released`, `AbortError`)),
      { once: true },
    )
    started.resolve()
    return providerResult.promise
  })
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
  const request: LoadSubsetOptions = {}
  const first = Promise.resolve(collection._sync.loadSubset(request))
  const second = Promise.resolve(collection._sync.loadSubset(request))
  // Observe rejections before the test releases either acquisition lease.
  void first.catch(() => undefined)
  void second.catch(() => undefined)
  const snapshots: Array<SharedQueryCancellationSnapshot> = []
  const capture = (remainingAcquisitionLeases: 2 | 1 | 0): void => {
    snapshots.push({
      remainingAcquisitionLeases,
      queryCalls: queryFn.mock.calls.length,
      aborted: signal?.aborted === true,
    })
  }

  try {
    await started.promise
    capture(2)
    collection._sync.unloadSubset(request)
    // Let Query process the first release while the provider remains held.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    capture(1)
    collection._sync.unloadSubset(request)
    capture(0)
    return snapshots
  } finally {
    providerResult.resolve([])
    try {
      await collection.cleanup()
    } finally {
      queryClient.clear()
      await Promise.allSettled([first, second])
    }
  }
}

function expectSharedInFlightQueryCancellation(
  snapshots: Array<SharedQueryCancellationSnapshot>,
): void {
  expect(snapshots).toEqual([
    { remainingAcquisitionLeases: 2, queryCalls: 1, aborted: false },
    { remainingAcquisitionLeases: 1, queryCalls: 1, aborted: false },
    { remainingAcquisitionLeases: 0, queryCalls: 1, aborted: true },
  ])
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

type RetiredOutcome =
  { status: `fulfilled` } | { status: `rejected`; error: unknown }
type ReplacementSnapshot = {
  source: Array<Row>
  live: Array<Row>
  sourceStatus: string
  liveStatus: string
  sourceError: unknown
}
type RetiredQueryObservation = {
  retired: RetiredOutcome
  retiredStatus: string
  aborted: boolean
  calls: number
  snapshots: Array<ReplacementSnapshot>
}

async function observeLateRetiredQuery(
  settlement: `resolve` | `reject`,
): Promise<RetiredQueryObservation> {
  const queryClient = createQueryClient()
  const id = `retired-query-completion-${collectionSequence++}`
  const old = createDeferred<Array<Row>>()
  const started = createDeferred<void>()
  let signal: AbortSignal | undefined
  const providerOutcome = old.promise.then(
    () => `resolved`,
    () => `rejected`,
  )
  const queryFn = vi
    .fn<(context: QueryFunctionContext) => Promise<Array<Row>>>()
    .mockImplementationOnce((context) => {
      // Consuming the signal lets Query cancel its retryer, even though this
      // simulated endpoint finishes its underlying promise later.
      signal = context.signal
      started.resolve()
      return old.promise
    })
    .mockResolvedValueOnce([{ id: `fresh`, group: `current` }])
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    }),
  )
  const buildLive = () =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, group: row.group })),
    )
  const first = buildLive()
  const firstOutcome = first.preload().then<RetiredOutcome, RetiredOutcome>(
    () => ({ status: `fulfilled` }),
    (error: unknown) => ({ status: `rejected`, error }),
  )
  let second: ReturnType<typeof buildLive> | undefined
  const unsubscribe: Array<() => void> = []
  try {
    await started.promise
    expect(signal?.aborted).toBe(false)
    await first.cleanup()
    const retired = await firstOutcome
    // This cut precedes both the replacement and old provider settlement.
    expect(retired).toMatchObject({
      status: `rejected`,
      error: { name: `AbortError` },
    })
    const retiredStatus = first.status
    second = buildLive()
    await second.preload()
    const current = second
    const snapshots: Array<ReplacementSnapshot> = []
    const capture = (): void => {
      const values = (rows: Array<Row>) =>
        rows
          .map(({ id: rowId, group }) => ({ id: rowId, group }))
          .sort((a, b) => a.id.localeCompare(b.id))
      snapshots.push({
        source: values(source.toArray),
        live: values(current.toArray),
        sourceStatus: source.status,
        liveStatus: current.status,
        sourceError: source.utils.lastError,
      })
    }
    const sourceSubscription = source.subscribeChanges(capture)
    const liveSubscription = current.subscribeChanges(capture)
    unsubscribe.push(
      () => sourceSubscription.unsubscribe(),
      () => liveSubscription.unsubscribe(),
    )
    capture()
    if (settlement === `resolve`)
      old.resolve([{ id: `obsolete`, group: `old` }])
    else old.reject(new Error(`retired endpoint failed`))
    expect(await providerOutcome).toBe(
      settlement === `resolve` ? `resolved` : `rejected`,
    )
    // One host turn drains this controlled Query/native-promise continuation;
    // it is not a network or scheduler fairness bound.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    capture()
    expect(await firstOutcome).toBe(retired)
    return {
      retired,
      retiredStatus,
      aborted: signal?.aborted === true,
      calls: queryFn.mock.calls.length,
      snapshots,
    }
  } finally {
    old.resolve([])
    unsubscribe.forEach((stop) => stop())
    try {
      await first.cleanup()
    } finally {
      try {
        await second?.cleanup()
      } finally {
        try {
          await source.cleanup()
        } finally {
          queryClient.clear()
        }
      }
    }
  }
}

function expectLateRetiredQuery(observation: RetiredQueryObservation): void {
  expect(observation.retired).toMatchObject({
    status: `rejected`,
    error: { name: `AbortError` },
  })
  expect(observation.retiredStatus).toBe(`cleaned-up`)
  expect(observation.aborted).toBe(true)
  expect(observation.calls).toBe(2)
  expect(observation.snapshots.length).toBeGreaterThanOrEqual(2)
  for (const snapshot of observation.snapshots) {
    expect(snapshot).toEqual({
      source: [{ id: `fresh`, group: `current` }],
      live: [{ id: `fresh`, group: `current` }],
      sourceStatus: `ready`,
      liveStatus: `ready`,
      sourceError: undefined,
    })
  }
}

describe(`loadSubset lifecycle oracle`, () => {
  it(`reuses an active complete full-source Query for a filtered demand`, async () => {
    await expectActiveFullSourceServesFilteredDemand()
  })

  it(`does not treat an unfinished full-source Query as filtered coverage`, async () => {
    await expectPendingFullSourceNeedsAppliedEvidence()
  })

  it.each([
    { previousFullResult: false, description: `initial full result` },
    { previousFullResult: true, description: `replacement full result` },
  ])(
    `waits for $description application before settling a filtered demand`,
    async ({ previousFullResult }) => {
      await expectFullSourceReuseWaitsForApplication(previousFullResult)
    },
  )

  it(`avoids redundant fetches for a filtered demand after a direct write`, async () => {
    await expectFilteredDemandAfterDirectWriteAvoidsRedundantFetch()
  })

  it(`cancels a shared full-source fetch after its final filtered owner releases`, async () => {
    await expectFinalFullSourceDependentCancelsFetch()
  })

  it.each([`full-source`, `equal-filtered`] as const)(
    `lets a shared %s fetch finish when the provider ignores its signal`,
    async (scope) => {
      await expectIgnoredSignalLetsSharedFetchFinish(scope)
    },
  )

  it(`lets an ignored-signal provider finish after late-peer recovery and final release`, async () => {
    await expectRecoveredIgnoredSignalFetchFinishes()
  })

  it.each([`full`, `filtered`] as const)(
    `keeps a live request signal for an equal %s peer`,
    async (scope) => {
      await expectEqualQueryPeerGetsLiveSignal(scope)
    },
  )

  it(`keeps a filtered peer's in-flight request alive after its first owner releases`, async () => {
    await expectEqualFilteredPeerKeepsInFlightSignal()
  })

  it.each([
    { phase: `initial`, peerJoins: true, failure: `signal` },
    { phase: `initial`, peerJoins: true, failure: `custom-signal` },
    { phase: `initial`, peerJoins: true, failure: `fresh-abort` },
    { phase: `initial`, peerJoins: true, failure: `unrelated` },
    { phase: `initial`, peerJoins: false, failure: `signal` },
    { phase: `refetch`, peerJoins: true, failure: `signal` },
    { phase: `refetch`, peerJoins: true, failure: `fresh-abort` },
    { phase: `refetch`, peerJoins: true, failure: `unrelated` },
    { phase: `refetch`, peerJoins: false, failure: `signal` },
  ] as const)(
    `settles a held $phase filtered fetch after its first owner releases, peer joins=$peerJoins, failure=$failure`,
    async ({ phase, peerJoins, failure }) => {
      await expectPeerJoiningHeldFetchRecovers(phase, peerJoins, failure)
    },
  )

  it(`keeps a live request signal through another Collection's query function`, async () => {
    await expectForeignQueryFnUsesLiveSharedSignal()
  })

  it(`keeps another Collection's in-flight request alive after its owner releases`, async () => {
    await expectForeignOwnerReleaseKeepsInFlightSignal()
  })

  it(`refetches an existing semantic demand without changing its query or unload identity`, async () => {
    await expectRefetchRevalidatesExistingDemand()
  })

  it(`refetches a newly observed cached demand before reporting it applied`, async () => {
    await expectRefetchRevalidatesCachedDemand()
  })

  it.each([
    { article: `an`, demand: `existing` },
    { article: `a`, demand: `cached` },
  ] as const)(
    `keeps a deferred refetch for $article $demand demand pending until its result applies`,
    async ({ demand }) => {
      await expectDeferredRefetchWaitsForApplication(demand)
    },
  )

  it(`keeps a subset refetch pending until a post-write fetch applies`, async () => {
    await expectRefetchWaitsForPostWriteAuthority()
  })

  it(`rejects a refetch after its final acquisition is released`, async () => {
    await expectReleasedRefetchRejects()
  })

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

  it(`does not let deferred startup readiness override a replayed error in the internal sync seam`, async () => {
    await expectDeferredStartupReadyDoesNotOverrideError()
  })

  it.each([`commutative-and`, `commutative-or`] as const)(
    `%s predicate forms share one query-db transport load`,
    async (form) => {
      await expectEquivalentPredicatesShareOneLoad(form)
    },
  )

  it(`reversed equality operands share one query-db transport load`, async () => {
    await expectEquivalentPredicatesShareOneLoad(`reversed-equality`)
  })

  it.each([
    [
      `valid Date`,
      new Date(`2024-01-15T00:00:00Z`),
      new Date(`2024-01-15T00:00:00Z`),
    ],
    [`invalid Date`, new Date(Number.NaN), new Date(Number.NaN)],
  ])(
    `shares one query-db transport load for equivalent %s values`,
    async (_label, firstValue, secondValue) => {
      await expectEquivalentComparisonValuesShareOneLoad(
        firstValue,
        secondValue,
      )
    },
  )

  const identityForms: Array<IdentityForm> = [
    `commutative-and`,
    `commutative-or`,
    `reversed-equality`,
    `valid Date`,
    `invalid Date`,
  ]
  it.each(identityForms)(
    `shares equivalent %s demands without collapsing distinct results or owners`,
    async (form) => {
      expectDemandIdentity(await observeDemandIdentity(form), form)
    },
  )

  it.each(identityForms)(
    `rejects a constant demand key despite valid %s sharing`,
    async (form) => {
      const observations = await observeDemandIdentity(form, `constant key`)
      expect(observations.slice(0, 2).map(({ calls }) => calls)).toEqual([1, 1])
      expect(() => expectDemandIdentity(observations, form)).toThrow()
    },
  )

  it(`rejects correct demand counts with wrong returned values`, async () => {
    const observations = await observeDemandIdentity(
      `commutative-and`,
      `wrong value`,
    )
    expect(observations.map(({ calls }) => calls)).toEqual([1, 1, 2, 2, 2, 2])
    expect(() =>
      expectDemandIdentity(observations, `commutative-and`),
    ).toThrow()
  })

  it.each([`or`, `and`, `empty`] as const)(
    `validates unvisited predicate branches for %s provider evaluation`,
    (form) => {
      const fixture = identityDemandFixture(`reversed-equality`)
      const where = new IR.Func<boolean>(form === `and` ? `and` : `or`, [
        new IR.Func(`eq`, [
          new IR.PropRef([`id`]),
          new IR.Value(form === `and` ? `absent` : `a`),
        ]),
        new IR.Func(`unsupported`, [new IR.Value(1), new IR.Value(2)]),
      ])
      expect(() =>
        selectIdentityRows(
          { where },
          form === `empty` ? [] : [fixture.rows[0]!],
        ),
      ).toThrow(`Unsupported identity fixture operator`)
      expect(selectIdentityRows(fixture.first, fixture.rows)).toEqual([
        fixture.rows[0],
      ])
    },
  )

  it.each([
    { limit: 0 },
    { offset: 0 },
    { orderBy: [] },
    {
      cursor: {
        whereFrom: new IR.Value(true),
        whereCurrent: new IR.Value(true),
      },
    },
  ] satisfies Array<LoadSubsetOptions>)(
    `rejects undeclared provider ordering/window requests: %j`,
    (extra) => {
      const fixture = identityDemandFixture(`reversed-equality`)
      expect(() =>
        selectIdentityRows({ ...fixture.first, ...extra }, fixture.rows),
      ).toThrow(`Identity fixture does not support ordering or windows`)
    },
  )

  it(`aborts an in-flight query when its final live-query owner cleans up`, async () => {
    await expectFinalOwnerCleanupAbortsQuery()
  })

  it(`keeps a shared in-flight query until its final acquisition is released`, async () => {
    const snapshots = await observeSharedInFlightQueryCancellation()
    expectSharedInFlightQueryCancellation(snapshots)
    // A premature abort after the first release is a nearby wrong boundary.
    expect(() =>
      expectSharedInFlightQueryCancellation(
        snapshots.map((snapshot) =>
          snapshot.remainingAcquisitionLeases === 1
            ? { ...snapshot, aborted: true }
            : snapshot,
        ),
      ),
    ).toThrow()
  })

  it(`starts a fresh query after an aborted owner immediately remounts`, async () => {
    await expectRemountAfterAbortStartsFreshQuery()
  })

  it.each([`resolve`, `reject`] as const)(
    `settles the retired caller before a late endpoint can %s against its replacement`,
    async (settlement) => {
      expectLateRetiredQuery(await observeLateRetiredQuery(settlement))
    },
  )

  it(`rejects lost caller cancellation and a stale replacement snapshot`, async () => {
    const observation = await observeLateRetiredQuery(`resolve`)
    expectLateRetiredQuery(observation)
    expect(() =>
      expectLateRetiredQuery({
        ...observation,
        retired: { status: `fulfilled` },
      }),
    ).toThrow()
    const snapshots = observation.snapshots.map((snapshot) => ({
      ...snapshot,
      source: [{ id: `obsolete`, group: `old` }],
    }))
    expect(() =>
      expectLateRetiredQuery({ ...observation, snapshots }),
    ).toThrow()
  })
})
