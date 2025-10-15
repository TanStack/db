import {
  isPredicateSubset,
  isWhereSubset,
  unionWherePredicates,
} from "./predicate-utils.js"
import type { BasicExpression } from "./ir.js"
import type { LoadSubsetOptions } from "../types.js"

/**
 * Creates a deduplicated wrapper around a loadSubset function.
 * Tracks what data has been loaded and avoids redundant calls.
 *
 * @param loadSubset - The underlying loadSubset function to wrap
 * @returns A wrapped function that deduplicates calls based on loaded predicates
 *
 * @example
 * const deduplicatedLoadSubset = createDeduplicatedLoadSubset(myLoadSubset)
 *
 * // First call - fetches data
 * await deduplicatedLoadSubset({ where: gt(ref('age'), val(10)) })
 *
 * // Second call - subset of first, returns true immediately
 * await deduplicatedLoadSubset({ where: gt(ref('age'), val(20)) })
 */
export function createDeduplicatedLoadSubset(
  loadSubset: (options: LoadSubsetOptions) => true | Promise<void>
): (options: LoadSubsetOptions) => true | Promise<void> {
  // Combined where predicate for all unlimited calls (no limit)
  let unlimitedWhere: BasicExpression<boolean> | undefined = undefined

  // Flag to track if we've loaded all data (unlimited call with no where clause)
  let hasLoadedAllData = false

  // List of all limited calls (with limit, possibly with orderBy)
  const limitedCalls: Array<LoadSubsetOptions> = []

  return (options: LoadSubsetOptions) => {
    // If we've loaded all data, everything is covered
    if (hasLoadedAllData) {
      return true
    }

    // Check against unlimited combined predicate
    // If we've loaded all data matching a where clause, we don't need to refetch subsets
    if (unlimitedWhere !== undefined && options.where !== undefined) {
      if (isWhereSubset(options.where, unlimitedWhere)) {
        return true // Data already loaded via unlimited call
      }
    }

    // Check against limited calls
    if (options.limit !== undefined) {
      const alreadyLoaded = limitedCalls.some((loaded) =>
        isPredicateSubset(options, loaded)
      )

      if (alreadyLoaded) {
        return true // Already loaded
      }
    }

    // Not covered by existing data - call underlying loadSubset
    const resultPromise = loadSubset(options)

    // Handle both sync (true) and async (Promise<void>) return values
    if (resultPromise === true) {
      // Sync return - update tracking synchronously
      updateTracking(options)
      return true
    } else {
      // Async return - update tracking after promise resolves
      return resultPromise.then((result) => {
        updateTracking(options)
        return result
      })
    }
  }

  function updateTracking(options: LoadSubsetOptions) {
    // Update tracking based on whether this was a limited or unlimited call
    if (options.limit === undefined) {
      // Unlimited call - update combined where predicate
      // We ignore orderBy for unlimited calls as mentioned in requirements
      if (options.where === undefined) {
        // No where clause = all data loaded
        hasLoadedAllData = true
        unlimitedWhere = undefined
      } else if (unlimitedWhere === undefined) {
        unlimitedWhere = options.where
      } else {
        unlimitedWhere = unionWherePredicates([unlimitedWhere, options.where])
      }
    } else {
      // Limited call - add to list for future subset checks
      limitedCalls.push(options)
    }
  }
}
