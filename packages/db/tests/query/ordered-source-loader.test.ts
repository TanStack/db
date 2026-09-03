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
    const info: OrderByOptimizationInfo = {
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
    }
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
})
