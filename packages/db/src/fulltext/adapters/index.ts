/**
 * Full-Text Search Adapters
 *
 * Pre-built adapters for popular full-text search libraries.
 * Each adapter implements the FullTextSearchAdapter interface.
 */

export {
  createOramaAdapter,
  createOramaAdapterFactory,
  type OramaAdapterConfig,
} from './orama.js'

export {
  createMiniSearchAdapter,
  createMiniSearchAdapterFactory,
  type MiniSearchAdapterConfig,
} from './minisearch.js'

export {
  createFlexSearchAdapter,
  createFlexSearchAdapterFactory,
  type FlexSearchAdapterConfig,
} from './flexsearch.js'
