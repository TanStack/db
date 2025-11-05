/**
 * Query Pooling System - Prototype Implementation
 *
 * Shares subscriptions and graph execution across similar queries
 * with different parameter values.
 */

import type { Collection } from "../../collection/index.js"
import type { ChangeMessage } from "../../types.js"
import type { CollectionSubscription } from "../../collection/subscription.js"

/**
 * Signature identifying queries that can share infrastructure
 */
export interface QuerySignature {
  collectionId: string
  // For prototype: simple hash of collection + query type
  // Production: hash of query structure (from, select, joins, etc)
  structureHash: string
}

/**
 * Parameters that vary between query instances
 */
export interface QueryParameters {
  [key: string]: any
}

/**
 * Individual query instance with specific parameters
 */
export class QueryInstance {
  readonly id: string
  readonly params: QueryParameters
  private data: Map<string | number, any> = new Map()
  private callbacks: Set<() => void> = new Set()
  private pool: PooledQuery

  constructor(
    id: string,
    params: QueryParameters,
    onUpdate: () => void,
    pool: PooledQuery
  ) {
    this.id = id
    this.params = params
    this.callbacks.add(onUpdate)
    this.pool = pool
  }

  /**
   * Update data for this instance
   */
  updateData(newData: Map<string | number, any>): boolean {
    // Check if data actually changed
    if (mapsEqual(this.data, newData)) {
      return false // No change
    }

    this.data = newData
    return true // Changed
  }

  /**
   * Get current data
   */
  getData(): Array<any> {
    return Array.from(this.data.values())
  }

  /**
   * Get data as map
   */
  getDataMap(): Map<string | number, any> {
    return new Map(this.data)
  }

  /**
   * Subscribe to updates
   */
  subscribe(callback: () => void): () => void {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
    }
  }

  /**
   * Notify all subscribers that data changed
   */
  notifyUpdate() {
    for (const callback of this.callbacks) {
      callback()
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    this.pool.unregister(this.id)
    this.callbacks.clear()
  }
}

/**
 * Check if a record matches given parameters
 */
type ParameterMatcher = (record: any, params: QueryParameters) => boolean

/**
 * Extract parameter key from a record (for indexing)
 */
type ParameterKeyExtractor = (record: any) => string

/**
 * Pooled query managing multiple instances with shared subscription
 */
export class PooledQuery {
  readonly signature: QuerySignature
  private readonly collection: Collection

  // Shared infrastructure
  private sharedSubscription: CollectionSubscription | null = null
  private sharedData: Map<string | number, any> = new Map()

  // All query instances using this pool
  private instances: Map<string, QueryInstance> = new Map()

  // Index: parameter key → Map of records matching those parameters
  // e.g., "0|0|a" → Map { "0|0|a" => {id: "0|0|a", rowId: "0|0", side: "a", ...} }
  private resultIndex: Map<string, Map<string | number, any>> = new Map()

  // Reverse index: parameter key → Set of instance IDs
  // e.g., "0|0|a" → Set { "instance-1", "instance-5" }
  private instancesByParams: Map<string, Set<string>> = new Map()

  // Reference counting for cleanup
  private refCount = 0

  // Parameter key extraction
  private readonly parameterKeyExtractor: ParameterKeyExtractor

  constructor(
    signature: QuerySignature,
    collection: Collection,
    _parameterMatcher: ParameterMatcher, // Reserved for future use
    parameterKeyExtractor: ParameterKeyExtractor
  ) {
    this.signature = signature
    this.collection = collection
    this.parameterKeyExtractor = parameterKeyExtractor
    // Note: _parameterMatcher is reserved for future filtering logic but not used yet
  }

  /**
   * Register a new query instance with specific parameters
   */
  register(params: QueryParameters, onUpdate: () => void): QueryInstance {
    this.refCount++

    // Create query instance
    const instanceId = hashParams(params)
    const instance = new QueryInstance(instanceId, params, onUpdate, this)

    this.instances.set(instanceId, instance)

    // Add to reverse index
    const paramKey = this.paramsToKey(params)
    if (!this.instancesByParams.has(paramKey)) {
      this.instancesByParams.set(paramKey, new Set())
    }
    this.instancesByParams.get(paramKey)!.add(instanceId)

    // Start shared subscription if this is the first instance
    if (this.refCount === 1) {
      this.startSharedSubscription()
    } else {
      // Provide current data immediately from index
      const currentData = this.resultIndex.get(paramKey) ?? new Map()
      instance.updateData(currentData)
    }

    return instance
  }

  /**
   * Unregister a query instance
   */
  unregister(instanceId: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    // Remove from instances
    this.instances.delete(instanceId)

    // Remove from reverse index
    const paramKey = this.paramsToKey(instance.params)
    this.instancesByParams.get(paramKey)?.delete(instanceId)

    // Clean up empty parameter sets
    if (this.instancesByParams.get(paramKey)?.size === 0) {
      this.instancesByParams.delete(paramKey)
      this.resultIndex.delete(paramKey)
    }

    this.refCount--

    // Clean up shared subscription if no more instances
    if (this.refCount === 0) {
      this.stopSharedSubscription()
    }
  }

  /**
   * Start single subscription for all instances
   */
  private startSharedSubscription() {
    // Subscribe to entire collection (no WHERE clause filtering)
    this.sharedSubscription = this.collection.subscribeChanges(
      (changes) => this.handleSharedChanges(changes),
      { includeInitialState: true }
    )
  }

  /**
   * Stop shared subscription
   */
  private stopSharedSubscription() {
    this.sharedSubscription?.unsubscribe()
    this.sharedSubscription = null
    this.sharedData.clear()
    this.resultIndex.clear()
  }

  /**
   * Handle changes from shared subscription
   * Only notify instances whose data actually changed
   */
  private handleSharedChanges(changes: Array<ChangeMessage>) {
    // Track which parameter sets were affected
    const affectedParamKeys = new Set<string>()

    for (const change of changes) {
      const { key, value, type } = change

      // Update shared data
      if (type === `delete`) {
        const oldValue = this.sharedData.get(key)
        this.sharedData.delete(key)

        // Remove from index
        if (oldValue) {
          const paramKey = this.parameterKeyExtractor(oldValue)
          this.resultIndex.get(paramKey)?.delete(key)
          affectedParamKeys.add(paramKey)
        }
      } else {
        this.sharedData.set(key, value)

        // Add to index
        const paramKey = this.parameterKeyExtractor(value)
        if (!this.resultIndex.has(paramKey)) {
          this.resultIndex.set(paramKey, new Map())
        }
        this.resultIndex.get(paramKey)!.set(key, value)
        affectedParamKeys.add(paramKey)
      }
    }

    // Update only affected instances
    for (const paramKey of affectedParamKeys) {
      const instanceIds = this.instancesByParams.get(paramKey)
      if (!instanceIds) continue

      const newData = this.resultIndex.get(paramKey) ?? new Map()

      for (const instanceId of instanceIds) {
        const instance = this.instances.get(instanceId)
        if (!instance) continue

        // Update data and notify only if changed
        const changed = instance.updateData(newData)
        if (changed) {
          instance.notifyUpdate()
        }
      }
    }
  }

  /**
   * Convert parameters to index key
   */
  private paramsToKey(params: QueryParameters): string {
    // For prototype: simple JSON stringification
    // Production: optimized key generation based on parameter schema
    return JSON.stringify(params)
  }

  /**
   * Get current instance count
   */
  getInstanceCount(): number {
    return this.instances.size
  }

  /**
   * Get current reference count
   */
  getRefCount(): number {
    return this.refCount
  }
}

/**
 * Global query pool manager
 */
export class QueryPoolManager {
  private pools: Map<string, PooledQuery> = new Map()

  /**
   * Get or create a pooled query for given signature
   */
  getOrCreatePool(
    signature: QuerySignature,
    collection: Collection,
    parameterMatcher: ParameterMatcher,
    parameterKeyExtractor: ParameterKeyExtractor
  ): PooledQuery {
    const key = this.signatureToKey(signature)

    if (!this.pools.has(key)) {
      const pool = new PooledQuery(
        signature,
        collection,
        parameterMatcher,
        parameterKeyExtractor
      )
      this.pools.set(key, pool)
    }

    return this.pools.get(key)!
  }

  /**
   * Remove pooled query (called when refCount reaches 0)
   */
  removePooledQuery(signature: QuerySignature) {
    const key = this.signatureToKey(signature)
    this.pools.delete(key)
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalPools: this.pools.size,
      pools: Array.from(this.pools.entries()).map(([key, pool]) => ({
        key,
        signature: pool.signature,
        instanceCount: pool.getInstanceCount(),
        refCount: pool.getRefCount(),
      })),
    }
  }

  /**
   * Clear all pools (for testing)
   */
  clear() {
    this.pools.clear()
  }

  private signatureToKey(signature: QuerySignature): string {
    return `${signature.collectionId}:${signature.structureHash}`
  }
}

// Global singleton
export const queryPool = new QueryPoolManager()

/**
 * Helper to hash query parameters
 */
function hashParams(params: QueryParameters): string {
  return JSON.stringify(params)
}

/**
 * Helper to check if two maps are equal
 */
function mapsEqual(
  map1: Map<string | number, any>,
  map2: Map<string | number, any>
): boolean {
  if (map1.size !== map2.size) return false

  for (const [key, value] of map1) {
    if (!map2.has(key) || map2.get(key) !== value) {
      return false
    }
  }

  return true
}
