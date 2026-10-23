import { materializeCompilation } from './materialized-pipeline.js'
import { BucketFacadeAdapter } from './bucket-facade-adapter.js'

/**
 * The include materializer. `include()`, `toArray()`, and `materialize()`
 * carry it onto the query IR, so other apps do not bundle it. Join operators
 * carry only public-key reduction.
 */
export const includesRuntime = {
  materializeCompilation,
  createBucketFacades: (
    ...args: ConstructorParameters<typeof BucketFacadeAdapter>
  ) => new BucketFacadeAdapter(...args),
}

export type IncludesRuntime = typeof includesRuntime
