// Law: an explicit window that consumes a staged boundary continuation issues
// only the immediate work that its boundary and remaining demand require. The
// model `expectedStagedWindowTrace` states that trace for each cell of the
// boundary-by-demand grammar `stagedWindowCases`. The remaining scenarios in
// this area are fixed histories, owned by ordered-source-loader.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  createDeferred,
  createOrderByInfo,
} from './ordered-source-loader-support.js'
import type { RequestOptions } from './ordered-source-loader-support.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'

const stagedWindowAxes = {
  boundary: [`absent`, `present`] as const,
  demand: [`satisfied`, `widened`] as const,
}
const stagedWindowCases = stagedWindowAxes.boundary.flatMap((boundary) =>
  stagedWindowAxes.demand.map((demand) => ({ boundary, demand })),
)

/**
 * Independent immediate-work model for an explicit window that consumes a
 * staged boundary continuation. A present boundary requires its tie
 * acquisition. An absent boundary starts no work, so only remaining window
 * demand can require a prefix acquisition.
 */
const expectedStagedWindowTrace = (
  boundary: (typeof stagedWindowAxes.boundary)[number],
  demand: (typeof stagedWindowAxes.demand)[number],
): Array<`page` | `boundary`> => [
  `page`,
  ...(boundary === `present` ? ([`boundary`] as const) : []),
  ...(demand === `widened` ? ([`page`] as const) : []),
]

declareOracle({
  model: [expectedStagedWindowTrace],
  grammar: [stagedWindowCases],
})

describe(`OrderedSourceLoader`, () => {
  it(`enumerates every staged-boundary explicit-window cell exactly once`, () => {
    const keys = stagedWindowCases.map(
      ({ boundary, demand }) => `${boundary}:${demand}`,
    )

    expect(stagedWindowCases).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)
  })

  it.each(stagedWindowCases)(
    `refines staged boundary $boundary with $demand explicit-window demand`,
    async ({ boundary, demand }) => {
      type ObservedRequest = {
        kind: `page` | `boundary`
        options: RequestOptions
        settlement?: ReturnType<typeof createDeferred>
      }
      const requests: Array<ObservedRequest> = []
      let graphInputRevision = 0
      let dataNeeded = 1
      const request = (
        kind: ObservedRequest[`kind`],
        options: RequestOptions,
      ) => {
        if (requests.length === 0) {
          requests.push({ kind, options })
          graphInputRevision++
          options.onLoadSubsetResult?.(true, options, () => {})
          return
        }
        const settlement = createDeferred()
        requests.push({ kind, options, settlement })
        options.onLoadSubsetResult?.(settlement.promise, options, () => {})
      }
      const subscription = {
        setOrderByIndex: () => {},
        readOrderedSnapshot: () =>
          boundary === `present` ? [{ value: { rank: 1 } }] : [],
        requestLimitedSnapshot: (options: RequestOptions) =>
          request(`page`, options),
        requestSnapshot: (options: RequestOptions) =>
          request(`boundary`, options),
      }
      const info = createOrderByInfo({ dataNeeded: () => dataNeeded })
      const loader = new OrderedSourceLoader(
        info,
        subscription as unknown as CollectionSubscription,
        `row`,
        undefined,
        undefined,
        () => graphInputRevision,
      )

      try {
        loader.start()
        expect(
          (loader as unknown as { stagedContinuation?: unknown })
            .stagedContinuation,
        ).toBeDefined()

        if (demand === `widened`) {
          info.limit = 2
          dataNeeded = 2
        } else {
          dataNeeded = 0
        }
        const window = loader.loadMore(1)

        if (requests.length === 1) {
          expect(window).toBeUndefined()
        } else {
          expect(window).toBeInstanceOf(Promise)
        }

        if (boundary === `present` && demand === `widened`) {
          requests[1]!.settlement!.resolve()
          await vi.waitFor(() => expect(requests).toHaveLength(3))
        }
        for (const observed of requests.slice(1)) {
          observed.settlement?.resolve()
        }
        await window

        expect(requests.map(({ kind }) => kind)).toEqual(
          expectedStagedWindowTrace(boundary, demand),
        )
        if (demand === `widened`) {
          const page = requests.at(-1)!
          expect(page.kind).toBe(`page`)
          expect(page.options.limit).toBe(2)
          if (boundary === `absent`) {
            expect(page.options.offset).toBe(0)
            expect(page.options.minValues).toBeUndefined()
          } else {
            expect(page.options.minValues).toEqual([1])
          }
        }
      } finally {
        for (const observed of requests) observed.settlement?.resolve()
        loader.dispose()
      }
    },
  )
})
