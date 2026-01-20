/**
 * Full-Text Search Index Types
 *
 * Generic interface for full-text search that can be implemented
 * by various search libraries (Orama, MiniSearch, FlexSearch, etc.)
 */

/**
 * A single search result with relevance score
 */
export interface SearchResult<TKey> {
  /** The document key/id */
  key: TKey
  /** Relevance score (higher is more relevant) */
  score: number
  /** Optional highlighted terms in matched fields */
  highlights?: Record<string, string | Array<string>>
}

/**
 * Options for search queries
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  limit?: number
  /** Number of results to skip (for pagination) */
  offset?: number
  /** Specific fields to search in (default: all indexed fields) */
  fields?: Array<string>
  /** Enable fuzzy matching with given tolerance (0-1, where 0 is exact) */
  fuzzy?: number | boolean
  /** Enable prefix matching */
  prefix?: boolean
  /** Boost certain fields (field name -> boost factor) */
  boost?: Record<string, number>
  /** Filter function to apply after search */
  filter?: (key: any) => boolean
}

/**
 * Options for autocomplete/suggest queries
 */
export interface SuggestOptions {
  /** Maximum number of suggestions */
  limit?: number
  /** Specific fields to get suggestions from */
  fields?: Array<string>
}

/**
 * Configuration for creating a full-text search index
 */
export interface FullTextIndexConfig<T = any> {
  /** Fields to index for full-text search */
  fields: Array<keyof T & string>
  /**
   * Field to use as document ID/key
   * If not specified, uses the collection's getKey function
   */
  idField?: string
  /** Enable stemming (language-dependent word normalization) */
  stemming?: boolean | string
  /** Custom stop words to filter out */
  stopWords?: Array<string> | boolean
  /** Custom tokenizer function */
  tokenize?: (text: string) => Array<string>
  /** Store original field values for highlighting */
  storeFields?: Array<keyof T & string>
}

/**
 * Generic interface that all full-text search adapters must implement.
 *
 * This allows users to bring their own search library while maintaining
 * a consistent API within TanStack DB.
 *
 * @template T - The document type
 * @template TKey - The document key type
 */
export interface FullTextSearchAdapter<T = any, TKey = string | number> {
  /**
   * Add a document to the search index
   */
  add: (key: TKey, document: T) => void

  /**
   * Remove a document from the search index
   */
  remove: (key: TKey) => void

  /**
   * Update a document in the search index
   */
  update: (key: TKey, document: T) => void

  /**
   * Build/rebuild the index from a collection of documents
   */
  build: (entries: Iterable<[TKey, T]>) => void

  /**
   * Clear all documents from the index
   */
  clear: () => void

  /**
   * Search for documents matching the query
   */
  search: (query: string, options?: SearchOptions) => Array<SearchResult<TKey>>

  /**
   * Get autocomplete suggestions for a partial query
   */
  suggest?: (prefix: string, options?: SuggestOptions) => Array<string>

  /**
   * Get the number of indexed documents
   */
  readonly size: number

  /**
   * Dispose of any resources (optional cleanup)
   */
  dispose?: () => void
}

/**
 * Factory function type for creating full-text search adapters
 */
export type FullTextSearchAdapterFactory<T = any, TKey = string | number> = (
  config: FullTextIndexConfig<T>,
) => FullTextSearchAdapter<T, TKey>
