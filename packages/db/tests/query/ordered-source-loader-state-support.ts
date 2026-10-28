// Shared fakes for the OrderedSourceLoader state tests: the ordered-window
// request options, the observed request record, and a fake subscription that
// records each request. The deferred promise and the order-by info come from
// ordered-source-loader-support.ts. The request-authority laws are owned by
// ordered-source-loader-state-oracle.test.ts.
import { createDeferred } from './ordered-source-loader-support.js'
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
