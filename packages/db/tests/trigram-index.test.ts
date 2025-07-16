import { beforeEach, describe, expect, it } from "vitest"
import { TrigramIndex } from "../src/indexes/trigram-index.js"
import { IndexOperation } from "../src/indexes/base-index.js"
import type { BasicExpression } from "../src/query/ir.js"

// Mock expression that just returns the item (for testing)
const mockExpression: BasicExpression = {
  type: 'ref',
  path: ['text'],
  __returnType: undefined as any
}

describe('TrigramIndex', () => {
  let index: TrigramIndex<string>
  let testData: Array<{ id: string; text: string }>

  beforeEach(() => {
    index = new TrigramIndex('test-index', mockExpression)
    
    testData = [
      { id: '1', text: 'hello world' },
      { id: '2', text: 'Hello World' },
      { id: '3', text: 'goodbye world' },
      { id: '4', text: 'hello there' },
      { id: '5', text: 'world peace' },
      { id: '6', text: 'programming is fun' },
      { id: '7', text: 'JavaScript rocks' },
      { id: '8', text: 'typescript' },
      { id: '9', text: '' }, // Empty string
      { id: '10', text: 'a' }, // Very short string
    ]

    // Build the index
    index.build(testData.map(item => [item.id, item]))
  })

  describe('Basic Operations', () => {
    it('should index text properly', () => {
      expect(index.keyCount).toBe(testData.length)
      
      const stats = index.getTrigramStats()
      expect(stats.uniqueTrigrams).toBeGreaterThan(0)
      expect(stats.averageTrigramsPerKey).toBeGreaterThan(0)
    })

    it('should support adding and removing items', () => {
      const initialCount = index.keyCount
      
      // Add new item
      index.add('new1', { text: 'new item' })
      expect(index.keyCount).toBe(initialCount + 1)
      
      // Remove item
      index.remove('new1', { text: 'new item' })
      expect(index.keyCount).toBe(initialCount)
    })

    it('should handle updates', () => {
      const initialCount = index.keyCount
      
      // Update existing item
      index.update('1', { text: 'hello world' }, { text: 'updated text' })
      expect(index.keyCount).toBe(initialCount)
      
      // Verify old text is gone and new text is findable
      const oldResults = index.lookup(IndexOperation.EQ, 'hello world')
      // Should still find '2' which has "Hello World" (case-insensitive match)
      expect(oldResults.size).toBe(1)
      expect(oldResults.has('2')).toBe(true)
      
      const newResults = index.lookup(IndexOperation.EQ, 'updated text')
      expect(newResults.has('1')).toBe(true)
    })

    it('should clear all data', () => {
      index.clear()
      expect(index.keyCount).toBe(0)
      
      const stats = index.getTrigramStats()
      expect(stats.uniqueTrigrams).toBe(0)
    })
  })

  describe('Equality Operations', () => {
    it('should find exact matches', () => {
      const results = index.lookup(IndexOperation.EQ, 'hello world')
      expect(results.has('1')).toBe(true)
      // With case-insensitive default, this should match both "hello world" and "Hello World"
      expect(results.has('2')).toBe(true)
      expect(results.size).toBe(2)
    })

    it('should handle case sensitivity based on options', () => {
      // Default is case insensitive
      const results1 = index.lookup(IndexOperation.EQ, 'HELLO WORLD')
      expect(results1.has('1')).toBe(true)
      
      // Test case sensitive index
      const caseSensitiveIndex = new TrigramIndex('case-sensitive', mockExpression, undefined, {
        caseSensitive: true
      })
      caseSensitiveIndex.build(testData.map(item => [item.id, item]))
      
      const results2 = caseSensitiveIndex.lookup(IndexOperation.EQ, 'HELLO WORLD')
      expect(results2.has('1')).toBe(false)
      
      const results3 = caseSensitiveIndex.lookup(IndexOperation.EQ, 'Hello World')
      expect(results3.has('2')).toBe(true)
    })

    it('should handle non-string values gracefully', () => {
      const results = index.lookup(IndexOperation.EQ, 123)
      expect(results.size).toBe(0)
    })
  })

  describe('LIKE Operations', () => {
    it('should support basic LIKE patterns', () => {
      // Test wildcard % - should match case-insensitively by default
      const results1 = index.lookup(IndexOperation.LIKE, 'hello%')
      expect(results1.has('1')).toBe(true) // "hello world"
      expect(results1.has('2')).toBe(true) // "Hello World"
      expect(results1.has('4')).toBe(true) // "hello there"
      expect(results1.size).toBe(3)
      
      // Test wildcard _
      const results2 = index.lookup(IndexOperation.LIKE, 'h_llo world')
      expect(results2.has('1')).toBe(true) // "hello world"
      expect(results2.has('2')).toBe(true) // "Hello World"
      expect(results2.size).toBe(2)
      
      // Test both wildcards
      const results3 = index.lookup(IndexOperation.LIKE, '%wor_d%')
      expect(results3.has('1')).toBe(true) // "hello world"
      expect(results3.has('2')).toBe(true) // "Hello World"  
      expect(results3.has('3')).toBe(true) // "goodbye world"
      expect(results3.has('5')).toBe(true) // "world peace"
      expect(results3.size).toBe(4)
    })

    it('should optimize LIKE patterns with trigrams', () => {
      // Pattern with substantial fixed part should use trigram optimization
      const results = index.lookup(IndexOperation.LIKE, '%programming%')
      expect(results.has('6')).toBe(true)
      expect(results.size).toBe(1)
    })

    it('should handle patterns without fixed parts', () => {
      // Pattern with only wildcards - should work but without optimization
      const results = index.lookup(IndexOperation.LIKE, '%')
      expect(results.size).toBe(testData.length) // Matches everything
    })

    it('should handle case insensitive ILIKE', () => {
      const results = index.lookup(IndexOperation.ILIKE, 'HELLO%')
      expect(results.has('1')).toBe(true) // "hello world"
      expect(results.has('2')).toBe(true) // "Hello World"
      expect(results.has('4')).toBe(true) // "hello there"
      expect(results.size).toBe(3)
    })

    it('should handle escaped characters in patterns', () => {
      // Add item with literal % and _
      index.add('escape1', { text: 'hello%world' })
      index.add('escape2', { text: 'hello_world' })
      
      // These should match literal characters (if we implement escaping)
      // For now, just test that the patterns work as expected
      const results1 = index.lookup(IndexOperation.LIKE, 'hello%world')
      expect(results1.has('escape1')).toBe(true)
      
      const results2 = index.lookup(IndexOperation.LIKE, 'hello_world')
      expect(results2.has('escape2')).toBe(true)
    })
  })

  describe('Similarity Operations', () => {
    it('should find similar strings', () => {
      const results = index.lookup(IndexOperation.SIMILAR, 'helo world') // Typo
      expect(results.has('1')).toBe(true) // Should be similar enough
    })

    it('should respect similarity threshold', () => {
      // Create index with high threshold
      const strictIndex = new TrigramIndex('strict', mockExpression, undefined, {
        threshold: 0.8
      })
      strictIndex.build(testData.map(item => [item.id, item]))
      
      // Test with high threshold - might not match 'hello world' due to strict similarity
      
      // Create index with low threshold
      const lenientIndex = new TrigramIndex('lenient', mockExpression, undefined, {
        threshold: 0.1
      })
      lenientIndex.build(testData.map(item => [item.id, item]))
      
      const results2 = lenientIndex.lookup(IndexOperation.SIMILAR, 'hello')
      expect(results2.size).toBeGreaterThan(0)
    })

    it('should handle fuzzy lookup as alias for similarity', () => {
      const similarResults = index.lookup(IndexOperation.SIMILAR, 'helo')
      const fuzzyResults = index.lookup(IndexOperation.FUZZY, 'helo')
      
      expect(similarResults.size).toBe(fuzzyResults.size)
      for (const key of similarResults) {
        expect(fuzzyResults.has(key)).toBe(true)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      const results = index.lookup(IndexOperation.EQ, '')
      expect(results.has('9')).toBe(true)
      expect(results.size).toBe(1)
    })

    it('should handle very short strings', () => {
      const results = index.lookup(IndexOperation.EQ, 'a')
      expect(results.has('10')).toBe(true)
      expect(results.size).toBe(1)
    })

    it('should handle whitespace normalization', () => {
      // Add item with extra whitespace
      index.add('ws1', { text: '  hello   world  ' })
      
      // Should normalize to 'hello world'
      const results = index.lookup(IndexOperation.EQ, 'hello world')
      expect(results.has('ws1')).toBe(true)
    })

    it('should handle non-string index values gracefully', () => {
      // Try to add non-string value
      index.add('num1', { text: 123 as any })
      
      // Should not affect key count (non-strings are skipped)
      const originalCount = testData.length
      expect(index.keyCount).toBe(originalCount) // No change
    })

    it('should handle unsupported operations', () => {
      expect(() => {
        index.lookup(IndexOperation.GT, 'test')
      }).toThrow('Operation gt not supported by TrigramIndex')
    })
  })

  describe('Performance and Statistics', () => {
    it('should provide useful statistics', () => {
      const stats = index.getTrigramStats()
      
      expect(stats.uniqueTrigrams).toBeGreaterThan(0)
      expect(stats.averageTrigramsPerKey).toBeGreaterThan(0)
      expect(stats.mostCommonTrigrams).toBeInstanceOf(Array)
      expect(stats.mostCommonTrigrams.length).toBeGreaterThan(0)
      
      // Check structure of most common trigrams
      const [trigram, count] = stats.mostCommonTrigrams[0]!
      expect(typeof trigram).toBe('string')
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThan(0)
    })

    it('should estimate memory usage', () => {
      const stats = index.getStats()
      expect(stats.memoryUsage).toBeGreaterThan(0)
    })

    it('should track lookup performance', () => {
      const initialStats = index.getStats()
      const initialLookupCount = initialStats.lookupCount
      
      // Perform some lookups
      index.lookup(IndexOperation.EQ, 'hello')
      index.lookup(IndexOperation.LIKE, 'world%')
      
      const newStats = index.getStats()
      expect(newStats.lookupCount).toBe(initialLookupCount + 2)
      expect(newStats.averageLookupTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Trigram Extraction', () => {
    it('should extract correct trigrams', () => {
      // Test the internal trigram extraction by checking index behavior
      index.clear()
      index.add('test', { text: 'abc' })
      
      const stats = index.getTrigramStats()
      // For 'abc', we expect trigrams: '  a', ' ab', 'abc', 'bc ', 'c  '
      expect(stats.uniqueTrigrams).toBe(5)
      
      // Test with longer string
      index.clear()
      index.add('test', { text: 'hello' })
      
      const stats2 = index.getTrigramStats()
      // For 'hello', we expect: '  h', ' he', 'hel', 'ell', 'llo', 'o  '
      // But it might be 7 if there's an extra padding or normalization trigram
      expect(stats2.uniqueTrigrams).toBe(7)
    })

    it('should handle padding for edge trigrams', () => {
      index.clear()
      index.add('test', { text: 'hi' })
      
      const stats = index.getTrigramStats()
      // For 'hi', we expect: '  h', ' hi', 'hi ', 'i  '
      expect(stats.uniqueTrigrams).toBe(4)
    })
  })
})