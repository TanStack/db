/**
 * Sentinel stored as a map value for deleted keys — see TombstoneMap.
 */
const TOMBSTONE = Symbol(`tombstone`)

const MAX_TOMBSTONES = 1024

/**
 * Map wrapper whose delete() overwrites the value with a tombstone sentinel
 * instead of removing the entry. V8 hash tables degrade badly under repeated
 * delete+re-add of the same key (each cycle appends to the data table and
 * forces rehashes — ~20µs per cycle on a 50k-entry map vs ~0.03µs for an
 * in-place value write), which is exactly the churn incremental row updates
 * produce. The deleted value is still released for GC; only the (tiny) key
 * is retained until physical deletions are batched in a bounded compaction.
 *
 * Read paths (get/has/size/iteration) never observe tombstoned entries.
 */
export class TombstoneMap<K, V> {
  private map = new Map<K, V | typeof TOMBSTONE>()
  private tombstoneCount = 0

  get(key: K): V | undefined {
    const value = this.map.get(key)
    return value === TOMBSTONE ? undefined : value
  }

  has(key: K): boolean {
    const value = this.map.get(key)
    if (value === undefined) {
      return this.map.has(key)
    }
    return value !== TOMBSTONE
  }

  get size(): number {
    return this.map.size - this.tombstoneCount
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    for (const [key, value] of this.map) {
      if (value !== TOMBSTONE) {
        yield [key, value]
      }
    }
  }

  entries(): IterableIterator<[K, V]> {
    return this[Symbol.iterator]()
  }

  *keys(): IterableIterator<K> {
    for (const [key, value] of this.map) {
      if (value !== TOMBSTONE) {
        yield key
      }
    }
  }

  *values(): IterableIterator<V> {
    for (const value of this.map.values()) {
      if (value !== TOMBSTONE) {
        yield value
      }
    }
  }

  forEach(callbackfn: (value: V, key: K, map: this) => void): void {
    for (const [key, value] of this.map) {
      if (value !== TOMBSTONE) {
        callbackfn(value, key, this)
      }
    }
  }

  set(key: K, value: V): this {
    const prev = this.map.get(key)
    if (prev === TOMBSTONE) {
      this.tombstoneCount--
    }
    this.map.set(key, value)
    return this
  }

  delete(key: K): boolean {
    const prev = this.map.get(key)
    if (prev === TOMBSTONE || (prev === undefined && !this.map.has(key))) {
      return false
    }
    this.map.set(key, TOMBSTONE)
    this.tombstoneCount++
    if (this.tombstoneCount > MAX_TOMBSTONES) {
      this.compactTombstones()
    }
    return true
  }

  clear(): void {
    this.map.clear()
    this.tombstoneCount = 0
  }

  private compactTombstones(): void {
    for (const [key, value] of this.map) {
      if (value === TOMBSTONE) {
        this.map.delete(key)
      }
    }
    this.tombstoneCount = 0
  }
}
