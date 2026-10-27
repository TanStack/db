// Shared fakes for the OrderedSourceLoader state tests: a deferred promise, the
// ordered-window request options, the order-by info that the loader reads, and a
// fake subscription that records each request. The request-authority laws are
// owned by ordered-source-loader-state-oracle.test.ts.
import { PropRef } from '../../src/query/ir.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type {
  CollectionSubscription,
  ReleaseLoadSubset,
} from '../../src/collection/subscription.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../src/types.js'

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

export type Observed = {
  method: `limited` | `snapshot`
  options: RequestOptions
  acquisition: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred>
}

export function fakeSubscription(
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
