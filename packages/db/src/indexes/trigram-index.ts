import { BaseIndex, IndexOperation } from "./base-index.js"

/**
 * Options for Trigram index
 */
export interface TrigramIndexOptions {
  /**
   * Minimum similarity threshold for fuzzy matching (0-1)
   * Lower values = more permissive matching
   * @default 0.3
   */
  threshold?: number
  
  /**
   * Whether to perform case-sensitive matching
   * @default false
   */
  caseSensitive?: boolean
  
  /**
   * Whether to normalize whitespace (collapse multiple spaces)
   * @default true
   */
  normalizeWhitespace?: boolean
}

/**
 * Trigram index for text search and LIKE operations
 * 
 * A trigram is a sequence of three consecutive characters. This index:
 * - Breaks text into trigrams for efficient pattern matching
 * - Supports LIKE, ILIKE, SIMILAR, and FUZZY operations
 * - Provides fast substring and similarity search
 * 
 * Examples of trigrams for "hello":
 * "  h", " he", "hel", "ell", "llo", "o  "
 */
export class TrigramIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
    IndexOperation.LIKE,
    IndexOperation.ILIKE,
    IndexOperation.SIMILAR,
    IndexOperation.FUZZY,
  ])

  // Trigram to keys mapping: each trigram maps to a set of keys that contain it
  private trigramMap = new Map<string, Set<TKey>>()
  
  // Key to trigrams mapping: for efficient removal
  private keyToTrigrams = new Map<TKey, Set<string>>()
  
  // Key to original text mapping: for similarity calculations
  private keyToText = new Map<TKey, string>()
  
  private indexedKeys = new Set<TKey>()
  private options!: Required<TrigramIndexOptions>

  protected initialize(options?: TrigramIndexOptions): void {
    this.options = {
      threshold: options?.threshold ?? 0.3,
      caseSensitive: options?.caseSensitive ?? false,
      normalizeWhitespace: options?.normalizeWhitespace ?? true,
    }
  }

  /**
   * Normalize text according to index options
   */
  private normalizeText(text: string): string {
    let normalized = text
    
    if (!this.options.caseSensitive) {
      normalized = normalized.toLowerCase()
    }
    
    if (this.options.normalizeWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ').trim()
    }
    
    return normalized
  }

  /**
   * Extract trigrams from text
   * Adds padding spaces to capture edge trigrams
   */
  private extractTrigrams(text: string): Set<string> {
    const normalized = this.normalizeText(text)
    const trigrams = new Set<string>()
    
    // Add padding for edge trigrams
    const padded = `  ${normalized}  `
    
    // Extract all trigrams
    for (let i = 0; i <= padded.length - 3; i++) {
      const trigram = padded.substring(i, i + 3)
      trigrams.add(trigram)
    }
    
    return trigrams
  }

  /**
   * Calculate Jaccard similarity between two sets of trigrams
   */
  private calculateSimilarity(trigrams1: Set<string>, trigrams2: Set<string>): number {
    if (trigrams1.size === 0 && trigrams2.size === 0) return 1.0
    if (trigrams1.size === 0 || trigrams2.size === 0) return 0.0
    
    const intersection = new Set([...trigrams1].filter(t => trigrams2.has(t)))
    const union = new Set([...trigrams1, ...trigrams2])
    
    return intersection.size / union.size
  }

  /**
   * Convert LIKE pattern to regex
   */
  private likeToRegex(pattern: string, caseInsensitive: boolean = false): RegExp {
    // Escape special regex characters except % and _
    let escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    
    // Convert SQL LIKE wildcards to regex
    escaped = escaped.replace(/([^\\])%/g, '$1.*')  // % -> .*
    escaped = escaped.replace(/^%/, '.*')           // Handle % at start
    escaped = escaped.replace(/([^\\])_/g, '$1.')   // _ -> .
    escaped = escaped.replace(/^_/, '.')            // Handle _ at start
    
    // Handle escaped literals
    escaped = escaped.replace(/\\%/g, '%')
    escaped = escaped.replace(/\\_/g, '_')
    
    const flags = caseInsensitive ? 'i' : ''
    return new RegExp(`^${escaped}$`, flags)
  }

  /**
   * Get trigrams that would be present in a LIKE pattern
   * This helps optimize LIKE queries by finding candidate keys
   */
  private getPatternTrigrams(pattern: string): Set<string> {
    const trigrams = new Set<string>()
    
    // Remove wildcards and extract fixed parts
    const parts = pattern.split(/[%_]+/).filter(part => part.length >= 3)
    
    for (const part of parts) {
      const normalized = this.normalizeText(part)
      
      // Extract all possible trigrams, but filter to only those present in index
      const allTrigrams = this.extractTrigrams(normalized)
      
      // Only use trigrams that actually exist in our index
      for (const trigram of allTrigrams) {
        if (this.trigramMap.has(trigram)) {
          trigrams.add(trigram)
        }
      }
    }
    
    return trigrams
  }

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    try {
      const indexedValue = this.evaluateIndexExpression(item)
      
      if (typeof indexedValue !== 'string') {
        // Skip non-string values
        return
      }

      const trigrams = this.extractTrigrams(indexedValue)
      
      // Store mappings
      this.keyToTrigrams.set(key, trigrams)
      this.keyToText.set(key, indexedValue) // Store original text for regex matching
      
      // Update trigram to keys mapping
      for (const trigram of trigrams) {
        if (!this.trigramMap.has(trigram)) {
          this.trigramMap.set(trigram, new Set())
        }
        this.trigramMap.get(trigram)!.add(key)
      }
      
      this.indexedKeys.add(key)
      this.updateTimestamp()
    } catch (error) {
      // Silently skip if evaluation fails
    }
  }

  /**
   * Removes a value from the index
   */
  remove(key: TKey, item: any): void {
    try {
      const trigrams = this.keyToTrigrams.get(key)
      if (!trigrams) return
      
      // Remove from trigram mappings
      for (const trigram of trigrams) {
        const keys = this.trigramMap.get(trigram)
        if (keys) {
          keys.delete(key)
          if (keys.size === 0) {
            this.trigramMap.delete(trigram)
          }
        }
      }
      
      // Clean up
      this.keyToTrigrams.delete(key)
      this.keyToText.delete(key)
      this.indexedKeys.delete(key)
      this.updateTimestamp()
    } catch (error) {
      // Silently skip if evaluation fails
    }
  }

  /**
   * Updates a value in the index
   */
  update(key: TKey, oldItem: any, newItem: any): void {
    this.remove(key, oldItem)
    this.add(key, newItem)
  }

  /**
   * Builds the index from a collection of entries
   */
  build(entries: Iterable<[TKey, any]>): void {
    this.clear()

    for (const [key, item] of entries) {
      this.add(key, item)
    }
  }

  /**
   * Clears all data from the index
   */
  clear(): void {
    this.trigramMap.clear()
    this.keyToTrigrams.clear()
    this.keyToText.clear()
    this.indexedKeys.clear()
    this.updateTimestamp()
  }

  /**
   * Performs a lookup operation
   */
  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const startTime = performance.now()

    let result: Set<TKey>

    switch (operation) {
      case IndexOperation.EQ:
        result = this.equalityLookup(value)
        break
      case IndexOperation.LIKE:
        result = this.likeLookup(value, false)
        break
      case IndexOperation.ILIKE:
        result = this.likeLookup(value, true)
        break
      case IndexOperation.SIMILAR:
        result = this.similarityLookup(value)
        break
      case IndexOperation.FUZZY:
        result = this.fuzzyLookup(value)
        break
      default:
        throw new Error(`Operation ${operation} not supported by TrigramIndex`)
    }

    this.trackLookup(startTime)
    return result
  }

  /**
   * Performs an equality lookup
   */
  private equalityLookup(value: any): Set<TKey> {
    if (typeof value !== 'string') return new Set()
    
    const normalized = this.normalizeText(value)
    const result = new Set<TKey>()
    
    for (const [key, text] of this.keyToText) {
      if (this.normalizeText(text) === normalized) {
        result.add(key)
      }
    }
    
    return result
  }

  /**
   * Performs a LIKE pattern lookup
   */
  private likeLookup(pattern: string, caseInsensitive: boolean): Set<TKey> {
    if (typeof pattern !== 'string') return new Set()
    
    const regex = this.likeToRegex(pattern, caseInsensitive || !this.options.caseSensitive)
    const result = new Set<TKey>()
    
    // Optimization: use trigrams to find candidates
    const patternTrigrams = this.getPatternTrigrams(pattern)
    let candidates: Set<TKey>
    
    if (patternTrigrams.size > 0) {
      // Find union of keys that contain any pattern trigrams
      // (any key that contains at least one of the pattern trigrams is a candidate)
      candidates = new Set<TKey>()
      
      for (const trigram of patternTrigrams) {
        const keys = this.trigramMap.get(trigram) || new Set()
        for (const key of keys) {
          candidates.add(key)
        }
      }
    } else {
      // No trigrams to optimize with, check all keys
      candidates = new Set(this.indexedKeys)
    }
    
    // Test regex against candidates
    // Handle empty string case specially 
    for (const key of candidates) {
      const text = this.keyToText.get(key)
      if (text !== undefined && regex.test(text)) {
        result.add(key)
      }
    }
    
    return result
  }

  /**
   * Performs a similarity lookup based on trigram similarity
   */
  private similarityLookup(value: any): Set<TKey> {
    if (typeof value !== 'string') return new Set()
    
    const queryTrigrams = this.extractTrigrams(value)
    const result = new Set<TKey>()
    
    for (const key of this.indexedKeys) {
      const keyTrigrams = this.keyToTrigrams.get(key)
      if (keyTrigrams) {
        const similarity = this.calculateSimilarity(queryTrigrams, keyTrigrams)
        if (similarity >= this.options.threshold) {
          result.add(key)
        }
      }
    }
    
    return result
  }

  /**
   * Performs a fuzzy lookup (alias for similarity lookup)
   */
  private fuzzyLookup(value: any): Set<TKey> {
    return this.similarityLookup(value)
  }

  /**
   * Gets the number of indexed keys
   */
  get keyCount(): number {
    return this.indexedKeys.size
  }

  /**
   * Get statistics about the trigram distribution
   */
  getTrigramStats(): {
    uniqueTrigrams: number
    averageTrigramsPerKey: number
    mostCommonTrigrams: Array<[string, number]>
  } {
    const trigramCounts = new Map<string, number>()
    
    for (const [trigram, keys] of this.trigramMap) {
      trigramCounts.set(trigram, keys.size)
    }
    
    const mostCommon = Array.from(trigramCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
    
    const totalTrigrams = Array.from(this.keyToTrigrams.values())
      .reduce((sum, trigrams) => sum + trigrams.size, 0)
    
    return {
      uniqueTrigrams: this.trigramMap.size,
      averageTrigramsPerKey: this.indexedKeys.size > 0 ? totalTrigrams / this.indexedKeys.size : 0,
      mostCommonTrigrams: mostCommon
    }
  }

  protected estimateMemoryUsage(): number {
    // Estimate memory usage for trigram index
    const trigramMapSize = this.trigramMap.size * 100 // Estimated size per trigram entry
    const keyMappingsSize = this.indexedKeys.size * 200 // Estimated size per key mapping
    const textStorageSize = Array.from(this.keyToText.values())
      .reduce((sum, text) => sum + text.length * 2, 0) // Rough estimate for string storage
    
    return trigramMapSize + keyMappingsSize + textStorageSize
  }
}