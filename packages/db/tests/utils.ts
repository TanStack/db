import { expect } from "vitest"
import { BTreeIndex } from "../src/indexes/btree-index"
import type {
  CollectionConfig,
  MutationFnParams,
  StringCollationConfig,
  SyncConfig,
} from "../src/index.js"
import type { IndexConstructor } from "../src/indexes/base-index"

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

  // Track index method calls by patching all existing indexes
  const originalMethods = new Map()

  for (const [indexId, index] of collection.indexes) {
    // Track lookup calls (new unified method)
    const originalLookup = index.lookup.bind(index)
    index.lookup = function (operation: any, value: any) {
      // Only track non-range operations to avoid double counting
      // Range operations (gt, gte, lt, lte) are handled by rangeQuery tracking
      if (![`gt`, `gte`, `lt`, `lte`].includes(operation)) {
        stats.rangeQueryCalls++
        stats.indexesUsed.push(String(indexId))
        stats.queriesExecuted.push({
          type: `index`,
          operation,
          field: index.expression?.path?.join(`.`),
          value,
        })
      }
      return originalLookup(operation, value)
    }

    // Track rangeQuery calls (for compound range queries)
    if (index.rangeQuery) {
      const originalRangeQuery = index.rangeQuery.bind(index)
      index.rangeQuery = function (options: any) {
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
      lookup: originalLookup,
      rangeQuery: index.rangeQuery ? index.rangeQuery.bind(index) : undefined,
    })
  }

  // Track full scan calls (entries() iteration)
  const originalEntries = collection.entries
  collection.entries = function* () {
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
    yield* originalEntries.call(this)
  }

  const restore = () => {
    // Restore original index methods
    for (const [indexId, index] of collection.indexes) {
      const original = originalMethods.get(indexId)
      if (original) {
        index.lookup = original.lookup
        if (original.rangeQuery) {
          index.rangeQuery = original.rangeQuery
        }
      }
    }
    collection.entries = originalEntries
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

export function mockSyncCollectionOptions<
  T extends object = Record<string, unknown>,
>(config: MockSyncCollectionConfig<T>) {
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
    syncPendingPromise.then(() => {
      syncPendingPromise = undefined
      syncPendingResolve = undefined
      syncPendingReject = undefined
    })
    return syncPendingPromise
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

  return options
}

type MockSyncCollectionConfigNoInitialState<T> = {
  id: string
  getKey: (item: T) => string | number
  autoIndex?: `off` | `eager`
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
    syncPendingPromise.then(() => {
      syncPendingPromise = undefined
      syncPendingResolve = undefined
      syncPendingReject = undefined
    })
    return syncPendingPromise
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
  return new Promise((resolve, reject) => {
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
      .finally(() => {
        // Clean up the error handler
        process.removeListener(`unhandledRejection`, handleRejection)
        if (originalUnhandledRejection) {
          process.addListener(`unhandledRejection`, originalUnhandledRejection)
        }
      })
  })
}
