import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { PropRef } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
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
) {
  const request = (method: Observed[`method`], options: RequestOptions) => {
    const acquisition: LoadSubsetOptions = {
      orderBy: options.orderBy,
      limit: options.limit,
      where: options.where,
    }
    const deferred = createDeferred()
    requests.push({ method, options, acquisition, deferred })
    options.onLoadSubsetResult?.(deferred.promise, acquisition, () =>
      releases.push(acquisition),
    )
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
  it(`keeps a failed public window private when its older tie request finishes`, async () => {
    type Row = { id: number; rank: number }
    const truth: Array<Row> = [1, 2, 3].map((id) => ({ id, rank: id }))
    const requests: Array<{
      kind: `page` | `boundary` | `full`
      options: LoadSubsetOptions
      gate: ReturnType<typeof createDeferred>
    }> = []
    const releases: Array<LoadSubsetOptions> = []
    let hold = false
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
              if (!hold || kind === `page`) gate.resolve()
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
    const visibleRows = () => live.toArray.map(({ id, rank }) => ({ id, rank }))
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
      truth[0] = { id: 1, rank: 10 }
      update(truth[0])
      await flushPromises()
      const full = requests.at(-1)!
      expect(full.kind).toBe(`full`)
      const count = requests.length
      const failure = new Error(`authoritative repair failed`)
      full.gate.reject(failure)
      // The window still waits for its older publication participant to settle.
      await flushPromises()
      boundary.gate.resolve()
      await flushPromises()
      expect(requests).toHaveLength(count)
      expect(await move).toEqual({ status: `rejected`, error: failure })
      expect(releases).toEqual([])
      expect(publications).toEqual([])
      expect(visibleRows()).toEqual([{ id: 1, rank: 1 }])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })

      hold = false
      await live.utils.setWindow({ limit: 2 })
      expect(requests).toHaveLength(count + 1)
      expect(releases).toEqual([full.options])
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
  })

  // Finite success is not authority to repair a newer full-source failure.
  // Cross request kind with settlement order instead of testing each alone.
  it.each(
    ([`page`, `boundary`] as const).flatMap((olderKind) =>
      ([`older-first`, `full-first`] as const).flatMap((order) =>
        ([`success`, `failure`] as const).map((outcome) => ({
          olderKind,
          order,
          outcome,
        })),
      ),
    ),
  )(
    `keeps full-source recovery authoritative across overlap: %j`,
    async ({ olderKind, order, outcome }) => {
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
        if (olderKind === `boundary`) {
          requests[0]!.deferred.resolve()
          await participants[0]
          expect(requests).toHaveLength(2)
          expect(requests[1]!.options.where).toBeDefined()
        }
        const olderIndex = requests.length - 1
        loader.invalidateSourceOrdering()
        loader.loadMore()
        const fullIndex = olderIndex + 1
        const count = fullIndex + 1
        expect(requests).toHaveLength(count)
        expect(requests[fullIndex]!.options.orderBy).toBeUndefined()
        expect(requests[fullIndex]!.options.where).toBeUndefined()
        const failure = new Error(`full-source failed`)
        const settleOlder = async () => {
          requests[olderIndex]!.deferred.resolve()
          await participants[olderIndex]
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
        expect(releases).toEqual([])

        loader.loadMore(1)
        if (outcome === `failure`) {
          expect(requests).toHaveLength(count + 1)
          expect(releases).toEqual([requests[fullIndex]!.acquisition])
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
      // The explicit retry released exactly the failed page acquisition.
      expect(unloads).toEqual([requests[initialRequests]!.options])

      await flushPromises()
      expect(requests).toHaveLength(initialRequests + 2)
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  })
})
