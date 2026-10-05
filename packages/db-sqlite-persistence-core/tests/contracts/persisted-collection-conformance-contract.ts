import { describe } from 'vitest'
import { createCollationTestSuite } from '../../../db-collection-e2e/src/suites/collation.suite'
import { createDeduplicationTestSuite } from '../../../db-collection-e2e/src/suites/deduplication.suite'
import { createJoinsTestSuite } from '../../../db-collection-e2e/src/suites/joins.suite'
import { createLiveUpdatesTestSuite } from '../../../db-collection-e2e/src/suites/live-updates.suite'
import { createMutationsTestSuite } from '../../../db-collection-e2e/src/suites/mutations.suite'
import { createPaginationTestSuite } from '../../../db-collection-e2e/src/suites/pagination.suite'
import { createPredicatesTestSuite } from '../../../db-collection-e2e/src/suites/predicates.suite'
import type { E2ETestConfig } from '../../../db-collection-e2e/src/types'

/**
 * Shared semantic portfolio for a native persisted-collection host.
 *
 * The imported suites own predicates, pagination, joins, deduplication,
 * collation, mutations, and live-update laws. A host supplies only a real
 * platform harness and explicit capability exclusions. Registering this
 * function proves no native behavior by itself; credit belongs to a completed
 * host run with its actual driver, storage, and lifecycle.
 */

export type PersistedCollectionConformanceGetConfig =
  () => Promise<E2ETestConfig>

export type PersistedCollectionConformanceSuiteOptions = {
  includePredicates?: boolean
  includePagination?: boolean
  includeJoins?: boolean
  includeDeduplication?: boolean
  includeCollation?: boolean
  includeMutations?: boolean
  includeLiveUpdates?: boolean
}

export function runPersistedCollectionConformanceSuite(
  suiteName: string,
  getConfig: PersistedCollectionConformanceGetConfig,
  options: PersistedCollectionConformanceSuiteOptions = {},
): void {
  const includePredicates = options.includePredicates ?? true
  const includePagination = options.includePagination ?? true
  const includeJoins = options.includeJoins ?? true
  const includeDeduplication = options.includeDeduplication ?? true
  const includeCollation = options.includeCollation ?? true
  const includeMutations = options.includeMutations ?? true
  const includeLiveUpdates = options.includeLiveUpdates ?? true

  describe(suiteName, () => {
    if (includePredicates) {
      createPredicatesTestSuite(getConfig)
    }
    if (includePagination) {
      createPaginationTestSuite(getConfig)
    }
    if (includeJoins) {
      createJoinsTestSuite(getConfig)
    }
    if (includeDeduplication) {
      createDeduplicationTestSuite(getConfig)
    }
    if (includeCollation) {
      createCollationTestSuite(getConfig)
    }
    if (includeMutations) {
      createMutationsTestSuite(getConfig)
    }
    if (includeLiveUpdates) {
      createLiveUpdatesTestSuite(getConfig)
    }
  })
}
