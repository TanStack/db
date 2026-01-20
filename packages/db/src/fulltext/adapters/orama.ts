/**
 * Orama Adapter for TanStack DB Full-Text Search
 *
 * @see https://github.com/oramasearch/orama
 *
 * Orama is a fast, batteries-included full-text search engine
 * written in TypeScript with ~2KB bundle size.
 *
 * Installation:
 *   npm install @orama/orama
 */

import type {
  FullTextIndexConfig,
  FullTextSearchAdapter,
  SearchOptions,
  SearchResult,
} from '../types.js'

/**
 * Extended config options specific to Orama
 */
export interface OramaAdapterConfig<T = any> extends FullTextIndexConfig<T> {
  /** Orama-specific: language for stemming (default: 'english') */
  language?: string
  /** Orama-specific: enable typo tolerance */
  tolerance?: number
}

/**
 * Creates an Orama-based full-text search adapter.
 *
 * @example
 * ```typescript
 * import { create, insert, remove, search } from '@orama/orama'
 * import { createOramaAdapter } from '@tanstack/db/fulltext'
 *
 * const adapter = createOramaAdapter(
 *   { create, insert, remove, search },
 *   { fields: ['title', 'content'] }
 * )
 *
 * collection.createFullTextIndex(adapter)
 * ```
 */
export function createOramaAdapter<T = any, TKey extends string | number = string>(
  orama: {
    create: (config: any) => any
    insert: (db: any, doc: any) => any
    remove: (db: any, id: any) => any
    search: (db: any, params: any) => any
  },
  config: OramaAdapterConfig<T>,
): FullTextSearchAdapter<T, TKey> {
  const { fields, idField = `id`, language = `english`, tolerance = 1 } = config

  // Build Orama schema
  const schema: Record<string, string> = {
    [idField]: `string`,
  }
  for (const field of fields) {
    schema[field] = `string`
  }

  let db = orama.create({ schema, language })
  let docCount = 0
  const keyToId = new Map<TKey, string>()

  return {
    add(key: TKey, document: T): void {
      const id = String(key)
      const doc: Record<string, any> = { [idField]: id }

      for (const field of fields) {
        const value = (document as any)[field]
        if (value !== undefined && value !== null) {
          doc[field] = String(value)
        }
      }

      orama.insert(db, doc)
      keyToId.set(key, id)
      docCount++
    },

    remove(key: TKey): void {
      const id = keyToId.get(key)
      if (id) {
        orama.remove(db, id)
        keyToId.delete(key)
        docCount--
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
      db = orama.create({ schema, language })
      keyToId.clear()
      docCount = 0
    },

    search(query: string, options: SearchOptions = {}): Array<SearchResult<TKey>> {
      const { limit = 10, offset = 0, fields: searchFields, fuzzy, boost } = options

      const searchParams: any = {
        term: query,
        limit: limit + offset,
        tolerance: fuzzy === true ? tolerance : fuzzy === false ? 0 : (fuzzy ?? tolerance),
      }

      if (searchFields && searchFields.length > 0) {
        searchParams.properties = searchFields
      }

      if (boost) {
        searchParams.boost = boost
      }

      const results = orama.search(db, searchParams)

      return (results.hits || [])
        .slice(offset, offset + limit)
        .map((hit: any) => ({
          key: (hit.document?.[idField] ?? hit.id) as TKey,
          score: hit.score ?? 1,
        }))
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
 * Creates a factory function for Orama adapters.
 * Useful when you want to defer Orama import.
 *
 * @example
 * ```typescript
 * const oramaFactory = createOramaAdapterFactory(
 *   () => import('@orama/orama')
 * )
 *
 * const adapter = await oramaFactory({ fields: ['title', 'content'] })
 * ```
 */
export function createOramaAdapterFactory<T = any, TKey extends string | number = string>(
  importOrama: () => Promise<{
    create: (config: any) => any
    insert: (db: any, doc: any) => any
    remove: (db: any, id: any) => any
    search: (db: any, params: any) => any
  }>,
): (config: OramaAdapterConfig<T>) => Promise<FullTextSearchAdapter<T, TKey>> {
  return async (config) => {
    const orama = await importOrama()
    return createOramaAdapter<T, TKey>(orama, config)
  }
}
