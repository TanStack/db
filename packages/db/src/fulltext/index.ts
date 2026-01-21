/**
 * Full-Text Search for TanStack DB
 *
 * This module provides a generic interface for full-text search
 * that works with multiple search libraries (Orama, MiniSearch, FlexSearch).
 *
 * @example
 * ```typescript
 * // Using with Orama
 * import { create, insert, remove, search } from '@orama/orama'
 * import { createOramaAdapter } from '@tanstack/db/fulltext'
 *
 * const searchAdapter = createOramaAdapter(
 *   { create, insert, remove, search },
 *   { fields: ['title', 'content'] }
 * )
 *
 * // Add documents
 * searchAdapter.add('doc1', { title: 'Hello', content: 'World' })
 *
 * // Search
 * const results = searchAdapter.search('hello')
 * ```
 *
 * @example
 * ```typescript
 * // Using with MiniSearch
 * import MiniSearch from 'minisearch'
 * import { createMiniSearchAdapter } from '@tanstack/db/fulltext'
 *
 * const searchAdapter = createMiniSearchAdapter(MiniSearch, {
 *   fields: ['title', 'content']
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Using with FlexSearch
 * import { Document } from 'flexsearch'
 * import { createFlexSearchAdapter } from '@tanstack/db/fulltext'
 *
 * const searchAdapter = createFlexSearchAdapter(Document, {
 *   fields: ['title', 'content'],
 *   preset: 'performance'
 * })
 * ```
 */

// Core types
export type {
  FullTextSearchAdapter,
  FullTextSearchAdapterFactory,
  FullTextIndexConfig,
  SearchOptions,
  SearchResult,
  SuggestOptions,
} from './types.js'

// Adapters
export {
  createOramaAdapter,
  createOramaAdapterFactory,
  type OramaAdapterConfig,
  createMiniSearchAdapter,
  createMiniSearchAdapterFactory,
  type MiniSearchAdapterConfig,
  createFlexSearchAdapter,
  createFlexSearchAdapterFactory,
  type FlexSearchAdapterConfig,
} from './adapters/index.js'

// SearchIndex - reactive search attached to collections
export {
  SearchIndex,
  createSearchIndex,
  type LiveSearch,
  type LiveSearchOptions,
  type LiveSearchResult,
} from './search-index.js'
