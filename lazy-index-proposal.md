# Lazy-Loading Index Implementation Proposal

## Problem Statement

We need to support lazy loading of index implementations to:
1. Avoid loading heavy dependencies until actually needed
2. Support dynamic imports for code splitting
3. Allow async initialization while maintaining clean API
4. Work with both sync classes and async loaders

## Solution: Index Resolver Pattern

### 1. Core Types

```typescript
/**
 * Index resolver can be either a class or a function that returns a promise
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
 * Enhanced index options that support both sync and async resolvers
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

### 2. Lazy Index Registry

```typescript
/**
 * Registry for both sync and async index types
 */
export class IndexRegistry {
  private static resolvers = new Map<string, IndexResolver>()
  private static resolvedCache = new Map<string, IndexConstructor>()

  /**
   * Register a synchronous index class
   */
  static register<TKey extends string | number>(
    name: string, 
    indexClass: IndexConstructor<TKey>
  ): void {
    this.resolvers.set(name, indexClass)
  }

  /**
   * Register an async index loader
   */
  static registerAsync<TKey extends string | number>(
    name: string,
    loader: () => Promise<IndexConstructor<TKey>>
  ): void {
    this.resolvers.set(name, loader)
  }

  /**
   * Resolve an index constructor (handles both sync and async)
   */
  static async resolve<TKey extends string | number>(
    nameOrResolver: string | IndexResolver<TKey>
  ): Promise<IndexConstructor<TKey>> {
    // If it's already a constructor, return it
    if (typeof nameOrResolver === 'function' && nameOrResolver.prototype) {
      return nameOrResolver as IndexConstructor<TKey>
    }

    // If it's an async resolver function, call it
    if (typeof nameOrResolver === 'function') {
      return await (nameOrResolver as () => Promise<IndexConstructor<TKey>>)()
    }

    // If it's a string, look it up in registry
    const name = nameOrResolver as string
    
    // Check cache first
    if (this.resolvedCache.has(name)) {
      return this.resolvedCache.get(name)! as IndexConstructor<TKey>
    }

    const resolver = this.resolvers.get(name)
    if (!resolver) {
      throw new Error(`Index type '${name}' not found in registry`)
    }

    // If resolver is a class, cache and return
    if (typeof resolver === 'function' && resolver.prototype) {
      const IndexClass = resolver as IndexConstructor<TKey>
      this.resolvedCache.set(name, IndexClass)
      return IndexClass
    }

    // If resolver is async, await and cache
    const IndexClass = await (resolver as () => Promise<IndexConstructor<TKey>>)()
    this.resolvedCache.set(name, IndexClass)
    return IndexClass
  }

  /**
   * Check if an index type is registered
   */
  static has(name: string): boolean {
    return this.resolvers.has(name)
  }

  /**
   * Get all registered index type names
   */
  static getRegisteredTypes(): string[] {
    return Array.from(this.resolvers.keys())
  }
}

// Register built-in types
IndexRegistry.register('btree', BTreeIndex)

// Register async types (loaded on demand)
IndexRegistry.registerAsync('trigram', async () => {
  const { TrigramIndex } = await import('./indexes/trigram.js')
  return TrigramIndex
})

IndexRegistry.registerAsync('fulltext', async () => {
  const { FullTextIndex } = await import('./indexes/fulltext.js')
  return FullTextIndex
})
```

### 3. Lazy Index Wrapper

```typescript
/**
 * Wrapper that defers index creation until first sync
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
   * Resolve the actual index (called when collection first syncs)
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
   * Get the resolved index (throws if not yet resolved)
   */
  getResolved(): BaseIndex<TKey> {
    if (!this.resolvedIndex) {
      throw new Error(`Index ${this.id} has not been resolved yet. Ensure collection is synced.`)
    }
    return this.resolvedIndex
  }

  /**
   * Check if index is resolved
   */
  isResolved(): boolean {
    return this.resolvedIndex !== null
  }

  private async createIndex(): Promise<BaseIndex<TKey>> {
    const IndexClass = await IndexRegistry.resolve(this.resolver)
    return new IndexClass(this.id, this.expression, this.name, this.options)
  }
}
```

### 4. Enhanced Collection Implementation

```typescript
/**
 * Collection with lazy index support
 */
export class CollectionImpl<T, TKey extends string | number> {
  private lazyIndexes = new Map<string, LazyIndexWrapper<TKey>>()
  private resolvedIndexes = new Map<string, BaseIndex<TKey>>()
  private isIndexesResolved = false

  /**
   * Create an index with lazy loading support
   */
  public createIndex<TResolver extends IndexResolver<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    config: IndexOptions<TResolver> = {}
  ): Promise<InstanceType<TResolver extends IndexConstructor<TKey> ? TResolver : IndexConstructor<TKey>>> {
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

    // If collection is already synced, resolve immediately
    if (this.isIndexesResolved) {
      return this.resolveSingleIndex(indexId, lazyIndex)
    }

    // Return a promise that resolves when indexes are resolved
    return new Promise((resolve) => {
      const checkResolved = () => {
        if (this.resolvedIndexes.has(indexId)) {
          resolve(this.resolvedIndexes.get(indexId)! as any)
        } else {
          setTimeout(checkResolved, 10)
        }
      }
      checkResolved()
    })
  }

  /**
   * Alternative: Synchronous createIndex that returns a proxy
   */
  public createIndexSync<TResolver extends IndexResolver<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    config: IndexOptions<TResolver> = {}
  ): IndexProxy<TKey> {
    this.validateCollectionUsable(`createIndex`)

    const indexId = `${++this.indexCounter}`
    const singleRowRefProxy = createSingleRowRefProxy<T>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)
    
    const resolver = config.indexType ?? BTreeIndex

    const lazyIndex = new LazyIndexWrapper<TKey>(
      indexId,
      expression,
      config.name,
      resolver,
      config.options
    )

    this.lazyIndexes.set(indexId, lazyIndex)

    // If already resolved, resolve this index immediately
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
   * Resolve a single index
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
  private getResolvedIndexes(): Map<string, BaseIndex<TKey>> {
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

### 5. Index Proxy for Synchronous API

```typescript
/**
 * Proxy that provides synchronous interface while index loads asynchronously
 */
export class IndexProxy<TKey extends string | number = string | number> {
  constructor(
    private indexId: string,
    private lazyIndex: LazyIndexWrapper<TKey>
  ) {}

  /**
   * Get the resolved index (throws if not ready)
   */
  get index(): BaseIndex<TKey> {
    return this.lazyIndex.getResolved()
  }

  /**
   * Check if index is ready
   */
  get isReady(): boolean {
    return this.lazyIndex.isResolved()
  }

  /**
   * Wait for index to be ready
   */
  async whenReady(): Promise<BaseIndex<TKey>> {
    return await this.lazyIndex.resolve()
  }

  /**
   * Proxy common methods
   */
  get id(): string {
    return this.indexId
  }

  get name(): string | undefined {
    return this.index.name
  }

  supports(operation: IndexOperation): boolean {
    return this.index.supports(operation)
  }

  // Add other commonly used methods as needed
}
```

### 6. Usage Examples

```typescript
// 1. Direct class usage (sync, immediate)
const ageIndex = collection.createIndexSync(row => row.age, {
  indexType: BTreeIndex
})

// 2. Registry-based usage (can be async)
const nameIndex = collection.createIndexSync(row => row.name, {
  indexType: 'trigram', // Will be loaded lazily
  options: { minSimilarity: 0.4 }
})

// 3. Inline async loader
const geoIndex = collection.createIndexSync(row => row.location, {
  indexType: async () => {
    const { GeospatialIndex } = await import('./custom-indexes/geo.js')
    return GeospatialIndex
  },
  options: { srid: 4326 }
})

// 4. Using the proxy
if (nameIndex.isReady) {
  console.log('Index ready:', nameIndex.index.getStats())
} else {
  // Wait for it
  const resolvedIndex = await nameIndex.whenReady()
  console.log('Index loaded:', resolvedIndex.getStats())
}

// 5. Async API (if preferred)
const descIndex = await collection.createIndex(row => row.description, {
  indexType: 'fulltext',
  options: { language: 'en' }
})
```

### 7. Advanced: Conditional Loading

```typescript
/**
 * Load different index types based on environment or feature flags
 */
export function createConditionalIndexType(): IndexResolver {
  return async () => {
    if (typeof window !== 'undefined') {
      // Browser environment - use lighter implementation
      const { BrowserTrigramIndex } = await import('./indexes/browser-trigram.js')
      return BrowserTrigramIndex
    } else {
      // Node.js environment - use full implementation with native dependencies
      const { NativeTrigramIndex } = await import('./indexes/native-trigram.js')
      return NativeTrigramIndex
    }
  }
}

// Usage
const adaptiveIndex = collection.createIndexSync(row => row.text, {
  indexType: createConditionalIndexType(),
  options: { minSimilarity: 0.3 }
})
```

### 8. Registration Helpers

```typescript
/**
 * Convenience functions for common registration patterns
 */
export class IndexTypes {
  // Synchronous built-ins
  static readonly BTree = BTreeIndex
  
  // Async loaders for heavy dependencies
  static readonly Trigram = async () => {
    const { TrigramIndex } = await import('./indexes/trigram.js')
    return TrigramIndex
  }
  
  static readonly FullText = async () => {
    const { FullTextIndex } = await import('./indexes/fulltext.js')
    return FullTextIndex
  }
  
  static readonly Geospatial = async () => {
    const { GeospatialIndex } = await import('./indexes/geospatial.js')
    return GeospatialIndex
  }
}

// Usage
const textIndex = collection.createIndexSync(row => row.content, {
  indexType: IndexTypes.FullText,
  options: { language: 'en' }
})
```

## Benefits

1. **Lazy Loading**: Heavy index implementations only loaded when needed
2. **Code Splitting**: Index types can be in separate bundles
3. **Flexible API**: Supports both sync classes and async loaders
4. **Type Safety**: Full TypeScript support for options inference
5. **Backward Compatibility**: Existing sync usage still works
6. **Performance**: No loading overhead until collection syncs
7. **Environment Adaptation**: Different implementations for browser/Node.js

## Migration Strategy

1. **Phase 1**: Introduce lazy wrapper and registry (opt-in)
2. **Phase 2**: Move heavy index types to async loading
3. **Phase 3**: Update collection to resolve indexes on sync
4. **Phase 4**: Optimize for code splitting and bundle size

This approach provides maximum flexibility while maintaining clean APIs and excellent performance characteristics.