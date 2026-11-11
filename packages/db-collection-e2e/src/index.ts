/**
 * @tanstack/db-collection-e2e
 *
 * Shared end-to-end test suite for TanStack DB collections
 */

export * from './types'
export * from './fixtures/test-schema'
export * from './fixtures/seed-data'
export * from './utils/helpers'
export * from './utils/assertions'

// Export specific utilities for convenience
export {
  waitFor,
  waitForQueryData,
  waitForCollectionSize,
} from './utils/helpers'

// Export test suite creators
export { createPredicatesTestSuite } from './suites/predicates-witness.suite'
export { createPaginationTestSuite } from './suites/pagination-witness.suite'
export { createJoinsTestSuite } from './suites/joins-witness.suite'
export { createDeduplicationTestSuite } from './suites/deduplication.suite'
export { createCollationTestSuite } from './suites/collation.suite'
export { createMutationsTestSuite } from './suites/mutations.suite'
export { createLiveUpdatesUnitTestSuite } from './suites/live-updates.suite'
export { createLiveUpdatesTestSuite } from './suites/live-updates-witness.suite'
export { createProgressiveTestSuite } from './suites/progressive.suite'
export { createMovesTestSuite } from './suites/moves-oracle.suite'
