import { expect } from "vitest"
import type {
  CollectionConfig,
  MutationFnParams,
  SyncConfig,
} from "../src/index.js"

type MockSyncCollectionConfig<T> = {
  id: string
  initialData: Array<T>
  getKey: (item: T) => string | number
  autoIndex?: `off` | `eager`
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
  }
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
  testFn: (tracker: { stats: IndexUsageStats }) => void | Promise<void>
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

  const options: CollectionConfig<T> & { utils: typeof utils } = {
    sync: {
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
    },
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
  }

  return options
}
