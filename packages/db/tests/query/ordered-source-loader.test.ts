import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { OrderedSourceLoader } from '../../src/query/live/utils.js'
import { PropRef } from '../../src/query/ir.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../src/types.js'

type RequestOptions = {
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    acquisition: LoadSubsetOptions,
  ) => void
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

describe(`OrderedSourceLoader`, () => {
  it(`retains only bounded promise state during a long refinement chain`, async () => {
    let biggest: { rank: number } | undefined
    const requests: Array<ReturnType<typeof createDeferred>> = []
    const tracked: Array<{ settled: boolean }> = []
    const request = (options: RequestOptions) => {
      const next = createDeferred()
      requests.push(next)
      options.onLoadSubsetResult?.(next.promise, {})
    }
    const subscription = {
      setOrderByIndex: () => {},
      requestLimitedSnapshot: request,
      requestSnapshot: request,
    } as unknown as CollectionSubscription
    const info = createOrderByInfo()
    const loader = new OrderedSourceLoader(
      info,
      subscription,
      `row`,
      () => biggest,
      (promise) => {
        if (!(promise instanceof Promise)) return
        const participant = { settled: false }
        tracked.push(participant)
        void promise.then(
          () => {
            participant.settled = true
          },
          () => {
            participant.settled = true
          },
        )
      },
    )

    loader.start()
    for (let step = 0; step < 20; step++) {
      expect(requests[step]).toBeDefined()
      if (step % 2 === 0) biggest = { rank: step / 2 }
      requests[step]!.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }

    // One request is active and its predecessor may still be settling during
    // the handoff. Earlier ancestors must already be collectible.
    expect(
      tracked.filter(({ settled }) => !settled).length,
    ).toBeLessThanOrEqual(2)
    loader.dispose()
  })

  it.each([
    {
      name: `page`,
      info: createOrderByInfo(),
      expectedMethod: `limited`,
    },
    {
      name: `prefix`,
      info: createOrderByInfo({ index: undefined }),
      expectedMethod: `snapshot`,
    },
    {
      name: `full source`,
      info: createOrderByInfo({ requiresFullSource: true }),
      expectedMethod: `snapshot`,
    },
  ])(
    `keeps a callback-before-throw $name request failed until a later operation`,
    async ({ info, expectedMethod }) => {
      const failure = new Error(`${expectedMethod} request failed`)
      const methods: Array<string> = []
      let fail = true
      const request = (
        method: string,
        options: {
          onLoadSubsetResult?: (
            result: true,
            acquisition: LoadSubsetOptions,
          ) => void
        },
      ) => {
        methods.push(method)
        if (!fail) return
        fail = false
        options.onLoadSubsetResult?.(true, {})
        loader.loadMore()
        throw failure
      }
      const subscription = {
        setOrderByIndex: () => {},
        releaseLoadSubset: () => {},
        requestLimitedSnapshot: (options: RequestOptions) =>
          request(`limited`, options),
        requestSnapshot: (options: RequestOptions) =>
          request(`snapshot`, options),
      } as unknown as CollectionSubscription
      const loader = new OrderedSourceLoader(
        info,
        subscription,
        `row`,
        () => undefined,
      )

      expect(() => loader.start()).toThrow(failure)
      await Promise.resolve()
      await Promise.resolve()
      expect(methods).toEqual([expectedMethod])
      expect(loader.loadMore()).toBeUndefined()
      expect(methods).toEqual([expectedMethod])

      loader.loadMore(1)
      expect(methods).toEqual([expectedMethod, `snapshot`])
      loader.dispose()
    },
  )

  it(`blocks retry reentered from provisional acquisition cleanup`, () => {
    const failure = new Error(`prefix request failed`)
    const methods: Array<string> = []
    let fail = true
    const subscription = {
      setOrderByIndex: () => {},
      releaseLoadSubset: () => {
        loader.loadMore(1)
      },
      requestSnapshot: (options: RequestOptions) => {
        methods.push(`snapshot`)
        if (!fail) return
        fail = false
        options.onLoadSubsetResult?.(true, {})
        throw failure
      },
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ index: undefined }),
      subscription,
      `row`,
      () => undefined,
    )

    expect(() => loader.start()).toThrow(failure)
    expect(methods).toEqual([`snapshot`])

    loader.loadMore(2)
    expect(methods).toEqual([`snapshot`, `snapshot`])
    loader.dispose()
  })

  it(`preserves the request failure when provisional cleanup also throws`, async () => {
    const requestFailure = new Error(`snapshot publication failed`)
    const cleanupFailure = new Error(`provisional cleanup failed`)
    const reported: Array<unknown> = []
    let unloads = 0
    const source = createCollection<{ id: number; rank: number }>({
      id: `ordered-provisional-cleanup-error`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          commit()
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw cleanupFailure
            },
          }
        },
      },
    })
    const subscription = source.subscribeChanges(
      (changes) => {
        if (changes.length > 0) throw requestFailure
      },
      { includeInitialState: false },
    )
    subscription.on(`loadSubset:error`, ({ error }) => reported.push(error))
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ index: undefined }),
      subscription,
      `row`,
      () => undefined,
    )

    try {
      expect(() => loader.start()).toThrow(requestFailure)
      expect(subscription.lastError).toBe(requestFailure)
      expect(reported).toEqual([requestFailure])
      expect(unloads).toBe(1)
    } finally {
      loader.dispose()
      subscription.unsubscribe()
      await source.cleanup()
    }
  })

  it(`blocks a reentrant boundary retry until a later operation`, async () => {
    const failure = new Error(`boundary request failed`)
    const methods: Array<string> = []
    let failBoundary = true
    const subscription = {
      setOrderByIndex: () => {},
      releaseLoadSubset: () => {},
      requestLimitedSnapshot: (options: {
        onLoadSubsetResult?: (result: true) => void
      }) => {
        methods.push(`limited`)
        options.onLoadSubsetResult?.(true, {})
      },
      requestSnapshot: (options: {
        onLoadSubsetResult?: (
          result: true,
          acquisition: LoadSubsetOptions,
        ) => void
      }) => {
        methods.push(`snapshot`)
        if (!failBoundary) return
        failBoundary = false
        options.onLoadSubsetResult?.(true, {})
        loader.loadMore()
        throw failure
      },
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo(),
      subscription,
      `row`,
      () => ({ rank: 1 }),
    )

    loader.start()
    const initial = loader.pendingPromise
    await expect(initial).rejects.toBe(failure)
    expect(methods).toEqual([`limited`, `snapshot`])
    expect(loader.loadMore()).toBeUndefined()
    expect(methods).toEqual([`limited`, `snapshot`])

    loader.loadMore(1)
    expect(methods).toEqual([`limited`, `snapshot`, `snapshot`])
    loader.dispose()
  })
})
