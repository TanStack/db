import { describe } from 'vitest'
import {
  createCollationTestSuite,
  createDeduplicationTestSuite,
  createJoinsTestSuite,
  createLiveUpdatesTestSuite,
  createMovesTestSuite,
  createMutationsTestSuite,
  createPaginationTestSuite,
  createPredicatesTestSuite,
  createProgressiveTestSuite,
} from '../../../db-collection-e2e/src'
import type { E2ETestConfig } from '../../../db-collection-e2e/src'

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
  includeProgressive?: boolean
  includeMoves?: boolean
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
  const includeProgressive = options.includeProgressive ?? false
  const includeMoves = options.includeMoves ?? false

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
    if (includeProgressive) {
      createProgressiveTestSuite(getConfig)
    }
    if (includeMoves) {
      createMovesTestSuite(getConfig as never)
    }
  })
}
