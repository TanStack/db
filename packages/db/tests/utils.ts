import { expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BTreeIndex } from '../src/indexes/btree-index'
import { withCollectionConfigFactory } from '../src/client'
import { denormalizeUndefined } from '../src/utils/comparison.js'
import { CleanupQueue } from '../src/collection/cleanup-queue.js'
import type {
  CollectionConfig,
  MutationFnParams,
  StringCollationConfig,
  SyncConfig,
} from '../src/index.js'
import type { IndexConstructor } from '../src/indexes/base-index'
import type { WithVirtualProps } from '../src/virtual-props.js'

export type OutputWithVirtual<
  T extends object,
  TKey extends string | number = string | number,
> = WithVirtualProps<T, TKey>
/**
 * Runs an oracle check, then every cleanup step in order. A cleanup failure
 * never replaces the check's own failure: the check failure is thrown alone or
 * as the `cause` of an `AggregateError` that also holds each cleanup failure.
 */
export async function withOracleCleanup(
  check: () => Promise<void> | void,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<void> {
  const failures: Array<unknown> = []
  let checkFailed = false
  try {
    await check()
  } catch (error) {
    checkFailed = true
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      checkFailed ? `Oracle check and cleanup failed` : `Oracle cleanup failed`,
      { cause: failures[0] },
    )
  }
}

// Keep sync startup, writes, readiness, and load outcomes in the test itself.
export function createOnDemandCollection<T extends { id: string | number }>(
  config: Omit<CollectionConfig<T>, `getKey` | `syncMode`>,
) {
  return createCollection<T>({
    ...config,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
  })
}

export const stripVirtualProps = <T extends Record<string, any> | undefined>(
  value: T,
) => {
  if (!value || typeof value !== `object`) return value
  const {
    $hasPendingWrites: _hasPendingWrites,
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as T
}

export const omitVirtualProps = <T extends Record<string, any>>(
  value: T,
): Omit<
  T,
  '$hasPendingWrites' | '$synced' | '$origin' | '$key' | '$collectionId'
> => {
  const {
    $hasPendingWrites: _hasPendingWrites,
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as any
}

// Index usage tracking utilities
export interface IndexUsageStats {
  rangeQueryCalls: number
  fullScanCalls: number
  indexesUsed: Array<string>
  queriesExecuted: Array<{
    type: `index` | `fullScan`
    operation?: string
    field?: string
    value?: any
  }>
}

export function createIndexUsageTracker(collection: any): {
  stats: IndexUsageStats
  restore: () => void
} {
  const stats: IndexUsageStats = {
    rangeQueryCalls: 0,
    fullScanCalls: 0,
    indexesUsed: [],
    queriesExecuted: [],
  }

  // Track index method calls. Indexes are patched when first read through the
  // collection, so indexes created after tracking starts (such as auto-indexes
  // added by a live query) are tracked too.
  const originalMethods = new Map()
  // A range lookup delegates to rangeQuery; record it once, as the lookup.
  let lookupDepth = 0
  const patchIndex = (indexId: unknown, index: any) => {
    if (originalMethods.has(indexId)) return
    // Track lookup calls (new unified method)
    const originalLookup = index.lookup.bind(index)
    index.lookup = function (operation: any, value: any) {
      stats.rangeQueryCalls++
      stats.indexesUsed.push(String(indexId))
      stats.queriesExecuted.push({
        type: `index`,
        operation,
        field: index.expression?.path?.join(`.`),
        value,
      })
      lookupDepth++
      try {
        return originalLookup(operation, value)
      } finally {
        lookupDepth--
      }
    }

    // Track rangeQuery calls (for compound range queries)
    const originalRangeQuery = index.rangeQuery?.bind(index)
    if (originalRangeQuery) {
      index.rangeQuery = function (options: any) {
        if (lookupDepth > 0) return originalRangeQuery(options)
        stats.rangeQueryCalls++
        stats.indexesUsed.push(String(indexId))

        // Determine the actual operations from the options
        const operations: Array<string> = []
        if (options.from !== undefined) {
          operations.push(options.fromInclusive ? `gte` : `gt`)
        }
        if (options.to !== undefined) {
          operations.push(options.toInclusive ? `lte` : `lt`)
        }

        stats.queriesExecuted.push({
          type: `index`,
          operation: operations.join(` AND `),
          field: index.expression?.path?.join(`.`),
          value: options,
        })
        return originalRangeQuery(options)
      }
    }

    originalMethods.set(indexId, {
      index,
      lookup: originalLookup,
      rangeQuery: originalRangeQuery,
    })
  }
  const originalIndexesGetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(collection),
    `indexes`,
  )?.get
  const readIndexes = (): Map<unknown, any> =>
    originalIndexesGetter?.call(collection) ?? new Map()
  for (const [indexId, index] of readIndexes()) patchIndex(indexId, index)
  Object.defineProperty(collection, `indexes`, {
    get: () => {
      const indexes = readIndexes()
      for (const [indexId, index] of indexes) patchIndex(indexId, index)
      return indexes
    },
    configurable: true,
  })

  // Track full scan calls: filtered iteration through either the public
  // entries() or the stored-row scan used by a prefiltered snapshot.
  const recordFullScan = () => {
    // Only count as full scan if we're in a filtering context
    // Check the call stack to see if we're inside createFilterFunction
    const stack = new Error().stack || ``
    if (
      stack.includes(`createFilterFunction`) ||
      stack.includes(`currentStateAsChanges`)
    ) {
      stats.fullScanCalls++
      stats.queriesExecuted.push({
        type: `fullScan`,
      })
    }
  }
  const originalEntries = collection.entries
  collection.entries = function* () {
    recordFullScan()
    yield* originalEntries.call(this)
  }
  const state = collection._state
  const originalEntriesPassing = state.entriesPassing
  state.entriesPassing = function* (prefilter: (row: object) => boolean) {
    recordFullScan()
    yield* originalEntriesPassing.call(this, prefilter)
  }

  const restore = () => {
    // Remove the instance getter so the prototype getter applies again
    delete collection.indexes
    for (const { index, lookup, rangeQuery } of originalMethods.values()) {
      index.lookup = lookup
      if (rangeQuery) index.rangeQuery = rangeQuery
    }
    collection.entries = originalEntries
    state.entriesPassing = originalEntriesPassing
  }

  return { stats, restore }
}

// Helper to assert index usage
export function expectIndexUsage(
  stats: IndexUsageStats,
  expectations: {
    shouldUseIndex: boolean
    shouldUseFullScan?: boolean
    indexCallCount?: number
    fullScanCallCount?: number
  },
) {
  if (expectations.shouldUseIndex) {
    expect(stats.rangeQueryCalls).toBeGreaterThan(0)
    expect(stats.indexesUsed.length).toBeGreaterThan(0)

    if (expectations.indexCallCount !== undefined) {
      expect(stats.rangeQueryCalls).toBe(expectations.indexCallCount)
    }
  } else {
    expect(stats.rangeQueryCalls).toBe(0)
    expect(stats.indexesUsed.length).toBe(0)
  }

  if (expectations.shouldUseFullScan !== undefined) {
    if (expectations.shouldUseFullScan) {
      expect(stats.fullScanCalls).toBeGreaterThan(0)

      if (expectations.fullScanCallCount !== undefined) {
        expect(stats.fullScanCalls).toBe(expectations.fullScanCallCount)
      }
    } else {
      expect(stats.fullScanCalls).toBe(0)
    }
  }
}

// Helper to run a test with index usage tracking (automatically handles setup/cleanup)
export function withIndexTracking(
  collection: any,
  testFn: (tracker: { stats: IndexUsageStats }) => void | Promise<void>,
): void | Promise<void> {
  const tracker = createIndexUsageTracker(collection)

  try {
    const result = testFn(tracker)
    if (result instanceof Promise) {
      return result.finally(() => tracker.restore())
    }
    tracker.restore()
  } catch (error) {
    tracker.restore()
    throw error
  }
}

type MockSyncCollectionConfig<T extends object = Record<string, unknown>> = {
  id: string
  initialData: Array<T>
  getKey: (item: T) => string | number
  autoIndex?: `off` | `eager`
  sync?: SyncConfig<T>
  syncMode?: `eager` | `on-demand`
  defaultStringCollation?: StringCollationConfig
  defaultIndexType?: IndexConstructor
}

type MockSyncCollectionUtils<T extends object> = {
  begin: () => void
  write: Parameters<SyncConfig<T>[`sync`]>[0][`write`]
  commit: () => void
  resolveSync: () => void
  rejectSync: (error: Error) => void
}

export function mockSyncCollectionOptions<
  T extends object = Record<string, unknown>,
>(
  config: MockSyncCollectionConfig<T>,
): CollectionConfig<T, string | number, never> & {
  utils: MockSyncCollectionUtils<T>
} {
  let begin: () => void
  let write: Parameters<SyncConfig<T>[`sync`]>[0][`write`]
  let commit: () => void

  let syncPendingPromise: Promise<void> | undefined
  let syncPendingResolve: (() => void) | undefined
  let syncPendingReject: ((error: Error) => void) | undefined

  const awaitSync = async () => {
    if (syncPendingPromise) {
      return syncPendingPromise
    }
    syncPendingPromise = new Promise((resolve, reject) => {
      syncPendingResolve = resolve
      syncPendingReject = reject
    })
    void syncPendingPromise.finally(clearPendingSync)
    return syncPendingPromise
  }

  const clearPendingSync = () => {
    syncPendingPromise = undefined
    syncPendingResolve = undefined
    syncPendingReject = undefined
  }

  const utils = {
    begin: () => begin!(),
    write: ((value) => write!(value)) as typeof write,
    commit: () => commit!(),
    resolveSync: () => {
      syncPendingResolve!()
    },
    rejectSync: (error: Error) => {
      syncPendingReject!(error)
    },
  }

  const sync = config.sync ?? {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      begin = params.begin
      write = params.write
      commit = params.commit
      const markReady = params.markReady

      begin()
      config.initialData.forEach((item) => {
        write({
          type: `insert`,
          value: item,
        })
      })
      commit()
      markReady()
    },
  }

  const options: CollectionConfig<T, string | number, never> & {
    utils: typeof utils
  } = {
    sync,
    ...(config.syncMode ? { syncMode: config.syncMode } : {}),
    startSync: true,
    onInsert: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onUpdate: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onDelete: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    utils,
    ...config,
    autoIndex: config.autoIndex,
    // When autoIndex is 'eager', we need a defaultIndexType
    defaultIndexType:
      config.defaultIndexType ??
      (config.autoIndex === `eager` ? BTreeIndex : undefined),
  }

  return withCollectionConfigFactory(options, () =>
    mockSyncCollectionOptions(config),
  )
}

type MockSyncCollectionConfigNoInitialState<T> = {
  id: string
  getKey: (item: T) => string | number
  autoIndex?: `off` | `eager`
  startSync?: boolean
  defaultIndexType?: IndexConstructor
}

export function mockSyncCollectionOptionsNoInitialState<
  T extends object = Record<string, unknown>,
>(config: MockSyncCollectionConfigNoInitialState<T>) {
  let begin: () => void
  let write: Parameters<SyncConfig<T>[`sync`]>[0][`write`]
  let commit: () => void
  let markReady: () => void
  let truncate: () => void

  let syncPendingPromise: Promise<void> | undefined
  let syncPendingResolve: (() => void) | undefined
  let syncPendingReject: ((error: Error) => void) | undefined

  const awaitSync = async () => {
    if (syncPendingPromise) {
      return syncPendingPromise
    }
    syncPendingPromise = new Promise((resolve, reject) => {
      syncPendingResolve = resolve
      syncPendingReject = reject
    })
    void syncPendingPromise.finally(clearPendingSync)
    return syncPendingPromise
  }

  const clearPendingSync = () => {
    syncPendingPromise = undefined
    syncPendingResolve = undefined
    syncPendingReject = undefined
  }

  const utils = {
    begin: () => begin!(),
    write: ((value) => write!(value)) as typeof write,
    commit: () => commit!(),
    markReady: () => markReady!(),
    truncate: () => truncate!(),
    resolveSync: () => {
      syncPendingResolve!()
    },
    rejectSync: (error: Error) => {
      syncPendingReject!(error)
    },
  }

  const options: CollectionConfig<T, string | number, never> & {
    utils: typeof utils
  } = {
    sync: {
      sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        markReady = params.markReady
        truncate = params.truncate
      },
    },
    startSync: false,
    onInsert: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onUpdate: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onDelete: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    utils,
    ...config,
    autoIndex: config.autoIndex,
    // When autoIndex is 'eager', we need a defaultIndexType
    defaultIndexType:
      config.defaultIndexType ??
      (config.autoIndex === `eager` ? BTreeIndex : undefined),
  }

  return options
}

// Utility to flush microtasks and promises
export const flushPromises = () =>
  new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Utility to suppress expected unhandled rejections in tests.
 *
 * This function temporarily removes the vitest unhandled rejection handler and
 * sets up a custom handler that catches rejections with the expected message.
 * It's useful for testing scenarios where you expect a rejection to happen
 * asynchronously (e.g., in microtasks) that would otherwise cause vitest to
 * report an unhandled error.
 *
 * In tanstack db we rethrow errors in optimistic mutations inside a microtask, and so
 * this bubbles up as an unhandled rejection. This utility can be used to suppress
 * these rejections within a test.
 *
 * @param expectedMessage - The error message to expect and suppress
 * @param testFn - The test function that will trigger the expected rejection
 * @returns A promise that resolves when the test completes and the rejection is caught
 *
 * @example
 * ```typescript
 * await withExpectedRejection('expected error message', () => {
 *   // Your test code that triggers the rejection
 *   someAsyncOperation()
 *   return flushPromises()
 * })
 * ```
 */
export function withExpectedRejection<T>(
  expectedMessage: string,
  testFn: () => T | Promise<T>,
): Promise<T> {
  // The returned promise owns cleanup even if testFn throws before its chain exists.
  let restoreListeners: () => void = () => undefined
  return new Promise<T>((resolve, reject) => {
    // Find and temporarily remove the vitest unhandled rejection handler
    const originalUnhandledRejection = process
      .listeners(`unhandledRejection`)
      .find((listener) => listener.name === `vitestUnhandledRejectionHandler`)

    let expectedRejectionCaught = false
    const handleRejection = (reason: any) => {
      if (reason?.message === expectedMessage) {
        expectedRejectionCaught = true
        return // Don't re-throw, this is expected
      }
      // Re-throw other rejections
      reject(reason)
    }

    restoreListeners = () => {
      process.removeListener(`unhandledRejection`, handleRejection)
      if (originalUnhandledRejection) {
        process.addListener(`unhandledRejection`, originalUnhandledRejection)
      }
    }

    if (originalUnhandledRejection) {
      process.removeListener(`unhandledRejection`, originalUnhandledRejection)
    }
    process.on(`unhandledRejection`, handleRejection)

    // Execute the test function and handle the result
    Promise.resolve(testFn())
      .then(async (value) => {
        // Wait for microtasks and then check if the rejection was caught
        await flushPromises()

        if (!expectedRejectionCaught) {
          reject(
            new Error(
              `Expected rejection with message "${expectedMessage}" was not caught`,
            ),
          )
          return
        }

        resolve(value)
      })
      .catch((error) => {
        reject(error)
      })
  }).finally(() => restoreListeners())
}

type IndexInternals<TKey> = { indexedKeys: Set<TKey> } & (
  | { sortedValues: Array<unknown>; valueMap: Map<unknown, Set<TKey>> }
  | {
      valueMap: Map<unknown, { keys: Set<TKey> }>
      orderedEntries: {
        size: number
        minKey: () => unknown
        maxKey: () => unknown
        forRange: (
          low: unknown,
          high: unknown,
          includeHigh: boolean,
          onFound: (key: unknown, bucket: { keys: Set<TKey> }) => void,
        ) => void
      }
    }
)

function indexInternals<TKey>(index: object): [IndexInternals<TKey>, boolean] {
  let reversed = false
  let current = index as { originalIndex?: object }
  while (current.originalIndex) {
    reversed = !reversed
    current = current.originalIndex as { originalIndex?: object }
  }
  return [current as IndexInternals<TKey>, reversed]
}

/** Test inspection of an index's tracked keys. */
export function indexedKeysSet<TKey>(index: object): Set<TKey> {
  return indexInternals<TKey>(index)[0].indexedKeys
}

/** Test inspection of an index's value buckets keyed by indexed value. */
export function valueMapData<TKey>(index: object): Map<unknown, Set<TKey>> {
  const [internals] = indexInternals<TKey>(index)
  if (`sortedValues` in internals) return internals.valueMap
  const result = new Map<unknown, Set<TKey>>()
  for (const [key, bucket] of internals.valueMap) {
    result.set(denormalizeUndefined(key), bucket.keys)
  }
  return result
}

/** Test inspection of an index's ordered [value, keys] entries. */
export function orderedEntriesArray<TKey>(
  index: object,
): Array<[unknown, Set<TKey>]> {
  const [internals, reversed] = indexInternals<TKey>(index)
  let entries: Array<[unknown, Set<TKey>]>
  if (`sortedValues` in internals) {
    entries = internals.sortedValues.map((value) => [
      value,
      internals.valueMap.get(value) ?? new Set(),
    ])
  } else {
    const tree = internals.orderedEntries
    entries = []
    if (tree.size > 0) {
      tree.forRange(tree.minKey(), tree.maxKey(), true, (key, bucket) => {
        entries.push([denormalizeUndefined(key), bucket.keys])
      })
    }
  }
  return reversed ? entries.reverse() : entries
}

export function orderedEntriesArrayReversed<TKey>(
  index: object,
): Array<[unknown, Set<TKey>]> {
  return orderedEntriesArray<TKey>(index).reverse()
}

/** Reset the CleanupQueue singleton between tests. */
export function resetCleanupQueue(): void {
  const holder = CleanupQueue as unknown as {
    instance: { timeoutId: ReturnType<typeof setTimeout> | null } | null
  }
  if (holder.instance?.timeoutId != null)
    clearTimeout(holder.instance.timeoutId)
  holder.instance = null
}
