# Index Abstraction Proposal

## Overview

This proposal outlines a flexible index abstraction that supports multiple index types (B-tree, trigram, full-text, etc.) while maintaining backward compatibility with the current system.

## Current State Analysis

The current `CollectionIndex` class is essentially a B-tree index optimized for exact matches and range queries. It supports:
- Equality lookups (`eq`)
- Range queries (`gt`, `gte`, `lt`, `lte`)
- Binary search for ordered data
- Field-based indexing expressions

## Proposed Architecture

### 1. Base Index Interface

```typescript
/**
 * Base interface that all index types must implement
 */
export interface ICollectionIndex<TKey extends string | number = string | number> {
  readonly id: string
  readonly name?: string
  readonly type: IndexType
  readonly expression: BasicExpression
  readonly supportedOperations: Set<IndexOperation>

  // Core lifecycle methods
  add(key: TKey, item: any): void
  remove(key: TKey, item: any): void
  update(key: TKey, oldItem: any, newItem: any): void
  build(entries: Iterable<[TKey, any]>): void
  clear(): void

  // Query methods
  lookup(operation: IndexOperation, value: any): Set<TKey>
  supports(operation: IndexOperation): boolean
  matchesField(fieldPath: Array<string>): boolean

  // Metadata
  get keyCount(): number
  getStats(): IndexStats
}

/**
 * Index types that can be created
 */
export enum IndexType {
  BTREE = 'btree',           // Current ordered index (default)
  TRIGRAM = 'trigram',       // For fuzzy text search
  FULLTEXT = 'fulltext',     // For full-text search
  HASH = 'hash',             // For exact equality only (faster)
  GIN = 'gin',               // Generalized inverted index
  BITMAP = 'bitmap'          // For low-cardinality fields
}

/**
 * Operations that indexes can support
 */
export enum IndexOperation {
  // Basic comparisons
  EQ = 'eq',
  NE = 'ne',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  
  // Array/set operations
  IN = 'in',
  NOT_IN = 'not_in',
  
  // Text operations
  LIKE = 'like',
  ILIKE = 'ilike',
  MATCH = 'match',           // Full-text search
  SIMILAR = 'similar',       // Trigram similarity
  
  // Fuzzy operations
  FUZZY = 'fuzzy',
  DISTANCE = 'distance',
  
  // Geometric operations (future)
  CONTAINS = 'contains',
  WITHIN = 'within'
}

/**
 * Statistics about index usage and performance
 */
export interface IndexStats {
  readonly entryCount: number
  readonly memoryUsage: number
  readonly lookupCount: number
  readonly averageLookupTime: number
  readonly lastUpdated: Date
}
```

### 2. Specific Index Implementations

#### A. B-Tree Index (Current Implementation)

```typescript
/**
 * B-tree index for ordered data with range queries
 * This is the current CollectionIndex renamed and implementing the interface
 */
export class BTreeIndex<TKey extends string | number = string | number> 
  implements ICollectionIndex<TKey> {
  
  public readonly type = IndexType.BTREE
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
    IndexOperation.GT,
    IndexOperation.GTE,
    IndexOperation.LT,
    IndexOperation.LTE,
    IndexOperation.IN
  ])

  // ... current implementation with interface methods
  
  lookup(operation: IndexOperation, value: any): Set<TKey> {
    switch (operation) {
      case IndexOperation.EQ:
        return this.equalityLookup(value)
      case IndexOperation.GT:
      case IndexOperation.GTE:
      case IndexOperation.LT:
      case IndexOperation.LTE:
        return this.rangeQuery(operation, value)
      case IndexOperation.IN:
        return this.inArrayLookup(value)
      default:
        throw new Error(`Operation ${operation} not supported by BTreeIndex`)
    }
  }
}
```

#### B. Trigram Index (New)

```typescript
/**
 * Trigram index for fuzzy text search
 */
export class TrigramIndex<TKey extends string | number = string | number> 
  implements ICollectionIndex<TKey> {
  
  public readonly type = IndexType.TRIGRAM
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
    IndexOperation.LIKE,
    IndexOperation.ILIKE,
    IndexOperation.SIMILAR,
    IndexOperation.FUZZY
  ])

  private trigramMap = new Map<string, Set<TKey>>()
  private minSimilarity = 0.3

  constructor(
    id: string, 
    expression: BasicExpression, 
    name?: string,
    options: TrigramOptions = {}
  ) {
    this.id = id
    this.expression = expression
    this.name = name
    this.minSimilarity = options.minSimilarity ?? 0.3
  }

  add(key: TKey, item: any): void {
    const text = this.evaluateExpression(item)?.toString() ?? ''
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
      case IndexOperation.LIKE:
        return this.likeMatch(queryText)
      case IndexOperation.SIMILAR:
        return this.similarityMatch(queryText)
      case IndexOperation.FUZZY:
        return this.fuzzyMatch(queryText)
      default:
        throw new Error(`Operation ${operation} not supported by TrigramIndex`)
    }
  }

  private generateTrigrams(text: string): Set<string> {
    // Pad text and generate trigrams
    const padded = `  ${text.toLowerCase()}  `
    const trigrams = new Set<string>()
    
    for (let i = 0; i <= padded.length - 3; i++) {
      trigrams.add(padded.slice(i, i + 3))
    }
    
    return trigrams
  }

  private similarityMatch(queryText: string): Set<TKey> {
    const queryTrigrams = this.generateTrigrams(queryText)
    const candidates = new Map<TKey, number>()
    
    // Score each candidate by trigram overlap
    for (const trigram of queryTrigrams) {
      const keys = this.trigramMap.get(trigram)
      if (keys) {
        for (const key of keys) {
          candidates.set(key, (candidates.get(key) ?? 0) + 1)
        }
      }
    }
    
    // Filter by similarity threshold
    const result = new Set<TKey>()
    const queryTrigramCount = queryTrigrams.size
    
    for (const [key, score] of candidates) {
      const similarity = score / queryTrigramCount
      if (similarity >= this.minSimilarity) {
        result.add(key)
      }
    }
    
    return result
  }

  // ... other methods
}

interface TrigramOptions {
  minSimilarity?: number
}
```

#### C. Full-Text Index (New)

```typescript
/**
 * Full-text search index with stemming and ranking
 */
export class FullTextIndex<TKey extends string | number = string | number> 
  implements ICollectionIndex<TKey> {
  
  public readonly type = IndexType.FULLTEXT
  public readonly supportedOperations = new Set([
    IndexOperation.MATCH,
    IndexOperation.EQ
  ])

  private tokenMap = new Map<string, Map<TKey, TokenInfo>>()
  private stemmer: (word: string) => string
  private stopWords: Set<string>

  constructor(
    id: string, 
    expression: BasicExpression, 
    name?: string,
    options: FullTextOptions = {}
  ) {
    this.stemmer = options.stemmer ?? this.defaultStemmer
    this.stopWords = new Set(options.stopWords ?? DEFAULT_STOP_WORDS)
  }

  add(key: TKey, item: any): void {
    const text = this.evaluateExpression(item)?.toString() ?? ''
    const tokens = this.tokenize(text)
    
    for (const [token, positions] of tokens) {
      if (!this.tokenMap.has(token)) {
        this.tokenMap.set(token, new Map())
      }
      this.tokenMap.get(token)!.set(key, {
        frequency: positions.length,
        positions,
        documentLength: tokens.size
      })
    }
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    switch (operation) {
      case IndexOperation.MATCH:
        return this.fullTextSearch(value)
      case IndexOperation.EQ:
        return this.exactTokenMatch(value)
      default:
        throw new Error(`Operation ${operation} not supported by FullTextIndex`)
    }
  }

  private fullTextSearch(query: string): Set<TKey> {
    const queryTokens = this.tokenize(query)
    const scores = new Map<TKey, number>()
    
    // TF-IDF scoring
    for (const [token] of queryTokens) {
      const tokenDocs = this.tokenMap.get(token)
      if (!tokenDocs) continue
      
      const idf = Math.log(this.keyCount / tokenDocs.size)
      
      for (const [key, tokenInfo] of tokenDocs) {
        const tf = tokenInfo.frequency / tokenInfo.documentLength
        const score = tf * idf
        scores.set(key, (scores.get(key) ?? 0) + score)
      }
    }
    
    // Return top results (could add limit parameter)
    return new Set(scores.keys())
  }

  private tokenize(text: string): Map<string, number[]> {
    const tokens = new Map<string, number[]>()
    const words = text.toLowerCase().match(/\w+/g) ?? []
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!
      if (this.stopWords.has(word)) continue
      
      const stemmed = this.stemmer(word)
      if (!tokens.has(stemmed)) {
        tokens.set(stemmed, [])
      }
      tokens.get(stemmed)!.push(i)
    }
    
    return tokens
  }

  // ... other methods
}

interface FullTextOptions {
  stemmer?: (word: string) => string
  stopWords?: string[]
  language?: 'en' | 'es' | 'fr' // for future language-specific processing
}

interface TokenInfo {
  frequency: number
  positions: number[]
  documentLength: number
}
```

### 3. Index Factory and Registry

```typescript
/**
 * Factory for creating different types of indexes
 */
export class IndexFactory {
  private static readonly indexConstructors = new Map<IndexType, IndexConstructor>([
    [IndexType.BTREE, BTreeIndex],
    [IndexType.TRIGRAM, TrigramIndex],
    [IndexType.FULLTEXT, FullTextIndex],
    [IndexType.HASH, HashIndex],
  ])

  static createIndex<TKey extends string | number>(
    type: IndexType,
    id: string,
    expression: BasicExpression,
    name?: string,
    options: any = {}
  ): ICollectionIndex<TKey> {
    const IndexConstructor = this.indexConstructors.get(type)
    if (!IndexConstructor) {
      throw new Error(`Index type ${type} is not supported`)
    }
    
    return new IndexConstructor(id, expression, name, options)
  }

  static registerIndexType(type: IndexType, constructor: IndexConstructor): void {
    this.indexConstructors.set(type, constructor)
  }

  static getSupportedTypes(): IndexType[] {
    return Array.from(this.indexConstructors.keys())
  }
}

type IndexConstructor = new <TKey extends string | number>(
  id: string,
  expression: BasicExpression,
  name?: string,
  options?: any
) => ICollectionIndex<TKey>
```

### 4. Enhanced Collection Interface

```typescript
/**
 * Enhanced index creation options
 */
export interface IndexOptions {
  name?: string
  type?: IndexType  // New: specify index type
  
  // Type-specific options
  trigram?: TrigramOptions
  fulltext?: FullTextOptions
  hash?: HashOptions
  
  // General options
  unique?: boolean
  sparse?: boolean  // Skip null/undefined values
}

// Enhanced collection methods
export class CollectionImpl<T, TKey extends string | number> {
  
  /**
   * Create an index with specified type and options
   */
  public createIndex(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    options: IndexOptions = {}
  ): ICollectionIndex<TKey> {
    this.validateCollectionUsable(`createIndex`)

    const indexId = `${++this.indexCounter}`
    const singleRowRefProxy = createSingleRowRefProxy<T>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)
    
    // Determine index type (default to BTREE for backward compatibility)
    const indexType = options.type ?? IndexType.BTREE
    
    // Create the index using the factory
    const index = IndexFactory.createIndex<TKey>(
      indexType,
      indexId,
      expression,
      options.name,
      this.getTypeSpecificOptions(indexType, options)
    )

    // Build the index with current data
    index.build(this.entries())

    // Store the index
    this.indexes.set(indexId, index)

    return index
  }

  /**
   * Create a trigram index for fuzzy text search
   */
  public createTrigramIndex(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    options: Omit<IndexOptions, 'type'> & { trigram?: TrigramOptions } = {}
  ): ICollectionIndex<TKey> {
    return this.createIndex(indexCallback, { ...options, type: IndexType.TRIGRAM })
  }

  /**
   * Create a full-text search index
   */
  public createFullTextIndex(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    options: Omit<IndexOptions, 'type'> & { fulltext?: FullTextOptions } = {}
  ): ICollectionIndex<TKey> {
    return this.createIndex(indexCallback, { ...options, type: IndexType.FULLTEXT })
  }

  private getTypeSpecificOptions(type: IndexType, options: IndexOptions): any {
    switch (type) {
      case IndexType.TRIGRAM:
        return options.trigram ?? {}
      case IndexType.FULLTEXT:
        return options.fulltext ?? {}
      case IndexType.HASH:
        return options.hash ?? {}
      default:
        return {}
    }
  }
}
```

### 5. Enhanced Query Optimization

```typescript
/**
 * Enhanced query optimization that considers index capabilities
 */
export function optimizeQuery<TKey extends string | number>(
  expression: BasicExpression,
  indexes: Map<string, ICollectionIndex<TKey>>
): OptimizationResult<TKey> {
  // Try each index to find the best match
  for (const index of indexes.values()) {
    const result = tryOptimizeWithIndex(expression, index)
    if (result.canOptimize) {
      return result
    }
  }
  
  return { canOptimize: false, matchingKeys: new Set() }
}

function tryOptimizeWithIndex<TKey extends string | number>(
  expression: BasicExpression,
  index: ICollectionIndex<TKey>
): OptimizationResult<TKey> {
  switch (expression.type) {
    case `func`:
      return tryOptimizeFunctionWithIndex(expression, index)
    // ... other cases
  }
  
  return { canOptimize: false, matchingKeys: new Set() }
}

function tryOptimizeFunctionWithIndex<TKey extends string | number>(
  expression: BasicExpression,
  index: ICollectionIndex<TKey>
): OptimizationResult<TKey> {
  if (expression.type !== 'func') {
    return { canOptimize: false, matchingKeys: new Set() }
  }
  
  const operation = expression.name as IndexOperation
  
  // Check if index supports this operation
  if (!index.supports(operation)) {
    return { canOptimize: false, matchingKeys: new Set() }
  }
  
  // Check if the field matches
  const fieldArg = findFieldArgument(expression)
  if (!fieldArg || !index.matchesField(fieldArg.path)) {
    return { canOptimize: false, matchingKeys: new Set() }
  }
  
  // Extract the value
  const valueArg = findValueArgument(expression)
  if (!valueArg) {
    return { canOptimize: false, matchingKeys: new Set() }
  }
  
  // Perform the lookup
  try {
    const matchingKeys = index.lookup(operation, valueArg.value)
    return { canOptimize: true, matchingKeys }
  } catch (error) {
    return { canOptimize: false, matchingKeys: new Set() }
  }
}
```

## Usage Examples

### Basic Usage (Backward Compatible)

```typescript
// Current usage still works - defaults to B-tree index
const ageIndex = collection.createIndex(row => row.age)

// Explicit B-tree index
const explicitAgeIndex = collection.createIndex(row => row.age, {
  type: IndexType.BTREE,
  name: 'age_btree'
})
```

### Trigram Index for Fuzzy Search

```typescript
// Create trigram index for fuzzy name search
const nameTrigramIndex = collection.createTrigramIndex(row => row.name, {
  name: 'name_fuzzy',
  trigram: { minSimilarity: 0.4 }
})

// Use with similarity queries
const results = collection.find({
  where: row => similar(row.name, 'Jhon') // matches "John" with typo
})
```

### Full-Text Search Index

```typescript
// Create full-text index for description search
const descriptionIndex = collection.createFullTextIndex(row => row.description, {
  name: 'description_search',
  fulltext: {
    stopWords: ['the', 'a', 'an'],
    stemmer: englishStemmer
  }
})

// Use with full-text queries
const results = collection.find({
  where: row => match(row.description, 'javascript programming')
})
```

### Multiple Indexes for Different Query Types

```typescript
// Different indexes for different query patterns
const exactEmailIndex = collection.createIndex(row => row.email, {
  type: IndexType.HASH  // Fast exact lookups
})

const nameSearchIndex = collection.createTrigramIndex(row => row.name)

const bioSearchIndex = collection.createFullTextIndex(row => row.bio)

// Queries automatically use the best index
const exactUser = collection.find({ where: row => eq(row.email, 'user@example.com') })
const fuzzyNames = collection.find({ where: row => similar(row.name, 'Smith') })
const textSearch = collection.find({ where: row => match(row.bio, 'software engineer') })
```

## Migration Strategy

### Phase 1: Interface Introduction
1. Create the `ICollectionIndex` interface
2. Make current `CollectionIndex` implement the interface (rename to `BTreeIndex`)
3. Update collection to use the interface type
4. All existing code continues to work

### Phase 2: Factory and Type System
1. Introduce `IndexFactory` and `IndexType` enum
2. Add optional `type` parameter to `createIndex`
3. Default to `BTREE` for backward compatibility

### Phase 3: New Index Types
1. Implement `TrigramIndex` and `FullTextIndex`
2. Add convenience methods (`createTrigramIndex`, `createFullTextIndex`)
3. Update query optimization to handle new operations

### Phase 4: Enhanced Operations
1. Add new query functions (`similar`, `match`, etc.)
2. Update query compiler to handle new operations
3. Optimize query planning to choose best index type

## Benefits

1. **Backward Compatibility**: Existing code continues to work unchanged
2. **Performance**: Different index types optimized for different query patterns
3. **Extensibility**: Easy to add new index types (GIS, JSON, etc.)
4. **Type Safety**: Strong typing for operations and index capabilities
5. **Flexibility**: Multiple indexes on same field for different query types
6. **Clean Architecture**: Clear separation of concerns between index types

## Future Extensions

- **Composite Indexes**: Multi-column indexes
- **Partial Indexes**: With WHERE conditions
- **Expression Indexes**: On computed values
- **Spatial Indexes**: For geographic data
- **JSON Indexes**: For nested object queries
- **Bloom Filters**: For negative lookups
- **Index Hints**: Manual query optimization