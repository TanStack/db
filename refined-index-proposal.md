# Refined Index Abstraction Proposal

## Core Design: Single `createIndex` Method with Class-Based Types

### 1. Base Index Class and Interface

```typescript
/**
 * Base abstract class that all index types extend
 */
export abstract class BaseIndex<TKey extends string | number = string | number> {
  public readonly id: string
  public readonly name?: string
  public readonly expression: BasicExpression
  public abstract readonly supportedOperations: Set<IndexOperation>

  constructor(id: string, expression: BasicExpression, name?: string, options?: any) {
    this.id = id
    this.expression = expression
    this.name = name
    this.initialize(options)
  }

  // Abstract methods that each index type must implement
  abstract add(key: TKey, item: any): void
  abstract remove(key: TKey, item: any): void
  abstract update(key: TKey, oldItem: any, newItem: any): void
  abstract build(entries: Iterable<[TKey, any]>): void
  abstract clear(): void
  abstract lookup(operation: IndexOperation, value: any): Set<TKey>
  abstract supports(operation: IndexOperation): boolean
  abstract getStats(): IndexStats

  // Common methods
  matchesField(fieldPath: Array<string>): boolean {
    return (
      this.expression.type === `ref` &&
      this.expression.path.length === fieldPath.length &&
      this.expression.path.every((part, i) => part === fieldPath[i])
    )
  }

  protected abstract initialize(options?: any): void

  protected evaluateIndexExpression(item: any): any {
    const evaluator = compileSingleRowExpression(this.expression)
    return evaluator(item as Record<string, unknown>)
  }
}

/**
 * Type for index constructor
 */
export type IndexConstructor<TKey extends string | number = string | number> = new (
  id: string,
  expression: BasicExpression,
  name?: string,
  options?: any
) => BaseIndex<TKey>
```

### 2. Specific Index Implementations

```typescript
/**
 * B-Tree index (current implementation as a class)
 */
export class BTreeIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
    IndexOperation.GT,
    IndexOperation.GTE,
    IndexOperation.LT,
    IndexOperation.LTE,
    IndexOperation.IN
  ])

  private orderedEntries: Array<[any, Set<TKey>]> = []
  private valueMap = new Map<any, Set<TKey>>()
  private indexedKeys = new Set<TKey>()
  private compareFn: (a: any, b: any) => number

  protected initialize(options?: BTreeOptions): void {
    this.compareFn = options?.compareFn ?? ascComparator
  }

  // ... rest of current implementation
}

export interface BTreeOptions {
  compareFn?: (a: any, b: any) => number
}

/**
 * Trigram index for fuzzy text search
 */
export class TrigramIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
    IndexOperation.LIKE,
    IndexOperation.ILIKE,
    IndexOperation.SIMILAR,
    IndexOperation.FUZZY
  ])

  private trigramMap = new Map<string, Set<TKey>>()
  private minSimilarity: number
  private caseSensitive: boolean

  protected initialize(options?: TrigramOptions): void {
    this.minSimilarity = options?.minSimilarity ?? 0.3
    this.caseSensitive = options?.caseSensitive ?? false
  }

  add(key: TKey, item: any): void {
    const text = this.evaluateIndexExpression(item)?.toString() ?? ''
    const trigrams = this.generateTrigrams(text)
    
    for (const trigram of trigrams) {
      if (!this.trigramMap.has(trigram)) {
        this.trigramMap.set(trigram, new Set())
      }
      this.trigramMap.get(trigram)!.add(key)
    }
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const queryText = value?.toString() ?? ''
    
    switch (operation) {
      case IndexOperation.EQ:
        return this.exactMatch(queryText)
      case IndexOperation.SIMILAR:
        return this.similarityMatch(queryText)
      case IndexOperation.FUZZY:
        return this.fuzzyMatch(queryText)
      default:
        throw new Error(`Operation ${operation} not supported by TrigramIndex`)
    }
  }

  private generateTrigrams(text: string): Set<string> {
    const processedText = this.caseSensitive ? text : text.toLowerCase()
    const padded = `  ${processedText}  `
    const trigrams = new Set<string>()
    
    for (let i = 0; i <= padded.length - 3; i++) {
      trigrams.add(padded.slice(i, i + 3))
    }
    
    return trigrams
  }

  // ... other methods
}

export interface TrigramOptions {
  minSimilarity?: number
  caseSensitive?: boolean
  ngramSize?: number // for future: support 2-grams, 4-grams, etc.
}

/**
 * Full-text search index
 */
export class FullTextIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.MATCH,
    IndexOperation.EQ
  ])

  private tokenMap = new Map<string, Map<TKey, TokenInfo>>()
  private stemmer: (word: string) => string
  private stopWords: Set<string>
  private minTokenLength: number

  protected initialize(options?: FullTextOptions): void {
    this.stemmer = options?.stemmer ?? this.defaultStemmer
    this.stopWords = new Set(options?.stopWords ?? DEFAULT_STOP_WORDS)
    this.minTokenLength = options?.minTokenLength ?? 2
  }

  // ... implementation
}

export interface FullTextOptions {
  stemmer?: (word: string) => string
  stopWords?: string[]
  minTokenLength?: number
  language?: 'en' | 'es' | 'fr'
  rankingAlgorithm?: 'tfidf' | 'bm25'
}

/**
 * Hash index for exact equality lookups only
 */
export class HashIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([IndexOperation.EQ, IndexOperation.IN])

  private hashMap = new Map<any, Set<TKey>>()
  private hashFunction: (value: any) => string

  protected initialize(options?: HashOptions): void {
    this.hashFunction = options?.hashFunction ?? this.defaultHash
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    switch (operation) {
      case IndexOperation.EQ:
        return this.hashMap.get(value) ?? new Set()
      case IndexOperation.IN:
        const result = new Set<TKey>()
        for (const v of value) {
          const keys = this.hashMap.get(v)
          if (keys) {
            keys.forEach(k => result.add(k))
          }
        }
        return result
      default:
        throw new Error(`Operation ${operation} not supported by HashIndex`)
    }
  }

  // ... implementation
}

export interface HashOptions {
  hashFunction?: (value: any) => string
}
```

### 3. Single `createIndex` Method

```typescript
/**
 * Enhanced index creation options
 */
export interface IndexOptions<TIndexClass extends IndexConstructor = typeof BTreeIndex> {
  name?: string
  indexType?: TIndexClass
  options?: TIndexClass extends new (id: string, expr: BasicExpression, name?: string, options?: infer O) => any ? O : never
}

/**
 * Collection class with single createIndex method
 */
export class CollectionImpl<T, TKey extends string | number> {
  
  /**
   * Create an index with specified type and options
   * @param indexCallback Function that extracts the indexed value from a row
   * @param config Configuration including index type and type-specific options
   */
  public createIndex<TIndexClass extends IndexConstructor<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    config: IndexOptions<TIndexClass> = {}
  ): InstanceType<TIndexClass> {
    this.validateCollectionUsable(`createIndex`)

    const indexId = `${++this.indexCounter}`
    const singleRowRefProxy = createSingleRowRefProxy<T>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)
    
    // Default to BTreeIndex if no type specified
    const IndexClass = config.indexType ?? (BTreeIndex as TIndexClass)
    
    // Create the index instance
    const index = new IndexClass(indexId, expression, config.name, config.options) as InstanceType<TIndexClass>

    // Build the index with current data
    index.build(this.entries())

    // Store the index
    this.indexes.set(indexId, index)

    return index
  }
}
```

### 4. Usage Examples

```typescript
// Default B-tree index (backward compatible)
const ageIndex = collection.createIndex(row => row.age)

// Explicit B-tree index with options
const ageIndexWithOptions = collection.createIndex(row => row.age, {
  indexType: BTreeIndex,
  options: {
    compareFn: customComparator
  }
})

// Trigram index for fuzzy search
const nameTrigramIndex = collection.createIndex(row => row.name, {
  indexType: TrigramIndex,
  options: {
    minSimilarity: 0.4,
    caseSensitive: false
  }
})

// Full-text search index
const descriptionIndex = collection.createIndex(row => row.description, {
  indexType: FullTextIndex,
  options: {
    stopWords: ['the', 'a', 'an'],
    stemmer: englishStemmer,
    minTokenLength: 3,
    rankingAlgorithm: 'bm25'
  }
})

// Hash index for exact lookups
const emailIndex = collection.createIndex(row => row.email, {
  indexType: HashIndex,
  options: {
    hashFunction: customHashFunction
  }
})

// Multiple indexes on same field for different use cases
const nameExact = collection.createIndex(row => row.name, {
  indexType: BTreeIndex,
  name: 'name_exact'
})

const nameFuzzy = collection.createIndex(row => row.name, {
  indexType: TrigramIndex,
  name: 'name_fuzzy',
  options: { minSimilarity: 0.3 }
})
```

### 5. Type Safety and IntelliSense

The design provides excellent TypeScript support:

```typescript
// TypeScript knows the exact options type based on indexType
const trigramIndex = collection.createIndex(row => row.name, {
  indexType: TrigramIndex,
  options: {
    minSimilarity: 0.4,    // ✅ Valid TrigramOptions property
    caseSensitive: true,   // ✅ Valid TrigramOptions property
    // stopWords: ['a']    // ❌ TypeScript error: not a TrigramOptions property
  }
})

// Return type is correctly inferred
const index: TrigramIndex<string> = trigramIndex // ✅ No type assertion needed
```

### 6. Custom Index Types

Users can easily create their own index types:

```typescript
/**
 * Custom geospatial index
 */
export class GeospatialIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.WITHIN,
    IndexOperation.CONTAINS
  ])

  protected initialize(options?: GeospatialOptions): void {
    // Custom initialization
  }

  // ... implement required methods
}

export interface GeospatialOptions {
  srid?: number
  precision?: number
}

// Usage
const locationIndex = collection.createIndex(row => row.coordinates, {
  indexType: GeospatialIndex,
  options: {
    srid: 4326,
    precision: 6
  }
})
```

### 7. Convenience Helper (Optional)

If you still want some convenience, you could add a helper:

```typescript
/**
 * Convenience helpers for common index types
 */
export class IndexHelpers {
  static btree<T, TKey extends string | number>(
    collection: CollectionImpl<T, TKey>,
    callback: (row: SingleRowRefProxy<T>) => any,
    options?: BTreeOptions & { name?: string }
  ) {
    return collection.createIndex(callback, {
      indexType: BTreeIndex,
      name: options?.name,
      options
    })
  }

  static trigram<T, TKey extends string | number>(
    collection: CollectionImpl<T, TKey>,
    callback: (row: SingleRowRefProxy<T>) => any,
    options?: TrigramOptions & { name?: string }
  ) {
    return collection.createIndex(callback, {
      indexType: TrigramIndex,
      name: options?.name,
      options
    })
  }

  static fulltext<T, TKey extends string | number>(
    collection: CollectionImpl<T, TKey>,
    callback: (row: SingleRowRefProxy<T>) => any,
    options?: FullTextOptions & { name?: string }
  ) {
    return collection.createIndex(callback, {
      indexType: FullTextIndex,
      name: options?.name,
      options
    })
  }
}

// Usage (if desired)
const nameIndex = IndexHelpers.trigram(collection, row => row.name, {
  minSimilarity: 0.4
})
```

## Benefits of This Approach

1. **Single Method**: Clean API with just one `createIndex` method
2. **Type Safety**: Full TypeScript support with proper option inference
3. **Flexibility**: Easy to add new index types without API changes
4. **Extensibility**: Users can create custom index classes
5. **Backward Compatibility**: Default behavior unchanged
6. **Performance**: No runtime overhead for type checking
7. **Clear Intent**: Index type is explicit in the call site

## Migration Path

1. **Phase 1**: Introduce `BaseIndex` class and convert `CollectionIndex` to `BTreeIndex`
2. **Phase 2**: Update `createIndex` method signature (backward compatible)
3. **Phase 3**: Add new index types (`TrigramIndex`, `FullTextIndex`, etc.)
4. **Phase 4**: Update query optimization to handle new operations

The key insight is using TypeScript's conditional types to infer the correct options type based on the index class, providing excellent developer experience with full type safety.