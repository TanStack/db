/**
 * FlexSearch Adapter for TanStack DB Full-Text Search
 *
 * @see https://github.com/nextapps-de/flexsearch
 *
 * FlexSearch is a high-performance full-text search library with
 * support for Web Workers, persistent indexes, and advanced matching.
 *
 * Installation:
 *   npm install flexsearch
 */

import type {
  FullTextIndexConfig,
  FullTextSearchAdapter,
  SearchOptions,
  SearchResult,
} from '../types.js'

/**
 * Extended config options specific to FlexSearch
 */
export interface FlexSearchAdapterConfig<T = any> extends FullTextIndexConfig<T> {
  /**
   * FlexSearch preset: 'memory', 'performance', 'match', 'score', 'default'
   * - memory: Optimized for memory usage
   * - performance: Optimized for speed
   * - match: Optimized for matching accuracy
   * - score: Optimized for scoring relevance
   * - default: Balanced
   */
  preset?: `memory` | `performance` | `match` | `score` | `default`
  /** FlexSearch-specific: enable suggestions */
  suggest?: boolean
  /** FlexSearch-specific: context search depth */
  context?: boolean | { depth?: number; bidirectional?: boolean; resolution?: number }
}

/**
 * Type for FlexSearch Document instance
 */
interface FlexSearchDocumentInstance {
  add: ((id: any, doc: any) => void) & ((doc: any) => void)
  update: ((id: any, doc: any) => void) & ((doc: any) => void)
  remove: (id: any) => void
  search: ((query: string, options?: any) => any) & ((query: string, limit?: number, options?: any) => any) & ((options: any) => any)
}

interface FlexSearchDocumentConstructor {
  new (options: any): FlexSearchDocumentInstance
}

/**
 * Creates a FlexSearch-based full-text search adapter.
 *
 * @example
 * ```typescript
 * import { Document } from 'flexsearch'
 * import { createFlexSearchAdapter } from '@tanstack/db/fulltext'
 *
 * const adapter = createFlexSearchAdapter(Document, {
 *   fields: ['title', 'content'],
 *   preset: 'performance'
 * })
 *
 * collection.createFullTextIndex(adapter)
 * ```
 */
export function createFlexSearchAdapter<T = any, TKey extends string | number = string>(
  Document: FlexSearchDocumentConstructor,
  config: FlexSearchAdapterConfig<T>,
): FullTextSearchAdapter<T, TKey> {
  const {
    fields,
    idField = `id`,
    preset = `default`,
    suggest = false,
    context = false,
    storeFields = [],
  } = config

  // Build FlexSearch document config
  const indexConfig: any = {
    preset,
    document: {
      id: idField,
      index: fields as Array<string>,
      store: storeFields.length > 0 ? (storeFields as Array<string>) : false,
    },
    tokenize: `forward`,
  }

  if (suggest) {
    indexConfig.suggest = true
  }

  if (context) {
    indexConfig.context = context === true ? { depth: 2, bidirectional: true } : context
  }

  let flexSearch = new Document(indexConfig)
  let docCount = 0
  const indexedKeys = new Set<TKey>()

  return {
    add(key: TKey, document: T): void {
      const doc: Record<string, any> = { [idField]: key }

      for (const field of fields) {
        const value = (document as any)[field]
        if (value !== undefined && value !== null) {
          doc[field] = String(value)
        }
      }

      for (const field of storeFields) {
        if (!fields.includes(field)) {
          const value = (document as any)[field]
          if (value !== undefined) {
            doc[field] = value
          }
        }
      }

      flexSearch.add(doc)
      indexedKeys.add(key)
      docCount++
    },

    remove(key: TKey): void {
      if (indexedKeys.has(key)) {
        flexSearch.remove(key)
        indexedKeys.delete(key)
        docCount--
      }
    },

    update(key: TKey, document: T): void {
      const doc: Record<string, any> = { [idField]: key }

      for (const field of fields) {
        const value = (document as any)[field]
        if (value !== undefined && value !== null) {
          doc[field] = String(value)
        }
      }

      for (const field of storeFields) {
        if (!fields.includes(field)) {
          const value = (document as any)[field]
          if (value !== undefined) {
            doc[field] = value
          }
        }
      }

      if (indexedKeys.has(key)) {
        flexSearch.update(doc)
      } else {
        flexSearch.add(doc)
        indexedKeys.add(key)
        docCount++
      }
    },

    build(entries: Iterable<[TKey, T]>): void {
      this.clear()
      const entriesArray = Array.from(entries)
      for (const [key, doc] of entriesArray) {
        this.add(key, doc)
      }
    },

    clear(): void {
      flexSearch = new Document(indexConfig)
      indexedKeys.clear()
      docCount = 0
    },

    search(query: string, options: SearchOptions = {}): Array<SearchResult<TKey>> {
      const {
        limit = 10,
        offset = 0,
        fields: searchFields,
        fuzzy,
        boost,
      } = options

      const searchOptions: any = {
        limit: limit + offset,
        suggest: fuzzy === true,
      }

      if (searchFields && searchFields.length > 0) {
        searchOptions.field = searchFields
      }

      if (boost) {
        searchOptions.boost = boost
      }

      // FlexSearch returns results grouped by field
      const rawResults = flexSearch.search(query, searchOptions)

      // Merge and dedupe results from all fields
      const scoreMap = new Map<TKey, number>()

      if (Array.isArray(rawResults)) {
        for (const fieldResult of rawResults) {
          const results = fieldResult.result || fieldResult
          if (Array.isArray(results)) {
            for (let i = 0; i < results.length; i++) {
              const id = results[i] as TKey
              // FlexSearch doesn't provide scores, so we use position-based scoring
              const score = 1 - i / results.length
              const existingScore = scoreMap.get(id) || 0
              scoreMap.set(id, Math.max(existingScore, score))
            }
          }
        }
      }

      // Sort by score descending
      const sortedResults = Array.from(scoreMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(offset, offset + limit)
        .map(([key, score]) => ({
          key,
          score,
        }))

      return sortedResults
    },

    get size(): number {
      return docCount
    },

    dispose(): void {
      this.clear()
    },
  }
}

/**
 * Creates a factory function for FlexSearch adapters.
 * Useful when you want to defer FlexSearch import.
 *
 * @example
 * ```typescript
 * const flexSearchFactory = createFlexSearchAdapterFactory(
 *   () => import('flexsearch').then(m => m.Document)
 * )
 *
 * const adapter = await flexSearchFactory({ fields: ['title', 'content'] })
 * ```
 */
export function createFlexSearchAdapterFactory<T = any, TKey extends string | number = string>(
  importFlexSearchDocument: () => Promise<FlexSearchDocumentConstructor>,
): (config: FlexSearchAdapterConfig<T>) => Promise<FullTextSearchAdapter<T, TKey>> {
  return async (config) => {
    const Document = await importFlexSearchDocument()
    return createFlexSearchAdapter<T, TKey>(Document, config)
  }
}
