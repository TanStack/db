import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { OrderedSourceLoader } from '../../src/query/live/utils.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
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
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    acquisition: LoadSubsetOptions,
    release?: ReleaseLoadSubset,
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

describe(`OrderedSourceLoader`, () => {
  it(`recovers authoritatively when reading a settled boundary fails`, async () => {
    const failure = new Error(`boundary read failed`)
    const requests: Array<{ method: string; options: RequestOptions }> = []
    const released: Array<LoadSubsetOptions> = []
    const request = (method: string, options: RequestOptions) => {
      requests.push({ method, options })
      options.onLoadSubsetResult?.(Promise.resolve(), options, () =>
        released.push(options),
      )
    }
    const subscription = {
      setOrderByIndex: () => {},
      readOrderedSnapshot: () => {
        throw failure
      },
      requestLimitedSnapshot: (options: RequestOptions) =>
        request(`limited`, options),
      requestSnapshot: (options: RequestOptions) =>
        request(`snapshot`, options),
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo(),
      subscription,
      `row`,
    )
    loader.start()
    await expect(loader.pendingPromise).rejects.toBe(failure)
    loader.loadMore()
    expect(requests).toHaveLength(1)
    await loader.loadMore(1)
    expect(released).toEqual([requests[0]!.options])
    expect(requests.map(({ method }) => method)).toEqual([
      `limited`,
      `snapshot`,
    ])
    expect(requests[1]!.options.limit).toBeUndefined()
    loader.dispose()
  })

  const asyncRouteCells = (
    [`page`, `prefix`, `boundary`, `full-source`] as const
  ).flatMap((route) =>
    (
      [
        `resolve`,
        `reject`,
        `abort`,
        `dispose-resolve`,
        `dispose-reject`,
      ] as const
    ).map((outcome) => ({ route, outcome })),
  )

  it.each(asyncRouteCells)(
    `keeps the $route acquisition lifecycle exact for $outcome`,
    async ({ route, outcome }) => {
      type ObservedRequest = {
        method: `limited` | `snapshot`
        options: RequestOptions
        acquisition: LoadSubsetOptions
        controller: AbortController
        deferred: ReturnType<typeof createDeferred>
      }
      const requests: Array<ObservedRequest> = []
      const releases: Array<LoadSubsetOptions> = []
      const request = (
        method: ObservedRequest[`method`],
        options: RequestOptions,
      ) => {
        const controller = new AbortController()
        const acquisition: LoadSubsetOptions = {
          signal: controller.signal,
          orderBy: options.orderBy,
          limit: options.limit,
        }
        const deferred = createDeferred()
        requests.push({ method, options, acquisition, controller, deferred })
        options.onLoadSubsetResult?.(deferred.promise, acquisition, () =>
          releases.push(acquisition),
        )
      }
      const subscription = {
        readOrderedSnapshot: () =>
          route === `boundary` ? [{ value: { rank: 1 } }] : [],
        setOrderByIndex: () => {},
        requestLimitedSnapshot: (options: RequestOptions) =>
          request(`limited`, options),
        requestSnapshot: (options: RequestOptions) =>
          request(`snapshot`, options),
      } as unknown as CollectionSubscription
      const info = createOrderByInfo(
        route === `prefix`
          ? { index: undefined }
          : route === `full-source`
            ? { requiresFullSource: true }
            : {},
      )
      const loader = new OrderedSourceLoader(info, subscription, `row`)

      loader.start()
      if (route === `boundary`) {
        expect(requests.map(({ method }) => method)).toEqual([`limited`])
        requests[0]!.deferred.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(requests.map(({ method }) => method)).toEqual([
          `limited`,
          `snapshot`,
        ])
      }
      const target = requests.at(-1)!
      const targetSettlement = loader.pendingPromise!
      const failure =
        outcome === `abort`
          ? new DOMException(`${route} canceled`, `AbortError`)
          : new Error(`${route} rejected`)

      if (outcome === `dispose-resolve` || outcome === `dispose-reject`) {
        loader.dispose()
        if (outcome === `dispose-resolve`) target.deferred.resolve()
        else target.deferred.reject(failure)
        await targetSettlement
        expect(requests.at(-1)).toBe(target)
        expect(releases).toEqual([])
        return
      }

      if (outcome === `resolve`) {
        target.deferred.resolve()
        await targetSettlement
        expect(target.controller.signal.aborted).toBe(false)
        expect(releases).toEqual([])
      } else {
        if (outcome === `abort`) target.controller.abort()
        target.deferred.reject(failure)
        await expect(targetSettlement).rejects.toBe(failure)
        expect(target.controller.signal.aborted).toBe(outcome === `abort`)

        const requestCount = requests.length
        expect(loader.loadMore()).toBeUndefined()
        expect(requests).toHaveLength(requestCount)

        loader.loadMore(1)
        expect(releases).toEqual([target.acquisition])
        expect(requests).toHaveLength(requestCount + 1)
        const retry = requests.at(-1)!
        expect(retry.method).toBe(`snapshot`)
        retry.deferred.resolve()
        await loader.pendingPromise
        expect(releases).toEqual([target.acquisition])
      }

      loader.dispose()
    },
  )

  it(`retains only bounded promise state during a long refinement chain`, async () => {
    let biggest: { rank: number } | undefined
    const requests: Array<ReturnType<typeof createDeferred>> = []
    const tracked: Array<{ settled: boolean }> = []
    const request = (options: RequestOptions) => {
      const next = createDeferred()
      requests.push(next)
      options.onLoadSubsetResult?.(next.promise, {
        orderBy: options.orderBy,
        limit: options.limit,
      })
    }
    const subscription = {
      readOrderedSnapshot: () => (biggest ? [{ value: biggest }] : []),
      setOrderByIndex: () => {},
      requestLimitedSnapshot: request,
      requestSnapshot: request,
    } as unknown as CollectionSubscription
    const info = createOrderByInfo()
    const loader = new OrderedSourceLoader(
      info,
      subscription,
      `row`,
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
      const loader = new OrderedSourceLoader(info, subscription, `row`)

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
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let failedReleaseAttempts = 0
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
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[1] && ++failedReleaseAttempts === 1) {
                throw cleanupFailure
              }
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
    )

    try {
      subscription.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`unrelated`)]),
        optimizedOnly: false,
      })
      expect(() => loader.start()).toThrow(requestFailure)
      expect(subscription.lastError).toBe(requestFailure)
      expect(reported).toEqual([requestFailure])
      expect(unloads).toEqual([loads[1]])

      loader.dispose()
      subscription.unsubscribe()
      expect(unloads).toEqual([loads[1], loads[1], loads[0]])
      expect(subscription.lastError).toBe(requestFailure)
      expect(reported).toEqual([requestFailure])

      subscription.unsubscribe()
      expect(unloads).toEqual([loads[1], loads[1], loads[0]])
    } finally {
      loader.dispose()
      subscription.unsubscribe()
      await source.cleanup()
    }
  })

  it.each([
    [`string`, `snapshot publication failed`],
    [`undefined`, undefined],
  ] as const)(
    `normalizes a %s provisional failure once for every observer`,
    async (_label, thrownValue) => {
      const cleanupFailure = new Error(`provisional cleanup failed`)
      const reported: Array<unknown> = []
      let unloads = 0
      const source = createCollection<{ id: number; rank: number }>({
        id: `ordered-provisional-non-error-${String(thrownValue)}`,
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
          if (changes.length > 0) throw thrownValue
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => reported.push(error))
      const loader = new OrderedSourceLoader(
        createOrderByInfo({ index: undefined }),
        subscription,
        `row`,
      )
      const notCaught = Symbol(`not caught`)
      let caught: unknown = notCaught

      try {
        loader.start()
      } catch (error) {
        caught = error
      }

      expect(caught).not.toBe(notCaught)
      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toBe(String(thrownValue))
      expect(subscription.lastError).toBe(caught)
      expect(reported).toEqual([caught])

      loader.dispose()
      subscription.unsubscribe()
      await source.cleanup()
    },
  )

  it(`retires an acquisition when its internal result observer throws`, async () => {
    const observerFailure = new Error(`ordered result observer failed`)
    const acquisition: LoadSubsetOptions = {}
    const methods: Array<string> = []
    const releases: Array<LoadSubsetOptions> = []
    let failObserver = true
    const subscription = {
      setOrderByIndex: () => {},
      releaseLoadSubset: (options: LoadSubsetOptions) => {
        releases.push(options)
        loader.loadMore(1)
      },
      requestSnapshot: (options: RequestOptions) => {
        methods.push(`snapshot`)
        options.onLoadSubsetResult?.(true, acquisition)
      },
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ index: undefined }),
      subscription,
      `row`,
      () => {
        if (!failObserver) return
        failObserver = false
        throw observerFailure
      },
    )

    expect(() => loader.start()).toThrow(observerFailure)
    await Promise.resolve()
    await Promise.resolve()
    expect(releases).toEqual([acquisition])
    expect(methods).toEqual([`snapshot`])

    expect(loader.loadMore()).toBeUndefined()
    expect(methods).toEqual([`snapshot`])

    loader.loadMore(1)
    expect(methods).toEqual([`snapshot`, `snapshot`])
    loader.dispose()
  })

  it(`does not replace a failed acquisition while its release is running`, async () => {
    const requestFailure = new Error(`ordered acquisition rejected`)
    const releaseFailure = new Error(`ordered acquisition release failed`)
    const acquisition: LoadSubsetOptions = {}
    const methods: Array<string> = []
    let firstRequest = true
    const subscription = {
      setOrderByIndex: () => {},
      releaseLoadSubset: () => {
        loader.loadMore(2)
        throw releaseFailure
      },
      requestSnapshot: (options: RequestOptions) => {
        methods.push(`snapshot`)
        if (!firstRequest) return
        firstRequest = false
        options.onLoadSubsetResult?.(
          Promise.reject(requestFailure),
          acquisition,
        )
      },
    } as unknown as CollectionSubscription
    const loader = new OrderedSourceLoader(
      createOrderByInfo({ index: undefined }),
      subscription,
      `row`,
    )

    loader.start()
    await expect(loader.pendingPromise).rejects.toBe(requestFailure)
    expect(() => loader.loadMore(1)).toThrow(releaseFailure)
    expect(methods).toEqual([`snapshot`])

    loader.loadMore(3)
    expect(methods).toEqual([`snapshot`, `snapshot`])
    loader.dispose()
  })

  it(`blocks a reentrant boundary retry until a later operation`, async () => {
    const failure = new Error(`boundary request failed`)
    const methods: Array<string> = []
    let failBoundary = true
    const subscription = {
      readOrderedSnapshot: () => [{ value: { rank: 1 } }],
      setOrderByIndex: () => {},
      releaseLoadSubset: () => {},
      requestLimitedSnapshot: (options: RequestOptions) => {
        methods.push(`limited`)
        options.onLoadSubsetResult?.(true, {
          orderBy: options.orderBy,
          limit: options.limit,
        })
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
