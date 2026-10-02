/**
 * @tanstack/db-collection-e2e
 *
 * Shared end-to-end test suite for TanStack DB collections
 */

export * from './types'
export * from './fixtures/test-schema'
export * from './fixtures/seed-data'
export * from './utils/helpers'
export * from './utils/assertions-oracle'

// Export specific utilities for convenience
export {
  waitFor,
  waitForQueryData,
  waitForCollectionSize,
} from './utils/helpers'

// Export test suite creators
export { createPredicatesTestSuite } from './suites/predicates-oracle.suite'
export { createPaginationTestSuite } from './suites/pagination-oracle.suite'
export { createJoinsTestSuite } from './suites/joins-oracle.suite'
export { createDeduplicationTestSuite } from './suites/deduplication-oracle.suite'
export { createCollationTestSuite } from './suites/collation-oracle.suite'
export { createMutationsTestSuite } from './suites/mutations-oracle.suite'
export { createLiveUpdatesTestSuite } from './suites/live-updates-oracle.suite'
export { createProgressiveTestSuite } from './suites/progressive-oracle.suite'
export { createMovesTestSuite } from './suites/moves-oracle.suite'
