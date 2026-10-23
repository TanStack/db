import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  OrderedLoaderInvariantError,
  OrderedSourceLoader,
} from '../../src/query/live/ordered-source-loader.js'
import { PropRef } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
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

// The leading order value that a tie request asks for: its `where` is
// `eq(rank, value)`. Other requests have no tie value.
function tieValue(options: RequestOptions): unknown {
  const where = options.where as
    { name?: string; args?: Array<{ value?: unknown }> } | undefined
  return where?.name === `eq` ? where.args?.[1]?.value : undefined
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
  // A request from before a cursor reset that fails raises the debt to a
  // full-source read but keeps the work staged after the reset. A finite step
  // staged there must not run first: its boundary would come from rows the
  // failed request may have written only in part. The failure clears that
  // boundary, so the staged tie issues nothing and the owed read comes next.
  it(`starts the owed full-source read before a finite step staged after a reset`, async () => {
    const requests: Array<{
      options: RequestOptions
      deferred: ReturnType<typeof createDeferred>
    }> = []
    let revision = 0
    let answerAtOnce = false
    const request = (options: RequestOptions) => {
      const acquisition: LoadSubsetOptions = {
        orderBy: options.orderBy,
        limit: options.limit,
        where: options.where,
      }
      const deferred = createDeferred()
      requests.push({ options, deferred })
      if (answerAtOnce) {
        // The answer writes rows, so the graph has input it has not run.
        revision++
        options.onLoadSubsetResult?.(true, acquisition, () => {})
      } else {
        options.onLoadSubsetResult?.(deferred.promise, acquisition, () => {})
      }
    }
    const subscription = {
      readOrderedSnapshot: () => [{ value: { id: 1, rank: 1 } }],
      setOrderByIndex: () => {},
      requestLimitedSnapshot: request,
      requestSnapshot: request,
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo(),
      subscription,
      `row`,
      undefined,
      undefined,
      () => revision,
    )
    try {
      loader.start()
      const dead = requests[0]!
      loader.resetCursor()
      answerAtOnce = true
      loader.loadMore()
      expect(requests).toHaveLength(2)
      answerAtOnce = false
      dead.deferred.reject(new Error(`page from before the reset failed`))
      await flushPromises()
      loader.loadMore()
      const next = requests[2]!.options
      expect(next.where, `a tie from the staged step`).toBeUndefined()
      expect(next.orderBy, `the owed full-source read`).toBeUndefined()
    } finally {
      loader.dispose()
      for (const { deferred } of requests) deferred.resolve()
    }
  })

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

  it(`keeps nested refinement pending when an older lease release throws`, async () => {
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

    const uncaught = captureMicrotaskErrors()
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
      // The older prefix's release throws: an adapter bug, reported
      // uncaught. No participant reports it, and the nested refinement stays
      // pending.
      const recent = participants.slice(2)
      const pending = (
        loader as unknown as { pending: Promise<unknown> | undefined }
      ).pending
      expect(result).toBe(pending)
      expect(recent).toContain(pending)
      expect(
        recent.some((participant) => participantErrors.has(participant)),
      ).toBe(false)
      expect(uncaught.errors).toEqual([cleanupError])

      expect(loader.loadMore()).toBe(pending)
      expect(requests).toHaveLength(4)
      expect(releases).toEqual([0])
    } finally {
      uncaught.restore()
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
        // A successful full-source read retires every settled finite demand.
        // It also retires the older request when that request failed: the
        // full-source read superseded it, so its partial writes are covered
        // and its lease needs no explicit retry.
        const successfulFinite =
          outcome === `success`
            ? requests.slice(0, fullIndex).map(({ acquisition }) => acquisition)
            : []
        expect(releases).toEqual(successfulFinite)

        // An explicit retry releases the failed demands that remain, in
        // failure order: all of them when the full-source read failed.
        loader.loadMore(1)
        const failedIndices =
          outcome === `success`
            ? []
            : (order === `older-first`
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

  // A request that a bounded repair superseded can fail after that repair
  // has finished and after a newer ordering invalidation. The failure law
  // lets the loader's own failure block ordinary refills until an explicit
  // retry. A superseded request's failure is not the loader's own: its
  // partial writes need the full-source read that the overlap replaced, and
  // nothing else will start one. Here the newer invalidation's reaction is
  // deferred, as pending joined work or a later graph run can defer it, so
  // the old tie fails first. The next ordinary pass must still recover.
  // Found by a TLA+ model of the loader's request authority (#2191).
  it(`recovers a superseded tie that fails after its repair and a newer invalidation`, async () => {
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
    const isFullSource = ({ options }: Observed) =>
      options.orderBy === undefined && options.where === undefined
    try {
      loader.start()
      requests[0]!.deferred.resolve()
      await flush()
      const tieIndex = 1
      expect(requests[tieIndex]!.options.where).toBeDefined()

      // The repair supersedes the in-flight tie and runs to its fixed point.
      loader.invalidateSourceOrdering()
      loader.loadMore()
      const repairIndex = 2
      expect(requests[repairIndex]!.options.where).toBeUndefined()
      for (let index = repairIndex; index < requests.length; index++) {
        requests[index]!.deferred.resolve()
        await flush()
      }
      expect(requests.some(isFullSource)).toBe(false)

      // A newer invalidation arrives; the loader's reaction is deferred.
      loader.invalidateSourceOrdering()
      const before = requests.length
      requests[tieIndex]!.deferred.reject(new Error(`tie failed`))
      await flush()
      loader.loadMore()
      // One full-source read recovers it, with no explicit retry.
      expect(requests.slice(before).filter(isFullSource)).toHaveLength(1)
    } finally {
      loader.dispose()
      for (const request of requests) request.deferred.resolve()
      await Promise.allSettled(participants)
    }
  })

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
    `releases each failed lease once, at a covering replay or the explicit retry: %j`,
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
      const uncaught = captureMicrotaskErrors()
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
        // A replay covers the source like a full-source success, so it
        // releases the superseded page itself. Without a replay, the explicit
        // retry releases both. A throwing release is reported uncaught.
        if (replayed) loader.settleFullSourceReplay()
        loader.loadMore(1)
        await flushPromises()
        const expected = order
          .filter((index) => !replayed || index === 0)
          .map((index) => requests[index]!.acquisition)
        expect(releases).toEqual(expected)
        // Each throwing release is reported uncaught, exactly once.
        expect(uncaught.errors).toEqual(
          releaseThrows ? releases.map(() => cleanupError) : [],
        )
        loader.loadMore(2)
        expect(releases).toEqual(expected)
        expect(requests).toHaveLength(replayed ? 2 : 3)
      } finally {
        uncaught.restore()
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
      const uncaught = captureMicrotaskErrors()
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
        // A throwing release is reported uncaught; the load still settles.
        await participants[3]
        await flushPromises()
        expect(uncaught.errors).toEqual(action === `throw` ? [failure] : [])
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
        uncaught.restore()
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

/**
 * # Request authority under generated settlement orders
 *
 * ## Contract
 *
 * ARCHITECTURE.md, "Ordered requests, continuation, and recovery", gives the
 * loader authority rules for requests that overlap an ordering invalidation:
 *
 * - **Held:** a successful bounded repair holds the acquisitions it read.
 *   Only a later read that covers them may retire them: a newer repair, a
 *   full-source read, or a truncate replay that covers the source, or a
 *   prefix read issued after the repair that reaches every repair row still
 *   inside the window. That prefix counts once it succeeds or once a
 *   successful replay reacquires its demand while it is still in flight. A request issued before the invalidation proves no
 *   current coverage, so it never retires them.
 * - **No leak:** once loading is quiet and no failure blocks it, the loader
 *   holds nothing issued before its last successful authoritative read.
 *   Otherwise every later refetch would read that request again. A
 *   superseded request that failed is retired once a full-source read issued
 *   after it succeeds, or a replay that covers the source settles after it;
 *   it needs no explicit retry.
 * - **Covering lease:** a full-source lease whose read succeeded, or whose
 *   demand a successful replay reacquired, is never released. A late failure
 *   of its own transport does not undo that coverage.
 * - **Invariant:** the loader's transition table never rejects a move. The
 *   oracle records any `OrderedLoaderInvariantError` the loader throws, so
 *   the generated histories also fuzz that table.
 * - **No stale step:** a repair chain whose ordering epoch moved is replaced
 *   before it issues another tie or refill.
 * - **Error identity:** a request that fails reports its own error through
 *   its participant, or a release's cleanup error. A read the loader starts
 *   while handling it cannot replace that error. A dead request's failure
 *   belongs to its replay, and one a replay reacquired is absorbed.
 * - **Cost:** once loading is quiet and a bounded repair is available, an
 *   invalidation reads no full source, and it issues at most one chain (in
 *   this fake, a prefix, a tie, and a refill) per ordering epoch move.
 * - **Ignored report:** a sync adapter's report that served pages may have
 *   shifted issues no authoritative request when nothing it describes can
 *   be wrong: before any request settled (a request in flight still owes an
 *   exact result for its own options), or while the loader's coverage is
 *   its own first ordered prefix of at least `offset + limit` rows, with
 *   only that prefix's tie after it, and a row past the page sorts strictly
 *   after its end with no more rows needed (ARCHITECTURE.md). That row is
 *   evidence only when the page read it, or when the tie the loader read is
 *   the tie of the page's end. The law judges only quiet histories: every
 *   earlier step settled a request successfully, ran a pass, inserted a row,
 *   reported, or changed joined work, and no release callback has side
 *   effects, so no earlier event owes a repair.
 * - **Unproven report:** in such a quiet history, a report over the loader's
 *   own first prefix that no row it read proves starts a repair on its pass,
 *   or reads the tie of the page's end, which completes the proof.
 *   An installed row past the page can come from another request, and a
 *   refetch can move the page's end before the tie the loader read, so the
 *   loader cannot use either as proof. This fake's installed rows ignore a
 *   read's limit, so its tie is always for the last installed row; the
 *   ignored-report branch for a first page is therefore unreachable here,
 *   and only the unproven-report law runs on such a page.
 * - **One request at a time:** a request issued while another is in flight
 *   starts authority, or an authority start lies between them. A repair
 *   chain that a newer start replaced issues no more steps.
 * - **No strand:** a request that authoritative work superseded can still
 *   fail. Its partial writes need the full-source read that the overlap
 *   replaced, so the loader starts one without an explicit retry. The
 *   loader's own failure (an authoritative request, or a request that
 *   nothing superseded) may block ordinary refills until an explicit retry.
 *   That is the failure law, so it is not a strand.
 * - **Progress:** once loading is quiet, an invalidation and an ordinary pass
 *   issue a read, unless a full-source read covers the source. A throwing
 *   release, a staged repair continuation, or a page that invalidated its
 *   own order must not leave a repair that nothing resumes.
 *
 * These laws came from a TLA+ model of the loader's request authority
 * (#2191). This property checks the real loader against them.
 *
 * The leak and progress laws also judge a truncate replay. A replay owns
 * the requests issued before the truncate. When the subscription still holds
 * a full-source lease, the settled replay covers the source.
 *
 * ## Model
 *
 * The model is a ledger of observed requests, kept outside the loader. Each
 * request is classified from its options alone:
 * - a full-source read has no order and no predicate;
 * - a request is authoritative when it is a full-source read or it carries
 *   `refetch: true` (a bounded repair and its tie and refill);
 * - an authoritative read starts at a full-source read or a repair prefix
 *   (ordered, with no predicate and no cursor); the leak and held laws
 *   measure from the latest successful start;
 * - a repair prefix is a step of a running chain, not a start, when it is
 *   issued while a chain member settles or by the continuation such a
 *   settlement left staged (a synchronous answer) or deferred (joined work),
 *   as an optimistic refill or a shrunk window's prefix is;
 * - a truncate replay that settles while the subscription holds a
 *   full-source lease, even a failed one, covers the source and counts as a
 *   successful start after every earlier request; the leases it reacquired
 *   stay held. Requests issued before the truncate belong to the replay, so
 *   the laws judge only later ones;
 * - a request is superseded when an authoritative request was issued while
 *   it was in flight.
 * The ledger records each request's outcome and whether the loader released
 * it. It never reads the loader's fields.
 *
 * ## History grammar
 *
 * A history is up to sixteen steps over a fake subscription whose requests
 * stay in flight until a step settles them:
 * - `settle` resolves or rejects one in-flight request, in any order, and
 *   `failOldest` rejects the oldest one, which is the one most often
 *   superseded;
 * - `settleNewest` resolves the newest in-flight request, as a provider that
 *   answers out of order can, so a repair chain finishes around an older
 *   request;
 * - `invalidateThenFailOldest` invalidates source ordering with the
 *   reaction deferred and rejects the oldest in-flight request before the
 *   loader reacts;
 * - `invalidate` invalidates source ordering, and `report` delivers a
 *   loaded-subset report; either can run an ordinary pass at once or leave
 *   the reaction deferred, as pending joined work or a later graph run can;
 * - `pass` runs an ordinary `loadMore()`;
 * - `move` is an explicit window move, which may also widen the window, so
 *   an unindexed loader reads a longer prefix;
 * - `syncInvalidatingPage` runs a pass whose next page's own delivery
 *   invalidates source ordering before the request returns;
 * - `unexpressibleBoundary` makes the last installed row's order value NaN,
 *   or expressible again, so no cursor can continue from it;
 * - `joinedBusy` and `joinedIdle` hold and finish LEFT-joined work, which
 *   defers ordinary loading, and the pass the subscriber runs after it;
 * - `truncate` resets the cursor and holds ordinary passes behind a pending
 *   replay; `replaySucceeds` settles the replay and `replayFails` leaves it
 *   pending;
 * - `optimisticDeparture` hides the window's row behind an optimistic
 *   overlay, and `sourceDelete` deletes it from the source;
 * - `timer` runs the bounded backoff retry when that scenario enables it;
 * - `hang` makes the provider never answer the oldest open request, like a
 *   lost TCP segment; the drain leaves it in flight;
 * - `startThrows` makes the next request throw while it starts, so it
 *   acquires nothing; `failOldestThrowingRecovery` fails a superseded
 *   request (the oldest, if none is) while the recovery read it starts
 *   throws at its start;
 * - `dispose` disposes the loader. After it the loader issues no request and
 *   releases no lease, even as earlier requests settle; the end laws then
 *   judge nothing more.
 * Passes are ordinary graph passes, which the subscriber skips while a
 * truncate replay is pending; a window move still runs. Scenarios cross an
 * indexed loader (pages and ties) with an unindexed one (prefix reads),
 * window limits 1 and 2, whether the first page settles before the history
 * (a bounded repair needs a settled request), whether the first release
 * callback throws, whether a repair's prefix answers at once from installed
 * rows (an eager source), plans that read only the full source, a joined
 * order source, one or three installed rows (three let a report fall inside
 * the loader's own first page), whether the window needs more rows,
 * whether the backoff retry is enabled, whether the first release callback
 * starts a truncate of its own (a reentrant reset), whether the first
 * release callback disposes the loader, whether each release
 * callback runs an ordinary pass synchronously (as a graph run does when a
 * release delivers deletes outside a transaction; inside one the run is
 * deferred, which is the ordinary form), and a window offset of 0 or 1.
 * Truncates can stack on a pending replay, including one that failed.
 *
 * ## Checkpoints
 *
 * Held, one request at a time, and release are checked after every step.
 * A release that throws is an adapter bug: the loader reports it uncaught
 * from a microtask and changes nothing else, so each one must be reported
 * that way exactly once, and no other error may escape a microtask.
 * The release law says each acquisition is released at most once, and that
 * nothing is released while a truncate replay owns it, unless an explicit
 * retry replaces it or a held successful full-source lease covers it. After
 * the history, a drain finishes joined work, settles each truncate replay,
 * including one a release starts during the drain, settles every in-flight
 * request that is not hung, and runs ordinary passes until the loader issues
 * nothing new. No strand is checked at that point. Then, if an own
 * failure still blocks the loader, one explicit window move retries it and
 * the drain runs again. No leak is checked next, then progress.
 *
 * ## Limits
 *
 * The fake subscription's rows do not move except for the unexpressible
 * boundary, so cursor values are fixed. Publication holds are outside this
 * property; other tests here own them. The laws do not judge requests issued
 * before a truncate, which the replay owns. The loader has no request
 * timeout, so a hung authoritative request may hold its work slot: progress
 * is not required then, the leak law does not judge the unfinished chain,
 * and the strand law accepts recovery that is owed behind it. A failed replay stays pending until the drain
 * settles it. The fake releases an acquisition when the loader calls its
 * release; it does not model an adapter that removes rows later.
 */
type LedgerRequest = {
  index: number
  options: RequestOptions
  acquisition: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred>
  fullSource: boolean
  authoritative: boolean
  superseded: boolean
  // A refetch prefix issued as a step of a running repair chain, such as an
  // optimistic refill or a shrunk window's prefix, rather than the start of
  // a new chain.
  chainStep: boolean
  outcome: `inflight` | `ok` | `failed`
  released: boolean
  // A successful truncate replay reacquired the request's demand, even while
  // its own transport was still in flight.
  replayed: boolean
  // The provider never answers the request, like a lost segment.
  hung: boolean
  // The error the request failed with, if it failed.
  error: Error | undefined
  // Truncates before the request was issued, and before it failed, and the
  // event clock at its failure. A request that fails after a truncate is
  // dead; the replay, not the loader, owns its lease.
  issuedTruncates: number
  failedTruncates: number
  failedAt: number
}

type AuthorityCommand =
  | { type: `settle`; pick: number; ok: boolean }
  | { type: `invalidate`; react: boolean }
  | { type: `report`; react: boolean }
  | { type: `failOldest` }
  | { type: `settleNewest` }
  | { type: `invalidateThenFailOldest` }
  | { type: `pass` }
  | { type: `move`; delta: -1 | 0 | 1 }
  | { type: `syncInvalidatingPage` }
  | { type: `unexpressibleBoundary` }
  | { type: `joinedBusy` }
  | { type: `joinedIdle` }
  | { type: `truncate` }
  | { type: `replaySucceeds` }
  | { type: `replayFails` }
  | { type: `optimisticDeparture` }
  | { type: `sourceDelete`; react: boolean }
  | { type: `timer` }
  | { type: `hang` }
  | { type: `dispose` }
  | { type: `startThrows` }
  | { type: `failOldestThrowingRecovery` }

type AuthorityCase = {
  indexed: boolean
  limit: 1 | 2
  // Settle the first page before the history. A bounded repair needs a
  // settled request; without one an invalidation reads the full source.
  settledFirst: boolean
  // The first release callback throws, as an adapter's cleanup can.
  releaseFault: boolean
  // A bounded repair's prefix answers at once, as an eager indexed source
  // does, and its rows change graph input.
  syncRepair: boolean
  // The plan reads only the full source.
  requiresFullSource: boolean
  // The order source is filtered by a LEFT-joined source, whose pending
  // work defers ordinary loading.
  joined: boolean
  // Installed rows the loader reads locally. Three let a window lie inside
  // its own first page, so a report may skip its repair.
  snapshotRows: 1 | 3
  // Whether the window still needs rows after each read.
  needsMore: boolean
  // A failed authoritative read retries itself after a backoff.
  retryTimer: boolean
  // The first release callback starts a truncate synchronously, as a
  // reentrant reset does.
  releaseTruncates: boolean
  // The window starts after this many rows of the order.
  offset: 0 | 1
  // Each release callback runs an ordinary pass synchronously, as a graph run
  // that reacts to the removed rows does.
  releaseReenters: boolean
  // The first release callback disposes the loader, as adapter cleanup can.
  releaseDisposes: boolean
  history: Array<AuthorityCommand>
}

const authorityCommand: fc.Arbitrary<AuthorityCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      pick: fc.nat({ max: 7 }),
      // Failures are rarer than successes, so most histories keep the
      // strand law checkable: an own failure needs an explicit retry anyway.
      ok: fc.oneof(
        { weight: 9, arbitrary: fc.constant(true) },
        { weight: 1, arbitrary: fc.constant(false) },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`invalidate` as const),
      react: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`report` as const),
      react: fc.boolean(),
    }),
  },
  // The oldest in-flight request is the one most often superseded.
  { weight: 1, arbitrary: fc.constant({ type: `failOldest` as const }) },
  // A provider can answer newer requests first, so a repair chain finishes
  // while an older request is still in flight.
  { weight: 3, arbitrary: fc.constant({ type: `settleNewest` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `invalidateThenFailOldest` as const }),
  },
  { weight: 1, arbitrary: fc.constant({ type: `pass` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `syncInvalidatingPage` as const }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`move` as const),
      delta: fc.constantFrom(-1 as const, 0 as const, 1 as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `unexpressibleBoundary` as const }),
  },
  { weight: 1, arbitrary: fc.constant({ type: `joinedBusy` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `joinedIdle` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `truncate` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `replaySucceeds` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `replayFails` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `optimisticDeparture` as const }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`sourceDelete` as const),
      react: fc.boolean(),
    }),
  },
  // The backoff retry needs a failed repair first, so it runs more often.
  { weight: 4, arbitrary: fc.constant({ type: `timer` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `hang` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `dispose` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `startThrows` as const }) },
  {
    weight: 3,
    arbitrary: fc.constant({ type: `failOldestThrowingRecovery` as const }),
  },
)

const authorityCaseArbitrary: fc.Arbitrary<AuthorityCase> = fc.record({
  indexed: fc.boolean(),
  limit: fc.constantFrom(1 as const, 2 as const),
  settledFirst: fc.boolean(),
  releaseFault: fc.boolean(),
  syncRepair: fc.boolean(),
  requiresFullSource: fc.oneof(
    { weight: 5, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  joined: fc.boolean(),
  snapshotRows: fc.constantFrom(1 as const, 3 as const),
  needsMore: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  retryTimer: fc.boolean(),
  releaseTruncates: fc.oneof(
    { weight: 4, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  offset: fc.constantFrom(0 as const, 1 as const),
  releaseReenters: fc.oneof(
    { weight: 3, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  releaseDisposes: fc.oneof(
    { weight: 5, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  history: fc.array(authorityCommand, { minLength: 1, maxLength: 16 }),
})

type AuthorityObservation = {
  supersededFailures: number
  // Superseded requests that failed after the repair that superseded them
  // succeeded: the premise of the strand law.
  supersededFailuresAfterRepair: number
  // Such failures where the strand law was checkable: no own failure since
  // the last full-source read.
  checkedStrandPremises: number
  // Superseded requests that failed after their repair finished while a
  // newer invalidation's reaction was deferred.
  deferredStrandShapes: number
  staleSettlementsAfterRepair: number
  // Release callbacks that threw, synchronous repair answers, and pages
  // whose own delivery invalidated ordering.
  releaseFaults: number
  syncRepairs: number
  invalidatingPages: number
  // Commands of the later dimensions that changed loader input.
  unexpressibleBoundaries: number
  joinedDeferrals: number
  ignoredReportsBeforeSettle: number
  ignoredReportsInsideFirstPage: number
  repairedReportsOnOwnPage: number
  truncates: number
  replayFailures: number
  optimisticDepartures: number
  sourceDeletes: number
  timerRetries: number
  shrinkingMoves: number
  reentrantTruncates: number
  stackedTruncates: number
  truncatesAfterFailedReplay: number
  reentrantPasses: number
  disposals: number
  startThrows: number
  startThrowsDuringFailure: number
  costChecks: number
  hungRequests: number
  offsetWindows: number
}

async function checkAuthorityCase(
  testCase: AuthorityCase,
): Promise<AuthorityObservation> {
  const ledger: Array<LedgerRequest> = []
  const participants: Array<Promise<unknown>> = []
  let joinedPending = false
  let truncatePending = false
  let boundaryUnexpressible = false
  const info = createOrderByInfo({
    limit: testCase.limit,
    ...(testCase.indexed ? {} : { index: undefined }),
    // A synchronous repair answer reads installed rows: an eager source.
    ...(testCase.syncRepair ? { sourceHoldsAllRows: true } : {}),
    requiresFullSource: testCase.requiresFullSource,
    ...(testCase.joined ? { joinedFilterSourceId: `markers` } : {}),
    dataNeeded: () => (testCase.needsMore ? 1 : 0),
    offset: testCase.offset,
  })
  let revision = 0
  // A repair chain's steps run as continuations of its members: while a
  // member settles, or later from the continuation that settlement left
  // staged or deferred. A refetch prefix issued either way is a step, such as
  // an optimistic refill; any other one starts a chain. After the ordering
  // epoch moves, a settling member replaces its chain before it continues, so
  // a continuation's prefix after an epoch move starts the replacement. The
  // oracle counts epoch moves as calls to `invalidateSourceOrdering()`, the
  // one method that moves the epoch, including the loader's own calls.
  let epochMoves = 0
  let epochMovesAtLastStart = -1
  let concurrencyViolation: string | undefined
  // Requests the fake has answered whose participant is not yet reported,
  // and each request's participant with the reason it rejected with.
  const answering: Array<LedgerRequest> = []
  const participantOf = new Map<LedgerRequest, Promise<unknown>>()
  const rejections = new Map<LedgerRequest, unknown>()
  let throwNextStart = false
  let startThrewDuringRetry = false
  let settlingFailure = false
  let startThrowsDuringFailure = 0
  let costChecks = 0
  // The start-throw branch sets the flag, so read it through a call.
  const retryStartThrew = () => startThrewDuringRetry
  let startThrows = 0
  let identityViolation: string | undefined
  // A request may fail, but the loader's own transition table must never
  // reject a move: that is a broken rule, wherever it surfaces.
  let invariantViolation: string | undefined
  function observe(error: unknown) {
    if (error instanceof OrderedLoaderInvariantError) {
      invariantViolation ??= error.message
    }
  }
  let releaseViolation: string | undefined
  // A disposed loader owns nothing: it issues no request and releases no
  // lease, even as requests it issued earlier settle.
  let disposed = false
  // A release callback can dispose the loader, so read the flag through a call.
  const isDisposed = () => disposed
  let disposeViolation: string | undefined
  let disposals = 0
  let explicitRetrying = false
  let reentrantTruncates = 0
  let stackedTruncates = 0
  let truncatesAfterFailedReplay = 0
  let replayFailedSinceTruncate = false
  let reentering = false
  let reentrantPasses = 0
  let hungRequests = 0
  let settlingChainMember = false
  let continuationOwed = false
  let invalidateNextPage = false
  let releaseFaults = 0
  let syncRepairs = 0
  let invalidatingPages = 0
  const record = (method: Observed[`method`], options: RequestOptions) => {
    // Like the real subscription, a continuation's acquisition carries a
    // cursor, so the loader does not take it for a prefix read.
    const acquisition: LoadSubsetOptions = {
      orderBy: options.orderBy,
      limit: options.limit,
      where: options.where,
      ...(options.minValues === undefined
        ? {}
        : {
            cursor: {
              whereFrom: new PropRef([`row`, `rank`]),
              whereCurrent: new PropRef([`row`, `rank`]),
            } as unknown as NonNullable<LoadSubsetOptions[`cursor`]>,
          }),
    }
    const fullSource =
      method === `snapshot` &&
      options.orderBy === undefined &&
      options.where === undefined
    const authoritative = fullSource || options.refetch === true
    if (authoritative) {
      for (const request of ledger) {
        if (request.outcome === `inflight` && !request.authoritative) {
          request.superseded = true
        }
      }
    }
    const request: LedgerRequest = {
      index: ledger.length,
      options,
      acquisition,
      deferred: createDeferred(),
      fullSource,
      authoritative,
      superseded: false,
      chainStep:
        options.refetch === true &&
        (settlingChainMember || continuationOwed) &&
        epochMovesAtLastStart === epochMoves,
      outcome: `inflight`,
      released: false,
      replayed: false,
      hung: false,
      error: undefined,
      issuedTruncates: truncates,
      failedTruncates: -1,
      failedAt: -1,
    }
    ledger.push(request)
    if (disposed) {
      disposeViolation ??= `request ${request.index} was issued after dispose`
    }
    // A chain whose epoch moved is replaced before it issues another tie or
    // refill (ARCHITECTURE.md, ordered repair).
    if (
      authoritative &&
      !fullSource &&
      !startsAuthority(request) &&
      epochMoves !== epochMovesAtLastStart
    ) {
      concurrencyViolation ??= `request ${request.index}, a step of a repair chain whose epoch moved, was issued before its replacement`
    }
    if (startsAuthority(request)) epochMovesAtLastStart = epochMoves
    // An issued request consumes an owed continuation. An ordinary page also
    // shows the chain finished, since none is issued while a repair runs.
    continuationOwed = false
    // One request at a time: a request issued while another is in flight
    // starts authority, or a start lies between them, so the older one is
    // superseded. The replay owns requests from before the truncate.
    if (!startsAuthority(request)) {
      const overlapped = ledger.find(
        (other) =>
          other !== request &&
          other.outcome === `inflight` &&
          other.index >= replayOwnedBefore &&
          ledger.every(
            (start) =>
              start.index <= other.index ||
              start.index >= request.index ||
              !startsAuthority(start),
          ),
      )
      if (overlapped) {
        concurrencyViolation ??= `request ${request.index} was issued while request ${overlapped.index} of the same authority was in flight`
      }
    }
    // The subscription throws while the request starts, so it acquires
    // nothing: the loader's own failure, with no lease to release.
    if (throwNextStart) {
      throwNextStart = false
      startThrows++
      if (explicitRetrying) startThrewDuringRetry = true
      // A recovery read that throws while the loader handles another failure.
      if (settlingFailure) startThrowsDuringFailure++
      request.outcome = `failed`
      request.released = true
      request.error = new Error(`request ${request.index} failed to start`)
      request.failedTruncates = truncates
      request.failedAt = ++clock
      throw request.error
    }
    const release = () => {
      if (disposed) {
        disposeViolation ??= `request ${request.index} was released after dispose`
      }
      // A full-source lease that covers the source stays held: its read
      // succeeded, or a successful replay reacquired its demand. Its own
      // transport failing later does not undo that coverage.
      if (
        request.fullSource &&
        !request.released &&
        (request.outcome === `ok` || request.replayed)
      ) {
        releaseViolation ??= `request ${request.index}, a full-source lease that covers the source, was released`
      }
      // Every acquisition is released at most once.
      if (request.released) {
        releaseViolation ??= `request ${request.index} was released twice`
      }
      // A pending truncate replay owns every demand the subscription holds.
      // A release is safe only when an explicit retry replaces the demand or
      // a held successful full-source lease covers it.
      const coveredBySource = ledger.some(
        (other) =>
          other.fullSource && other.outcome === `ok` && !other.released,
      )
      if (truncatePending && !explicitRetrying && !coveredBySource) {
        releaseViolation ??= `request ${request.index} was released while a truncate replay was pending`
      }
      request.released = true
      if (testCase.releaseDisposes && !disposed) {
        disposed = true
        disposals++
        loader.dispose()
        return
      }
      if (testCase.releaseReenters && !reentering) {
        reentering = true
        reentrantPasses++
        try {
          run(() => loader.loadMore())
        } finally {
          reentering = false
        }
      }
      if (testCase.releaseTruncates && reentrantTruncates === 0) {
        reentrantTruncates++
        truncate()
      }
      if (testCase.releaseFault && releaseFaults === 0) {
        releaseFaults++
        const failure = new Error(`release ${request.index} failed`)
        thrownReleases.push(failure)
        throw failure
      }
    }
    if (
      testCase.syncRepair &&
      method === `snapshot` &&
      options.refetch === true &&
      options.orderBy !== undefined &&
      options.where === undefined
    ) {
      syncRepairs++
      request.outcome = `ok`
      revision++
      const before = ledger.length
      const settling = settlingChainMember
      settlingChainMember = true
      try {
        answering.push(request)
        options.onLoadSubsetResult?.(true, acquisition, release)
      } finally {
        settlingChainMember = settling
      }
      if (ledger.length === before) continuationOwed = true
      return
    }
    if (invalidateNextPage && method === `limited` && !authoritative) {
      // The page's own delivery changes source order before it returns.
      invalidateNextPage = false
      invalidatingPages++
      loader.invalidateSourceOrdering()
    }
    answering.push(request)
    options.onLoadSubsetResult?.(request.deferred.promise, acquisition, release)
  }
  // Installed rows in ascending rank. An unexpressible boundary makes the
  // last one NaN, which no cursor can express.
  const snapshot = () =>
    Array.from({ length: testCase.snapshotRows }, (_, index) => ({
      type: `insert`,
      key: index + 1,
      value: {
        id: index + 1,
        rank:
          boundaryUnexpressible && index === testCase.snapshotRows - 1
            ? Number.NaN
            : index + 1,
      },
    }))
  const subscription = {
    readOrderedSnapshot: snapshot,
    setOrderByIndex: () => {},
    hasHeldSyncTransaction: false,
    get hasPendingTruncateReplacement() {
      return truncatePending
    },
    requestLimitedSnapshot: (options: RequestOptions) =>
      record(`limited`, options),
    requestSnapshot: (options: RequestOptions) => record(`snapshot`, options),
  } as unknown as CollectionSubscription
  const loader: OrderedSourceLoader = new OrderedSourceLoader(
    info,
    subscription,
    `row`,
    (result) => {
      // The loader reports a request's participant once the request returns;
      // nested requests issued meanwhile report first.
      const request = answering.pop()
      if (!(result instanceof Promise)) return
      participants.push(result.catch(observe))
      if (request) {
        participantOf.set(request, result)
        result.catch((reason: unknown) => rejections.set(request, reason))
      }
    },
    () => testCase.retryTimer,
    () => revision,
    () => joinedPending,
  )
  const invalidateSourceOrdering = loader.invalidateSourceOrdering.bind(loader)
  loader.invalidateSourceOrdering = () => {
    epochMoves++
    invalidateSourceOrdering()
  }
  const flush = async () => {
    for (let turn = 0; turn < 6; turn++) await Promise.resolve()
  }
  let windowOperation = 0
  // Requests issued before the last truncate belong to its replay, which
  // reacquires and retires them; the leak, held, and strand laws judge only
  // later requests.
  let replayOwnedBefore = 0
  // A replay reacquires every acquisition the subscription still holds. When
  // one of them is a full-source demand, even a failed one, the successful
  // replay covers the source.
  // A covering replay is an authoritative success after every request issued
  // before it: the last ledger index at that point, plus a half. The
  // full-source leases it reacquired are its coverage and stay held.
  let replayAuthority = -1
  // Events in order, so a replay can be placed after a failure.
  let clock = 0
  let replaySettledAt = -1
  let replayCoverage = new Set<LedgerRequest>()
  const settleReplay = () => {
    truncatePending = false
    replaySettledAt = ++clock
    for (const request of ledger) {
      if (!request.released && request.outcome !== `failed`) {
        request.replayed = true
      }
    }
    replayCoverage = new Set(
      ledger.filter((request) => request.fullSource && !request.released),
    )
    if (replayCoverage.size > 0) replayAuthority = ledger.length - 0.5
    run(() => loader.settleFullSourceReplay())
  }
  let unexpressibleBoundaries = 0
  let joinedDeferrals = 0
  let ignoredReportsBeforeSettle = 0
  let ignoredReportsInsideFirstPage = 0
  let repairedReportsOnOwnPage = 0
  // Steps that settle a request successfully, run a pass, report, or change
  // joined work. None of them owes a repair.
  const quietCommand = (command: AuthorityCommand) =>
    (command.type === `settle` && command.ok) ||
    command.type === `settleNewest` ||
    command.type === `pass` ||
    command.type === `report` ||
    command.type === `joinedBusy` ||
    command.type === `joinedIdle`
  // An unproven report whose pass pending joined work deferred: the ledger
  // index at the report and the window size it judged.
  let owedProof: { from: number; windowSize: number } | undefined
  const expectProofRequest = (from: number, windowSize: number) => {
    const issued = ledger
      .slice(from)
      .some(
        ({ authoritative, options }) =>
          authoritative || tieValue(options) === windowSize,
      )
    if (!issued) {
      throw new Error(
        `unproven report: a report over a first page that no row it read proves issued no repair and no tie of its end`,
      )
    }
  }
  let truncates = 0
  let replayFailures = 0
  let optimisticDepartures = 0
  let sourceDeletes = 0
  let timerRetries = 0
  let shrinkingMoves = 0
  const run = (work: () => unknown) => {
    const before = ledger.length
    try {
      const result = work()
      if (result instanceof Promise) participants.push(result.catch(observe))
    } catch (error) {
      // A rejected request surfaces through its participant.
      observe(error)
    }
    // A pass that issues nothing consumed or finished an owed continuation,
    // unless joined work deferred it.
    if (ledger.length === before && !joinedPending) continuationOwed = false
  }
  const inflight = () =>
    ledger.filter(({ outcome, hung }) => outcome === `inflight` && !hung)
  // A truncate resets the cursor; the subscription replays its loaded
  // subsets and holds ordinary loading until the replay settles.
  // A release callback can start a truncate, so read the flag through a call.
  const replayPending = () => truncatePending
  function truncate() {
    truncates++
    // A second truncate while a replay is pending, possibly one that failed.
    if (truncatePending) {
      stackedTruncates++
      if (replayFailedSinceTruncate) truncatesAfterFailedReplay++
    }
    replayFailedSinceTruncate = false
    loader.resetCursor()
    truncatePending = true
    replayOwnedBefore = ledger.length
    replayCoverage = new Set()
  }
  // An ordinary graph pass. The subscriber asks for more only while no
  // truncate replacement is pending.
  const graphPass = () => {
    if (!truncatePending) run(() => loader.loadMore())
  }
  const sentRows = new Map([[1, { id: 1, rank: 1 }]])
  const settle = async (request: LedgerRequest, ok: boolean) => {
    request.outcome = ok ? `ok` : `failed`
    if (!ok) {
      request.failedTruncates = truncates
      request.failedAt = ++clock
    }
    const chainMember = request.authoritative && !request.fullSource
    const before = ledger.length
    settlingChainMember = chainMember
    if (ok) request.deferred.resolve()
    else {
      request.error = new Error(`request ${request.index} failed`)
      request.deferred.reject(request.error)
    }
    settlingFailure = !ok
    await flush()
    settlingFailure = false
    // A failed request's participant reports that request's own error; a
    // read the loader starts while handling it cannot replace it.
    if (!ok && participantOf.has(request)) {
      const reason = rejections.get(request)
      if (rejections.has(request)) {
        if (reason !== request.error && !injectedCleanup(reason)) {
          identityViolation ??= `request ${request.index} failed with its own error, but its participant rejected with ${String(reason)}`
        }
      } else if (
        // A dead request's failure belongs to the replay, and one a replay
        // reacquired is absorbed by its coverage; any other live failure is
        // reported.
        request.issuedTruncates === truncates &&
        !request.replayed &&
        // Dispose resets the cursor too.
        !isDisposed()
      ) {
        identityViolation ??= `request ${request.index} failed, but its participant did not reject`
      }
    }
    settlingChainMember = false
    // An asynchronous settlement runs its continuation at once unless joined
    // work defers it; a settlement that issues nothing otherwise finished.
    if (chainMember && ok && ledger.length === before && joinedPending) {
      continuationOwed = true
    }
  }
  // An authoritative read starts at a full-source read or a repair prefix;
  // the repair's tie and refill continue the same chain.
  function startsAuthority(request: LedgerRequest) {
    return (
      request.fullSource ||
      (request.authoritative &&
        !request.chainStep &&
        request.options.orderBy !== undefined &&
        request.options.where === undefined &&
        request.options.minValues === undefined)
    )
  }
  const lastAuthoritativeRead = () =>
    ledger.reduce(
      (last, request) =>
        startsAuthority(request) && request.outcome === `ok`
          ? request.index
          : last,
      -1,
    )
  const lastAuthoritativeSuccess = () =>
    Math.max(lastAuthoritativeRead(), replayAuthority)
  // A release callback's own error may replace a request's: cleanup failure
  // is reported through the participant (ARCHITECTURE.md).
  function injectedCleanup(reason: unknown) {
    return reason instanceof Error && reason.message.startsWith(`release `)
  }
  const checkHeld = (checkpoint: string) => {
    if (identityViolation) {
      throw new Error(`error identity ${checkpoint}: ${identityViolation}`)
    }
    if (disposeViolation) {
      throw new Error(`dispose ${checkpoint}: ${disposeViolation}`)
    }
    if (invariantViolation) {
      throw new Error(`invariant ${checkpoint}: ${invariantViolation}`)
    }
    if (releaseViolation) {
      throw new Error(`release ${checkpoint}: ${releaseViolation}`)
    }
    if (concurrencyViolation) {
      throw new Error(
        `one request at a time ${checkpoint}: ${concurrencyViolation}`,
      )
    }
    // The latest successful repair prefix, if no later authoritative read
    // has succeeded, must still be held.
    const repair = [...ledger]
      .reverse()
      .find(
        (request) =>
          startsAuthority(request) &&
          !request.fullSource &&
          request.outcome === `ok`,
      )
    if (
      !repair ||
      repair.index < replayOwnedBefore ||
      lastAuthoritativeSuccess() > repair.index
    )
      return
    // A prefix read issued after the repair covers the repair's rows that are
    // still inside the window when it reaches as far; it may retire the
    // repair's prefix. One issued before the repair proves no current
    // coverage and may not.
    const windowRows = Math.min(
      repair.options.limit ?? 0,
      info.offset + info.limit,
    )
    const coveredByLaterPrefix = ledger.some(
      (request) =>
        request.index > repair.index &&
        (request.outcome === `ok` || request.replayed) &&
        request.options.orderBy !== undefined &&
        request.options.where === undefined &&
        request.options.minValues === undefined &&
        (request.options.limit ?? 0) >= windowRows,
    )
    if (coveredByLaterPrefix) return
    if (repair.released) {
      throw new Error(
        `held ${checkpoint}: request ${repair.index}, a successful repair prefix, was released before a later authoritative read succeeded`,
      )
    }
  }
  const drain = async () => {
    joinedPending = false
    for (let round = 0; round < 40; round++) {
      // A release during the drain can start a truncate of its own.
      if (truncatePending) settleReplay()
      const next = inflight()[0]
      if (next) {
        await settle(next, true)
        continue
      }
      const before = ledger.length
      run(() => loader.loadMore())
      await flush()
      if (
        ledger.length === before &&
        inflight().length === 0 &&
        !truncatePending
      )
        return
    }
    throw new Error(`the loader did not reach a fixed point`)
  }
  const ownFailureSince = (index: number) =>
    ledger.some(
      (request) =>
        request.index > index &&
        request.outcome === `failed` &&
        (request.authoritative || !request.superseded),
    )
  let staleSettlementsAfterRepair = 0
  let supersededFailuresAfterRepair = 0
  let checkedStrandPremises = 0
  let deferredStrandShapes = 0
  // A release that throws is an adapter bug, which the loader reports
  // uncaught from a microtask without changing any result. Each one is
  // reported once, and no other error escapes that way.
  const thrownReleases: Array<Error> = []
  const uncaught = captureMicrotaskErrors()
  if (testCase.retryTimer) {
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
  }
  try {
    run(() => loader.start())
    await flush()
    if (testCase.settledFirst && ledger[0]) await settle(ledger[0], true)
    for (const [step, command] of testCase.history.entries()) {
      // An event outside the quiet set, such as a truncate, a failure, a
      // move, or a disposal, can change or end what a deferred report owes.
      if (owedProof && !quietCommand(command)) owedProof = undefined
      switch (command.type) {
        case `settle`: {
          const open = inflight()
          if (open.length === 0) break
          const request = open[command.pick % open.length]!
          if (
            request.superseded &&
            lastAuthoritativeSuccess() > request.index
          ) {
            if (command.ok) staleSettlementsAfterRepair++
            else supersededFailuresAfterRepair++
          }
          await settle(request, command.ok)
          break
        }
        case `settleNewest`: {
          const request = inflight().at(-1)
          if (request) await settle(request, true)
          break
        }
        case `failOldest`: {
          const request = inflight()[0]
          if (!request) break
          if (
            request.superseded &&
            lastAuthoritativeSuccess() > request.index
          ) {
            supersededFailuresAfterRepair++
          }
          await settle(request, false)
          break
        }
        // An invalidation whose reaction is deferred, as pending joined work
        // or a later graph run defers it, while the oldest in-flight request
        // fails before the loader reacts.
        case `invalidateThenFailOldest`: {
          loader.invalidateSourceOrdering()
          const request = inflight()[0]
          if (!request) break
          if (
            request.superseded &&
            inflight().every((open) => open === request || !open.authoritative)
          ) {
            deferredStrandShapes++
          }
          await settle(request, false)
          break
        }
        case `invalidate`:
          loader.invalidateSourceOrdering()
          if (command.react) graphPass()
          await flush()
          break
        case `report`: {
          // The premises come from the case and the ledger alone.
          const quiet =
            !testCase.releaseFault &&
            !testCase.releaseReenters &&
            !testCase.releaseTruncates &&
            !testCase.releaseDisposes &&
            !boundaryUnexpressible &&
            testCase.history.slice(0, step).every(quietCommand) &&
            ledger.every(({ outcome }) => outcome !== `failed`)
          const windowSize = testCase.offset + info.limit
          const [first, ...later] = ledger
          const beforeSettle = ledger.every(({ outcome }) => outcome !== `ok`)
          // The loader's coverage is its own first page with only tie
          // requests after it.
          const ownFirstPage =
            !testCase.requiresFullSource &&
            !testCase.needsMore &&
            testCase.snapshotRows > windowSize &&
            first !== undefined &&
            first.outcome === `ok` &&
            !first.authoritative &&
            first.options.orderBy !== undefined &&
            first.options.where === undefined &&
            first.options.cursor === undefined &&
            first.options.minValues === undefined &&
            (first.options.limit ?? 0) >= windowSize &&
            later.every(
              ({ options, outcome, authoritative }) =>
                outcome === `ok` &&
                !authoritative &&
                options.where !== undefined &&
                options.cursor === undefined &&
                options.orderBy === undefined,
            )
          // A row past the page proves the source's next row only when the
          // page read it, or when it ties with the page's end and the loader
          // read that tie. Any other installed row can come from another
          // request, so it proves nothing. The installed ranks are 1..n, so
          // the end's rank is the window size.
          const insideFirstPage =
            ownFirstPage &&
            ((first.options.limit ?? 0) > windowSize ||
              later.some(({ options }) => tieValue(options) === windowSize))
          const before = ledger.length
          loader.revalidateLoadedCoverage()
          if (command.react) graphPass()
          await flush()
          // A report the loader cannot prove covers nothing it could change
          // owes a repair, which its next pass starts, or a tie request for
          // the page's end, which completes the proof. Pending joined work
          // defers ordinary loading, so the pass that runs when that work
          // finishes owes the request instead.
          if (
            command.react &&
            quiet &&
            !beforeSettle &&
            ownFirstPage &&
            !insideFirstPage
          ) {
            if (joinedPending && testCase.joined) {
              owedProof = { from: before, windowSize }
            } else {
              expectProofRequest(before, windowSize)
              repairedReportsOnOwnPage++
            }
          }
          if (quiet && (beforeSettle || insideFirstPage)) {
            const issued = ledger
              .slice(before)
              .find(({ authoritative }) => authoritative)
            if (issued) {
              throw new Error(
                `ignored report: request ${issued.index} re-read the source for a report that covers nothing it could change`,
              )
            }
            if (beforeSettle) ignoredReportsBeforeSettle++
            else ignoredReportsInsideFirstPage++
          }
          break
        }
        case `pass`:
          graphPass()
          await flush()
          break
        case `syncInvalidatingPage`:
          invalidateNextPage = true
          graphPass()
          await flush()
          break
        case `move`: {
          const limit = Math.max(1, Math.min(info.limit + command.delta, 3))
          if (limit < info.limit) shrinkingMoves++
          info.limit = limit
          explicitRetrying = true
          run(() => loader.loadMore(++windowOperation))
          explicitRetrying = false
          await flush()
          break
        }
        // The last installed row's order value becomes unexpressible, or
        // expressible again; the source delivers it as an order change.
        case `unexpressibleBoundary`:
          boundaryUnexpressible = !boundaryUnexpressible
          if (boundaryUnexpressible) unexpressibleBoundaries++
          loader.invalidateSourceOrdering()
          graphPass()
          await flush()
          break
        case `joinedBusy`:
          joinedPending = true
          break
        // Joined work finishes; the subscriber runs the deferred pass.
        case `joinedIdle`:
          if (joinedPending && testCase.joined) joinedDeferrals++
          joinedPending = false
          graphPass()
          await flush()
          if (owedProof) {
            expectProofRequest(owedProof.from, owedProof.windowSize)
            owedProof = undefined
            repairedReportsOnOwnPage++
          }
          break
        case `truncate`:
          truncate()
          break
        case `replaySucceeds`:
          if (!replayPending()) break
          settleReplay()
          graphPass()
          await flush()
          break
        case `replayFails`:
          if (replayPending()) {
            replayFailures++
            replayFailedSinceTruncate = true
          }
          break
        // An optimistic overlay hides the window's row, so the loader must
        // refill it from the source.
        case `optimisticDeparture`:
          optimisticDepartures++
          loader.onSourceChanges(
            [{ type: `delete`, key: 1, value: { id: 1, rank: 1 } }],
            sentRows,
            () => true,
          )
          graphPass()
          await flush()
          break
        case `sourceDelete`:
          sourceDeletes++
          loader.onSourceChanges(
            [{ type: `delete`, key: 1, value: { id: 1, rank: 1 } }],
            sentRows,
            () => false,
          )
          if (command.react) graphPass()
          await flush()
          break
        case `startThrows`:
          throwNextStart = true
          break
        // A superseded request fails (the oldest, if none is), and the read
        // the loader starts to recover it throws while it starts.
        case `failOldestThrowingRecovery`: {
          const open = inflight()
          const request = open.find(({ superseded }) => superseded) ?? open[0]
          if (!request) break
          throwNextStart = true
          await settle(request, false)
          throwNextStart = false
          break
        }
        case `dispose`:
          if (!disposed) {
            disposed = true
            disposals++
            loader.dispose()
          }
          break
        // The provider never answers the oldest open request.
        case `hang`: {
          const request = inflight()[0]
          if (request) {
            request.hung = true
            hungRequests++
          }
          break
        }
        case `timer`: {
          if (!testCase.retryTimer) break
          const before = ledger.length
          await vi.advanceTimersByTimeAsync(60_000)
          await flush()
          if (ledger.length > before) timerRetries++
          break
        }
      }
      checkHeld(`after step ${step}`)
    }
    await drain()
    checkHeld(`after the drain`)
    // A disposed loader owes nothing more; the drain above settled what it
    // had issued, and the dispose law has judged those settlements.
    if (!disposed) {
      const lastFull = ledger.reduce(
        (last, request) =>
          request.fullSource && request.outcome === `ok` ? request.index : last,
        -1,
      )
      // Each superseded failure is checked against the full-source reads issued
      // before it. When no own failure happened since the last of those, the
      // failure law does not excuse a block, so a later full-source read must
      // have recovered it.
      for (const failed of ledger.filter(
        (request) =>
          request.outcome === `failed` &&
          request.superseded &&
          request.index >= replayOwnedBefore,
      )) {
        const base = ledger.reduce(
          (last, request) =>
            request.fullSource &&
            request.outcome === `ok` &&
            request.index < failed.index
              ? request.index
              : last,
          -1,
        )
        if (ownFailureSince(base)) continue
        checkedStrandPremises++
        // A recovery read that the provider never answers still started, and a
        // hung repair still owes the full-source read it restarts as.
        const recovered = ledger.some(
          (request) =>
            (request.fullSource &&
              request.index > failed.index &&
              request.outcome === `ok`) ||
            (request.hung && request.authoritative),
        )
        if (!recovered) {
          throw new Error(
            `no strand: superseded request ${failed.index} failed, and no full-source read recovered it without an explicit retry`,
          )
        }
      }
      if (ownFailureSince(lastFull)) {
        // A retry whose release callback throws reports that error; the next
        // explicit retry recovers (the failed-release contract above).
        // A retry whose request throws while it starts is the loader's own
        // failure again, so the next explicit retry recovers it.
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = ledger.length
          startThrewDuringRetry = false
          explicitRetrying = true
          run(() => loader.loadMore(++windowOperation))
          explicitRetrying = false
          await flush()
          if (ledger.length > before && !retryStartThrew()) break
        }
        await drain()
        checkHeld(`after the explicit retry`)
      }
      const authority = lastAuthoritativeSuccess()
      const leaked = ledger.filter(
        (request) =>
          request.outcome === `ok` &&
          !request.released &&
          request.index >= replayOwnedBefore &&
          !replayCoverage.has(request) &&
          request.index < authority,
      )
      // A chain left unfinished by a hung request has not retired anything yet.
      const unfinishedChain = ledger.some(
        (request) =>
          request.hung && request.authoritative && request.index > authority,
      )
      // A release during the retry can dispose the loader; it owes nothing more.
      if (
        !isDisposed() &&
        authority >= 0 &&
        !unfinishedChain &&
        leaked.length > 0
      ) {
        throw new Error(
          `no leak: requests ${JSON.stringify(leaked.map(({ index }) => index))} are still held after authoritative request ${authority} succeeded`,
        )
      }
      // A superseded request's failure owes only a full-source read; once one
      // issued after it succeeds, or a covering replay settles after it, its
      // lease is retired without a retry.
      const heldFailures = ledger.filter(
        (failed) =>
          failed.outcome === `failed` &&
          failed.superseded &&
          !failed.released &&
          // A covering replay that settles after a live failure retires its
          // superseded lease, even one issued before the truncate.
          ((replayAuthority > failed.index &&
            failed.failedTruncates === failed.issuedTruncates &&
            replaySettledAt > failed.failedAt) ||
            (failed.index >= replayOwnedBefore &&
              ledger.some(
                (request) =>
                  request.fullSource &&
                  request.index > failed.index &&
                  request.outcome === `ok`,
              ))),
      )
      if (!isDisposed() && heldFailures.length > 0) {
        throw new Error(
          `no leak: superseded failed requests ${JSON.stringify(heldFailures.map(({ index }) => index))} are still held after a full-source read recovered them`,
        )
      }
      // Progress: once loading is quiet, an invalidation and an ordinary pass
      // issue a read, unless a full-source read covers the source.
      const lastRead = lastAuthoritativeRead()
      const coveredByFullSource =
        replayCoverage.size > 0 ||
        (lastRead >= 0 && ledger[lastRead]!.fullSource)
      // The loader has no request timeout, so a hung authoritative request may
      // hold its work slot. A hung finite request must not block the repair.
      const hungAuthority = ledger.some(
        (request) => request.hung && request.authoritative,
      )
      if (!coveredByFullSource && !hungAuthority && !isDisposed()) {
        const before = ledger.length
        const movesBefore = epochMoves
        loader.invalidateSourceOrdering()
        run(() => loader.loadMore())
        await flush()
        if (ledger.length === before) {
          throw new Error(
            `progress: an invalidation after the drain issued no request`,
          )
        }
        // Cost: a full-source read is very expensive, so a repair avoids one
        // whenever a bounded read is available (ARCHITECTURE.md). That holds
        // after a settled request in this incarnation, for a plan that does
        // not need the full source, with an expressible boundary, unless an
        // unindexed window still needs rows past a repeated prefix (the
        // documented fallback). One repair is then one chain per ordering
        // epoch move: in this fake, a prefix, a tie, and a refill.
        await drain()
        const repair = ledger.slice(before)
        const boundedRepair =
          !testCase.requiresFullSource &&
          !boundaryUnexpressible &&
          (testCase.indexed || !testCase.needsMore) &&
          repair.every(({ outcome }) => outcome === `ok`) &&
          ledger.some(
            (request) =>
              request.outcome === `ok` &&
              !request.fullSource &&
              request.issuedTruncates === truncates,
          )
        if (boundedRepair) {
          costChecks++
          const fullRead = repair.find(({ fullSource }) => fullSource)
          if (fullRead) {
            throw new Error(
              `cost: request ${fullRead.index} read the full source although a bounded repair was available`,
            )
          }
          const authoritative = repair.filter(
            (request) => request.authoritative,
          ).length
          const chains = epochMoves - movesBefore
          if (authoritative > 3 * chains) {
            throw new Error(
              `cost: one invalidation issued ${authoritative} authoritative requests for ${chains} epoch moves`,
            )
          }
        }
      }
    }
    await flush()
    if (
      uncaught.errors.length !== thrownReleases.length ||
      uncaught.errors.some((error, index) => error !== thrownReleases[index])
    ) {
      throw new Error(
        `uncaught release reports: expected each throwing release once, got ${uncaught.errors.map(String).join(`, `)}`,
      )
    }
  } finally {
    loader.dispose()
    for (const request of ledger) request.deferred.resolve()
    await Promise.allSettled(participants)
    if (testCase.retryTimer) vi.useRealTimers()
    uncaught.restore()
  }
  return {
    supersededFailures: ledger.filter(
      (request) => request.superseded && request.outcome === `failed`,
    ).length,
    supersededFailuresAfterRepair,
    checkedStrandPremises,
    staleSettlementsAfterRepair,
    deferredStrandShapes,
    releaseFaults,
    syncRepairs,
    invalidatingPages,
    unexpressibleBoundaries,
    joinedDeferrals,
    ignoredReportsBeforeSettle,
    ignoredReportsInsideFirstPage,
    repairedReportsOnOwnPage,
    truncates,
    replayFailures,
    optimisticDepartures,
    sourceDeletes,
    timerRetries,
    shrinkingMoves,
    reentrantTruncates,
    stackedTruncates,
    truncatesAfterFailedReplay,
    reentrantPasses,
    disposals,
    startThrows,
    startThrowsDuringFailure,
    costChecks,
    hungRequests,
    offsetWindows: testCase.offset > 0 && ledger.length > 0 ? 1 : 0,
  }
}

// The scenario flags of the later dimensions, at their ordinary values.
const ordinaryScenario = {
  requiresFullSource: false,
  joined: false,
  snapshotRows: 1,
  needsMore: true,
  retryTimer: false,
  releaseTruncates: false,
  offset: 0,
  releaseReenters: false,
  releaseDisposes: false,
} as const

const authorityProperty = `ordered-loader.request-authority`
const authorityReplay = readOracleRunConfig()
const authorityCampaigns =
  authorityReplay.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : authorityReplay.replayProperty === authorityProperty
      ? ([`replay`] as const)
      : ([] as const)

describe(`Ordered source request authority`, () => {
  // The model's strand trace: a repair supersedes the in-flight tie and
  // finishes; a newer invalidation's reaction is deferred; the old tie fails.
  it(`recovers a superseded tie that fails after its repair finished (generated-lane replay)`, async () => {
    await checkAuthorityCase({
      indexed: true,
      limit: 1,
      settledFirst: false,
      releaseFault: false,
      syncRepair: false,
      ...ordinaryScenario,
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `invalidate`, react: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `invalidate`, react: false },
        { type: `settle`, pick: 0, ok: false },
      ],
    })
  })

  // Traces the generated lane found, kept as replays. Each ran through the
  // same laws and failed before its repair:
  // - a release callback throws while a repair finishes, a superseded tie
  //   fails, and an explicit window move resumes the repair (a throwing
  //   release unwound the chain mid-step, so nothing resumed it);
  // - a repair answers at once while an older tie is still in flight (the
  //   repair waited behind the superseded request, so nothing resumed it);
  // - a page's own delivery invalidates ordering (it counted as current, so
  //   its tie ran in the new epoch and was never retired);
  // - a repair prefix still in flight when a truncate replay finishes its
  //   chain and a newer invalidation starts the replacement (it took the
  //   replacement's chain tag when it settled, so nothing retired it);
  // - a replay after an explicit retry whose release throws (the replay
  //   counted the released full-source read as complete coverage, so later
  //   invalidations issued nothing);
  // - a repair tie from before a truncate that fails during the next repair
  //   (the dead failure dropped the new chain's staged step, so nothing
  //   resumed it);
  // - the same replay trace, once one request at a time was checked (the
  //   replaced chain's prefix counted as current and issued a tie beside the
  //   replacement's prefix).
  // - a repair prefix that settles after full-source coverage completed (a
  //   chain request skipped the full-coverage retirement, so it stayed held).
  // - a full-source transport that fails after a replay covered the source
  //   (complete coverage became an own failure, so a window move released
  //   the covering lease and read the source again);
  // - a repair prefix that fails after a replay finished its chain (the
  //   failure counted as the loader's own; the transition table rejected it);
  // - a backoff retry whose first release starts a truncate (the release pass
  //   kept going and released the failed demand the replay owned).
  // - a release that runs the graph during another request's settlement (the
  //   pass issued a page, and the settling request then issued its tie);
  // - a superseded failure before a truncate whose replay covers the source
  //   (only a full-source read retired superseded failed leases, so the
  //   replay left one held until a window move that an Effect never makes);
  // - a superseded failure whose recovery read throws while it starts (the
  //   start error replaced the request's own error in its participant);
  // A superseded page that fails before a covering replay settles reaches
  // the failed-lease law through a replay, which the campaigns rarely do.
  // Two replays keep traces that first failed the lane's own model: a chain
  // step it took for a chain start (an optimistic refill, and a shrunk
  // window's prefix deferred by joined work).
  it.each([
    {
      name: `a throwing release during a window move that resumes a repair`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: true,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `invalidate`, react: true },
          { type: `invalidateThenFailOldest` },
          { type: `move`, delta: 0 },
          { type: `settleNewest` },
        ],
      },
    },
    {
      name: `a repair that answers at once behind an older tie`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `invalidate`, react: true },
          { type: `invalidate`, react: true },
          { type: `invalidate`, react: false },
        ],
      },
    },
    {
      name: `a repair prefix that settles after a replay started its replacement`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `truncate` },
          { type: `invalidate`, react: false },
          { type: `move`, delta: -1 },
          { type: `invalidate`, react: false },
        ],
      },
    },
    {
      name: `an optimistic refill inside a running repair chain`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `invalidate`, react: true },
          { type: `settle`, pick: 0, ok: true },
          { type: `optimisticDeparture` },
        ],
      },
    },
    {
      name: `a replay after an explicit retry whose release throws`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: true,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `settle`, pick: 0, ok: false },
          { type: `move`, delta: -1 },
          { type: `truncate` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a shrunk window's prefix deferred by joined work inside a repair`,
      testCase: {
        indexed: false,
        limit: 2,
        settledFirst: true,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        joined: true,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
          { type: `joinedBusy` },
          { type: `move`, delta: -1 },
          { type: `settle`, pick: 0, ok: true },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a repair tie from before a truncate that fails during the next repair`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `syncInvalidatingPage` },
          { type: `move`, delta: -1 },
          { type: `invalidate`, react: true },
          { type: `truncate` },
          { type: `replaySucceeds` },
          { type: `settle`, pick: 0, ok: true },
          { type: `syncInvalidatingPage` },
          { type: `invalidateThenFailOldest` },
        ],
      },
    },
    {
      name: `a superseded page that fails before a covering replay settles`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `truncate` },
          { type: `move`, delta: 0 },
          { type: `invalidate`, react: false },
          { type: `move`, delta: 0 },
          { type: `settle`, pick: 1, ok: false },
          { type: `settleNewest` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a repair prefix that settles after full-source coverage`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `truncate` },
          { type: `sourceDelete`, react: false },
          { type: `move`, delta: -1 },
          { type: `failOldest` },
          { type: `replaySucceeds` },
          { type: `settleNewest` },
        ],
      },
    },
    {
      name: `a backoff retry whose first release starts a truncate`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        retryTimer: true,
        releaseTruncates: true,
        history: [
          { type: `settleNewest` },
          { type: `report`, react: false },
          { type: `joinedIdle` },
          { type: `failOldest` },
          { type: `invalidateThenFailOldest` },
          { type: `timer` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a full-source transport that fails after a replay covered the source`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `truncate` },
          { type: `move`, delta: 0 },
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `replaySucceeds` },
          { type: `settle`, pick: 1, ok: false },
        ],
      },
    },
    {
      name: `a repair prefix that fails after a replay finished its chain`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `report`, react: false },
          { type: `settleNewest` },
          { type: `truncate` },
          { type: `move`, delta: -1 },
          { type: `replaySucceeds` },
          { type: `failOldest` },
        ],
      },
    },
    {
      name: `a release that runs the graph during another request's settlement`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        releaseReenters: true,
        history: [
          { type: `truncate` },
          { type: `replaySucceeds` },
          { type: `optimisticDeparture` },
          { type: `joinedBusy` },
        ],
      },
    },
    {
      name: `a superseded failure before a truncate whose replay covers the source`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        releaseTruncates: true,
        releaseReenters: true,
        history: [
          { type: `invalidate`, react: true },
          { type: `failOldest` },
          { type: `replayFails` },
        ],
      },
    },
    {
      name: `a superseded failure whose recovery read throws while it starts`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `report`, react: true },
          { type: `settleNewest` },
          { type: `settle`, pick: 7, ok: true },
          { type: `failOldestThrowingRecovery` },
          { type: `pass` },
        ],
      },
    },
    {
      name: `a page whose own delivery invalidates ordering`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `syncInvalidatingPage` },
          { type: `settleNewest` },
          { type: `pass` },
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `settle`, pick: 3, ok: true },
        ],
      },
    },
    {
      // A truncate after a deferred unproven report hands the window to its
      // replay, so the pass after the joined work owes no repair or tie.
      name: `an unproven report whose deferred pass a truncate replaces`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        joined: true,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `joinedBusy` },
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
          { type: `truncate` },
          { type: `joinedIdle` },
        ],
      },
    },
    {
      // Pending joined work defers the pass after an unproven report, so the
      // repair or tie that the report owes waits for that work. The pass that
      // runs when it finishes must start it. A random campaign found the law
      // judging the deferred pass instead.
      name: `an unproven report while joined work defers loading`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        joined: true,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `joinedBusy` },
          { type: `settle`, pick: 0, ok: true },
          { type: `settleNewest` },
          { type: `report`, react: true },
          { type: `joinedIdle` },
        ],
      },
    },
    {
      // The first page read only the window, and the loader's tie request
      // read a value past it, not the page's end. An installed row past the
      // page can come from another request, so it proves nothing, and the
      // report must repair. Ignoring it kept a window that missed a row tied
      // with a refetched page's end.
      name: `a report over a first page that read only the window`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
        ],
      },
    },
    {
      // Without the settled check, a report before the first page settled
      // forced a full-source read.
      name: `a report before any request settles`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [{ type: `report`, react: true }],
      },
    },
  ] satisfies Array<{ name: string; testCase: AuthorityCase }>)(
    `keeps request authority for $name (generated-lane replay)`,
    async ({ testCase }) => {
      await checkAuthorityCase(testCase)
    },
  )

  it.each(authorityCampaigns)(
    `holds, retires, and recovers requests under generated settlement orders (%s campaign)`,
    async (campaign) => {
      let supersededFailures = 0
      let staleSettlementsAfterRepair = 0
      let supersededFailuresAfterRepair = 0
      let checkedStrandPremises = 0
      let deferredShapes = 0
      let releaseFaults = 0
      let syncRepairs = 0
      let invalidatingPages = 0
      const later = {
        unexpressibleBoundaries: 0,
        joinedDeferrals: 0,
        ignoredReportsBeforeSettle: 0,
        ignoredReportsInsideFirstPage: 0,
        repairedReportsOnOwnPage: 0,
        truncates: 0,
        replayFailures: 0,
        optimisticDepartures: 0,
        sourceDeletes: 0,
        timerRetries: 0,
        shrinkingMoves: 0,
        reentrantTruncates: 0,
        stackedTruncates: 0,
        truncatesAfterFailedReplay: 0,
        reentrantPasses: 0,
        disposals: 0,
        startThrows: 0,
        startThrowsDuringFailure: 0,
        costChecks: 0,
        hungRequests: 0,
        offsetWindows: 0,
      }
      await fc.assert(
        fc.asyncProperty(authorityCaseArbitrary, async (testCase) => {
          const observation = await checkAuthorityCase(testCase)
          supersededFailures += observation.supersededFailures
          staleSettlementsAfterRepair += observation.staleSettlementsAfterRepair
          supersededFailuresAfterRepair +=
            observation.supersededFailuresAfterRepair
          checkedStrandPremises += observation.checkedStrandPremises
          deferredShapes += observation.deferredStrandShapes
          releaseFaults += observation.releaseFaults
          syncRepairs += observation.syncRepairs
          invalidatingPages += observation.invalidatingPages
          for (const key of Object.keys(later) as Array<keyof typeof later>) {
            later[key] += observation[key]
          }
        }),
        campaign === `fixed`
          ? { seed: 20261016, numRuns: oracleRuns(10000) }
          : {
              ...oraclePropertyOptions(10000, authorityProperty),
              ...(campaign === `replay` ? { numRuns: 1 } : {}),
            },
      )
      // Reach witnesses: superseded requests fail, stale requests settle
      // after a repair succeeded, the strand law is checkable, a superseded
      // request fails after its repair finished while a newer invalidation's
      // reaction is deferred, a release throws, a repair answers at once,
      // and a page's own delivery invalidates ordering. Each later dimension
      // also changes loader input at least once: an unexpressible boundary,
      // deferred joined work, a truncate and a failed replay, an optimistic
      // departure, a source delete, a backoff retry that issues a read, and
      // a window that shrinks.
      if (campaign !== `replay`) {
        expect(supersededFailures).toBeGreaterThan(0)
        expect(staleSettlementsAfterRepair).toBeGreaterThan(0)
        expect(supersededFailuresAfterRepair).toBeGreaterThan(0)
        expect(checkedStrandPremises).toBeGreaterThan(0)
        expect(deferredShapes).toBeGreaterThan(0)
        expect(releaseFaults).toBeGreaterThan(0)
        expect(syncRepairs).toBeGreaterThan(0)
        expect(invalidatingPages).toBeGreaterThan(0)
        // A recovery start that throws while the loader handles a superseded
        // failure, and a report inside the loader's first page, are too rare
        // to require of every campaign; named replays reach them.
        for (const [dimension, count] of Object.entries(later)) {
          if (
            dimension === `startThrowsDuringFailure` ||
            dimension === `ignoredReportsInsideFirstPage` ||
            dimension === `repairedReportsOnOwnPage`
          )
            continue
          expect(count, dimension).toBeGreaterThan(0)
        }
      }
    },
    120_000,
  )
})
