import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { PropRef } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import type {
  CollectionSubscription,
  ReleaseLoadSubset,
} from '../../src/collection/subscription.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../src/types.js'

type RequestOptions = LoadSubsetOptions & {
  minValues?: Array<unknown>
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    acquisition: LoadSubsetOptions,
    release: ReleaseLoadSubset,
  ) => void
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function createOrderByInfo(
  overrides: Partial<OrderByOptimizationInfo> = {},
): OrderByOptimizationInfo {
  return {
    sourceId: `source`,
    alias: `row`,
    orderBy: [
      {
        expression: new PropRef([`row`, `rank`]),
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `lexical`,
        },
      },
    ],
    offset: 0,
    limit: 1,
    comparator: (left, right) =>
      (left?.rank as number) - (right?.rank as number),
    valueExtractorForRawRow: (row) => row.rank,
    index: {} as NonNullable<OrderByOptimizationInfo[`index`]>,
    dataNeeded: () => 1,
    requiresFullSource: false,
    // A finite provider, not an eager source: its rows are not all installed.
    sourceHoldsAllRows: false,
    ...overrides,
  }
}

type Observed = {
  method: `limited` | `snapshot`
  options: RequestOptions
  acquisition: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred>
}

function fakeSubscription(
  requests: Array<Observed>,
  releases: Array<LoadSubsetOptions>,
  onRelease: () => void = () => {},
) {
  const request = (method: Observed[`method`], options: RequestOptions) => {
    const acquisition: LoadSubsetOptions = {
      orderBy: options.orderBy,
      limit: options.limit,
      where: options.where,
    }
    const deferred = createDeferred()
    requests.push({ method, options, acquisition, deferred })
    options.onLoadSubsetResult?.(deferred.promise, acquisition, () => {
      releases.push(acquisition)
      onRelease()
    })
  }
  return {
    readOrderedSnapshot: () => [],
    setOrderByIndex: () => {},
    requestLimitedSnapshot: (options: RequestOptions) =>
      request(`limited`, options),
    requestSnapshot: (options: RequestOptions) => request(`snapshot`, options),
  } as unknown as CollectionSubscription
}

describe(`Ordered source request ownership`, () => {
  it(`retains an explicit failed-request retry blocked by joined demand`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    let joinedPending = false
    const loader = new OrderedSourceLoader(
      createOrderByInfo({
        joinedFilterSourceId: `child`,
        requiresFullSource: true,
      }),
      fakeSubscription(requests, releases),
      `row`,
      undefined,
      undefined,
      undefined,
      () => joinedPending,
    )

    try {
      loader.start()
      const first = (loader as unknown as { pending: Promise<void> }).pending
      const failure = new Error(`initial full-source request failed`)
      requests[0]!.deferred.reject(failure)
      await expect(first).rejects.toBe(failure)

      joinedPending = true
      expect(loader.loadMore(1)).toBeUndefined()
      expect(requests).toHaveLength(1)

      joinedPending = false
      const retry = loader.loadMore()
      expect(requests).toHaveLength(2)
      requests[1]!.deferred.resolve()
      await retry
    } finally {
      for (const request of requests) request.deferred.resolve()
      loader.dispose()
    }
  })

  it(`keeps nested refinement pending when successful cleanup reports an error`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<number> = []
    const participants: Array<Promise<unknown>> = []
    const participantErrors = new Map<Promise<unknown>, unknown>()
    const cleanupError = new Error(`older prefix cleanup failed`)
    let boundary = 1
    const request = (method: Observed[`method`], options: RequestOptions) => {
      const index = requests.length
      const acquisition: LoadSubsetOptions = {
        orderBy: options.orderBy,
        limit: options.limit,
        where: options.where,
      }
      const deferred = createDeferred()
      requests.push({ method, options, acquisition, deferred })
      options.onLoadSubsetResult?.(
        index === 2 ? true : deferred.promise,
        acquisition,
        () => {
          releases.push(index)
          if (index === 0) throw cleanupError
        },
      )
    }
    const subscription = {
      readOrderedSnapshot: () => [
        {
          type: `insert`,
          key: boundary,
          value: { id: boundary, rank: boundary },
        },
      ],
      setOrderByIndex: () => {},
      requestLimitedSnapshot: (options: RequestOptions) =>
        request(`limited`, options),
      requestSnapshot: (options: RequestOptions) =>
        request(`snapshot`, options),
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo(),
      subscription,
      `row`,
      (result) => {
        if (result instanceof Promise) {
          participants.push(result)
          void result.catch((error) => participantErrors.set(result, error))
        }
      },
    )

    try {
      loader.start()
      requests[0]!.deferred.resolve()
      await participants[0]
      requests[1]!.deferred.resolve()
      await participants[1]

      boundary = 2
      loader.invalidateCursor()
      const result = loader.loadMore(1)!
      expect(requests).toHaveLength(4)
      expect(participants).toHaveLength(4)
      await flushPromises()
      const recent = participants.slice(2)
      const cleanup = recent.find(
        (participant) => participantErrors.get(participant) === cleanupError,
      )!
      const nested = recent.find((participant) => participant !== cleanup)!
      const pending = (
        loader as unknown as { pending: Promise<unknown> | undefined }
      ).pending
      expect(result).toBe(pending)
      expect(pending).toBe(nested)
      await expect(cleanup).rejects.toBe(cleanupError)

      expect(loader.loadMore()).toBe(nested)
      expect(requests).toHaveLength(4)
      expect(releases).toEqual([0])
    } finally {
      loader.dispose()
      for (const observed of requests) observed.deferred.resolve()
      await Promise.allSettled(participants)
    }
  })

  it.each([
    { name: `indexed page`, indexed: true },
    { name: `unindexed prefix`, indexed: false },
  ] as const)(
    `finishes a repeated $name repair continuation and permits the next repair`,
    async ({ indexed }) => {
      type Row = { id: number; rank: number }
      let rows: Array<Row> = [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
        { id: 3, rank: 3 },
      ]
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const subscription = fakeSubscription(requests, releases) as unknown as {
        readOrderedSnapshot: () => Array<{ value: Row }>
      }
      subscription.readOrderedSnapshot = () =>
        rows
          .slice()
          .sort((left, right) => left.rank - right.rank)
          .map((value) => ({ value }))
      const loader = new OrderedSourceLoader(
        createOrderByInfo({
          index: indexed
            ? ({} as NonNullable<OrderByOptimizationInfo[`index`]>)
            : undefined,
          limit: 10,
          dataNeeded: () => (indexed ? 10 - rows.length : 0),
        }),
        subscription as unknown as CollectionSubscription,
        `row`,
      )
      let nextRequest = 0
      const settleThrough = async (finalCount: number) => {
        while (nextRequest < finalCount) {
          const pending = (
            loader as unknown as { pending: Promise<unknown> | undefined }
          ).pending
          requests[nextRequest]!.deferred.resolve()
          nextRequest++
          await pending
        }
      }

      try {
        loader.start()
        await settleThrough(indexed ? 3 : 2)

        rows = rows.filter(({ id }) => id !== 2)
        loader.invalidateSourceOrdering()
        loader.loadMore(indexed ? undefined : 7)
        const repairEnd = indexed ? 6 : 4
        await settleThrough(repairEnd)

        expect(releases).toEqual(
          requests
            .slice(0, indexed ? 3 : 2)
            .map(({ acquisition }) => acquisition),
        )

        loader.invalidateSourceOrdering()
        loader.loadMore(8)
        expect(requests).toHaveLength(repairEnd + 1)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
      }
    },
  )

  it(`starts a replacement repair before continuing a stale repair chain`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    let needed = 0
    const subscription = fakeSubscription(requests, releases) as unknown as {
      readOrderedSnapshot: () => Array<{
        value: { id: number; rank: number }
      }>
    }
    subscription.readOrderedSnapshot = () => [{ value: { id: 1, rank: 1 } }]
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ dataNeeded: () => needed }),
      subscription as unknown as CollectionSubscription,
      `row`,
    )
    let nextRequest = 0
    const settle = async () => {
      const pending = (
        loader as unknown as { pending: Promise<unknown> | undefined }
      ).pending
      requests[nextRequest]!.deferred.resolve()
      nextRequest++
      await pending
    }

    try {
      loader.start()
      await settle()
      await settle()

      loader.invalidateSourceOrdering()
      loader.loadMore()
      await settle()
      expect(requests).toHaveLength(4)

      // A second mutation invalidates the chain while its tie request is held.
      // Its settlement may apply rows, but it must not start stale refill work.
      needed = 1
      loader.invalidateSourceOrdering()
      await settle()

      expect(requests).toHaveLength(5)
      expect(requests[4]!.method).toBe(`snapshot`)
      expect(requests[4]!.options).toMatchObject({
        refetch: true,
        limit: 1,
      })
      expect(requests[4]!.options.orderBy).toBeDefined()
      expect(requests[4]!.options.cursor).toBeUndefined()
    } finally {
      loader.dispose()
      for (const request of requests) request.deferred.resolve()
    }
  })

  it(`reissues a bounded prefix when settled source ordering is invalidated`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const loader = new OrderedSourceLoader(
      createOrderByInfo({
        index: undefined,
        offset: 2,
        limit: 2,
        dataNeeded: () => 0,
      }),
      fakeSubscription(requests, releases),
      `row`,
    )
    let repair: Promise<unknown> | undefined

    try {
      loader.start()
      const initial = (
        loader as unknown as { pending: Promise<unknown> | undefined }
      ).pending!
      requests[0]!.deferred.resolve()
      await initial

      loader.invalidateSourceOrdering()
      repair = loader.loadMore()

      expect(requests).toHaveLength(2)
      expect(requests[1]!.method).toBe(`snapshot`)
      expect(
        requests[1]!.options.orderBy?.map(({ expression, compareOptions }) => ({
          path: expression instanceof PropRef ? expression.path : undefined,
          direction: compareOptions.direction,
        })),
      ).toStrictEqual([{ path: [`rank`], direction: `asc` }])
      expect(requests[1]!.options.limit).toBe(4)
      expect(requests[1]!.options.refetch).toBe(true)
      expect(requests[1]!.options.cursor).toBeUndefined()
      expect(requests[1]!.options.offset).toBeUndefined()
    } finally {
      for (const request of requests) request.deferred.resolve()
      await Promise.allSettled(repair ? [repair] : [])
      loader.dispose()
    }
  })

  it(`retains finite leases after bounded repair fails until full-source recovery succeeds`, async () => {
    const requests: Array<{
      options: RequestOptions
      acquisition: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred>
    }> = []
    const releases: Array<number> = []
    const request = (options: RequestOptions) => {
      const deferred = createDeferred()
      const acquisition: LoadSubsetOptions = {
        orderBy: options.orderBy,
        limit: options.limit,
        where: options.where,
        cursor: options.cursor,
        offset: options.offset,
      }
      const index = requests.length
      requests.push({ options, acquisition, deferred })
      options.onLoadSubsetResult?.(deferred.promise, acquisition, () => {
        releases.push(index)
      })
    }
    const subscription = {
      hasPendingTruncateReplacement: false,
      readOrderedSnapshot: () => [{ value: { id: 1, rank: 1 } }],
      setOrderByIndex: () => {},
      requestLimitedSnapshot: request,
      requestSnapshot: request,
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo({
        index: undefined,
        dataNeeded: () => 0,
      }),
      subscription,
      `row`,
    )
    const pending = () =>
      (loader as unknown as { pending: Promise<unknown> | undefined }).pending!
    const settle = async (index: number) => {
      const participant = pending()
      requests[index]!.deferred.resolve()
      await participant
    }

    try {
      loader.start()
      await settle(0)
      await settle(1)

      loader.invalidateSourceOrdering()
      loader.loadMore()
      await settle(2)
      expect(requests).toHaveLength(4)

      // Core cannot know whether the failed adapter request wrote a partial
      // result, so finite continuation is no longer authoritative.
      const failedTie = pending()
      const failure = new Error(`partial bounded-repair failure`)
      requests[3]!.deferred.reject(failure)
      await expect(failedTie).rejects.toBe(failure)

      const retry = loader.loadMore(1)
      expect(retry).toBeDefined()
      expect(requests).toHaveLength(5)
      expect(requests[4]!.options.orderBy).toBeUndefined()
      expect(requests[4]!.options.where).toBeUndefined()
      expect(requests[4]!.options.limit).toBeUndefined()
      expect(requests[4]!.options.cursor).toBeUndefined()
      expect(requests[4]!.options.offset).toBeUndefined()
      await settle(4)

      expect(
        requests.map(({ options }) =>
          options.orderBy ? `prefix` : options.where ? `tie` : `full-source`,
        ),
      ).toEqual([`prefix`, `tie`, `prefix`, `tie`, `full-source`])
      expect(releases).toEqual([3, 0, 1, 2])
    } finally {
      loader.dispose()
      for (const observed of requests) observed.deferred.resolve()
    }
  })

  // An order change while a tie request is in flight starts a bounded prefix
  // repair at once; the tie's later result is ignored for the boundary. When
  // that repair fails, the window move rejects with its error and the last
  // public window stays, whatever the older tie request does. An explicit
  // retry then recovers under today's failure law, from the full source, and
  // publishes once.
  it.each([`success`, `failure`] as const)(
    `keeps a failed public window private when its older tie request ends in %s`,
    async (olderOutcome) => {
      type Row = { id: number; rank: number }
      const truth: Array<Row> = [1, 2, 3].map((id) => ({ id, rank: id }))
      const requests: Array<{
        kind: `page` | `boundary` | `full`
        options: LoadSubsetOptions
        gate: ReturnType<typeof createDeferred>
      }> = []
      const releases: Array<LoadSubsetOptions> = []
      let hold = false
      let holdRepair = false
      let update!: (row: Row) => void
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (sync) => {
            const installed = new Map<number, Row>()
            update = (row) => {
              installed.set(row.id, row)
              sync.begin()
              sync.write({ type: `update`, value: row })
              sync.commit()
            }
            sync.markReady()
            return {
              loadSubset: async (options) => {
                const kind = options.orderBy
                  ? `page`
                  : options.where
                    ? `boundary`
                    : `full`
                const gate = createDeferred()
                requests.push({ kind, options, gate })
                if (!hold || (kind === `page` && !holdRepair)) gate.resolve()
                await gate.promise
                if (options.signal?.aborted) return
                const rows = truth
                  .filter(
                    (row) =>
                      (!options.where ||
                        evaluateReferenceExpression(options.where, row) ===
                          true) &&
                      (!options.cursor ||
                        evaluateReferenceExpression(
                          options.cursor.whereFrom,
                          row,
                        ) === true),
                  )
                  .sort((a, b) => a.rank - b.rank)
                const offset = options.cursor ? 0 : (options.offset ?? 0)
                const selected = rows.slice(
                  offset,
                  options.limit === undefined
                    ? undefined
                    : offset + options.limit,
                )
                sync.begin()
                for (const row of selected) {
                  if (installed.get(row.id) === row) continue
                  sync.write({
                    type: installed.has(row.id) ? `update` : `insert`,
                    value: row,
                  })
                  installed.set(row.id, row)
                }
                await sync.commit()
              },
              unloadSubset: (options) => {
                releases.push(options)
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, rank: row.rank })),
      )
      const visibleRows = () =>
        live.toArray.map(({ id, rank }) => ({ id, rank }))
      const publications: Array<Array<Row>> = []
      live.subscribeChanges(
        (batch) => {
          if (batch.length) publications.push(visibleRows())
        },
        { includeInitialState: false },
      )
      try {
        await live.preload()
        expect(visibleRows()).toEqual([{ id: 1, rank: 1 }])
        publications.length = 0
        hold = true
        const move = Promise.resolve(live.utils.setWindow({ limit: 2 })).then(
          () => ({ status: `fulfilled` as const }),
          (error) => ({ status: `rejected` as const, error }),
        )
        await flushPromises()
        const boundary = requests.at(-1)!
        expect(boundary.kind).toBe(`boundary`)
        holdRepair = true
        truth[0] = { id: 1, rank: 10 }
        update(truth[0])
        await flushPromises()
        const repair = requests.at(-1)!
        expect(repair.kind).toBe(`page`)
        expect(repair.options.limit).toBe(2)
        expect(repair.options.cursor).toBeUndefined()
        const count = requests.length
        const failure = new Error(`authoritative repair failed`)
        repair.gate.reject(failure)
        // The window still waits for its older publication participant to settle.
        await flushPromises()
        if (olderOutcome === `failure`)
          boundary.gate.reject(new Error(`older tie failed`))
        else boundary.gate.resolve()
        await flushPromises()
        expect(requests).toHaveLength(count)
        expect(await move).toEqual({ status: `rejected`, error: failure })
        expect(releases).toEqual([])
        expect(publications).toEqual([])
        expect(visibleRows()).toEqual([{ id: 1, rank: 1 }])
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })

        hold = false
        holdRepair = false
        await live.utils.setWindow({ limit: 2 })
        expect(requests).toHaveLength(count + 1)
        expect(requests.at(-1)!.kind).toBe(`full`)
        expect(releases).toHaveLength(count)
        expect(new Set(releases)).toEqual(
          new Set(requests.slice(0, count).map(({ options }) => options)),
        )
        expect(visibleRows()).toEqual([
          { id: 2, rank: 2 },
          { id: 3, rank: 3 },
        ])
        expect(publications).toEqual([
          [
            { id: 2, rank: 2 },
            { id: 3, rank: 3 },
          ],
        ])
      } finally {
        await live.cleanup()
        for (const request of requests) request.gate.resolve()
        await source.cleanup()
      }
    },
  )

  // Finite success is not authority to repair a newer full-source failure.
  // Cross settlement order with both outcomes instead of testing each alone.
  // An invalidation while the first page is still in flight comes before any
  // request has settled, so the loader still recovers from the full source.
  // An overlap after the source has settled once repairs with a bounded
  // prefix instead; the next property owns that case.
  it.each(
    ([`older-first`, `full-first`] as const).flatMap((order) =>
      ([`success`, `failure`] as const).flatMap((outcome) =>
        ([`success`, `failure`] as const).map((olderOutcome) => ({
          order,
          outcome,
          olderOutcome,
        })),
      ),
    ),
  )(
    `keeps full-source recovery authoritative across an initial page overlap: %j`,
    async ({ order, outcome, olderOutcome }) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const subscription = fakeSubscription(requests, releases)
      subscription.readOrderedSnapshot = () => [
        { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
      ]
      const loader = new OrderedSourceLoader(
        createOrderByInfo(),
        subscription,
        `row`,
        (result) => {
          if (result instanceof Promise) participants.push(result)
        },
      )
      try {
        loader.start()
        const olderIndex = requests.length - 1
        loader.invalidateSourceOrdering()
        loader.loadMore()
        const fullIndex = olderIndex + 1
        const count = fullIndex + 1
        expect(requests).toHaveLength(count)
        expect(requests[fullIndex]!.options.orderBy).toBeUndefined()
        expect(requests[fullIndex]!.options.where).toBeUndefined()
        const failure = new Error(`full-source failed`)
        const olderFailure = new Error(`older request failed`)
        const settleOlder = async () => {
          if (olderOutcome === `failure`) {
            requests[olderIndex]!.deferred.reject(olderFailure)
            await expect(participants[olderIndex]).rejects.toBe(olderFailure)
          } else {
            requests[olderIndex]!.deferred.resolve()
            await participants[olderIndex]
          }
          expect(requests).toHaveLength(count)
        }
        const settleFull = async () => {
          if (outcome === `failure`) {
            requests[fullIndex]!.deferred.reject(failure)
            await expect(participants[fullIndex]).rejects.toBe(failure)
          } else {
            requests[fullIndex]!.deferred.resolve()
            await participants[fullIndex]
          }
          expect(requests).toHaveLength(count)
        }
        if (order === `older-first`) {
          await settleOlder()
          await settleFull()
        } else {
          await settleFull()
          await settleOlder()
        }
        loader.loadMore()
        expect(requests).toHaveLength(count)
        const successfulFinite =
          outcome === `success`
            ? requests
                .slice(0, fullIndex)
                .filter(
                  (_, index) =>
                    index !== olderIndex || olderOutcome === `success`,
                )
                .map(({ acquisition }) => acquisition)
            : []
        expect(releases).toEqual(successfulFinite)

        loader.loadMore(1)
        const failedIndices = (
          order === `older-first`
            ? [olderIndex, fullIndex]
            : [fullIndex, olderIndex]
        ).filter(
          (index) =>
            (index === olderIndex ? olderOutcome : outcome) === `failure`,
        )
        expect(releases).toEqual([
          ...successfulFinite,
          ...failedIndices.map((index) => requests[index]!.acquisition),
        ])
        if (outcome === `failure`) {
          expect(requests).toHaveLength(count + 1)
          loader.loadMore(1)
          expect(requests).toHaveLength(count + 1)
          requests[count]!.deferred.resolve()
          await participants[count]
        } else expect(requests).toHaveLength(count)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )

  // An invalidation that overlaps an in-flight tie request, after the source
  // has settled once, repairs with a bounded prefix: full-source reads can be
  // very expensive, and the bounded repair sets its boundary from its own
  // settled requests. The older tie's later success is ignored for that
  // boundary. When both succeed, the repair chain runs to its fixed point and
  // retires exactly the acquisitions it replaced, once each, with no
  // full-source request. When the repair succeeds but the older tie fails,
  // the tie's partial writes need the full-source read that the overlap
  // replaced, so the loader starts it at once, in either settlement order,
  // and needs no explicit retry; on main, the overlapping full-source read
  // recovered this case. When the repair itself fails, today's failure law
  // holds: nothing retries eagerly, and an explicit retry releases exactly
  // the failed acquisitions, in failure order, and recovers from the full
  // source.
  it.each(
    ([`older-first`, `repair-first`] as const).flatMap((order) =>
      ([`success`, `failure`] as const).flatMap((outcome) =>
        ([`success`, `failure`] as const).map((olderOutcome) => ({
          order,
          outcome,
          olderOutcome,
        })),
      ),
    ),
  )(
    `repairs a tie overlap with a bounded prefix: %j`,
    async ({ order, outcome, olderOutcome }) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const subscription = fakeSubscription(requests, releases)
      subscription.readOrderedSnapshot = () => [
        { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
      ]
      const loader = new OrderedSourceLoader(
        createOrderByInfo(),
        subscription,
        `row`,
        (result) => {
          if (result instanceof Promise) {
            participants.push(result.catch(() => undefined))
          }
        },
      )
      const flush = async () => {
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      }
      const settle = async (index: number, succeeds: boolean) => {
        if (succeeds) requests[index]!.deferred.resolve()
        else requests[index]!.deferred.reject(new Error(`request failed`))
        await flush()
      }
      const isFullSource = ({ options }: Observed) =>
        options.orderBy === undefined && options.where === undefined
      try {
        loader.start()
        await settle(0, true)
        expect(requests).toHaveLength(2)
        expect(requests[1]!.options.where).toBeDefined()
        const olderIndex = 1
        loader.invalidateSourceOrdering()
        loader.loadMore()
        const repairIndex = 2
        expect(requests).toHaveLength(3)
        expect(requests[repairIndex]!.options.orderBy).toBeDefined()
        expect(requests[repairIndex]!.options.limit).toBe(1)
        expect(requests[repairIndex]!.options.where).toBeUndefined()

        const settleOlder = () => settle(olderIndex, olderOutcome === `success`)
        const settleRepair = () => settle(repairIndex, outcome === `success`)
        if (order === `older-first`) {
          await settleOlder()
          await settleRepair()
        } else {
          await settleRepair()
          await settleOlder()
        }

        if (outcome === `success` && olderOutcome === `success`) {
          // Run the repair chain to its fixed point.
          for (let index = repairIndex + 1; index < requests.length; index++) {
            await settle(index, true)
          }
          const settled = requests.length
          expect(settled).toBeGreaterThan(repairIndex + 1)
          expect(requests.some(isFullSource)).toBe(false)
          expect(releases).toEqual([
            requests[0]!.acquisition,
            requests[olderIndex]!.acquisition,
          ])
          loader.loadMore()
          loader.loadMore(1)
          expect(requests).toHaveLength(settled)
          expect(releases).toHaveLength(2)
          return
        }

        if (outcome === `success`) {
          // The older tie failed: the loader recovers from the full source.
          for (let index = repairIndex + 1; index < requests.length; index++) {
            if (isFullSource(requests[index]!)) break
            await settle(index, true)
          }
          const full = requests.findIndex(isFullSource)
          expect(full).toBeGreaterThan(repairIndex)
          expect(requests.filter(isFullSource)).toHaveLength(1)
          await settle(full, true)
          const settled = requests.length
          loader.loadMore()
          expect(requests).toHaveLength(settled)
          return
        }

        // The repair failed: nothing retries eagerly. Repair-chain work
        // already in flight settles first; an explicit retry then waits for
        // no request.
        for (let index = repairIndex + 1; index < requests.length; index++) {
          await settle(index, true)
        }
        const before = requests.length
        loader.loadMore()
        expect(requests).toHaveLength(before)
        expect(requests.some(isFullSource)).toBe(false)
        const failed = (
          order === `older-first`
            ? [olderIndex, repairIndex]
            : [repairIndex, olderIndex]
        ).filter(
          (index) =>
            (index === olderIndex ? olderOutcome : outcome) === `failure`,
        )
        const releasedBeforeRetry = releases.length
        loader.loadMore(1)
        expect(releases.slice(releasedBeforeRetry)).toEqual(
          failed.map((index) => requests[index]!.acquisition),
        )
        expect(requests).toHaveLength(before + 1)
        expect(isFullSource(requests[before]!)).toBe(true)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )

  // The same overlap with an in-flight prefix read. A prefix acquisition
  // normally supersedes every smaller settled prefix, because it covers their
  // rows. A prefix issued before an ordering invalidation proves no current
  // coverage, so its later result is ignored for the boundary, and for the
  // same reason it must not release the repair's acquisitions. A refetching
  // provider removes the rows only a released request holds, so releasing the
  // repair's prefix can drop a row the stale read never saw. The stale prefix
  // itself is superseded by the repair, so it is released too, in either
  // settlement order; holding it would make every later refetch read it.
  it.each([`older-first`, `repair-first`] as const)(
    `keeps the repair's prefix when an older prefix read settles %s`,
    async (order) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const subscription = fakeSubscription(requests, releases)
      subscription.readOrderedSnapshot = () => [
        { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
      ]
      const info = createOrderByInfo({ index: undefined, dataNeeded: () => 0 })
      const loader = new OrderedSourceLoader(
        info,
        subscription,
        `row`,
        (result) => {
          if (result instanceof Promise) {
            participants.push(result.catch(() => undefined))
          }
        },
      )
      const flush = async () => {
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      }
      const settle = async (index: number) => {
        requests[index]!.deferred.resolve()
        await flush()
      }
      const isPrefix = ({ options }: Observed) =>
        options.orderBy !== undefined && options.cursor === undefined
      try {
        loader.start()
        for (let index = 0; index < requests.length; index++) {
          await settle(index)
        }
        const initial = requests.length

        // A window move reads a longer prefix; it is still in flight when an
        // order change invalidates the source.
        info.limit = 3
        loader.loadMore(1)
        expect(requests).toHaveLength(initial + 1)
        const olderIndex = initial
        expect(requests[olderIndex]!.options.limit).toBe(3)
        loader.invalidateSourceOrdering()
        loader.loadMore()
        const repairIndex = initial + 1
        expect(requests).toHaveLength(initial + 2)
        expect(requests[repairIndex]!.options).toMatchObject({
          refetch: true,
          limit: 3,
        })

        const runRepair = async () => {
          for (let index = repairIndex; index < requests.length; index++) {
            if (index !== olderIndex) await settle(index)
          }
        }
        if (order === `older-first`) {
          await settle(olderIndex)
          await runRepair()
        } else {
          await runRepair()
          await settle(olderIndex)
        }

        const repairAcquisitions = requests
          .slice(repairIndex)
          .map(({ acquisition }) => acquisition)
        expect(requests.slice(repairIndex).filter(isPrefix)).toHaveLength(1)
        expect(
          releases.filter((release) => repairAcquisitions.includes(release)),
        ).toEqual([])
        expect(releases).toEqual(
          expect.arrayContaining(
            requests.slice(0, initial).map(({ acquisition }) => acquisition),
          ),
        )

        // A stale prefix that settles after the repair finished is already
        // superseded, so it is released at once. One that settled first is
        // covered by the repair's own retirement.
        expect(releases).toContain(requests[olderIndex]!.acquisition)

        // A later repair still runs normally.
        loader.invalidateSourceOrdering()
        loader.loadMore()
        for (let index = 0; index < requests.length; index++) {
          await settle(index)
        }
        expect(releases).toContain(requests[olderIndex]!.acquisition)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )

  // When a bounded repair finishes, it releases the acquisitions it
  // superseded. A refetching provider then removes the rows only those
  // acquisitions held, and the loader sees a delete of a row it sent. That
  // removal is the repair's own retirement, not a source change: every row
  // through the repair's boundary is held by the repair. The repair's
  // boundary must survive it. Otherwise the loader restarts paging from the
  // start of the order with a smaller first page that cannot retire the
  // repair's larger prefix, and every later refetch reads both prefixes.
  // Law: once a chain settles, the loader holds at most one acquisition that
  // reads from the start of the order.
  it(`keeps a repair's boundary when its retirement removes a row the loader sent`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const participants: Array<Promise<unknown>> = []
    let removedOnRelease = false
    // Releasing the first tie request removes row 9, which only it held.
    const subscription = fakeSubscription(requests, releases, () => {
      if (removedOnRelease || releases.at(-1)?.where === undefined) return
      removedOnRelease = true
      const row = { id: 9, rank: 2 }
      loader.onSourceChanges(
        [{ type: `delete`, key: 9, value: row }],
        new Map([[9, row]]),
        () => false,
      )
    })
    subscription.readOrderedSnapshot = () => [
      { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
      { type: `insert`, key: 2, value: { id: 2, rank: 2 } },
    ]
    let needed = 0
    const info = createOrderByInfo({ limit: 2, dataNeeded: () => needed })
    const loader = new OrderedSourceLoader(
      info,
      subscription,
      `row`,
      (result) => {
        if (result instanceof Promise) {
          participants.push(result.catch(() => undefined))
        }
      },
    )
    const settleAll = async () => {
      for (let index = 0; index < requests.length; index++) {
        requests[index]!.deferred.resolve()
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
      }
    }
    const heldPrefixes = () =>
      requests.filter(
        ({ options, acquisition }) =>
          options.orderBy !== undefined &&
          options.where === undefined &&
          options.minValues === undefined &&
          !releases.includes(acquisition),
      )
    try {
      loader.start()
      await settleAll()
      expect(heldPrefixes()).toHaveLength(1)

      loader.invalidateSourceOrdering()
      loader.loadMore()
      await settleAll()
      expect(removedOnRelease).toBe(true)
      expect(heldPrefixes()).toHaveLength(1)

      // The window now needs one more row. It continues after the repair's
      // boundary instead of restarting from the start of the order.
      needed = 1
      const before = requests.length
      loader.loadMore()
      await settleAll()
      expect(requests.length).toBeGreaterThan(before)
      expect(requests[before]!.options.minValues).toEqual([2])
      expect(heldPrefixes()).toHaveLength(1)
    } finally {
      loader.dispose()
      for (const request of requests) request.deferred.resolve()
      await Promise.allSettled(participants)
    }
  })

  // A provider can answer a request synchronously, as Query DB does when it
  // reacquires a released Query from its cache. Its writes run a graph turn
  // inside the request; that turn asks the loader for more, but the loader
  // is still requesting and ignores it. The continuation it then stages has
  // no later graph turn to resume it. When a turn has already processed the
  // request's writes, the loader must continue at once, or a short window
  // stops paging and treats unread rows as loaded.
  it(`continues a chain whose synchronous answer the graph already processed`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    let revision = 0
    const subscription = fakeSubscription(requests, releases)
    const asyncRequest = subscription.requestSnapshot
    subscription.readOrderedSnapshot = () => [
      { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
    ]
    // Tie requests answer synchronously: they write a row, the graph turn
    // processes it and asks for more, and the request returns `true`.
    subscription.requestSnapshot = ((options: RequestOptions) => {
      if (options.where === undefined) {
        asyncRequest(options)
        return
      }
      const acquisition: LoadSubsetOptions = { where: options.where }
      requests.push({
        method: `snapshot`,
        options,
        acquisition,
        deferred: createDeferred(),
      })
      revision++
      loader.loadMore()
      options.onLoadSubsetResult?.(true, acquisition, () => {
        releases.push(acquisition)
      })
    }) as typeof subscription.requestSnapshot
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ limit: 3, dataNeeded: () => 1 }),
      subscription,
      `row`,
      () => {},
      () => false,
      () => revision,
    )
    try {
      loader.start()
      requests[0]!.deferred.resolve()
      await flushPromises()
      expect(
        requests.map(({ options }) => options.where !== undefined),
      ).toEqual([false, true, false])
      expect(requests[2]!.options.minValues).toEqual([1])
    } finally {
      loader.dispose()
      for (const request of requests) request.deferred.resolve()
      await flushPromises()
    }
  })

  it.each(
    [false, true].flatMap((fullFirst) =>
      [false, true].flatMap((replayed) =>
        [false, true].map((releaseThrows) => ({
          fullFirst,
          replayed,
          releaseThrows,
        })),
      ),
    ),
  )(
    `retains each failed release while replay repairs only full-source work: %j`,
    async ({ fullFirst, replayed, releaseThrows }) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const cleanupError = new Error(`release failed`)
      const loader = new OrderedSourceLoader(
        createOrderByInfo(),
        fakeSubscription(requests, releases, () => {
          if (releaseThrows) throw cleanupError
        }),
        `row`,
        (result) => {
          if (result instanceof Promise) participants.push(result)
        },
      )
      try {
        loader.start()
        loader.invalidateSourceOrdering()
        loader.loadMore()
        expect(requests).toHaveLength(2)
        const order = fullFirst ? [1, 0] : [0, 1]
        for (const index of order) {
          const failure = new Error(`request ${index} failed`)
          requests[index]!.deferred.reject(failure)
          await expect(participants[index]).rejects.toBe(failure)
        }
        if (replayed) loader.settleFullSourceReplay()
        if (releaseThrows)
          expect(() => loader.loadMore(1)).toThrow(cleanupError)
        else loader.loadMore(1)
        const expected = order
          .filter((index) => !replayed || index === 0)
          .map((index) => requests[index]!.acquisition)
        expect(releases).toEqual(expected)
        loader.loadMore(2)
        expect(releases).toEqual(expected)
        expect(requests).toHaveLength(replayed ? 2 : 3)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )

  it(`a page failure while a full-source demand is held releases only the page`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const loader = new OrderedSourceLoader(
      createOrderByInfo(),
      fakeSubscription(requests, releases),
      `row`,
    )
    loader.start()
    const page = (
      loader as unknown as { pending: Promise<unknown> | undefined }
    ).pending!
    expect(requests.map(({ method }) => method)).toEqual([`limited`])

    // A delete during the in-flight page requires authoritative repair.
    loader.invalidateSourceOrdering()
    loader.loadMore()
    expect(requests.map(({ method }) => method)).toEqual([
      `limited`,
      `snapshot`,
    ])
    expect(requests[1]!.options.limit).toBeUndefined()
    const fullSource = (
      loader as unknown as { pending: Promise<unknown> | undefined }
    ).pending!
    expect(fullSource).not.toBe(page)

    const failure = new Error(`page rejected`)
    requests[0]!.deferred.reject(failure)
    await expect(page).rejects.toBe(failure)

    // Blocked automatic retry; explicit retry releases the page only and must
    // not issue a duplicate full-source demand while one is already held.
    expect(loader.loadMore()).toBe(fullSource)
    expect(requests).toHaveLength(2)
    expect(releases).toEqual([])
    expect(loader.loadMore(1)).toBe(fullSource)
    expect(releases).toEqual([requests[0]!.acquisition])
    expect(requests).toHaveLength(2)

    requests[1]!.deferred.resolve()
    await fullSource
    expect(loader.loadMore(2)).toBeUndefined()
    expect(requests).toHaveLength(2)
    expect(releases).toEqual([requests[0]!.acquisition])
    loader.dispose()
  })

  it(`sync full-source failure retains no demand: replay settle is a no-op and retry reissues once`, () => {
    const releases: Array<LoadSubsetOptions> = []
    const methods: Array<string> = []
    const failure = new Error(`full-source threw after callback`)
    const acquisition: LoadSubsetOptions = {}
    let fail = true
    const subscription = {
      setOrderByIndex: () => {},
      requestSnapshot: (options: RequestOptions) => {
        methods.push(`snapshot`)
        if (!fail) return
        fail = false
        options.onLoadSubsetResult?.(true, acquisition, () =>
          releases.push(acquisition),
        )
        throw failure
      },
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ requiresFullSource: true }),
      subscription,
      `row`,
    )
    expect(() => loader.start()).toThrow(failure)
    expect(releases).toEqual([acquisition])
    expect(methods).toEqual([`snapshot`])

    loader.settleFullSourceReplay()
    expect(loader.loadMore()).toBeUndefined()
    expect(methods).toEqual([`snapshot`])

    loader.loadMore(1)
    expect(methods).toEqual([`snapshot`, `snapshot`])
    expect(releases).toEqual([acquisition])
    loader.dispose()
  })

  it(`replay repairs a failed full-source demand: a later explicit retry releases nothing`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ requiresFullSource: true }),
      fakeSubscription(requests, releases),
      `row`,
    )
    loader.start()
    const pending = (
      loader as unknown as { pending: Promise<unknown> | undefined }
    ).pending!
    const failure = new Error(`full-source rejected`)
    requests[0]!.deferred.reject(failure)
    await expect(pending).rejects.toBe(failure)
    expect(requests).toHaveLength(1)

    loader.settleFullSourceReplay()
    expect(loader.loadMore(1)).toBeUndefined()
    expect(releases).toEqual([])
    expect(requests).toHaveLength(1)
    expect(loader.loadMore(2)).toBeUndefined()
    expect(requests).toHaveLength(1)
    loader.dispose()
  })

  it(`without replay the explicit retry releases and reissues exactly once`, async () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ requiresFullSource: true }),
      fakeSubscription(requests, releases),
      `row`,
    )
    loader.start()
    const pending = (
      loader as unknown as { pending: Promise<unknown> | undefined }
    ).pending!
    requests[0]!.deferred.reject(new Error(`full-source rejected`))
    await expect(pending).rejects.toThrow(`full-source rejected`)

    loader.loadMore(1)
    expect(releases).toEqual([requests[0]!.acquisition])
    expect(requests).toHaveLength(2)
    loader.loadMore(1)
    expect(requests).toHaveLength(2)
    loader.dispose()
  })

  it(`a zero window opening with an offset requests the whole prefix from zero`, () => {
    const requests: Array<Observed> = []
    const releases: Array<LoadSubsetOptions> = []
    const info = createOrderByInfo({ offset: 2, limit: 0 })
    // Production dataNeeded is limit - topK size; it never adds the offset.
    info.dataNeeded = () => info.limit
    const loader = new OrderedSourceLoader(
      info,
      fakeSubscription(requests, releases),
      `row`,
    )
    loader.start()
    expect(requests).toHaveLength(0)

    info.limit = 3
    loader.loadMore(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe(`limited`)
    expect(requests[0]!.options.limit).toBe(5)
    expect(requests[0]!.options.offset).toBe(0)
    expect(requests[0]!.options.minValues).toBeUndefined()
    loader.dispose()
  })

  it(`a failed window move keeps the snapshot; the retry loads the source once`, async () => {
    type Row = { id: number; rank: number }
    const truth: Array<Row> = [1, 2, 3, 4, 5, 6].map((id) => ({ id, rank: id }))
    const failure = new Error(`page rejected`)
    const requests: Array<{ kind: string; options: LoadSubsetOptions }> = []
    const unloads: Array<LoadSubsetOptions> = []
    let failNextCursor = false
    const kindOf = (options: LoadSubsetOptions) =>
      options.orderBy !== undefined
        ? options.cursor
          ? `cursor-page`
          : `page`
        : options.where !== undefined
          ? `boundary`
          : `full`
    const source = createCollection<Row, number>({
      id: `cut-c-probe-source`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (sync) => {
          const installed = new Set<number>()
          sync.markReady()
          return {
            loadSubset: (options) => {
              requests.push({ kind: kindOf(options), options })
              if (options.cursor && failNextCursor) {
                failNextCursor = false
                return Promise.reject(failure)
              }
              let rows = truth.filter(
                (row) =>
                  !options.where ||
                  evaluateReferenceExpression(options.where, row) === true,
              )
              if (options.cursor)
                rows = rows.filter(
                  (row) =>
                    evaluateReferenceExpression(
                      options.cursor!.whereFrom,
                      row,
                    ) === true,
                )
              const offset = options.cursor ? 0 : (options.offset ?? 0)
              rows = rows.slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
              return (async () => {
                await Promise.resolve()
                const fresh = rows.filter(({ id }) => !installed.has(id))
                if (fresh.length === 0) return
                sync.begin()
                for (const value of fresh) {
                  installed.add(value.id)
                  sync.write({ type: `insert`, value })
                }
                const receipt = sync.commit()
                if (receipt !== true) await receipt
              })()
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2)
        .select(({ row }) => ({ id: row.id, rank: row.rank })),
    )
    const publications: Array<Array<number>> = []
    live.subscribeChanges(
      (batch) => {
        if (batch.length > 0)
          publications.push(live.toArray.map(({ id }) => id))
      },
      { includeInitialState: false },
    )
    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(requests.map(({ kind }) => kind)).toEqual([`page`, `boundary`])
      expect(unloads).toEqual([])
      const initialRequests = requests.length
      publications.length = 0

      failNextCursor = true
      const move = live.utils.setWindow({ limit: 4 })
      expect(move).not.toBe(true)
      await expect(move).rejects.toBe(failure)
      await flushPromises()
      // Rows: last settled snapshot; events: none; wait: rejected; requests: one.
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(publications).toEqual([])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
      expect(requests.slice(initialRequests).map(({ kind }) => kind)).toEqual([
        `cursor-page`,
      ])
      expect(unloads).toEqual([])
      expect(live.status).not.toBe(`error`)

      const retry = live.utils.setWindow({ limit: 4 })
      expect(retry).not.toBe(true)
      await retry
      await flushPromises()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2, 3, 4])
      expect(publications).toEqual([[1, 2, 3, 4]])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 4 })
      expect(requests.slice(initialRequests).map(({ kind }) => kind)).toEqual([
        `cursor-page`,
        `full`,
      ])
      // Retry retires the failed page; successful repair then retires earlier
      // finite demands while keeping the new authoritative demand.
      expect(unloads).toEqual([
        requests[initialRequests]!.options,
        ...requests.slice(0, initialRequests).map(({ options }) => options),
      ])

      await flushPromises()
      expect(requests).toHaveLength(initialRequests + 2)
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  })
})

describe(`Successful finite demand retirement`, () => {
  it.each([`none`, `throw`, `truncate`, `dispose`] as const)(
    `attempts releases once across %s reentry`,
    async (action) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const failure = new Error(`release failed`)
      let first = true
      const subscription = fakeSubscription(requests, releases, () => {
        if (!first) return
        first = false
        if (action === `throw`) throw failure
        if (action === `truncate`) loader.resetCursor()
        if (action === `dispose`) loader.dispose()
      })
      subscription.readOrderedSnapshot = () => [
        { type: `insert`, key: 1, value: { id: 1, rank: 1 } },
      ]
      const loader = new OrderedSourceLoader(
        createOrderByInfo({ dataNeeded: () => 0 }),
        subscription,
        `row`,
        (result) => {
          if (result instanceof Promise) participants.push(result)
        },
      )
      try {
        loader.start()
        requests[0]!.deferred.resolve()
        await participants[0]
        requests[1]!.deferred.resolve()
        await participants[1]
        loader.invalidateSourceOrdering()
        loader.loadMore()
        requests[2]!.deferred.resolve()
        await participants[2]
        requests[3]!.deferred.resolve()
        if (action === `throw`)
          await expect(participants[3]).rejects.toBe(failure)
        else await participants[3]
        expect(releases).toEqual(
          requests
            .slice(0, action === `truncate` || action === `dispose` ? 1 : 2)
            .map(({ acquisition }) => acquisition),
        )
        if (action === `truncate`) {
          loader.settleFullSourceReplay()
          expect(releases).toEqual(
            requests.slice(0, 2).map(({ acquisition }) => acquisition),
          )
        }
        loader.loadMore(1)
        expect(new Set(releases).size).toBe(releases.length)
        expect(requests).toHaveLength(4)
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )

  it.each([`before-replay`, `after-replay`] as const)(
    `keeps unfinished physical work observed when it settles %s`,
    async (when) => {
      const requests: Array<Observed> = []
      const releases: Array<LoadSubsetOptions> = []
      const participants: Array<Promise<unknown>> = []
      const subscription = fakeSubscription(requests, releases)
      let replaying = false
      Object.defineProperty(subscription, `hasPendingTruncateReplacement`, {
        get: () => replaying,
      })
      const loader = new OrderedSourceLoader(
        createOrderByInfo(),
        subscription,
        `row`,
        (result) => {
          if (result instanceof Promise) participants.push(result)
        },
      )
      try {
        loader.start()
        replaying = true
        loader.resetCursor()
        loader.loadFullSource()
        requests[1]!.deferred.resolve()
        await participants[1]
        expect(releases).toEqual([])
        const settlePage = async () => {
          requests[0]!.deferred.resolve()
          await participants[0]
        }
        if (when === `before-replay`) {
          await settlePage()
          expect(releases).toEqual([])
        }
        replaying = false
        loader.settleFullSourceReplay()
        if (when === `after-replay`) {
          expect(releases).toEqual([])
          await settlePage()
        }
        expect(releases).toEqual([requests[0]!.acquisition])
      } finally {
        loader.dispose()
        for (const request of requests) request.deferred.resolve()
        await Promise.allSettled(participants)
      }
    },
  )
})
