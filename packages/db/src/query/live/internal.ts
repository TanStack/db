import type { CollectionConfigBuilder } from './collection-config-builder.js'
import type { AppliedLoadSubsetOutcome } from '../../types.js'

/**
 * Symbol for accessing internal utilities that should not be part of the public API
 */
export const LIVE_QUERY_INTERNAL = Symbol(`liveQueryInternal`)

/**
 * Internal utilities for live queries, accessible via Symbol
 */
export type LiveQueryInternalUtils = {
  getBuilder: () => CollectionConfigBuilder<any, any>
  hasCustomGetKey: boolean
  hasJoins: boolean
  hasDistinct: boolean
  getLatestSubsetOutcomes: () => ReadonlyArray<AppliedLoadSubsetOutcome>
  getLastWindowOutcomes: () => ReadonlyArray<AppliedLoadSubsetOutcome>
}
