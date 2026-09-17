/**
 * Cross-adapter contract for `useLiveInfiniteQuery`.
 *
 * Drivers preserve native framework scheduling and package-realm details.
 * Controllable handles allow setter-to-fetch calls without an explicit driver
 * flush; this does not prove one shared invalidation-to-subscription interval.
 * Current React act and Vue synchronous effects attach during the setter.
 * Svelte's public fetch can start before its queued effect attaches, then waits
 * internally. Preserve those distinct measured cuts, not a universal timing law.
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
  /** Change a query dependency without an explicit driver flush. */
  setParamSync: (param: P) => void
}

export interface InfiniteQueryCollectionHandle extends InfiniteQueryHandle {
  /** Replace the input collection without an explicit driver flush. */
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
  /** Whole-test waivers are not supported; future gaps need exact signatures. */
  knownGaps?: ReadonlyArray<never>
}
