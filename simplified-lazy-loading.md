# Simplified Lazy Loading Without Registry

## Core Insight: Callable Detection

Both constructors and async loaders are callable, but we can distinguish them:

```typescript
// Constructor function
typeof BTreeIndex === 'function' && BTreeIndex.prototype // true
typeof BTreeIndex === 'function' && BTreeIndex.length === 4 // true (4 constructor params)

// Async loader function  
typeof asyncLoader === 'function' && asyncLoader.prototype // false (arrow function)
typeof asyncLoader === 'function' && asyncLoader.length === 0 // true (0 params)
```

## Simplified Types

```typescript
/**
 * Index resolver can be either a class constructor or async loader
 */
export type IndexResolver<TKey extends string | number = string | number> = 
  | IndexConstructor<TKey>
  | (() => Promise<IndexConstructor<TKey>>)

/**
 * Index constructor type
 */
export type IndexConstructor<TKey extends string | number = string | number> = new (
  id: string,
  expression: BasicExpression,
  name?: string,
  options?: any
) => BaseIndex<TKey>

/**
 * Enhanced index options with simplified resolver
 */
export interface IndexOptions<TResolver extends IndexResolver = typeof BTreeIndex> {
  name?: string
  indexType?: TResolver
  options?: TResolver extends IndexConstructor<any>
    ? TResolver extends new (id: string, expr: BasicExpression, name?: string, options?: infer O) => any ? O : never
    : TResolver extends () => Promise<infer TCtor>
      ? TCtor extends new (id: string, expr: BasicExpression, name?: string, options?: infer O) => any ? O : never
      : never
}
```

## Resolver Detection Logic

```typescript
/**
 * Utility to determine if a resolver is a constructor or async loader
 */
function isConstructor<TKey extends string | number>(
  resolver: IndexResolver<TKey>
): resolver is IndexConstructor<TKey> {
  // Check if it's a function with a prototype (constructor)
  return (
    typeof resolver === 'function' &&
    resolver.prototype !== undefined &&
    resolver.prototype.constructor === resolver
  )
}

/**
 * Resolve index constructor from resolver
 */
async function resolveIndexConstructor<TKey extends string | number>(
  resolver: IndexResolver<TKey>
): Promise<IndexConstructor<TKey>> {
  if (isConstructor(resolver)) {
    return resolver
  } else {
    // It's an async loader function
    return await resolver()
  }
}
```

## Lazy Index Wrapper (Simplified)

```typescript
/**
 * Simplified wrapper that handles both sync and async resolvers
 */
class LazyIndexWrapper<TKey extends string | number = string | number> {
  private indexPromise: Promise<BaseIndex<TKey>> | null = null
  private resolvedIndex: BaseIndex<TKey> | null = null
  
  constructor(
    private id: string,
    private expression: BasicExpression,
    private name: string | undefined,
    private resolver: IndexResolver<TKey>,
    private options: any
  ) {}

  /**
   * Resolve the actual index
   */
  async resolve(): Promise<BaseIndex<TKey>> {
    if (this.resolvedIndex) {
      return this.resolvedIndex
    }

    if (!this.indexPromise) {
      this.indexPromise = this.createIndex()
    }

    this.resolvedIndex = await this.indexPromise
    return this.resolvedIndex
  }

  /**
   * Check if already resolved
   */
  isResolved(): boolean {
    return this.resolvedIndex !== null
  }

  /**
   * Get resolved index (throws if not ready)
   */
  getResolved(): BaseIndex<TKey> {
    if (!this.resolvedIndex) {
      throw new Error(`Index ${this.id} has not been resolved yet. Ensure collection is synced.`)
    }
    return this.resolvedIndex
  }

  private async createIndex(): Promise<BaseIndex<TKey>> {
    const IndexClass = await resolveIndexConstructor(this.resolver)
    return new IndexClass(this.id, this.expression, this.name, this.options)
  }
}
```

## Collection Implementation (No Registry)

```typescript
/**
 * Collection with simplified lazy index support
 */
export class CollectionImpl<T, TKey extends string | number> {
  private lazyIndexes = new Map<string, LazyIndexWrapper<TKey>>()
  private resolvedIndexes = new Map<string, BaseIndex<TKey>>()
  private isIndexesResolved = false

  /**
   * Single createIndex method supporting both sync and async
   */
  public createIndex<TResolver extends IndexResolver<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    config: IndexOptions<TResolver> = {}
  ): IndexProxy<TKey> {
    this.validateCollectionUsable(`createIndex`)

    const indexId = `${++this.indexCounter}`
    const singleRowRefProxy = createSingleRowRefProxy<T>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)
    
    // Default to BTreeIndex if no type specified
    const resolver = config.indexType ?? BTreeIndex

    // Create lazy wrapper
    const lazyIndex = new LazyIndexWrapper<TKey>(
      indexId,
      expression,
      config.name,
      resolver,
      config.options
    )

    this.lazyIndexes.set(indexId, lazyIndex)

    // If indexes are already resolved, resolve this one immediately
    if (this.isIndexesResolved) {
      this.resolveSingleIndex(indexId, lazyIndex)
    }

    return new IndexProxy(indexId, lazyIndex)
  }

  /**
   * Resolve all lazy indexes (called when collection first syncs)
   */
  private async resolveAllIndexes(): Promise<void> {
    if (this.isIndexesResolved) return

    const resolutionPromises = Array.from(this.lazyIndexes.entries()).map(
      async ([indexId, lazyIndex]) => {
        const resolvedIndex = await lazyIndex.resolve()
        
        // Build index with current data
        resolvedIndex.build(this.entries())
        
        this.resolvedIndexes.set(indexId, resolvedIndex)
        return { indexId, resolvedIndex }
      }
    )

    await Promise.all(resolutionPromises)
    this.isIndexesResolved = true
  }

  /**
   * Resolve a single index immediately
   */
  private async resolveSingleIndex(
    indexId: string, 
    lazyIndex: LazyIndexWrapper<TKey>
  ): Promise<BaseIndex<TKey>> {
    const resolvedIndex = await lazyIndex.resolve()
    resolvedIndex.build(this.entries())
    this.resolvedIndexes.set(indexId, resolvedIndex)
    return resolvedIndex
  }

  /**
   * Get resolved indexes for query optimization
   */
  get indexes(): Map<string, BaseIndex<TKey>> {
    return this.resolvedIndexes
  }

  /**
   * Enhanced sync method that resolves indexes
   */
  protected async startSyncInternal(): Promise<void> {
    // Resolve all lazy indexes before starting sync
    await this.resolveAllIndexes()
    
    // Continue with normal sync process
    await super.startSyncInternal()
  }
}
```

## Usage Examples

```typescript
// 1. Synchronous constructor (immediate loading)
const ageIndex = collection.createIndex(row => row.age, {
  indexType: BTreeIndex,
  options: { compareFn: customComparator }
})

// 2. Async loader (lazy loading)
const textIndex = collection.createIndex(row => row.content, {
  indexType: async () => {
    const { FullTextIndex } = await import('./indexes/fulltext.js')
    return FullTextIndex
  },
  options: { 
    language: 'en',
    rankingAlgorithm: 'bm25'
  }
})

// 3. Conditional loading
const adaptiveIndex = collection.createIndex(row => row.name, {
  indexType: async () => {
    if (typeof window !== 'undefined') {
      const { BrowserTrigramIndex } = await import('./browser-trigram.js')
      return BrowserTrigramIndex
    } else {
      const { NativeTrigramIndex } = await import('./native-trigram.js')
      return NativeTrigramIndex
    }
  },
  options: { minSimilarity: 0.4 }
})

// 4. Working with the proxy
if (textIndex.isReady) {
  console.log('Stats:', textIndex.index.getStats())
} else {
  console.log('Index still loading...')
  const resolved = await textIndex.whenReady()
  console.log('Loaded stats:', resolved.getStats())
}
```

## Convenience Helpers (Optional)

```typescript
/**
 * Pre-defined async loaders for common index types
 */
export const IndexTypes = {
  // Synchronous (immediate)
  BTree: BTreeIndex,
  Hash: HashIndex,
  
  // Asynchronous (lazy loaded)
  Trigram: async () => {
    const { TrigramIndex } = await import('./indexes/trigram.js')
    return TrigramIndex
  },
  
  FullText: async () => {
    const { FullTextIndex } = await import('./indexes/fulltext.js')
    return FullTextIndex
  },
  
  Geospatial: async () => {
    const { GeospatialIndex } = await import('./indexes/geospatial.js')
    return GeospatialIndex
  }
} as const

// Usage with helpers
const nameIndex = collection.createIndex(row => row.name, {
  indexType: IndexTypes.Trigram,
  options: { minSimilarity: 0.4 }
})

const locationIndex = collection.createIndex(row => row.coordinates, {
  indexType: IndexTypes.Geospatial,
  options: { srid: 4326 }
})
```

## Better Detection Alternative

If the prototype detection is unreliable, we can use a more explicit approach:

```typescript
/**
 * Alternative: Check constructor parameters vs loader signature
 */
function isConstructor<TKey extends string | number>(
  resolver: IndexResolver<TKey>
): resolver is IndexConstructor<TKey> {
  // Constructors typically have multiple parameters (id, expression, name, options)
  // Async loaders have zero parameters
  return resolver.length > 0
}

// Or even simpler - check if it's async
function isAsyncLoader<TKey extends string | number>(
  resolver: IndexResolver<TKey>
): resolver is () => Promise<IndexConstructor<TKey>> {
  // Check if calling it returns a Promise
  try {
    const result = resolver()
    return result && typeof result.then === 'function'
  } catch {
    // If it throws, it's probably a constructor called without 'new'
    return false
  }
}
```

## Benefits of Simplified Approach

1. **No Registry**: Direct resolver detection
2. **Simpler Code**: Less abstraction layers
3. **Type Safety**: Full TypeScript inference preserved
4. **Flexible**: Works with any callable pattern
5. **Clear Intent**: Explicit at call site
6. **Performance**: Minimal runtime overhead

## The Key Insight

The detection works because:
- **Constructors**: `typeof Class === 'function' && Class.prototype`
- **Async Loaders**: `typeof loader === 'function' && !loader.prototype`
- **Parameter Count**: Constructors have 4+ params, loaders have 0

This eliminates the registry complexity while maintaining all the lazy loading benefits!