/**
 * Cross-adapter contract for `useLiveInfiniteQuery`.
 *
 * Drivers keep framework scheduling and package-realm details out of the shared
 * scenarios. Unlike the ordinary live-query contract, controllable handles can
 * mutate inputs without settling so the suite can exercise imperative calls in
 * the invalidation-to-subscription interval.
 */
import type { Collection } from '@tanstack/db'
import type { QueryBuild, SourceHandle } from './contract'

export interface InfiniteQueryConfig {
  pageSize?: number
  initialPageParam?: number
}

export interface InfiniteQueryResult {
  data: Array<any>
  pages: Array<Array<any>>
  pageParams: Array<number>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: unknown
  status: string
  collection: Collection<any, any, any>
}

export interface InfiniteQueryHandle {
  current: () => InfiniteQueryResult
  /** Invoke a page fetch and wait until its observable request settles. */
  fetchNextPage: () => Promise<void>
  flush: () => Promise<void>
  apply: (fn: () => void) => Promise<void>
  unmount: () => void
}

export interface InfiniteQueryControllableHandle<
  P,
> extends InfiniteQueryHandle {
  /** Change a query dependency without waiting for the framework to settle. */
  setParamSync: (param: P) => void
}

export interface InfiniteQueryCollectionHandle extends InfiniteQueryHandle {
  /** Replace the input collection without waiting for the framework to settle. */
  replaceCollectionSync: (collection: Collection<any, any, any>) => void
}

export interface InfiniteQueryConfigHandle extends InfiniteQueryHandle {
  /** Replace reactive page-shape options without waiting for the framework. */
  setConfigSync: (config: InfiniteQueryConfig) => void
}

export interface InfiniteQueryInputHandle extends InfiniteQueryHandle {
  setInputKindSync: (kind: `collection` | `query`) => void
}

export interface InfiniteQueryDriver {
  name: string
  gt: (a: any, b: any) => any
  makeSource: <T extends { id: string }>(
    initialData: ReadonlyArray<T>,
  ) => SourceHandle<T>
  makeOnDemandSource: <T extends { id: string; rank: number }>(
    data: ReadonlyArray<T>,
    asyncDelay?: number,
  ) => {
    collection: Collection<T, string | number, any>
    calls: Array<{ limit?: number }>
  }
  makePrecreated: (build: QueryBuild) => {
    collection: Collection<any, any, any>
  }
  mount: (
    build: QueryBuild,
    config?: InfiniteQueryConfig,
  ) => InfiniteQueryHandle
  mountControllable: <P>(
    build: (q: any, param: P) => any,
    initial: P,
    config?: InfiniteQueryConfig,
  ) => InfiniteQueryControllableHandle<P>
  mountCollection: (
    collection: Collection<any, any, any>,
    config?: InfiniteQueryConfig,
  ) => InfiniteQueryHandle
  mountCollectionControllable: (
    collection: Collection<any, any, any>,
    config?: InfiniteQueryConfig,
  ) => InfiniteQueryCollectionHandle
  mountConfigControllable: (
    build: QueryBuild,
    initial: InfiniteQueryConfig,
  ) => InfiniteQueryConfigHandle
  mountInputControllable: (
    collection: Collection<any, any, any>,
    build: QueryBuild,
    config?: InfiniteQueryConfig,
  ) => InfiniteQueryInputHandle
  knownGaps?: ReadonlyArray<string>
}
