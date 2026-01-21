import { describe, expect, it, vi } from 'vitest'
import mitt from 'mitt'
import { createCollection } from '../../src/collection/index.js'
import { createSearchIndex } from '../../src/fulltext/search-index.js'
import type {Emitter} from 'mitt';
import type { FullTextSearchAdapter, SearchResult } from '../../src/fulltext/types.js'
import type { Collection } from '../../src/collection/index.js'

interface TestDocument {
  id: string
  title: string
  content: string
  category?: string
}

type SyncEvents = {
  sync: Array<{ type: `insert` | `update` | `delete`; value?: TestDocument; key?: string }>
}

/**
 * Creates a mock search adapter that does simple substring matching
 */
function createMockAdapter(): FullTextSearchAdapter<TestDocument, string> {
  const docs = new Map<string, TestDocument>()

  return {
    add(key: string, document: TestDocument): void {
      docs.set(key, document)
    },

    remove(key: string): void {
      docs.delete(key)
    },

    update(key: string, document: TestDocument): void {
      docs.set(key, document)
    },

    build(entries: Iterable<[string, TestDocument]>): void {
      docs.clear()
      for (const [key, doc] of entries) {
        docs.set(key, doc)
      }
    },

    clear(): void {
      docs.clear()
    },

    search(query: string, options?: { limit?: number }): Array<SearchResult<string>> {
      const term = query.toLowerCase()
      const results: Array<SearchResult<string>> = []

      for (const [key, doc] of docs) {
        const titleMatch = doc.title.toLowerCase().includes(term)
        const contentMatch = doc.content.toLowerCase().includes(term)

        if (titleMatch || contentMatch) {
          // Simple scoring: title matches score higher
          const score = (titleMatch ? 2 : 0) + (contentMatch ? 1 : 0)
          results.push({ key, score })
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score)

      if (options?.limit) {
        return results.slice(0, options.limit)
      }

      return results
    },

    get size(): number {
      return docs.size
    },
  }
}

/**
 * Helper to create a test collection with initial data and an emitter for changes
 */
function createTestCollectionWithEmitter(initialData: Array<TestDocument> = []): {
  collection: Collection<TestDocument, string, any, any, any>
  emitter: Emitter<SyncEvents>
} {
  const emitter = mitt<SyncEvents>()

  const collection = createCollection<TestDocument, string>({
    getKey: (item) => item.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        // Set up emitter listener for future changes
        emitter.on(`sync`, (changes) => {
          begin()
          for (const change of changes) {
            if (change.type === `delete`) {
              write({ type: `delete`, key: change.key! })
            } else {
              write({ type: change.type, value: change.value! })
            }
          }
          commit()
        })

        // Write initial data
        begin()
        for (const item of initialData) {
          write({ type: `insert`, value: item })
        }
        commit()
        markReady()
      },
    },
  })

  return { collection, emitter }
}

/**
 * Helper to create a test collection with initial data (no emitter needed)
 */
function createTestCollection(initialData: Array<TestDocument> = []): Collection<TestDocument, string, any, any, any> {
  return createTestCollectionWithEmitter(initialData).collection
}

describe(`SearchIndex`, () => {
  const testDocs: Array<TestDocument> = [
    { id: `1`, title: `Introduction to React`, content: `React is a JavaScript library for building user interfaces.`, category: `frontend` },
    { id: `2`, title: `TypeScript Basics`, content: `TypeScript adds static typing to JavaScript.`, category: `language` },
    { id: `3`, title: `Node.js Guide`, content: `Node.js is a JavaScript runtime for server-side applications.`, category: `backend` },
    { id: `4`, title: `React Hooks`, content: `Hooks let you use state and other React features in functional components.`, category: `frontend` },
    { id: `5`, title: `CSS Grid Layout`, content: `CSS Grid is a two-dimensional layout system.`, category: `frontend` },
  ]

  describe(`Basic Search`, () => {
    it(`should search documents after building index`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const results = searchIndex.search(`react`)

      expect(results.length).toBe(2)
      expect(results[0]!.key).toBe(`1`) // "Introduction to React" - title match
      expect(results[1]!.key).toBe(`4`) // "React Hooks" - title match
    })

    it(`should respect limit option`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const results = searchIndex.search(`javascript`, { limit: 2 })

      expect(results.length).toBe(2)
    })

    it(`should return empty array for no matches`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const results = searchIndex.search(`python`)

      expect(results.length).toBe(0)
    })
  })

  describe(`Collection Sync`, () => {
    it(`should update index when documents are inserted`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      // Start sync
      searchIndex.startSync()

      // Initial search
      let results = searchIndex.search(`vue`)
      expect(results.length).toBe(0)

      // Insert new document via emitter
      emitter.emit(`sync`, [
        { type: `insert`, value: { id: `6`, title: `Vue.js Tutorial`, content: `Vue is a progressive JavaScript framework.`, category: `frontend` } },
      ])

      // Search should now find the new document
      results = searchIndex.search(`vue`)
      expect(results.length).toBe(1)
      expect(results[0]!.key).toBe(`6`)

      searchIndex.dispose()
    })

    it(`should update index when documents are updated`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)
      searchIndex.startSync()

      // Initial search for "angular"
      let results = searchIndex.search(`angular`)
      expect(results.length).toBe(0)

      // Update document to mention Angular
      emitter.emit(`sync`, [
        { type: `update`, value: { id: `1`, title: `Introduction to Angular`, content: `Angular is a TypeScript-based framework.`, category: `frontend` } },
      ])

      // Search should now find the updated document
      results = searchIndex.search(`angular`)
      expect(results.length).toBe(1)
      expect(results[0]!.key).toBe(`1`)

      // Old content should not match
      results = searchIndex.search(`react`)
      expect(results.find((r) => r.key === `1`)).toBeUndefined()

      searchIndex.dispose()
    })

    it(`should update index when documents are deleted`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)
      searchIndex.startSync()

      // Initial search
      let results = searchIndex.search(`react`)
      expect(results.length).toBe(2)

      // Delete one of the React documents
      emitter.emit(`sync`, [{ type: `delete`, key: `1` }])

      // Search should now find only one document
      results = searchIndex.search(`react`)
      expect(results.length).toBe(1)
      expect(results[0]!.key).toBe(`4`)

      searchIndex.dispose()
    })
  })

  describe(`Live Search`, () => {
    it(`should return initial results`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })

      expect(liveSearch.size).toBe(2)
      expect(liveSearch.keys).toEqual([`1`, `4`])

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should update when collection changes`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })

      expect(liveSearch.size).toBe(2)

      // Insert new React document
      emitter.emit(`sync`, [
        { type: `insert`, value: { id: `6`, title: `Advanced React Patterns`, content: `Learn advanced patterns in React.`, category: `frontend` } },
      ])

      // Results should update
      expect(liveSearch.size).toBe(3)
      expect(liveSearch.keys).toContain(`6`)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should notify subscribers on changes`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })
      const callbacks: Array<number> = []

      const unsubscribe = liveSearch.subscribe((results) => {
        callbacks.push(results.length)
      })

      // Initial callback
      expect(callbacks).toEqual([2])

      // Insert new document
      emitter.emit(`sync`, [
        { type: `insert`, value: { id: `6`, title: `React Testing`, content: `Testing React components.`, category: `frontend` } },
      ])

      // Should have been called again
      expect(callbacks).toEqual([2, 3])

      unsubscribe()
      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should respect limit`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`javascript`, { limit: 2 })

      // Should only return 2 results even though 3 match
      expect(liveSearch.size).toBeLessThanOrEqual(2)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should allow changing the query`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })

      expect(liveSearch.size).toBe(2)

      // Change query
      liveSearch.setQuery(`typescript`)

      expect(liveSearch.size).toBe(1)
      expect(liveSearch.keys).toEqual([`2`])

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should include documents when requested`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, {
        limit: 10,
        includeDocument: true,
      })

      expect(liveSearch.results[0]!.document).toBeDefined()
      expect(liveSearch.results[0]!.document!.title).toBe(`Introduction to React`)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should handle document deletion from results`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })

      expect(liveSearch.size).toBe(2)
      expect(liveSearch.keys).toContain(`1`)

      // Delete document that's in results
      emitter.emit(`sync`, [{ type: `delete`, key: `1` }])

      // Results should update
      expect(liveSearch.size).toBe(1)
      expect(liveSearch.keys).not.toContain(`1`)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should handle document update that removes it from results`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })

      expect(liveSearch.size).toBe(2)
      expect(liveSearch.keys).toContain(`1`)

      // Update document to no longer match
      emitter.emit(`sync`, [
        { type: `update`, value: { id: `1`, title: `Introduction to Vue`, content: `Vue is a progressive framework.`, category: `frontend` } },
      ])

      // Results should update
      expect(liveSearch.size).toBe(1)
      expect(liveSearch.keys).not.toContain(`1`)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should handle document update that adds it to results`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`grid`, { limit: 10 })

      expect(liveSearch.size).toBe(1)
      expect(liveSearch.keys).toEqual([`5`])

      // Update another document to match
      emitter.emit(`sync`, [
        { type: `update`, value: { id: `2`, title: `CSS Grid Tutorial`, content: `Learn CSS Grid layout.`, category: `frontend` } },
      ])

      // Results should update
      expect(liveSearch.size).toBe(2)
      expect(liveSearch.keys).toContain(`2`)

      liveSearch.dispose()
      searchIndex.dispose()
    })
  })

  describe(`Multiple Live Searches`, () => {
    it(`should support multiple simultaneous live searches`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const reactSearch = searchIndex.liveSearch(`react`, { limit: 10 })
      const jsSearch = searchIndex.liveSearch(`javascript`, { limit: 10 })

      expect(reactSearch.size).toBe(2)
      expect(jsSearch.size).toBe(3)

      // Insert document that matches both
      emitter.emit(`sync`, [
        { type: `insert`, value: { id: `6`, title: `React and JavaScript`, content: `Building apps with React and JavaScript.`, category: `frontend` } },
      ])

      // Both should update
      expect(reactSearch.size).toBe(3)
      expect(jsSearch.size).toBe(4)

      reactSearch.dispose()
      jsSearch.dispose()
      searchIndex.dispose()
    })
  })

  describe(`Edge Cases`, () => {
    it(`should handle empty collection`, async () => {
      const collection = createTestCollection([])
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const results = searchIndex.search(`anything`)
      expect(results.length).toBe(0)

      const liveSearch = searchIndex.liveSearch(`anything`, { limit: 10 })
      expect(liveSearch.size).toBe(0)

      liveSearch.dispose()
      searchIndex.dispose()
    })

    it(`should handle empty query`, async () => {
      const collection = createTestCollection(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const results = searchIndex.search(``)
      // Empty query behavior depends on adapter - mock returns nothing
      expect(Array.isArray(results)).toBe(true)

      searchIndex.dispose()
    })

    it(`should properly dispose and stop updates`, async () => {
      const { collection, emitter } = createTestCollectionWithEmitter(testDocs)
      await collection.stateWhenReady()

      const adapter = createMockAdapter()
      const searchIndex = createSearchIndex(collection, adapter)

      const liveSearch = searchIndex.liveSearch(`react`, { limit: 10 })
      const callback = vi.fn()

      liveSearch.subscribe(callback)
      expect(callback).toHaveBeenCalledTimes(1)

      // Dispose
      liveSearch.dispose()

      // Insert new document
      emitter.emit(`sync`, [
        { type: `insert`, value: { id: `6`, title: `More React`, content: `More React content.`, category: `frontend` } },
      ])

      // Callback should not have been called again
      expect(callback).toHaveBeenCalledTimes(1)

      searchIndex.dispose()
    })
  })
})
