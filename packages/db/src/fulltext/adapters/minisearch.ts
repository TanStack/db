/**
 * MiniSearch Adapter for TanStack DB Full-Text Search
 *
 * @see https://github.com/lucaong/minisearch
 *
 * MiniSearch is a tiny but powerful in-memory full-text search engine
 * with fuzzy matching, prefix search, and field boosting.
 *
 * Installation:
 *   npm install minisearch
 */

import type {
  FullTextIndexConfig,
  FullTextSearchAdapter,
  SearchOptions,
  SearchResult,
  SuggestOptions,
} from '../types.js'

/**
 * Extended config options specific to MiniSearch
 */
export interface MiniSearchAdapterConfig<T = any> extends FullTextIndexConfig<T> {
  /** MiniSearch-specific: custom search options passed to MiniSearch constructor */
  searchOptions?: {
    /** Fields to boost during search */
    boost?: Record<string, number>
    /** Enable prefix search by default */
    prefix?: boolean
    /** Fuzzy search tolerance (0-1) */
    fuzzy?: number | boolean
    /** Combine term results with 'AND' or 'OR' */
    combineWith?: `AND` | `OR`
  }
  /** MiniSearch-specific: custom index options */
  indexOptions?: {
    /** Custom tokenizer */
    tokenize?: (text: string) => Array<string>
    /** Custom term processor */
    processTerm?: (term: string) => string | null
  }
}

/**
 * Type for MiniSearch instance (to avoid requiring the package at compile time)
 */
interface MiniSearchInstance<T> {
  add: (doc: T) => void
  addAll: (docs: Array<T>) => void
  remove: (doc: T) => void
  removeAll: () => void
  search: (query: string, options?: any) => Array<{ id: any; score: number; match: Record<string, Array<string>> }>
  autoSuggest: (query: string, options?: any) => Array<{ suggestion: string; score: number }>
  documentCount: number
}

interface MiniSearchConstructor {
  new <T>(options: any): MiniSearchInstance<T>
}

/**
 * Creates a MiniSearch-based full-text search adapter.
 *
 * @example
 * ```typescript
 * import MiniSearch from 'minisearch'
 * import { createMiniSearchAdapter } from '@tanstack/db/fulltext'
 *
 * const adapter = createMiniSearchAdapter(MiniSearch, {
 *   fields: ['title', 'content'],
 *   storeFields: ['title']
 * })
 *
 * collection.createFullTextIndex(adapter)
 * ```
 */
export function createMiniSearchAdapter<T = any, TKey extends string | number = string>(
  MiniSearch: MiniSearchConstructor,
  config: MiniSearchAdapterConfig<T>,
): FullTextSearchAdapter<T, TKey> {
  const {
    fields,
    idField = `id`,
    storeFields = [],
    searchOptions = {},
    indexOptions = {},
  } = config

  const miniSearchOptions: any = {
    fields: fields as Array<string>,
    idField,
    storeFields: storeFields as Array<string>,
    ...indexOptions,
  }

  let miniSearch = new MiniSearch<any>(miniSearchOptions)
  const keyToDoc = new Map<TKey, any>()

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

      miniSearch.add(doc)
      keyToDoc.set(key, doc)
    },

    remove(key: TKey): void {
      const doc = keyToDoc.get(key)
      if (doc) {
        miniSearch.remove(doc)
        keyToDoc.delete(key)
      }
    },

    update(key: TKey, document: T): void {
      this.remove(key)
      this.add(key, document)
    },

    build(entries: Iterable<[TKey, T]>): void {
      this.clear()
      const entriesArray = Array.from(entries)
      for (const [key, doc] of entriesArray) {
        this.add(key, doc)
      }
    },

    clear(): void {
      miniSearch = new MiniSearch<any>(miniSearchOptions)
      keyToDoc.clear()
    },

    search(query: string, options: SearchOptions = {}): Array<SearchResult<TKey>> {
      const {
        limit = 10,
        offset = 0,
        fields: searchFields,
        fuzzy,
        prefix,
        boost,
        filter,
      } = options

      const msSearchOptions: any = {
        ...searchOptions,
      }

      if (searchFields && searchFields.length > 0) {
        msSearchOptions.fields = searchFields
      }

      if (fuzzy !== undefined) {
        msSearchOptions.fuzzy = fuzzy === true ? 0.2 : fuzzy
      }

      if (prefix !== undefined) {
        msSearchOptions.prefix = prefix
      }

      if (boost) {
        msSearchOptions.boost = boost
      }

      if (filter) {
        msSearchOptions.filter = (result: any) => filter(result.id)
      }

      const results = miniSearch.search(query, msSearchOptions)

      return results.slice(offset, offset + limit).map((result) => ({
        key: result.id as TKey,
        score: result.score,
        highlights: result.match,
      }))
    },

    suggest(prefix: string, options: SuggestOptions = {}): Array<string> {
      const { limit = 5, fields: suggestFields } = options

      const suggestOptions: any = {}
      if (suggestFields && suggestFields.length > 0) {
        suggestOptions.fields = suggestFields
      }

      const suggestions = miniSearch.autoSuggest(prefix, suggestOptions)

      return suggestions.slice(0, limit).map((s) => s.suggestion)
    },

    get size(): number {
      return miniSearch.documentCount
    },

    dispose(): void {
      this.clear()
    },
  }
}

/**
 * Creates a factory function for MiniSearch adapters.
 * Useful when you want to defer MiniSearch import.
 *
 * @example
 * ```typescript
 * const miniSearchFactory = createMiniSearchAdapterFactory(
 *   () => import('minisearch').then(m => m.default)
 * )
 *
 * const adapter = await miniSearchFactory({ fields: ['title', 'content'] })
 * ```
 */
export function createMiniSearchAdapterFactory<T = any, TKey extends string | number = string>(
  importMiniSearch: () => Promise<MiniSearchConstructor>,
): (config: MiniSearchAdapterConfig<T>) => Promise<FullTextSearchAdapter<T, TKey>> {
  return async (config) => {
    const MiniSearch = await importMiniSearch()
    return createMiniSearchAdapter<T, TKey>(MiniSearch, config)
  }
}
