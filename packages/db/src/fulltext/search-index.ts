/**
 * SearchIndex - A reactive full-text search index attached to a collection.
 *
 * The SearchIndex wraps a FullTextSearchAdapter and keeps it in sync with
 * a collection's state. It provides `liveSearch()` for reactive search
 * results that update when the collection changes.
 */

import type { Collection } from '../collection/index.js'
import type { ChangeMessage } from '../types.js'
import type {
  FullTextSearchAdapter,
  SearchOptions,
  SearchResult,
} from './types.js'

/**
 * Options for creating a live search
 */
export interface LiveSearchOptions extends SearchOptions {
  /** Include the full document in results (default: false, just keys + scores) */
  includeDocument?: boolean
}

/**
 * A single live search result
 */
export interface LiveSearchResult<T, TKey> extends SearchResult<TKey> {
  /** The full document (if includeDocument was true) */
  document?: T
}

/**
 * A live search subscription that updates when results change
 */
export interface LiveSearch<T, TKey> {
  /** Current search results, ordered by relevance */
  readonly results: ReadonlyArray<LiveSearchResult<T, TKey>>

  /** Just the keys, ordered by relevance */
  readonly keys: ReadonlyArray<TKey>

  /** Number of results */
  readonly size: number

  /** Subscribe to result changes */
  subscribe: (callback: (results: ReadonlyArray<LiveSearchResult<T, TKey>>) => void) => () => void

  /** Update the search query */
  setQuery: (query: string) => void

  /** Dispose of the subscription */
  dispose: () => void
}

/**
 * SearchIndex wraps a FullTextSearchAdapter and keeps it synced with a collection.
 */
export class SearchIndex<T extends object, TKey extends string | number = string> {
  private adapter: FullTextSearchAdapter<T, TKey>
  private collection: Collection<T, TKey, any, any, any>
  private unsubscribe: (() => void) | null = null
  private isBuilt = false

  constructor(
    adapter: FullTextSearchAdapter<T, TKey>,
    collection: Collection<T, TKey, any, any, any>,
  ) {
    this.adapter = adapter
    this.collection = collection
  }

  /**
   * Start syncing the index with the collection.
   * Called automatically when creating a live search.
   */
  startSync(): void {
    if (this.unsubscribe) return

    // Build initial index from current collection state
    if (!this.isBuilt) {
      this.adapter.build(this.collection.state.entries())
      this.isBuilt = true
    }

    // Subscribe to collection changes
    const subscription = this.collection.subscribeChanges(
      (changes) => this.handleChanges(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: false },
    )

    this.unsubscribe = () => subscription.unsubscribe()
  }

  /**
   * Stop syncing the index with the collection.
   */
  stopSync(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  /**
   * Handle collection changes by updating the search index.
   */
  private handleChanges(changes: Array<ChangeMessage<T, TKey>>): void {
    for (const change of changes) {
      switch (change.type) {
        case `insert`:
          this.adapter.add(change.key, change.value)
          break
        case `update`:
          this.adapter.update(change.key, change.value)
          break
        case `delete`:
          this.adapter.remove(change.key)
          break
      }
    }
  }

  /**
   * Perform a one-time search (not reactive).
   */
  search(query: string, options?: SearchOptions): Array<SearchResult<TKey>> {
    // Ensure index is built
    if (!this.isBuilt) {
      this.adapter.build(this.collection.state.entries())
      this.isBuilt = true
    }
    return this.adapter.search(query, options)
  }

  /**
   * Create a live search that updates when results change.
   *
   * @example
   * ```typescript
   * const liveResults = searchIndex.liveSearch('react hooks', { limit: 10 })
   *
   * // Access current results
   * console.log(liveResults.results)
   *
   * // Subscribe to changes
   * const unsubscribe = liveResults.subscribe((results) => {
   *   console.log('Results updated:', results)
   * })
   *
   * // Clean up
   * liveResults.dispose()
   * ```
   */
  liveSearch(query: string, options: LiveSearchOptions = {}): LiveSearch<T, TKey> {
    const { limit, includeDocument = false, ...searchOptions } = options

    // Ensure sync is started
    this.startSync()

    let currentQuery = query
    let currentResults: Array<LiveSearchResult<T, TKey>> = []
    const subscribers = new Set<(results: ReadonlyArray<LiveSearchResult<T, TKey>>) => void>()

    // Run search and update results
    const runSearch = () => {
      const searchResults = this.adapter.search(currentQuery, { limit, ...searchOptions })

      currentResults = searchResults.map((result) => {
        const liveResult: LiveSearchResult<T, TKey> = {
          key: result.key,
          score: result.score,
          highlights: result.highlights,
        }

        if (includeDocument) {
          liveResult.document = this.collection.get(result.key)
        }

        return liveResult
      })

      // Notify subscribers
      for (const callback of subscribers) {
        callback(currentResults)
      }
    }

    // Initial search
    runSearch()

    // Subscribe to collection changes
    const collectionSubscription = this.collection.subscribeChanges(
      (changes) => {
        // Update index first
        this.handleChanges(changes as Array<ChangeMessage<T, TKey>>)

        // Re-run search
        // TODO: Could optimize by checking if changes affect current results
        runSearch()
      },
      { includeInitialState: false },
    )

    return {
      get results() {
        return currentResults
      },

      get keys() {
        return currentResults.map((r) => r.key)
      },

      get size() {
        return currentResults.length
      },

      subscribe(callback) {
        subscribers.add(callback)
        // Immediately call with current results
        callback(currentResults)
        return () => subscribers.delete(callback)
      },

      setQuery(newQuery: string) {
        currentQuery = newQuery
        runSearch()
      },

      dispose() {
        collectionSubscription.unsubscribe()
        subscribers.clear()
      },
    }
  }

  /**
   * Get autocomplete suggestions.
   */
  suggest(prefix: string, options?: { limit?: number }): Array<string> {
    if (!this.adapter.suggest) {
      return []
    }
    return this.adapter.suggest(prefix, options)
  }

  /**
   * Number of indexed documents.
   */
  get size(): number {
    return this.adapter.size
  }

  /**
   * Dispose of the search index.
   */
  dispose(): void {
    this.stopSync()
    if (this.adapter.dispose) {
      this.adapter.dispose()
    }
  }
}

/**
 * Create a SearchIndex attached to a collection.
 *
 * @example
 * ```typescript
 * import MiniSearch from 'minisearch'
 * import { createSearchIndex, createMiniSearchAdapter } from '@tanstack/db/fulltext'
 *
 * const searchIndex = createSearchIndex(
 *   collection,
 *   createMiniSearchAdapter(MiniSearch, { fields: ['title', 'content'] })
 * )
 *
 * // One-time search
 * const results = searchIndex.search('react', { limit: 10 })
 *
 * // Live search
 * const liveResults = searchIndex.liveSearch('react', { limit: 10 })
 * ```
 */
export function createSearchIndex<T extends object, TKey extends string | number = string>(
  collection: Collection<T, TKey, any, any, any>,
  adapter: FullTextSearchAdapter<T, TKey>,
): SearchIndex<T, TKey> {
  return new SearchIndex(adapter, collection)
}
