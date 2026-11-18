// Law: an explicit window that consumes a staged boundary continuation issues
// only the immediate work that its boundary and remaining demand require. The
// model `expectedStagedWindowTrace` states that trace for each cell of the
// boundary-by-demand grammar `stagedWindowCases`; both live in
// ordered-source-loader-model-oracle.ts. The remaining scenarios in this area
// are fixed histories, owned by ordered-source-loader.test.ts.
import { describe, expect, vi } from 'vitest'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import {
  createDeferred,
  createOrderByInfo,
} from './ordered-source-loader-support.js'
import {
  expectedStagedWindowTrace,
  stagedWindowCases,
} from './ordered-source-loader-model-oracle.js'
import type { RequestOptions } from './ordered-source-loader-support.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'

// The production driver: one staged-boundary explicit-window cell through a
// real OrderedSourceLoader, compared with `expectedStagedWindowTrace`.
async function runStagedWindowCell({
  boundary,
  demand,
}: (typeof stagedWindowCases)[number]): Promise<void> {
  type ObservedRequest = {
    kind: `page` | `boundary`
    options: RequestOptions
    settlement?: ReturnType<typeof createDeferred>
  }
  const requests: Array<ObservedRequest> = []
  let graphInputRevision = 0
  let dataNeeded = 1
  const request = (kind: ObservedRequest[`kind`], options: RequestOptions) => {
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
    requestSnapshot: (options: RequestOptions) => request(`boundary`, options),
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
}

describe(`OrderedSourceLoader`, () => {
  oracleProperty({
    id: `ordered-source-loader.staged-window`,
    law: {
      statement: `An explicit window that consumes a staged boundary continuation issues only the immediate work that its boundary and remaining demand require.`,
      authority: `The ordered loading laws of packages/db/src/query/live/ARCHITECTURE.md.`,
      limits: `The four boundary-by-demand cells of stagedWindowCases; the remaining scenarios are fixed histories in ordered-source-loader.test.ts.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: stagedWindowCases,
    label: ({ boundary, demand }) =>
      `refines staged boundary ${boundary} with ${demand} explicit-window demand`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `staged boundary window work`,
        plan,
        observe,
        () => runStagedWindowCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})
