import { QueryClient } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  isUndefined,
  toArray,
} from '@tanstack/db'
import { it, vi } from 'vitest'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle.js'
import { checkRetainedPublication } from '../../db/tests/query/load-subset-retained-publication-oracle.js'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import { flushPromises } from '../../db/tests/utils.js'
import { queryCollectionOptions } from '../src/query.js'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * A Query Collection never emits truncate on refetch. This receiving driver
 * uses its public reload instead: core replays the retained logical demand
 * while real Query observers revalidate their results. The provider removes a
 * marker, so the graph starts an include acquisition during the join replay.
 * A public queryKey builder gives each subscription its own cache entries:
 * default semantic-key sharing can answer the late include from settled cache
 * and does not reach this pending boundary. The key keeps the same predicate
 * semantics and stays stable across one subscription's acquisitions.
 * The shared retention judgment checks the prior complete public snapshot
 * while that acquisition remains pending. This proves no truncate emission,
 * transport cancellation, or framework timing promise.
 */
it(`receives a late include acquisition during a Query Collection reload`, async () => {
  let eventCount = 0
  const emit = (phase: string, details: Record<string, unknown> = {}) => {
    eventCount++
    process.stdout.write(JSON.stringify({ event: eventCount, phase, ...details, heapUsed: process.memoryUsage().heapUsed }) + `\n`)
    if (eventCount >= 128) process.exit(86)
  }
  const demand = (options: LoadSubsetOptions) => ({
    subscriptionPresent: options.subscription !== undefined,
    signalPresent: options.signal !== undefined,
    signalAborted: options.signal?.aborted,
    wherePresent: options.where !== undefined,
    orderPresent: options.orderBy !== undefined,
    limit: options.limit,
    offset: options.offset,
  })
  emit(`test-start`)
  try {
  type Marker = { id: number; rowId: number }
  type Request = {
    options: LoadSubsetOptions
    keys: Array<number>
    pending: boolean
    answer: () => void
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
    },
  })
  const marked = new Set([1, 3, 4, 5])
  const requests: Array<Request> = []
  const queryOwners = new Map<
    NonNullable<LoadSubsetOptions[`subscription`]>,
    number
  >()
  const requestedKeys = (options: LoadSubsetOptions) =>
    [1, 2, 3, 4, 5].filter(
      (id) =>
        !options.where ||
        evaluateReferenceExpression(options.where, { id, rowId: id }) === true,
    )
  let holding = false
  const markers = createCollection(
    queryCollectionOptions<Marker>({
      id: `replay-query-receiver-markers`,
      queryClient,
      queryKey: (options) => {
        const prefix = [`replay-query-receiver-markers`]
        if (options.subscription === undefined) {
          emit(`key-prefix`, demand(options))
          return prefix
        }
        let owner = queryOwners.get(options.subscription)
        if (owner === undefined) {
          owner = queryOwners.size
          queryOwners.set(options.subscription, owner)
        }
        const keys = requestedKeys(options)
        emit(`key`, { owner, ownerCount: queryOwners.size, keys, ...demand(options), cacheCount: queryClient.getQueryCache().getAll().length })
        return [...prefix, owner, keys]
      },
      getKey: (marker) => marker.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      queryFn: async (context) => {
        const options = context.meta?.loadSubsetOptions ?? {}
        const keys = requestedKeys(options)
        emit(`fetch`, { keys, requestCount: requests.length + 1, holding, ...demand(options), cacheCount: queryClient.getQueryCache().getAll().length })
        let answer = () => {}
        const request: Request = { options, keys, pending: holding, answer }
        requests.push(request)
        if (holding) {
          await new Promise<void>((resolve) => {
            answer = resolve
            request.answer = resolve
          })
        }
        request.pending = false
        return keys
          .filter((id) => marked.has(id))
          .map((id) => ({ id, rowId: id }))
      },
    }),
  )
  // Record the actual acquisitions that the real Query adapter receives.
  // Query cache metadata deliberately omits subscription identity, and several
  // acquisitions may share one Query fetch. Fetch count alone cannot prove it.
  const acquisitions: Array<{ options: LoadSubsetOptions; pending: boolean }> =
    []
  const loadSubset = markers._sync.loadSubset.bind(markers._sync)
  const acquisitionSpy = vi
    .spyOn(markers._sync, `loadSubset`)
    .mockImplementation((options) => {
      const acquisition = { options, pending: true }
      acquisitions.push(acquisition)
      emit(`acquisition`, { acquisitionCount: acquisitions.length, ...demand(options) })
      const result = loadSubset(options)
      emit(`acquisition-return`, { acquisitionCount: acquisitions.length, promise: result instanceof Promise })
      if (result instanceof Promise)
        void result.then(
          () => {
            acquisition.pending = false
          },
          () => {
            acquisition.pending = false
          },
        )
      else acquisition.pending = false
      return result
    })
  emit(`markers-created`)
  const source = createCollection<{ id: number; rank: number }, number>({
    getKey: (row) => row.id,
    defaultIndexType: BTreeIndex,
    autoIndex: `eager`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (let id = 1; id <= 5; id++)
          write({ type: `insert`, value: { id, rank: id * 10 } })
        commit()
        markReady()
      },
    },
  })
  emit(`source-created`)
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .leftJoin({ marker: markers }, ({ row, marker }) =>
        eq(row.id, marker.rowId),
      )
      .where(({ marker }) => isUndefined(marker.rowId))
      .orderBy(({ row }) => row.rank)
      .offset(1)
      .limit(1)
      .select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        markers: toArray(
          q
            .from({ child: markers })
            .where(({ child }) => eq(child.rowId, row.id))
            .select(({ child }) => child.id),
        ),
      })),
  )
  emit(`live-created`)
  const subscription = live.subscribeChanges(() => {})
  emit(`subscribed`)
  const reach = createOracleReach(`Query replay receiving path`, [
    `late-include-pending`,
  ])
  reach.beginHistory()
  try {
    emit(`preload-start`)
    await live.preload()
    emit(`preload-settled`, { acquisitionCount: acquisitions.length, requestCount: requests.length, owners: queryOwners.size, cacheCount: queryClient.getQueryCache().getAll().length })
    const retained = JSON.parse(JSON.stringify(live.toArray))
    const before = acquisitions.length
    const subscriptionsBefore = new Set(
      acquisitions.flatMap(({ options }) =>
        options.signal?.aborted ? [] : [options.subscription],
      ),
    )
    holding = true
    marked.delete(3)
    void markers.reload().catch(() => {})
    await flushPromises()
    for (let turn = 0; turn < 30; turn++) {
      const late = acquisitions
        .slice(before)
        .find(
          ({ options, pending }) =>
            pending &&
            options.subscription !== undefined &&
            options.signal !== undefined &&
            !options.signal.aborted &&
            !subscriptionsBefore.has(options.subscription),
        )
      if (late) {
        reach.reach(`late-include-pending`)
        checkRetainedPublication(
          JSON.parse(JSON.stringify(live.toArray)),
          retained,
          `Query reload with a late include acquisition pending`,
        )
        break
      }
      const next = requests.find(({ pending }) => pending)
      if (!next) break
      next.answer()
      await flushPromises()
    }
    process.stdout.write(
      `${JSON.stringify({ receivingPath: `query-reload`, reach: Object.fromEntries(reach.counts()), acquisitions: acquisitions.map(({ pending, options }) => ({ pending, aborted: options.signal?.aborted, subscriptionPresent: options.subscription !== undefined, subscriptionHeldBeforeReload: subscriptionsBefore.has(options.subscription) })), requests: requests.map(({ keys, pending, options }) => ({ keys, pending, aborted: options.signal?.aborted })) })}\n`,
    )
    reach.assertReached()
  } finally {
    holding = false
    for (const request of requests) request.answer()
    await flushPromises()
    subscription.unsubscribe()
    await live.cleanup()
    await source.cleanup()
    await markers.cleanup()
    queryClient.clear()
    acquisitionSpy.mockRestore()
  }
  } catch (error) {
    emit(`test-error`, { name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message.slice(0, 500) : `non-Error` })
    process.exit(87)
  }
})
