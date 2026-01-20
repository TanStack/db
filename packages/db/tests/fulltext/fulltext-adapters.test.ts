import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFlexSearchAdapter,
  createMiniSearchAdapter,
  createOramaAdapter,
} from '../../src/fulltext/index.js'
import type { FullTextSearchAdapter } from '../../src/fulltext/types.js'

interface TestDocument {
  id: string
  title: string
  content: string
  tags?: Array<string>
}

const testDocuments: Array<[string, TestDocument]> = [
  [`1`, { id: `1`, title: `Introduction to TypeScript`, content: `TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.`, tags: [`programming`, `typescript`] }],
  [`2`, { id: `2`, title: `React Hooks Guide`, content: `React Hooks let you use state and other React features without writing a class.`, tags: [`programming`, `react`] }],
  [`3`, { id: `3`, title: `Node.js Fundamentals`, content: `Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine.`, tags: [`programming`, `nodejs`] }],
  [`4`, { id: `4`, title: `CSS Grid Layout`, content: `CSS Grid Layout is a two-dimensional grid-based layout system.`, tags: [`css`, `design`] }],
  [`5`, { id: `5`, title: `Database Design`, content: `Relational databases store data in tables with rows and columns.`, tags: [`database`, `sql`] }],
]

/**
 * Creates a mock Orama implementation for testing
 */
function createMockOrama() {
  const docs = new Map<string, any>()

  return {
    create: vi.fn(({ schema }: any) => {
      docs.clear()
      return { schema, docs }
    }),
    insert: vi.fn((db: any, doc: any) => {
      docs.set(doc.id, doc)
    }),
    remove: vi.fn((db: any, id: any) => {
      docs.delete(id)
    }),
    search: vi.fn((db: any, params: any) => {
      const term = params.term.toLowerCase()
      const results: Array<any> = []

      for (const [_id, doc] of docs) {
        const searchFields = params.properties || [`title`, `content`]
        let matches = false

        for (const field of searchFields) {
          if (doc[field] && doc[field].toLowerCase().includes(term)) {
            matches = true
            break
          }
        }

        if (matches) {
          results.push({ document: doc, id: doc.id, score: 1 })
        }
      }

      return { hits: results.slice(0, params.limit || 10) }
    }),
    _docs: docs,
  }
}

/**
 * Creates a mock MiniSearch class for testing
 */
function createMockMiniSearch() {
  return class MockMiniSearch {
    private docs = new Map<any, any>()
    private options: any

    constructor(options: any) {
      this.options = options
    }

    add(doc: any) {
      const id = doc[this.options.idField || `id`]
      this.docs.set(id, doc)
    }

    addAll(docs: Array<any>) {
      docs.forEach((doc) => this.add(doc))
    }

    remove(doc: any) {
      const id = doc[this.options.idField || `id`]
      this.docs.delete(id)
    }

    removeAll() {
      this.docs.clear()
    }

    search(query: string, options?: any): Array<{ id: any; score: number; match: Record<string, Array<string>> }> {
      const term = query.toLowerCase()
      const results: Array<{ id: any; score: number; match: Record<string, Array<string>> }> = []
      const searchFields = options?.fields || this.options.fields

      for (const [id, doc] of this.docs) {
        let matches = false
        const match: Record<string, Array<string>> = {}

        for (const field of searchFields) {
          if (doc[field] && doc[field].toLowerCase().includes(term)) {
            matches = true
            match[field] = [term]
          }
        }

        if (matches) {
          results.push({ id, score: 1, match })
        }
      }

      return results
    }

    autoSuggest(query: string, _options?: any): Array<{ suggestion: string; score: number }> {
      const words = new Set<string>()
      const prefix = query.toLowerCase()

      for (const [, doc] of this.docs) {
        for (const field of this.options.fields) {
          if (doc[field]) {
            const fieldWords = doc[field].toLowerCase().split(/\W+/)
            for (const word of fieldWords) {
              if (word.startsWith(prefix)) {
                words.add(word)
              }
            }
          }
        }
      }

      return Array.from(words).map((w) => ({ suggestion: w, score: 1 }))
    }

    get documentCount() {
      return this.docs.size
    }
  }
}

/**
 * Creates a mock FlexSearch Document class for testing
 */
function createMockFlexSearchDocument() {
  return class MockFlexSearchDocument {
    private docs = new Map<any, any>()
    private options: any

    constructor(options: any) {
      this.options = options
    }

    add(doc: any) {
      const id = doc[this.options.document.id || `id`]
      this.docs.set(id, doc)
    }

    update(doc: any) {
      this.add(doc)
    }

    remove(id: any) {
      this.docs.delete(id)
    }

    search(query: string, options?: any): Array<{ field: string; result: Array<any> }> {
      const term = query.toLowerCase()
      const results: Array<{ field: string; result: Array<any> }> = []
      const searchFields = options?.field || this.options.document.index

      for (const field of searchFields) {
        const fieldResults: Array<any> = []

        for (const [id, doc] of this.docs) {
          if (doc[field] && doc[field].toLowerCase().includes(term)) {
            fieldResults.push(id)
          }
        }

        if (fieldResults.length > 0) {
          results.push({ field, result: fieldResults })
        }
      }

      return results
    }
  }
}

describe(`Full-Text Search Adapters`, () => {
  describe(`Common Interface Compliance`, () => {
    const adapterFactories: Array<{
      name: string
      create: () => FullTextSearchAdapter<TestDocument, string>
    }> = [
      {
        name: `Orama`,
        create: () => createOramaAdapter(createMockOrama(), { fields: [`title`, `content`] }),
      },
      {
        name: `MiniSearch`,
        create: () => createMiniSearchAdapter(createMockMiniSearch(), { fields: [`title`, `content`] }),
      },
      {
        name: `FlexSearch`,
        create: () => createFlexSearchAdapter(createMockFlexSearchDocument(), { fields: [`title`, `content`] }),
      },
    ]

    for (const { name, create } of adapterFactories) {
      describe(`${name} Adapter`, () => {
        let adapter: FullTextSearchAdapter<TestDocument, string>

        beforeEach(() => {
          adapter = create()
        })

        it(`should implement add() method`, () => {
          expect(typeof adapter.add).toBe(`function`)
          adapter.add(`1`, testDocuments[0]![1])
          expect(adapter.size).toBe(1)
        })

        it(`should implement remove() method`, () => {
          expect(typeof adapter.remove).toBe(`function`)
          adapter.add(`1`, testDocuments[0]![1])
          adapter.remove(`1`)
          expect(adapter.size).toBe(0)
        })

        it(`should implement update() method`, () => {
          expect(typeof adapter.update).toBe(`function`)
          adapter.add(`1`, testDocuments[0]![1])
          adapter.update(`1`, { ...testDocuments[0]![1], title: `Updated Title` })
          expect(adapter.size).toBe(1)
        })

        it(`should implement build() method`, () => {
          expect(typeof adapter.build).toBe(`function`)
          adapter.build(testDocuments)
          expect(adapter.size).toBe(5)
        })

        it(`should implement clear() method`, () => {
          expect(typeof adapter.clear).toBe(`function`)
          adapter.build(testDocuments)
          expect(adapter.size).toBe(5)
          adapter.clear()
          expect(adapter.size).toBe(0)
        })

        it(`should implement search() method`, () => {
          expect(typeof adapter.search).toBe(`function`)
          adapter.build(testDocuments)
          const results = adapter.search(`typescript`)
          expect(Array.isArray(results)).toBe(true)
          expect(results.length).toBeGreaterThan(0)
          expect(results[0]).toHaveProperty(`key`)
          expect(results[0]).toHaveProperty(`score`)
        })

        it(`should implement size getter`, () => {
          expect(typeof adapter.size).toBe(`number`)
          expect(adapter.size).toBe(0)
          adapter.build(testDocuments)
          expect(adapter.size).toBe(5)
        })

        it(`should return results with correct structure`, () => {
          adapter.build(testDocuments)
          const results = adapter.search(`javascript`)

          for (const result of results) {
            expect(result).toHaveProperty(`key`)
            expect(result).toHaveProperty(`score`)
            expect(typeof result.key).toBe(`string`)
            expect(typeof result.score).toBe(`number`)
          }
        })

        it(`should search across multiple documents`, () => {
          adapter.build(testDocuments)
          const results = adapter.search(`javascript`)
          // Should find TypeScript doc (mentions JavaScript) and Node.js doc (mentions JavaScript)
          expect(results.length).toBeGreaterThanOrEqual(1)
        })

        it(`should handle limit option`, () => {
          adapter.build(testDocuments)
          const results = adapter.search(`programming`, { limit: 2 })
          expect(results.length).toBeLessThanOrEqual(2)
        })

        it(`should handle empty search query`, () => {
          adapter.build(testDocuments)
          const results = adapter.search(``)
          expect(Array.isArray(results)).toBe(true)
        })

        it(`should handle search with no matches`, () => {
          adapter.build(testDocuments)
          const results = adapter.search(`xyznonexistent123`)
          expect(results.length).toBe(0)
        })

        it(`should properly track document count after operations`, () => {
          expect(adapter.size).toBe(0)

          adapter.add(`1`, testDocuments[0]![1])
          expect(adapter.size).toBe(1)

          adapter.add(`2`, testDocuments[1]![1])
          expect(adapter.size).toBe(2)

          adapter.remove(`1`)
          expect(adapter.size).toBe(1)

          adapter.clear()
          expect(adapter.size).toBe(0)
        })
      })
    }
  })

  describe(`Orama Adapter Specifics`, () => {
    it(`should use tolerance option for fuzzy search`, () => {
      const mockOrama = createMockOrama()
      const adapter = createOramaAdapter(mockOrama, {
        fields: [`title`, `content`],
        tolerance: 2,
      })

      adapter.build(testDocuments)
      adapter.search(`typescrit`, { fuzzy: true }) // typo

      expect(mockOrama.search).toHaveBeenCalled()
      const searchCall = mockOrama.search.mock.calls[0]
      expect(searchCall[1].tolerance).toBe(2)
    })

    it(`should pass boost options to search`, () => {
      const mockOrama = createMockOrama()
      const adapter = createOramaAdapter(mockOrama, { fields: [`title`, `content`] })

      adapter.build(testDocuments)
      adapter.search(`typescript`, { boost: { title: 2 } })

      expect(mockOrama.search).toHaveBeenCalled()
      const searchCall = mockOrama.search.mock.calls[0]
      expect(searchCall[1].boost).toEqual({ title: 2 })
    })
  })

  describe(`MiniSearch Adapter Specifics`, () => {
    it(`should implement suggest() method`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.build(testDocuments)

      expect(adapter.suggest).toBeDefined()
      const suggestions = adapter.suggest!(`type`)
      expect(Array.isArray(suggestions)).toBe(true)
    })

    it(`should return highlights in search results`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.build(testDocuments)
      const results = adapter.search(`typescript`)

      // MiniSearch adapter should include highlights
      if (results.length > 0) {
        expect(results[0]).toHaveProperty(`highlights`)
      }
    })

    it(`should support field-specific search`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.build(testDocuments)

      // Search only in title field
      const titleResults = adapter.search(`introduction`, { fields: [`title`] })
      expect(titleResults.length).toBeGreaterThan(0)
    })
  })

  describe(`FlexSearch Adapter Specifics`, () => {
    it(`should handle preset option`, () => {
      const MockDocument = createMockFlexSearchDocument()
      const adapter = createFlexSearchAdapter(MockDocument, {
        fields: [`title`, `content`],
        preset: `performance`,
      })

      // Should not throw
      adapter.build(testDocuments)
      expect(adapter.size).toBe(5)
    })

    it(`should handle update() correctly`, () => {
      const MockDocument = createMockFlexSearchDocument()
      const adapter = createFlexSearchAdapter(MockDocument, { fields: [`title`, `content`] })

      adapter.add(`1`, testDocuments[0]![1])
      expect(adapter.size).toBe(1)

      // Update should not increase count
      adapter.update(`1`, { ...testDocuments[0]![1], title: `Updated` })
      expect(adapter.size).toBe(1)

      // Update with new key should increase count
      adapter.update(`new-key`, testDocuments[1]![1])
      expect(adapter.size).toBe(2)
    })
  })

  describe(`Edge Cases`, () => {
    it(`should handle documents with missing indexed fields`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`, `missing`] })

      // Should not throw when adding document without all fields
      adapter.add(`1`, { id: `1`, title: `Test`, content: `Content` } as any)
      expect(adapter.size).toBe(1)
    })

    it(`should handle null and undefined values`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      const docWithNull = { id: `1`, title: null, content: `Valid content` } as any
      const docWithUndefined = { id: `2`, title: undefined, content: `Another content` } as any

      // Should not throw
      adapter.add(`1`, docWithNull)
      adapter.add(`2`, docWithUndefined)
      expect(adapter.size).toBe(2)
    })

    it(`should handle special characters in search queries`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.build(testDocuments)

      // Should not throw
      const results = adapter.search(`C++ & JavaScript`)
      expect(Array.isArray(results)).toBe(true)
    })

    it(`should handle concurrent add and remove operations`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      // Add multiple
      adapter.add(`1`, testDocuments[0]![1])
      adapter.add(`2`, testDocuments[1]![1])
      adapter.add(`3`, testDocuments[2]![1])

      // Remove in middle
      adapter.remove(`2`)

      expect(adapter.size).toBe(2)

      // Search should still work
      const results = adapter.search(`typescript`)
      expect(Array.isArray(results)).toBe(true)
    })

    it(`should handle removing non-existent document`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.add(`1`, testDocuments[0]![1])

      // Should not throw when removing non-existent
      adapter.remove(`non-existent`)
      expect(adapter.size).toBe(1)
    })

    it(`should handle search with offset and limit`, () => {
      const MockMiniSearch = createMockMiniSearch()
      const adapter = createMiniSearchAdapter(MockMiniSearch, { fields: [`title`, `content`] })

      adapter.build(testDocuments)

      const allResults = adapter.search(`javascript`)
      const paginatedResults = adapter.search(`javascript`, { offset: 1, limit: 1 })

      expect(paginatedResults.length).toBeLessThanOrEqual(1)

      // If we have more than 1 result, paginated should skip the first
      if (allResults.length > 1) {
        expect(paginatedResults[0]?.key).not.toBe(allResults[0]?.key)
      }
    })
  })
})
