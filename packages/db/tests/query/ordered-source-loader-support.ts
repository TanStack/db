// Shared fixtures for the OrderedSourceLoader tests: a deferred promise, the
// ordered-window request options, and the order-by info that the loader reads.
// The ordering laws are owned by ordered-source-loader-oracle.test.ts.
import { PropRef } from '../../src/query/ir.js'
import type { ReleaseLoadSubset } from '../../src/collection/subscription.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../src/types.js'
import type { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'

export const pendingPromise = (loader: OrderedSourceLoader) =>
  (loader as unknown as { pending: Promise<unknown> | undefined }).pending

export type RequestOptions = LoadSubsetOptions & {
  minValues?: Array<unknown>
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    acquisition: LoadSubsetOptions,
    release: ReleaseLoadSubset,
  ) => void
}

export function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

export function createOrderByInfo(
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
