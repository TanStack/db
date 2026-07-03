import { compareKeys } from '@tanstack/db-ivm'

/**
 * Sentinel stored as a map value for deleted keys. V8 hash tables degrade
 * badly under repeated delete+re-add of the same key (each cycle appends to
 * the data table and forces rehashes — ~20µs per cycle on a 50k-entry map),
 * which is exactly the churn incremental row updates produce. Overwriting
 * the value in place sidesteps table mutation entirely; the row object is
 * still released for GC and only the (tiny) key is retained until the next
 * compaction.
 */
const TOMBSTONE = Symbol(`tombstone`)

const MAX_TOMBSTONES = 1024

/**
 * A Map implementation that keeps its entries sorted based on a comparator function
 * @template TKey - The type of keys in the map (must be string | number)
 * @template TValue - The type of values in the map
 */
export class SortedMap<TKey extends string | number, TValue> {
  private map: Map<TKey, TValue | typeof TOMBSTONE>
  private sortedKeys: Array<TKey>
  private comparator: ((a: TValue, b: TValue) => number) | undefined
  /**
   * With a custom comparator, ordering is maintained lazily: writes are O(1)
   * (append + mark dirty) and `sortedKeys` is rebuilt from the map on the
   * next ordered read. Value comparators (e.g. fractional-index comparators
   * on live query collections) are much more expensive per probe than key
   * comparisons, and reads typically follow batches of writes.
   */
  private dirty = false
  /**
   * Number of tombstoned (deleted) entries currently in `map`. `sortedKeys`
   * only ever contains live keys, so ordered reads never see tombstones.
   */
  private tombstoneCount = 0

  /**
   * Creates a new SortedMap instance
   *
   * @param comparator - Optional function to compare values for sorting.
   *                     If not provided, entries are sorted by key only.
   */
  constructor(comparator?: (a: TValue, b: TValue) => number) {
    this.map = new Map<TKey, TValue | typeof TOMBSTONE>()
    this.sortedKeys = []
    this.comparator = comparator
  }

  /**
   * Rebuilds the sorted key order from the map when lazy writes have made it
   * stale. `sortedKeys` may contain deleted keys until this runs.
   */
  private ensureSorted(): void {
    if (!this.dirty) {
      return
    }
    const comparator = this.comparator
    const liveKeys: Array<TKey> = []
    for (const [key, value] of this.map) {
      if (value !== TOMBSTONE) {
        liveKeys.push(key)
      }
    }
    this.sortedKeys = liveKeys
    if (comparator) {
      this.sortedKeys.sort((a, b) => {
        const valueComparison = comparator(
          this.map.get(a) as TValue,
          this.map.get(b) as TValue,
        )
        if (valueComparison !== 0) {
          return valueComparison
        }
        return compareKeys(a, b)
      })
    } else {
      this.sortedKeys.sort(compareKeys)
    }
    this.dirty = false
  }

  /**
   * Physically removes tombstoned entries. Deletes are batched here so the
   * underlying hash table pays for at most one rehash per MAX_TOMBSTONES
   * deletions instead of degrading on every delete+re-add cycle.
   */
  private compactTombstones(): void {
    for (const [key, value] of this.map) {
      if (value === TOMBSTONE) {
        this.map.delete(key)
      }
    }
    this.tombstoneCount = 0
  }

  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @returns This SortedMap instance for chaining
   */
  set(key: TKey, value: TValue): this {
    const prev = this.map.get(key)
    if (prev === TOMBSTONE) {
      // Reviving a tombstoned key: in-place value write, no table mutation.
      // The key is not in sortedKeys (it only holds live keys), so it goes
      // through the same append logic as a brand-new key.
      this.tombstoneCount--
      this.map.set(key, value)
      this.appendKey(key)
      return this
    }

    const isNew = prev === undefined && !this.map.has(key)
    this.map.set(key, value)
    if (isNew) {
      this.appendKey(key)
    } else if (this.comparator) {
      // Existing key with a value comparator: its position may have changed
      this.dirty = true
    }
    return this
  }

  /**
   * Records a newly-live key in `sortedKeys`, keeping the array clean when
   * the key appends in order (the common monotonic-id case for key-ordered
   * maps) and deferring a sort otherwise.
   */
  private appendKey(key: TKey): void {
    if (this.comparator) {
      // Lazy ordering: append, defer sorting to the next read
      this.sortedKeys.push(key)
      this.dirty = true
      return
    }
    if (
      this.sortedKeys.length === 0 ||
      (!this.dirty &&
        compareKeys(key, this.sortedKeys[this.sortedKeys.length - 1]!) > 0)
    ) {
      this.sortedKeys.push(key)
    } else {
      this.sortedKeys.push(key)
      this.dirty = true
    }
  }

  /**
   * Gets a value by its key
   *
   * @param key - The key to look up
   * @returns The value associated with the key, or undefined if not found
   */
  get(key: TKey): TValue | undefined {
    const value = this.map.get(key)
    return value === TOMBSTONE ? undefined : value
  }

  /**
   * Removes a key-value pair from the map
   *
   * @param key - The key to remove
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key: TKey): boolean {
    // Tombstone instead of deleting (see TOMBSTONE above). For sortedKeys
    // (which only holds live keys), deleting the current tail of a clean
    // array pops it, keeping insert-then-delete cycles (a common probe/undo
    // pattern) staleness-free; other deletes defer a rebuild.
    const prev = this.map.get(key)
    if (prev === TOMBSTONE || (prev === undefined && !this.map.has(key))) {
      return false
    }
    this.map.set(key, TOMBSTONE)
    this.tombstoneCount++
    if (
      !this.dirty &&
      this.sortedKeys.length > 0 &&
      this.sortedKeys[this.sortedKeys.length - 1] === key
    ) {
      this.sortedKeys.pop()
    } else {
      this.dirty = true
    }
    if (this.tombstoneCount > MAX_TOMBSTONES) {
      this.compactTombstones()
    }
    return true
  }

  /**
   * Checks if a key exists in the map
   *
   * @param key - The key to check
   * @returns True if the key exists, false otherwise
   */
  has(key: TKey): boolean {
    const value = this.map.get(key)
    if (value === undefined) {
      return this.map.has(key)
    }
    return value !== TOMBSTONE
  }

  /**
   * Removes all key-value pairs from the map
   */
  clear(): void {
    this.map.clear()
    this.sortedKeys = []
    this.tombstoneCount = 0
    this.dirty = false
  }

  /**
   * Gets the number of key-value pairs in the map
   */
  get size(): number {
    return this.map.size - this.tombstoneCount
  }

  /**
   * Default iterator that returns entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  *[Symbol.iterator](): IterableIterator<[TKey, TValue]> {
    this.ensureSorted()
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key) as TValue] as [TKey, TValue]
    }
  }

  /**
   * Returns an iterator for the map's entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  entries(): IterableIterator<[TKey, TValue]> {
    return this[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's keys in sorted order
   *
   * @returns An iterator for the map's keys
   */
  keys(): IterableIterator<TKey> {
    this.ensureSorted()
    return this.sortedKeys[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  values(): IterableIterator<TValue> {
    return function* (this: SortedMap<TKey, TValue>) {
      this.ensureSorted()
      for (const key of this.sortedKeys) {
        yield this.map.get(key) as TValue
      }
    }.call(this)
  }

  /**
   * Executes a callback function for each key-value pair in the map in sorted order
   *
   * @param callbackfn - Function to execute for each entry
   */
  forEach(
    callbackfn: (value: TValue, key: TKey, map: Map<TKey, TValue>) => void,
  ): void {
    this.ensureSorted()
    for (const key of this.sortedKeys) {
      callbackfn(
        this.map.get(key) as TValue,
        key,
        this.map as Map<TKey, TValue>,
      )
    }
  }
}
