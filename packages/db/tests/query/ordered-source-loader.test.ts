import { describe, expect, it } from 'vitest'
import { OrderedSourceLoader } from '../../src/query/live/utils.js'
import { PropRef } from '../../src/query/ir.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'

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
    const request = (options: {
      onLoadSubsetResult?: (result: Promise<void>) => void
    }) => {
      const next = createDeferred()
      requests.push(next)
      options.onLoadSubsetResult?.(next.promise)
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
    `blocks reentrant $name retries until a later operation`,
    ({ info, expectedMethod }) => {
      const failure = new Error(`${expectedMethod} request failed`)
      const methods: Array<string> = []
      let fail = true
      const request = (method: string) => {
        methods.push(method)
        if (!fail) return
        fail = false
        loader.loadMore()
        throw failure
      }
      const subscription = {
        setOrderByIndex: () => {},
        requestLimitedSnapshot: () => request(`limited`),
        requestSnapshot: () => request(`snapshot`),
      } as unknown as CollectionSubscription
      const loader = new OrderedSourceLoader(
        info,
        subscription,
        `row`,
        () => undefined,
      )

      expect(() => loader.start()).toThrow(failure)
      expect(methods).toEqual([expectedMethod])
      expect(loader.loadMore()).toBeUndefined()
      expect(methods).toEqual([expectedMethod])

      loader.loadMore(1)
      expect(methods).toEqual([expectedMethod, expectedMethod])
      loader.dispose()
    },
  )

  it(`blocks a reentrant boundary retry until a later operation`, async () => {
    const failure = new Error(`boundary request failed`)
    const methods: Array<string> = []
    const subscription = {
      setOrderByIndex: () => {},
      requestLimitedSnapshot: (options: {
        onLoadSubsetResult?: (result: true) => void
      }) => {
        methods.push(`limited`)
        options.onLoadSubsetResult?.(true)
      },
      requestSnapshot: () => {
        methods.push(`snapshot`)
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
    expect(methods).toEqual([`limited`, `snapshot`, `limited`])
    loader.dispose()
  })
})
