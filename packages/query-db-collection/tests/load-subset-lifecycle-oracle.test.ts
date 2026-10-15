import { QueryClient, onlineManager } from '@tanstack/query-core'
import fc from 'fast-check'
import {
  BasicIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { createDeferred } from '../../db/src/deferred.js'
import {
  oraclePropertyOptions,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
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
 * shared Query's fetch keeps a live signal while any Collection acquisition
 * owns it. Reading the Query signal eagerly would change the ignored-signal
 * behavior. A provider failure remains a failure of that physical fetch.
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
  return checkPublicCleanupWitness(async () => {
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
    expect(originalFullSignal?.aborted).toBe(false)
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
  }, [
    ['await full.cleanup()', () => full.cleanup()],
    ['await filtered.cleanup()', () => filtered.cleanup()],
    ['await filteredPeer.cleanup()', () => filteredPeer.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
}

/**
 * A failed full refresh supplies no current source coverage.
 * An earlier filtered demand may still own the full Query's last applied rows,
 * but a new filtered demand needs a new applied response. The independent
 * provider filters a changed source by the request it receives. The live-query
 * rows and request scope at preload settlement distinguish a fresh response
 * from joining an ineligible full Query or replaying its old rows. Both
 * acquisition release orders then check which physical Query owns each row.
 * An unload with options that never acquired anything must not release either
 * peer, even when its predicate and refetch flag match an active acquisition.
 */
async function expectIneligibleFullRefreshNeedsNewCoverage(
  hasPriorDependent: boolean,
  firstRelease: `old` | `new`,
  unmatchedRelease: boolean,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `failed-full-source-new-demand-${collectionSequence++}`
  const requests: Array<{
    scope: `full` | `filtered`
    key: ReadonlyArray<unknown>
  }> = []
  const failure = new Error(`full refresh failed`)
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: ({ queryKey, meta }) => {
        const where = meta?.loadSubsetOptions?.where
        if (where !== undefined) {
          // The provider's bounded reference rule reads the requested
          // predicate. A different filter must not get the same canned rows.
          expect(where.type).toBe(`func`)
          if (where.type !== `func`) throw new Error(`Expected a function`)
          expect(where.name).toBe(`eq`)
          expect(where.args).toHaveLength(2)
          expect(where.args[0]).toMatchObject({
            type: `ref`,
            path: [`group`],
          })
          expect(where.args[1]).toMatchObject({ type: `val`, value: `a` })
        }
        const scope = where === undefined ? `full` : `filtered`
        requests.push({ scope, key: queryKey })
        if (requests.length === 2) return Promise.reject(failure)
        const rows: Array<Row> =
          requests.length === 1
            ? [
                { id: `a1`, group: `a` },
                { id: `b1`, group: `b` },
              ]
            : [
                { id: `a1`, group: `a` },
                { id: `a2`, group: `a` },
                { id: `b1`, group: `b` },
                { id: `b2`, group: `b` },
              ]
        return Promise.resolve(
          scope === `full` ? rows : rows.filter((row) => row.group === `a`),
        )
      },
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
    }),
  )
  const makeFiltered = () =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: collection })
        .where(({ row }) => eq(row.group, `a`))
        .select(({ row }) => ({ id: row.id })),
    )
  const full = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const firstFiltered = hasPriorDependent ? makeFiltered() : undefined
  const nextFiltered = makeFiltered()
  return checkPublicCleanupWitness(async () => {
    await full.preload()
    await firstFiltered?.preload()
    expect(requests.map(({ scope }) => scope)).toEqual([`full`])

    const fullRefresh = queryClient.refetchQueries({
      queryKey: [id],
      exact: true,
    })
    await fullRefresh
    expect(requests.map(({ scope }) => scope)).toEqual([`full`, `full`])
    expect(full.toArray.map((row) => row.id).sort()).toEqual([`a1`, `b1`])

    await nextFiltered.preload()
    expect(requests.length).toBeGreaterThanOrEqual(3)
    for (const { scope, key } of requests.slice(2)) {
      expect(key).toEqual(scope === `full` ? [id] : [id, expect.anything()])
    }
    expect(nextFiltered.toArray.map((row) => row.id).sort()).toEqual([
      `a1`,
      `a2`,
    ])
    expect(collection.has(`b1`)).toBe(true)

    if (unmatchedRelease) {
      collection._sync.unloadSubset({
        where: new IR.Func<boolean>(`eq`, [
          new IR.PropRef([`group`]),
          new IR.Value(`a`),
        ]),
        refetch: true,
      })
      // An options object that acquired no lease cannot retire the exact
      // Query. Check before either legitimate owner releases its acquisition.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(nextFiltered.toArray.map((row) => row.id).sort()).toEqual([
        `a1`,
        `a2`,
      ])
      expect(collection.has(`a2`)).toBe(true)
      expect(full.toArray.map((row) => row.id).sort()).toEqual([
        `a1`,
        `a2`,
        `b1`,
      ])
      if (firstFiltered)
        expect(firstFiltered.toArray.map((row) => row.id).sort()).toEqual([
          `a1`,
          `a2`,
        ])
    }

    if (firstRelease === `new`) {
      // The exact acquisition must release its own lease, leaving the older
      // equal filter on the full Query and retiring its sole a2 row.
      await nextFiltered.cleanup()
      expect(collection.has(`a2`)).toBe(false)
      expect(full.toArray.map((row) => row.id).sort()).toEqual([`a1`, `b1`])
      await full.cleanup()
      if (firstFiltered) {
        expect(firstFiltered.toArray.map((row) => row.id)).toEqual([`a1`])
        expect(collection.has(`a1`)).toBe(true)
        await firstFiltered.cleanup()
      }
    } else {
      // Reversing release order must keep the newer exact acquisition's a2
      // row after the older dependent and full view have left.
      await firstFiltered!.cleanup()
      expect(collection.has(`a2`)).toBe(true)
      await full.cleanup()
      expect(nextFiltered.toArray.map((row) => row.id).sort()).toEqual([
        `a1`,
        `a2`,
      ])
      expect(collection.has(`b1`)).toBe(false)
      await nextFiltered.cleanup()
    }
    expect(collection.size).toBe(0)
  }, [
    ['await nextFiltered.cleanup()', () => nextFiltered.cleanup()],
    ['await firstFiltered?.cleanup()', () => firstFiltered?.cleanup()],
    ['await full.cleanup()', () => full.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
}

/**
 * An explicit filtered refetch acquires its exact Query even while an older
 * full refresh is pending. The reference has two owners of a1 and orders
 * successful values by query-function invocation: full starts first, exact
 * starts second, exact settles first. The later-started exact value survives
 * the full result and either owner's release while the other still owns a1.
 * The real QueryClient supplies the start order; public rows after both
 * settlements and each release are the comparison checkpoints.
 */
async function expectFullAndExactResultsKeepLaterValue(
  firstRelease: `full` | `exact`,
): Promise<void> {
  type NamedRow = Row & { group: string; name: string }
  const queryClient = createQueryClient()
  const id = `full-exact-value-order-${collectionSequence++}`
  const fullRequest: LoadSubsetOptions = {}
  const exactRequest: LoadSubsetOptions = {
    where: new IR.Func<boolean>(`eq`, [
      new IR.PropRef([`group`]),
      new IR.Value(`a`),
    ]),
    refetch: true,
  }
  const heldFull = createDeferred<Array<NamedRow>>()
  const calls: Array<`full` | `exact`> = []
  const collection = createCollection(
    queryCollectionOptions<NamedRow>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: ({ meta }) => {
        const where = meta?.loadSubsetOptions?.where
        if (where !== undefined) {
          expect(where).toMatchObject({
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, path: [`group`] },
              { type: `val`, value: `a` },
            ],
          })
          calls.push(`exact`)
          return Promise.resolve([
            { id: `a1`, group: `a`, name: `New` },
            { id: `a2`, group: `a`, name: `Exact only` },
          ])
        }
        calls.push(`full`)
        return calls.length === 1
          ? Promise.resolve([
              { id: `a1`, group: `a`, name: `Initial` },
              { id: `b1`, group: `b`, name: `Initial B` },
            ])
          : heldFull.promise
      },
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
    }),
  )
  let fullRefresh: Promise<void> | undefined
  return checkPublicCleanupWitness(async () => {
    await collection._sync.loadSubset(fullRequest)
    fullRefresh = queryClient.refetchQueries({ queryKey: [id], exact: true })
    await vi.waitFor(() => expect(calls).toEqual([`full`, `full`]))
    await collection._sync.loadSubset(exactRequest)
    expect(calls).toEqual([`full`, `full`, `exact`])
    expect(collection.get(`a1`)?.name).toBe(`New`)

    heldFull.resolve([
      { id: `a1`, group: `a`, name: `Old` },
      { id: `b1`, group: `b`, name: `Updated B` },
    ])
    await fullRefresh
    await vi.waitFor(() => expect(collection.get(`b1`)?.name).toBe(`Updated B`))
    expect(collection.get(`a1`)?.name).toBe(`New`)
    expect(collection.get(`a2`)?.name).toBe(`Exact only`)

    if (firstRelease === `exact`) {
      collection._sync.unloadSubset(exactRequest)
      expect(collection.get(`a1`)?.name).toBe(`New`)
      expect(collection.has(`a2`)).toBe(false)
      collection._sync.unloadSubset(fullRequest)
    } else {
      collection._sync.unloadSubset(fullRequest)
      expect(collection.get(`a1`)?.name).toBe(`New`)
      expect(collection.get(`b1`)).toBeUndefined()
      collection._sync.unloadSubset(exactRequest)
    }
    expect(collection.size).toBe(0)
  }, [
    ['heldFull.resolve([])', () => heldFull.resolve([])],
    [
      'await fullRefresh?.catch(() => undefined)',
      () => fullRefresh?.catch(() => undefined),
    ],
    [
      'collection._sync.unloadSubset(fullRequest)',
      () => collection._sync.unloadSubset(fullRequest),
    ],
    [
      'collection._sync.unloadSubset(exactRequest)',
      () => collection._sync.unloadSubset(exactRequest),
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['resolveFull?.(fullRows)', () => resolveFull?.(fullRows)],
    ['await full.cleanup()', () => full.cleanup()],
    ['await filtered.cleanup()', () => filtered.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  const fullDemand: LoadSubsetOptions = {}
  const response = createDeferred<Array<Row>>()
  const application = createDeferred<void>()
  const commitEntered = createDeferred<void>()
  const commitGate = createDeferred<void>()
  let holdCommit = false
  const requests: Array<`full` | `filtered`> = []
  const baseOptions = queryCollectionOptions<Row>({
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
  })
  const originalSync = baseOptions.sync
  const collection = createCollection({
    ...baseOptions,
    sync: {
      sync: (params: Parameters<typeof originalSync.sync>[0]) =>
        originalSync.sync({
          ...params,
          commit: (signal) => {
            if (!holdCommit) return params.commit(signal)
            commitEntered.resolve()
            return commitGate.promise.then(() => {
              const applied = params.commit(signal)
              return applied === true ? undefined : applied
            })
          },
        }),
    },
  })
  let observed:
    | {
        acquisition: true | Promise<void>
        rowApplied: boolean
        rowAppliedAtSettlement: boolean | Promise<boolean>
      }
    | undefined
  let unsubscribe = () => {}
  let fullAcquisition: true | Promise<void> | undefined
  let revalidation: Promise<void> | undefined
  return checkPublicCleanupWitness(async () => {
    if (previousFullResult) {
      fullAcquisition = collection._sync.loadSubset(fullDemand)
      if (fullAcquisition !== true) await fullAcquisition
      expect(collection.has(`a1`)).toBe(true)
      await collection.utils.writeUpdate({ id: `b1`, group: `b` })
    } else {
      await collection.utils.writeUpsert({ id: `local`, group: `b` })
    }
    collection.deferDataRefresh = application.promise
    unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === `updated` &&
        event.action.type === `success` &&
        !event.action.manual &&
        event.query.queryHash === JSON.stringify([id])
      ) {
        // Opening the barrier causes another full success. Keep the first
        // acquisition, whose settlement is the law under test.
        if (observed !== undefined) return
        const acquisition = collection._sync.loadSubset(filteredDemand)
        observed = {
          acquisition,
          rowApplied: collection.has(`a2`),
          // Register at the acquisition boundary, before the test later
          // awaits anything that could let a premature result appear valid.
          rowAppliedAtSettlement:
            acquisition === true
              ? collection.has(`a2`)
              : acquisition.then(
                  () => collection.has(`a2`),
                  () => false,
                ),
        }
      }
    })
    if (previousFullResult) {
      revalidation = queryClient.invalidateQueries({
        queryKey: [id],
        exact: true,
      })
    } else {
      fullAcquisition = collection._sync.loadSubset(fullDemand)
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
    let settledBeforeApplication = false
    void Promise.resolve(observed?.acquisition).then(
      () => {
        settledBeforeApplication = true
      },
      () => {
        settledBeforeApplication = true
      },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(collection.has(`a2`)).toBe(false)
    expect(settledBeforeApplication).toBe(false)
    // Now allow the Query result through but hold its Collection commit.
    // A load that only waits for the Query result would settle here.
    holdCommit = true
    collection.deferDataRefresh = null
    application.resolve()
    await commitEntered.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(collection.has(`a2`)).toBe(false)
    expect(settledBeforeApplication).toBe(false)
    holdCommit = false
    commitGate.resolve()
    if (observed?.acquisition !== true) await observed?.acquisition
    expect(await observed?.rowAppliedAtSettlement).toBe(true)
    expect(collection.has(`a2`)).toBe(true)
    if (fullAcquisition !== true) await fullAcquisition
    await revalidation
    expect(collection.has(`a2`)).toBe(true)
  }, [
    [
      'holdCommit = false',
      () => {
        holdCommit = false
      },
    ],
    ['commitGate.resolve()', () => commitGate.resolve()],
    [
      'collection.deferDataRefresh = null',
      () => {
        collection.deferDataRefresh = null
      },
    ],
    ['application.resolve()', () => application.resolve()],
    ['response.resolve(fullRows)', () => response.resolve(fullRows)],
    ['unsubscribe()', () => unsubscribe()],
    [
      'collection._sync.unloadSubset(filteredDemand)',
      () => collection._sync.unloadSubset(filteredDemand),
    ],
    [
      'collection._sync.unloadSubset(fullDemand)',
      () => collection._sync.unloadSubset(fullDemand),
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['await full.cleanup()', () => full.cleanup()],
    ['await filtered.cleanup()', () => filtered.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['resolveHeldFetch?.([])', () => resolveHeldFetch?.([])],
    ['await full.cleanup()', () => full.cleanup()],
    ['await filtered.cleanup()', () => filtered.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['response.resolve(replacement)', () => response.resolve(replacement)],
    [
      'await invalidation?.catch(() => undefined)',
      () => invalidation?.catch(() => undefined),
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
}

/**
 * Two equal live queries share one Query transport. Its signal remains live
 * after the first owner releases, and the remaining owner can invalidate and
 * receive a new snapshot. This history crosses both full and filtered Query
 * keys; the latter cannot rely on the full-source dependent map. The provider
 * reads the documented request metadata signal and the public checkpoint is
 * the peer's new row after invalidation.
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
  return checkPublicCleanupWitness(async () => {
    await first.preload()
    await peer.preload()
    expect(queryFn).toHaveBeenCalledOnce()
    await first.cleanup()
    expect(firstSignal?.aborted).toBe(false)
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
  }, [
    ['await first.cleanup()', () => first.cleanup()],
    ['await peer.cleanup()', () => peer.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['response.resolve(replacement)', () => response.resolve(replacement)],
    [
      'await invalidation?.catch(() => undefined)',
      () => invalidation?.catch(() => undefined),
    ],
    ['await first.cleanup()', () => first.cleanup()],
    ['await peer.cleanup()', () => peer.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
}

/**
 * A peer may acquire an equal demand after a sole-owner fetch has started,
 * during either the initial load or a later refetch.
 * The provider holds the Query signal, which remains live while a peer owns
 * the fetch and aborts after the final owner releases. The same request must
 * reach the peer without a replacement. An independent provider error still
 * reaches that peer. The production path uses direct Collection acquisitions
 * on one Query and compares provider calls, signals, settlement, and rows at
 * each owner-release checkpoint.
 */
async function expectPeerJoiningHeldFetchSettles(
  phase: `initial` | `refetch`,
  peerJoins: boolean,
  failure: `signal` | `unrelated` = `signal`,
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
        () => held.reject(requestSignal?.reason),
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
  await checkPublicCleanupWitness(async () => {
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
    firstSignal.abort()
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
      requestAborted: !peerJoins,
      transportAborted: !peerJoins,
      hasNew: expectNewRow,
    })
    if (expectNewRow) expect(peerOutcome).toBe(`fulfilled`)
    if (!peerJoins) expect(peerOutcome).toBe(`not-started`)
    if (failure === `unrelated`) {
      expect(collection.utils.lastError).toBe(unrelatedError)
      expect(peerOutcome).toBe(phase === `initial` ? `rejected` : `fulfilled`)
    }
    expect(calls).toBe(heldCall)
  }, [
    [`held provider`, () => held.resolve(replacement)],
    [
      `invalidation`,
      async () => {
        await invalidation?.catch(() => undefined)
      },
    ],
    [
      `first load`,
      async () => {
        await Promise.resolve(firstLoad).catch(() => undefined)
      },
    ],
    [
      `peer load`,
      async () => {
        await Promise.resolve(peerLoad).catch(() => undefined)
      },
    ],
    [
      `first acquisition`,
      () => {
        if (firstReleased) return
        firstSignal.abort()
        collection._sync.unloadSubset(firstDemand)
      },
    ],
    [
      `peer acquisition`,
      () => {
        if (peerLoad === undefined) return
        peerSignal.abort()
        collection._sync.unloadSubset(peerDemand)
      },
    ],
    [`Collection`, () => collection.cleanup()],
    [`Query client`, () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['await fullA.cleanup()', () => fullA.cleanup()],
    ['await filteredA.cleanup()', () => filteredA.cleanup()],
    ['await fullB?.cleanup()', () => fullB?.cleanup()],
    ['await sourceA.cleanup()', () => sourceA.cleanup()],
    ['await sourceB?.cleanup()', () => sourceB?.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
}

/**
 * Two Collections can observe the same physical Query. Query Core runs the
 * queryFn last installed by B while A still owns the Query. B then releases
 * during the fetch. The independent ownership rule keeps the transport alive
 * for A; after A also releases, the physical Query signal aborts. The provider
 * listens to metadata signal and the driver records Query's transport signal;
 * identity and both release cuts distinguish one physical signal from a
 * detached or never-aborted substitute.
 */
async function expectForeignOwnerReleaseKeepsInFlightSignal(
  releaseFinalOwner: boolean,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `foreign-in-flight-signal-${collectionSequence++}`
  const firstSignal = new AbortController()
  const secondSignal = new AbortController()
  const firstDemand: LoadSubsetOptions = { signal: firstSignal.signal }
  const secondDemand: LoadSubsetOptions = { signal: secondSignal.signal }
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
  let releasedA = false
  return checkPublicCleanupWitness(async () => {
    await sourceA._sync.loadSubset(firstDemand)
    sourceB = makeSource(`B`)
    await sourceB._sync.loadSubset(secondDemand)
    invalidation = queryClient.invalidateQueries({
      queryKey: [id],
      exact: true,
    })
    await vi.waitFor(() => expect(providerCalls.at(-1)).toBe(`B`))
    secondSignal.abort()
    sourceB._sync.unloadSubset(secondDemand)
    releasedB = true
    expect(requestSignal).toBe(transportSignal)
    expect({
      requestAborted: requestSignal?.aborted,
      transportAborted: transportSignal?.aborted,
    }).toEqual({ requestAborted: false, transportAborted: false })
    if (releaseFinalOwner) {
      firstSignal.abort()
      sourceA._sync.unloadSubset(firstDemand)
      releasedA = true
      expect({
        requestAborted: requestSignal?.aborted,
        transportAborted: transportSignal?.aborted,
      }).toEqual({ requestAborted: true, transportAborted: true })
      await invalidation
      expect(sourceA.has(`a2`)).toBe(false)
    } else {
      response.resolve(replacement)
      await invalidation
      await vi.waitFor(() => expect(sourceA.has(`a2`)).toBe(true))
    }
  }, [
    ['response.resolve(replacement)', () => response.resolve(replacement)],
    [
      'await invalidation?.catch(() => undefined)',
      () => invalidation?.catch(() => undefined),
    ],
    [
      'release second source if still owned',
      () => {
        if (sourceB && !releasedB) {
          secondSignal.abort()
          sourceB._sync.unloadSubset(secondDemand)
        }
      },
    ],
    [
      'release first source if still owned',
      () => {
        if (!releasedA) {
          firstSignal.abort()
          sourceA._sync.unloadSubset(firstDemand)
        }
      },
    ],
    ['await sourceA.cleanup()', () => sourceA.cleanup()],
    ['await sourceB?.cleanup()', () => sourceB?.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['await live.cleanup()', () => live.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
    ['loggedError.mockRestore()', () => loggedError.mockRestore()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    expect(live.status).toBe(`error`)
    await expect(livePreload).rejects.toThrow()
  }, [
    ['await live.cleanup()', () => live.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    [
      'await Promise.allSettled([livePreload])',
      async () => {
        await Promise.allSettled([livePreload])
      },
    ],
    ['queryClient.clear()', () => queryClient.clear()],
    ['loggedError.mockRestore()', () => loggedError.mockRestore()],
  ])
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

  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['await live.cleanup()', () => live.cleanup()],
    ['await left.collection.cleanup()', () => left.collection.cleanup()],
    ['await right.collection.cleanup()', () => right.collection.cleanup()],
    [
      'await Promise.allSettled([preload])',
      async () => {
        await Promise.allSettled([preload])
      },
    ],
    ['loggedError.mockRestore()', () => loggedError.mockRestore()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await live.preload()
    await collection.utils.refetch()
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
    })
    expect(collection.status).toBe(`ready`)
    expect(live.status).toBe(`ready`)
    expect(collection.get(`cached`)).toBeDefined()
    expect(live.get(`cached`)).toBeDefined()
  }, [
    ['await live.cleanup()', () => live.cleanup()],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
    ['loggedError.mockRestore()', () => loggedError.mockRestore()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    expect(collection.status).toBe(`error`)
    await vi.waitFor(() => expect(scanPersistedRows).toHaveBeenCalledOnce())
    releaseScan()
    await maintenanceDeleted
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect(collection.status).toBe(`error`)
    expect(collection.utils.lastError).toBe(queryError)
  }, [
    [
      'finish second sync or clean up its Collection',
      async () => {
        if (typeof secondSync === `function`) {
          await secondSync()
        } else {
          await secondSync?.cleanup?.()
        }
      },
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
    ['loggedError.mockRestore()', () => loggedError.mockRestore()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await collection._sync.loadSubset({ where: first })
    await collection._sync.loadSubset({ where: second })
    try {
      expect(queryFn.mock.calls.length).toBe(1)
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  }, [
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(firstValue)]),
    })
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(secondValue)]),
    })
    expect(queryFn).toHaveBeenCalledOnce()
  }, [
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await collection._sync.loadSubset({ refetch: true })
    expect(queryFn).toHaveBeenCalledOnce()
    expect(collection.has(`cached`)).toBe(false)
    expect(collection.has(`fresh`)).toBe(true)
  }, [
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
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
  }, [
    [
      'collection.deferDataRefresh = null',
      () => {
        collection.deferDataRefresh = null
      },
    ],
    ['barrier.resolve()', () => barrier.resolve()],
    [
      'await refetch?.catch(() => undefined)',
      () => refetch?.catch(() => undefined),
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
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
  }, [
    ['initialResult.resolve([])', () => initialResult.resolve([])],
    ['authoritativeResult.resolve([])', () => authoritativeResult.resolve([])],
    [
      'settle initial and refetch demands',
      async () => {
        await Promise.allSettled([
          initialDemand ?? Promise.resolve(),
          refetchDemand ?? Promise.resolve(),
        ])
      },
    ],
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    refetch = collection._sync.loadSubset(request) as Promise<void>
    await started.promise
    expect(signal?.aborted).toBe(false)

    collection._sync.unloadSubset(request)

    expect(signal?.aborted).toBe(true)
    await expect(refetch).rejects.toMatchObject({ name: `AbortError` })
  }, [
    ['await collection.cleanup()', () => collection.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
    [
      'await refetch?.catch(() => undefined)',
      () => refetch?.catch(() => undefined),
    ],
  ])
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
    // Capture the declared request data without reading the lazy Query signal.
    requests.push({ where: structuredClone(options.where) })
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    [`Collection`, () => collection.cleanup()],
    [`Query client`, () => queryClient.clear()],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await started
    expect(queryFn).toHaveBeenCalledOnce()
    expect(capturedSignal?.aborted).toBe(false)

    await live.cleanup()
    expect(capturedSignal?.aborted).toBe(true)
  }, [
    ['await live.cleanup()', () => live.cleanup()],
    ['await source.cleanup()', () => source.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
    [
      'await preloadOutcome',
      async () => {
        await preloadOutcome
      },
    ],
  ])
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
  // Core supplies one options object per acquisition, even when both options
  // describe the same demand. Their releases must preserve the shared fetch.
  const firstRequest: LoadSubsetOptions = {}
  const secondRequest: LoadSubsetOptions = {}
  const first = Promise.resolve(collection._sync.loadSubset(firstRequest))
  const second = Promise.resolve(collection._sync.loadSubset(secondRequest))
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

  return checkPublicCleanupWitness(async () => {
    await started.promise
    capture(2)
    collection._sync.unloadSubset(firstRequest)
    // Let Query process the first release while the provider remains held.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    capture(1)
    collection._sync.unloadSubset(secondRequest)
    capture(0)
    return snapshots
  }, [
    [`provider`, () => providerResult.resolve([])],
    [`Collection`, () => collection.cleanup()],
    [`Query client`, () => queryClient.clear()],
    [
      `load outcomes`,
      async () => {
        await Promise.allSettled([first, second])
      },
    ],
  ])
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

  return checkPublicCleanupWitness(async () => {
    await firstStarted
    await first.cleanup()
    await firstOutcome

    second = buildLive()
    const rows = await second.toArrayWhenReady()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([`fresh`])
  }, [
    ['await first.cleanup()', () => first.cleanup()],
    ['await second?.cleanup()', () => second?.cleanup()],
    ['await source.cleanup()', () => source.cleanup()],
    ['queryClient.clear()', () => queryClient.clear()],
  ])
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
  return checkPublicCleanupWitness(async () => {
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
  }, [
    [`old provider`, () => old.resolve([])],
    [`source listener`, () => unsubscribe[0]?.()],
    [`live listener`, () => unsubscribe[1]?.()],
    [`first live query`, () => first.cleanup()],
    [`second live query`, () => second?.cleanup()],
    [`source Collection`, () => source.cleanup()],
    [`Query client`, () => queryClient.clear()],
  ])
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

/** Preserve the public observation failure if a cleanup step also fails. */
async function checkPublicCleanupWitness<T>(
  check: () => Promise<T>,
  cleanup: ReadonlyArray<readonly [string, () => void | Promise<void>]>,
): Promise<T> {
  let primaryFailure: unknown
  let checkFailed = false
  let observation!: T
  try {
    observation = await check()
  } catch (error) {
    checkFailed = true
    primaryFailure = error
  }

  const cleanupFailures: Array<Error> = []
  for (const [name, release] of cleanup) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(new Error(`${name} failed`, { cause: error }))
    }
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(cleanupFailures, `Cleanup witness failed`, {
      cause: checkFailed ? primaryFailure : undefined,
    })
  if (checkFailed) throw primaryFailure
  return observation
}

/** A dual fault must keep the product mismatch and every cleanup diagnostic. */
it(`preserves the primary mismatch and every cleanup failure`, async () => {
  const primary = new Error(`public row mismatch`)
  const firstCleanupError = new Error(`unsubscribe failed`)
  const secondCleanupError = new Error(`Collection cleanup failed`)
  const reached: Array<string> = []
  const failure = await checkPublicCleanupWitness(
    () => Promise.reject(primary),
    [
      [
        `subscription`,
        () => {
          reached.push(`subscription`)
          throw firstCleanupError
        },
      ],
      [
        `Collection`,
        () => {
          reached.push(`Collection`)
          throw secondCleanupError
        },
      ],
      [
        `Query client`,
        () => {
          reached.push(`Query client`)
        },
      ],
    ],
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(failure instanceof AggregateError)) throw failure
  expect(failure.cause).toBe(primary)
  expect(failure.errors).toHaveLength(2)
  expect(failure.errors[0].message).toBe(`subscription failed`)
  expect(failure.errors[0].cause).toBe(firstCleanupError)
  expect(failure.errors[1].message).toBe(`Collection failed`)
  expect(failure.errors[1].cause).toBe(secondCleanupError)
  expect(reached).toEqual([`subscription`, `Collection`, `Query client`])
})

describe(`loadSubset lifecycle oracle`, () => {
  /**
   * A sync adapter may call user code while writing a fetched result. The
   * final owner can leave from that callback, before commit() is entered.
   * The pending transaction must not publish a row after that release. If a
   * peer still owns the Query, its acquisition may accept the same result.
   */
  it.each([false, true])(
    `does not publish a result after release during write, peer=%s`,
    async (peer) => {
      const queryClient = createQueryClient()
      const id = `release-during-result-write-${collectionSequence++}`
      const result = createDeferred<Array<Row>>()
      let released = false
      const baseOptions = queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => result.promise,
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
      })
      const originalSync = baseOptions.sync
      const collection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              write: (change) => {
                if (!released) {
                  released = true
                  first.unsubscribe()
                }
                params.write(change)
              },
            }),
        },
      })
      const first = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const second = peer
        ? collection.subscribeChanges(() => {}, { includeInitialState: false })
        : undefined

      await checkPublicCleanupWitness(async () => {
        let firstLoad: true | Promise<void> | undefined
        let secondLoad: true | Promise<void> | undefined
        first.requestSnapshot({
          onLoadSubsetResult: (load) => {
            firstLoad = load
          },
        })
        second?.requestSnapshot({
          onLoadSubsetResult: (load) => {
            secondLoad = load
          },
        })
        expect(firstLoad).toBeDefined()
        if (firstLoad === undefined || firstLoad === true)
          throw new Error(`No pending first load`)
        const firstOutcome = firstLoad.then(
          () => `fulfilled` as const,
          () => `rejected` as const,
        )
        const secondOutcome =
          secondLoad && secondLoad !== true
            ? secondLoad.then(
                () => `fulfilled` as const,
                () => `rejected` as const,
              )
            : undefined
        result.resolve([{ id: `a` }])
        await firstOutcome
        await secondOutcome
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(released).toBe(true)
        expect(collection.subscriberCount).toBe(peer ? 1 : 0)
        expect(collection.has(`a`)).toBe(peer)
        if (peer) expect(await secondOutcome).toBe(`fulfilled`)
        else expect(await firstOutcome).toBe(`rejected`)
      }, [
        [`provider`, () => result.resolve([])],
        [`first subscription`, () => first.unsubscribe()],
        [`second subscription`, () => second?.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * getKey can release the final subscription before result bookkeeping
   * starts. The rejected first load must leave no hidden owner that can keep
   * a later, separately acquired row alive after its own final unload.
   * Original counterexample: https://github.com/TanStack/db/issues/2160
   */
  it(`does not retain an owner after release during getKey`, async () => {
    const queryClient = createQueryClient()
    const id = `release-during-get-key-${collectionSequence++}`
    const firstResult = createDeferred<Array<Row>>()
    let released = false
    const queryFn = (context: QueryFunctionContext) =>
      context.meta?.loadSubsetOptions?.where
        ? Promise.resolve([{ id: `a`, group: `g` }] satisfies Array<Row>)
        : firstResult.promise
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => {
          if (!released) {
            released = true
            first.unsubscribe()
          }
          return row.id
        },
        startSync: true,
        syncMode: `on-demand`,
      }),
    )
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let second: ReturnType<typeof collection.subscribeChanges> | undefined

    await checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      expect(firstLoad).toBeDefined()
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`No pending first load`)
      const firstOutcome = firstLoad.then(
        () => `fulfilled` as const,
        () => `rejected` as const,
      )
      firstResult.resolve([{ id: `a`, group: `g` }])
      expect(await firstOutcome).toBe(`rejected`)
      expect(released).toBe(true)
      expect(collection.has(`a`)).toBe(false)

      let secondLoad: true | Promise<void> | undefined
      const filter = new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(`g`),
      ])
      second = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      second.requestSnapshot({
        where: filter,
        onLoadSubsetResult: (load) => {
          secondLoad = load
        },
      })
      expect(secondLoad).toBeDefined()
      if (secondLoad === undefined || secondLoad === true)
        throw new Error(`No pending second load`)
      expect(
        await secondLoad.then(
          () => `fulfilled`,
          () => `rejected`,
        ),
      ).toBe(`fulfilled`)
      expect(collection.has(`a`)).toBe(true)
      second.unsubscribe()
      expect(collection.has(`a`)).toBe(false)
    }, [
      [`provider`, () => firstResult.resolve([])],
      [`first subscription`, () => first.unsubscribe()],
      [`second subscription`, () => second?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * A fetched result can invoke user code while Query DB extracts a key or
   * writes a sync change. That callback may retire the first acquisition and
   * leave no owner, retain an existing peer, or acquire a peer reentrantly.
   * The independent model retains each provider row exactly while a public
   * acquisition owns it. A later filtered acquisition must not inherit a
   * hidden owner from the retired result. Its provider adds a fresh row, so a
   * stale full-Query cache result cannot impersonate renewed exact coverage.
   * The two-row case distinguishes a partial application from a complete
   * source result.
   *
   * The grammar holds one initial provider result and varies the callback
   * cut, peer arrival, and row count. It excludes release before the callback
   * and a provider failure because neither reaches this application boundary.
   * The driver uses real requestSnapshot acquisitions and a wrapping sync for
   * the write cut. It compares the complete public row set after initial load
   * settlement, after peer release, after a fresh exact-scope filtered
   * acquisition, and after that acquisition releases. The raw adapter promise handed to
   * onLoadSubsetResult has no specified outcome after unsubscribe. A peer
   * acquired during the callback may receive immediate `true` rather than a
   * pending load. The model checks delivery of its result callback, public
   * rows, and final release without requiring a pending peer promise. This
   * grammar does not model accepted commits or Query-cache notification reentry.
   */
  type ApplicationReleaseHistory = {
    cut: `getKey` | `write`
    peerArrival: `none` | `before-result` | `at-cut`
    rowCount: 1 | 2
  }

  function expectedApplicationRelease(history: ApplicationReleaseHistory) {
    const sourceRows = history.rowCount === 1 ? [`a`] : [`a`, `b`]
    return {
      reachedCut: true,
      ...(history.peerArrival === `before-result`
        ? { peerOutcome: `fulfilled` }
        : {}),
      afterInitialRows: history.peerArrival === `none` ? [] : sourceRows,
      afterPeerReleaseRows: [] as Array<string>,
      requestedFreshFilteredScope: true,
      afterReacquireRows: [...sourceRows, `fresh`],
      afterLaterReleaseRows: [] as Array<string>,
    }
  }

  async function observeApplicationRelease(
    history: ApplicationReleaseHistory,
    expected: ReturnType<typeof expectedApplicationRelease>,
  ) {
    const queryClient = createQueryClient()
    const id = `application-release-history-${collectionSequence++}`
    const sourceRows: Array<Row> =
      history.rowCount === 1
        ? [{ id: `a`, group: `g` }]
        : [
            { id: `a`, group: `g` },
            { id: `b`, group: `g` },
          ]
    const refreshedRows: Array<Row> = [
      ...sourceRows,
      { id: `fresh`, group: `g` },
    ]
    const firstResult = createDeferred<Array<Row>>()
    let providerCalls = 0
    const requestedScopes: Array<`full` | `filtered`> = []
    let reachedCut = false
    let onCut = () => {}
    const baseOptions = queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: (context) => {
        const scope = context.meta?.loadSubsetOptions?.where
          ? `filtered`
          : `full`
        requestedScopes.push(scope)
        return ++providerCalls === 1
          ? firstResult.promise
          : Promise.resolve(scope === `filtered` ? refreshedRows : sourceRows)
      },
      getKey: (row) => {
        if (history.cut === `getKey`) onCut()
        return row.id
      },
      syncMode: `on-demand`,
      startSync: true,
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            write: (change) => {
              if (history.cut === `write`) onCut()
              params.write(change)
            },
          }),
      },
    })
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let peer: ReturnType<typeof collection.subscribeChanges> | undefined
    let later: ReturnType<typeof collection.subscribeChanges> | undefined
    let firstLoad: true | Promise<void> | undefined
    let peerLoad: true | Promise<void> | undefined
    let laterLoad: true | Promise<void> | undefined
    const requestPeer = () => {
      peer = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      peer.requestSnapshot({
        onLoadSubsetResult: (load) => {
          peerLoad = load
        },
      })
    }
    onCut = () => {
      if (reachedCut) return
      reachedCut = true
      first.unsubscribe()
      if (history.peerArrival === `at-cut`) requestPeer()
    }
    const rowIds = () => collection.toArray.map((row) => row.id).sort()

    return checkPublicCleanupWitness(async () => {
      first.requestSnapshot({
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The first acquisition did not return a pending load`)
      void firstLoad.catch(() => undefined)
      if (history.peerArrival === `before-result`) requestPeer()
      firstResult.resolve(sourceRows)
      if (history.peerArrival === `before-result`) {
        if (peerLoad === undefined || peerLoad === true)
          throw new Error(`The existing peer did not return a pending load`)
        await peerLoad
      } else if (history.peerArrival === `at-cut`) {
        await vi.waitFor(() => expect(reachedCut).toBe(true))
        if (peerLoad === undefined)
          throw new Error(`The reentrant peer did not receive a load result`)
        if (peerLoad !== true) await peerLoad
      }
      // One host turn drains this controlled provider continuation before the
      // public-row checkpoint; the retired adapter promise need not settle.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(reachedCut).toBe(true)
      const afterInitialRows = rowIds()
      const peerOutcome =
        history.peerArrival !== `before-result`
          ? undefined
          : await Promise.resolve(peerLoad).then(
              () => `fulfilled` as const,
              () => `rejected` as const,
            )
      peer?.unsubscribe()
      const afterPeerReleaseRows = rowIds()

      const filter = new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(`g`),
      ])
      later = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const scopesBeforeLater = requestedScopes.length
      later.requestSnapshot({
        where: filter,
        onLoadSubsetResult: (load) => {
          laterLoad = load
        },
      })
      if (laterLoad === undefined)
        throw new Error(`The later filtered acquisition did not return a load`)
      await laterLoad
      const requestedFreshFilteredScope = requestedScopes
        .slice(scopesBeforeLater)
        .includes(`filtered`)
      const afterReacquireRows = rowIds()
      later.unsubscribe()
      const afterLaterReleaseRows = rowIds()
      const observed = {
        reachedCut,
        ...(history.peerArrival === `before-result` ? { peerOutcome } : {}),
        afterInitialRows,
        afterPeerReleaseRows,
        requestedFreshFilteredScope,
        afterReacquireRows,
        afterLaterReleaseRows,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`first provider`, () => firstResult.resolve([])],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`later subscription`, () => later?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const applicationReleaseProperty = `query-db.application-release-history`
  const applicationReleaseReplay = readOracleRunConfig()
  const applicationReleaseArbitrary = fc.record({
    cut: fc.constantFrom<ApplicationReleaseHistory[`cut`]>(`getKey`, `write`),
    peerArrival: fc.constantFrom<ApplicationReleaseHistory[`peerArrival`]>(
      `none`,
      `before-result`,
      `at-cut`,
    ),
    rowCount: fc.constantFrom<ApplicationReleaseHistory[`rowCount`]>(1, 2),
  })
  const namedApplicationReleaseHistories = (
    [`getKey`, `write`] as const
  ).flatMap((cut) =>
    ([`none`, `before-result`, `at-cut`] as const).flatMap((peerArrival) =>
      ([1, 2] as const).map((rowCount) => ({
        cut,
        peerArrival,
        rowCount,
      })),
    ),
  )

  it.each(namedApplicationReleaseHistories)(
    `reconstructs an application release history: %j`,
    async (history) => {
      await observeApplicationRelease(
        history,
        expectedApplicationRelease(history),
      )
    },
  )

  it(`refines generated application release histories`, async () => {
    if (
      applicationReleaseReplay.replayPath !== undefined &&
      applicationReleaseReplay.replayProperty !== applicationReleaseProperty
    )
      return
    const property = fc.asyncProperty(
      applicationReleaseArbitrary,
      async (history) => {
        await observeApplicationRelease(
          history,
          expectedApplicationRelease(history),
        )
      },
    )
    const options = oraclePropertyOptions(48, applicationReleaseProperty)
    if (applicationReleaseReplay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_160_2026 })
    await fc.assert(property, options)
  })

  /**
   * Canceling the last owner's held commit fires its abort listeners inside
   * cleanup. A new public acquisition from that callback must keep the Query
   * and its row; the outer cleanup may retire only the departed lease.
   * Original counterexample: https://github.com/TanStack/db/issues/2160
   */
  it(`keeps a new owner acquired from the commit abort callback`, async () => {
    const queryClient = createQueryClient()
    const id = `commit-abort-reentry-${collectionSequence++}`
    const commitEntered = createDeferred<void>()
    const commitGate = createDeferred<void>()
    let commits = 0
    let aborts = 0
    let second:
      | ReturnType<ReturnType<typeof createCollection>[`subscribeChanges`]>
      | undefined
    let secondLoad: true | Promise<void> | undefined
    const baseOptions = queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: () => Promise.resolve([{ id: `a` }]),
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            commit: (signal) => {
              commits++
              if (commits > 1) return params.commit(signal)
              signal?.addEventListener(
                `abort`,
                () => {
                  aborts++
                  second = collection.subscribeChanges(() => {}, {
                    includeInitialState: false,
                  })
                  second.requestSnapshot({
                    onLoadSubsetResult: (load) => {
                      secondLoad = load
                    },
                  })
                },
                { once: true },
              )
              commitEntered.resolve()
              return commitGate.promise.then(() => {
                const applied = params.commit(signal)
                return applied === true ? undefined : applied
              })
            },
          }),
      },
    })
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      expect(firstLoad).toBeDefined()
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`No pending first load`)
      const firstOutcome = firstLoad.then(
        () => `fulfilled` as const,
        () => `rejected` as const,
      )
      await commitEntered.promise
      first.unsubscribe()
      expect(aborts).toBe(1)
      expect(secondLoad).toBeDefined()
      commitGate.resolve()
      expect(await firstOutcome).toBe(`rejected`)
      expect(
        await Promise.resolve(secondLoad).then(
          () => `fulfilled`,
          () => `rejected`,
        ),
      ).toBe(`fulfilled`)
      expect(collection.subscriberCount).toBe(1)
      expect(collection.has(`a`)).toBe(true)
      second?.unsubscribe()
      expect(collection.has(`a`)).toBe(false)
    }, [
      [`commit gate`, () => commitGate.resolve()],
      [`first subscription`, () => first.unsubscribe()],
      [`second subscription`, () => second?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Query Core can notify cache listeners while Query DB removes its old
   * observer. A new public subscriber at that cut owns a fresh lease even
   * though the old cleanup began with no remaining leases.
   * Original counterexample: https://github.com/TanStack/db/issues/2160
   */
  it(`keeps a new owner acquired from observer removal`, async () => {
    const queryClient = createQueryClient()
    const id = `observer-removal-reentry-${collectionSequence++}`
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([{ id: `a` }]),
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
      }),
    )
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let second: ReturnType<typeof collection.subscribeChanges> | undefined
    let secondLoad: true | Promise<void> | undefined
    let joined = 0
    const stopCacheListener = queryClient.getQueryCache().subscribe((event) => {
      if (
        joined === 0 &&
        event.type === `observerRemoved` &&
        event.query.queryKey[0] === id
      ) {
        joined++
        second = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        second.requestSnapshot({
          onLoadSubsetResult: (load) => {
            secondLoad = load
          },
        })
      }
    })

    await checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      await firstLoad
      expect(collection.has(`a`)).toBe(true)
      first.unsubscribe()
      expect(joined).toBe(1)
      expect(secondLoad).toBeDefined()
      await secondLoad
      expect(collection.subscriberCount).toBe(1)
      expect(collection.has(`a`)).toBe(true)
      second?.unsubscribe()
      expect(collection.has(`a`)).toBe(false)
    }, [
      [`cache listener`, stopCacheListener],
      [`first subscription`, () => first.unsubscribe()],
      [`second subscription`, () => second?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * A release callback may acquire one or two new public owners before the
   * old release returns. The law is per observer lease: every accepted new
   * owner retains the provider rows until its own release, regardless of
   * which peer releases first. The independent model uses only the scripted
   * source row IDs, each peer's scope, and the live owners; it has no Query
   * cache, refcount, or ownership map.
   *
   * The legal grammar varies the callback cut (abort of a held, unaccepted
   * source-result commit or Query observer removal), one/two equal-scope
   * source rows, and one peer or either release order for two peers. A
   * disjoint-scope pair uses one distinct row per peer to expose a release
   * that retires the wrong observer lease. The held commit's old adapter
   * promise has no promised result after unsubscribe, but its
   * unaccepted sync transaction must reject its applied receipt after abort.
   * The driver reaches each cut through public requestSnapshot and
   * unsubscribe, records each new load's public rows at settlement, then
   * compares the complete public row set after each release. For observer
   * removal with equal-scope peers, rows also remain public as the old
   * unsubscribe returns because the new acquisitions were accepted inside
   * that synchronous call. The internal callback count witnesses reach only.
   * A peer present before the callback, caller abort, and post-acceptance
   * reentry are outside this grammar.
   */
  type ReentrantReleaseHistory = {
    cut: `commit-abort` | `observer-removal`
    rowCount: 1 | 2
    releaseOrder: `only` | `first` | `second`
    scope: `equal` | `disjoint`
  }

  function expectedReentrantRelease(history: ReentrantReleaseHistory) {
    const sourceRows = history.rowCount === 1 ? [`a`] : [`a`, `b`]
    const peerCount = history.releaseOrder === `only` ? 1 : 2
    const peerRows =
      history.scope === `disjoint`
        ? [[`a`], [`b`]]
        : Array.from({ length: peerCount }, () => sourceRows)
    const firstReleasedIndex = history.releaseOrder === `second` ? 1 : 0
    return {
      callbackCount: 1,
      ...(history.cut === `commit-abort`
        ? { oldReceiptOutcome: `AbortError` }
        : history.scope === `equal`
          ? { afterOldReleaseRows: sourceRows }
          : {}),
      peerOutcomes: peerRows.map(() => ({
        status: `fulfilled`,
        promisedRowsPresent: true,
      })),
      afterPeerSettlementsRows: [...new Set(peerRows.flat())].sort(),
      afterFirstPeerReleaseRows:
        peerCount === 1 ? [] : peerRows[1 - firstReleasedIndex],
      afterFinalReleaseRows: [] as Array<string>,
    }
  }

  async function observeReentrantRelease(
    history: ReentrantReleaseHistory,
    expected: ReturnType<typeof expectedReentrantRelease>,
  ) {
    const queryClient = createQueryClient()
    const id = `reentrant-release-history-${collectionSequence++}`
    const sourceRows: Array<Row> =
      history.scope === `disjoint`
        ? [{ id: `old`, group: `old` }]
        : history.rowCount === 1
          ? [{ id: `a` }]
          : [{ id: `a` }, { id: `b` }]
    const peerProviderRows: Array<Array<Row>> =
      history.scope === `disjoint`
        ? [[{ id: `a`, group: `a` }], [{ id: `b`, group: `b` }]]
        : [sourceRows, sourceRows]
    const whereForGroup = (group: string) =>
      new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(group),
      ])
    const oldWhere = whereForGroup(`old`)
    const peerWheres = [whereForGroup(`a`), whereForGroup(`b`)]
    const commitEntered = createDeferred<void>()
    const commitGate = createDeferred<void>()
    let heldFirstCommit = false
    let sourceResultWritten = false
    let oldReceiptOutcome: `applied` | `AbortError` | `other-error` | undefined
    let reenter = () => {}
    const baseOptions = queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: (context) => {
        if (history.scope === `equal`) return Promise.resolve(sourceRows)
        const where = context.meta?.loadSubsetOptions?.where
        if (where === oldWhere) return Promise.resolve(sourceRows)
        if (where === peerWheres[0])
          return Promise.resolve(peerProviderRows[0]!)
        if (where === peerWheres[1])
          return Promise.resolve(peerProviderRows[1]!)
        throw new Error(`Unexpected disjoint subset scope`)
      },
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            begin: () => {
              sourceResultWritten = false
              params.begin()
            },
            write: (change) => {
              if (
                change.type !== `delete` &&
                change.value.id === sourceRows[0]?.id
              )
                sourceResultWritten = true
              params.write(change)
            },
            commit: (signal) => {
              if (
                history.cut !== `commit-abort` ||
                heldFirstCommit ||
                !sourceResultWritten
              )
                return params.commit(signal)
              heldFirstCommit = true
              signal?.addEventListener(`abort`, () => reenter(), {
                once: true,
              })
              commitEntered.resolve()
              return commitGate.promise.then(() => {
                const receipt = params.commit(signal)
                if (receipt === true) {
                  oldReceiptOutcome = `applied`
                  return undefined
                }
                void receipt.then(
                  () => {
                    oldReceiptOutcome = `applied`
                  },
                  (error: unknown) => {
                    oldReceiptOutcome =
                      error instanceof Error && error.name === `AbortError`
                        ? `AbortError`
                        : `other-error`
                  },
                )
                return receipt
              })
            },
          }),
      },
    })
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const peers: Array<ReturnType<typeof collection.subscribeChanges>> = []
    const peerOutcomes: Array<
      Promise<{
        status: `fulfilled` | `rejected`
        promisedRowsPresent: boolean
      }>
    > = []
    const rowIds = () => collection.toArray.map((row) => row.id).sort()
    let callbackCount = 0
    let observingFirstRelease = false
    reenter = () => {
      if (callbackCount > 0) return
      callbackCount++
      const peerCount = history.releaseOrder === `only` ? 1 : 2
      for (let index = 0; index < peerCount; index++) {
        const peer = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        peers.push(peer)
        const promisedIds = peerProviderRows[index]!.map((row) => row.id)
        const promisedRowsPresent = () =>
          promisedIds.every((rowId) => rowIds().includes(rowId))
        peer.requestSnapshot({
          ...(history.scope === `disjoint` ? { where: peerWheres[index] } : {}),
          onLoadSubsetResult: (load) => {
            peerOutcomes.push(
              load === true
                ? Promise.resolve({
                    status: `fulfilled`,
                    promisedRowsPresent: promisedRowsPresent(),
                  })
                : load.then(
                    () => ({
                      status: `fulfilled`,
                      promisedRowsPresent: promisedRowsPresent(),
                    }),
                    () => ({
                      status: `rejected`,
                      promisedRowsPresent: promisedRowsPresent(),
                    }),
                  ),
            )
          },
        })
      }
    }
    const stopCacheListener = queryClient.getQueryCache().subscribe((event) => {
      if (
        history.cut === `observer-removal` &&
        observingFirstRelease &&
        callbackCount === 0 &&
        event.type === `observerRemoved` &&
        event.query.queryKey[0] === id
      )
        reenter()
    })

    return checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        ...(history.scope === `disjoint` ? { where: oldWhere } : {}),
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      if (firstLoad === undefined)
        throw new Error(`The first acquisition did not return a load`)
      if (history.cut === `commit-abort`) {
        if (firstLoad === true)
          throw new Error(`The held commit did not return a pending load`)
        void firstLoad.catch(() => undefined)
        await commitEntered.promise
      } else {
        await firstLoad
        observingFirstRelease = true
      }

      first.unsubscribe()
      const afterOldReleaseRows =
        history.cut === `observer-removal` && history.scope === `equal`
          ? rowIds()
          : undefined
      expect(callbackCount).toBe(1)
      expect(peerOutcomes).toHaveLength(expected.peerOutcomes.length)
      commitGate.resolve()
      const observedPeerOutcomes = await Promise.all(peerOutcomes)
      if (history.cut === `commit-abort`)
        await vi.waitFor(() => expect(oldReceiptOutcome).toBeDefined())
      const afterPeerSettlementsRows = rowIds()
      const firstReleasedIndex = history.releaseOrder === `second` ? 1 : 0
      peers[firstReleasedIndex]?.unsubscribe()
      const afterFirstPeerReleaseRows = rowIds()
      if (peers.length === 2) peers[1 - firstReleasedIndex]?.unsubscribe()
      const afterFinalReleaseRows = rowIds()
      const observed = {
        callbackCount,
        ...(history.cut === `observer-removal` && history.scope === `equal`
          ? { afterOldReleaseRows }
          : {}),
        ...(history.cut === `commit-abort` ? { oldReceiptOutcome } : {}),
        peerOutcomes: observedPeerOutcomes,
        afterPeerSettlementsRows,
        afterFirstPeerReleaseRows,
        afterFinalReleaseRows,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`commit gate`, () => commitGate.resolve()],
      [`cache listener`, stopCacheListener],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscriptions`, () => peers.forEach((peer) => peer.unsubscribe())],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const reentrantReleaseProperty = `query-db.reentrant-release-history`
  const reentrantReleaseReplay = readOracleRunConfig()
  const reentrantCutArbitrary = fc.constantFrom<ReentrantReleaseHistory[`cut`]>(
    `commit-abort`,
    `observer-removal`,
  )
  const reentrantReleaseArbitrary = fc.oneof(
    fc
      .record({
        cut: reentrantCutArbitrary,
        rowCount: fc.constantFrom<ReentrantReleaseHistory[`rowCount`]>(1, 2),
        releaseOrder: fc.constantFrom<ReentrantReleaseHistory[`releaseOrder`]>(
          `only`,
          `first`,
          `second`,
        ),
      })
      .map((history) => ({ ...history, scope: `equal` as const })),
    fc
      .record({
        cut: reentrantCutArbitrary,
        releaseOrder: fc.constantFrom<`first` | `second`>(`first`, `second`),
      })
      .map((history) => ({
        ...history,
        rowCount: 1 as const,
        scope: `disjoint` as const,
      })),
  )
  const namedEqualReentrantReleaseHistories = (
    [`commit-abort`, `observer-removal`] as const
  ).flatMap((cut) =>
    ([1, 2] as const).flatMap((rowCount) =>
      ([`only`, `first`, `second`] as const).map((releaseOrder) => ({
        cut,
        rowCount,
        releaseOrder,
        scope: `equal` as const,
      })),
    ),
  )
  const namedDisjointReentrantReleaseHistories = (
    [`commit-abort`, `observer-removal`] as const
  ).flatMap((cut) =>
    ([`first`, `second`] as const).map((releaseOrder) => ({
      cut,
      rowCount: 1 as const,
      releaseOrder,
      scope: `disjoint` as const,
    })),
  )
  const namedReentrantReleaseHistories = [
    ...namedEqualReentrantReleaseHistories,
    ...namedDisjointReentrantReleaseHistories,
  ]

  it.each(namedReentrantReleaseHistories)(
    `reconstructs a reentrant release history: %j`,
    async (history) => {
      await observeReentrantRelease(history, expectedReentrantRelease(history))
    },
  )

  it(`refines generated reentrant release histories`, async () => {
    if (
      reentrantReleaseReplay.replayPath !== undefined &&
      reentrantReleaseReplay.replayProperty !== reentrantReleaseProperty
    )
      return
    const property = fc.asyncProperty(
      reentrantReleaseArbitrary,
      async (history) => {
        await observeReentrantRelease(
          history,
          expectedReentrantRelease(history),
        )
      },
    )
    const options = oraclePropertyOptions(48, reentrantReleaseProperty)
    if (reentrantReleaseReplay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_160_2028 })
    await fc.assert(property, options)
  }, 20_000)

  /**
   * A provider error belongs to its physical fetch, including a synchronous
   * throw after a second public acquisition joins inside the query function.
   * Both loads reject that exact error; the peer's acquisition lease survives
   * the first owner's release and can recover when its Query is invalidated.
   * The independent account is the scripted first throw and second row, not
   * Query status or Query DB's observer bookkeeping. This single reentrant
   * history checks both load outcomes, the public row after invalidation, and its
   * removal after the peer releases. It does not cover retries inside one
   * physical fetch or a throw during observer construction.
   */
  it(`preserves a reentrant peer after a synchronous provider throw`, async () => {
    const queryClient = createQueryClient()
    const id = `reentrant-provider-throw-${collectionSequence++}`
    const providerError = new Error(`first source failed`)
    let providerCalls = 0
    let acquirePeer = () => {}
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => {
          providerCalls++
          if (providerCalls === 1) {
            acquirePeer()
            throw providerError
          }
          return [{ id: `recovered` }]
        },
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let peer: ReturnType<typeof collection.subscribeChanges> | undefined
    let peerLoad: true | Promise<void> | undefined
    acquirePeer = () => {
      peer = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      peer.requestSnapshot({
        onLoadSubsetResult: (load) => {
          peerLoad = load
          if (load !== true) void load.catch(() => undefined)
        },
      })
    }

    await checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        onLoadSubsetResult: (load) => {
          firstLoad = load
          if (load !== true) void load.catch(() => undefined)
        },
      })
      await vi.waitFor(() => expect(peerLoad).toBeDefined())
      expect(providerCalls).toBe(1)
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The failed first acquisition returned no load`)
      if (peerLoad === undefined || peerLoad === true)
        throw new Error(`The reentrant peer returned no load`)
      await expect(firstLoad).rejects.toBe(providerError)
      await expect(peerLoad).rejects.toBe(providerError)
      expect(collection.toArray).toEqual([])

      first.unsubscribe()
      expect(collection.subscriberCount).toBe(1)
      await queryClient.invalidateQueries({ queryKey: [id] })
      expect(providerCalls).toBe(2)
      await vi.waitFor(() => expect(collection.has(`recovered`)).toBe(true))
      expect(collection.toArray.map((row) => row.id)).toEqual([`recovered`])
      peer?.unsubscribe()
      expect(collection.toArray).toEqual([])
    }, [
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * A direct write can overlap a fetched result. While merging that result,
   * Query DB briefly subscribes to its own Query observer. That temporary
   * listener is not an owner: final public release in the cache notification
   * must retire the fetched-only row. The accepted direct write stays ordered
   * ahead of the older fetch for as long as its row has an owner.
   */
  it(`retires a late fetched row after final release during cache notification`, async () => {
    const queryClient = createQueryClient()
    const id = `release-during-cache-notification-${collectionSequence++}`
    const nextResult = createDeferred<Array<Row>>()
    let calls = 0
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () =>
          ++calls === 1
            ? Promise.resolve([{ id: `x`, group: `before` }])
            : nextResult.promise,
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await checkPublicCleanupWitness(async () => {
      let initialLoad: true | Promise<void> | undefined
      subscription.requestSnapshot({
        onLoadSubsetResult: (load) => {
          initialLoad = load
        },
      })
      expect(initialLoad).toBeDefined()
      if (initialLoad === undefined || initialLoad === true)
        throw new Error(`No pending initial load`)
      await initialLoad
      expect(collection.get(`x`)?.group).toBe(`before`)

      const refetch = queryClient.refetchQueries({
        queryKey: [id],
        exact: true,
      })
      await vi.waitFor(() => expect(calls).toBe(2))
      await collection.utils.writeUpdate({ id: `x`, group: `manual` })
      expect(collection.get(`x`)?.group).toBe(`manual`)

      let releaseCount = 0
      const stopCacheListener = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (
            event.type === `updated` &&
            event.action.type === `setState` &&
            Array.isArray(event.query.state.data) &&
            event.query.state.data.some((row: Row) => row.id === `y`)
          ) {
            releaseCount++
            subscription.unsubscribe()
          }
        })
      return checkPublicCleanupWitness(async () => {
        nextResult.resolve([
          { id: `x`, group: `older` },
          { id: `y`, group: `fetched` },
        ])
        await refetch
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(releaseCount).toBe(1)
        expect(collection.subscriberCount).toBe(0)
        expect(collection.has(`y`)).toBe(false)
      }, [['stopCacheListener()', () => stopCacheListener()]])
    }, [
      [`provider`, () => nextResult.resolve([])],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Query success does not settle a load while its Collection commit is held.
   * A wrapping sync may delay acceptance after the provider returns. Releasing
   * the last public owner at that cut cancels the acquisition and its pending
   * write. A peer acquired at the same cut keeps the result live. Once the
   * gate opens, a canceled load must reject without publishing a row, while
   * the peer's load applies the row. Both unsubscribe and Collection cleanup
   * are legal final release actions.
   */
  it.each([
    { release: `subscription`, peer: false },
    { release: `Collection`, peer: false },
    { release: `subscription`, peer: true },
    { release: `caller abort`, peer: false },
    { release: `caller abort`, peer: true },
  ] as const)(
    `settles an unaccepted result commit after $release release, peer=$peer`,
    async ({ release, peer }) => {
      const queryClient = createQueryClient()
      const id = `release-before-result-commit-${collectionSequence++}`
      const commitEntered = createDeferred<void>()
      const commitGate = createDeferred<void>()
      let heldCommit = false
      const queryFn = vi.fn(() =>
        Promise.resolve([{ id: `a` }] satisfies Array<Row>),
      )
      const baseOptions = queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
      })
      const originalSync = baseOptions.sync
      const collection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              commit: (signal) => {
                if (heldCommit) return params.commit(signal)
                heldCommit = true
                commitEntered.resolve()
                return commitGate.promise.then(() => {
                  const applied = params.commit(signal)
                  return applied === true ? undefined : applied
                })
              },
            }),
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const caller = new AbortController()
      let peerSubscription: typeof subscription | undefined

      await checkPublicCleanupWitness(async () => {
        let load: true | Promise<void> | undefined
        subscription.requestSnapshot({
          ...(release === `caller abort` ? { signal: caller.signal } : {}),
          onLoadSubsetResult: (result) => {
            load = result
          },
        })
        expect(load).toBeDefined()
        expect(load).not.toBe(true)
        if (load === undefined || load === true)
          throw new Error(`No pending load`)
        const outcome = load.then(
          () => ({ status: `fulfilled` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )
        await commitEntered.promise
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.has(`a`)).toBe(false)
        peerSubscription = peer
          ? collection.subscribeChanges(() => {}, {
              includeInitialState: false,
            })
          : undefined
        let peerLoad: true | Promise<void> | undefined
        peerSubscription?.requestSnapshot({
          onLoadSubsetResult: (result) => {
            peerLoad = result
          },
        })
        const peerOutcome =
          peerLoad && peerLoad !== true
            ? peerLoad.then(
                () => ({ status: `fulfilled` as const }),
                (error: unknown) => ({ status: `rejected` as const, error }),
              )
            : undefined
        if (peer) expect(peerOutcome).toBeDefined()
        // Release in the same continuation that observes commit entry. An
        // extra microtask lets the final-owner waiter choose a different path.
        if (release === `subscription`) subscription.unsubscribe()
        else if (release === `Collection`) await collection.cleanup()
        else caller.abort()
        expect(collection.has(`a`)).toBe(false)
        let beforeGate: Awaited<typeof outcome> | undefined
        void outcome.then((result) => {
          beforeGate = result
        })
        let peerBeforeGate: Awaited<NonNullable<typeof peerOutcome>> | undefined
        void peerOutcome?.then((result) => {
          peerBeforeGate = result
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(collection.has(`a`)).toBe(false)
        const settledBeforeGate = beforeGate
        const peerSettledBeforeGate = peerBeforeGate
        commitGate.resolve()
        const result = await outcome
        const peerResult = await peerOutcome
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (peer) {
          if (release === `caller abort`)
            expect(settledBeforeGate?.status).toBe(`rejected`)
          else expect(settledBeforeGate).toBeUndefined()
          expect(peerSettledBeforeGate).toBeUndefined()
          expect(peerResult?.status).toBe(`fulfilled`)
          expect(queryFn).toHaveBeenCalledTimes(1)
          expect(collection.has(`a`)).toBe(true)
          if (release === `caller abort`) {
            expect(result.status).toBe(`rejected`)
            if (result.status === `rejected`)
              expect(result.error).toMatchObject({ name: `AbortError` })
          }
        } else {
          expect(settledBeforeGate?.status).not.toBe(`fulfilled`)
          expect(result.status).toBe(`rejected`)
          if (result.status === `rejected`)
            expect(result.error).toMatchObject({ name: `AbortError` })
          expect(collection.has(`a`)).toBe(false)
        }
      }, [
        [`commit gate`, () => commitGate.resolve()],
        [`subscription`, () => subscription.unsubscribe()],
        [`peer subscription`, () => peerSubscription?.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * Query Core publishes a new cache entry while constructing an observer.
   * Cleanup from that synchronous notification precedes Query DB's ownership
   * registration. Once cleanup settles, the obsolete Query must have no
   * observer or cache entry. The provider has not started at this boundary.
   */
  it(`retires a Query created during reentrant Collection cleanup`, async () => {
    const queryClient = createQueryClient()
    const id = `reentrant-query-added-cleanup-${collectionSequence++}`
    const queryKey = [id]
    const queryFn = vi.fn(() =>
      Promise.resolve([{ id: `late` }] satisfies Array<Row>),
    )
    const collection = createCollection(
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
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let cleanup: Promise<void> | undefined
    let observedQuery: { getObserversCount: () => number } | undefined
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        cleanup === undefined &&
        event.type === `added` &&
        event.query.queryKey[0] === id
      ) {
        observedQuery = event.query
        cleanup = collection.cleanup()
      }
    })

    await checkPublicCleanupWitness(async () => {
      subscription.requestSnapshot({})
      expect(cleanup).toBeDefined()
      await cleanup
      expect(collection.status).toBe(`cleaned-up`)
      expect(queryFn).not.toHaveBeenCalled()
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(collection.toArray).toEqual([])
      expect(queryFn).not.toHaveBeenCalled()
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
    }, [
      [`cache listener`, unsubscribeCache],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Public Collection cleanup can also run from Query Core's fetch callback.
   * The old sync run must not install an observer after cleanup has removed
   * its state. Explicit cleanup also removes its tracked Query cache entry.
   * Compare the Collection, observer, and cache after the provider finishes.
   */
  it(`does not install an observer after synchronous Collection cleanup`, async () => {
    const queryClient = createQueryClient()
    const id = `reentrant-subscribe-cleanup-${collectionSequence++}`
    const queryKey = [id]
    queryClient.setQueryData(queryKey, [{ id: `cached` } satisfies Row])
    const heldResult = createDeferred<Array<Row>>()
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn: () => heldResult.promise,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        refetchOnMount: `always`,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let cleanup: Promise<void> | undefined
    let observedQuery: { getObserversCount: () => number } | undefined
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        cleanup === undefined &&
        event.type === `updated` &&
        event.action.type === `fetch` &&
        event.query.queryKey[0] === id
      ) {
        observedQuery = event.query
        cleanup = collection.cleanup()
      }
    })
    await checkPublicCleanupWitness(async () => {
      const snapshot = Promise.resolve(subscription.requestSnapshot({}))
      void snapshot.catch(() => undefined)
      expect(cleanup).toBeDefined()
      await cleanup
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
      heldResult.resolve([{ id: `late` }])
      await snapshot.catch(() => undefined)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.toArray).toEqual([])
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
    }, [
      [`provider`, () => heldResult.resolve([])],
      [`cache listener`, unsubscribeCache],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Without cached data, initial readiness installs a temporary Query
   * observer before the main subscription. Public Collection cleanup can run
   * from its synchronous fetch notification. At cleanup settlement no Query
   * observer or tracked cache entry may remain, even when the provider ignores
   * cancellation.
   */
  it(`releases a temporary readiness observer after reentrant Collection cleanup`, async () => {
    const queryClient = createQueryClient()
    const id = `reentrant-readiness-cleanup-${collectionSequence++}`
    const queryKey = [id]
    const heldResult = createDeferred<Array<Row>>()
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn: () => heldResult.promise,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let cleanup: Promise<void> | undefined
    let observedQuery: { getObserversCount: () => number } | undefined
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        cleanup === undefined &&
        event.type === `updated` &&
        event.action.type === `fetch` &&
        event.query.queryKey[0] === id
      ) {
        observedQuery = event.query
        cleanup = collection.cleanup()
      }
    })

    await checkPublicCleanupWitness(async () => {
      const snapshot = Promise.resolve(subscription.requestSnapshot({}))
      void snapshot.catch(() => undefined)
      expect(cleanup).toBeDefined()
      await cleanup
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
      heldResult.resolve([{ id: `late` }])
      await snapshot.catch(() => undefined)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.toArray).toEqual([])
      expect(observedQuery?.getObserversCount()).toBe(0)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
    }, [
      [`provider`, () => heldResult.resolve([])],
      [`cache listener`, unsubscribeCache],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * A fetch notification may add a second public subscriber before the first
   * observer installation returns. That can overwrite an unsubscribe and
   * leave the Query observed after cleanup, despite no Collection owner.
   */
  it.each([`cached`, `uncached`] as const)(
    `does not leak a Query observer when a %s fetch callback adds a subscriber`,
    async (cacheState) => {
      const queryClient = createQueryClient()
      const id = `reentrant-subscriber-${collectionSequence++}`
      const queryKey = [id]
      if (cacheState === `cached`)
        queryClient.setQueryData(queryKey, [{ id: `cached` } satisfies Row])
      const heldResult = createDeferred<Array<Row>>()
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey,
          queryFn: () => heldResult.promise,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          startSync: true,
          refetchOnMount: `always`,
        }),
      )
      const firstSubscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      let secondSubscription: { unsubscribe: () => void } | undefined
      let addedSubscriber = false
      let observedQuery: { getObserversCount: () => number } | undefined
      const unsubscribeCache = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (
            !addedSubscriber &&
            event.type === `updated` &&
            event.action.type === `fetch` &&
            event.query.queryKey[0] === id
          ) {
            addedSubscriber = true
            observedQuery = event.query
            secondSubscription = collection.subscribeChanges(() => {}, {
              includeInitialState: false,
            })
          }
        })
      await checkPublicCleanupWitness(async () => {
        const snapshot = Promise.resolve(firstSubscription.requestSnapshot({}))
        void snapshot.catch(() => undefined)
        expect(addedSubscriber).toBe(true)
        await collection.cleanup()
        expect(observedQuery?.getObserversCount()).toBe(0)
        expect(
          queryClient.getQueryCache().find({ queryKey, exact: true }),
        ).toBeUndefined()
        heldResult.resolve([{ id: `late` }])
        await snapshot.catch(() => undefined)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(collection.toArray).toEqual([])
      }, [
        [`provider`, () => heldResult.resolve([])],
        [`cache listener`, unsubscribeCache],
        [`second subscription`, () => secondSubscription?.unsubscribe()],
        [`first subscription`, () => firstSubscription.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /** A final public subscriber can leave during the same fetch notification. */
  it(`releases a Query observer when its last subscriber leaves during installation`, async () => {
    const queryClient = createQueryClient()
    const id = `reentrant-unsubscribe-${collectionSequence++}`
    const queryKey = [id]
    queryClient.setQueryData(queryKey, [{ id: `cached` } satisfies Row])
    const heldResult = createDeferred<Array<Row>>()
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn: () => heldResult.promise,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        refetchOnMount: `always`,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let removedSubscriber = false
    let observedQuery: { getObserversCount: () => number } | undefined
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        !removedSubscriber &&
        event.type === `updated` &&
        event.action.type === `fetch` &&
        event.query.queryKey[0] === id
      ) {
        removedSubscriber = true
        observedQuery = event.query
        subscription.unsubscribe()
      }
    })
    await checkPublicCleanupWitness(async () => {
      const snapshot = Promise.resolve(subscription.requestSnapshot({}))
      void snapshot.catch(() => undefined)
      expect(removedSubscriber).toBe(true)
      expect(collection.subscriberCount).toBe(0)
      expect(observedQuery?.getObserversCount()).toBe(0)
      heldResult.resolve([{ id: `late` }])
      await snapshot.catch(() => undefined)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(observedQuery?.getObserversCount()).toBe(0)
    }, [
      [`provider`, () => heldResult.resolve([])],
      [`cache listener`, unsubscribeCache],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  it(`reuses an active complete full-source Query for a filtered demand`, async () => {
    await expectActiveFullSourceServesFilteredDemand()
  })

  it.each([
    { hasPriorDependent: false, firstRelease: `new`, unmatchedRelease: false },
    { hasPriorDependent: true, firstRelease: `new`, unmatchedRelease: false },
    { hasPriorDependent: true, firstRelease: `old`, unmatchedRelease: false },
    { hasPriorDependent: true, firstRelease: `new`, unmatchedRelease: true },
  ] as const)(
    `requires new coverage after a failed full refresh, prior dependent=$hasPriorDependent, first release=$firstRelease, unmatched release=$unmatchedRelease`,
    async ({ hasPriorDependent, firstRelease, unmatchedRelease }) => {
      await expectIneligibleFullRefreshNeedsNewCoverage(
        hasPriorDependent,
        firstRelease,
        unmatchedRelease,
      )
    },
  )

  it(`does not treat an unfinished full-source Query as filtered coverage`, async () => {
    await expectPendingFullSourceNeedsAppliedEvidence()
  })

  it.each([`full`, `exact`] as const)(
    `keeps the later-started exact value across an older full result when %s releases first`,
    async (firstRelease) => {
      await expectFullAndExactResultsKeepLaterValue(firstRelease)
    },
  )

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
    { phase: `initial`, peerJoins: true, failure: `unrelated` },
    { phase: `initial`, peerJoins: false, failure: `signal` },
    { phase: `refetch`, peerJoins: true, failure: `signal` },
    { phase: `refetch`, peerJoins: true, failure: `unrelated` },
    { phase: `refetch`, peerJoins: false, failure: `signal` },
  ] as const)(
    `settles a held $phase filtered fetch after its first owner releases, peer joins=$peerJoins, failure=$failure`,
    async ({ phase, peerJoins, failure }) => {
      await expectPeerJoiningHeldFetchSettles(phase, peerJoins, failure)
    },
  )

  it(`keeps a live request signal through another Collection's query function`, async () => {
    await expectForeignQueryFnUsesLiveSharedSignal()
  })

  it.each([false, true])(
    `keeps a shared physical signal through foreign release, final owner releases=%s`,
    async (releaseFinalOwner) => {
      await expectForeignOwnerReleaseKeepsInFlightSignal(releaseFinalOwner)
    },
  )

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

  /**
   * Direct adapter calls may reuse request data. With the same options object,
   * unload cannot name a caller, so it retires the most recent acquisition.
   * A full refresh makes the second equal demand choose an exact Query while
   * the first still owns the full Query. A returned load promise already owns
   * its lease, whether or not the exact result has settled. The first unload
   * retires that newer exact acquisition; the older filtered owner of the
   * full Query survives even after the original full-source owner leaves.
   */
  it.each([false, true])(
    `releases the newest lease when one options object spans full and exact Queries, pending exact=%s`,
    async (holdExact) => {
      const queryClient = createQueryClient()
      const id = `repeated-options-${collectionSequence++}`
      const heldFull = createDeferred<Array<Row>>()
      const heldExact = createDeferred<Array<Row>>()
      let exactSignal: AbortSignal | undefined
      const scopes: Array<`full` | `exact`> = []
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: ({ meta }) => {
            const scope = meta?.loadSubsetOptions?.where ? `exact` : `full`
            scopes.push(scope)
            if (scope === `exact`) {
              exactSignal = meta?.loadSubsetOptions?.signal
              return holdExact
                ? heldExact.promise
                : Promise.resolve([
                    { id: `a1`, group: `a` },
                    { id: `a2`, group: `a` },
                  ])
            }
            return scopes.length === 1
              ? Promise.resolve([
                  { id: `a1`, group: `a` },
                  { id: `b1`, group: `b` },
                ])
              : heldFull.promise
          },
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
        }),
      )
      const fullRequest: LoadSubsetOptions = {}
      const filteredRequest: LoadSubsetOptions = {
        where: new IR.Func<boolean>(`eq`, [
          new IR.PropRef([`group`]),
          new IR.Value(`a`),
        ]),
      }
      let fullRefresh: Promise<void> | undefined

      await checkPublicCleanupWitness(async () => {
        await collection._sync.loadSubset(fullRequest)
        await collection._sync.loadSubset(filteredRequest)
        expect(scopes).toEqual([`full`])
        fullRefresh = queryClient.refetchQueries({
          queryKey: [id],
          exact: true,
        })
        await vi.waitFor(() => expect(scopes).toEqual([`full`, `full`]))
        const exactLoad = Promise.resolve(
          collection._sync.loadSubset(filteredRequest),
        )
        void exactLoad.catch(() => undefined)
        expect(scopes).toEqual([`full`, `full`, `exact`])
        if (holdExact) {
          expect(collection.has(`a2`)).toBe(false)
        } else {
          await exactLoad
          expect(collection.has(`a2`)).toBe(true)
        }

        collection._sync.unloadSubset(filteredRequest)
        if (holdExact) {
          expect(exactSignal?.aborted).toBe(true)
          heldExact.resolve([
            { id: `a1`, group: `a` },
            { id: `a2`, group: `a` },
          ])
          await expect(exactLoad).rejects.toMatchObject({ name: `AbortError` })
        }
        expect(collection.has(`a2`)).toBe(false)
        expect(collection.has(`a1`)).toBe(true)
        collection._sync.unloadSubset(fullRequest)
        expect(collection.has(`a1`)).toBe(true)
        heldFull.resolve([
          { id: `a1`, group: `a` },
          { id: `b1`, group: `b` },
        ])
        await fullRefresh
        expect(collection.has(`a1`)).toBe(true)
        collection._sync.unloadSubset(filteredRequest)
        expect(collection.size).toBe(0)
      }, [
        [`full provider`, () => heldFull.resolve([])],
        [`exact provider`, () => heldExact.resolve([])],
        [
          `full refresh`,
          async () => {
            await fullRefresh?.catch(() => undefined)
          },
        ],
        [
          `newer filtered acquisition`,
          () => collection._sync.unloadSubset(filteredRequest),
        ],
        [
          `older filtered acquisition`,
          () => collection._sync.unloadSubset(filteredRequest),
        ],
        [`full acquisition`, () => collection._sync.unloadSubset(fullRequest)],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * Every pending direct acquisition has its own cancellation claim even when
   * callers reuse one options object and one AbortSignal. Aborting that signal
   * retires all pending claims, not merely the newest lease once. The held
   * provider crosses the abort checkpoint before returning a row. Both load
   * outcomes and the physical Query observer count before the held provider
   * settles distinguish an orphaned lease from prompt full release. Public
   * rows after provider settlement reject late unowned publication.
   * Signal consumption varies whether Query Core cancels the transport or
   * lets an unobserved result enter its cache.
   */
  it.each([
    { acquisitionCount: 2, consumesSignal: false },
    { acquisitionCount: 2, consumesSignal: true },
    { acquisitionCount: 3, consumesSignal: false },
    { acquisitionCount: 3, consumesSignal: true },
  ])(
    `retires every pending same-object acquisition on shared signal abort: %j`,
    async ({ acquisitionCount, consumesSignal }) => {
      const queryClient = createQueryClient()
      const id = `same-object-caller-abort-${collectionSequence++}`
      const caller = new AbortController()
      const request: LoadSubsetOptions = { signal: caller.signal }
      const held = createDeferred<Array<Row>>()
      let physicalSignal: AbortSignal | undefined
      const provider = vi.fn((context: QueryFunctionContext) => {
        if (consumesSignal) physicalSignal = context.signal
        return held.promise
      })
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: provider,
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
          retry: false,
        }),
      )
      await checkPublicCleanupWitness(async () => {
        const loads = Array.from({ length: acquisitionCount }, () =>
          Promise.resolve(collection._sync.loadSubset(request)),
        )
        const settlements: Array<`pending` | `fulfilled` | `rejected`> =
          Array(acquisitionCount).fill(`pending`)
        loads.forEach((load, index) => {
          void load.then(
            () => {
              settlements[index] = `fulfilled`
            },
            () => {
              settlements[index] = `rejected`
            },
          )
        })
        const physicalQuery = queryClient.getQueryCache().find({
          queryKey: [id],
          exact: true,
        })
        if (!physicalQuery) throw new Error(`The first load made no Query`)
        await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce())

        caller.abort()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(settlements).toEqual(Array(acquisitionCount).fill(`rejected`))
        expect(physicalQuery.getObserversCount()).toBe(0)
        held.resolve([{ id: `late` }])
        const outcomes = await Promise.allSettled(loads)
        expect(outcomes.map((outcome) => outcome.status)).toEqual(
          Array(acquisitionCount).fill(`rejected`),
        )
        for (const outcome of outcomes) {
          if (outcome.status === `rejected`)
            expect(outcome.reason).toMatchObject({ name: `AbortError` })
        }
        if (!consumesSignal) {
          // Query Core may cache an ignored-signal result after every caller
          // has rejected. Wait for that later boundary before checking rows.
          await vi.waitFor(() =>
            expect(physicalQuery.state.data).toEqual([{ id: `late` }]),
          )
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(physicalQuery.getObserversCount()).toBe(0)
        expect(physicalSignal?.aborted).toBe(consumesSignal ? true : undefined)
        expect(collection.toArray).toEqual([])
      }, [
        [`provider`, () => held.resolve([])],
        [
          `acquisitions`,
          () => {
            for (let i = 0; i < acquisitionCount; i++)
              collection._sync.unloadSubset(request)
          },
        ],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * A provider can read the physical Query signal lazily through request
   * metadata. That derived signal is hidden from enumerable request data even
   * when a direct caller supplied an acquisition signal. Query Core may reuse
   * the first observer's query function for a later direct or public caller,
   * so the physical Query has one metadata shape across both acquisition paths.
   * The real QueryClient path compares keys, descriptor, serialization, and
   * signal identity before provider return. Core's sync adapter still receives
   * its own enumerable acquisition signal for release.
   */
  it.each([false, true] as const)(
    `preserves provider request options, supplied signal=%s`,
    async (suppliedSignal) => {
      const queryClient = createQueryClient()
      const id = `signal-free-request-options-${collectionSequence++}`
      const caller = new AbortController()
      const request: LoadSubsetOptions = suppliedSignal
        ? { signal: caller.signal }
        : {}
      let observed = false
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: (context) => {
            const options = context.meta?.loadSubsetOptions
            expect(options).toBeDefined()
            const descriptor = Object.getOwnPropertyDescriptor(
              options,
              `signal`,
            )
            expect(descriptor).toMatchObject({
              enumerable: false,
              configurable: true,
            })
            expect(descriptor?.get).toBeTypeOf(`function`)
            expect(options?.signal).toBe(context.signal)
            if (suppliedSignal) expect(options?.signal).not.toBe(caller.signal)
            expect(Object.keys(options ?? {})).toEqual([])
            expect(structuredClone(options)).toEqual({})
            expect(JSON.stringify(options)).toBe(`{}`)
            expect(Reflect.deleteProperty(options!, `signal`)).toBe(true)
            expect(Object.keys(options ?? {})).toEqual([])
            observed = true
            return Promise.resolve([])
          },
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
        }),
      )
      await checkPublicCleanupWitness(async () => {
        await collection._sync.loadSubset(request)
        expect(observed).toBe(true)
      }, [
        [`acquisition`, () => collection._sync.unloadSubset(request)],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * Both direct→public and public→direct are legal acquisitions of one Query.
   * The first observer owns the query function reused by refetch, so metadata
   * cannot depend on which caller arrived second. At each provider invocation
   * the same hidden physical signal must be readable, while serialization
   * must contain only request data. The Query count and two provider calls
   * establish that the second acquisition actually refetched the first Query.
   */
  it.each([`direct-first`, `public-first`] as const)(
    `keeps one metadata shape across %s acquisitions`,
    async (order) => {
      const queryClient = createQueryClient()
      const id = `mixed-request-options-${order}-${collectionSequence++}`
      const directController = new AbortController()
      const publicController = new AbortController()
      const directRequest: LoadSubsetOptions = {
        signal: directController.signal,
        ...(order === `public-first` ? { refetch: true } : {}),
      }
      const observed: Array<{
        keys: Array<string>
        json: string | undefined
        cloneKeys: Array<string>
        enumerable: boolean | undefined
        physicalSignal: boolean
        callerSignal: boolean
      }> = []
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: (context) => {
            const options = context.meta?.loadSubsetOptions
            if (!options) throw new Error(`The provider received no request`)
            observed.push({
              keys: Object.keys(options),
              json: JSON.stringify(options),
              cloneKeys: Object.keys(structuredClone(options)),
              enumerable: Object.getOwnPropertyDescriptor(options, `signal`)
                ?.enumerable,
              physicalSignal: options.signal === context.signal,
              callerSignal:
                options.signal === directController.signal ||
                options.signal === publicController.signal,
            })
            return Promise.resolve([])
          },
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
        }),
      )
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const requestPublicSnapshot = async (refetch: boolean) => {
        let load: true | Promise<void> | undefined
        subscription.requestSnapshot({
          signal: publicController.signal,
          refetch,
          onLoadSubsetResult: (result) => {
            load = result
          },
        })
        await load
      }
      await checkPublicCleanupWitness(async () => {
        if (order === `direct-first`) {
          await collection._sync.loadSubset(directRequest)
          await requestPublicSnapshot(true)
        } else {
          await requestPublicSnapshot(false)
          await collection._sync.loadSubset(directRequest)
        }
        expect(
          queryClient.getQueryCache().findAll({ queryKey: [id] }),
        ).toHaveLength(1)
        expect(observed).toHaveLength(2)
        const expectedKeys =
          order === `direct-first` ? [] : [`where`, `orderBy`, `limit`]
        for (const metadata of observed) {
          expect(metadata).toEqual({
            keys: expectedKeys,
            json: `{}`,
            cloneKeys: expectedKeys,
            enumerable: false,
            physicalSignal: true,
            callerSignal: false,
          })
        }
      }, [
        [
          `direct acquisition`,
          () => collection._sync.unloadSubset(directRequest),
        ],
        [`subscription`, () => subscription.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  it.each([false, true] as const)(
    `keeps public snapshot metadata serializable, caller signal=%s`,
    async (suppliedSignal) => {
      const queryClient = createQueryClient()
      const id = `public-request-options-${collectionSequence++}`
      const caller = new AbortController()
      let observed:
        | {
            keys: Array<string>
            json: string | undefined
            enumerable: boolean
            configurable: boolean
            hasGetter: boolean
            cloneKeys: Array<string>
            matchesPhysicalSignal: boolean
            differsFromCallerSignal: boolean
            deleteSucceeds: boolean
            keysAfterDelete: Array<string>
          }
        | undefined
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: (context) => {
            const options = context.meta?.loadSubsetOptions
            if (!options) throw new Error(`The provider received no request`)
            const descriptor = Object.getOwnPropertyDescriptor(
              options,
              `signal`,
            )
            const clone = structuredClone(options)
            observed = {
              keys: Object.keys(options),
              json: JSON.stringify(options),
              enumerable: descriptor?.enumerable ?? false,
              configurable: descriptor?.configurable ?? false,
              hasGetter: typeof descriptor?.get === `function`,
              cloneKeys: Object.keys(clone),
              matchesPhysicalSignal: options.signal === context.signal,
              differsFromCallerSignal: options.signal !== caller.signal,
              deleteSucceeds: Reflect.deleteProperty(options, `signal`),
              keysAfterDelete: Object.keys(options),
            }
            return Promise.resolve([])
          },
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
        }),
      )
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      return checkPublicCleanupWitness(async () => {
        let load: true | Promise<void> | undefined
        subscription.requestSnapshot({
          ...(suppliedSignal ? { signal: caller.signal } : {}),
          onLoadSubsetResult: (result) => {
            load = result
          },
        })
        await load
        expect(observed).toEqual({
          keys: [`where`, `orderBy`, `limit`],
          json: `{}`,
          enumerable: false,
          configurable: true,
          hasGetter: true,
          cloneKeys: [`where`, `orderBy`, `limit`],
          matchesPhysicalSignal: true,
          differsFromCallerSignal: true,
          deleteSucceeds: true,
          keysAfterDelete: [`where`, `orderBy`, `limit`],
        })
      }, [
        [`subscription`, () => subscription.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  it(`keeps an ignored public snapshot fetch in Query cache after serializing signal-free metadata`, async () => {
    const queryClient = createQueryClient()
    const id = `public-metadata-lazy-signal-${collectionSequence++}`
    const started = createDeferred<void>()
    const held = createDeferred<Array<Row>>()
    let serialized: string | undefined
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: (context) => {
          serialized = JSON.stringify(context.meta?.loadSubsetOptions)
          started.resolve()
          return held.promise
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        retry: false,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    return checkPublicCleanupWitness(async () => {
      subscription.requestSnapshot()
      await started.promise
      expect(serialized).toBe(`{}`)
      subscription.unsubscribe()
      held.resolve([{ id: `cached` }])
      await vi.waitFor(() =>
        expect(queryClient.getQueryData([id])).toEqual([{ id: `cached` }]),
      )
      expect(collection.toArray).toEqual([])
    }, [
      [`provider`, () => held.resolve([])],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Eager ownership survives Query cache eviction. An explicit refetch must
   * start a new provider request from that state, even with no Collection
   * subscriber currently asking for rows.
   */
  it(`refetches an eager Collection after its Query leaves the cache`, async () => {
    const queryClient = createQueryClient()
    const id = `eager-refetch-after-eviction-${collectionSequence++}`
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `before` }])
      .mockResolvedValueOnce([{ id: `after` }])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (row) => row.id,
        startSync: true,
      }),
    )
    return checkPublicCleanupWitness(async () => {
      await collection.preload()
      expect(collection.has(`before`)).toBe(true)
      expect(collection.subscriberCount).toBe(0)
      queryClient.removeQueries({ queryKey: [id], exact: true })
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(
        queryClient.getQueryCache().find({ queryKey: [id], exact: true }),
      ).toBeUndefined()
      await collection.utils.refetch()
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.has(`after`)).toBe(true)
    }, [
      ['await collection.cleanup()', () => collection.cleanup()],
      ['queryClient.clear()', () => queryClient.clear()],
    ])
  })

  /**
   * Query Core's finite gcTime can evict an eager Query after the final public
   * subscriber leaves. The Collection still owns eager source work, so a later
   * utils.refetch() must create a Query, call the provider, and apply its row.
   * The preceding explicit-removal case does not exercise Query Core's timer.
   */
  it(`refetches an eager Collection after automatic Query GC`, async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const id = `eager-refetch-after-gc-${collectionSequence++}`
    const queryKey = [id]
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: `before` }])
      .mockResolvedValueOnce([{ id: `after` }])
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (row) => row.id,
        gcTime: 10,
        startSync: true,
      }),
    )
    await checkPublicCleanupWitness(async () => {
      await collection.preload()
      expect(collection.has(`before`)).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })
      expect(query?.getObserversCount()).toBeGreaterThan(0)
      vi.useFakeTimers()
      subscription.unsubscribe()
      await Promise.resolve()
      expect(collection.subscriberCount).toBe(0)
      expect(query?.getObserversCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(11)
      expect(
        queryClient.getQueryCache().find({ queryKey, exact: true }),
      ).toBeUndefined()
      vi.useRealTimers()

      await collection.utils.refetch()
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(collection.has(`after`)).toBe(true)
    }, [
      [`timers`, () => vi.useRealTimers()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * The generated lease grammar starts one real public snapshot against a
   * held provider, optionally joins an equal peer, then retires the first
   * caller by signal, subscription release, both orders, or Collection
   * cleanup. A peer may also release while the provider is held. The provider
   * succeeds or fails only after those actions. Joining after final release
   * is excluded: it would start a different physical fetch and needs a
   * second-result model. Both release orders exercise idempotence at distinct
   * adapter boundaries.
   *
   * The independent model below counts active callers, not Query observers or
   * Query DB owner maps. An active caller gets the source result; an explicit
   * caller abort rejects its still-owned load. The raw adapter promise handed
   * to onLoadSubsetResult has no specified caller outcome after unsubscribe or
   * Collection cleanup. When both happen in one turn, Core's synchronous
   * release can precede Query DB's queued abort handling in either authored
   * order. Those outcome fields are omitted from comparison.
   * A successful source row is public exactly while a caller still owns it.
   * A consumed physical signal aborts only when no caller remains. The driver
   * compares load outcomes where promised and complete Collection rows before
   * delivery, after settlement, after the first subscriber releases, and
   * after the peer releases. The intermediate checkpoint rejects a duplicate
   * release that steals the peer's row. A peer release before provider
   * settlement checks that an already aborted caller has no hidden observer
   * lease. Query call count and a consumed physical signal show which path
   * ran. The fixed ignored-signal cache witness above owns the installed
   * Query Core behavior; an unobserved request is permitted to finish without
   * retaining cache data. This initial-fetch grammar does not cover accepted
   * commits, refetch, or synchronous callback reentry.
   */
  type LeaseHistory = {
    peer: boolean
    peerReleaseBeforeProvider?: boolean
    consumesSignal: boolean
    firstAction:
      | `none`
      | `unload`
      | `abort`
      | `abort-then-unload`
      | `unload-then-abort`
      | `cleanup`
    providerOutcome: `success` | `error`
  }

  function expectedLeaseHistory(history: LeaseHistory) {
    const firstActive = history.firstAction === `none`
    const peerActive =
      history.peer &&
      history.firstAction !== `cleanup` &&
      !history.peerReleaseBeforeProvider
    const sourceSucceeded = history.providerOutcome === `success`
    const firstOutcomePromised = firstActive || history.firstAction === `abort`
    return {
      beforeProviderRows: [] as Array<string>,
      ...(history.consumesSignal
        ? { physicalAborted: !firstActive && !peerActive }
        : {}),
      ...(firstOutcomePromised
        ? {
            firstOutcome: firstActive
              ? sourceSucceeded
                ? `fulfilled`
                : `provider-error`
              : `AbortError`,
          }
        : {}),
      ...(peerActive
        ? { peerOutcome: sourceSucceeded ? `fulfilled` : `provider-error` }
        : {}),
      afterProviderRows:
        sourceSucceeded && (firstActive || peerActive) ? [`server`] : [],
      afterFirstReleaseRows: sourceSucceeded && peerActive ? [`server`] : [],
      afterFinalReleaseRows: [] as Array<string>,
      providerCalls: 1,
      collectionStatus:
        history.firstAction === `cleanup` ? `cleaned-up` : `ready`,
    }
  }

  async function observeLeaseHistory(
    history: LeaseHistory,
    expected: ReturnType<typeof expectedLeaseHistory>,
  ) {
    const queryClient = createQueryClient()
    const id = `generated-lease-history-${collectionSequence++}`
    const started = createDeferred<void>()
    const held = createDeferred<Array<Row>>()
    const providerError = new Error(`provider failed`)
    let physicalSignal: AbortSignal | undefined
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      if (history.consumesSignal) physicalSignal = context.signal
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
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const peer = history.peer
      ? collection.subscribeChanges(() => {}, { includeInitialState: false })
      : undefined
    const caller = new AbortController()
    let firstLoad: true | Promise<void> | undefined
    let peerLoad: true | Promise<void> | undefined
    return checkPublicCleanupWitness(async () => {
      first.requestSnapshot({
        signal: caller.signal,
        onLoadSubsetResult: (load) => {
          firstLoad = load
        },
      })
      await started.promise
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The first acquisition did not return a pending load`)
      void firstLoad.catch(() => undefined)
      peer?.requestSnapshot({
        onLoadSubsetResult: (load) => {
          peerLoad = load
        },
      })
      if (history.peer && (peerLoad === undefined || peerLoad === true))
        throw new Error(`The peer did not join the pending load`)
      if (peerLoad && peerLoad !== true) void peerLoad.catch(() => undefined)

      switch (history.firstAction) {
        case `none`:
          break
        case `unload`:
          first.unsubscribe()
          break
        case `abort`:
          caller.abort()
          break
        case `abort-then-unload`:
          caller.abort()
          first.unsubscribe()
          break
        case `unload-then-abort`:
          first.unsubscribe()
          caller.abort()
          break
        case `cleanup`:
          await collection.cleanup()
          break
      }
      if (history.peerReleaseBeforeProvider) peer?.unsubscribe()

      // Core propagates a caller abort to its acquisition in a microtask.
      await Promise.resolve()
      const beforeProviderRows = collection.toArray.map((row) => row.id).sort()
      const physicalAborted = physicalSignal?.aborted
      if (history.providerOutcome === `success`)
        held.resolve([{ id: `server` }])
      else held.reject(providerError)
      const outcome = async (load: true | Promise<void> | undefined) => {
        try {
          await load
          return `fulfilled`
        } catch (error) {
          if (error === providerError) return `provider-error`
          return error instanceof Error ? error.name : `non-Error rejection`
        }
      }
      const firstOutcome =
        history.firstAction === `none` || history.firstAction === `abort`
          ? await outcome(firstLoad)
          : undefined
      const peerOutcome =
        history.peer &&
        history.firstAction !== `cleanup` &&
        !history.peerReleaseBeforeProvider
          ? await outcome(peerLoad)
          : undefined
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const afterProviderRows = collection.toArray.map((row) => row.id).sort()
      first.unsubscribe()
      const afterFirstReleaseRows = collection.toArray
        .map((row) => row.id)
        .sort()
      peer?.unsubscribe()
      const afterFinalReleaseRows = collection.toArray
        .map((row) => row.id)
        .sort()
      const observed = {
        beforeProviderRows,
        ...(history.consumesSignal ? { physicalAborted } : {}),
        ...(history.firstAction === `none` || history.firstAction === `abort`
          ? { firstOutcome }
          : {}),
        ...(history.peer &&
        history.firstAction !== `cleanup` &&
        !history.peerReleaseBeforeProvider
          ? { peerOutcome }
          : {}),
        afterProviderRows,
        afterFirstReleaseRows,
        afterFinalReleaseRows,
        providerCalls: queryFn.mock.calls.length,
        collectionStatus: collection.status,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`provider`, () => held.resolve([])],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const leaseHistoryArbitrary = fc
    .record({
      peer: fc.boolean(),
      peerReleaseBeforeProvider: fc.boolean(),
      consumesSignal: fc.boolean(),
      firstAction: fc.constantFrom<LeaseHistory[`firstAction`]>(
        `none`,
        `unload`,
        `abort`,
        `abort-then-unload`,
        `unload-then-abort`,
        `cleanup`,
      ),
      providerOutcome: fc.constantFrom<LeaseHistory[`providerOutcome`]>(
        `success`,
        `error`,
      ),
    })
    .filter(
      (history) =>
        !history.peerReleaseBeforeProvider ||
        (history.peer && history.firstAction !== `cleanup`),
    )
  const leaseHistoryProperty = `query-db.lease-history`
  const leaseHistoryReplay = readOracleRunConfig()

  // Each named history reaches one boundary that an independent axis changes:
  // a peer preserves the physical fetch and row; signal consumption controls
  // transport abort; source failure changes an active caller's outcome; both
  // double-release orders must leave the peer's row after the first subscriber
  // releases, then remove it on the peer's release. Cleanup removes both leases
  // and changes the public Collection status.
  const namedLeaseHistories = [
    {
      peer: false,
      consumesSignal: false,
      firstAction: `none`,
      providerOutcome: `success`,
    },
    {
      peer: false,
      consumesSignal: true,
      firstAction: `abort`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      consumesSignal: true,
      firstAction: `abort`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      peerReleaseBeforeProvider: true,
      consumesSignal: true,
      firstAction: `abort`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      peerReleaseBeforeProvider: true,
      consumesSignal: false,
      firstAction: `abort`,
      providerOutcome: `success`,
    },
    {
      peer: false,
      consumesSignal: false,
      firstAction: `unload`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      consumesSignal: false,
      firstAction: `abort-then-unload`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      consumesSignal: false,
      firstAction: `unload-then-abort`,
      providerOutcome: `success`,
    },
    {
      peer: true,
      consumesSignal: true,
      firstAction: `cleanup`,
      providerOutcome: `error`,
    },
    {
      peer: false,
      consumesSignal: true,
      firstAction: `none`,
      providerOutcome: `error`,
    },
  ] satisfies ReadonlyArray<LeaseHistory>

  it.each(namedLeaseHistories)(
    `reconstructs a named lease history: %j`,
    async (history) => {
      await observeLeaseHistory(history, expectedLeaseHistory(history))
    },
  )

  it(`refines generated caller and peer lease histories`, async () => {
    if (
      leaseHistoryReplay.replayPath !== undefined &&
      leaseHistoryReplay.replayProperty !== leaseHistoryProperty
    )
      return
    const property = fc.asyncProperty(
      leaseHistoryArbitrary,
      async (history) => {
        await observeLeaseHistory(history, expectedLeaseHistory(history))
      },
    )
    const options = oraclePropertyOptions(48, leaseHistoryProperty)
    if (leaseHistoryReplay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_162_2026 })
    await fc.assert(property, options)
  })

  /**
   * A public refetch is a new acquisition even when an earlier subscription
   * still owns the same Query. The caller's abort retires only that new
   * acquisition. A baseline or equal peer keeps the physical fetch alive and
   * receives its source result. When all owners leave, a consumed Query signal
   * aborts; an ignored signal may complete without publishing an unowned row.
   * A provider failure leaves the last applied source row for live owners.
   *
   * The independent account counts the three public subscriptions and uses
   * the scripted source answer. It does not inspect Query DB's lease registry.
   * These legal histories vary the refetch caller's release, baseline release,
   * an equal peer that may leave before the answer or first after it, signal
   * consumption, and provider success or failure. The baseline may release
   * before or after a caller abort. Peer-first and caller-first final release
   * are both legal. A
   * passive public change listener records any source-row publication after
   * the last lease leaves, including a transient insert later removed. The
   * real path is `requestSnapshot({ refetch: true, signal })`, not a direct
   * adapter call. A caller abort is compared while the provider is still held;
   * rows and ownership are compared again after the provider settles and each
   * remaining owner releases. The raw adapter promise after unsubscribe
   * or Collection cleanup has no promised outcome. This bounded grammar does
   * not model a second refetch or an accepted sync transaction. It excludes
   * peer release without a peer, reverse early-release order without an early
   * peer release, and refetch before the baseline request applies.
   */
  type RefetchLeaseHistory = {
    action:
      | `none`
      | `abort`
      | `unload`
      | `abort-then-unload`
      | `unload-then-abort`
      | `cleanup`
    releaseBaseline: boolean
    releaseBaselineAfterAction?: boolean
    peer: boolean
    releasePeerBeforeAnswer: boolean
    releasePeerFirst?: boolean
    releasePeerAfterAnswerFirst?: boolean
    consumesSignal: boolean
    outcome: `success` | `error`
  }

  function expectedRefetchLease(history: RefetchLeaseHistory) {
    const liveBaseline =
      !history.releaseBaseline && history.action !== `cleanup`
    const liveCaller = history.action === `none`
    const livePeer =
      history.peer &&
      history.action !== `cleanup` &&
      !history.releasePeerBeforeAnswer
    const livePeerAfterAnswer = livePeer && !history.releasePeerAfterAnswerFirst
    const sourceRow = history.outcome === `success` ? `new` : `old`
    const rows = (live: boolean) => (live ? [sourceRow] : [])
    return {
      initialRows: [`old`],
      beforeAnswerRows: liveBaseline || liveCaller || livePeer ? [`old`] : [],
      ...(history.action === `none` || history.action === `abort`
        ? {
            callerOutcomeBeforeAnswer:
              history.action === `abort` ? `AbortError` : `pending`,
          }
        : {}),
      ...(history.consumesSignal
        ? { physicalAborted: !liveBaseline && !liveCaller && !livePeer }
        : {}),
      observerBeforeAnswer: liveBaseline || liveCaller || livePeer ? 1 : 0,
      ...(history.action === `none` || history.action === `abort`
        ? {
            callerOutcome:
              history.action === `abort`
                ? `AbortError`
                : history.outcome === `success`
                  ? `fulfilled`
                  : `provider-error`,
          }
        : {}),
      afterAnswerRows: rows(liveBaseline || liveCaller || livePeer),
      ...(history.releasePeerAfterAnswerFirst
        ? {
            afterEarlyPeerReleaseRows: rows(liveBaseline || liveCaller),
            observerAfterEarlyPeerRelease: liveBaseline || liveCaller ? 1 : 0,
          }
        : {}),
      afterCallerReleaseRows: rows(liveBaseline || livePeerAfterAnswer),
      observerAfterCallerRelease: liveBaseline || livePeerAfterAnswer ? 1 : 0,
      afterBaselineReleaseRows: rows(livePeerAfterAnswer),
      observerAfterBaselineRelease: livePeerAfterAnswer ? 1 : 0,
      afterPeerReleaseRows: [] as Array<string>,
      observerAfterPeerRelease: 0,
      statusAfterAction: history.action === `cleanup` ? `cleaned-up` : `ready`,
      statusAfterAnswer: history.action === `cleanup` ? `cleaned-up` : `ready`,
      recorderSawBaselineInsert: true,
      unownedPublicationEvents: [] as Array<string>,
      providerCalls: 2,
    }
  }

  async function observeRefetchLease(
    history: RefetchLeaseHistory,
    expected: ReturnType<typeof expectedRefetchLease>,
  ) {
    const queryClient = createQueryClient()
    const id = `refetch-lease-history-${collectionSequence++}`
    const started = createDeferred<void>()
    const held = createDeferred<Array<Row>>()
    const providerError = new Error(`refetch provider failed`)
    let physicalSignal: AbortSignal | undefined
    let providerCalls = 0
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      providerCalls++
      if (providerCalls === 1) return Promise.resolve([{ id: `old` }])
      if (providerCalls > 2)
        return Promise.resolve([{ id: `unexpected-replacement` }])
      if (history.consumesSignal) physicalSignal = context.signal
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
        startSync: true,
        syncMode: `on-demand`,
        retry: false,
      }),
    )
    const liveOwners = { baseline: false, caller: false, peer: false }
    let recorderSawBaselineInsert = false
    const unownedPublicationEvents: Array<string> = []
    const recorder = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.key === `old` && change.type === `insert`)
            recorderSawBaselineInsert = true
          if (liveOwners.baseline || liveOwners.caller || liveOwners.peer)
            continue
          if (change.type !== `delete`)
            unownedPublicationEvents.push(
              `${change.type}:${String(change.key)}`,
            )
        }
      },
      {
        includeInitialState: false,
      },
    )
    const baseline = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const caller = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const peer = history.peer
      ? collection.subscribeChanges(() => {}, { includeInitialState: false })
      : undefined
    const callerSignal = new AbortController()
    let baselineLoad: true | Promise<void> | undefined
    let callerLoad: true | Promise<void> | undefined
    const publicRows = () => collection.toArray.map((row) => row.id).sort()
    let trackedQuery = queryClient
      .getQueryCache()
      .find({ queryKey: [id], exact: true })
    const observerCount = () => trackedQuery?.getObserversCount() ?? 0
    const loadOutcome = async (load: true | Promise<void> | undefined) => {
      try {
        await load
        return `fulfilled`
      } catch (error) {
        if (error === providerError) return `provider-error`
        return error instanceof Error ? error.name : `non-Error rejection`
      }
    }

    return checkPublicCleanupWitness(async () => {
      liveOwners.baseline = true
      baseline.requestSnapshot({
        onLoadSubsetResult: (result) => {
          baselineLoad = result
        },
      })
      await baselineLoad
      trackedQuery = queryClient
        .getQueryCache()
        .find({ queryKey: [id], exact: true })
      if (!trackedQuery) throw new Error(`The baseline has no physical Query`)
      const initialRows = publicRows()
      caller.requestSnapshot({
        refetch: true,
        signal: callerSignal.signal,
        onLoadSubsetResult: (result) => {
          callerLoad = result
        },
      })
      if (callerLoad === undefined || callerLoad === true)
        throw new Error(`The public refetch did not return a pending load`)
      liveOwners.caller = true
      let callerOutcomeBeforeAnswer = `pending`
      void callerLoad.then(
        () => {
          callerOutcomeBeforeAnswer = `fulfilled`
        },
        (error: unknown) => {
          callerOutcomeBeforeAnswer =
            error instanceof Error ? error.name : `non-Error rejection`
        },
      )
      await started.promise
      peer?.requestSnapshot()
      liveOwners.peer = peer !== undefined
      if (history.releaseBaseline && !history.releaseBaselineAfterAction) {
        liveOwners.baseline = false
        baseline.unsubscribe()
      }
      if (history.releasePeerBeforeAnswer && history.releasePeerFirst) {
        liveOwners.peer = false
        peer?.unsubscribe()
      }
      switch (history.action) {
        case `none`:
          break
        case `abort`:
          liveOwners.caller = false
          callerSignal.abort()
          break
        case `unload`:
          liveOwners.caller = false
          caller.unsubscribe()
          break
        case `abort-then-unload`:
          liveOwners.caller = false
          callerSignal.abort()
          caller.unsubscribe()
          break
        case `unload-then-abort`:
          liveOwners.caller = false
          caller.unsubscribe()
          callerSignal.abort()
          break
        case `cleanup`:
          liveOwners.baseline = false
          liveOwners.caller = false
          liveOwners.peer = false
          await collection.cleanup()
          break
      }
      if (history.releaseBaselineAfterAction) {
        liveOwners.baseline = false
        baseline.unsubscribe()
      }
      if (history.releasePeerBeforeAnswer && !history.releasePeerFirst) {
        liveOwners.peer = false
        peer?.unsubscribe()
      }
      const statusAfterAction = collection.status
      // Flush the adapter, caller wrapper, and Core observation turns while
      // the provider is still held. A single microtask misses early settlement.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const beforeAnswerRows = publicRows()
      const callerOutcomeBeforeAnswerObserved = callerOutcomeBeforeAnswer
      const physicalAborted = physicalSignal?.aborted
      const observerBeforeAnswer = observerCount()
      if (history.outcome === `success`) held.resolve([{ id: `new` }])
      else held.reject(providerError)
      const callerOutcome =
        history.action === `none` || history.action === `abort`
          ? await loadOutcome(callerLoad)
          : undefined
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const afterAnswerRows = publicRows()
      const statusAfterAnswer = collection.status
      if (history.releasePeerAfterAnswerFirst) {
        liveOwners.peer = false
        peer?.unsubscribe()
      }
      const afterEarlyPeerReleaseRows = history.releasePeerAfterAnswerFirst
        ? publicRows()
        : undefined
      const observerAfterEarlyPeerRelease = history.releasePeerAfterAnswerFirst
        ? observerCount()
        : undefined
      liveOwners.caller = false
      caller.unsubscribe()
      const afterCallerReleaseRows = publicRows()
      const observerAfterCallerRelease = observerCount()
      liveOwners.baseline = false
      baseline.unsubscribe()
      const afterBaselineReleaseRows = publicRows()
      const observerAfterBaselineRelease = observerCount()
      liveOwners.peer = false
      peer?.unsubscribe()
      const afterPeerReleaseRows = publicRows()
      const observerAfterPeerRelease = observerCount()
      const observed = {
        initialRows,
        beforeAnswerRows,
        ...(history.action === `none` || history.action === `abort`
          ? { callerOutcomeBeforeAnswer: callerOutcomeBeforeAnswerObserved }
          : {}),
        ...(history.consumesSignal ? { physicalAborted } : {}),
        observerBeforeAnswer,
        ...(history.action === `none` || history.action === `abort`
          ? { callerOutcome }
          : {}),
        afterAnswerRows,
        ...(history.releasePeerAfterAnswerFirst
          ? { afterEarlyPeerReleaseRows, observerAfterEarlyPeerRelease }
          : {}),
        afterCallerReleaseRows,
        observerAfterCallerRelease,
        afterBaselineReleaseRows,
        observerAfterBaselineRelease,
        afterPeerReleaseRows,
        observerAfterPeerRelease,
        statusAfterAction,
        statusAfterAnswer,
        recorderSawBaselineInsert,
        unownedPublicationEvents,
        providerCalls,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`provider`, () => held.resolve([])],
      [`baseline subscription`, () => baseline.unsubscribe()],
      [`refetch subscription`, () => caller.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`public event recorder`, () => recorder.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const namedRefetchLeaseHistories = [
    {
      action: `none`,
      releaseBaseline: false,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: false,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: true,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: true,
      releaseBaselineAfterAction: true,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: true,
      peer: true,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: false,
      peer: true,
      releasePeerBeforeAnswer: false,
      releasePeerAfterAnswerFirst: true,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: true,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: false,
      outcome: `success`,
    },
    {
      action: `unload`,
      releaseBaseline: true,
      peer: true,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `error`,
    },
    {
      action: `abort-then-unload`,
      releaseBaseline: false,
      peer: true,
      releasePeerBeforeAnswer: false,
      consumesSignal: false,
      outcome: `success`,
    },
    {
      action: `cleanup`,
      releaseBaseline: true,
      peer: true,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `none`,
      releaseBaseline: true,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `error`,
    },
    {
      action: `unload-then-abort`,
      releaseBaseline: false,
      peer: true,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `abort`,
      releaseBaseline: true,
      peer: true,
      releasePeerBeforeAnswer: true,
      releasePeerFirst: true,
      consumesSignal: true,
      outcome: `success`,
    },
    {
      action: `cleanup`,
      releaseBaseline: true,
      peer: true,
      releasePeerBeforeAnswer: true,
      releasePeerFirst: true,
      consumesSignal: true,
      outcome: `success`,
    },
  ] satisfies ReadonlyArray<RefetchLeaseHistory>

  it.each(namedRefetchLeaseHistories)(
    `reconstructs a public refetch lease history: %j`,
    async (history) => {
      await observeRefetchLease(history, expectedRefetchLease(history))
    },
  )

  it(`refines generated public refetch lease histories`, async () => {
    const propertyName = `query-db.refetch-lease-history`
    const replay = readOracleRunConfig()
    if (
      replay.replayPath !== undefined &&
      replay.replayProperty !== propertyName
    )
      return
    const arbitrary = fc.record({
      action: fc.constantFrom<RefetchLeaseHistory[`action`]>(
        `none`,
        `abort`,
        `unload`,
        `abort-then-unload`,
        `unload-then-abort`,
        `cleanup`,
      ),
      releaseBaseline: fc.boolean(),
      releaseBaselineAfterAction: fc.boolean(),
      peer: fc.boolean(),
      releasePeerBeforeAnswer: fc.boolean(),
      releasePeerFirst: fc.boolean(),
      releasePeerAfterAnswerFirst: fc.boolean(),
      consumesSignal: fc.boolean(),
      outcome: fc.constantFrom<RefetchLeaseHistory[`outcome`]>(
        `success`,
        `error`,
      ),
    })
    const legalArbitrary = arbitrary.filter(
      (history) =>
        (!history.releasePeerBeforeAnswer || history.peer) &&
        (!history.releasePeerFirst || history.releasePeerBeforeAnswer) &&
        (!history.releasePeerAfterAnswerFirst ||
          (history.peer &&
            !history.releasePeerBeforeAnswer &&
            history.action !== `cleanup`)) &&
        (!history.releaseBaselineAfterAction ||
          (history.releaseBaseline && history.action === `abort`)),
    )
    const property = fc.asyncProperty(legalArbitrary, async (history) => {
      await observeRefetchLease(history, expectedRefetchLease(history))
    })
    const options = oraclePropertyOptions(48, propertyName)
    if (replay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_162_2028 })
    await fc.assert(property, options)
  }, 20_000)

  it(`rejects delayed caller abort, transient publication, and missed cleanup`, async () => {
    const abandoned: RefetchLeaseHistory = {
      action: `abort`,
      releaseBaseline: true,
      releaseBaselineAfterAction: true,
      peer: false,
      releasePeerBeforeAnswer: false,
      consumesSignal: true,
      outcome: `success`,
    }
    const expectedAbandoned = expectedRefetchLease(abandoned)
    const observedAbandoned = await observeRefetchLease(
      abandoned,
      expectedAbandoned,
    )
    expect(() =>
      expect({
        ...observedAbandoned,
        callerOutcomeBeforeAnswer: `pending`,
      }).toEqual(expectedAbandoned),
    ).toThrow()
    expect(() =>
      expect({
        ...observedAbandoned,
        unownedPublicationEvents: [`insert:new`],
      }).toEqual(expectedAbandoned),
    ).toThrow()
    expect(() =>
      expect({
        ...observedAbandoned,
        unownedPublicationEvents: [`insert:old`],
      }).toEqual(expectedAbandoned),
    ).toThrow()

    const cleaned: RefetchLeaseHistory = {
      ...abandoned,
      action: `cleanup`,
      releaseBaselineAfterAction: false,
    }
    const expectedCleaned = expectedRefetchLease(cleaned)
    const observedCleaned = await observeRefetchLease(cleaned, expectedCleaned)
    expect(() =>
      expect({ ...observedCleaned, statusAfterAction: `ready` }).toEqual(
        expectedCleaned,
      ),
    ).toThrow()

    const peerFirst: RefetchLeaseHistory = {
      action: `abort`,
      releaseBaseline: false,
      peer: true,
      releasePeerBeforeAnswer: false,
      releasePeerAfterAnswerFirst: true,
      consumesSignal: true,
      outcome: `success`,
    }
    const expectedPeerFirst = expectedRefetchLease(peerFirst)
    const observedPeerFirst = await observeRefetchLease(
      peerFirst,
      expectedPeerFirst,
    )
    expect(() =>
      expect({
        ...observedPeerFirst,
        afterEarlyPeerReleaseRows: [],
      }).toEqual(expectedPeerFirst),
    ).toThrow()
  })

  /**
   * One subscription may request an applied baseline and then a fresh
   * refetch. Aborting only the refetch's caller signal retires that attempt,
   * not the baseline acquisition lease owned by the same subscription. The
   * real public requestSnapshot path must keep the old row and Query observer
   * while the provider is held; the provider's later row may refresh that
   * baseline. Releasing only the baseline acquisition while the subscription
   * stays mounted then removes the row and observer; that distinguishes the
   * baseline lease from a wrongly retained aborted-refetch lease. This witness differs
   * from the grammar above, which assigns baseline and refetch to separate
   * subscriptions. It does not claim a result for a raw adapter promise after
   * unsubscribe.
   */
  it(`keeps one subscription's baseline lease after aborting its refetch`, async () => {
    const queryClient = createQueryClient()
    const id = `same-subscription-refetch-abort-${collectionSequence++}`
    const refetchStarted = createDeferred<void>()
    const heldRefetch = createDeferred<Array<Row>>()
    let physicalSignal: AbortSignal | undefined
    let providerCalls = 0
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: (context) => {
          providerCalls++
          if (providerCalls === 1) return Promise.resolve([{ id: `old` }])
          physicalSignal = context.signal
          refetchStarted.resolve()
          return heldRefetch.promise
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        retry: false,
      }),
    )
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const caller = new AbortController()
    let baselineLoad: true | Promise<void> | undefined
    let releaseBaseline: (() => void) | undefined
    let refetchLoad: true | Promise<void> | undefined
    const publicRows = () => collection.toArray.map((row) => row.id).sort()

    await checkPublicCleanupWitness(async () => {
      subscription.requestSnapshot({
        onLoadSubsetResult: (result, _options, release) => {
          baselineLoad = result
          releaseBaseline = release
        },
      })
      await baselineLoad
      const physicalQuery = queryClient
        .getQueryCache()
        .find({ queryKey: [id], exact: true })
      if (!physicalQuery) throw new Error(`The baseline has no physical Query`)

      subscription.requestSnapshot({
        refetch: true,
        signal: caller.signal,
        onLoadSubsetResult: (result) => {
          refetchLoad = result
        },
      })
      if (refetchLoad === undefined || refetchLoad === true)
        throw new Error(`The refetch did not return a pending load`)
      const refetchOutcome = refetchLoad.then(
        () => `fulfilled`,
        (error: unknown) =>
          error instanceof Error ? error.name : `non-Error rejection`,
      )
      let refetchOutcomeBeforeAnswer = `pending`
      void refetchOutcome.then((outcome) => {
        refetchOutcomeBeforeAnswer = outcome
      })
      await refetchStarted.promise
      caller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect({
        rows: publicRows(),
        physicalAborted: physicalSignal?.aborted,
        observers: physicalQuery.getObserversCount(),
        refetchOutcomeBeforeAnswer,
      }).toEqual({
        rows: [`old`],
        physicalAborted: false,
        observers: 1,
        refetchOutcomeBeforeAnswer: `AbortError`,
      })

      heldRefetch.resolve([{ id: `new` }])
      expect(await refetchOutcome).toBe(`AbortError`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect({ rows: publicRows(), providerCalls }).toEqual({
        rows: [`new`],
        providerCalls: 2,
      })
      if (!releaseBaseline)
        throw new Error(`The baseline acquisition has no release callback`)
      releaseBaseline()
      const afterBaselineRelease = {
        rows: publicRows(),
        observers: physicalQuery.getObserversCount(),
      }
      const expectedAfterBaselineRelease = { rows: [], observers: 0 }
      expect(afterBaselineRelease).toEqual(expectedAfterBaselineRelease)
      expect(() =>
        expect({ rows: [`new`], observers: 1 }).toEqual(
          expectedAfterBaselineRelease,
        ),
      ).toThrow()
      subscription.unsubscribe()
      expect({
        rows: publicRows(),
        observers: physicalQuery.getObserversCount(),
      }).toEqual({ rows: [], observers: 0 })
    }, [
      [`provider`, () => heldRefetch.resolve([])],
      [`subscription`, () => subscription.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * A peer acquired synchronously from a release callback owns its pending
   * load, even if the old physical Query has no observer for an instant. The
   * independent model knows the scripted source rows and the two public
   * subscription lifetimes. Query Core keeps an ignored-signal fetch alive
   * after observer removal, but cancels a consumed-signal fetch and starts a
   * replacement for the new peer. The replacement returns the same keys with
   * a distinct value, so the peer's settlement also checks which physical
   * result supplied them. Its rows remain public through its own release.
   *
   * The legal grammar crosses caller abort with Query-cache observer removal,
   * one or two source rows, and a provider that consumes or ignores the Query
   * signal and both caller-abort release orders. The driver holds the first
   * provider, enters the callback through public abort or unsubscribe, then
   * compares the new load's outcome and exact public rows at settlement and
   * after each release. It also checks Query-cache observer counts,
   * physical request count and the consumed first Query signal. Caller abort
   * also varies which subscription releases first after settlement: its own
   * acquisition has already retired, so the peer's release must leave no row
   * or Query observer even while the aborted subscription object remains.
   * The callback count is reach evidence.
   * Source failure, an already accepted result, and two reentrant peers are
   * separate grammars or remaining cells.
   */
  type PendingReentryHistory = {
    cut: `caller-abort` | `observer-removal`
    rowCount: 1 | 2
    consumesSignal: boolean
    releaseOrder: `first` | `peer`
  }

  function expectedPendingReentry(history: PendingReentryHistory) {
    const source =
      history.cut === `observer-removal` && history.consumesSignal
        ? `replacement`
        : `first`
    const sourceRows =
      history.rowCount === 1 ? [`a:${source}`] : [`a:${source}`, `b:${source}`]
    const peerReleasesFirst = history.releaseOrder === `peer`
    return {
      callbackCount: 1,
      ...(history.cut === `caller-abort` ? { firstOutcome: `AbortError` } : {}),
      providerCalls:
        history.cut === `observer-removal` && history.consumesSignal ? 2 : 1,
      ...(history.consumesSignal
        ? { firstPhysicalAborted: history.cut === `observer-removal` }
        : {}),
      peerOutcome: `fulfilled`,
      peerRowsAtSettlement: sourceRows,
      observersAtSettlement: 1,
      afterFirstPostSettlementReleaseRows: peerReleasesFirst ? [] : sourceRows,
      afterFirstPostSettlementReleaseObservers: peerReleasesFirst ? 0 : 1,
      afterFinalReleaseRows: [] as Array<string>,
      afterFinalReleaseObservers: 0,
    }
  }

  async function observePendingReentry(
    history: PendingReentryHistory,
    expected: ReturnType<typeof expectedPendingReentry>,
  ) {
    const queryClient = createQueryClient()
    const id = `pending-reentry-${collectionSequence++}`
    const firstRows: Array<Row> =
      history.rowCount === 1
        ? [{ id: `a`, group: `first` }]
        : [
            { id: `a`, group: `first` },
            { id: `b`, group: `first` },
          ]
    const replacementRows = firstRows.map((row) => ({
      ...row,
      group: `replacement`,
    }))
    const firstStarted = createDeferred<void>()
    const firstResult = createDeferred<Array<Row>>()
    let providerCalls = 0
    let firstSignal: AbortSignal | undefined
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: (context) => {
          providerCalls++
          if (history.consumesSignal) {
            const physicalSignal = context.signal
            if (providerCalls === 1) firstSignal = physicalSignal
          }
          if (providerCalls === 1) {
            firstStarted.resolve()
            return firstResult.promise
          }
          return Promise.resolve(replacementRows)
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
      }),
    )
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const caller = new AbortController()
    let peer: ReturnType<typeof collection.subscribeChanges> | undefined
    let peerLoad: true | Promise<void> | undefined
    let callbackCount = 0
    let releasingFirst = false
    const rowValues = () =>
      collection.toArray.map((row) => `${row.id}:${row.group}`).sort()
    const observerCount = () =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: [id] })
        .reduce((count, query) => count + query.getObserversCount(), 0)
    const acquirePeer = () => {
      callbackCount++
      peer = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      peer.requestSnapshot({
        onLoadSubsetResult: (load) => {
          peerLoad = load
          if (load !== true) void load.catch(() => undefined)
        },
      })
    }
    if (history.cut === `caller-abort`)
      caller.signal.addEventListener(`abort`, acquirePeer, { once: true })
    const stopCacheListener = queryClient.getQueryCache().subscribe((event) => {
      if (
        history.cut === `observer-removal` &&
        releasingFirst &&
        callbackCount === 0 &&
        event.type === `observerRemoved` &&
        event.query.queryKey[0] === id
      )
        acquirePeer()
    })

    return checkPublicCleanupWitness(async () => {
      let firstLoad: true | Promise<void> | undefined
      first.requestSnapshot({
        ...(history.cut === `caller-abort` ? { signal: caller.signal } : {}),
        onLoadSubsetResult: (load) => {
          firstLoad = load
          if (load !== true) void load.catch(() => undefined)
        },
      })
      await firstStarted.promise
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The first source fetch was not pending`)
      if (history.cut === `caller-abort`) caller.abort()
      else {
        releasingFirst = true
        first.unsubscribe()
      }
      expect(callbackCount).toBe(1)
      if (peerLoad === undefined)
        throw new Error(`The reentrant peer did not receive a load result`)

      const peerOutcome = Promise.resolve(peerLoad).then(
        () => ({ status: `fulfilled` as const, rows: rowValues() }),
        () => ({ status: `rejected` as const, rows: rowValues() }),
      )
      const firstOutcome =
        history.cut === `caller-abort`
          ? await firstLoad.then(
              () => `fulfilled`,
              (error: unknown) =>
                error instanceof Error ? error.name : `non-Error rejection`,
            )
          : undefined
      firstResult.resolve(firstRows)
      const observedPeer = await peerOutcome
      const observersAtSettlement = observerCount()
      if (history.releaseOrder === `peer`) peer?.unsubscribe()
      else first.unsubscribe()
      const afterFirstPostSettlementReleaseRows = rowValues()
      const afterFirstPostSettlementReleaseObservers = observerCount()
      if (history.releaseOrder === `peer`) first.unsubscribe()
      else peer?.unsubscribe()
      const afterFinalReleaseRows = rowValues()
      const afterFinalReleaseObservers = observerCount()
      const observed = {
        callbackCount,
        ...(history.cut === `caller-abort` ? { firstOutcome } : {}),
        providerCalls,
        ...(history.consumesSignal
          ? { firstPhysicalAborted: firstSignal?.aborted }
          : {}),
        peerOutcome: observedPeer.status,
        peerRowsAtSettlement: observedPeer.rows,
        observersAtSettlement,
        afterFirstPostSettlementReleaseRows,
        afterFirstPostSettlementReleaseObservers,
        afterFinalReleaseRows,
        afterFinalReleaseObservers,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`first provider`, () => firstResult.resolve([])],
      [`cache listener`, stopCacheListener],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const pendingReentryProperty = `query-db.pending-reentry-history`
  const pendingReentryReplay = readOracleRunConfig()
  const pendingReentryArbitrary = fc
    .record({
      cut: fc.constantFrom<PendingReentryHistory[`cut`]>(
        `caller-abort`,
        `observer-removal`,
      ),
      rowCount: fc.constantFrom<PendingReentryHistory[`rowCount`]>(1, 2),
      consumesSignal: fc.boolean(),
      releaseOrder: fc.constantFrom<PendingReentryHistory[`releaseOrder`]>(
        `first`,
        `peer`,
      ),
    })
    .filter(
      (history) =>
        history.cut === `caller-abort` || history.releaseOrder === `first`,
    )
  const namedPendingReentryHistories = (
    [`caller-abort`, `observer-removal`] as const
  ).flatMap((cut) =>
    ([1, 2] as const).flatMap((rowCount) =>
      [false, true].flatMap((consumesSignal) =>
        (cut === `caller-abort`
          ? ([`first`, `peer`] as const)
          : ([`first`] as const)
        ).map((releaseOrder) => ({
          cut,
          rowCount,
          consumesSignal,
          releaseOrder,
        })),
      ),
    ),
  )

  it.each(namedPendingReentryHistories)(
    `reconstructs a pending reentry history: %j`,
    async (history) => {
      await observePendingReentry(history, expectedPendingReentry(history))
    },
  )

  it(`refines generated pending reentry histories`, async () => {
    if (
      pendingReentryReplay.replayPath !== undefined &&
      pendingReentryReplay.replayProperty !== pendingReentryProperty
    )
      return
    const property = fc.asyncProperty(
      pendingReentryArbitrary,
      async (history) => {
        await observePendingReentry(history, expectedPendingReentry(history))
      },
    )
    const options = oraclePropertyOptions(48, pendingReentryProperty)
    if (pendingReentryReplay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_160_2029 })
    await fc.assert(property, options)
  }, 20_000)

  /**
   * A public caller abort cancels that pending acquisition without requiring
   * releaseSnapshot or unsubscribe. The Query signal follows physical observer
   * ownership: it aborts for a final caller that consumed it, but remains live
   * for an equal peer. An ignored signal may let Query cache the late response;
   * it cannot give the aborted acquisition a public row. The model predicts
   * each load outcome from its own caller and the final public rows from the
   * remaining owners, not from Query DB's lease bookkeeping.
   * Known failure: https://github.com/TanStack/db/issues/2162
   */
  it.each([
    { peer: false, consumesSignal: true },
    { peer: true, consumesSignal: true },
    { peer: false, consumesSignal: false },
    { peer: true, consumesSignal: false },
  ])(
    `cancels a public snapshot on caller abort, peer=$peer, consumesSignal=$consumesSignal`,
    async ({ peer, consumesSignal }) => {
      const queryClient = createQueryClient()
      const id = `snapshot-caller-abort-${collectionSequence++}`
      const started = createDeferred<void>()
      const held = createDeferred<Array<Row>>()
      let transportSignal: AbortSignal | undefined
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: (context) => {
            if (consumesSignal) {
              transportSignal = context.signal
              transportSignal.addEventListener(
                `abort`,
                () => held.resolve([]),
                { once: true },
              )
            }
            started.resolve()
            return held.promise
          },
          getKey: (row) => row.id,
          startSync: true,
          syncMode: `on-demand`,
        }),
      )
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const peerSubscription = peer
        ? collection.subscribeChanges(() => {}, { includeInitialState: false })
        : undefined
      const caller = new AbortController()
      let load: true | Promise<void> | undefined
      let peerLoad: true | Promise<void> | undefined
      await checkPublicCleanupWitness(async () => {
        subscription.requestSnapshot({
          signal: caller.signal,
          onLoadSubsetResult: (result) => {
            load = result
          },
        })
        await started.promise
        expect(load).toBeDefined()
        peerSubscription?.requestSnapshot({
          onLoadSubsetResult: (result) => {
            peerLoad = result
          },
        })
        if (peer) expect(peerLoad).toBeDefined()
        caller.abort()
        await Promise.resolve()
        if (consumesSignal) {
          expect(transportSignal?.aborted).toBe(!peer)
        }
        await expect(Promise.resolve(load)).rejects.toMatchObject({
          name: `AbortError`,
        })
        expect(collection.toArray).toEqual([])
        held.resolve([{ id: `late` }])
        if (peer) {
          await Promise.resolve(peerLoad)
          expect(collection.toArray.map(({ id: rowId }) => rowId)).toEqual([
            `late`,
          ])
          peerSubscription?.unsubscribe()
          await vi.waitFor(() => expect(collection.toArray).toEqual([]))
        } else {
          await vi.waitFor(() => expect(collection.toArray).toEqual([]))
        }
      }, [
        [`provider`, () => held.resolve([])],
        [`first subscription`, () => subscription.unsubscribe()],
        [`peer subscription`, () => peerSubscription?.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  /**
   * An optimistic mutation holds publication after Core accepts the source
   * sync transaction. The accepted write must still apply for a live peer.
   * The aborted caller's load rejects only after that application receipt;
   * otherwise a prompt rejection could hide a dropped accepted write. The
   * pending transaction flag is a reach witness, while load outcomes and the
   * peer's row are the comparison.
   */
  it(`waits for an accepted result receipt after caller abort`, async () => {
    const queryClient = createQueryClient()
    const id = `accepted-caller-abort-${collectionSequence++}`
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve([{ id: `server` }]),
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        onInsert: async () => {
          handlerEntered.resolve()
          await releaseHandler.promise
          return { refetch: false }
        },
      }),
    )
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const peer = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const caller = new AbortController()
    let firstLoad: true | Promise<void> | undefined
    let peerLoad: true | Promise<void> | undefined
    await checkPublicCleanupWitness(async () => {
      const mutation = collection.insert({ id: `local` })
      await handlerEntered.promise
      first.requestSnapshot({
        signal: caller.signal,
        onLoadSubsetResult: (result) => {
          firstLoad = result
        },
      })
      peer.requestSnapshot({
        onLoadSubsetResult: (result) => {
          peerLoad = result
        },
      })
      expect(firstLoad).toBeDefined()
      expect(peerLoad).toBeDefined()
      await vi.waitFor(() =>
        expect(
          collection._state.pendingSyncedTransactions.some(
            (transaction) =>
              transaction.committed &&
              transaction.operations.some(({ key }) => key === `server`),
          ),
        ).toBe(true),
      )
      expect(collection.has(`server`)).toBe(false)

      let firstOutcome: `fulfilled` | `rejected` | undefined
      void Promise.resolve(firstLoad).then(
        () => {
          firstOutcome = `fulfilled`
        },
        () => {
          firstOutcome = `rejected`
        },
      )
      caller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(firstOutcome).toBeUndefined()
      releaseHandler.resolve()
      await mutation.isPersisted.promise
      await expect(Promise.resolve(firstLoad)).rejects.toMatchObject({
        name: `AbortError`,
      })
      await Promise.resolve(peerLoad)
      expect(firstOutcome).toBe(`rejected`)
      expect(collection.has(`server`)).toBe(true)
    }, [
      [`mutation handler`, () => releaseHandler.resolve()],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * Once Core accepts a source sync transaction, releasing one acquisition
   * cannot revoke its applied receipt for a surviving peer. An optimistic
   * mutation holds publication after that acceptance. The independent model
   * predicts every server row from the provider result, regardless of which
   * first-owner release action follows. An explicit caller abort must reject
   * its own load only after the receipt; ordinary unsubscribe has no promised
   * raw-adapter outcome. Both actions leave the peer's load pending until
   * application and let that peer retain every server row afterward.
   *
   * The grammar varies abort versus unsubscribe, one versus two server rows,
   * and a peer present before acceptance versus acquired from the release
   * callback. It excludes Collection cleanup because that action retires the
   * peer and needs an event/receipt observer rather than a surviving-row check.
   * The driver uses public requestSnapshot and an optimistic mutation to hold
   * the accepted transaction. The internal pending-transaction flag only
   * witnesses that the intended cut was reached. Public load outcomes and
   * complete public rows are compared after release while publication remains
   * held, after the hold, and after the peer releases. A wrapping sync records
   * the applied receipt for the source-result transaction. A callback
   * acquisition joins during caller abort or Query-cache observer removal,
   * before the original release returns. A second provider
   * call returns a distinct row, so replacement work cannot stand in for the
   * accepted result. Recording rows and receipt state inside the first load's
   * rejection handler checks that its settlement follows application.
   */
  type AcceptedReleaseHistory = {
    action: `caller-abort` | `unsubscribe`
    rowCount: 1 | 2
    peerTiming: `before` | `release-callback`
  }

  function expectedAcceptedRelease(history: AcceptedReleaseHistory) {
    const serverRows =
      history.rowCount === 1 ? [`server-a`] : [`server-a`, `server-b`]
    return {
      reachedAcceptedCommit: true,
      providerCalls: 1,
      releaseCallbackCount: history.peerTiming === `release-callback` ? 1 : 0,
      beforeGateRows: [`local`],
      receiptAppliedBeforeGate: false,
      receiptAppliedAfterGate: true,
      peerSettledBeforeGate: false,
      ...(history.action === `caller-abort`
        ? {
            firstSettledBeforeGate: false,
            firstOutcome: `AbortError`,
            firstRowsAtSettlement: serverRows,
            receiptAppliedAtFirstSettlement: true,
          }
        : {}),
      peerOutcome: `fulfilled`,
      afterGateRows: serverRows,
      afterPeerReleaseRows: [] as Array<string>,
    }
  }

  async function observeAcceptedRelease(
    history: AcceptedReleaseHistory,
    expected: ReturnType<typeof expectedAcceptedRelease>,
  ) {
    const queryClient = createQueryClient()
    const id = `accepted-release-history-${collectionSequence++}`
    const serverRows: Array<Row> =
      history.rowCount === 1
        ? [{ id: `server-a` }]
        : [{ id: `server-a` }, { id: `server-b` }]
    const handlerEntered = createDeferred<void>()
    const releaseHandler = createDeferred<void>()
    let providerCalls = 0
    let sourceTransactionHasServerRow = false
    let receiptApplied = false
    const baseOptions = queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: () =>
        Promise.resolve(
          ++providerCalls === 1 ? serverRows : [{ id: `replacement` }],
        ),
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      onInsert: async () => {
        handlerEntered.resolve()
        await releaseHandler.promise
        return { refetch: false }
      },
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            begin: () => {
              sourceTransactionHasServerRow = false
              params.begin()
            },
            write: (change) => {
              if (change.type !== `delete` && change.value.id === `server-a`)
                sourceTransactionHasServerRow = true
              params.write(change)
            },
            commit: (signal) => {
              const isSourceResult = sourceTransactionHasServerRow
              const receipt = params.commit(signal)
              if (isSourceResult) {
                if (receipt === true) receiptApplied = true
                else
                  void receipt.then(
                    () => {
                      receiptApplied = true
                    },
                    () => undefined,
                  )
              }
              return receipt
            },
          }),
      },
    })
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let peer: ReturnType<typeof collection.subscribeChanges> | undefined
    const caller = new AbortController()
    let firstLoad: true | Promise<void> | undefined
    let peerLoad: true | Promise<void> | undefined
    let releaseCallbackCount = 0
    let observingFirstRelease = false
    const publicRows = () => collection.toArray.map((row) => row.id).sort()
    const acquirePeer = () => {
      peer = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      peer.requestSnapshot({
        onLoadSubsetResult: (result) => {
          peerLoad = result
        },
      })
    }
    if (
      history.peerTiming === `release-callback` &&
      history.action === `caller-abort`
    ) {
      caller.signal.addEventListener(
        `abort`,
        () => {
          releaseCallbackCount++
          acquirePeer()
        },
        { once: true },
      )
    }
    const stopCacheListener = queryClient.getQueryCache().subscribe((event) => {
      if (
        history.peerTiming === `release-callback` &&
        history.action === `unsubscribe` &&
        observingFirstRelease &&
        releaseCallbackCount === 0 &&
        event.type === `observerRemoved` &&
        event.query.queryKey[0] === id
      ) {
        releaseCallbackCount++
        acquirePeer()
      }
    })

    return checkPublicCleanupWitness(async () => {
      const mutation = collection.insert({ id: `local` })
      await handlerEntered.promise
      first.requestSnapshot({
        ...(history.action === `caller-abort` ? { signal: caller.signal } : {}),
        onLoadSubsetResult: (result) => {
          firstLoad = result
        },
      })
      if (history.peerTiming === `before`) acquirePeer()
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The first acquisition did not return a pending load`)
      if (
        history.peerTiming === `before` &&
        (peerLoad === undefined || peerLoad === true)
      )
        throw new Error(`The peer acquisition did not return a pending load`)
      void firstLoad.catch(() => undefined)
      await vi.waitFor(() =>
        expect(
          collection._state.pendingSyncedTransactions.some(
            (transaction) =>
              transaction.committed &&
              transaction.operations.some(({ key }) => key === `server-a`),
          ),
        ).toBe(true),
      )
      const reachedAcceptedCommit = true
      let firstOutcome: `fulfilled` | `AbortError` | `other-error` | undefined
      let firstRowsAtSettlement: Array<string> | undefined
      let receiptAppliedAtFirstSettlement: boolean | undefined
      let peerSettledBeforeGate = false
      if (history.action === `caller-abort`) {
        void firstLoad.then(
          () => {
            firstOutcome = `fulfilled`
            firstRowsAtSettlement = publicRows()
            receiptAppliedAtFirstSettlement = receiptApplied
          },
          (error: unknown) => {
            firstOutcome =
              error instanceof Error && error.name === `AbortError`
                ? `AbortError`
                : `other-error`
            firstRowsAtSettlement = publicRows()
            receiptAppliedAtFirstSettlement = receiptApplied
          },
        )
        caller.abort()
      } else {
        observingFirstRelease = true
        first.unsubscribe()
      }
      if (peerLoad === undefined || peerLoad === true)
        throw new Error(`The peer acquisition did not return a pending load`)
      const peerOutcome = peerLoad.then(
        () => `fulfilled` as const,
        () => `rejected` as const,
      )
      void peerOutcome.then(() => {
        peerSettledBeforeGate = true
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const beforeGateRows = publicRows()
      const receiptAppliedBeforeGate = receiptApplied
      const firstSettledBeforeGate = firstOutcome !== undefined
      const peerSettledBeforeGateObserved = peerSettledBeforeGate
      releaseHandler.resolve()
      await mutation.isPersisted.promise
      if (history.action === `caller-abort`) {
        await Promise.resolve(firstLoad).catch(() => undefined)
      }
      const observedPeerOutcome = await peerOutcome
      const afterGateRows = publicRows()
      const receiptAppliedAfterGate = receiptApplied
      peer?.unsubscribe()
      const afterPeerReleaseRows = publicRows()
      const observed = {
        reachedAcceptedCommit,
        providerCalls,
        releaseCallbackCount,
        beforeGateRows,
        receiptAppliedBeforeGate,
        receiptAppliedAfterGate,
        peerSettledBeforeGate: peerSettledBeforeGateObserved,
        ...(history.action === `caller-abort`
          ? {
              firstSettledBeforeGate,
              firstOutcome,
              firstRowsAtSettlement,
              receiptAppliedAtFirstSettlement,
            }
          : {}),
        peerOutcome: observedPeerOutcome,
        afterGateRows,
        afterPeerReleaseRows,
      }
      expect(observed, JSON.stringify({ history, observed, expected })).toEqual(
        expected,
      )
      return observed
    }, [
      [`mutation handler`, () => releaseHandler.resolve()],
      [`cache listener`, stopCacheListener],
      [`first subscription`, () => first.unsubscribe()],
      [`peer subscription`, () => peer?.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  }

  const acceptedReleaseProperty = `query-db.accepted-release-history`
  const acceptedReleaseReplay = readOracleRunConfig()
  const acceptedReleaseArbitrary = fc.record({
    action: fc.constantFrom<AcceptedReleaseHistory[`action`]>(
      `caller-abort`,
      `unsubscribe`,
    ),
    rowCount: fc.constantFrom<AcceptedReleaseHistory[`rowCount`]>(1, 2),
    peerTiming: fc.constantFrom<AcceptedReleaseHistory[`peerTiming`]>(
      `before`,
      `release-callback`,
    ),
  })
  const namedAcceptedReleaseHistories = (
    [`caller-abort`, `unsubscribe`] as const
  ).flatMap((action) =>
    ([1, 2] as const).flatMap((rowCount) =>
      ([`before`, `release-callback`] as const).map((peerTiming) => ({
        action,
        rowCount,
        peerTiming,
      })),
    ),
  )

  it.each(namedAcceptedReleaseHistories)(
    `reconstructs an accepted release history: %j`,
    async (history) => {
      await observeAcceptedRelease(history, expectedAcceptedRelease(history))
    },
  )

  /**
   * A caller awaiting accepted result A cannot settle its abort against a
   * later result B's unaccepted transaction. The reference rule associates
   * each load with the result it observed: A's accepted receipt must apply
   * before that caller's abort rejects. A separate Query refetch creates B
   * while an optimistic mutation holds A's publication; the wrapping sync
   * stops B before acceptance. The public observations are the caller load
   * outcome and complete Collection rows on each side of the publication
   * gate. Distinct A/B values prevent B from standing in for A.
   */
  it(`waits for its own accepted result when a later result supersedes it`, async () => {
    const queryClient = createQueryClient()
    const id = `accepted-result-supersession-${collectionSequence++}`
    const mutationEntered = createDeferred<void>()
    const releaseMutation = createDeferred<void>()
    const laterCommitEntered = createDeferred<void>()
    const releaseLaterCommit = createDeferred<void>()
    let providerCalls = 0
    let writingLaterResult = false
    let firstReceiptApplied = false
    const baseOptions = queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: () =>
        Promise.resolve([{ id: providerCalls++ === 0 ? `A` : `B` }]),
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      onInsert: async () => {
        mutationEntered.resolve()
        await releaseMutation.promise
        return { refetch: false }
      },
    })
    const originalSync = baseOptions.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({
            ...params,
            begin: () => {
              writingLaterResult = false
              params.begin()
            },
            write: (change) => {
              if (change.type !== `delete` && change.value.id === `B`)
                writingLaterResult = true
              params.write(change)
            },
            commit: (signal) => {
              if (writingLaterResult) {
                laterCommitEntered.resolve()
                return releaseLaterCommit.promise.then(async () => {
                  const receipt = params.commit(signal)
                  if (receipt !== true) await receipt
                })
              }
              const receipt = params.commit(signal)
              if (receipt === true) firstReceiptApplied = true
              else
                void receipt.then(
                  () => {
                    firstReceiptApplied = true
                  },
                  () => undefined,
                )
              return receipt
            },
          }),
      },
    })
    const first = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const caller = new AbortController()
    let firstLoad: true | Promise<void> | undefined
    let firstOutcome: `fulfilled` | `AbortError` | `other-error` | undefined
    let firstRowsAtSettlement: Array<string> | undefined
    let receiptAppliedAtFirstSettlement: boolean | undefined
    let laterRefetch: Promise<void> | undefined

    await checkPublicCleanupWitness(async () => {
      const mutation = collection.insert({ id: `local` })
      await mutationEntered.promise
      first.requestSnapshot({
        signal: caller.signal,
        onLoadSubsetResult: (result) => {
          firstLoad = result
        },
      })
      if (firstLoad === undefined || firstLoad === true)
        throw new Error(`The first result had no pending load`)
      void firstLoad.then(
        () => {
          firstOutcome = `fulfilled`
          firstRowsAtSettlement = collection.toArray.map((row) => row.id)
          receiptAppliedAtFirstSettlement = firstReceiptApplied
        },
        (error: unknown) => {
          firstOutcome =
            error instanceof Error && error.name === `AbortError`
              ? `AbortError`
              : `other-error`
          firstRowsAtSettlement = collection.toArray.map((row) => row.id)
          receiptAppliedAtFirstSettlement = firstReceiptApplied
        },
      )
      await vi.waitFor(() =>
        expect(
          collection._state.pendingSyncedTransactions.some(
            (transaction) =>
              transaction.committed &&
              transaction.operations.some(({ key }) => key === `A`),
          ),
        ).toBe(true),
      )
      laterRefetch = queryClient.refetchQueries({
        queryKey: [id],
        exact: true,
      })
      void laterRefetch.catch(() => undefined)
      await laterCommitEntered.promise
      expect(providerCalls).toBe(2)
      expect(collection.toArray.map((row) => row.id)).toEqual([`local`])
      expect(firstOutcome).toBeUndefined()

      caller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(firstOutcome).toBeUndefined()
      expect(collection.toArray.map((row) => row.id)).toEqual([`local`])

      releaseMutation.resolve()
      await mutation.isPersisted.promise
      await expect(Promise.resolve(firstLoad)).rejects.toMatchObject({
        name: `AbortError`,
      })
      expect(firstOutcome).toBe(`AbortError`)
      expect(receiptAppliedAtFirstSettlement).toBe(true)
      expect(firstRowsAtSettlement).toEqual([`A`])
      expect(collection.toArray.map((row) => row.id)).toEqual([`A`])
    }, [
      [`mutation handler`, () => releaseMutation.resolve()],
      [`later commit`, () => releaseLaterCommit.resolve()],
      [
        `later refetch`,
        async () => {
          await laterRefetch?.catch(() => undefined)
        },
      ],
      [`first subscription`, () => first.unsubscribe()],
      [`Collection`, () => collection.cleanup()],
      [`Query client`, () => queryClient.clear()],
    ])
  })

  /**
   * An accepted source transaction has its own applied receipt. A later,
   * unaccepted result cannot become the aborting caller's settlement barrier,
   * even when it appears before the caller's result waiter records A or when
   * subscribing again replays A's same QueryObserverResult. The independent
   * account has one accepted A receipt, one held later commit, and a peer that
   * still owns the Query: A's caller rejects only after that receipt applies,
   * with A public at the exact rejection checkpoint. B remains unaccepted.
   *
   * These legal histories use a real QueryClient and direct loadSubset caller.
   * One writes B into Query cache synchronously inside A's commit callback
   * and aborts its caller. Neighboring histories start A by explicit refetch
   * of an existing Query. Query Core may start its query function immediately,
   * pause before starting it while offline, retry after a failure, or pause
   * that retry. In the paused-retry history the cached seed replay applies
   * before A's receipt is held. In every case A's accepted receipt, rather
   * than a later cache result or that seed replay, controls rejection.
   * Another releases and reacquires a public subscriber after A is accepted,
   * causing Query DB to replay the same A result. A wrapping sync records A's real
   * receipt and holds the later commit before forwarding it to Collection
   * core. The caller's outcome, receipt state, and complete public rows are
   * captured together when its promise settles. The paused histories use
   * Query Core's real online manager and retryer. The controlled wrapper does
   * not establish native persistence or arbitrary Query-cache scheduling.
   */
  it.each([
    {
      trigger: `cache-write-before-waiter`,
      existingQuery: false,
      fetchPath: `immediate`,
    },
    {
      trigger: `same-result-replay`,
      existingQuery: false,
      fetchPath: `immediate`,
    },
    {
      trigger: `cache-write-before-waiter`,
      existingQuery: true,
      fetchPath: `immediate`,
    },
    {
      trigger: `cache-write-before-waiter`,
      existingQuery: true,
      fetchPath: `paused-start`,
    },
    {
      trigger: `cache-write-before-waiter`,
      existingQuery: true,
      fetchPath: `retry`,
    },
    {
      trigger: `cache-write-before-waiter`,
      existingQuery: true,
      fetchPath: `paused-retry`,
    },
  ] as const)(
    `keeps an accepted receipt through $trigger, existingQuery=$existingQuery, fetchPath=$fetchPath`,
    async ({ trigger, existingQuery, fetchPath }) => {
      const queryClient = createQueryClient()
      if (fetchPath === `paused-start` || fetchPath === `paused-retry`)
        queryClient.mount()
      const id = `accepted-reentry-${trigger}-${collectionSequence++}`
      const providerAnswer = createDeferred<Array<Row>>()
      const mutationEntered = createDeferred<void>()
      const releaseMutation = createDeferred<void>()
      const acceptedA = createDeferred<void>()
      let sourceResultArmed = !existingQuery
      const laterCommitEntered = createDeferred<void>()
      const releaseLaterCommit = createDeferred<void>()
      const caller = new AbortController()
      let providerCalls = 0
      let sourceCommits = 0
      let wroteB = false
      let wroteA = false
      let replayArmed = false
      let receiptAApplied = false
      let seedReplaysApplied = 0
      let outcome: `fulfilled` | `AbortError` | `other-error` | undefined
      let receiptAppliedAtSettlement: boolean | undefined
      let rowsAtSettlement: Array<string> | undefined
      const rows = () => collection.toArray.map((row) => row.id).sort()
      const baseOptions = queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => {
          providerCalls++
          if (existingQuery && providerCalls === 1)
            return Promise.resolve([{ id: `seed` }])
          if (
            (fetchPath === `retry` || fetchPath === `paused-retry`) &&
            providerCalls === 2
          ) {
            if (fetchPath === `paused-retry`) onlineManager.setOnline(false)
            return Promise.reject(new Error(`retry before A`))
          }
          return providerAnswer.promise
        },
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        retry:
          fetchPath === `retry` || fetchPath === `paused-retry` ? 1 : false,
        retryDelay: 0,
        onInsert: async () => {
          mutationEntered.resolve()
          await releaseMutation.promise
          return { refetch: false }
        },
      })
      const originalSync = baseOptions.sync
      const collection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              begin: () => {
                wroteB = false
                wroteA = false
                params.begin()
              },
              write: (change) => {
                if (change.type !== `delete` && change.value.id === `B`)
                  wroteB = true
                if (change.type !== `delete` && change.value.id === `A`)
                  wroteA = true
                params.write(change)
              },
              commit: (signal) => {
                sourceCommits++
                if (
                  (trigger === `cache-write-before-waiter` && wroteB) ||
                  (trigger === `same-result-replay` && replayArmed)
                ) {
                  laterCommitEntered.resolve()
                  return releaseLaterCommit.promise.then(async () => {
                    const receipt = params.commit(signal)
                    if (receipt !== true) await receipt
                  })
                }
                const receipt = params.commit(signal)
                if (sourceResultArmed && !wroteA && !wroteB) {
                  if (receipt === true) seedReplaysApplied++
                  else
                    void receipt.then(
                      () => {
                        seedReplaysApplied++
                      },
                      () => undefined,
                    )
                }
                if (sourceResultArmed && wroteA) {
                  if (receipt === true) receiptAApplied = true
                  else
                    void receipt.then(
                      () => {
                        receiptAApplied = true
                      },
                      () => undefined,
                    )
                  acceptedA.resolve()
                }
                if (
                  sourceResultArmed &&
                  wroteA &&
                  trigger === `cache-write-before-waiter`
                ) {
                  queryClient.setQueryData([id], [{ id: `B` }])
                  caller.abort()
                }
                return receipt
              },
            }),
        },
      })
      let passive = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const request: LoadSubsetOptions = {
        signal: caller.signal,
        ...(existingQuery ? { refetch: true } : {}),
      }

      await checkPublicCleanupWitness(async () => {
        if (existingQuery) {
          let baselineLoad: true | Promise<void> | undefined
          passive.requestSnapshot({
            onLoadSubsetResult: (result) => {
              baselineLoad = result
            },
          })
          if (baselineLoad === undefined)
            throw new Error(`The existing Query was not acquired`)
          await Promise.resolve(baselineLoad)
          expect(rows()).toEqual([`seed`])
          sourceCommits = 0
          receiptAApplied = false
          sourceResultArmed = true
        }
        let mutation: ReturnType<typeof collection.insert> | undefined
        if (fetchPath !== `paused-retry`) {
          mutation = collection.insert({ id: `local` })
          await mutationEntered.promise
        }
        if (fetchPath === `paused-start`) onlineManager.setOnline(false)
        const load = Promise.resolve(collection._sync.loadSubset(request))
        void load.then(
          () => {
            outcome = `fulfilled`
            receiptAppliedAtSettlement = receiptAApplied
            rowsAtSettlement = rows()
          },
          (error: unknown) => {
            outcome =
              error instanceof Error && error.name === `AbortError`
                ? `AbortError`
                : `other-error`
            receiptAppliedAtSettlement = receiptAApplied
            rowsAtSettlement = rows()
          },
        )
        passive.requestSnapshot({
          onLoadSubsetResult: (result) => {
            void Promise.resolve(result).catch(() => undefined)
          },
        })
        if (fetchPath === `paused-start` || fetchPath === `paused-retry`) {
          await vi.waitFor(() => {
            expect(
              queryClient.getQueryCache().find({ queryKey: [id], exact: true })
                ?.state.fetchStatus,
            ).toBe(`paused`)
            expect(providerCalls).toBe(fetchPath === `paused-start` ? 1 : 2)
          })
          expect(outcome).toBeUndefined()
          if (fetchPath === `paused-retry`) {
            await vi.waitFor(() =>
              expect(seedReplaysApplied).toBeGreaterThan(0),
            )
            mutation = collection.insert({ id: `local` })
            await mutationEntered.promise
          }
          onlineManager.setOnline(true)
        }
        await vi.waitFor(() =>
          expect(providerCalls).toBe(
            fetchPath === `retry` || fetchPath === `paused-retry`
              ? 3
              : existingQuery
                ? 2
                : 1,
          ),
        )
        providerAnswer.resolve([{ id: `A` }])
        await acceptedA.promise
        if (trigger === `same-result-replay`) {
          replayArmed = true
          passive.unsubscribe()
          passive = collection.subscribeChanges(() => {}, {
            includeInitialState: false,
          })
          passive.requestSnapshot({
            onLoadSubsetResult: (result) => {
              void Promise.resolve(result).catch(() => undefined)
            },
          })
          await laterCommitEntered.promise
          caller.abort()
        } else {
          await laterCommitEntered.promise
        }
        expect(providerCalls).toBe(
          fetchPath === `retry` || fetchPath === `paused-retry`
            ? 3
            : existingQuery
              ? 2
              : 1,
        )
        if (fetchPath === `immediate`) expect(sourceCommits).toBe(2)
        else expect(sourceCommits).toBeGreaterThanOrEqual(2)
        expect(receiptAApplied).toBe(false)
        expect(rows()).toEqual(existingQuery ? [`local`, `seed`] : [`local`])
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(outcome).toBeUndefined()

        releaseMutation.resolve()
        if (!mutation) throw new Error(`The mutation did not start`)
        await mutation.isPersisted.promise
        await expect(load).rejects.toMatchObject({ name: `AbortError` })
        expect(outcome).toBe(`AbortError`)
        expect(receiptAppliedAtSettlement).toBe(true)
        expect(rowsAtSettlement).toEqual([`A`])
        expect(rows()).toEqual([`A`])
      }, [
        [`Query online manager`, () => onlineManager.setOnline(true)],
        [`provider`, () => providerAnswer.resolve([])],
        [`mutation handler`, () => releaseMutation.resolve()],
        [`later commit`, () => releaseLaterCommit.resolve()],
        [`passive subscription`, () => passive.unsubscribe()],
        [`direct acquisition`, () => collection._sync.unloadSubset(request)],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
        [`Query client mount`, () => queryClient.unmount()],
      ])
    },
  )

  /**
   * One Query can start fetch B inside fetch A's Collection commit callback.
   * B may start fetching or pause offline. Query Core then reports B's fetch
   * action before it reports A's cache success. A's late notification must
   * not retire B's application record or claim that B succeeded. The
   * neighboring deferred-start history reverses those cache events.
   *
   * This real QueryClient/Collection history holds B's accepted receipt behind
   * an optimistic mutation, then lets a later unaccepted C cache edit abort
   * B's caller. The caller must remain pending while B is absent and reject
   * only after B's receipt applies, with B as the complete public row set.
   * The cache event order is path evidence; the promise, receipt, and rows are
   * the public comparison. This controlled callback does not model storage.
   */
  it.each([
    { name: `inside callback`, startBAt: `inside-callback`, pauseB: false },
    {
      name: `inside callback while offline`,
      startBAt: `inside-callback`,
      pauseB: true,
    },
    { name: `after callback`, startBAt: `after-callback`, pauseB: false },
  ] as const)(
    `keeps a second fetch receipt when started $name`,
    async ({ startBAt, pauseB }) => {
      const id = `overlapping-success-${collectionSequence++}`
      const queryClient = createQueryClient()
      const providerB = createDeferred<Array<Row>>()
      const mutationGate = createDeferred<void>()
      const mutationStarted = createDeferred<void>()
      const acceptedB = createDeferred<void>()
      const laterCommitEntered = createDeferred<void>()
      const laterCommitGate = createDeferred<void>()
      const caller = new AbortController()
      const requestB: LoadSubsetOptions = {
        refetch: true,
        signal: caller.signal,
      }
      const first: LoadSubsetOptions = {}
      const cacheActions: Array<string> = []
      const unsubscribeCache = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (event.type === `updated`)
            cacheActions.push(
              `${event.action.type}:${event.query.state.fetchStatus}`,
            )
        })
      let providerCalls = 0
      let writes: Array<string> = []
      let bLoad: Promise<void> | undefined
      let bOutcome: `pending` | `ready` | `abort` | `other` = `pending`
      let bReceiptApplied = false
      const base = queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () =>
          ++providerCalls === 1
            ? Promise.resolve([{ id: `A` }])
            : providerB.promise,
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        retry: false,
        onInsert: async () => {
          mutationStarted.resolve()
          await mutationGate.promise
          return { refetch: false }
        },
      })
      const originalSync = base.sync
      const collection = createCollection({
        ...base,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              begin: () => {
                writes = []
                params.begin()
              },
              write: (change) => {
                if (change.type !== `delete`) writes.push(change.value.id)
                params.write(change)
              },
              commit: (signal) => {
                if (writes.includes(`C`)) {
                  laterCommitEntered.resolve()
                  return laterCommitGate.promise.then(async () => {
                    await params.commit(signal)
                  })
                }
                const receipt = params.commit(signal)
                if (writes.includes(`A`) && !bLoad) {
                  const startB = () => {
                    if (pauseB) onlineManager.setOnline(false)
                    const load = Promise.resolve(
                      collection._sync.loadSubset(requestB),
                    ).then(() => undefined)
                    bLoad = load
                    void load.then(
                      () => {
                        bOutcome = `ready`
                      },
                      (error: unknown) => {
                        bOutcome =
                          error instanceof Error && error.name === `AbortError`
                            ? `abort`
                            : `other`
                      },
                    )
                  }
                  if (startBAt === `inside-callback`) startB()
                  else queueMicrotask(startB)
                }
                if (writes.includes(`B`)) {
                  if (receipt === true) bReceiptApplied = true
                  else
                    void receipt.then(
                      () => {
                        bReceiptApplied = true
                      },
                      () => undefined,
                    )
                  acceptedB.resolve()
                  queryClient.setQueryData([id], [{ id: `C` }])
                  caller.abort()
                }
                return receipt
              },
            }),
        },
      })
      const rows = () => collection.toArray.map((row) => row.id).sort()

      await checkPublicCleanupWitness(async () => {
        collection.startSyncImmediate()
        const aLoad = Promise.resolve(collection._sync.loadSubset(first))
        void aLoad.catch(() => undefined)
        await vi.waitFor(() => expect(bLoad).toBeDefined())
        if (pauseB) onlineManager.setOnline(true)
        await vi.waitFor(() => expect(providerCalls).toBe(2))
        const mutation = collection.insert({ id: `local` })
        await mutationStarted.promise
        providerB.resolve([{ id: `B` }])
        await acceptedB.promise
        await laterCommitEntered.promise
        const secondFetch = cacheActions.findIndex(
          (action, index) => index > 0 && action.startsWith(`fetch:`),
        )
        const firstSuccess = cacheActions.findIndex((action) =>
          action.startsWith(`success:`),
        )
        expect(secondFetch).toBeGreaterThan(0)
        expect(firstSuccess).toBeGreaterThan(0)
        expect(secondFetch < firstSuccess).toBe(startBAt === `inside-callback`)
        if (pauseB) expect(cacheActions[secondFetch]).toBe(`fetch:paused`)
        expect(bReceiptApplied).toBe(false)
        expect(rows()).toEqual([`A`, `local`])
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(bOutcome).toBe(`pending`)

        mutationGate.resolve()
        await mutation.isPersisted.promise
        if (!bLoad) throw new Error(`The second fetch did not start`)
        await expect(bLoad).rejects.toMatchObject({ name: `AbortError` })
        expect(bReceiptApplied).toBe(true)
        expect(rows()).toEqual([`B`])
      }, [
        [`online manager`, () => onlineManager.setOnline(true)],
        [`B provider`, () => providerB.resolve([])],
        [`mutation`, () => mutationGate.resolve()],
        [`later commit`, () => laterCommitGate.resolve()],
        [`B acquisition`, () => collection._sync.unloadSubset(requestB)],
        [`A acquisition`, () => collection._sync.unloadSubset(first)],
        [`Collection`, () => collection.cleanup()],
        [`cache listener`, () => unsubscribeCache()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

  it(`refines generated accepted release histories`, async () => {
    if (
      acceptedReleaseReplay.replayPath !== undefined &&
      acceptedReleaseReplay.replayProperty !== acceptedReleaseProperty
    )
      return
    const property = fc.asyncProperty(
      acceptedReleaseArbitrary,
      async (history) => {
        await observeAcceptedRelease(history, expectedAcceptedRelease(history))
      },
    )
    const options = oraclePropertyOptions(48, acceptedReleaseProperty)
    if (acceptedReleaseReplay.replaySeed === undefined)
      await fc.assert(property, { ...options, seed: 2_160_2027 })
    await fc.assert(property, options)
  }, 20_000)

  /**
   * Collection cleanup can abandon a sync transaction accepted but still held
   * behind optimistic settlement. Its receipt and pending subset load reject
   * with `AbortError` exactly once. Cleanup retires every Query DB owner and
   * leaves no source row public, even after the optimistic gate opens. Receipt
   * rejection and row absence are separate obligations: the latter alone
   * cannot prove the caller received the promised cancellation.
   *
   * The exception comes from the public SyncAppliedReceipt contract and the
   * core cleanup oracle. The legal histories cross one or two scripted source
   * rows with one or two equal subscriptions. A wrapping sync records the real
   * `commit()` receipt without changing it; a pending committed transaction is
   * only a reach witness. The public checks are receipt cause and settlement
   * count, every load outcome, status and observer count at cleanup settlement
   * while the gate is still held, and exact rows and source change events
   * before cleanup and after the gate. A local insert proves the event recorder
   * is live before the source result is accepted.
   * Recording settlement rather than awaiting a possibly stranded load makes
   * a missing rejection fail at the cleanup checkpoint. This does not model a
   * new sync run or durable persistence after cleanup.
   */
  const acceptedCleanupHistories = ([1, 2] as const).flatMap((rowCount) =>
    ([1, 2] as const).map((subscriptionCount) => ({
      rowCount,
      subscriptionCount,
    })),
  )
  it.each(acceptedCleanupHistories)(
    `abandons an accepted source receipt during Collection cleanup: %j`,
    async ({ rowCount, subscriptionCount }) => {
      const queryClient = createQueryClient()
      const id = `accepted-collection-cleanup-${collectionSequence++}`
      const serverRows: Array<Row> =
        rowCount === 1
          ? [{ id: `server-a` }]
          : [{ id: `server-a` }, { id: `server-b` }]
      const handlerEntered = createDeferred<void>()
      const releaseHandler = createDeferred<void>()
      let sourceTransactionHasServerRow = false
      let receiptState: `missing` | `pending` | `applied` | `rejected` =
        `missing`
      let receiptErrorName: string | undefined
      let receiptSettlements = 0
      const baseOptions = queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey: [id],
        queryFn: () => Promise.resolve(serverRows),
        getKey: (row) => row.id,
        startSync: true,
        syncMode: `on-demand`,
        onInsert: async () => {
          handlerEntered.resolve()
          await releaseHandler.promise
          return { refetch: false }
        },
      })
      const originalSync = baseOptions.sync
      const collection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              begin: () => {
                sourceTransactionHasServerRow = false
                params.begin()
              },
              write: (change) => {
                if (change.type !== `delete` && change.value.id === `server-a`)
                  sourceTransactionHasServerRow = true
                params.write(change)
              },
              commit: (signal) => {
                const isSourceResult = sourceTransactionHasServerRow
                const receipt = params.commit(signal)
                if (isSourceResult) {
                  receiptState = receipt === true ? `applied` : `pending`
                  if (receipt !== true)
                    void receipt.then(
                      () => {
                        receiptState = `applied`
                        receiptSettlements++
                      },
                      (error: unknown) => {
                        receiptState = `rejected`
                        receiptErrorName =
                          error instanceof Error ? error.name : `non-Error`
                        receiptSettlements++
                      },
                    )
                }
                return receipt
              },
            }),
        },
      })
      let recorderSawLocalInsert = false
      const sourcePublicationEvents: Array<string> = []
      const eventRecorder = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.key === `local` && change.type === `insert`)
              recorderSawLocalInsert = true
            if (
              String(change.key).startsWith(`server-`) &&
              change.type !== `delete`
            )
              sourcePublicationEvents.push(
                `${change.type}:${String(change.key)}`,
              )
          }
        },
        { includeInitialState: false },
      )
      const subscriptions = Array.from({ length: subscriptionCount }, () =>
        collection.subscribeChanges(() => {}, { includeInitialState: false }),
      )
      const loadStates: Array<string> = []
      const loadSettlements: Array<number> = []
      await checkPublicCleanupWitness(async () => {
        const mutation = collection.insert({ id: `local` })
        await handlerEntered.promise
        for (const subscription of subscriptions) {
          let load: true | Promise<void> | undefined
          subscription.requestSnapshot({
            onLoadSubsetResult: (result) => {
              load = result
            },
          })
          if (load === undefined || load === true)
            throw new Error(
              `The source acquisition did not return a pending load`,
            )
          const index = loadStates.length
          loadStates.push(`pending`)
          loadSettlements.push(0)
          void load.then(
            () => {
              loadStates[index] = `fulfilled`
              loadSettlements[index] = (loadSettlements[index] ?? 0) + 1
            },
            (error: unknown) => {
              loadStates[index] =
                error instanceof Error ? error.name : `non-Error rejection`
              loadSettlements[index] = (loadSettlements[index] ?? 0) + 1
            },
          )
        }
        await vi.waitFor(() =>
          expect(
            collection._state.pendingSyncedTransactions.some(
              (transaction) =>
                transaction.committed &&
                transaction.operations.some(({ key }) => key === `server-a`),
            ),
          ).toBe(true),
        )
        const physicalQuery = queryClient
          .getQueryCache()
          .find({ queryKey: [id], exact: true })
        if (!physicalQuery)
          throw new Error(`The accepted result has no physical Query`)
        expect(receiptState).toBe(`pending`)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const beforeCleanup = {
          rows: collection.toArray
            .map((row) => row.id)
            .filter((rowId) => rowId.startsWith(`server-`))
            .sort(),
          sourcePublicationEvents,
          recorderSawLocalInsert,
        }
        const expectedBeforeCleanup = {
          rows: [],
          sourcePublicationEvents: [],
          recorderSawLocalInsert: true,
        }
        expect(beforeCleanup).toEqual(expectedBeforeCleanup)
        if (rowCount === 1 && subscriptionCount === 1) {
          expect(() =>
            expect({ ...beforeCleanup, rows: [`server-a`] }).toEqual(
              expectedBeforeCleanup,
            ),
          ).toThrow()
          expect(() =>
            expect({
              ...beforeCleanup,
              sourcePublicationEvents: [`insert:server-a`],
            }).toEqual(expectedBeforeCleanup),
          ).toThrow()
        }
        const cleanup = collection.cleanup()
        await cleanup
        const atCleanupSettlement = {
          status: collection.status,
          observers: physicalQuery.getObserversCount(),
        }
        const expectedAtCleanupSettlement = {
          status: `cleaned-up`,
          observers: 0,
        }
        expect(atCleanupSettlement).toEqual(expectedAtCleanupSettlement)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const settledAfterCleanup = {
          receiptState,
          receiptErrorName,
          receiptSettlements,
          loadStates,
          loadSettlements,
          rows: collection.toArray
            .map((row) => row.id)
            .filter((rowId) => rowId.startsWith(`server-`)),
          sourcePublicationEvents,
        }
        const expectedAfterCleanup = {
          receiptState: `rejected`,
          receiptErrorName: `AbortError`,
          receiptSettlements: 1,
          loadStates: Array.from(
            { length: subscriptionCount },
            () => `AbortError`,
          ),
          loadSettlements: Array.from({ length: subscriptionCount }, () => 1),
          rows: [],
          sourcePublicationEvents: [],
        }
        expect(settledAfterCleanup).toEqual(expectedAfterCleanup)
        if (rowCount === 1 && subscriptionCount === 1) {
          expect(() =>
            expect({ ...atCleanupSettlement, observers: 1 }).toEqual(
              expectedAtCleanupSettlement,
            ),
          ).toThrow()
          expect(() =>
            expect({ ...settledAfterCleanup, loadStates: [`pending`] }).toEqual(
              expectedAfterCleanup,
            ),
          ).toThrow()
        }

        releaseHandler.resolve()
        await mutation.isPersisted.promise
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect({
          receiptState,
          receiptSettlements,
          status: collection.status,
          observers: physicalQuery.getObserversCount(),
          rows: collection.toArray
            .map((row) => row.id)
            .filter((rowId) => rowId.startsWith(`server-`))
            .sort(),
          sourcePublicationEvents,
        }).toEqual({
          receiptState: `rejected`,
          receiptSettlements: 1,
          status: `cleaned-up`,
          observers: 0,
          rows: [],
          sourcePublicationEvents: [],
        })
      }, [
        [`mutation handler`, () => releaseHandler.resolve()],
        ...subscriptions.map(
          (subscription, index) =>
            [
              `subscription ${index}`,
              () => subscription.unsubscribe(),
            ] as const,
        ),
        [`source event recorder`, () => eventRecorder.unsubscribe()],
        [`Collection`, () => collection.cleanup()],
        [`Query client`, () => queryClient.clear()],
      ])
    },
  )

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
