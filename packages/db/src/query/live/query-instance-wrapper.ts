/**
 * Collection-like wrapper for QueryInstance
 *
 * Makes a QueryInstance look like a Collection so it can be used seamlessly
 * with useLiveQuery and other code expecting Collection interface
 */

import type { QueryInstance } from "./query-pool.js"
import type { Collection } from "../../collection/index.js"
import type { CollectionStatus } from "../../types.js"

/**
 * Minimal Collection-like wrapper for QueryInstance
 * Implements only the methods needed by useLiveQuery
 */
export class QueryInstanceWrapper<
  T extends object,
  TKey extends string | number,
> implements Partial<Collection<T, TKey, {}>>
{
  readonly id: string
  private instance: QueryInstance
  private changeCallbacks: Set<() => void> = new Set()
  private _status: CollectionStatus = `ready`

  constructor(instance: QueryInstance, poolId: string) {
    this.instance = instance
    this.id = `pooled-${poolId}-${instance.id}`
  }

  /**
   * Subscribe to changes - required by useLiveQuery
   * Note: useLiveQuery doesn't use the changes parameter, it just triggers re-renders
   */
  subscribeChanges(
    callback: (changes?: Array<any>) => void,
    _options?: { includeInitialState?: boolean }
  ): any {
    // Create a wrapper that calls callback without arguments
    // useLiveQuery doesn't use the changes array, it just needs notification
    const wrappedCallback = () => callback()
    this.changeCallbacks.add(wrappedCallback)

    // Initial notification if requested
    if (_options?.includeInitialState) {
      // Defer to next tick to match Collection behavior
      Promise.resolve().then(() => wrappedCallback())
    }

    // Return minimal subscription object
    // Cast to any since we're only implementing the unsubscribe method
    return {
      unsubscribe: () => {
        this.changeCallbacks.delete(wrappedCallback)
      },
    } as any
  }

  /**
   * Notify all subscribers of changes
   */
  notifyChanges(): void {
    for (const callback of this.changeCallbacks) {
      callback()
    }
  }

  /**
   * Get status - required by useLiveQuery
   */
  get status(): CollectionStatus {
    return this._status
  }

  set status(value: CollectionStatus) {
    this._status = value
  }

  /**
   * Start sync immediately - required by useLiveQuery
   */
  startSyncImmediate(): void {
    // Pooled queries are always synced
    this._status = `ready`
  }

  /**
   * Check if ready
   */
  isReady(): boolean {
    return this._status === `ready`
  }

  /**
   * Get all entries as [key, value] pairs
   */
  *entries(): IterableIterator<[TKey, T]> {
    const data = this.instance.getDataMap()
    for (const [key, value] of data) {
      yield [key as TKey, value as T]
    }
  }

  /**
   * Get value by key
   */
  get(key: TKey): T | undefined {
    const data = this.instance.getDataMap()
    return data.get(key) as T | undefined
  }

  /**
   * Check if key exists
   */
  has(key: TKey): boolean {
    const data = this.instance.getDataMap()
    return data.has(key)
  }

  /**
   * Get size
   */
  get size(): number {
    return this.instance.getDataMap().size
  }

  /**
   * Iterate over values
   */
  *values(): IterableIterator<T> {
    const data = this.instance.getDataMap()
    for (const value of data.values()) {
      yield value as T
    }
  }

  /**
   * Iterate over keys
   */
  *keys(): IterableIterator<TKey> {
    const data = this.instance.getDataMap()
    for (const key of data.keys()) {
      yield key as TKey
    }
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.changeCallbacks.clear()
    this.instance.dispose()
  }
}

/**
 * Create a Collection-like wrapper around a QueryInstance
 */
export function wrapQueryInstance<
  T extends object,
  TKey extends string | number,
>(instance: QueryInstance, poolId: string): QueryInstanceWrapper<T, TKey> {
  const wrapper = new QueryInstanceWrapper<T, TKey>(instance, poolId)

  // Subscribe to instance updates and forward to wrapper subscribers
  instance.subscribe(() => {
    wrapper.notifyChanges()
  })

  return wrapper
}
